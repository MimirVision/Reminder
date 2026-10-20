import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickadd';

const today = '2026-10-16'; // a Friday
const clients = [
  { id: 'n', name: 'Nordvik Snekkeri AS', reference: 'C-1001', status: 'active' as const },
  { id: 'f', name: 'Fjellbris Kafé AS', reference: 'C-1002', status: 'active' as const },
  { id: 'h', name: 'Havbris Eiendom AS', reference: 'C-1003', status: 'active' as const },
  { id: 's', name: 'Sjøgløtt Fisk AS', reference: 'C-1019', status: 'archived' as const },
];
const p = (s: string) => parseQuickAdd(s, clients, today);

describe('quick add', () => {
  it('reads client, date, priority and tags, and leaves a clean title', () => {
    expect(p('Chase receipts @nordvik fri !high #receipts')).toEqual({
      title: 'Chase receipts', clientId: 'n', clientBy: 'mention', due: '2026-10-23', dueText: 'fri', priority: 'high', tags: ['receipts'], time: null,
    });
  });

  it('finds a client by a distinctive word of its name, or by reference', () => {
    expect(p('Call Fjellbris about VAT tomorrow')).toMatchObject({ title: 'Call about VAT', clientId: 'f', clientBy: 'name', due: '2026-10-17' });
    expect(p('Year-end @c-1003')).toMatchObject({ clientId: 'h', title: 'Year-end' });
  });

  it('does not guess when unsure', () => {
    expect(p('Monthly bookkeeping review')).toMatchObject({ clientId: null, title: 'Monthly bookkeeping review' });
    expect(p('Chase @sjøgløtt')).toMatchObject({ clientId: null }); // archived
    expect(p('Fix 32.13 issue')).toMatchObject({ due: null });
  });

  it('understands common date phrases in English and Norwegian', () => {
    expect(p('x today').due).toBe('2026-10-16');
    expect(p('x i morgen').due).toBe('2026-10-17');
    expect(p('x next week').due).toBe('2026-10-19');
    expect(p('x friday').due).toBe('2026-10-23');
    expect(p('x mandag').due).toBe('2026-10-19');
    expect(p('x in 3 days').due).toBe('2026-10-19');
    expect(p('x om 2 uker').due).toBe('2026-10-30');
    expect(p('x 15.11').due).toBe('2026-11-15');
    expect(p('x 3/2').due).toBe('2027-02-03');
    expect(p('x 15 nov').due).toBe('2026-11-15');
    expect(p('x nov 15').due).toBe('2026-11-15');
    expect(p('x 2027-01-31').due).toBe('2027-01-31');
    expect(p('x eom').due).toBe('2026-10-31');
    expect(p('x 29.02').due).toBe('2028-02-29');
  });

  it('reads priority shorthands', () => {
    expect(p('x !').priority).toBe('high');
    expect(p('x !!').priority).toBe('urgent');
    expect(p('x p4').priority).toBe('low');
  });
});

describe('dates without a year', () => {
  it('keep a recently passed date in this year, and move older ones to next year', () => {
    expect(p('Deliver VAT 12.10').due).toBe('2026-10-12');
    expect(p('x 20.8').due).toBe('2026-08-20');
    expect(p('x 1.6').due).toBe('2027-06-01');
    expect(p('x 15.11').due).toBe('2026-11-15');
  });
});

describe('times', () => {
  it('reads a time of day, so the line can become a meeting', () => {
    expect(p('Call Nordvik fri 10:00')).toMatchObject({ title: 'Call', clientId: 'n', due: '2026-10-23', time: '10:00' });
    expect(p('Møte @fjellbris i morgen kl 9').time).toBe('09:00');
    expect(p('Review kl. 14.30').time).toBe('14:30');
    expect(p('Budget at 13').time).toBe('13:00');
    expect(p('VAT 12.10')).toMatchObject({ time: null, due: '2026-10-12' });
    expect(p('Meeting 25:00').time).toBeNull();
  });
});
