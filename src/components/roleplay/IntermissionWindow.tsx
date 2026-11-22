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
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import LocalMedia from "@/components/common/LocalMedia";
import {
  BEAT_LEAD_MS,
  bpmToIntervalMs,
  createDeadlineTimer,
  remainingTenthsAt,
} from "@/utils/intermissionTiming";
import { prepareTick, startTickTicker } from "@/utils/sound";
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
            <Text c="gray.3" size="sm" className={classes.timer}>
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
  // One monotonic timeline for the whole main phase. The countdown, the CSS
  // pulse and the tick scheduler all derive their beat from this anchor.
  const timelineRef = useRef<{ id: string; startPerf: number; intervalMs: number } | null>(null);
  const lastTenthsRef = useRef({ white: -1, black: -1 });
  const deadlineCleanupRef = useRef<{
    white: (() => void) | null;
    black: (() => void) | null;
  }>({ white: null, black: null });
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
        const initial = {
          white: payload.sides.white.durationMs,
          black: payload.sides.black.durationMs,
        };
        remainingRef.current = initial;
        setRemaining(initial);
        setPhase("main");
      }, 3000);
      return () => clearTimeout(timer);
    }
    return;
  }, [phase, payload]);

  // Decode the tick during the intro/fade so the first beat is already ready.
  // This never gates the timeline: a failure just means silent/fallback ticks.
  useEffect(() => {
    void prepareTick();
  }, [payload.id]);

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
      deadlineCleanupRef.current[side]?.();
      deadlineCleanupRef.current[side] = null;
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

  const endSideRef = useRef(endSide);
  useEffect(() => {
    endSideRef.current = endSide;
  }, [endSide]);

  // Main-phase timeline: one anchor shared by the countdown, the pulse and the
  // tick scheduler. Deadlines are absolute, so dropped frames cannot extend an
  // intermission.
  useLayoutEffect(() => {
    if (phase !== "main") {
      return;
    }
    const startPerf = performance.now();
    const intervalMs = bpmToIntervalMs(payload.pulseBpm);
    timelineRef.current = { id: payload.id, startPerf, intervalMs };
    lastTenthsRef.current = {
      white: remainingTenthsAt(payload.sides.white.durationMs, 0),
      black: remainingTenthsAt(payload.sides.black.durationMs, 0),
    };

    remainingRef.current = {
      white: payload.sides.white.durationMs,
      black: payload.sides.black.durationMs,
    };

    const deadlineCleanups = deadlineCleanupRef.current;
    for (const side of ["white", "black"] as const) {
      if (!payload.show[side] || endedRef.current[side]) {
        continue;
      }
      deadlineCleanups[side]?.();
      deadlineCleanups[side] = createDeadlineTimer(startPerf + payload.sides[side].durationMs, () =>
        endSideRef.current(side, "timeout"),
      );
    }

    const stopTicker = startTickTicker({
      startPerfMs: startPerf,
      intervalMs,
      leadMs: BEAT_LEAD_MS,
    });

    return () => {
      stopTicker();
      for (const side of ["white", "black"] as const) {
        deadlineCleanups[side]?.();
        deadlineCleanups[side] = null;
      }
      timelineRef.current = null;
    };
  }, [phase, payload]);

  // Paint the countdown in tenths only, isolated from the media tree.
  useEffect(() => {
    if (phase !== "main") {
      return;
    }
    let frame = 0;
    const update = () => {
      const timeline = timelineRef.current;
      if (timeline && timeline.id === payload.id) {
        const elapsed = Math.max(0, performance.now() - timeline.startPerf);
        const next = { ...remainingRef.current };
        let changed = false;
        for (const side of ["white", "black"] as const) {
          if (!payload.show[side] || endedRef.current[side]) {
            continue;
          }
          const left = Math.max(0, payload.sides[side].durationMs - elapsed);
          const tenths = Math.ceil(left / 100);
          if (tenths !== lastTenthsRef.current[side]) {
            lastTenthsRef.current[side] = tenths;
            next[side] = left;
            changed = true;
          }
          if (left <= 0) {
            endSideRef.current(side, "timeout");
          }
        }
        if (changed) {
          remainingRef.current = next;
          setRemaining(next);
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [phase, payload]);

  // A throttled/hidden window can delay timers; re-check deadlines on return.
  useEffect(() => {
    if (phase !== "main") {
      return;
    }
    const checkDeadlines = () => {
      const timeline = timelineRef.current;
      if (!timeline) {
        return;
      }
      const elapsed = performance.now() - timeline.startPerf;
      for (const side of ["white", "black"] as const) {
        if (!payload.show[side] || endedRef.current[side]) {
          continue;
        }
        if (elapsed >= payload.sides[side].durationMs) {
          endSideRef.current(side, "timeout");
        }
      }
    };
    document.addEventListener("visibilitychange", checkDeadlines);
    window.addEventListener("focus", checkDeadlines);
    return () => {
      document.removeEventListener("visibilitychange", checkDeadlines);
      window.removeEventListener("focus", checkDeadlines);
    };
  }, [phase, payload]);

  const mediaError = useCallback((side: GameSide) => {
    setMediaFailed((previous) => ({ ...previous, [side]: true }));
  }, []);

  const rootStyle = {
    "--dot-duration": `${bpmToIntervalMs(payload.pulseBpm)}ms`,
    "--beat-lead": `${BEAT_LEAD_MS}ms`,
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
      <Box
        className={`${classes.root}${phase === "main" ? ` ${classes.pulsing}` : ""}`}
        style={rootStyle}
      >
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
    "--dot-duration": `${bpmToIntervalMs(currentPayload.pulseBpm)}ms`,
  } as CSSProperties;

  const closeAll = () => {
    for (const side of ["white", "black"] as const) {
      if (currentPayload.show[side]) {
        endSide(side, "closed");
      }
    }
  };

  return (
    <Box className={`${classes.root} ${classes.pulsing}`} style={pulseStyle}>
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
