// The extra details of a to-do (notes, checklist, priority, reminder). What to send to the database: only what is used on a new
// to-do (so it keeps working before the database upgrade), and only what changed on an edit. Pure, unit tested.
import { cleanChecklist } from './checklist.ts';
import type { ChecklistItem, Memory, Priority } from './types';

export type Details = { notes: string; checklist: ChecklistItem[]; priority: Priority; remind_before: number | null; tags: string[]; duration_min: number | null; remind_travel: boolean };
export const emptyDetails = (): Details => ({ notes: '', checklist: [], priority: 0, remind_before: null, tags: [], duration_min: null, remind_travel: false });

export const detailsOf = (m?: Pick<Memory, 'notes' | 'checklist' | 'priority' | 'remind_before' | 'tags' | 'duration_min' | 'remind_travel'> | null): Details => ({
  notes: m?.notes ?? '', checklist: cleanChecklist(m?.checklist), priority: m?.priority ?? 0, remind_before: m?.remind_before ?? null, tags: m?.tags ?? [], duration_min: m?.duration_min ?? null, remind_travel: !!m?.remind_travel,
});

export type DetailFields = { notes?: string | null; checklist?: ChecklistItem[]; priority?: Priority; remind_before?: number | null; tags?: string[]; duration_min?: number | null; remind_travel?: boolean };

/** For a new to-do: only the details that are set. A reminder needs a date. */
export function newFields(d: Details, hasDate: boolean): DetailFields {
  return {
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    ...(d.checklist.length ? { checklist: d.checklist } : {}),
    ...(d.priority ? { priority: d.priority } : {}),
    ...(hasDate && d.remind_before != null ? { remind_before: d.remind_before } : {}),
    ...(d.tags.length ? { tags: d.tags } : {}),
    ...(d.duration_min != null ? { duration_min: d.duration_min } : {}),
    ...(hasDate && d.remind_travel ? { remind_travel: true } : {}),
  };
}

/** For an edit: only what differs from the saved to-do (a cleared note or reminder is sent as null). */
export function changedFields(d: Details, was: Details, hasDate: boolean): DetailFields {
  const out: DetailFields = {};
  const notes = d.notes.trim();
  if (notes !== was.notes.trim()) out.notes = notes || null;
  if (JSON.stringify(d.checklist) !== JSON.stringify(was.checklist)) out.checklist = d.checklist;
  if (d.priority !== was.priority) out.priority = d.priority;
  if (JSON.stringify(d.tags) !== JSON.stringify(was.tags)) out.tags = d.tags;
  if (d.duration_min !== was.duration_min) out.duration_min = d.duration_min;
  const travel = hasDate && d.remind_travel;
  if (travel !== was.remind_travel) out.remind_travel = travel;
  const lead = hasDate ? d.remind_before : null;
  if (lead !== was.remind_before) out.remind_before = lead;
  return out;
}

/** "Remind me" choices, in minutes before the due time. */
export const REMIND_CHOICES = [0, 5, 10, 30, 60, 120, 1440, 2880] as const;

/** "30 min", "2 h", "1 day" in the reader's language (for "In 30 min: Call the plumber"). */
export function leadShort(minutes: number, lang: 'en' | 'nb'): string {
  if (minutes % 1440 === 0) { const d = minutes / 1440; return lang === 'nb' ? `${d} ${d === 1 ? 'dag' : 'dager'}` : `${d} ${d === 1 ? 'day' : 'days'}`; }
  if (minutes % 60 === 0) return lang === 'nb' ? `${minutes / 60} t` : `${minutes / 60} h`;
  return `${minutes} min`;
}
