// Weather reminders: "rain tomorrow, so take in the pillows". Pure planning on top of a daily forecast (Open-Meteo), unit tested.
// A rule has a scenario (rain, snow, frost, wind, heat, storm), a checklist, and a nagging policy: once per spell, or every matching day.
import type { Key, T } from '../i18n/core';

export type Scenario = 'rain' | 'snow' | 'frost' | 'wind' | 'heat' | 'storm';
export const SCENARIOS: Scenario[] = ['rain', 'snow', 'frost', 'wind', 'heat', 'storm'];
export type Lead = 'evening_before' | 'same_morning';
export type Frequency = 'spell' | 'every';

export type DayForecast = { date: string; rainMm: number; snowCm: number; tMin: number; tMax: number; windMs: number; code: number };

export type WeatherRule = {
  id: string; household_id: string; name: string; scenario: Scenario; threshold: number | null; items: string[];
  lead: Lead; at_time: string; frequency: Frequency; dry_gap: number; quiet_days: number[]; paused_until: string | null;
  follow_up: boolean; enabled: boolean;
};
export type WeatherDone = { rule_id: string; for_date: string; items: string[] };

/** What a rule measures, its unit and the value used when none is chosen. */
export const SCENARIO_DEFAULT: Record<Scenario, { threshold: number | null; unit: string; step: number }> = {
  rain: { threshold: 2, unit: 'mm', step: 1 },
  snow: { threshold: 1, unit: 'cm', step: 1 },
  frost: { threshold: 0, unit: '°C', step: 1 },
  wind: { threshold: 10, unit: 'm/s', step: 1 },
  heat: { threshold: 25, unit: '°C', step: 1 },
  storm: { threshold: null, unit: '', step: 1 },
};

export const thresholdOf = (r: Pick<WeatherRule, 'scenario' | 'threshold'>): number | null =>
  r.threshold ?? SCENARIO_DEFAULT[r.scenario].threshold;

/** The value the scenario looks at for one day, for the one-line reason. */
export function measure(s: Scenario, d: DayForecast): number {
  switch (s) {
    case 'rain': return d.rainMm;
    case 'snow': return d.snowCm;
    case 'frost': return d.tMin;
    case 'wind': return d.windMs;
    case 'heat': return d.tMax;
    case 'storm': return d.code;
  }
}

export function matchesDay(rule: Pick<WeatherRule, 'scenario' | 'threshold'>, d: DayForecast): boolean {
  const th = thresholdOf(rule);
  switch (rule.scenario) {
    case 'rain': return d.rainMm >= (th ?? 2) && d.rainMm > 0;
    case 'snow': return d.snowCm >= (th ?? 1) && d.snowCm > 0;
    case 'frost': return d.tMin <= (th ?? 0);
    case 'wind': return d.windMs >= (th ?? 10);
    case 'heat': return d.tMax >= (th ?? 25);
    case 'storm': return d.code >= 95 && d.code <= 99;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (iso: string, h = 0, m = 0) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), h, m, 0, 0);
const addDays = (iso: string, n: number) => isoOf(new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));

/** Days that start a spell: matching days with no matching day in the `dryGap` days before (so one dry day in between does not start a new spell).
 *  The forecast should include a few past days, so a spell already under way is not counted as new. */
export function spellStarts(rule: Pick<WeatherRule, 'scenario' | 'threshold' | 'dry_gap'>, days: DayForecast[]): string[] {
  const hit = new Set(days.filter((d) => matchesDay(rule, d)).map((d) => d.date));
  const starts: string[] = [];
  for (const date of [...hit].sort()) {
    let quiet = true;
    for (let k = 1; k <= Math.max(1, rule.dry_gap); k++) if (hit.has(addDays(date, -k))) { quiet = false; break; }
    if (quiet) starts.push(date);
  }
  return starts;
}

export type WeatherAlert = { rule: WeatherRule; forDate: string; day: DayForecast; at: Date; followUpAt: Date | null };

const parseTime = (t: string): [number, number] => { const [h, m] = t.split(':').map(Number); return [h || 0, m || 0]; };

