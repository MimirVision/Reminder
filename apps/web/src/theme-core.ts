// Light/dark preference logic (no React or DOM here, so it is unit tested with plain Node).
export type ThemePref = 'system' | 'light' | 'dark';
export type Resolved = 'light' | 'dark';

export const isThemePref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark';
export const resolveTheme = (pref: ThemePref, systemDark: boolean): Resolved => (pref === 'system' ? (systemDark ? 'dark' : 'light') : pref);

// The colour behind the phone's status bar / browser chrome; matches --bg in styles.css.
export const themeColor = (r: Resolved) => (r === 'dark' ? '#0F1217' : '#F2F3F5');

// Basemap tiles that match the app: CARTO's calm "Positron" (light) and "Dark Matter" (dark), from OpenStreetMap data.
export const TILE_URLS: Record<Resolved, string> = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';
