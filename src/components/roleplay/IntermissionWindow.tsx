import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import LocalMedia from "@/components/common/LocalMedia";
import { playTick } from "@/utils/sound";
import type { GameSide, IntermissionEndReason } from "@/utils/playerProfile";
import {
  emitIntermissionEnded,
  INTERMISSION_UPDATE_EVENT,
  type IntermissionPayload,
} from "./intermissionWindow";
import classes from "./IntermissionWindow.module.css";

type SideState = {
  ended: boolean;
  remaining: number;
  mediaFailed: boolean;
};

function SidePanel({
  payload,
  side,
  state,
  onEnd,
  onMediaError,
}: {
  payload: IntermissionPayload;
  side: GameSide;
  state: SideState;
  onEnd: (side: GameSide, reason: IntermissionEndReason) => void;
  onMediaError: (side: GameSide) => void;
}) {
  const { t } = useTranslation();
  const sidePayload = payload.sides[side];
  const label = side === "white" ? t("Roleplay.White") : t("Roleplay.Black");

  if (!payload.show[side]) {
    return null;
  }

  if (state.ended) {
    return (
      <Box className={classes.half}>
        <Center className={classes.waiting}>
          <Stack align="center" gap={6}>
            <Badge size="lg" color={side === "white" ? "gray" : "dark"}>
              {label}
            </Badge>
            <Text fw={700} fz="xl" c="white">
              {sidePayload.profileName}
            </Text>
            <Text c="gray.4">{t("Roleplay.WaitingForOther")}</Text>
          </Stack>
        </Center>
      </Box>
    );
  }

  const progress = Math.max(
    0,
    Math.min(100, (state.remaining / Math.max(1, sidePayload.durationMs)) * 100),
  );
  const showMedia = !!sidePayload.image && !state.mediaFailed;

  return (
    <Box className={classes.half}>
      {showMedia ? (
        <LocalMedia
          key={`${payload.id}-${side}`}
          src={sidePayload.image}
          alt={sidePayload.profileName}
          className={classes.media}
          videoProps={{ autoPlay: true, loop: true, muted: true, playsInline: true }}
          onError={() => onMediaError(side)}
        />
      ) : (
        <Box className={classes.mediaFallback} />
      )}
      <Box className={classes.scrim} />
      <Box className={classes.content}>
        <Group justify="space-between" align="flex-start">
          <Badge size="lg" color={side === "white" ? "gray" : "dark"}>
            {label}
          </Badge>
          <Badge size="lg" variant="light" color="gray">
            ×{sidePayload.severity}
          </Badge>
        </Group>

        <Stack gap={6} mt="auto">
          <Title order={1} c="white" lineClamp={2} className={classes.title}>
            {sidePayload.profileName}
          </Title>

          {sidePayload.message && (
            <ScrollArea mah="26vh" type="auto">
              <Text c="white" fz="xl" className={classes.message}>
                {sidePayload.message}
              </Text>
            </ScrollArea>
          )}

          <Text c="gray.3" size="sm">
            {payload.kind === "capture" ? t("Roleplay.Capture") : t("Roleplay.Check")} ·{" "}
            {payload.san}
          </Text>

          {!showMedia && (
            <Text c="gray.5" size="xs" className={classes.folderHint}>
              {t("Roleplay.NoMedia")}
              {sidePayload.folder
                ? ` — ${sidePayload.folder}/images/${sidePayload.category ?? "..."}`
                : ""}
            </Text>
          )}

          <Progress value={progress} size="lg" mt="xs" />

          <Group justify="space-between">
            <Text c="gray.3" size="sm">
              {t("Roleplay.TimeLeft", { seconds: (state.remaining / 1000).toFixed(1) })}
            </Text>
            <Button variant="white" color="dark" size="xs" onClick={() => onEnd(side, "closed")}>
              {t("Roleplay.EndIntermission")}
            </Button>
          </Group>
        </Stack>
      </Box>
    </Box>
  );
}

type OverlayPhase = "intro" | "in" | "main" | "out";