/** The alerts a rule produces from a forecast: the day each is about, and when it should ring. Alerts whose time has passed are kept
 *  (flagged by `at <= now`) so the app can still show them as a card on the day; callers schedule only the future ones. */
export function planWeather(rule: WeatherRule, days: DayForecast[], today: string): WeatherAlert[] {
  if (!rule.enabled) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = rule.frequency === 'every' ? days.filter((d) => matchesDay(rule, d)).map((d) => d.date) : spellStarts(rule, days);
  const [h, m] = parseTime(rule.at_time);
  const out: WeatherAlert[] = [];
  for (const forDate of dates.sort()) {
    if (forDate < today) continue;
    const fireDay = rule.lead === 'evening_before' ? addDays(forDate, -1) : forDate;
    if (rule.paused_until && fireDay <= rule.paused_until) continue;
    if (rule.quiet_days.includes(dateOf(fireDay).getDay())) continue;
    const at = dateOf(fireDay, h, m);
    out.push({ rule, forDate, day: byDate.get(forDate) as DayForecast, at, followUpAt: rule.follow_up ? new Date(at.getTime() + 90 * 60_000) : null });
  }
  return out;
}

/** Alerts to show as a card now: they have rung (or would have) and the day is today or tomorrow. */
export function activeAlerts(alerts: WeatherAlert[], now: Date, done: WeatherDone[]): WeatherAlert[] {
  const today = isoOf(now);
  const tomorrow = addDays(today, 1);
  return alerts.filter((a) => a.at.getTime() <= now.getTime() && (a.forDate === today || a.forDate === tomorrow) && !allDone(a, done));
}

export const doneItems = (a: Pick<WeatherAlert, 'rule' | 'forDate'>, done: WeatherDone[]): string[] =>
  done.find((d) => d.rule_id === a.rule.id && d.for_date === a.forDate)?.items ?? [];
export const allDone = (a: Pick<WeatherAlert, 'rule' | 'forDate'>, done: WeatherDone[]): boolean =>
  a.rule.items.length > 0 && a.rule.items.every((i) => doneItems(a, done).includes(i));

/** Notifications to schedule: the alert and, when asked for and not all ticked, one follow-up. Only those still ahead. */
export function notificationsFor(alerts: WeatherAlert[], now: Date, done: WeatherDone[], max = 8): { id: string; at: Date; alert: WeatherAlert; followUp: boolean }[] {
  const out: { id: string; at: Date; alert: WeatherAlert; followUp: boolean }[] = [];
  for (const a of alerts) {
    if (allDone(a, done) || a.rule.items.length === 0) continue;
    if (a.at.getTime() > now.getTime()) out.push({ id: `wx-${a.rule.id}-${a.forDate}`, at: a.at, alert: a, followUp: false });
    if (a.followUpAt && a.followUpAt.getTime() > now.getTime()) out.push({ id: `wx-${a.rule.id}-${a.forDate}-f`, at: a.followUpAt, alert: a, followUp: true });
  }
  return out.sort((x, y) => x.at.getTime() - y.at.getTime()).slice(0, max);
}

// ---- Forecast ---------------------------------------------------------------------------------------------------------------
/** Parses Open-Meteo's `daily` block. Missing numbers count as 0 so a gap never raises a false alarm. */
export function parseForecast(json: unknown): DayForecast[] {
  const d = (json as { daily?: Record<string, (number | null)[] | string[]> } | null)?.daily;
  if (!d || !Array.isArray(d.time)) return [];
  const num = (key: string, i: number, fallback = 0) => {
    const v = (d[key] as (number | null)[] | undefined)?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  return (d.time as string[]).map((date, i) => ({
    date, rainMm: num('rain_sum', i), snowCm: num('snowfall_sum', i), tMin: num('temperature_2m_min', i, 10), tMax: num('temperature_2m_max', i, 10),
    windMs: num('wind_speed_10m_max', i), code: num('weather_code', i),
  }));
}

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3), timezone: 'auto', wind_speed_unit: 'ms', past_days: '3', forecast_days: '7',
    daily: 'rain_sum,snowfall_sum,temperature_2m_min,temperature_2m_max,wind_speed_10m_max,weather_code',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

