/** Methods injected by the Kotlin Android host (see android/app/.../GameBridge.kt). */
export interface AndroidBridge {
  saveGame(json: string): void;
  loadGame(): string;
  clearSave(): void;
  vibrate(ms: number): void;
  setKeepScreenOn(on: boolean): void;
  exitApp(): void;
  getPlatformInfo(): string;
}

declare global {
  interface Window {
    SunvaleAndroid?: AndroidBridge;
    /** hooks the Android host calls into */
    __sunvale?: { onBackPressed: () => boolean; onAppPause: () => void; onAppResume: () => void };
    /** app-level back handler (menus, modals, pause) called by the Android host; false = let the app exit */
    __sunvaleBack?: () => boolean;
  }
}

export interface SaveData {
  version: 1;
  money: number;
  story: number;
  sideJobs: number;
  weapons: Record<string, number>;
  health: number;
  armor: number;
  timeOfDay: number;
  stats: { kills: number; carsStolen: number; missions: number; playTime: number; wastedCount: number; bustedCount: number };
  savedAt: number;
}

const KEY = 'sunvale-streets-save-v1';

export const isAndroidApp = () => typeof window !== 'undefined' && !!window.SunvaleAndroid;

export function loadGame(): SaveData | null {
  try {
    const raw = window.SunvaleAndroid ? window.SunvaleAndroid.loadGame() : localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d && d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export function saveGame(d: SaveData) {
  const json = JSON.stringify({ ...d, savedAt: Date.now() });
  try {
    if (window.SunvaleAndroid) window.SunvaleAndroid.saveGame(json);
    else localStorage.setItem(KEY, json);
  } catch {
    /* storage unavailable (private mode) - progress just isn't kept */
  }
}

export function clearSave() {
  try {
    if (window.SunvaleAndroid) window.SunvaleAndroid.clearSave();
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export function vibrate(ms: number) {
  try {
    const d = Math.max(1, Math.round(ms));
    if (window.SunvaleAndroid) window.SunvaleAndroid.vibrate(d);
    else navigator.vibrate?.(d);
  } catch { /* ignore */ }
}

export interface Settings {
  quality: 'low' | 'high';
  volume: number;
  music: number;
  sensitivity: number;
  touch: 'auto' | 'on' | 'off';
  showFps: boolean;
  invertY: boolean;
}

const SETTINGS_KEY = 'sunvale-streets-settings';

export const defaultSettings = (): Settings => ({
  quality: isAndroidApp() || /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'low' : 'high',
  volume: 0.8,
  music: 0.6,
  sensitivity: 1,
  touch: 'auto',
  showFps: false,
  invertY: false,
});

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings();
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
