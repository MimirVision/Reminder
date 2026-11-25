import { describe, expect, it } from 'vitest';
import { chainOf, linkByDeadline, nextSteps, possibleSteps, waitingOn } from './chains';
import type { Occurrence } from './types';

const t = (id: string, o: Partial<Occurrence> = {}) => ({ id, clientId: 'c1', title: id, status: 'todo', dueDate: '2026-11-20', afterId: null, ...o }) as Occurrence;

describe('steps', () => {
  const a = t('grunnlag', { dueDate: '2026-11-10' }), b = t('lonn', { afterId: 'grunnlag', dueDate: '2026-11-19' }), c = t('amelding', { afterId: 'lonn', dueDate: '2026-12-05' });
  const all = [c, a, b];
  const byId = new Map(all.map((x) => [x.id, x]));

  it('knows what a task is waiting for, and that it is ready once that step is finished', () => {
    expect(waitingOn(b, byId)?.id).toBe('grunnlag');
    expect(waitingOn(a, byId)).toBeNull();
    const done = new Map(byId).set('grunnlag', { ...a, status: 'done' });
    expect(waitingOn(b, done)).toBeNull();
    const cancelled = new Map(byId).set('grunnlag', { ...a, status: 'cancelled' });
    expect(waitingOn(b, cancelled)).toBeNull();
  });

  it('follows the chain both ways', () => {
    expect(chainOf(b, all).map((x) => x.id)).toEqual(['grunnlag', 'lonn', 'amelding']);
    expect(nextSteps(a, all).map((x) => x.id)).toEqual(['lonn']);
  });

  it('offers only the same client’s tasks that would not make a loop', () => {
    const other = t('other', { clientId: 'c2' });
    expect(possibleSteps(a, [...all, other]).map((x) => x.id)).toEqual([]);
    expect(possibleSteps(c, [...all, other]).map((x) => x.id).sort()).toEqual(['grunnlag', 'lonn']);
  });

  it('links an import by deadline within each group; same-day steps run side by side', () => {
    const rows = [
      { group: 'c1|11|lønn', dueDate: '2026-11-19' },
      { group: 'c1|11|lønn', dueDate: '2026-11-10' },
      { group: 'c1|11|lønn', dueDate: '2026-12-05' },
      { group: 'c1|11|lønn', dueDate: '2026-12-05' },
      { group: 'c2|11|lønn', dueDate: '2026-11-19' },
      { group: null, dueDate: '2026-11-01' },
    ];
    expect(linkByDeadline(rows)).toEqual([1, -1, 0, 0, -1, -1]);
  });
});
