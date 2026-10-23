// Which reminders are due now, worked out from the rows alone so it is easy to test. Times are Norwegian wall-clock
// time (Europe/Oslo), the same as the shifts. Every reminder has a key; the function claims a key before sending, so
// a reminder is never sent twice however often it runs.
import { addDays, addMonths, daysInMonth, monthOf, weekday, type ISODate } from '../../../src/lib/dates.ts';
import { MONTHS, kr } from '../../../src/lib/format.ts';
import { payOf, shiftSpan } from '../../../src/lib/pay.ts';
import type { Employer, Shift, Supplement } from '../../../src/lib/types.ts';

export interface OwnerRows {
  ownerId: string;
  settings: Record<string, unknown> | null;
  employers: Employer[];
  supplements: Supplement[];
  /** Shifts from yesterday on (Oslo time). */
  shifts: Shift[];
}

export interface Message { key: string; title: string; body: string; url: string; tag: string }

/** Oslo date and minutes after midnight for an instant. */
export function osloNow(now: number): { date: ISODate; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Wall-clock minutes on one scale, so times on different days compare. */
const at = (date: ISODate, minutes: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 60_000 + minutes;
};

const AFTER = 30; // minutes after a shift ends
const LATE = 180; // a reminder more than this late is skipped rather than sent

export function planOwner(o: OwnerRows, now: number): Message[] {
  const s = (o.settings ?? {}) as { onboarded?: boolean; reminders?: Record<string, boolean>; sick_percent?: number };
  if (!s.onboarded) return [];
  const rules = { after_shift: true, weekly: true, month: true, ...(s.reminders ?? {}) };
  const { date: today, minutes } = osloNow(now);
  const nowAt = at(today, minutes);
  const out: Message[] = [];

  if (rules.after_shift) {
    for (const sh of o.shifts) {
      const span = shiftSpan(sh);
      if (!span || sh.status === 'sick') continue;
      const due = at(sh.date, span.end) + AFTER;
      if (nowAt < due || nowAt > due + LATE) continue;
      const pay = payOf(sh, { employers: o.employers, supplements: o.supplements, sickPercent: s.sick_percent });
      out.push({
        key: `after:${sh.id}:${sh.date}:${sh.end_time}`,
        title: 'Vakta er ferdig 💜',
        body: `+${kr(pay.total)} tjent (${sh.start_time}–${sh.end_time}). Stemmer tidene? Trykk for å sjekke.`,
        url: '/vakter', tag: `after-${sh.id}`,
      });
    }
  }

  const evening = minutes >= 18 * 60 && minutes < 21 * 60;
  if (rules.weekly && evening && weekday(today) === 7) {
    const from = addDays(today, 1), to = addDays(today, 7);
    if (!o.shifts.some((x) => x.date >= from && x.date <= to)) {
      out.push({ key: `week:${from}`, title: 'Ny uke i morgen 🗓️', body: 'Du har ingen vakter lagt inn neste uke. Legg dem inn nå, så ser du hva uka gir.', url: '/vakter', tag: 'week' });
    }
  }

  const month = monthOf(today);
  if (rules.month && evening && Number(today.slice(8)) === daysInMonth(month) - 5) {
    const next = addMonths(month, 1);
    if (!o.shifts.some((x) => monthOf(x.date) === next)) {
      const name = MONTHS[Number(next.slice(5)) - 1];
      out.push({ key: `month:${next}`, title: `Turnusen for ${name}? ✨`, body: `Legg inn vaktene for ${name}, så ser du hva måneden gir.`, url: '/vakter', tag: 'month' });
    }
  }
  return out;
}

export const TEST_MESSAGE = { title: 'Vakt 🔔', body: 'Varsler virker på denne enheten.', url: '/', tag: 'test' };

/** The first day of shifts the plan needs: yesterday in Oslo (a night shift that ends this morning). */
export const shiftsFrom = (now: number) => addDays(osloNow(now).date, -1);

