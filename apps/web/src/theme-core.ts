// Light/dark preference logic (no React or DOM here, so it is unit tested with plain Node).
export type ThemePref = 'system' | 'light' | 'dark';
export type Resolved = 'light' | 'dark';

export const isThemePref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark';
export const resolveTheme = (pref: ThemePref, systemDark: boolean): Resolved => (pref === 'system' ? (systemDark ? 'dark' : 'light') : pref);

// The colour behind the phone's status bar / browser chrome; matches --bg in styles.css.
export const themeColor = (r: Resolved) => (r === 'dark' ? '#0F1217' : '#F2F3F5');

// Basemap: OpenStreetMap's standard tiles, for both themes (the dark look is a CSS filter, see .map.dark in styles.css).
// CARTO's free themed tiles now demand an API key and draw "API KEY REQUIRED" over the map, so they are not used.
// OSM's tile server is for light use; for a busy public app switch to a keyed provider (MapTiler, Stadia) in one place: here.
export const TILE_URLS: Record<Resolved, string> = {
  light: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};
export const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
