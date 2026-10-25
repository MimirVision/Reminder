import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeAlerts, forecastPlace, matchesDay, notificationBody, notificationsFor, parseForecast, planWeather, reasonText, ruleSummary, spellStarts, starterRule, type DayForecast, type WeatherRule } from './weather.ts';

const day = (date: string, o: Partial<DayForecast> = {}): DayForecast => ({ date, rainMm: 0, snowCm: 0, tMin: 5, tMax: 12, windMs: 3, code: 3, ...o });
const rule = (o: Partial<WeatherRule> = {}): WeatherRule => ({
  id: 'r1', household_id: 'h', name: 'Rain', scenario: 'rain', threshold: null, items: ['Pillows', 'Sandpit'], lead: 'evening_before', at_time: '18:00',
  frequency: 'spell', dry_gap: 2, quiet_days: [], paused_until: null, follow_up: true, enabled: true, ...o,
});
// 2026-10-26 is a Monday.
const week = [
  day('2026-10-24'), day('2026-10-25'), day('2026-10-26'), day('2026-10-27', { rainMm: 6 }), day('2026-10-28', { rainMm: 8 }),
  day('2026-10-29', { rainMm: 3 }), day('2026-10-30'), day('2026-10-31'), day('2026-11-01', { rainMm: 4 }),
];

test('scenarios match their own weather only', () => {
  assert.equal(matchesDay(rule(), day('d', { rainMm: 1 })), false);
  assert.equal(matchesDay(rule(), day('d', { rainMm: 2 })), true);
  assert.equal(matchesDay(rule({ scenario: 'frost' }), day('d', { tMin: -1 })), true);
  assert.equal(matchesDay(rule({ scenario: 'frost' }), day('d', { tMin: 1 })), false);
  assert.equal(matchesDay(rule({ scenario: 'wind', threshold: 14 }), day('d', { windMs: 12 })), false);
  assert.equal(matchesDay(rule({ scenario: 'heat' }), day('d', { tMax: 27 })), true);
  assert.equal(matchesDay(rule({ scenario: 'storm' }), day('d', { code: 96 })), true);
  assert.equal(matchesDay(rule({ scenario: 'storm' }), day('d', { code: 61 })), false);
});

test('a spell gives one alert, on its first day', () => {
  assert.deepEqual(spellStarts(rule(), week), ['2026-10-27', '2026-11-01']);
  const plan = planWeather(rule(), week, '2026-10-26');
  assert.deepEqual(plan.map((a) => a.forDate), ['2026-10-27', '2026-11-01']);
});

test('one dry day inside a spell does not start a new one, a longer gap does', () => {
  const gap1 = [day('2026-10-26', { rainMm: 5 }), day('2026-10-27'), day('2026-10-28', { rainMm: 5 })];
  assert.deepEqual(spellStarts(rule({ dry_gap: 2 }), gap1), ['2026-10-26']);
  assert.deepEqual(spellStarts(rule({ dry_gap: 1 }), gap1), ['2026-10-26', '2026-10-28']);
});

test('a spell already under way (rain in the past days) is not announced again', () => {
  const f = [day('2026-10-24', { rainMm: 5 }), day('2026-10-25', { rainMm: 5 }), day('2026-10-26', { rainMm: 5 })];
  assert.deepEqual(planWeather(rule(), f, '2026-10-25').map((a) => a.forDate), []);
});

test('every matching day mode', () => {
  assert.deepEqual(planWeather(rule({ frequency: 'every' }), week, '2026-10-26').map((a) => a.forDate), ['2026-10-27', '2026-10-28', '2026-10-29', '2026-11-01']);
});

test('evening before rings the day before at the chosen time; same morning rings that day', () => {
  const a = planWeather(rule(), week, '2026-10-26')[0];
  assert.equal(a.at.getDate(), 26); assert.equal(a.at.getHours(), 18);
  const b = planWeather(rule({ lead: 'same_morning', at_time: '07:30' }), week, '2026-10-26')[0];
  assert.equal(b.at.getDate(), 27); assert.equal(b.at.getHours(), 7); assert.equal(b.at.getMinutes(), 30);
});

