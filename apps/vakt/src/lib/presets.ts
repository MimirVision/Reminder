// Common supplements in Norwegian health care, as a starting point. The amounts differ between tariffs (KS, Spekter,
// Virke …) and change every year, so onboarding asks her to check each one against the pay slip.
import { WEEKDAYS, type DayKey, type Supplement } from './types';

export const COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6', '#6366f1'];

export type Preset = Omit<Supplement, 'id' | 'sort' | 'active'> & { hint: string };

const ALL: DayKey[] = [...WEEKDAYS];

export const PRESETS: Preset[] = [
  { name: 'Kveldstillegg', hint: 'Alle dager 17–21', color: '#8b5cf6', amount_type: 'percent', amount: 25, min_per_hour: 60, days: ALL, start_time: '17:00', end_time: '21:00' },
  { name: 'Nattillegg', hint: 'Alle netter 21–06', color: '#6366f1', amount_type: 'percent', amount: 25, min_per_hour: 60, days: ALL, start_time: '21:00', end_time: '06:00' },
  { name: 'Helgetillegg', hint: 'Lørdag og søndag, hele døgnet', color: '#ec4899', amount_type: 'kr_per_hour', amount: 60, min_per_hour: null, days: ['sat', 'sun'], start_time: '00:00', end_time: '00:00' },
  { name: 'Helligdagstillegg', hint: 'Røde dager, hele døgnet', color: '#ef4444', amount_type: 'percent', amount: 133.33, min_per_hour: null, days: ['holiday'], start_time: '00:00', end_time: '00:00' },
  { name: 'Aftentillegg', hint: 'Jul-, nyttårs-, påske- og pinseaften fra 15', color: '#f59e0b', amount_type: 'percent', amount: 133.33, min_per_hour: null, days: ['holiday_eve'], start_time: '15:00', end_time: '00:00' },
];

export const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Man', tue: 'Tir', wed: 'Ons', thu: 'Tor', fri: 'Fre', sat: 'Lør', sun: 'Søn', holiday: 'Helligdag', holiday_eve: 'Dag før helligdag',
};

/** "Lør og søn, hele døgnet" / "Hverdager 17:00–21:00" */
export function describeWhen(s: Pick<Supplement, 'days' | 'start_time' | 'end_time'>): string {
  const wk = WEEKDAYS.filter((d) => s.days.includes(d));
  let days: string;
  if (wk.length === 7) days = 'Alle dager';
  else if (wk.length === 5 && !wk.includes('sat') && !wk.includes('sun')) days = 'Hverdager';
  else if (wk.length === 2 && wk.includes('sat') && wk.includes('sun')) days = 'Helg';
  else days = wk.map((d) => DAY_LABEL[d].toLowerCase()).join(', ');
  const extra = (['holiday', 'holiday_eve'] as DayKey[]).filter((d) => s.days.includes(d)).map((d) => DAY_LABEL[d].toLowerCase());
  const all = [days, ...extra].filter(Boolean).join(' + ');
  const time = s.start_time === s.end_time ? 'hele døgnet' : `${s.start_time}–${s.end_time}`;
  return `${all.charAt(0).toUpperCase()}${all.slice(1)}, ${time}`;
}

export function describeAmount(s: Pick<Supplement, 'amount_type' | 'amount' | 'min_per_hour'>): string {
  const n = (x: number) => x.toLocaleString('nb-NO', { maximumFractionDigits: 2 });
  if (s.amount_type === 'percent') return `${n(s.amount)} %${s.min_per_hour ? ` (min. ${n(s.min_per_hour)} kr/t)` : ''}`;
  if (s.amount_type === 'kr_per_shift') return `${n(s.amount)} kr per vakt`;
  return `${n(s.amount)} kr/t`;
}
