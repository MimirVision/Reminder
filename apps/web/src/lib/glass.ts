// Glass level for the floating bars: clear (most see-through), glass, frosted (most readable).
export type GlassLevel = 'clear' | 'glass' | 'frosted';
export const GLASS_LEVELS: GlassLevel[] = ['clear', 'glass', 'frosted'];
const KEY = 'hm.glassLevel';

export function getGlass(): GlassLevel {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'clear' || v === 'glass' || v === 'frosted') return v;
  } catch { /* storage unavailable */ }
  return 'glass';
}

export function applyGlass(level: GlassLevel) {
  document.documentElement.dataset.glass = level;
  try { localStorage.setItem(KEY, level); } catch { /* ignore */ }
}
