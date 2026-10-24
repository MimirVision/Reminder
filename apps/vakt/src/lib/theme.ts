// Light, dark or auto (follow the phone). Remembered on this device; public/theme.js applies it before the first paint.
export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'vakt-theme';

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; }
}

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function applyTheme(t: Theme = getTheme()) {
  const dark = t === 'dark' || (t === 'auto' && Boolean(media()?.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // The status bar and the app switcher take this colour.
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = dark ? '#141118' : '#faf6f3';
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* still applies for this visit */ }
  applyTheme(t);
}

/** Follows the phone's light/dark switch while the app is open, when set to Auto. */
export function watchTheme() {
  applyTheme();
  media()?.addEventListener?.('change', () => { if (getTheme() === 'auto') applyTheme('auto'); });
}
