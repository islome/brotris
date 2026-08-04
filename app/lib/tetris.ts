// Pure game logic for TETRA — no React imports, fully testable.

export const COLS = 10;
export const ROWS = 20;

export type TetrominoType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export type Cell = TetrominoType | null;
export type Board = Cell[][];

export type GameStatus = "idle" | "playing" | "paused" | "over";

export interface ActivePiece {
  type: TetrominoType;
  rotation: number; // 0..3
  x: number; // board column of the shape matrix's left edge
  y: number; // board row of the shape matrix's top edge (may be negative at spawn)
}

export type FxKind = "lock" | "clear" | "over" | "record" | null;

export interface GameState {
  board: Board;
  active: ActivePiece | null;
  queue: TetrominoType[]; // queue[0] is the next piece (shown in preview)
  status: GameStatus;
  score: number;
  lines: number;
  level: number;
  clearing: number[]; // row indices mid flash-animation; empty when none
  fx: { seq: number; kind: FxKind }; // sound-effect event; seq bumps on each new event
  bestAtStart: number; // high score when this run began (from localStorage)
  newRecord: boolean; // set when the run ends above bestAtStart
  startLevel: number; // level this run began on; levels climb from here
}

export type GameAction =
  | { type: "START"; best?: number; level?: number }
  | { type: "TOGGLE_PAUSE" }
  | { type: "TICK" }
  | { type: "MOVE"; dir: -1 | 1 }
  | { type: "ROTATE" }
  | { type: "SOFT_DROP" }
  | { type: "HARD_DROP" }
  | { type: "CLEAR_COMPLETE" };

export const ALL_TYPES: TetrominoType[] = ["I", "O", "T", "S", "Z", "J", "L"];

const BASE_SHAPES: Record<TetrominoType, number[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

function rotateCW(m: number[][]): number[][] {
  const n = m.length;
  const out = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[x][n - 1 - y] = m[y][x];
    }
  }
  return out;
}

// Precomputed rotations: SHAPES[type][rotation] -> matrix
export const SHAPES: Record<TetrominoType, number[][][]> = Object.fromEntries(
  ALL_TYPES.map((t) => {
    const rots = [BASE_SHAPES[t]];
    for (let i = 1; i < 4; i++) rots.push(rotateCW(rots[i - 1]));
    return [t, rots];
  })
) as Record<TetrominoType, number[][][]>;

export const COLORS: Record<TetrominoType, { base: string; glow: string }> = {
  I: { base: "#22d3ee", glow: "rgba(34, 211, 238, 0.4)" },
  O: { base: "#fbbf24", glow: "rgba(251, 191, 36, 0.4)" },
  T: { base: "#a78bfa", glow: "rgba(167, 139, 250, 0.4)" },
  S: { base: "#34d399", glow: "rgba(52, 211, 153, 0.4)" },
  Z: { base: "#fb7185", glow: "rgba(251, 113, 133, 0.4)" },
  J: { base: "#60a5fa", glow: "rgba(96, 165, 250, 0.4)" },
  L: { base: "#fb923c", glow: "rgba(251, 146, 60, 0.4)" },
};

export function createBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

export function collides(board: Board, p: ActivePiece): boolean {
  const shape = SHAPES[p.type][p.rotation];
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue;
      const bx = p.x + x;
      const by = p.y + y;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && board[by][bx]) return true;
    }
  }
  return false;
}

export function getDropY(board: Board, p: ActivePiece): number {
  let y = p.y;
  while (!collides(board, { ...p, y: y + 1 })) y++;
  return y;
}

export function dropInterval(level: number): number {
  return Math.max(70, Math.round(800 * Math.pow(0.82, level - 1)));
}

// Keep slightly longer than the CSS `line-clear` animation (280ms).
export const CLEAR_DURATION_MS = 300;

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 7-bag randomizer: every 7 consecutive pieces contain each tetromino once.
// Buffers a full bag ahead so the queue can always feed a 5-piece preview.
function refillQueue(queue: TetrominoType[]): TetrominoType[] {
  const q = [...queue];
  while (q.length < 7) q.push(...shuffle(ALL_TYPES));
  return q;
}

function spawnPiece(type: TetrominoType): ActivePiece {
  const width = SHAPES[type][0][0].length;
  return {
    type,
    rotation: 0,
    x: Math.floor((COLS - width) / 2),
    y: type === "I" ? -1 : 0,
  };
}

const LINE_SCORES = [0, 100, 300, 500, 800];

function bumpFx(state: GameState, kind: FxKind): GameState["fx"] {
  return { seq: state.fx.seq + 1, kind };
}

function gameOver(state: GameState, patch: Partial<GameState>): GameState {
  const newRecord = state.score > state.bestAtStart && state.score > 0;
  return {
    ...state,
    ...patch,
    status: "over",
    newRecord,
    fx: bumpFx(state, newRecord ? "record" : "over"),
  };
}

