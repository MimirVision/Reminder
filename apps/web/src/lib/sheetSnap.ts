// Bottom sheet over the map: three resting heights (peek, half, full). Pure, so it is unit tested.
export type Snap = 'peek' | 'half' | 'full';

export function snapHeights(viewportH: number, peekPx = 220): Record<Snap, number> {
  const full = Math.max(peekPx + 120, viewportH - 132);
  return { peek: peekPx, half: Math.min(full - 60, Math.round(viewportH * 0.5)), full };
}

/** Which resting height a drag ends on. `velocity` is px/ms upwards (positive = heading up); a flick carries on. */
export function snapAfterDrag(height: number, velocity: number, heights: Record<Snap, number>): Snap {
  const projected = height + velocity * 220;
  const order: Snap[] = ['peek', 'half', 'full'];
  return order.reduce((best, s) => (Math.abs(heights[s] - projected) < Math.abs(heights[best] - projected) ? s : best), 'peek' as Snap);
}
