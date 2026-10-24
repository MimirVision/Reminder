import { describe, expect, it } from 'vitest';
import { cleanEntries, learnCodes, planImport, unknownCodes } from './roster';
import type { Shift } from './types';

let n = 0;
const id = () => `id${n++}`;

describe('reading a roster', () => {
  const raw = [
    { date: '2026-11-02', code: 'd', start: '7.30', end: '15:30', kind: 'shift' },
    { date: '2026-11-03', code: 'A', start: '', end: '', kind: 'shift' },
    { date: '2026-11-04', code: 'FE', start: '', end: '', kind: 'ferie' },
    { date: '2026-11-31', code: 'N', start: '22:00', end: '07:45', kind: 'shift' }, // no such day
    { date: '2026-11-05', code: 'D', start: '07:30', end: '15:30', kind: 'whatever' },
    { date: '2026-11-05', code: 'D', start: '07:30', end: '15:30', kind: 'shift' }, // the same again
    { date: 'tomorrow', code: 'D' },
  ];

  it('keeps only real dates and times, once each', () => {
    const e = cleanEntries(raw);
    expect(e.map((x) => `${x.date} ${x.code} ${x.start}-${x.end} ${x.kind}`)).toEqual([
      '2026-11-02 D 07:30-15:30 shift', '2026-11-03 A - shift', '2026-11-04 FE - ferie', '2026-11-05 D 07:30-15:30 shift',
    ]);
  });

  it('asks about codes without times only once, and learns codes that had times', () => {
    const e = cleanEntries(raw);
    expect(unknownCodes(e, {})).toEqual(['A']);
    const rules = learnCodes(e, {});
    expect(rules.D).toEqual({ start_time: '07:30', end_time: '15:30', break_minutes: 0 });
    expect(unknownCodes(e, { A: { start_time: '15:00', end_time: '22:30', break_minutes: 0 } })).toEqual([]);
  });

  it('plans shifts and days off, marks what she already has, and skips what it can’t place', () => {
    const e = cleanEntries(raw);
    const existing: Shift[] = [{ id: 'x', employer_id: 'e', date: '2026-11-05', start_time: '07:30', end_time: '15:30', break_minutes: 0, overtime_percent: 0, note: '', status: 'worked' }];
    const plan = planImport(e, learnCodes(e, {}), 'e', existing, [], id);
    expect(plan.map((p) => p.type)).toEqual(['shift', 'skip', 'off', 'shift']);
    expect(plan[3].type === 'shift' && plan[3].duplicate).toBe(true);
    expect(plan[0].type === 'shift' && plan[0].shift.note).toBe('GAT D');
    const withA = planImport(e, { ...learnCodes(e, {}), A: { start_time: '15:00', end_time: '22:30', break_minutes: 30 } }, 'e', [], [], id);
    expect(withA[1].type === 'shift' && withA[1].shift).toMatchObject({ start_time: '15:00', break_minutes: 30 });
    const skipA = planImport(e, { A: { skip: true } }, 'e', [], [], id);
    expect(skipA[1].type).toBe('skip');
  });
});
