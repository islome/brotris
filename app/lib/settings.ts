// Persisted user settings, shaped for useSyncExternalStore.
//
// readSettings() returns a *stable* reference until the stored value actually
// changes — re-parsing on every call would hand React a new object each render
// and loop forever.

export type Theme = "auto" | "light" | "dark";
export type NextCount = 1 | 3 | 5;

export interface Settings {
  theme: Theme;
  sfxVolume: number; // 0..1
  musicVolume: number; // 0..1
  startLevel: number; // 1..10
  ghost: boolean;
  vibration: boolean;
  nextCount: NextCount;
  hold: boolean;
}

// Defaults reproduce the pre-settings behaviour exactly.
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  theme: "auto",
  sfxVolume: 1,
  musicVolume: 1,
  startLevel: 1,
  ghost: true,
  vibration: true,
  nextCount: 1,
  hold: true,
});

export const SETTINGS_KEY = "tetra-settings";
const SETTINGS_EVENT = "tetra-settings-change";

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitize(raw: unknown): Settings {
  const o = (raw ?? {}) as Partial<Settings>;
  return {
    theme: o.theme === "light" || o.theme === "dark" ? o.theme : "auto",
    sfxVolume: clamp(o.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume),
    musicVolume: clamp(o.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    startLevel: Math.round(clamp(o.startLevel, 1, 10, DEFAULT_SETTINGS.startLevel)),
    ghost: typeof o.ghost === "boolean" ? o.ghost : DEFAULT_SETTINGS.ghost,
    vibration:
      typeof o.vibration === "boolean" ? o.vibration : DEFAULT_SETTINGS.vibration,
    nextCount: o.nextCount === 3 || o.nextCount === 5 ? o.nextCount : 1,
    hold: typeof o.hold === "boolean" ? o.hold : DEFAULT_SETTINGS.hold,
  };
}

let cachedRaw: string | null = null;
let cached: Settings = DEFAULT_SETTINGS;
let primed = false;

export function readSettings(): Settings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!primed || raw !== cachedRaw) {
    cachedRaw = raw;
    primed = true;
    try {
      cached = sanitize(raw ? JSON.parse(raw) : null);
    } catch {
      cached = DEFAULT_SETTINGS;
    }
  }
  return cached;
}

export function serverSettings(): Settings {
  return DEFAULT_SETTINGS;
}

export function writeSettings(patch: Partial<Settings>) {
  const next = sanitize({ ...readSettings(), ...patch });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

export function resetSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

export function subscribeSettings(onChange: () => void) {
  window.addEventListener(SETTINGS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// "auto" defers to the OS via the prefers-color-scheme media query in CSS.
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

// Runs before paint via an inline script in the layout, so a forced theme
// never flashes the wrong background on first load.
export const THEME_BOOTSTRAP = `try{var t=JSON.parse(localStorage.getItem("${SETTINGS_KEY}")||"{}").theme;if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;
