// The shifts as a spreadsheet (CSV with ; and decimal commas, as Norwegian Excel and Numbers expect), to check
// against a pay slip or send to the pay office.
import { weekday } from './dates';
import { WEEKDAY_LONG } from './format';
import { employerOf, payOf } from './pay';
import type { Setup, Shift } from './types';

const cell = (v: string | number) => {
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function shiftsCsv(shifts: Shift[], setup: Setup): string {
  const head = ['Dato', 'Dag', 'Arbeidsgiver', 'Fra', 'Til', 'Pause (min)', 'Betalte timer', 'Status', 'Timelønn', 'Tillegg', 'Overtid', 'Totalt', 'Notat'];
  const rows = [...shifts].sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)).map((s) => {
    const p = payOf(s, setup);
    return [
      s.date, WEEKDAY_LONG[weekday(s.date) - 1], employerOf(s, setup.employers)?.name ?? '', s.start_time, s.end_time, String(s.break_minutes),
      p.paidHours, s.status === 'sick' ? 'Syk' : 'Jobbet', p.base, p.supplementTotal, p.overtime, p.total, s.note,
    ].map(cell).join(';');
  });
  // The byte order mark makes Excel read æ, ø and å correctly.
  return '﻿' + [head.join(';'), ...rows].join('\r\n');
}

/** Shares the file on a phone (Save to Files, Mail, …) where that is possible; downloads it otherwise. */
export async function saveFile(name: string, text: string) {
  const file = new File([text], name, { type: 'text/csv' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
