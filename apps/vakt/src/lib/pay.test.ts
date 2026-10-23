import { describe, expect, it } from 'vitest';
import { calcShift, copySetup, holidayPayEarned, overlapMinutes, payOf, payoutsIn, repeatShifts, shiftKind, summarize, wageOn } from './pay';
import { eveName, holidayName, isHoliday } from './holidays';
import { isoWeek, toMinutes } from './dates';
import type { Employer, Shift, Supplement } from './types';
import { PRESETS, fromPreset } from './presets';

const shift = (date: string, start_time: string, end_time: string, extra: Partial<Shift> = {}): Shift =>
  ({ id: 's', employer_id: null, date, start_time, end_time, break_minutes: 0, overtime_percent: 0, note: '', status: 'worked', ...extra });

const sup = (x: Partial<Supplement>): Supplement => ({
  id: x.name ?? 'x', employer_id: 'e1', name: 'x', color: '#000', amount_type: 'kr_per_hour', amount: 0, min_per_hour: null,
  days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start_time: '00:00', end_time: '00:00', active: true, sort: 0, ...x,
});

const wages = [{ from: '2020-01-01', hourly: 300 }];
const evening = sup({ name: 'Kveld', amount_type: 'percent', amount: 25, min_per_hour: 60, start_time: '17:00', end_time: '21:00' });
const night = sup({ name: 'Natt', amount_type: 'percent', amount: 25, start_time: '21:00', end_time: '06:00' });
const weekend = sup({ name: 'Helg', amount: 60, days: ['sat', 'sun'] });
const holiday = sup({ name: 'Helligdag', amount_type: 'percent', amount: 100, days: ['holiday'] });

