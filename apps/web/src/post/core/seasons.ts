// Seasonal touches: a few things that fall past the screen, a faint wash of colour, and a small badge on a person's avatar.
// Pure functions only; the pictures are in ui/Seasons.tsx. Dates follow Norway's calendar, with the Northern Hemisphere's seasons.

export type Season = 'winter' | 'christmas' | 'newyear' | 'valentine' | 'easter' | 'spring' | 'may17' | 'summer' | 'autumn' | 'halloween';
/** Automatic follows the calendar, off shows nothing, anything else is that season all year (also how you try one out). */
export type SeasonMode = 'auto' | 'off' | Season;

export const SEASONS: [Season, string][] = [
  ['winter', 'Winter'], ['christmas', 'Christmas'], ['newyear', 'New Year'], ['valentine', "Valentine's Day"], ['easter', 'Easter'],
  ['spring', 'Spring'], ['may17', '17 May'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['halloween', 'Halloween'],
];
export const SEASON_MODES: [SeasonMode, string][] = [['auto', 'Automatic (by date)'], ['off', 'Off'], ...SEASONS];
export const seasonName = (s: Season): string => SEASONS.find(([id]) => id === s)?.[1] ?? s;

export interface SeasonalSettings { mode: SeasonMode; motion: boolean; colours: boolean; badge: boolean }
export const DEFAULT_SEASONAL: SeasonalSettings = { mode: 'auto', motion: true, colours: true, badge: true };

/** Easter Sunday (the Gregorian rule), as month (1-12) and day. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const t = h + l - 7 * m + 114;
  return { month: Math.floor(t / 31), day: (t % 31) + 1 };
}

/** The season for a calendar date (local time). Christmas starts on 1 December; Halloween is 25 October to 1 November; Easter runs from the Sunday before to Easter Monday. */
export function seasonOn(date: Date): Season {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const day = Date.UTC(y, m - 1, d);
  const e = easterSunday(y);
  const easter = Date.UTC(y, e.month - 1, e.day);
  if (day >= easter - 7 * 86400000 && day <= easter + 86400000) return 'easter';
  if (m === 12) return d >= 27 ? 'newyear' : 'christmas';
  if (m === 1) return d <= 2 ? 'newyear' : 'winter';
  if (m === 2) return d >= 7 && d <= 14 ? 'valentine' : 'winter';
  if (m === 3) return d >= 21 ? 'spring' : 'winter';
  if (m === 4) return 'spring';
  if (m === 5) return d === 17 ? 'may17' : 'spring';
  if (m <= 8) return 'summer';
  if (m === 9) return 'autumn';
  if (m === 10) return d >= 25 ? 'halloween' : 'autumn';
  return m === 11 && d === 1 ? 'halloween' : 'autumn';
}

/** What is shown right now, or null for nothing. */
export function activeSeason(mode: SeasonMode, date: Date): Season | null {
  if (mode === 'off') return null;
  return mode === 'auto' ? seasonOn(date) : mode;
}

export type Glyph = 'leaf' | 'leafGold' | 'pumpkin' | 'ghost' | 'flake' | 'dot' | 'heart' | 'egg' | 'petal' | 'spark' | 'confetti' | 'bat' | 'star';

export interface SeasonLook {
  /** What falls (cycled through in order). */
  glyphs: Glyph[];
  /** Which way: 'down' falls, 'up' floats up. */
  dir: 'down' | 'up';
  /** The wash of colour at the top of the screen (light and dark ground). */
  wash: [string, string];
  /** The small thing on a person's avatar. */
  badge: Glyph | 'hat' | 'sun' | 'flower' | 'flag';
  /** Seconds a piece takes to cross the screen (slower is calmer). */
  slow: number;
}

export const LOOKS_BY_SEASON: Record<Season, SeasonLook> = {
  winter: { glyphs: ['flake', 'dot'], dir: 'down', wash: ['#7FA8D8', '#4C78B0'], badge: 'flake', slow: 22 },
  christmas: { glyphs: ['flake', 'dot', 'star'], dir: 'down', wash: ['#C8473F', '#B23A3A'], badge: 'hat', slow: 24 },
  newyear: { glyphs: ['spark', 'confetti'], dir: 'up', wash: ['#D9A441', '#C79A3A'], badge: 'star', slow: 20 },
  valentine: { glyphs: ['heart'], dir: 'up', wash: ['#E27A9C', '#D4608A'], badge: 'heart', slow: 22 },
  easter: { glyphs: ['egg', 'petal'], dir: 'down', wash: ['#E8C85A', '#B9A0E0'], badge: 'egg', slow: 24 },
  spring: { glyphs: ['petal', 'petal', 'dot'], dir: 'down', wash: ['#8FCB9B', '#6DB38A'], badge: 'flower', slow: 22 },
  may17: { glyphs: ['confetti'], dir: 'down', wash: ['#C0392B', '#2F5AA8'], badge: 'flag', slow: 20 },
  summer: { glyphs: ['spark', 'dot'], dir: 'up', wash: ['#F2C14E', '#E0A93A'], badge: 'sun', slow: 26 },
  autumn: { glyphs: ['leaf', 'leafGold', 'leaf'], dir: 'down', wash: ['#E39A4C', '#C97B2E'], badge: 'leaf', slow: 20 },
  halloween: { glyphs: ['pumpkin', 'ghost', 'bat', 'leaf'], dir: 'down', wash: ['#E8803A', '#8A5CC8'], badge: 'pumpkin', slow: 24 },
};

/** A tiny deterministic generator, so the same pieces appear on every render (no jumping when the screen redraws). */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

export interface Piece { glyph: Glyph; left: number; size: number; dur: number; delay: number; sway: number; spin: number; opacity: number; hue: number }

/** The pieces for a season: few, small, slow, spread across the width. Phones get fewer. */
export function piecesFor(season: Season, count: number): Piece[] {
  const look = LOOKS_BY_SEASON[season];
  const r = rng(season.split('').reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7));
  return Array.from({ length: count }, (_, i) => {
    const dur = look.slow * (0.8 + r() * 0.6);
    return {
      glyph: look.glyphs[i % look.glyphs.length],
      left: Math.round(((i + 0.2 + r() * 0.6) / count) * 1000) / 10,
      size: Math.round(14 + r() * 9),
      dur: Math.round(dur * 10) / 10,
      delay: -Math.round(r() * dur * 10) / 10,
      sway: Math.round(10 + r() * 22),
      spin: Math.round((r() - 0.5) * 240),
      opacity: Math.round((0.45 + r() * 0.3) * 100) / 100,
      hue: Math.floor(r() * 3),
    };
  });
}
