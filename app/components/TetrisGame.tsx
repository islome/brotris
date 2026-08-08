"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CLEAR_DURATION_MS,
  COLS,
  ROWS,
  COLORS,
  SHAPES,
  dropInterval,
  gameReducer,
  getDropY,
  initialState,
  type GameAction,
  type GameStatus,
  type TetrominoType,
} from "../lib/tetris";
import { sound } from "../lib/sound";
import {
  applyTheme,
  readSettings,
  serverSettings,
  subscribeSettings,
  writeSettings,
} from "../lib/settings";
import SettingsPanel from "./SettingsPanel";

const MUTED_KEY = "tetra-muted";
const MUTED_EVENT = "tetra-muted-change";

function subscribeMuted(onChange: () => void) {
  window.addEventListener(MUTED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MUTED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readMuted() {
  return localStorage.getItem(MUTED_KEY) === "1";
}

function toggleMuted() {
  localStorage.setItem(MUTED_KEY, readMuted() ? "0" : "1");
  window.dispatchEvent(new Event(MUTED_EVENT));
}

const BEST_KEY = "tetra-best";
const BEST_EVENT = "tetra-best-change";

function subscribeBest(onChange: () => void) {
  window.addEventListener(BEST_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BEST_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readBest() {
  const value = Number(localStorage.getItem(BEST_KEY));
  return Number.isFinite(value) ? value : 0;
}

function writeBest(score: number) {
  localStorage.setItem(BEST_KEY, String(score));
  window.dispatchEvent(new Event(BEST_EVENT));
}

// A fresh run always picks up the stored best and starting level.
function startAction(): GameAction {
  return { type: "START", best: readBest(), level: readSettings().startLevel };
}

// Unsupported on iOS Safari, where this is simply a no-op.
function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

export default function TetrisGame() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { status, board, active, queue, score, lines, level, clearing } = state;
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false);
  const best = useSyncExternalStore(subscribeBest, readBest, () => 0);
  const settings = useSyncExternalStore(
    subscribeSettings,
    readSettings,
    serverSettings
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Gravity loop
  useEffect(() => {
    if (status !== "playing") return;
    const id = setInterval(() => dispatch({ type: "TICK" }), dropInterval(level));
    return () => clearInterval(id);
  }, [status, level]);

  // Line-clear: let the flash animation play, then collapse the rows
  useEffect(() => {
    if (clearing.length === 0) return;
    const id = setTimeout(
      () => dispatch({ type: "CLEAR_COMPLETE" }),
      CLEAR_DURATION_MS
    );
    return () => clearTimeout(id);
  }, [clearing]);

  // Sound: keep the engine in sync with the persisted mute preference
  useEffect(() => {
    sound.setMuted(muted);
  }, [muted]);

  // Settings: theme override and per-bus volumes
  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    sound.setSfxVolume(settings.sfxVolume);
  }, [settings.sfxVolume]);

  useEffect(() => {
    sound.setMusicVolume(settings.musicVolume);
  }, [settings.musicVolume]);

  // Sound: game events (wood knock on lock, fire on clear, sweep on game over)
  const lastFxSeq = useRef(0);
  useEffect(() => {
    const { seq, kind } = state.fx;
    if (!kind || seq === lastFxSeq.current) return;
    lastFxSeq.current = seq;
    if (kind === "hold") {
      sound.playHold();
      if (settings.vibration) vibrate(8);
    } else if (kind === "lock") {
      sound.playLock();
      if (settings.vibration) vibrate(12);
    } else if (kind === "clear") {
      sound.playClear(Math.max(1, clearing.length));
      if (settings.vibration) vibrate([0, 22, 40, 22]);
    } else if (kind === "record") {
      sound.playRecord();
      if (settings.vibration) vibrate([0, 40, 70, 40, 70, 90]);
    } else {
      sound.playOver();
      if (settings.vibration) vibrate(120);
    }
  }, [state.fx, clearing.length, settings.vibration]);

  // Persist the new high score once the run ends above the old one
  useEffect(() => {
    if (status === "over" && state.newRecord) writeBest(score);
  }, [status, state.newRecord, score]);

  // Sound: chill background loop while playing
  useEffect(() => {
    if (status === "playing") sound.startMusic();
    else sound.stopMusic();
  }, [status]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (settingsOpen) {
        if (e.code === "Escape") setSettingsOpen(false);
        return;
      }
      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          dispatch({ type: "MOVE", dir: -1 });
          break;
        case "ArrowRight":
          e.preventDefault();
          dispatch({ type: "MOVE", dir: 1 });
          break;
        case "ArrowDown":
          e.preventDefault();
          dispatch({ type: "SOFT_DROP" });
          break;
        case "ArrowUp":
        case "KeyX":
          e.preventDefault();
          if (!e.repeat) dispatch({ type: "ROTATE" });
          break;
        case "Space":
          e.preventDefault();
          if (e.repeat) break;
          if (status === "playing") dispatch({ type: "HARD_DROP" });
          else if (status === "paused") dispatch({ type: "TOGGLE_PAUSE" });
          else dispatch(startAction());
          break;
        case "KeyC":
        case "ShiftLeft":
        case "ShiftRight":
          e.preventDefault();
          if (!e.repeat && readSettings().hold) dispatch({ type: "HOLD" });
          break;
        case "KeyP":
          if (!e.repeat) dispatch({ type: "TOGGLE_PAUSE" });
          break;
        case "Enter":
          if (!e.repeat && (status === "idle" || status === "over")) {
            dispatch(startAction());
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, settingsOpen]);

  // Locked board + ghost + active piece merged into one display grid
  const display = useMemo(() => {
    const grid = board.map((row) =>
      row.map((c) => ({ fill: c, ghost: null as TetrominoType | null }))
    );
    if (active && (status === "playing" || status === "paused")) {
      const shape = SHAPES[active.type][active.rotation];
      if (settings.ghost) {
        const ghostY = getDropY(board, active);
        for (let y = 0; y < shape.length; y++) {
          for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            const bx = active.x + x;
            const gy = ghostY + y;
            if (gy >= 0 && gy < ROWS && bx >= 0 && bx < COLS) {
              grid[gy][bx].ghost = active.type;
            }
          }
        }
      }
      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (!shape[y][x]) continue;
          const bx = active.x + x;
          const by = active.y + y;
          if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) {
            grid[by][bx] = { fill: active.type, ghost: null };
          }
        }
      }
    }
    return grid;
  }, [board, active, status, settings.ghost]);

  const primaryAction = () =>
    dispatch(status === "paused" ? { type: "TOGGLE_PAUSE" } : startAction());

  // Opening settings pauses the run; closing leaves it paused so the player
  // resumes deliberately instead of being dropped back mid-fall.
  const openSettings = () => {
    if (status === "playing") dispatch({ type: "TOGGLE_PAUSE" });
    setSettingsOpen(true);
  };

  // Touch gestures (mobile): drag = move, slow drag down = soft drop,
  // fast downward flick = hard drop, tap = rotate. The board has
  // `touch-none`, so the browser never scrolls/zooms from these touches.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    t0: number;
    pitch: number; // px per board column
    movedCols: number;
    droppedRows: number;
  } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (status !== "playing" || e.touches.length > 1) {
      gestureRef.current = null;
      return;
    }
    const t = e.touches[0];
    gestureRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      t0: performance.now(),
      pitch: (gridRef.current?.clientWidth ?? 320) / COLS,
      movedCols: 0,
      droppedRows: 0,
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gestureRef.current;
    if (!g || status !== "playing") return;
    const t = e.touches[0];
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    // round: the piece snaps to the nearest column after half a cell of drag
    const targetCols = Math.round(dx / g.pitch);
    while (g.movedCols < targetCols) {
      dispatch({ type: "MOVE", dir: 1 });
      g.movedCols++;
    }
    while (g.movedCols > targetCols) {
      dispatch({ type: "MOVE", dir: -1 });
      g.movedCols--;
    }

    // Soft drop engages only on sustained drags so quick flicks stay hard drops
    if (performance.now() - g.t0 > 150) {
      const targetRows = Math.trunc(dy / g.pitch);
      while (g.droppedRows < targetRows) {
        dispatch({ type: "SOFT_DROP" });
        g.droppedRows++;
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || status !== "playing") return;
    const t = e.changedTouches[0];
    const dt = Math.max(1, performance.now() - g.t0);
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    if (dy > 55 && dy > Math.abs(dx) * 1.4 && dy / dt > 0.55) {
      dispatch({ type: "HARD_DROP" });
      return;
    }
    // Mirror of the hard-drop flick. `movedCols === 0` keeps a sideways drag
    // that lifts off on an upward arc from stealing the piece.
    if (
      dy < -55 &&
      -dy > Math.abs(dx) * 1.4 &&
      -dy / dt > 0.55 &&
      g.movedCols === 0 &&
      readSettings().hold
    ) {
      dispatch({ type: "HOLD" });
      return;
    }
    if (
      Math.abs(dx) < 12 &&
      Math.abs(dy) < 12 &&
      dt < 300 &&
      g.movedCols === 0 &&
      g.droppedRows === 0
    ) {
      dispatch({ type: "ROTATE" });
    }
  };

  const onTouchCancel = () => {
    gestureRef.current = null;
  };

  return (
    <main className="relative flex min-h-svh select-none flex-col items-center justify-center gap-2 overflow-hidden p-2 sm:gap-4 sm:p-4">
      <Backdrop />

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:gap-3 [--cell:clamp(15px,min(calc((100svh_-_181px)/20),calc((100vw_-_57px)/10)),44px)] md:[--cell:clamp(17px,calc((100svh_-_160px)/20),36px)] xl:[--cell:clamp(18px,calc((100svh_-_185px)/20),40px)]">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold tracking-[0.4em] text-foreground/85">
              BROTRIS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                openSettings();
              }}
              aria-label="Sozlamalar"
              className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-foreground/10 bg-foreground/[0.05] text-foreground/80 transition hover:bg-foreground/[0.12] hover:text-foreground"
            >
              <GearIcon className="size-4" />
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                toggleMuted();
              }}
              aria-label={muted ? "Ovozni yoqish" : "Ovozni o'chirish"}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-foreground/10 bg-foreground/[0.05] text-foreground/80 transition hover:bg-foreground/[0.12] hover:text-foreground"
            >
              {muted ? (
                <MutedIcon className="size-4" />
              ) : (
                <SoundIcon className="size-4" />
              )}
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.blur();
                dispatch(
                  status === "playing" || status === "paused"
                    ? { type: "TOGGLE_PAUSE" }
                    : startAction()
                );
              }}
              aria-label={status === "playing" ? "Pauza" : "Boshlash"}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-foreground/10 bg-foreground/[0.05] text-foreground/80 transition hover:bg-foreground/[0.12] hover:text-foreground"
            >
              {status === "playing" ? (
                <PauseIcon className="size-3.5" />
              ) : (
                <PlayIcon className="size-3.5 translate-x-[1px] pr-0.5" />
              )}
            </button>
          </div>
        </header>

        {/* Board hugs the grid; on phones it centres instead of stretching, so
            the panel never shows empty rails beside the playfield. */}
        <div className="flex items-start gap-4 max-sm:justify-center">
          {/* Board */}
          <div
            className="relative touch-none overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/[0.03] p-1.5 shadow-2xl shadow-foreground/10 backdrop-blur-xl xl:p-2"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
          >
            <div
              ref={gridRef}
              className="grid gap-[3px] xl:gap-1"
              style={{
                gridTemplateColumns: `repeat(${COLS}, var(--cell))`,
                gridAutoRows: "var(--cell)",
              }}
            >
              {display.flatMap((row, y) =>
                row.map((cell, x) => {
                  const key = `${y}-${x}`;
                  if (cell.fill) {
                    const c = COLORS[cell.fill];
                    const flashing = clearing.includes(y);
                    return (
                      <div
                        key={key}
                        className={`rounded-[5px] xl:rounded-md ${flashing ? "animate-line-clear" : ""}`}
                        style={{
                          background: `linear-gradient(160deg, ${c.base}, ${c.base}b0)`,
                          boxShadow: `0 0 12px ${c.glow}, inset 0 1px 1px rgba(255,255,255,0.35)`,
                        }}
                      />
                    );
                  }
                  if (cell.ghost) {
                    const c = COLORS[cell.ghost];
                    return (
                      <div
                        key={key}
                        className="rounded-[5px] xl:rounded-md"
                        style={{ boxShadow: `inset 0 0 0 1.5px ${c.base}55` }}
                      />
                    );
                  }
                  return (
                    <div
                      key={key}
                      className="rounded-[5px] bg-foreground/[0.05] xl:rounded-md"
                    />
                  );
                })
              )}
            </div>

            {status !== "playing" && (
              <Overlay
                status={status}
                score={score}
                best={best}
                newRecord={state.newRecord}
                hold={settings.hold}
                gesturesSeen={settings.gesturesSeen}
                onPrimary={primaryAction}
              />
            )}

            {settingsOpen && (
              <SettingsPanel
                settings={settings}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>

          {/* Sidebar */}
          <aside className="hidden w-36 flex-col gap-3 sm:flex xl:w-44">
            {settings.hold && (
              <Panel label="Hold">
                <div
                  className={`transition-opacity ${state.holdUsed ? "opacity-25" : ""}`}
                >
                  <NextPreview type={state.hold} />
                </div>
              </Panel>
            )}
            <Panel label="Next">
              <NextPreview type={queue[0] ?? null} />
              {settings.nextCount > 1 && queue.length > 1 && (
                <div className="mt-2 flex flex-col gap-2 border-t border-foreground/[0.08] pt-2">
                  {queue.slice(1, settings.nextCount).map((type, i) => (
                    <QueuePreview key={i} type={type} />
                  ))}
                </div>
              )}
            </Panel>
            <Panel label="Score">{score.toLocaleString("en-US")}</Panel>
            <Panel label="Best">{best.toLocaleString("en-US")}</Panel>
            <Panel label="Lines">{lines}</Panel>
            <Panel label="Level">{level}</Panel>
            <Hints hold={settings.hold} />
          </aside>
        </div>

        {/* Compact stats for mobile */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-xs text-foreground/50 sm:hidden">
          {settings.hold && (
            <span className="flex items-center gap-1.5">
              HOLD
              {state.hold ? (
                <span
                  className={`transition-opacity ${state.holdUsed ? "opacity-25" : ""}`}
                >
                  <QueuePreview type={state.hold} size={7} dim={false} />
                </span>
              ) : (
                <span className="text-foreground/30">—</span>
              )}
            </span>
          )}
          <span>SCORE {score}</span>
          <span>BEST {best}</span>
          <span>LINES {lines}</span>
          <span>LVL {level}</span>
        </div>
      </div>
    </main>
  );
}

function Overlay({
  status,
  score,
  best,
  newRecord,
  hold,
  gesturesSeen,
  onPrimary,
}: {
  status: GameStatus;
  score: number;
  best: number;
  newRecord: boolean;
  hold: boolean;
  gesturesSeen: boolean;
  onPrimary: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-background/70 backdrop-blur-md">
      {status === "over" && newRecord && <Confetti />}
      {status === "over" ? (
        <div className="relative text-center">
          {newRecord ? (
            <p className="animate-pulse text-[11px] font-semibold uppercase tracking-[0.4em] text-foreground">
              Yangi rekord
            </p>
          ) : (
            <p className="text-[11px] font-medium uppercase tracking-[0.4em] text-foreground/60">
              O&apos;yin tugadi
            </p>
          )}
          <p className="mt-2 font-mono text-4xl font-bold tabular-nums text-foreground">
            {score.toLocaleString("en-US")}
          </p>
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.25em] text-foreground/40">
            Rekord — {best.toLocaleString("en-US")}
          </p>
        </div>
      ) : status === "paused" ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.4em] text-foreground/60">
          Pauza
        </p>
      ) : (
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-[0.35em] text-foreground xl:text-5xl">
            PLAY
          </h1>
        </div>
      )}

      <button
        onClick={(e) => {
          e.currentTarget.blur();
          onPrimary();
        }}
        aria-label={status === "paused" ? "Davom etish" : "Boshlash"}
        className="flex size-16 cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-xl shadow-foreground/20 transition hover:scale-105 active:scale-95 xl:size-20"
      >
        <PlayIcon className="size-8 pr-1 translate-x-[2px] xl:size-7" />
      </button>

      <p className="hidden text-[10px] uppercase tracking-[0.25em] text-foreground/40 sm:block">
        {status === "paused"
          ? "Davom etish — Space"
          : status === "over"
            ? "Qayta boshlash — Space"
            : "Boshlash — Space"}
      </p>
      {status === "idle" ? (
        gesturesSeen ? null : <GestureGuide hold={hold} />
      ) : (
        <p className="px-6 text-center text-[10px] uppercase leading-5 tracking-[0.2em] text-foreground/40 sm:hidden">
          {status === "paused"
            ? "Davom etish uchun tugmani bosing"
            : "Qayta o'ynash uchun tugmani bosing"}
        </p>
      )}
    </div>
  );
}

