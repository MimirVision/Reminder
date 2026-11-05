import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PROFILE, PREP_ITEMS, addMonths, applies, byExpiry, cardText, daysUntil, expiringSoon, expiryDigests, expiryState, haveQty, itemStates, missingItems, parseMonthDate, readiness,
  shoppingLine, stormAhead, suggestedExpiry, targetQty, type PrepProfile, type PrepStock,
} from './prep.ts';

const P = (o: Partial<PrepProfile> = {}): PrepProfile => ({ ...DEFAULT_PROFILE, ...o });
const S = (id: string, key: string | null, qty: number, expires_on: string | null = null, name = key ?? 'x'): PrepStock => ({ id, key, name, category: 'food', qty, unit: null, expires_on, renew_months: null, location: null, notes: null });
const item = (k: string) => PREP_ITEMS.find((i) => i.key === k)!;

test('quantities scale with people, days and pets', () => {
  assert.equal(targetQty(item('water'), P()), 42, '2 people x 7 days x 3 litres');
  assert.equal(targetQty(item('water'), P({ adults: 2, children: 2 })), 84);
  assert.equal(targetQty(item('water'), P({ pets: 1 })), 42 + 4, 'half a litre a day for the dog, rounded up');
  assert.equal(targetQty(item('water'), P({ days: 3 })), 18);
  assert.equal(targetQty(item('flashlight'), P({ adults: 2, children: 3 })), 2, 'one per adult');
  assert.equal(targetQty(item('sleeping_bag'), P({ adults: 2, children: 3 })), 5, 'one each');
  assert.equal(targetQty(item('toilet_paper'), P()), 6);
  assert.equal(targetQty(item('water'), P({ overrides: { water: 30 } })), 30, 'your own number wins');
  assert.equal(targetQty(item('iodine'), P({ iodine_people: 3 })), 3);
});

test('some items only apply when they are relevant', () => {
  const keys = (p: PrepProfile) => PREP_ITEMS.filter((i) => applies(i, p)).map((i) => i.key);
  assert.equal(keys(P()).includes('pet_food'), false);
  assert.equal(keys(P({ pets: 2 })).includes('pet_food'), true);
  assert.equal(keys(P()).includes('diapers'), false);
  assert.equal(keys(P({ baby: true })).includes('diapers'), true);
  assert.equal(keys(P()).includes('firewood'), false);
  assert.equal(keys(P({ wood_stove: true })).includes('firewood'), true);
  assert.equal(keys(P()).includes('iodine'), false);
  assert.equal(keys(P({ iodine_people: 1 })).includes('iodine'), true);
});

test('stock adds up per item and the missing amount follows', () => {
  const stock = [S('1', 'water', 12), S('2', 'water', 6), S('3', 'radio', 1), S('4', null, 5)];
  assert.equal(haveQty(stock, 'water'), 18);
  const states = itemStates(P(), stock);
  const water = states.find((s) => s.item.key === 'water')!;
  assert.deepEqual([water.target, water.have, water.missing, water.done], [42, 18, 24, false]);
  assert.equal(states.find((s) => s.item.key === 'radio')!.done, true);
  const miss = missingItems(P(), stock);
  assert.equal(miss.some((m) => m.item.key === 'radio'), false);
  assert.equal(miss.some((m) => m.item.key === 'period'), false, 'optional items are not counted as missing');
  assert.equal(shoppingLine(water, 'nb'), 'Drikkevann: 24 liter');
  assert.equal(shoppingLine(water, 'en'), 'Drinking water: 24 litres');
});

test('readiness: days are limited by water, meals and warmth; the weakest is named', () => {
  const empty = readiness(P(), []);
  assert.equal(empty.days, 0); assert.equal(empty.percent, 0);
  const stock = [S('1', 'water', 21), S('2', 'food_ready', 14), S('3', 'food_dry', 14), S('4', 'sleeping_bag', 2)];
  const r = readiness(P(), stock);
  assert.equal(r.waterDays, 3.5); assert.equal(r.mealDays, 7); assert.equal(r.heatDays, 7);
  assert.equal(r.days, 3.5, 'water runs out first'); assert.equal(r.weakest, 'water');
  const full = readiness(P(), itemStates(P(), []).map((s, i) => S(String(i), s.item.key, s.target)));
  assert.equal(full.days, 7); assert.equal(full.percent, 100); assert.equal(full.weakest, null);
  assert.ok((readiness(P(), stock).byCat.water?.pct ?? 0) > 0);
});

