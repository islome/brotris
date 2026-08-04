"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
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
  type GameStatus,
  type TetrominoType,
} from "../lib/tetris";
import { sound } from "../lib/sound";

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

export default function TetrisGame() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { status, board, active, queue, score, lines, level, clearing } = state;
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false);
  const best = useSyncExternalStore(subscribeBest, readBest, () => 0);

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

  // Sound: game events (wood knock on lock, fire on clear, sweep on game over)
  const lastFxSeq = useRef(0);
  useEffect(() => {
    const { seq, kind } = state.fx;
    if (!kind || seq === lastFxSeq.current) return;
    lastFxSeq.current = seq;
    if (kind === "lock") sound.playLock();
    else if (kind === "clear") sound.playClear(Math.max(1, clearing.length));
    else if (kind === "record") sound.playRecord();
    else sound.playOver();
  }, [state.fx, clearing.length]);

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
          else dispatch({ type: "START", best: readBest() });
          break;
        case "KeyP":
          if (!e.repeat) dispatch({ type: "TOGGLE_PAUSE" });
          break;
        case "Enter":
          if (!e.repeat && (status === "idle" || status === "over")) {
            dispatch({ type: "START", best: readBest() });
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  // Locked board + ghost + active piece merged into one display grid
  const display = useMemo(() => {
    const grid = board.map((row) =>
      row.map((c) => ({ fill: c, ghost: null as TetrominoType | null }))
    );
    if (active && (status === "playing" || status === "paused")) {
      const shape = SHAPES[active.type][active.rotation];
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
  }, [board, active, status]);

  const primaryAction = () =>
    dispatch(
      status === "paused"
        ? { type: "TOGGLE_PAUSE" }
        : { type: "START", best: readBest() }
    );

  return (
    <main className="relative flex min-h-svh select-none flex-col items-center justify-center gap-4 overflow-hidden p-4">
      <Backdrop />

      <div className="flex flex-col gap-3 [--cell:clamp(15px,3.2svh,28px)] md:[--cell:clamp(17px,calc((100svh_-_160px)/20),36px)] xl:[--cell:clamp(18px,calc((100svh_-_185px)/20),40px)]">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold tracking-[0.4em] text-foreground/85">
              BROTRIS
            </span>
            <span className="rounded-full border border-foreground/10 bg-foreground/[0.04] px-2 py-0.5 text-[9px] font-medium tracking-[0.2em] text-foreground/40">
              2026
            </span>
          </div>
          <div className="flex items-center gap-2">
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
                    : { type: "START", best: readBest() }
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

        <div className="flex items-start gap-4">
          {/* Board */}
          <div className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/[0.03] p-1.5 shadow-2xl shadow-foreground/10 backdrop-blur-xl xl:p-2">
            <div
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
                onPrimary={primaryAction}
              />
            )}
          </div>

          {/* Sidebar */}
          <aside className="hidden w-36 flex-col gap-3 sm:flex xl:w-44">
            <Panel label="Next">
              <NextPreview type={queue[0] ?? null} />
            </Panel>
            <Panel label="Score">{score.toLocaleString("en-US")}</Panel>
            <Panel label="Best">{best.toLocaleString("en-US")}</Panel>
            <Panel label="Lines">{lines}</Panel>
            <Panel label="Level">{level}</Panel>
            <Hints />
          </aside>
        </div>

        {/* Compact stats for mobile */}
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-xs text-foreground/50 sm:hidden">
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
  onPrimary,
}: {
  status: GameStatus;
  score: number;
  best: number;
  newRecord: boolean;
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
            TETRA
          </h1>
          <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-foreground/45">
            Minimalist blok o&apos;yini
          </p>
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

      <p className="text-[10px] uppercase tracking-[0.25em] text-foreground/40">
        {status === "paused"
          ? "Davom etish — Space"
          : status === "over"
            ? "Qayta boshlash — Space"
            : "Boshlash — Space"}
      </p>
    </div>
  );
}

const CONFETTI_COLORS = Object.values(COLORS).map((c) => c.base);

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => ({
        left: Math.random() * 100,
        size: 6 + Math.random() * 5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 2.4,
        duration: 2.6 + Math.random() * 1.8,
        drift: -70 + Math.random() * 140,
        spin: 360 + Math.random() * 540,
      })),
    []
  );
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {pieces.map((p, i) => (
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

function NextPreview({ type }: { type: TetrominoType | null }) {
  if (!type) {
    return <div className="flex h-11 items-center text-foreground/30">—</div>;
  }
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
  const w = Math.max(...xs) - minX + 1;
  const h = Math.max(...ys) - minY + 1;
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

function Hints() {
  const rows: Array<[string, string]> = [
    ["← →", "harakat"],
    ["↑", "burish"],
    ["↓", "tez tushish"],
    ["Space", "tashlash"],
    ["P", "pauza"],
  ];
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-foreground/[0.07] bg-foreground/[0.02] px-4 py-3 backdrop-blur-xl">
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