// Shown at every size: touch works on tablets and touchscreen laptops, and the
// keyboard hints live in the sidebar. Dismissing it persists until a settings reset.
function GestureGuide({ hold }: { hold: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <GestureDemo kind="move" label="Harakat" />
        <GestureDemo kind="tap" label="Burish" />
        <GestureDemo kind="down" label="Tashlash" />
        {hold && <GestureDemo kind="up" label="Saqlash" />}
      </div>
      <button
        onClick={() => writeSettings({ gesturesSeen: true })}
        className="cursor-pointer rounded-full border border-foreground/15 bg-foreground/[0.05] px-6 py-2.5 text-[10px] font-medium uppercase tracking-[0.25em] text-foreground/60 transition hover:bg-foreground/[0.12] hover:text-foreground active:scale-95"
      >
        Tushunarli
      </button>
    </div>
  );
}

const GESTURE_EMOJI = {
  move: "👉🏼",
  tap: "👆🏼",
  down: "👇🏼",
  up: "👆🏼",
} as const;

function GestureDemo({
  kind,
  label,
}: {
  kind: "move" | "tap" | "down" | "up";
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative flex h-16 w-20 items-center justify-center">
        <GestureTrack kind={kind} />
        {kind === "tap" && (
          <span className="gesture-ripple absolute top-2.5 size-5 rounded-full border border-foreground/60" />
        )}
        <span
          aria-hidden
          className={`gesture-hand gesture-hand-${kind} relative select-none text-[34px] leading-none`}
        >
          {GESTURE_EMOJI[kind]}
        </span>
      </div>
      <span className="text-[9px] uppercase tracking-[0.2em] text-foreground/40">
        {label}
      </span>
    </div>
  );
}

