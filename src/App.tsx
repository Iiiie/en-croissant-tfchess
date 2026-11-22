import { MantineProvider, v8CssVariablesResolver } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { getMatches } from "@tauri-apps/plugin-cli";
import { listen } from "@tauri-apps/api/event";
import { attachConsole, error, info, warn } from "@tauri-apps/plugin-log";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { ContextMenuProvider } from "mantine-contextmenu";
import posthog from "posthog-js";
import { useEffect, useMemo, useRef } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  activeTabAtom,
  databaseConversionStateAtom,
  fontSizeAtom,
  is3dAtom,
  pieceSetAtom,
  primaryColorAtom,
  spellCheckAtom,
  storedDatabasesDirAtom,
  storedDocumentDirAtom,
  storedEnginesDirAtom,
  storedPlayersDirAtom,
  storedPuzzlesDirAtom,
  tabsAtom,
  telemetryEnabledAtom,
} from "./state/atoms";

import "@/styles/chessgroundBaseOverride.css";
import "@/styles/chessgroundColorsOverride.css";

import "@mantine/charts/styles.css";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/tiptap/styles.css";

import "mantine-contextmenu/styles.css";
import "mantine-datatable/styles.css";

import "@/styles/global.css";

import { commands } from "./bindings";
import { handleDeepLink, openCommandLineFile } from "./utils/launch";

import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import ErrorComponent from "@/components/ErrorComponent";
import {
  getDatabasesDir,
  getDocumentDir,
  getEnginesDir,
  getPlayersDir,
  getPuzzlesDir,
} from "@/utils/directories";
import { initUserAgent } from "@/utils/http";
import { ensureSharedStorage } from "@/utils/playerProfile";
import { routeTree } from "./routeTree.gen";
import { colorSchemeManager, createAppTheme } from "./theme";

export type Dirs = {
  documentDir: string;
  databasesDir: string;
  enginesDir: string;
  puzzlesDir: string;
  playersDir: string;
};

