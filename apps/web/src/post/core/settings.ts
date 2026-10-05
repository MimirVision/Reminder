// The look and behaviour choices. Kept deliberately small: 8 checked accent colours (every one passes contrast on both grounds),
// theme, pure black for OLED, row size, and a colour per account. No free colour picker, so nothing can end up unreadable.

export type ThemePref = 'system' | 'light' | 'dark';
export type RowSize = 'compact' | 'comfortable' | 'roomy';

export interface Accent { id: string; name: string; light: string; dark: string; tintLight: string; tintDark: string; inkLight: string; inkDark: string }

export const ACCENTS: Accent[] = [
  { id: 'ember', name: 'Ember', light: '#C8431F', dark: '#F08A66', tintLight: '#FBEAE4', tintDark: '#3A2019', inkLight: '#8F2F14', inkDark: '#F4B8A3' },
  { id: 'ocean', name: 'Ocean', light: '#1C5FD1', dark: '#6BA0F2', tintLight: '#E5EEFC', tintDark: '#17263F', inkLight: '#154699', inkDark: '#B3CDF7' },
  { id: 'forest', name: 'Forest', light: '#1F7A4D', dark: '#5FD39A', tintLight: '#E3F3EB', tintDark: '#14301F', inkLight: '#165A39', inkDark: '#A6E6C6' },
  { id: 'plum', name: 'Plum', light: '#8A3FB8', dark: '#C79AEB', tintLight: '#F1E8F8', tintDark: '#2C1B3A', inkLight: '#652C87', inkDark: '#DEC4F3' },
  { id: 'rose', name: 'Rose', light: '#C2305F', dark: '#F28AAB', tintLight: '#FBE6ED', tintDark: '#3A1824', inkLight: '#8E2347', inkDark: '#F6B9CD' },
  { id: 'teal', name: 'Teal', light: '#0B6B63', dark: '#3FBFB0', tintLight: '#DDF1EE', tintDark: '#0F2E2B', inkLight: '#084F49', inkDark: '#9BE0D8' },
  { id: 'amber', name: 'Amber', light: '#A35B00', dark: '#F0B04A', tintLight: '#FBEFD9', tintDark: '#35260C', inkLight: '#774300', inkDark: '#F6D597' },
  { id: 'slate', name: 'Slate', light: '#3E4A5E', dark: '#A9B6CC', tintLight: '#E7EAF0', tintDark: '#232A36', inkLight: '#2C3544', inkDark: '#CBD4E2' },
];

/** Colours an account can have (shown as the badge on each row). */
export const ACCOUNT_COLOURS = ['#1F5FBF', '#0B6B63', '#8A3FB8', '#C2305F', '#A35B00', '#3E4A5E'];

export interface Settings {
  theme: ThemePref;
  accent: string;
  pureBlack: boolean;
  rowSize: RowSize;
  accountColours: Record<string, string>;
  swipeRight: 'archive' | 'read' | 'flag' | 'delete';
  swipeLeft: 'snooze' | 'flag' | 'delete' | 'read';
  blockImages: boolean;
  signature: string;
  undoSend: number; // seconds
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system', accent: 'ember', pureBlack: false, rowSize: 'comfortable', accountColours: {},
  swipeRight: 'archive', swipeLeft: 'snooze', blockImages: true, signature: '', undoSend: 10,
};

const ONE_OF = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Reads saved settings defensively: anything unknown or corrupt falls back to the default instead of breaking the app. */
export function loadSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const colours: Record<string, string> = {};
  if (o.accountColours && typeof o.accountColours === 'object') {
    for (const [k, v] of Object.entries(o.accountColours as Record<string, unknown>)) if (typeof v === 'string' && ACCOUNT_COLOURS.includes(v)) colours[k] = v;
  }
  return {
    theme: ONE_OF(o.theme, ['system', 'light', 'dark'], d.theme),
    accent: ACCENTS.some((a) => a.id === o.accent) ? String(o.accent) : d.accent,
    pureBlack: o.pureBlack === true,
    rowSize: ONE_OF(o.rowSize, ['compact', 'comfortable', 'roomy'], d.rowSize),
    accountColours: colours,
    swipeRight: ONE_OF(o.swipeRight, ['archive', 'read', 'flag', 'delete'], d.swipeRight),
    swipeLeft: ONE_OF(o.swipeLeft, ['snooze', 'flag', 'delete', 'read'], d.swipeLeft),
    blockImages: o.blockImages !== false,
    signature: typeof o.signature === 'string' ? o.signature.slice(0, 500) : '',
    undoSend: [0, 5, 10, 20, 30].includes(Number(o.undoSend)) ? Number(o.undoSend) : d.undoSend,
  };
}

/** The colour of an account's badge: the chosen one, else the next free colour in order. */
export function accountColour(email: string, accounts: string[], chosen: Record<string, string>): string {
  if (chosen[email]) return chosen[email];
  const used = new Set(accounts.filter((a) => a !== email).map((a) => chosen[a]).filter(Boolean));
  const idx = Math.max(0, accounts.indexOf(email));
  const free = ACCOUNT_COLOURS.filter((c) => !used.has(c));
  return free[idx % free.length] ?? ACCOUNT_COLOURS[idx % ACCOUNT_COLOURS.length];
}

/** CSS variables for the chosen look. Applied on the app root, so the stylesheet only uses var(--…). */
export function themeVars(s: Settings, dark: boolean): Record<string, string> {
  const a = ACCENTS.find((x) => x.id === s.accent) ?? ACCENTS[0];
  if (!dark) return { '--bg': '#F2F3F5', '--card': '#FFFFFF', '--ink': '#1E2430', '--mu': '#5B6472', '--ln': '#E4E7EC', '--ac': a.light, '--on': '#FFFFFF', '--at': a.light, '--tint': a.tintLight, '--ti': a.inkLight, '--ok': '#1F7A4D', '--bad': '#B3261E', '--wb': '#FFF0CC', '--wi': '#6B4A00' };
  return { '--bg': s.pureBlack ? '#000000' : '#0F1217', '--card': s.pureBlack ? '#0E1013' : '#1A1F27', '--ink': '#EEF0F3', '--mu': '#A3ABB8', '--ln': s.pureBlack ? '#1C2027' : '#2A303A', '--ac': a.dark, '--on': '#0F1217', '--at': a.dark, '--tint': a.tintDark, '--ti': a.inkDark, '--ok': '#5FD39A', '--bad': '#F2807A', '--wb': '#3A3017', '--wi': '#F2D28A' };
}

export const ROW_HEIGHT: Record<RowSize, number> = { compact: 64, comfortable: 78, roomy: 92 };
