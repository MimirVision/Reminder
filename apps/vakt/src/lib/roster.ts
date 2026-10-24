// Turning what the AI read from a roster (GAT) into shifts and days off. The AI only reads; everything here is plain
// rules, so it is tested and the same every time: codes with times become shifts, known codes use what they meant last
// time, and nothing she already has is added twice.
import { toMinutes, fromMinutes, type ISODate } from './dates';
import type { CodeRule, DayOff, DayOffKind, Shift } from './types';

export type EntryKind = 'shift' | 'ferie' | 'fri' | 'avspasering' | 'syk' | 'annet';
export interface RosterEntry { date: ISODate; code: string; start: string; end: string; kind: EntryKind }

const KINDS: EntryKind[] = ['shift', 'ferie', 'fri', 'avspasering', 'syk', 'annet'];
const OFF: Partial<Record<EntryKind, DayOffKind>> = { ferie: 'ferie', fri: 'fri', avspasering: 'avspasering' };

const time = (t: unknown) => {
  const m = typeof t === 'string' ? toMinutes(t.replace('.', ':')) : null;
  return m === null || m === 1440 ? '' : fromMinutes(m);
};

/** '2026-11-31' looks like a date but isn't. */
const realDate = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};

/** Keeps only well-formed entries (a real date, times that parse), one per day and code. */
export function cleanEntries(raw: unknown): RosterEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: RosterEntry[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const date = String(r?.date ?? '');
    if (!realDate(date)) continue;
    const code = String(r?.code ?? '').trim().toUpperCase().slice(0, 12);
    const kind = KINDS.includes(r?.kind as EntryKind) ? (r.kind as EntryKind) : 'shift';
    let start = time(r?.start), end = time(r?.end);
    if (!start || !end || start === end) start = end = '';
    const key = `${date}|${code}|${start}`;
    if (seen.has(key) || (!code && !start)) continue;
    seen.add(key);
    out.push({ date, code, start, end, kind });
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

/** Codes she has to explain once: shifts with no times on the roster and no rule from before. */
export function unknownCodes(entries: RosterEntry[], rules: Record<string, CodeRule>): string[] {
  return [...new Set(entries.filter((e) => e.kind === 'shift' && !e.start && e.code && !rules[e.code]).map((e) => e.code))];
}

/** Codes that came with times this time: remembered, so a later roster without times still works. */
export function learnCodes(entries: RosterEntry[], rules: Record<string, CodeRule>): Record<string, CodeRule> {
  const out = { ...rules };
  for (const e of entries) if (e.kind === 'shift' && e.code && e.start && !out[e.code]) out[e.code] = { start_time: e.start, end_time: e.end, break_minutes: 0 };
  return out;
}

export type PlanItem =
  | { type: 'shift'; entry: RosterEntry; shift: Shift; duplicate: boolean }
  | { type: 'off'; entry: RosterEntry; day: DayOff; duplicate: boolean }
  | { type: 'skip'; entry: RosterEntry; reason: string };

/** What saving would do, entry by entry. Duplicates (the same shift, or a day off already there) are marked. */
export function planImport(
  entries: RosterEntry[], rules: Record<string, CodeRule>, employerId: string,
  shifts: Shift[], daysOff: DayOff[], newId: () => string,
): PlanItem[] {
  return entries.map((entry): PlanItem => {
    const rule = entry.code ? rules[entry.code] : undefined;
    if (rule && 'skip' in rule) return { type: 'skip', entry, reason: 'Hoppes over' };
    const off = rule && 'off' in rule ? rule.off : !entry.start ? OFF[entry.kind] : undefined;
    if (off) {
      const day: DayOff = { id: newId(), date: entry.date, kind: off, note: entry.code };
      return { type: 'off', entry, day, duplicate: daysOff.some((d) => d.date === entry.date) };
    }
    const times = entry.start ? { start_time: entry.start, end_time: entry.end, break_minutes: rule && 'start_time' in rule ? rule.break_minutes : 0 }
      : rule && 'start_time' in rule ? rule : null;
    if (!times) return { type: 'skip', entry, reason: entry.code ? `Ukjent kode ${entry.code}` : 'Ingen tider' };
    const shift: Shift = {
      id: newId(), employer_id: employerId, date: entry.date, ...times, overtime_percent: 0,
      note: entry.code ? `GAT ${entry.code}` : '', status: entry.kind === 'syk' ? 'sick' : 'worked',
    };
    const duplicate = shifts.some((s) => s.date === shift.date && s.start_time === shift.start_time && (s.employer_id ?? employerId) === employerId);
    return { type: 'shift', entry, shift, duplicate };
  });
}
