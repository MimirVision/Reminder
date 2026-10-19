import { describe, expect, it } from 'vitest';
import { applyFilter, BLANK_FILTER, filterToQuery, queryToFilter, viewFilter } from './filters';
import type { Client, Occurrence } from './types';

const today = '2026-10-16'; // a Friday
const clients = new Map<string, Client>([
  ['a', { id: 'a', name: 'Alpha AS', reference: 'C-1', status: 'active' } as Client],
  ['b', { id: 'b', name: 'Beta AS', reference: 'C-2', status: 'active' } as Client],
]);
const t = (id: string, o: Partial<Occurrence>): Occurrence => ({
  id, workspaceId: 'w', clientId: 'a', scheduleId: null, title: id, description: '', taskType: 'other', periodKey: null, periodStart: null,
  periodEnd: null, dueDate: today, scheduledDueDate: null, status: 'todo', priority: 'normal', tags: [], completedAt: null, checklist: [], waitingSince: null, createdAt: '', updatedAt: '', ...o,
});
const tasks = [
  t('overdue', { dueDate: '2026-10-12', priority: 'high' }),
  t('today', { clientId: 'b' }),
  t('sunday', { dueDate: '2026-10-18', status: 'waiting' }),
  t('next-week', { dueDate: '2026-10-21', priority: 'urgent', tags: ['receipts'] }),
  t('old-done', { dueDate: '2026-10-01', status: 'done', completedAt: '2026-10-02T10:00:00Z' }),
];
const ids = (xs: Occurrence[]) => xs.map((x) => x.id);

describe('task filters', () => {
  it('implements the saved views', () => {
    expect(ids(applyFilter(tasks, viewFilter('open'), today, clients))).toEqual(['overdue', 'today', 'sunday', 'next-week']);
    expect(ids(applyFilter(tasks, viewFilter('overdue'), today, clients))).toEqual(['overdue']);
    expect(ids(applyFilter(tasks, viewFilter('today'), today, clients))).toEqual(['today']);
    expect(ids(applyFilter(tasks, viewFilter('week'), today, clients))).toEqual(['overdue', 'today', 'sunday']);
    expect(ids(applyFilter(tasks, viewFilter('waiting'), today, clients))).toEqual(['sunday']);
    expect(ids(applyFilter(tasks, viewFilter('high'), today, clients))).toEqual(['next-week', 'overdue']);
    expect(ids(applyFilter(tasks, viewFilter('completed'), today, clients))).toEqual(['old-done']);
  });

  it('searches titles, tags and client names', () => {
    expect(ids(applyFilter(tasks, { ...BLANK_FILTER, search: 'beta' }, today, clients))).toEqual(['today']);
    expect(ids(applyFilter(tasks, { ...BLANK_FILTER, search: 'receipts' }, today, clients))).toEqual(['next-week']);
    expect(ids(applyFilter(tasks, { ...BLANK_FILTER, search: 'c-2' }, today, clients))).toEqual(['today']);
  });

  it('sorts by client', () => {
    expect(ids(applyFilter(tasks, { ...BLANK_FILTER, sort: 'client' }, today, clients))[4]).toBe('today');
  });

  it('round-trips through the URL', () => {
    const f = { ...viewFilter('high'), search: 'vat', clients: ['a'] };
    expect(queryToFilter(new URLSearchParams(filterToQuery(f)))).toEqual(f);
  });
});
