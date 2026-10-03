// The one filter for the to-do list: whose, how important, which tag. Pure, unit tested.
import type { Memory } from './types';

export type Filter = { who: 'all' | 'mine' | 'theirs'; minPriority: 0 | 1 | 2 | 3; tag: string | null };
export const noFilter = (): Filter => ({ who: 'all', minPriority: 0, tag: null });

/** How many of the three are switched on (for the badge on the Filter button). */
export const activeCount = (f: Filter): number => Number(f.who !== 'all') + Number(f.minPriority > 0) + Number(f.tag != null);

export function applyFilter<T extends Pick<Memory, 'assignee_id' | 'priority' | 'tags'>>(list: T[], f: Filter, userId: string, partnerId: string | null): T[] {
  if (activeCount(f) === 0) return list;
  return list.filter((m) => {
    if (f.who !== 'all' && partnerId) {
      const target = f.who === 'mine' ? userId : partnerId;
      if (m.assignee_id && m.assignee_id !== target) return false;
    }
    if (f.minPriority > 0 && (m.priority ?? 0) < f.minPriority) return false;
    if (f.tag && !(m.tags ?? []).includes(f.tag)) return false;
    return true;
  });
}