// Faint arrow behind the hand so the direction reads before the motion does.
function GestureTrack({ kind }: { kind: "move" | "tap" | "down" | "up" }) {
  if (kind === "tap") return null;
  const horizontal = kind === "move";
  return (
    <svg
      viewBox="0 0 64 64"
      className="absolute inset-0 size-full text-foreground/15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {horizontal ? (
        <>
          <path d="M14 32h36" />
          <path d="M18 27l-5 5 5 5M46 27l5 5-5 5" />
        </>
      ) : kind === "down" ? (
        <>
          <path d="M32 14v36" />
          <path d="M27 45l5 5 5-5" />
        </>
      ) : (
        <>
          <path d="M32 50V14" />
          <path d="M27 19l5-5 5 5" />
        </>
      )}
    </svg>
  );
}

const CONFETTI_COLORS = Object.values(COLORS).map((c) => c.base);

// Randomized once at module load: render must stay pure (react-hooks/purity),
// and a fixed layout is imperceptible across 46 looping pieces.
const CONFETTI_PIECES = Array.from({ length: 46 }, (_, i) => ({
  left: Math.random() * 100,
  size: 6 + Math.random() * 5,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  delay: Math.random() * 2.4,
  duration: 2.6 + Math.random() * 1.8,
  drift: -70 + Math.random() * 140,
  spin: 360 + Math.random() * 540,
}));