test('quiet weekdays, pause and disabled rules', () => {
  assert.deepEqual(planWeather(rule({ quiet_days: [1] }), week, '2026-10-26').map((a) => a.forDate), ['2026-11-01']); // Monday 26th is quiet
  assert.deepEqual(planWeather(rule({ paused_until: '2026-10-30' }), week, '2026-10-26').map((a) => a.forDate), ['2026-11-01']);
  assert.deepEqual(planWeather(rule({ enabled: false }), week, '2026-10-26'), []);
});

test('notifications: only the future, one follow-up, none once everything is ticked', () => {
  const alerts = planWeather(rule(), week, '2026-10-26');
  const now = new Date(2026, 9, 26, 12, 0);
  const n = notificationsFor(alerts, now, []);
  assert.equal(n.filter((x) => !x.followUp).length, 2);
  assert.equal(n.filter((x) => x.followUp).length, 2);
  assert.equal(n[0].id, 'wx-r1-2026-10-27');
  const ticked = notificationsFor(alerts, now, [{ rule_id: 'r1', for_date: '2026-10-27', items: ['Pillows', 'Sandpit'] }]);
  assert.equal(ticked.some((x) => x.alert.forDate === '2026-10-27'), false);
  assert.equal(notificationsFor(planWeather(rule({ follow_up: false }), week, '2026-10-26'), now, []).some((x) => x.followUp), false);
});

test('the card shows once an alert has rung, for today and tomorrow only', () => {
  const alerts = planWeather(rule(), week, '2026-10-26');
  assert.equal(activeAlerts(alerts, new Date(2026, 9, 26, 12, 0), []).length, 0); // not yet 18:00
  assert.equal(activeAlerts(alerts, new Date(2026, 9, 26, 19, 0), []).length, 1);
  assert.equal(activeAlerts(alerts, new Date(2026, 9, 27, 9, 0), []).length, 1); // the day itself
  assert.equal(activeAlerts(alerts, new Date(2026, 9, 26, 19, 0), [{ rule_id: 'r1', for_date: '2026-10-27', items: ['Pillows', 'Sandpit'] }]).length, 0);
});

test('parseForecast reads the daily block and treats gaps as calm', () => {
  const days = parseForecast({ daily: { time: ['2026-10-26', '2026-10-27'], rain_sum: [1.5, null], snowfall_sum: [0, 2], temperature_2m_min: [3, -2], temperature_2m_max: [9, 4], wind_speed_10m_max: [4, null], weather_code: [61, 73] } });
  assert.equal(days[0].rainMm, 1.5); assert.equal(days[1].rainMm, 0); assert.equal(days[1].snowCm, 2); assert.equal(days[1].tMin, -2); assert.equal(days[1].windMs, 0);
  assert.deepEqual(parseForecast(null), []);
});

test('the forecast place: chosen, else home by name, else the first fixed place', () => {
  const places = [
    { id: 'a', name: 'Meny', kind: 'fixed', lat: 1, lon: 1 }, { id: 'b', name: 'Home', kind: 'fixed', lat: 2, lon: 2 },
    { id: 'c', name: 'Pharmacy', kind: 'category', lat: null, lon: null },
  ];
  assert.equal(forecastPlace(places, null)?.id, 'b');
  assert.equal(forecastPlace(places, 'a')?.id, 'a');
  assert.equal(forecastPlace(places.slice(0, 1), null)?.id, 'a');
  assert.equal(forecastPlace([places[2]], null), null);
});

test('texts: starter rules, reason line and notification body in both languages', async () => {
  const { makeT } = await import('../i18n/core.ts');
  const en = makeT('en');
  const nb = makeT('nb');
  const r = starterRule(en, 'rain');
  assert.equal(r.name, 'Rain coming'); assert.equal(r.items.length, 4); assert.equal(r.lead, 'evening_before');
  assert.equal(starterRule(nb, 'frost').lead, 'same_morning');
  const alert = planWeather({ ...rule(), ...r, id: 'r1', household_id: 'h' }, week, '2026-10-26')[0];
  assert.equal(reasonText(en, alert), 'Rain tomorrow, about 6 mm');
  assert.equal(reasonText(nb, alert), 'Regn i morgen, rundt 6 mm');
  assert.match(notificationBody(en, alert, [{ rule_id: 'r1', for_date: '2026-10-27', items: ['Take in the pillows'] }]), /^Rain tomorrow, about 6 mm — Cover the sandpit/);
  assert.match(ruleSummary(en, { ...rule(), ...r, id: 'r1', household_id: 'h' }), /Rain ≥ 2 mm · the evening before at 18:00, once per spell/);
});