describe('a single shift', () => {
  it('pays the wage for the paid hours', () => {
    const p = calcShift(shift('2026-10-21', '07:30', '15:30'), [], wages); // a Wednesday
    expect(p.hours).toBe(8);
    expect(p.total).toBe(2400);
  });

  it('pays an evening supplement only for the hours inside its window, with its minimum per hour', () => {
    const p = calcShift(shift('2026-10-21', '15:00', '22:30'), [evening], wages);
    expect(p.supplements).toHaveLength(1);
    expect(p.supplements[0].hours).toBe(4);
    expect(p.supplements[0].amount).toBe(4 * 75); // 25 % of 300 = 75, above the 60 minimum
    expect(calcShift(shift('2026-10-21', '15:00', '22:30'), [evening], [{ from: '2020-01-01', hourly: 200 }]).supplements[0].amount).toBe(4 * 60);
  });

  it('runs a night shift past midnight and counts the window from the evening it starts', () => {
    const s = shift('2026-10-21', '22:00', '07:45');
    expect(calcShift(s, [], wages).hours).toBe(9.75);
    expect(overlapMinutes(s, night)).toBe(8 * 60); // 22–06
  });

  it('gives Friday night’s hours after midnight the weekend supplement (Saturday 00:00 on)', () => {
    const s = shift('2026-10-23', '22:00', '08:00'); // Friday → Saturday
    expect(overlapMinutes(s, weekend)).toBe(8 * 60);
    // and a Sunday night ends the weekend at midnight
    expect(overlapMinutes(shift('2026-10-25', '22:00', '08:00'), weekend)).toBe(2 * 60);
  });

  it('only counts a night window on the days it is set for, from the day it starts', () => {
    const weekdayNights = sup({ ...night, days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    expect(overlapMinutes(shift('2026-10-24', '22:00', '07:00'), weekdayNights)).toBe(0); // Saturday night
    expect(overlapMinutes(shift('2026-10-23', '22:00', '07:00'), weekdayNights)).toBe(8 * 60); // Friday night
    expect(overlapMinutes(shift('2026-10-26', '04:00', '08:00'), weekdayNights)).toBe(0); // Monday early: Sunday's night
  });

  it('knows Norwegian holidays and their eves', () => {
    expect(isHoliday('2026-04-05')).toBe(true); // Easter Sunday 2026
    expect(holidayName('2026-05-14')).toBe('Kristi himmelfartsdag');
    expect(eveName('2026-12-24')).toBe('Julaften');
    expect(eveName('2026-04-04')).toBe('Påskeaften');
    expect(eveName('2026-04-01')).toBe('Dagen før skjærtorsdag');
    expect(calcShift(shift('2026-12-25', '08:00', '16:00'), [holiday], wages).supplementTotal).toBe(2400);
    expect(calcShift(shift('2026-12-24', '20:00', '08:00'), [holiday], wages).supplements[0].hours).toBe(8); // into 1. juledag
  });

  it('takes an unpaid break off the wage and evenly off the supplements', () => {
    const p = calcShift(shift('2026-10-21', '15:00', '23:00', { break_minutes: 30 }), [evening], wages);
    expect(p.paidHours).toBe(7.5);
    expect(p.base).toBe(2250);
    expect(p.supplements[0].hours).toBeCloseTo(4 * 7.5 / 8);
  });

  it('adds a fixed sum per shift, and overtime on the wage', () => {
    const fixed = sup({ name: 'Ansvar', amount_type: 'kr_per_shift', amount: 150, start_time: '07:00', end_time: '15:00' });
    const p = calcShift(shift('2026-10-21', '07:30', '15:30', { overtime_percent: 50 }), [fixed], wages);
    expect(p.supplements[0].amount).toBe(150);
    expect(p.overtime).toBe(1200);
    expect(p.total).toBe(2400 + 1200 + 150);
  });

  it('skips supplements that are switched off', () => {
    expect(calcShift(shift('2026-10-24', '08:00', '16:00'), [{ ...weekend, active: false }], wages).supplements).toEqual([]);
  });

  it('uses the wage that applied on the day', () => {
    const w = [{ from: '2026-05-01', hourly: 320 }, { from: '2025-01-01', hourly: 300 }];
    expect(wageOn(w, '2026-04-30')).toBe(300);
    expect(wageOn(w, '2026-05-01')).toBe(320);
    expect(wageOn(w, '2024-01-01')).toBe(300);
    expect(wageOn([], '2026-01-01')).toBe(0);
  });
});

describe('a month and several employers', () => {
  const e1: Employer = { id: 'e1', name: 'Avd. A', color: '#000', wages, templates: [], sort: 0, pay_day: 12, pay_delay: 'supplements' };
  const e2: Employer = { id: 'e2', name: 'Avd. B', color: '#111', wages: [{ from: '2020-01-01', hourly: 250 }], templates: [{ id: 't', name: 'Dag', start_time: '08:00', end_time: '16:00', break_minutes: 0 }], sort: 1, pay_day: 20, pay_delay: 'none' };

  it('adds up shifts and ranks supplements by what they gave', () => {
    const s = summarize([shift('2026-10-24', '08:00', '16:00'), shift('2026-10-21', '15:00', '22:30')], { employers: [e1], supplements: [evening, weekend] });
    expect(s.count).toBe(2);
    expect(s.hours).toBe(15.5);
    expect(s.bySupplement.map((x) => x.name)).toEqual(['Helg', 'Kveld']);
    expect(s.total).toBeCloseTo(15.5 * 300 + 480 + 300);
  });

  it('pays each shift with its own employer’s wage and supplements, and old shifts as the first employer', () => {
    const setup = { employers: [e1, e2], supplements: [weekend, { ...weekend, id: 'w2', employer_id: 'e2', amount: 100 }] };
    expect(payOf(shift('2026-10-24', '08:00', '16:00', { employer_id: 'e2' }), setup).total).toBe(8 * 250 + 8 * 100);
    expect(payOf(shift('2026-10-24', '08:00', '16:00'), setup).total).toBe(8 * 300 + 8 * 60);
    const sum = summarize([shift('2026-10-24', '08:00', '16:00', { employer_id: 'e2' }), shift('2026-10-24', '08:00', '16:00', { employer_id: 'e1' })], setup);
    expect(sum.byEmployer.get('e2')).toBe(2800);
    expect(sum.bySupplement).toHaveLength(1); // both called Helg
    expect(sum.bySupplement[0].amount).toBe(1280);
  });

  it('copies a setup to another employer as independent copies', () => {
    let n = 0;
    const out = copySetup(e1, [weekend, evening, { ...night, employer_id: 'e2' }], e2, () => `new${n++}`);
    expect(out.employer.name).toBe('Avd. B');
    expect(out.employer.wages).toEqual(wages);
    expect(out.employer.wages).not.toBe(wages);
    expect(out.employer.templates).toEqual([]);
    expect(out.supplements.map((x) => [x.name, x.employer_id])).toEqual([['Helg', 'e2'], ['Kveld', 'e2']]);
    expect(new Set(out.supplements.map((x) => x.id)).size).toBe(2);
  });
});

describe('helpers', () => {
  it('reads times and labels shifts', () => {
    expect(toMinutes('7:30')).toBe(450);
    expect(toMinutes('0730')).toBe(450);
    expect(toMinutes('25:00')).toBeNull();
    expect(shiftKind({ start_time: '07:30', end_time: '15:30' })).toBe('Dag');
    expect(shiftKind({ start_time: '15:00', end_time: '22:30' })).toBe('Kveld');
    expect(shiftKind({ start_time: '22:00', end_time: '07:45' })).toBe('Natt');
    expect(isoWeek('2026-10-22')).toBe(43);
    expect(isoWeek('2027-01-01')).toBe(53);
  });
});

it('turns a preset (even with extra form fields on it) into exactly a supplement', () => {
  const sup = fromPreset({ ...PRESETS[0], on: true } as typeof PRESETS[0], 'e1', 'id1', 0);
  expect(Object.keys(sup).sort()).toEqual(['active', 'amount', 'amount_type', 'color', 'days', 'employer_id', 'end_time', 'id', 'min_per_hour', 'name', 'sort', 'start_time']);
});

describe('pay days, sick shifts, holiday pay and repeating', () => {
  const emp = (x: Partial<Employer>): Employer => ({ id: 'e1', name: 'A', color: '#000', wages, templates: [], sort: 0, pay_day: 12, pay_delay: 'supplements', ...x });
  const weekendE1 = { ...weekend, employer_id: 'e1' };

  it('pays the wage for the month worked and supplements the month after', () => {
    const setup = { employers: [emp({})], supplements: [weekendE1] };
    const shifts = [shift('2026-09-26', '08:00', '16:00', { employer_id: 'e1' }), shift('2026-10-03', '08:00', '16:00', { employer_id: 'e1' })]; // two Saturdays
    const oct = payoutsIn('2026-10', shifts, setup, 12);
    expect(oct).toHaveLength(1);
    expect(oct[0].date).toBe('2026-10-12');
    expect(oct[0].wage).toBe(2400); // October's shift
    expect(oct[0].variable).toBe(480); // September's weekend supplement
    expect(payoutsIn('2026-11', shifts, setup, 12)[0]).toMatchObject({ wage: 0, variable: 480 });
  });

  it('follows each employer’s pay delay and pay day (the last day in a short month)', () => {
    const shifts = [shift('2026-10-03', '08:00', '16:00', { employer_id: 'e1' })];
    const all = { employers: [emp({ pay_delay: 'all', pay_day: 31 })], supplements: [weekendE1] };
    expect(payoutsIn('2026-10', shifts, all, 12)).toEqual([]);
    expect(payoutsIn('2026-11', shifts, all, 12)[0]).toMatchObject({ date: '2026-11-30', wage: 2400, variable: 480 });
    const none = { employers: [emp({ pay_delay: 'none' })], supplements: [weekendE1] };
    expect(payoutsIn('2026-10', shifts, none, 12)[0]).toMatchObject({ wage: 2400, variable: 480 });
  });

  it('adds holiday pay for last year in June', () => {
    const setup = { employers: [emp({})], supplements: [] };
    const shifts = [shift('2025-03-04', '08:00', '16:00', { employer_id: 'e1' })];
    expect(payoutsIn('2026-06', shifts, setup, 12)[0].holiday).toBeCloseTo(288);
    expect(holidayPayEarned(2025, shifts, setup, 10.2)).toBeCloseTo(244.8);
  });

  it('pays a sick shift at the sick-pay share', () => {
    const s = shift('2026-10-24', '08:00', '16:00', { employer_id: 'e1', status: 'sick' });
    expect(payOf(s, { employers: [emp({})], supplements: [weekendE1], sickPercent: 80 }).total).toBeCloseTo((2400 + 480) * 0.8);
    expect(payOf(s, { employers: [emp({})], supplements: [weekendE1] }).total).toBe(2880);
  });

  it('repeats a rota without doubling shifts she already has', () => {
    let n = 0;
    const src = [shift('2026-10-05', '07:30', '15:30', { employer_id: 'e1' }), shift('2026-10-07', '15:00', '22:30', { employer_id: 'e1', status: 'sick' })];
    const existing = [...src, shift('2026-10-12', '07:30', '15:30', { employer_id: 'e1' })];
    const out = repeatShifts(src, 7, 2, existing, () => `n${n++}`);
    expect(out.map((s) => s.date)).toEqual(['2026-10-14', '2026-10-19', '2026-10-21']);
    expect(out.every((s) => s.status === 'worked')).toBe(true);
  });
});
