import type { T } from '../i18n/core';

// Keep in sync with supabase/functions/import-report/logic.ts (types and findingToTodo)
export type Finding = {
  title: string;
  part: string;
  tg: 'TG3' | 'TG2' | 'TGIU';
  what: string;
  action: string;
  horizon: 'now' | '1-3 years' | '3-5 years' | '5-10 years' | 'unknown';
  estimate_nok_min: number;
  estimate_nok_max: number;
};
export type ReportSummary = { build_year: number | null; summary: string; findings: Finding[] };
const nok = (n: number) => n.toLocaleString('nb-NO').replace(/\u00a0/g, ' ');

// The to-do text saved for a finding: the title, then the grade, timing, cost and what was found.
export function findingToTodo(f: Finding, t: T): string {
  const bits = [`${f.tg}${f.part ? ` · ${f.part}` : ''}`];
  if (f.horizon !== 'unknown') bits.push(f.horizon === 'now' ? t('report.soon') : t('report.within', { h: f.horizon.replace(' years', '') }));
  if (f.estimate_nok_max > 0) bits.push(f.estimate_nok_min === f.estimate_nok_max ? `~${nok(f.estimate_nok_max)} kr` : `${nok(f.estimate_nok_min)}–${nok(f.estimate_nok_max)} kr`);
  const detail = [f.action, f.what].filter(Boolean).join(' ');
  return `${f.title}\n${bits.join(' · ')}${detail ? `\n${detail}` : ''}`;
}
