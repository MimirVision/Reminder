import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPlaces, listWeatherDone, listWeatherRules, setWeatherDone } from './api';
import type { Place } from './types';
import { activeAlerts, doneItems, forecastPlace, isoOf, loadForecast, planWeather, type DayForecast, type WeatherAlert, type WeatherDone, type WeatherRule } from './weather';

const PLACE_KEY = 'hm.weatherPlace';
export const readWeatherPlace = (): string | null => { try { return localStorage.getItem(PLACE_KEY); } catch { return null; } };
export const writeWeatherPlace = (id: string | null) => { try { if (id) localStorage.setItem(PLACE_KEY, id); else localStorage.removeItem(PLACE_KEY); } catch { /* ignore */ } };

/** Rules, the forecast for the home place, what has been ticked off, and the alerts that follow. Quiet (no forecast request) while there are no rules. */
export function useWeather(householdId: string) {
  const [rules, setRules] = useState<WeatherRule[] | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [days, setDays] = useState<DayForecast[]>([]);
  const [done, setDone] = useState<WeatherDone[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const today = isoOf(new Date());
      const [r, p, d] = await Promise.all([listWeatherRules(householdId), listPlaces(householdId), listWeatherDone(householdId, today)]);
      setRules(r); setPlaces(p); setDone(d); setError(null);
      const place = forecastPlace(p, readWeatherPlace());
      if (r.some((x) => x.enabled) && place) setDays(await loadForecast(place.lat as number, place.lon as number));
    } catch (e) {
      setRules((cur) => cur ?? []);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const alerts = useMemo<WeatherAlert[]>(() => {
    const today = isoOf(new Date());
    return (rules ?? []).flatMap((r) => planWeather(r, days, today));
  }, [rules, days]);

  const tick = useCallback(async (a: WeatherAlert, item: string) => {
    const cur = doneItems(a, done);
    const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
    setDone((d) => [...d.filter((x) => !(x.rule_id === a.rule.id && x.for_date === a.forDate)), { rule_id: a.rule.id, for_date: a.forDate, items: next }]);
    try { await setWeatherDone(householdId, a.rule.id, a.forDate, next); } catch (e) { setError(e instanceof Error ? e.message : String(e)); void load(); }
  }, [done, householdId, load]);

  const place = forecastPlace(places, readWeatherPlace());
  return { rules, places, place, days, done, alerts, error, reload: load, tick, active: activeAlerts(alerts, new Date(), done) };
}
