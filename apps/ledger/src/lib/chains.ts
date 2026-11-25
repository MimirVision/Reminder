// Steps that follow each other: "Lønnskjøring" comes after "Mottak av lønnsgrunnlag", "A-melding" after that.
// A task points at the step it waits for (afterId). While that step is open, the task is waiting on it; when it is
// done (or cancelled) the task is ready. Pure, so the rules are tested.
import type { ISODate } from './dates';
import { isOpen, type Occurrence } from './types';

type Step = Pick<Occurrence, 'id' | 'title' | 'status' | 'dueDate' | 'afterId'>;

/** The step a task is still waiting for, or null when it is ready (no step, or that step is finished). */
export function waitingOn<T extends Step>(task: T, byId: Map<string, T>): T | null {
  if (!task.afterId) return null;
  const before = byId.get(task.afterId);
  return before && isOpen(before.status) ? before : null;
}

/** The steps that come directly after a task. */
export const nextSteps = <T extends Step>(task: Step, all: T[]): T[] => all.filter((o) => o.afterId === task.id);

/** The whole chain a task belongs to, first step first (following links both ways; at most 50 steps). */
export function chainOf<T extends Step>(task: T, all: T[]): T[] {
  const byId = new Map(all.map((o) => [o.id, o]));
  const before: T[] = [];
  let cur = task.afterId ? byId.get(task.afterId) : undefined;
  while (cur && before.length < 50 && !before.includes(cur)) { before.unshift(cur); cur = cur.afterId ? byId.get(cur.afterId) : undefined; }
  const after: T[] = [];
  let next = nextSteps(task, all);
  while (next.length && after.length < 50) {
    const n = [...next].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (after.includes(n) || n === task) break;
    after.push(n);
    next = nextSteps(n, all);
  }
  return [...before, task, ...after];
}

/** Tasks a task may come after: the same client's other tasks, not ones that already wait for it (no loops). */
export function possibleSteps<T extends Step & Pick<Occurrence, 'clientId'>>(task: T, all: T[]): T[] {
  const below = new Set<string>([task.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const o of all) if (o.afterId && below.has(o.afterId) && !below.has(o.id)) { below.add(o.id); grew = true; }
  }
  return all.filter((o) => o.clientId === task.clientId && !below.has(o.id)).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
}

/**
 * Links the steps of an import. Rows of the same group (client, period and assignment) are ordered by their
 * deadline; each comes after the last one with an earlier deadline (steps due the same day run side by side).
 * Returns, for each row index, the index of the row it comes after (or -1).
 */
export function linkByDeadline(rows: { group: string | null; dueDate: ISODate }[]): number[] {
  const out = rows.map(() => -1);
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => { if (r.group) groups.set(r.group, [...(groups.get(r.group) ?? []), i]); });
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const sorted = [...idx].sort((a, b) => rows[a].dueDate.localeCompare(rows[b].dueDate) || a - b);
    for (let k = 1; k < sorted.length; k++) {
      // The last step due strictly before this one.
      let j = k - 1;
      while (j >= 0 && rows[sorted[j]].dueDate === rows[sorted[k]].dueDate) j--;
      if (j >= 0) {
        // Of several steps due that same earlier day, wait for the last of them in the file.
        out[sorted[k]] = sorted[j];
      }
    }
  }
  return out;
}
