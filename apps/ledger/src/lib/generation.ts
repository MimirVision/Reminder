// Which occurrences a schedule should have by now. Used by the demo store to generate, and mirrored by
// public.ledger_generate() in the database, which is what a real workspace uses (on app open and nightly via pg_cron).
// Both are idempotent: an occurrence is identified by (schedule, period), and an existing one is never touched.

import { addDays, type ISODate } from './dates';
import type { HolidayCalendar } from './holidays';
import { createOn, isPausedOn, listPeriods, recurrenceOf, type Period } from './recurrence';
import type { Client, Occurrence, Pause, Schedule } from './types';

/** Schedules that still produce and expect tasks: those of active clients. Archived clients keep their history only. */
export function liveSchedules(schedules: Schedule[], clients: Pick<Client, 'id' | 'status'>[]): Schedule[] {
  const active = new Set(clients.filter((c) => c.status === 'active').map((c) => c.id));
  return schedules.filter((s) => active.has(s.clientId));
}

export const occurrenceKey = (scheduleId: string, periodKey: string) => `${scheduleId}|${periodKey}`;

export function existingKeys(occurrences: Pick<Occurrence, 'scheduleId' | 'periodKey'>[]): Set<string> {
  const keys = new Set<string>();
  for (const o of occurrences) if (o.scheduleId && o.periodKey) keys.add(occurrenceKey(o.scheduleId, o.periodKey));
  return keys;
}

/** Periods of a schedule that the automatic generator is responsible for, as of `today`. */
export function generatablePeriods(s: Schedule, pauses: Pause[], today: ISODate, holidays: HolidayCalendar = 'none'): Period[] {
  if (!s.autoGenerate) return [];
  const mine = pauses.filter((p) => p.scheduleId === s.id);
  return listPeriods(recurrenceOf(s, holidays), addDays(today, s.leadDays))
    .filter((p) => p.due >= s.generateFrom && p.due >= s.startDate && createOn(p.due, s.leadDays) <= today && !isPausedOn(p.due, mine));
}

export type NewOccurrence = Omit<Occurrence, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>;

export function occurrenceFromPeriod(s: Schedule, p: Period): NewOccurrence {
  return {
    clientId: s.clientId,
    scheduleId: s.id,
    title: s.title,
    description: s.description,
    taskType: s.taskType,
    periodKey: p.key,
    periodStart: p.start,
    periodEnd: p.end,
    dueDate: p.due,
    scheduledDueDate: p.due,
    status: 'todo',
    priority: s.defaultPriority,
    tags: [],
    completedAt: null,
    // The schedule's checklist, all unticked.
    checklist: (s.checklist ?? []).map((i) => ({ ...i, done: false })),
    waitingSince: null,
  };
}

/** The occurrences to create so every schedule is up to date. Never includes one that already exists. */
export function planGeneration(schedules: Schedule[], pauses: Pause[], occurrences: Occurrence[], today: ISODate, holidays: HolidayCalendar = 'none'): NewOccurrence[] {
  const have = existingKeys(occurrences);
  const out: NewOccurrence[] = [];
  for (const s of schedules) {
    for (const p of generatablePeriods(s, pauses, today, holidays)) {
      const k = occurrenceKey(s.id, p.key);
      if (have.has(k)) continue;
      have.add(k);
      out.push(occurrenceFromPeriod(s, p));
    }
  }
  return out;
}
