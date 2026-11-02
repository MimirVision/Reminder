import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applianceLine, buildCosts, costTotals, costYears, daysBetween, mailHref, parseAmount, safeUrl, sortAppliances, spentByItem, telHref, warrantiesEnding, warrantyReminders, warrantyState } from './register.ts';

const a = (id: string, name: string, warranty_until: string | null) => ({ id, name, warranty_until });

test('warranty states: none, running, ending soon, over', () => {
  assert.deepEqual(warrantyState(a('1', 'x', null), '2026-10-25'), { kind: 'none', days: 0 });
  assert.deepEqual(warrantyState(a('1', 'x', '2027-10-25'), '2026-10-25'), { kind: 'active', days: 365 });
  assert.deepEqual(warrantyState(a('1', 'x', '2026-12-20'), '2026-10-25'), { kind: 'soon', days: 56 });
  assert.deepEqual(warrantyState(a('1', 'x', '2026-10-25'), '2026-10-25'), { kind: 'soon', days: 0 });
  assert.deepEqual(warrantyState(a('1', 'x', '2026-10-20'), '2026-10-25'), { kind: 'expired', days: -5 });
  assert.equal(daysBetween('2026-02-27', '2026-03-01'), 2);
});

test('sorting: soonest warranty end first, over ones after, undated last', () => {
  const list = [a('1', 'Undated', null), a('2', 'Over', '2026-01-01'), a('3', 'Late', '2028-01-01'), a('4', 'Soon', '2026-11-01'), a('5', 'Also undated', null)];
  assert.deepEqual(sortAppliances(list, '2026-10-25').map((x) => x.name), ['Soon', 'Late', 'Over', 'Also undated', 'Undated']);
  assert.deepEqual(warrantiesEnding(list, '2026-10-25', 30).map((x) => [x.name, x.days]), [['Soon', 7]]);
});

test('warranty reminders: 30 days ahead at 09:00; inside the window one tomorrow; none once over', () => {
  const list = [a('1', 'Dishwasher', '2026-12-31'), a('2', 'Oven', '2026-11-05'), a('3', 'Old', '2026-10-01'), a('4', 'None', null)];
  const r = warrantyReminders(list, new Date(2026, 9, 25, 12, 0));
  assert.deepEqual(r.map((x) => x.name), ['Oven', 'Dishwasher']);
  assert.equal(r[0].at.getDate(), 26); assert.equal(r[0].at.getHours(), 9); assert.equal(r[0].days, 10);
  assert.equal(r[1].at.getMonth(), 11); assert.equal(r[1].at.getDate(), 1);
  assert.equal(warrantyReminders([a('1', 'Ends today', '2026-10-25')], new Date(2026, 9, 25, 12, 0)).length, 0, 'tomorrow would be after the end');
  assert.equal(warrantyReminders(list, new Date(2026, 9, 25), 30, 1).length, 1);
});

test('phone, mail and web links', () => {
  assert.equal(telHref('+47 123 45 678'), 'tel:+4712345678');
  assert.equal(telHref('(22) 33 44 55'), 'tel:22334455');
  assert.equal(telHref('12'), null);
  assert.equal(mailHref(' per@ror.no '), 'mailto:per@ror.no');
  assert.equal(mailHref('nope'), null);
  assert.equal(safeUrl('bosch-home.no/manual.pdf'), 'https://bosch-home.no/manual.pdf');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('  '), null);
  assert.equal(applianceLine({ brand: 'Bosch', model: 'SMV4', room: 'Kitchen' }), 'Bosch SMV4 · Kitchen');
  assert.equal(applianceLine({ brand: null, model: null, room: 'Garage' }), 'Garage');
});

test('amounts', () => {
  assert.equal(parseAmount('1 250,50'), 1250.5);
  assert.equal(parseAmount('kr 900'), 900);
  assert.equal(parseAmount('1250.5'), 1250.5);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('12,345'), null);
  assert.equal(parseAmount(''), null);
});

test('the cost list of a year joins finished jobs, extra costs and purchases', () => {
  const entries = buildCosts({
    year: 2026,
    events: [{ id: 'e1', task_id: 't1', done_at: '2026-03-10', cost_nok: 800, note: null }, { id: 'e2', task_id: 't1', done_at: '2025-03-10', cost_nok: 700, note: null }, { id: 'e3', task_id: 't2', done_at: '2026-05-01', cost_nok: null, note: 'free' }],
    taskTitles: new Map([['t1', 'Clean gutters'], ['t2', 'Smoke alarms']]),
    extras: [{ id: 'c1', household_id: 'h', title: 'Plumber visit', amount_nok: 2500, spent_on: '2026-03-12', contact_id: 'k1', appliance_id: null, task_id: null, item_id: 'i1', notes: null }],
    appliances: [{ id: 'a1', name: 'Dishwasher', purchased_on: '2026-02-02', price_nok: 6990 }, { id: 'a2', name: 'Old fridge', purchased_on: '2019-02-02', price_nok: 5000 }],
  });
  assert.deepEqual(entries.map((e) => [e.source, e.title, e.amount]), [['extra', 'Plumber visit', 2500], ['job', 'Clean gutters', 800], ['purchase', 'Dishwasher', 6990]]);
  const t = costTotals(entries);
  assert.equal(t.total, 10290); assert.equal(t.byMonth[2], 3300); assert.equal(t.byMonth[1], 6990); assert.deepEqual(t.bySource, { job: 800, extra: 2500, purchase: 6990 });
  assert.deepEqual(costYears(['2024-05-05', '2026-01-01', '1900-01-01'], 2026), [2026, 2024]);
  assert.equal(spentByItem([{ item_id: 'i1', amount_nok: 2500 }, { item_id: 'i1', amount_nok: 100.5 }, { item_id: null, amount_nok: 9 }]).get('i1'), 2600.5);
});
