// Reading comfort: text size and contrast, remembered on this device.
export type TextSize = 'normal' | 'large' | 'xl';
export type Contrast = 'normal' | 'high';
export const TEXT_SIZES: TextSize[] = ['normal', 'large', 'xl'];

export const parseTextSize = (v: unknown): TextSize => (v === 'large' || v === 'xl' ? v : 'normal');
export const parseContrast = (v: unknown): Contrast => (v === 'high' ? 'high' : 'normal');

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const getTextSize = () => parseTextSize(read('hm.text'));
export const getContrast = () => parseContrast(read('hm.contrast'));
export function applyTextSize(s: TextSize) { document.documentElement.dataset.text = s; write('hm.text', s); }
export function applyContrast(c: Contrast) { document.documentElement.dataset.contrast = c; write('hm.contrast', c); }
export function applyA11y() { applyTextSize(getTextSize()); applyContrast(getContrast()); }
