import { expect, it } from 'vitest';
import { shiftsCsv } from './export';

it('writes shifts as a Norwegian spreadsheet', () => {
  const csv = shiftsCsv([
    { id: 'b', employer_id: 'e', date: '2026-10-22', start_time: '22:00', end_time: '07:00', break_minutes: 0, overtime_percent: 0, note: 'Ekstra; natt', status: 'sick' },
    { id: 'a', employer_id: 'e', date: '2026-10-21', start_time: '07:30', end_time: '15:30', break_minutes: 30, overtime_percent: 0, note: '', status: 'worked' },
  ], { employers: [{ id: 'e', name: 'Avd. 2', color: '#000', wages: [{ from: '2000-01-01', hourly: 300 }], templates: [], sort: 0, pay_day: 12, pay_delay: 'supplements' }], supplements: [], sickPercent: 50 });
  const lines = csv.replace('﻿', '').split('\r\n');
  expect(lines[0]).toMatch(/^Dato;Dag;Arbeidsgiver/);
  expect(lines[1]).toBe('2026-10-21;onsdag;Avd. 2;07:30;15:30;30;7,50;Jobbet;2250,00;0,00;0,00;2250,00;');
  expect(lines[2]).toBe('2026-10-22;torsdag;Avd. 2;22:00;07:00;0;9,00;Syk;1350,00;0,00;0,00;1350,00;"Ekstra; natt"');
});