const router = createRouter({
  routeTree,
  defaultErrorComponent: ErrorComponent,
  context: {
    loadDirs: async () => {
      const store = getDefaultStore();

      const documentDir = await getDocumentDir();
      const databasesDir = await getDatabasesDir();
      const enginesDir = await getEnginesDir();
      const puzzlesDir = await getPuzzlesDir();
      const playersDir = await getPlayersDir();
      await ensureSharedStorage();

      if (!store.get(storedDocumentDirAtom)) {
        store.set(storedDocumentDirAtom, documentDir);
      }

      if (!store.get(storedDatabasesDirAtom)) {
        store.set(storedDatabasesDirAtom, databasesDir);
      }

      if (!store.get(storedEnginesDirAtom)) {
        store.set(storedEnginesDirAtom, enginesDir);
      }

      if (!store.get(storedPuzzlesDirAtom)) {
        store.set(storedPuzzlesDirAtom, puzzlesDir);
      }

      if (!store.get(storedPlayersDirAtom)) {
        store.set(storedPlayersDirAtom, playersDir);
      }

      return {
        documentDir,
        databasesDir,
        enginesDir,
        puzzlesDir,
        playersDir,
      } as Dirs;
    },
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const checkForUpdates = async () => {
  try {
    const update = await check();
    if (update) {
      const yes = await ask("Do you want to install the new version now?", {
        title: "New version available",
      });
      if (yes) {
        await update.downloadAndInstall();
        await relaunch();
      }
    }
  } catch (e) {
    error(`Failed to check for updates: ${e}`);
  }
};

const navigateToBoard = () => router.navigate({ to: "/" });

function useAppStartup() {
  const initialized = useRef(false);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startupSequence = async () => {
      await commands.closeSplashscreen();
      await initUserAgent();

      const detach = await attachConsole();
      info("React app started successfully");

      checkForUpdates();

      const store = getDefaultStore();
      const telemetryEnabled = store.get(telemetryEnabledAtom);

      // Only initialise PostHog when telemetry is actually enabled. Otherwise
      // every failed external request shows up as a WebKit internal load error.
      if (telemetryEnabled) {
        posthog.init("phc_kgEBtifs0EgWlrl4ROYEbnsQ1b7BS2W5BKLNyXe7f8z", {
          api_host: "https://app.posthog.com",
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          disable_session_recording: true,
        });
        posthog.capture("app_started", { version: await getVersion() });
      }
      const unlistenFile = await listen<string>("open-cli-file", ({ payload }) => {
        void openCommandLineFile(payload, setTabs, setActiveTab, navigateToBoard);
      });

      try {
        const matches = await getMatches();
        if (matches.args.file.occurrences > 0) {
          info(`Opening file from command line: ${matches.args.file.value}`);
          if (typeof matches.args.file.value === "string") {
            const file = matches.args.file.value;
            await openCommandLineFile(file, setTabs, setActiveTab, navigateToBoard);
          }
        }
      } catch (e) {
        warn(`Failed to parse CLI args: ${e}`);
      }

      let unlistenDeepLink: (() => void) | undefined;
      try {
        const initialUrls = await getCurrent();
        if (initialUrls && initialUrls.length > 0) {
          for (const url of initialUrls) {
            void handleDeepLink(url, setTabs, setActiveTab, navigateToBoard);
          }
        }

        unlistenDeepLink = await onOpenUrl((urls) => {
          for (const url of urls) {
            void handleDeepLink(url, setTabs, setActiveTab, navigateToBoard);
          }
        });
      } catch (e) {
        warn(`Failed to setup deep links: ${e}`);
      }

      return () => {
        unlistenFile();
        if (detach) detach();
        if (unlistenDeepLink) unlistenDeepLink();
      };
    };

    let detachFn: (() => void) | undefined;
    startupSequence().then((fn) => {
      detachFn = fn;
    });

    return () => {
      if (detachFn) detachFn();
    };
  }, [setTabs, setActiveTab]);
}

export default function App() {
  const primaryColor = useAtomValue(primaryColorAtom);
  const pieceSet = useAtomValue(pieceSetAtom);
  const fontSize = useAtomValue(fontSizeAtom);
  const spellCheck = useAtomValue(spellCheckAtom);
  const is3d = useAtomValue(is3dAtom);
  const setDatabaseConversionState = useSetAtom(databaseConversionStateAtom);

  useAppStartup();

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}%`;
  }, [fontSize]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<[number, number, string | null]>("convert_progress", (event) => {
      const [totalGames, elapsedMs, sourceFileName] = event.payload;
      setDatabaseConversionState((prev) => ({
        ...prev,
        inProgress: true,
        totalGames,
        elapsedSeconds: elapsedMs / 1000,
        sourceFileName: sourceFileName ?? prev.sourceFileName,
      }));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setDatabaseConversionState]);

  const theme = useMemo(() => createAppTheme(primaryColor, spellCheck), [primaryColor, spellCheck]);

  const valid3dPieceSets = [
    "Basic",
    "CubesAndPi",
    "Experimental",
    "Glass",
    "Metal",
    "ModernJade",
    "ModernWood",
    "RedVBlue",
    "Staunton",
    "Trimmed",
    "Wood",
  ];

  const getPieceSet = (pieceSet: string, is3d: boolean) => {
    if (is3d && !valid3dPieceSets.includes(pieceSet)) {
      return "Staunton";
    }
    return pieceSet;
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <link
        rel="stylesheet"
        href={`/pieces${is3d ? "-3d" : ""}/${getPieceSet(pieceSet, is3d)}.css`}
      />

      <MantineProvider
        cssVariablesResolver={v8CssVariablesResolver}
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="dark"
        theme={theme}
      >
        <ContextMenuProvider>
          <Notifications pauseResetOnHover="notification" />
          <RouterProvider router={router} />
        </ContextMenuProvider>
      </MantineProvider>
    </DndProvider>
  );
}