function Confetti() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {CONFETTI_PIECES.map((p, i) => (
        <span
          key={i}
          className="confetti-piece absolute rounded-[2px]"
          style={
            {
              left: `${p.left}%`,
              top: -18,
              width: p.size,
              height: p.size,
              background: p.color,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-4 py-3 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-foreground/40">
        {label}
      </p>
      <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground/90">
        {children}
      </div>
    </div>
  );
}

function shapeBounds(type: TetrominoType) {
  const shape = SHAPES[type][0];
  const coords: Array<[number, number]> = [];
  shape.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v) coords.push([x, y]);
    })
  );
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    shape,
    minX,
    minY,
    w: Math.max(...xs) - minX + 1,
    h: Math.max(...ys) - minY + 1,
  };
}

function NextPreview({ type }: { type: TetrominoType | null }) {
  if (!type) {
    return <div className="flex h-11 items-center text-foreground/30">—</div>;
  }
  const { shape, minX, minY, w, h } = shapeBounds(type);
  const c = COLORS[type];

  return (
    <div className="flex h-11 items-center">
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${w}, 13px)`, gridAutoRows: "13px" }}
      >
        {Array.from({ length: w * h }, (_, i) => {
          const filled = shape[Math.floor(i / w) + minY][(i % w) + minX] === 1;
          return (
            <div
              key={i}
              className="rounded-[3px]"
              style={
                filled
                  ? { background: c.base, boxShadow: `0 0 8px ${c.glow}` }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// Lookahead beyond the immediate next piece: same shapes, quieter.
// Defaults render the sidebar queue; the mobile hold chip overrides both.
function QueuePreview({
  type,
  size = 9,
  dim = true,
}: {
  type: TetrominoType;
  size?: number;
  dim?: boolean;
}) {
  const { shape, minX, minY, w, h } = shapeBounds(type);
  const c = COLORS[type];

  return (
    <div className={`flex items-center ${dim ? "opacity-55" : ""}`}>
      <div
        className="grid gap-[2px]"
        style={{
          gridTemplateColumns: `repeat(${w}, ${size}px)`,
          gridAutoRows: `${size}px`,
        }}
      >
        {Array.from({ length: w * h }, (_, i) => {
          const filled = shape[Math.floor(i / w) + minY][(i % w) + minX] === 1;
          return (
            <div
              key={i}
              className="rounded-[2px]"
              style={filled ? { background: c.base } : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function Hints({ hold }: { hold: boolean }) {
  const rows: Array<[string, string]> = [
    ["← →", "harakat"],
    ["↑", "burish"],
    ["↓", "tez tushish"],
    ["Space", "tashlash"],
    ...(hold ? [["C", "saqlash"] as [string, string]] : []),
    ["P", "pauza"],
  ];
  // The hint card is onboarding, not gameplay data, so it is the first thing to
  // go when a short laptop viewport cannot fit the whole sidebar.
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-foreground/[0.07] bg-foreground/[0.02] px-4 py-3 backdrop-blur-xl [@media(max-height:840px)]:hidden">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between">
          <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-foreground/15 bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-foreground/70">
            {k}
          </kbd>
          <span className="text-[11px] text-foreground/45">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Backdrop() {
  return (
    <div
      aria-hidden
      className="bg-grid pointer-events-none absolute inset-0 -z-10"
    />
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M12 2.6l1.5 2.3 2.7-.5.6 2.7 2.5 1.1-1.1 2.5 1.8 2.1-2.2 1.7.3 2.7-2.8.3-1.4 2.4L12 19.4l-1.9 1.2-1.4-2.4-2.8-.3.3-2.7-2.2-1.7 1.8-2.1L4.7 8.9l2.5-1.1.6-2.7 2.7.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SoundIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M4 9.2v5.6h3.4L12.4 19V5L7.4 9.2H4z" fill="currentColor" />
      <path
        d="M15.5 9a4.4 4.4 0 0 1 0 6M17.8 7a7.4 7.4 0 0 1 0 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MutedIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M4 9.2v5.6h3.4L12.4 19V5L7.4 9.2H4z" fill="currentColor" />
      <path
        d="M15.6 9.8l4.6 4.6M20.2 9.8l-4.6 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
