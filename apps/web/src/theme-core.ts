// Light/dark preference logic (no React or DOM here, so it is unit tested with plain Node).
export type ThemePref = 'system' | 'light' | 'dark';
export type Resolved = 'light' | 'dark';

export const isThemePref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark';
export const resolveTheme = (pref: ThemePref, systemDark: boolean): Resolved => (pref === 'system' ? (systemDark ? 'dark' : 'light') : pref);

// The colour behind the phone's status bar / browser chrome; matches --bg in styles.css.
export const themeColor = (r: Resolved) => (r === 'dark' ? '#0F1217' : '#F2F3F5');

// Basemap: OpenFreeMap's "positron" vector style (free, no API key, modern and calm). In the dark theme the canvas is inverted by CSS
// (see .map.dark in styles.css). If the style cannot be fetched, plain OpenStreetMap raster tiles are used instead.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
export const MAP_ATTRIBUTION_FALLBACK = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
export const RASTER_FALLBACK_STYLE = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as const;
