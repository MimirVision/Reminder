// A condition report (tilstandsrapport) kept as a list of findings: each has a grade (TG3 or TG2), or is a health-and-safety (HMS) or legality
// (LOV) note, what was found, what is recommended and its own status. Pure helpers for grouping, filtering and turning one into a to-do.
// Unit tested (condition.test.ts).
import type { Priority } from './types';

export type Tg = 'TG3' | 'TG2' | 'HMS' | 'LOV';
export type When = 'now' | 'plan' | 'watch';
export type Area = 'exterior' | 'interior' | 'wet' | 'kitchen' | 'technical' | 'plot' | 'hms' | 'legal';
export type ConditionStatus = 'open' | 'done' | 'skipped';

export type ConditionSeedItem = {
  key: string; area: Area; part: string; tg: Tg; when: When; what: string; action: string; page?: number; cost_min?: number; cost_max?: number;
};

export type ConditionItem = {
  id: string; household_id: string; source: string; source_key: string; area: string; part: string; tg: Tg; when_kind: When;
  what: string; action: string; cost_min: number | null; cost_max: number | null; page: number | null; status: ConditionStatus;
  notes: string | null; memory_id: string | null; done_at: string | null; created_at: string;
};

/** Most serious first. */
export const TG_ORDER: Tg[] = ['TG3', 'HMS', 'TG2', 'LOV'];
export const AREA_ORDER: Area[] = ['plot', 'exterior', 'interior', 'wet', 'kitchen', 'technical', 'hms', 'legal'];
export const WHEN_ORDER: When[] = ['now', 'plan', 'watch'];

export type ConditionFilter = { tg: Tg | 'all'; when: When | 'all'; showDone: boolean };
export const defaultFilter = (): ConditionFilter => ({ tg: 'all', when: 'all', showDone: false });

const tgRank = (tg: string) => { const i = TG_ORDER.indexOf(tg as Tg); return i < 0 ? 99 : i; };
const whenRank = (w: string) => { const i = WHEN_ORDER.indexOf(w as When); return i < 0 ? 99 : i; };

/** What the filter lets through (done and skipped items only when asked for), most serious and most urgent first. */
export function filterItems(items: ConditionItem[], f: ConditionFilter): ConditionItem[] {
  return items
    .filter((i) => (f.showDone ? true : i.status === 'open') && (f.tg === 'all' || i.tg === f.tg) && (f.when === 'all' || i.when_kind === f.when))
    .sort((a, b) => tgRank(a.tg) - tgRank(b.tg) || whenRank(a.when_kind) - whenRank(b.when_kind) || a.part.localeCompare(b.part, 'nb'));
}

/** The items by part of the house, in a fixed order; empty groups are left out. */
export function groupByArea(items: ConditionItem[]): { area: string; items: ConditionItem[] }[] {
  const by = new Map<string, ConditionItem[]>();
  for (const i of items) by.set(i.area, [...(by.get(i.area) ?? []), i]);
  const known = AREA_ORDER.filter((a) => by.has(a)).map((a) => ({ area: a as string, items: by.get(a) as ConditionItem[] }));
  const other = [...by].filter(([a]) => !AREA_ORDER.includes(a as Area)).map(([area, list]) => ({ area, items: list }));
  return [...known, ...other];
}

export type ConditionSummary = { total: number; open: number; done: number; byTg: Record<Tg, { open: number; total: number }>; costOpen: { min: number; max: number } };

export function summarize(items: ConditionItem[]): ConditionSummary {
  const byTg = { TG3: { open: 0, total: 0 }, TG2: { open: 0, total: 0 }, HMS: { open: 0, total: 0 }, LOV: { open: 0, total: 0 } } as ConditionSummary['byTg'];
  let min = 0, max = 0, open = 0;
  for (const i of items) {
    const g = byTg[i.tg];
    if (!g) continue;
    g.total++;
    if (i.status === 'open') { g.open++; open++; min += i.cost_min ?? 0; max += i.cost_max ?? i.cost_min ?? 0; }
  }
  return { total: items.length, open, done: items.filter((i) => i.status === 'done').length, byTg, costOpen: { min, max } };
}

/** The priority a to-do made from this finding gets: serious ones high, planned ones medium, watch-only ones low. */
export function todoPriority(i: Pick<ConditionItem, 'tg' | 'when_kind'>): Priority {
  if (i.tg === 'TG3' || (i.tg === 'HMS' && i.when_kind === 'now')) return 3;
  if (i.when_kind === 'watch') return 1;
  return 2;
}

/** The text of a to-do made from a finding: the part as the title, the finding and the advice as notes, tags for the grade. */
export function todoFromItem(i: Pick<ConditionItem, 'part' | 'tg' | 'what' | 'action' | 'page' | 'cost_min' | 'cost_max'>): { body: string; notes: string; tags: string[] } {
  const cost = i.cost_min != null && i.cost_max != null ? `\nKostnadsanslag: ${nok(i.cost_min)}–${nok(i.cost_max)} kr` : '';
  return {
    body: i.part,
    notes: `${i.tg}. ${i.what}\n\nTiltak: ${i.action}${cost}${i.page ? `\n(Tilstandsrapport, side ${i.page} i PDF-en)` : ''}`.slice(0, 2000),
    tags: ['tilstandsrapport', i.tg.toLowerCase()],
  };
}

export const nok = (n: number) => n.toLocaleString('nb-NO').replace(/ /g, ' ');

/** "20 000–100 000 kr", "ca. 20 000 kr" or '' when there is no estimate. */
export function costLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return '';
  if (min != null && max != null && min !== max) return `${nok(min)}–${nok(max)} kr`;
  return `${nok((max ?? min) as number)} kr`;
}
