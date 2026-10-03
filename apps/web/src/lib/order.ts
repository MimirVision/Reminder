// Moving a to-do up or down inside its group. The group (as shown) is numbered 1024, 2048, ... in its new order, and only
// the to-dos whose number changed are returned, so a move is usually two small updates. Pure, unit tested.
export type Ordered = { id: string; sort_order?: number | null };

export function moveStep(list: readonly Ordered[], id: string, dir: -1 | 1): { id: string; sort_order: number }[] | null {
  const i = list.findIndex((m) => m.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((m, k) => ({ m, sort_order: (k + 1) * 1024 })).filter((x) => x.m.sort_order !== x.sort_order).map((x) => ({ id: x.m.id, sort_order: x.sort_order }));
}