export function IntermissionOverlay({
  payload,
  onEnded,
}: {
  payload: IntermissionPayload;
  onEnded: (side: GameSide, reason: IntermissionEndReason) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<OverlayPhase>("intro");
  const [ended, setEnded] = useState<{ white: boolean; black: boolean }>(() => ({
    white: !payload.show.white,
    black: !payload.show.black,
  }));
  const [remaining, setRemaining] = useState<{ white: number; black: number }>(() => ({
    white: payload.sides.white.durationMs,
    black: payload.sides.black.durationMs,
  }));
  const [mediaFailed, setMediaFailed] = useState<{ white: boolean; black: boolean }>({
    white: false,
    black: false,
  });

  const endedRef = useRef(ended);
  const remainingRef = useRef(remaining);
  const startedAtRef = useRef({ white: 0, black: 0 });
  // Frozen for the whole intermission: chosen once when the intermission starts.
  const pulseDurationRef = useRef(`${60 / Math.max(1, payload.pulseBpm)}s`);
  const reasonsRef = useRef<{ white: IntermissionEndReason; black: IntermissionEndReason }>({
    white: "closed",
    black: "closed",
  });
  const outTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1 s intro message, then 3 s fade-in before the main content.
  useEffect(() => {
    if (phase === "intro") {
      const timer = setTimeout(() => setPhase("in"), 1000);
      return () => clearTimeout(timer);
    }
    if (phase === "in") {
      const timer = setTimeout(() => {
        startedAtRef.current = { white: Date.now(), black: Date.now() };
        setPhase("main");
      }, 3000);
      return () => clearTimeout(timer);
    }
    return;
  }, [phase]);

  useEffect(() => {
    return () => {
      if (outTimerRef.current) {
        clearTimeout(outTimerRef.current);
      }
    };
  }, []);

  const endSide = useCallback(
    (side: GameSide, reason: IntermissionEndReason) => {
      if (!payload.show[side] || endedRef.current[side]) {
        return;
      }
      const nextEnded = { ...endedRef.current, [side]: true };
      endedRef.current = nextEnded;
      reasonsRef.current[side] = reason;
      setEnded(nextEnded);

      const shown = (["white", "black"] as const).filter((item) => payload.show[item]);
      if (shown.every((item) => nextEnded[item]) && !outTimerRef.current) {
        setPhase("out");
        outTimerRef.current = setTimeout(() => {
          outTimerRef.current = null;
          for (const item of shown) {
            onEnded(item, reasonsRef.current[item]);
          }
        }, 3000);
      }
    },
    [onEnded, payload],
  );

  useEffect(() => {
    if (phase !== "main") {
      return;
    }
    const interval = setInterval(() => {
      let changed = false;
      const nextRemaining = { ...remainingRef.current };
      for (const side of ["white", "black"] as const) {
        if (!payload.show[side] || endedRef.current[side]) {
          continue;
        }
        const duration = payload.sides[side].durationMs;
        const next = Math.max(0, duration - (Date.now() - startedAtRef.current[side]));
        if (next !== nextRemaining[side]) {
          nextRemaining[side] = next;
          changed = true;
        }
        if (next <= 0) {
          endSide(side, "timeout");
        }
      }
      if (changed) {
        remainingRef.current = nextRemaining;
        setRemaining(nextRemaining);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [phase, payload, endSide]);

  useEffect(() => {
    if (phase !== "main") {
      return;
    }

    // Use the app's normal audio pipeline (WebKit permits it, unlike a fresh
    // AudioContext in this window) and compensate drift with absolute times.
    const interval = parseFloat(pulseDurationRef.current) * 1000;
    let next = performance.now() + interval;
    let timer = window.setTimeout(function tick() {
      playTick();
      next += interval;
      timer = window.setTimeout(tick, Math.max(0, next - performance.now()));
    }, interval);

    return () => window.clearTimeout(timer);
  }, [phase, payload.pulseBpm]);

  const mediaError = useCallback((side: GameSide) => {
    setMediaFailed((previous) => ({ ...previous, [side]: true }));
  }, []);

  const rootStyle = {
    "--dot-duration": pulseDurationRef.current,
    zIndex: 1000,
    opacity: phase === "intro" || phase === "out" ? 0 : 1,
  } as CSSProperties;

  const closeAll = () => {
    for (const side of ["white", "black"] as const) {
      if (payload.show[side]) {
        endSide(side, "closed");
      }
    }
  };

  return (
    <>
      {phase === "intro" && (
        <Box className={classes.intro}>
          <Text className={classes.introText}>{payload.intro}</Text>
        </Box>
      )}
      <Box className={classes.root} style={rootStyle}>
        <ActionIcon className={classes.close} onClick={closeAll} aria-label={t("Common.Close")}>
          <IconX size="1.2rem" />
        </ActionIcon>
        <Box className={classes.halves}>
          <SidePanel
            payload={payload}
            side="white"
            state={{
              ended: ended.white,
              remaining: remaining.white,
              mediaFailed: mediaFailed.white,
            }}
            onEnd={endSide}
            onMediaError={mediaError}
          />
          <SidePanel
            payload={payload}
            side="black"
            state={{
              ended: ended.black,
              remaining: remaining.black,
              mediaFailed: mediaFailed.black,
            }}
            onEnd={endSide}
            onMediaError={mediaError}
          />
        </Box>
        <Box className={classes.dotWrap}>
          <Box className={classes.dot} />
        </Box>
      </Box>
    </>
  );
}

export default function IntermissionWindow({ payload }: { payload: IntermissionPayload | null }) {
  const { t } = useTranslation();
  const [currentPayload, setCurrentPayload] = useState<IntermissionPayload | null>(payload);
  const [ended, setEnded] = useState<{ white: boolean; black: boolean }>(() => ({
    white: !payload?.show.white,
    black: !payload?.show.black,
  }));
  const [remaining, setRemaining] = useState<{ white: number; black: number }>(() => ({
    white: payload?.sides.white.durationMs ?? 0,
    black: payload?.sides.black.durationMs ?? 0,
  }));
  const [mediaFailed, setMediaFailed] = useState<{ white: boolean; black: boolean }>({
    white: false,
    black: false,
  });

  const payloadRef = useRef<IntermissionPayload | null>(payload);
  const endedRef = useRef(ended);
  const remainingRef = useRef(remaining);
  const startedAtRef = useRef({ white: Date.now(), black: Date.now() });

  const applyPayload = useCallback((next: IntermissionPayload) => {
    const nextEnded = { white: !next.show.white, black: !next.show.black };
    const nextRemaining = {
      white: next.sides.white.durationMs,
      black: next.sides.black.durationMs,
    };
    payloadRef.current = next;
    endedRef.current = nextEnded;
    remainingRef.current = nextRemaining;
    startedAtRef.current = { white: Date.now(), black: Date.now() };
    setCurrentPayload(next);
    setEnded(nextEnded);
    setRemaining(nextRemaining);
    setMediaFailed({ white: false, black: false });
    document.title = next.title;
    void getCurrentWindow()
      .setTitle(next.title)
      .catch(() => undefined);
    void getCurrentWindow()
      .show()
      .catch(() => undefined);
  }, []);

  const endSide = useCallback(async (side: GameSide, reason: IntermissionEndReason) => {
    const activePayload = payloadRef.current;
    if (!activePayload || !activePayload.show[side] || endedRef.current[side]) {
      return;
    }
    const nextEnded = { ...endedRef.current, [side]: true };
    endedRef.current = nextEnded;
    setEnded(nextEnded);
    try {
      await emitIntermissionEnded({ id: activePayload.id, side, reason });
    } catch {
      // The main window may already be gone.
    }
    const shown = (["white", "black"] as const).filter((item) => activePayload.show[item]);
    if (shown.every((item) => nextEnded[item])) {
      await getCurrentWindow()
        .destroy()
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!currentPayload) {
      return;
    }
    const interval = setInterval(() => {
      let changed = false;
      const nextRemaining = { ...remainingRef.current };
      for (const side of ["white", "black"] as const) {
        if (!currentPayload.show[side] || endedRef.current[side]) {
          continue;
        }
        const duration = currentPayload.sides[side].durationMs;
        const next = Math.max(0, duration - (Date.now() - startedAtRef.current[side]));
        if (next !== nextRemaining[side]) {
          nextRemaining[side] = next;
          changed = true;
        }
        if (next <= 0) {
          endSide(side, "timeout");
        }
      }
      if (changed) {
        remainingRef.current = nextRemaining;
        setRemaining(nextRemaining);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [currentPayload, endSide]);

  useEffect(() => {
    const window = getCurrentWindow();
    let disposed = false;
    const unlisteners: (() => void)[] = [];

    const register = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      });
    };

    register(
      window.onCloseRequested(async (event) => {
        const activePayload = payloadRef.current;
        if (!activePayload) {
          return;
        }
        const shown = (["white", "black"] as const).filter((side) => activePayload.show[side]);
        if (shown.every((side) => endedRef.current[side])) {
          return;
        }
        event.preventDefault();
        for (const side of shown) {
          endSide(side, "closed");
        }
      }),
    );

    register(
      window.onResized(async () => {
        if (!(await window.isMinimized())) {
          return;
        }
        const activePayload = payloadRef.current;
        if (!activePayload) {
          return;
        }
        for (const side of ["white", "black"] as const) {
          if (activePayload.show[side]) {
            endSide(side, "minimized");
          }
        }
        await window.destroy().catch(() => undefined);
      }),
    );

    register(
      listen<IntermissionPayload>(INTERMISSION_UPDATE_EVENT, (event) => {
        if (event.payload) {
          applyPayload(event.payload);
        }
      }),
    );

    void window.show();

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [applyPayload, endSide]);

  const mediaError = useCallback((side: GameSide) => {
    setMediaFailed((previous) => ({ ...previous, [side]: true }));
  }, []);

  useEffect(() => {
    if (payload) {
      return;
    }
    // The payload is gone (reload, storage issue, ...). Tell the main window so
    // it can resume the clock instead of staying paused until the watchdog.
    const label = getCurrentWindow().label;
    const id = label.startsWith("intermission-") ? label.slice("intermission-".length) : label;
    void emitIntermissionEnded({ id, side: "white", reason: "failed" }).catch(() => undefined);
    void emitIntermissionEnded({ id, side: "black", reason: "failed" }).catch(() => undefined);
  }, [payload]);

  if (!currentPayload) {
    return (
      <Center h="100vh">
        <Stack align="center">
          <Text>{t("Roleplay.NoPayload")}</Text>
          <Button onClick={() => void getCurrentWindow().destroy()}>{t("Common.Close")}</Button>
        </Stack>
      </Center>
    );
  }

  const pulseStyle = {
    "--pulse-duration": `${60 / Math.max(1, currentPayload.pulseBpm)}s`,
  } as CSSProperties;

  const closeAll = () => {
    for (const side of ["white", "black"] as const) {
      if (currentPayload.show[side]) {
        endSide(side, "closed");
      }
    }
  };

  return (
    <Box className={classes.root} style={pulseStyle}>
      <ActionIcon className={classes.close} onClick={closeAll} aria-label={t("Common.Close")}>
        <IconX size="1.2rem" />
      </ActionIcon>
      <Box className={classes.halves}>
        <SidePanel
          payload={currentPayload}
          side="white"
          state={{
            ended: ended.white,
            remaining: remaining.white,
            mediaFailed: mediaFailed.white,
          }}
          onEnd={endSide}
          onMediaError={mediaError}
        />
        <SidePanel
          payload={currentPayload}
          side="black"
          state={{
            ended: ended.black,
            remaining: remaining.black,
            mediaFailed: mediaFailed.black,
          }}
          onEnd={endSide}
          onMediaError={mediaError}
        />
      </Box>
    </Box>
  );
}
