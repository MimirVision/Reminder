// Missing-task detection: compares what each schedule says should exist by today with the occurrences that do.
// Every result carries the reason it was flagged, so the list can be trusted and checked by hand.

import { addDays, type ISODate } from './dates';
import { formatDate } from './format';
import { occurrenceKey, existingKeys } from './generation';
import { createOn, isPausedOn, listPeriods, periodLabel, recurrenceOf, upcomingPeriods, type Period } from './recurrence';
import type { HolidayCalendar } from './holidays';
import type { GenerationRun, Occurrence, Pause, Review, Schedule } from './types';

export type ExpectedState =
  /** Expected by now, not created automatically (set up after it was due, or automatic creation is off), and nobody has looked at it. */
  | 'missing'
  /** The generator was responsible for it and it does not exist: the run failed or did not happen. */
  | 'generation_failure'
  /** Exists in the future; shown so the next one is never a surprise. */
  | 'not_yet_due'
  /** Someone recorded why it does not exist. */
  | 'exception'
  /** Someone looked at it and acknowledged it. */
  | 'reviewed';

export interface ExpectedItem {
  id: string;
  scheduleId: string;
  clientId: string;
  title: string;
  period: Period;
  periodName: string;
  state: ExpectedState;
  reason: string;
  createOn: ISODate;
  review: Review | null;
}

export const NEEDS_REVIEW: ExpectedState[] = ['missing', 'generation_failure'];

export function detectExpected(
  input: { schedules: Schedule[]; pauses: Pause[]; occurrences: Occurrence[]; reviews: Review[]; runs: GenerationRun[]; holidays?: HolidayCalendar },
  today: ISODate,
): ExpectedItem[] {
  const have = existingKeys(input.occurrences);
  const reviews = new Map(input.reviews.map((r) => [occurrenceKey(r.scheduleId, r.periodKey), r]));
  const lastRun = [...input.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const runErrors = new Map((lastRun?.errors ?? []).map((e) => [e.scheduleId, e.message]));
  const out: ExpectedItem[] = [];

  for (const s of input.schedules) {
    const pauses = input.pauses.filter((p) => p.scheduleId === s.id);
    const rec = recurrenceOf(s, input.holidays);
    const item = (period: Period, state: ExpectedState, reason: string, review: Review | null = null): ExpectedItem => ({
      id: occurrenceKey(s.id, period.key), scheduleId: s.id, clientId: s.clientId, title: s.title, period,
      periodName: periodLabel(period.key), state, reason, createOn: createOn(period.due, s.leadDays), review,
    });

    for (const p of listPeriods(rec, addDays(today, s.leadDays))) {
      // A period due before the schedule starts (e.g. the Friday before a Saturday start) is not expected.
      if (p.due < s.startDate || createOn(p.due, s.leadDays) > today) continue;
      if (isPausedOn(p.due, pauses)) continue;
      const k = occurrenceKey(s.id, p.key);
      if (have.has(k)) continue;
      const review = reviews.get(k) ?? null;
      if (review) {
        out.push(item(p, review.status, review.status === 'exception'
          ? `Exception recorded: ${review.note || 'no note'}`
          : `Reviewed${review.note ? `: ${review.note}` : ''}`, review));
        continue;
      }
      if (s.autoGenerate && p.due >= s.generateFrom) {
        const err = runErrors.get(s.id);
        out.push(item(p, 'generation_failure', err
          ? `Automatic creation failed: ${err}`
          : `Should have been created automatically on ${formatDate(createOn(p.due, s.leadDays))}, but no task exists.`));
      } else if (!s.autoGenerate) {
        out.push(item(p, 'missing', `This schedule only checks (automatic creation is off), and no task exists for ${periodLabel(p.key)}.`));
      } else {
        out.push(item(p, 'missing', `Due ${formatDate(p.due)}, before this schedule started creating tasks on ${formatDate(s.generateFrom)}. Check whether the work was done.`));
      }
    }

    if (s.status !== 'ended') {
      // Enough periods ahead that a weekly schedule with a long lead time still shows its next one.
      const next = upcomingPeriods(rec, today, 60).find((p) => p.due >= s.startDate && createOn(p.due, s.leadDays) > today && !isPausedOn(p.due, pauses) && !have.has(occurrenceKey(s.id, p.key)));
      if (next) {
        out.push(item(next, 'not_yet_due', s.autoGenerate
          ? `Will be created on ${formatDate(createOn(next.due, s.leadDays))}, ${s.leadDays} days before it is due.`
          : `Expected by ${formatDate(createOn(next.due, s.leadDays))}. Automatic creation is off, so add it yourself.`));
      }
    }
  }
  return out.sort((a, b) => a.period.due.localeCompare(b.period.due) || a.title.localeCompare(b.title));
}

export const needsReview = (items: ExpectedItem[]) => items.filter((i) => NEEDS_REVIEW.includes(i.state));