type Cache = { key: string; at: number; days: DayForecast[] };
const CACHE_KEY = 'hm.weatherForecast';
const FRESH_MS = 60 * 60_000;

/** The forecast for a place, kept for an hour so reopening the app does not ask again. Falls back to the last copy when offline. */
export async function loadForecast(lat: number, lon: number, now = Date.now()): Promise<DayForecast[]> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let cached: Cache | null = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null; } catch { /* no cache */ }
  if (cached && cached.key === key && now - cached.at < FRESH_MS) return cached.days;
  try {
    const res = await fetch(forecastUrl(lat, lon));
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const days = parseForecast(await res.json());
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, at: now, days } satisfies Cache)); } catch { /* best effort */ }
    return days;
  } catch (e) {
    if (cached && cached.key === key) return cached.days;
    throw e;
  }
}

/** Which place the forecast is for: the chosen one, else one named like home, else the first fixed place with coordinates. */
export function forecastPlace<P extends { id: string; name: string; kind: string; lat: number | null; lon: number | null }>(places: P[], chosenId: string | null): P | null {
  const fixed = places.filter((p) => p.kind === 'fixed' && p.lat != null && p.lon != null);
  return fixed.find((p) => p.id === chosenId) ?? fixed.find((p) => /^(home|hjem|house|huset|bolig)\b/i.test(p.name.trim())) ?? fixed[0] ?? null;
}

/** One-line reason parts for the notification, e.g. { key: 'rain', value: 6 }. */
export const reasonOf = (s: Scenario, d: DayForecast): { value: number } => ({ value: Math.round(measure(s, d) * 10) / 10 });

/** A starter checklist per scenario; the texts come from the language files (weather.starter.<scenario>.<n>). */
export const STARTER_ITEMS: Record<Scenario, number> = { rain: 4, snow: 4, frost: 4, wind: 4, heat: 3, storm: 3 };

export type RuleDraft = Omit<WeatherRule, 'id' | 'household_id'> & { id?: string };

/** A new rule for a scenario, with the name and checklist in the current language. */
export function starterRule(t: T, scenario: Scenario): RuleDraft {
  const items: string[] = [];
  for (let i = 1; i <= STARTER_ITEMS[scenario]; i++) items.push(t(`weather.starter.${scenario}.${i}` as Key));
  return {
    name: t(`weather.starter.${scenario}.name` as Key), scenario, threshold: null, items, lead: scenario === 'frost' || scenario === 'heat' ? 'same_morning' : 'evening_before',
    at_time: scenario === 'frost' || scenario === 'heat' ? '07:30' : '18:00', frequency: 'spell', dry_gap: 2, quiet_days: [], paused_until: null, follow_up: true, enabled: true,
  };
}

/** "Rain tomorrow, about 6 mm": the reason line of a notification or card. "Tomorrow" is relative to the day the alert rings. */
export function reasonText(t: T, a: Pick<WeatherAlert, 'rule' | 'forDate' | 'day' | 'at'>): string {
  const when = t(a.forDate === isoOf(a.at) ? 'weather.when.today' : 'weather.when.tomorrow');
  return t(`weather.reason.${a.rule.scenario}` as Key, { when, value: reasonOf(a.rule.scenario, a.day).value });
}

/** Notification body: the reason, then the items still to do. */
export function notificationBody(t: T, a: WeatherAlert, done: WeatherDone[]): string {
  const left = a.rule.items.filter((i) => !doneItems(a, done).includes(i));
  return [reasonText(t, a), left.join(' · ')].filter(Boolean).join(' — ');
}

/** One line under a rule in the list: how often and when. */
export function ruleSummary(t: T, r: WeatherRule): string {
  const th = thresholdOf(r);
  const unit = SCENARIO_DEFAULT[r.scenario].unit;
  const when = t(`weather.summary.${r.lead}` as Key, { time: r.at_time });
  return [t(`weather.s.${r.scenario}` as Key) + (th != null ? ` ${r.scenario === 'frost' ? '≤' : '≥'} ${th} ${unit}` : ''), t(`weather.summary.${r.frequency}` as Key, { when })].join(' · ');
}
