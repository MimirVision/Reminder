import { expect, it } from 'vitest';
import { wageCheckDue } from './wage';
import type { Employer } from './types';

const emp = (from: string): Employer => ({ id: 'e', name: 'A', color: '#000', wages: [{ from, hourly: 300 }], templates: [], sort: 0, pay_day: 12, pay_delay: 'supplements' });

it('asks about the pay settlement from June, once a year, until a new wage is in', () => {
  expect(wageCheckDue([emp('2000-01-01')], '2026-05-20', null)).toBeNull();
  expect(wageCheckDue([emp('2000-01-01')], '2026-06-02', null)).toBe(2026);
  expect(wageCheckDue([emp('2000-01-01')], '2026-06-02', 2026)).toBeNull();
  expect(wageCheckDue([emp('2026-05-01')], '2026-09-01', null)).toBeNull();
  expect(wageCheckDue([emp('2026-05-01'), emp('2025-05-01')], '2026-09-01', 2025)).toBe(2026);
});