test('dates: months clamp, month-year as printed on a package, expiry states', () => {
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(parseMonthDate('03/2027'), '2027-03-31');
  assert.equal(parseMonthDate('2028-02'), '2028-02-29');
  assert.equal(parseMonthDate('13/2027'), null);
  assert.equal(parseMonthDate('soon'), null);
  assert.equal(daysUntil('2026-12-01', '2026-11-01'), 30);
  assert.equal(expiryState(null, '2026-11-01', 30), 'none');
  assert.equal(expiryState('2026-10-31', '2026-11-01', 30), 'expired');
  assert.equal(expiryState('2026-12-01', '2026-11-01', 30), 'soon');
  assert.equal(expiryState('2026-12-02', '2026-11-01', 30), 'ok');
  assert.equal(suggestedExpiry(item('food_ready'), '2026-11-05'), '2028-11-05');
  assert.equal(suggestedExpiry(item('radio'), '2026-11-05'), null);
});

test('expiring soon is sorted, and digests group items by reminder day (30 days ahead, 09:00)', () => {
  const stock = [S('a', 'x', 1, '2027-01-10', 'Rice'), S('b', 'x', 1, '2027-01-10', 'Beans'), S('c', 'x', 1, '2026-10-01', 'Old tuna'), S('d', 'x', 1, '2027-06-01', 'Cans'), S('e', 'x', 1, null, 'No date')];
  const now = new Date(2026, 10, 5, 12, 0);
  assert.deepEqual(expiringSoon(stock, '2026-11-05', 90).map((s) => s.id), ['c', 'a', 'b']);
  assert.deepEqual(byExpiry(stock).map((s) => s.id), ['c', 'b', 'a', 'd', 'e'], 'soonest first, ties by name, undated last');
  const d = expiryDigests(stock, now, 30, 3);
  assert.equal(d.length, 3);
  assert.equal(d[0].at.getDate(), 6, 'what has already expired is reported tomorrow morning');
  assert.equal(d[0].at.getMonth(), 10); assert.equal(d[0].at.getHours(), 9);
  assert.deepEqual(d[0].names, ['Old tuna']); assert.equal(d[0].expired, 1);
  assert.equal(d[1].count, 2, 'two items with the same date share one notification');
  assert.equal(d[1].at.getFullYear(), 2026); assert.equal(d[1].at.getMonth(), 11); assert.equal(d[1].at.getDate(), 11);
  assert.equal(expiryDigests(stock, now, 30, 1).length, 1);
  assert.equal(expiryDigests([S('z', 'x', 1, null)], now, 30).length, 0);
});

test('storm ahead: wind, thunder, a lot of snow, hard frost, within four days', () => {
  const d = (date: string, o = {}) => ({ date, windMs: 3, snowCm: 0, tMin: 2, code: 3, ...o });
  assert.equal(stormAhead([d('2026-11-05'), d('2026-11-06')], '2026-11-05'), null);
  assert.deepEqual(stormAhead([d('2026-11-05'), d('2026-11-06', { windMs: 17 })], '2026-11-05'), { kind: 'wind', date: '2026-11-06' });
  assert.equal(stormAhead([d('2026-11-05', { code: 96 })], '2026-11-05')?.kind, 'storm');
  assert.equal(stormAhead([d('2026-11-05', { snowCm: 12 })], '2026-11-05')?.kind, 'snow');
  assert.equal(stormAhead([d('2026-11-05', { tMin: -18 })], '2026-11-05')?.kind, 'frost');
  assert.equal(stormAhead([d('2026-11-02', { windMs: 20 })], '2026-11-05'), null, 'past days do not count');
});

test('the fridge card lists numbers, the plan and what is missing', () => {
  const text = cardText('nb', P({ meeting_place: 'Ved bjørka', outside_contact: 'Mamma 900 00 000' }), [S('1', 'radio', 1)]);
  assert.match(text, /BEREDSKAPSKORT/); assert.match(text, /116 117 {2}Legevakt/); assert.match(text, /22 59 13 00/);
  assert.match(text, /Møtested: Ved bjørka/); assert.match(text, /Mangler:/); assert.match(text, /- Drikkevann: 42 liter/);
  assert.doesNotMatch(text, /Batteridrevet DAB-radio/);
  assert.match(cardText('en', P(), []), /PREPAREDNESS CARD/);
});