function spawnNext(state: GameState): GameState {
  const [nextType, ...rest] = state.queue;
  const queue = refillQueue(rest);
  const active = spawnPiece(nextType);
  if (collides(state.board, active)) {
    return gameOver(state, { active: null, queue });
  }
  return { ...state, active, queue };
}

function lockPiece(state: GameState): GameState {
  const p = state.active;
  if (!p) return state;
  const shape = SHAPES[p.type][p.rotation];
  const board = state.board.map((row) => [...row]);
  let topOut = false;
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue;
      const by = p.y + y;
      const bx = p.x + x;
      if (by < 0) {
        topOut = true;
        continue;
      }
      board[by][bx] = p.type;
    }
  }
  if (topOut) {
    return gameOver(state, { board, active: null });
  }

  // Full rows stay on the board while the flash animation plays;
  // CLEAR_COMPLETE collapses them and spawns the next piece.
  const fullRows: number[] = [];
  board.forEach((row, y) => {
    if (row.every((c) => c !== null)) fullRows.push(y);
  });
  if (fullRows.length > 0) {
    return { ...state, board, active: null, clearing: fullRows, fx: bumpFx(state, "clear") };
  }

  return spawnNext({ ...state, board, fx: bumpFx(state, "lock") });
}

function startGame(best: number, startLevel: number): GameState {
  const [first, ...rest] = refillQueue([]);
  return {
    board: createBoard(),
    active: spawnPiece(first),
    queue: refillQueue(rest),
    status: "playing",
    score: 0,
    lines: 0,
    level: startLevel,
    clearing: [],
    fx: { seq: 0, kind: null },
    bestAtStart: best,
    newRecord: false,
    startLevel,
  };
}

export const initialState: GameState = {
  board: createBoard(),
  active: null,
  queue: [],
  status: "idle",
  score: 0,
  lines: 0,
  level: 1,
  clearing: [],
  fx: { seq: 0, kind: null },
  bestAtStart: 0,
  newRecord: false,
  startLevel: 1,
};

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START": {
      if (state.status === "playing" || state.status === "paused") return state;
      return startGame(action.best ?? 0, action.level ?? 1);
    }
    case "TOGGLE_PAUSE": {
      if (state.status === "playing") return { ...state, status: "paused" };
      if (state.status === "paused") return { ...state, status: "playing" };
      return state;
    }
    case "TICK": {
      if (state.status !== "playing" || !state.active) return state;
      const moved = { ...state.active, y: state.active.y + 1 };
      if (!collides(state.board, moved)) return { ...state, active: moved };
      return lockPiece(state);
    }
    case "MOVE": {
      if (state.status !== "playing" || !state.active) return state;
      const moved = { ...state.active, x: state.active.x + action.dir };
      if (collides(state.board, moved)) return state;
      return { ...state, active: moved };
    }
    case "ROTATE": {
      if (state.status !== "playing" || !state.active) return state;
      const rotation = (state.active.rotation + 1) % 4;
      // Simple wall/floor kicks: horizontal shifts first, then one step up.
      for (const dy of [0, -1]) {
        for (const dx of [0, -1, 1, -2, 2]) {
          const cand = {
            ...state.active,
            rotation,
            x: state.active.x + dx,
            y: state.active.y + dy,
          };
          if (!collides(state.board, cand)) return { ...state, active: cand };
        }
      }
      return state;
    }
    case "SOFT_DROP": {
      if (state.status !== "playing" || !state.active) return state;
      const moved = { ...state.active, y: state.active.y + 1 };
      if (!collides(state.board, moved)) {
        return { ...state, active: moved, score: state.score + 1 };
      }
      return lockPiece(state);
    }
    case "HARD_DROP": {
      if (state.status !== "playing" || !state.active) return state;
      const dropY = getDropY(state.board, state.active);
      const dist = dropY - state.active.y;
      return lockPiece({
        ...state,
        active: { ...state.active, y: dropY },
        score: state.score + dist * 2,
      });
    }
    case "CLEAR_COMPLETE": {
      // Fires even while paused so the game never gets stuck without a piece.
      if (state.clearing.length === 0) return state;
      const cleared = state.clearing.length;
      const remaining = state.board.filter((_, y) => !state.clearing.includes(y));
      const board = [
        ...Array.from({ length: cleared }, () => Array<Cell>(COLS).fill(null)),
        ...remaining,
      ];
      const lines = state.lines + cleared;
      return spawnNext({
        ...state,
        board,
        clearing: [],
        lines,
        level: state.startLevel + Math.floor(lines / 10),
        score: state.score + LINE_SCORES[cleared] * state.level,
      });
    }
    default:
      return state;
  }
}
