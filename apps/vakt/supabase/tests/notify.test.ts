import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bundleNotify } from '../build-function.mjs';
import { osloNow, planOwner, type OwnerRows } from '../functions/vakt-notify/plan.ts';

it('dashboard/vakt-notify.ts matches the function (run npm run build:function after changing it)', () => {
  expect(readFileSync(new URL('../dashboard/vakt-notify.ts', import.meta.url), 'utf8')).toBe(bundleNotify());
});

// Oslo is UTC+2 in summer time (until 25 October 2026) and UTC+1 after.
const oslo = (iso: string) => Date.parse(iso);

const rows = (x: Partial<OwnerRows> = {}): OwnerRows => ({
  ownerId: 'o',
  settings: { onboarded: true },
  employers: [{ id: 'e', name: 'A', color: '#000', wages: [{ from: '2000-01-01', hourly: 300 }], templates: [], sort: 0, pay_day: 12, pay_delay: 'supplements' }],
  supplements: [],
  shifts: [{ id: 's1', employer_id: 'e', date: '2026-10-21', start_time: '15:00', end_time: '22:30', break_minutes: 0, overtime_percent: 0, note: '', status: 'worked' }],
  ...x,
});

describe('reminders', () => {
  it('reads the time in Oslo, summer and winter time', () => {
    expect(osloNow(oslo('2026-10-21T20:00:00Z'))).toEqual({ date: '2026-10-21', minutes: 22 * 60 });
    expect(osloNow(oslo('2026-12-31T23:30:00Z'))).toEqual({ date: '2027-01-01', minutes: 30 });
  });

  it('says what a shift paid half an hour after it ends, once, and not hours later', () => {
    expect(planOwner(rows(), oslo('2026-10-21T20:50:00Z'))).toEqual([]); // 22:50, too early
    const m = planOwner(rows(), oslo('2026-10-21T21:05:00Z')); // 23:05
    expect(m).toHaveLength(1);
    expect(m[0].key).toBe('after:s1:2026-10-21:22:30');
    expect(m[0].body).toMatch(/2\s250 kr/);
    expect(planOwner(rows(), oslo('2026-10-22T03:00:00Z'))).toEqual([]); // 05:00 next day: too late
  });

  it('handles a night shift ending the next morning, and skips sick shifts', () => {
    const night = rows({ shifts: [{ ...rows().shifts[0], start_time: '22:00', end_time: '07:45' }] });
    expect(planOwner(night, oslo('2026-10-22T06:30:00Z'))).toHaveLength(1); // 08:30 the next day
    const sick = rows({ shifts: [{ ...rows().shifts[0], status: 'sick' }] });
    expect(planOwner(sick, oslo('2026-10-21T21:05:00Z'))).toEqual([]);
  });

  it('asks for next week’s shifts on Sunday evening only when there are none', () => {
    const sunday = oslo('2026-10-25T18:30:00Z'); // 19:30 in Oslo (winter time)
    expect(planOwner(rows(), sunday).map((m) => m.key)).toEqual(['week:2026-10-26']);
    const planned = rows({ shifts: [{ ...rows().shifts[0], date: '2026-10-28' }] });
    expect(planOwner(planned, sunday)).toEqual([]);
  });

  it('asks for next month’s shifts six days before the month ends', () => {
    const m = planOwner(rows(), oslo('2026-10-26T18:00:00Z')); // 26 October, 19:00
    expect(m.map((x) => x.key)).toEqual(['month:2026-11']);
    expect(m[0].title).toMatch(/november/);
  });

  it('respects the switches in Oppsett and sends nothing before onboarding', () => {
    expect(planOwner(rows({ settings: { onboarded: true, reminders: { after_shift: false } } }), oslo('2026-10-21T21:05:00Z'))).toEqual([]);
    expect(planOwner(rows({ settings: {} }), oslo('2026-10-21T21:05:00Z'))).toEqual([]);
  });
});

it('reminds about the pay settlement on 1 September when this year’s wage is missing', () => {
  const sept = Date.parse('2026-09-01T17:00:00Z'); // 19:00 in Oslo
  expect(planOwner(rows(), sept).map((m) => m.key)).toContain('wage:2026');
  expect(planOwner(rows({ settings: { onboarded: true, wage_checked_year: 2026 } }), sept).map((m) => m.key)).not.toContain('wage:2026');
});
