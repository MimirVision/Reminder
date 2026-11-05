import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addMemory, claimWeatherMade, releaseWeatherMade, listMembers, listMemoryStatuses, listWeatherDone, listWeatherMade, listWeatherPlaces, listWeatherRules, setWeatherDone } from './api';
import { useI18n } from '../i18n';
import { supabase } from './supabase';
import type { Member } from './types';
import { activeAlerts, buildAlerts, doneFromTodos, doneItems, homeOf, isoOf, loadForecast, mergeDone, neededPlaces, todoRows, todosToMake, type DayForecast, type WeatherAlert, type WeatherDone, type WeatherMade, type WeatherPlace, type WeatherRule } from './weather';

const MISSING = /weather_places|weather_rules|weather_done|schema cache|does not exist/i;

/** Rules, the places the weather is checked for, their forecasts, what has been ticked off, and the alerts that follow. Quiet (no forecast request) while no rule is on. */
export function useWeather(householdId: string, onTodosMade?: () => void) {
  const { t } = useI18n();
  const madeRef = useRef(onTodosMade);
  madeRef.current = onTodosMade;
  const [rules, setRules] = useState<WeatherRule[] | null>(null);
  const [places, setPlaces] = useState<WeatherPlace[]>([]);
  const [forecasts, setForecasts] = useState<Record<string, DayForecast[]>>({});
  const [done, setDone] = useState<WeatherDone[]>([]);
  const [made, setMade] = useState<WeatherMade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const load = useCallback(async () => {
    try {
      const today = isoOf(new Date());
      const [r, p, d] = await Promise.all([listWeatherRules(householdId), listWeatherPlaces(householdId), listWeatherDone(householdId, today)]);
      setRules(r); setPlaces(p); setDone(d); setError(null); setNeedsUpgrade(false);
      void supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
      void listMembers(householdId).then(setMembers).catch(() => {});
      const out: Record<string, DayForecast[]> = {};
      let failed: string | null = null;
      await Promise.all(neededPlaces(r, p).map(async (pl) => { try { out[pl.id] = await loadForecast(pl.lat, pl.lon); } catch (e) { failed = e instanceof Error ? e.message : String(e); } }));
      setForecasts(out); setForecastError(failed);
      // The checklist of an alert that has rung becomes to-dos (once: the first device to claim it makes them), and finished to-dos count as ticked.
      let madeList: WeatherMade[] = await listWeatherMade(householdId, today).catch(() => []);
      const alertsNow = buildAlerts({ rules: r, places: p, forecasts: out, today, userId: (await supabase.auth.getSession()).data.session?.user.id ?? null });
      let created = false;
      for (const a of todosToMake(alertsNow, new Date(), madeList)) {
        const rows = todoRows(t, a);
        const ids = rows.map(() => crypto.randomUUID());
        let claimed = false;
        try {
          if (!(await claimWeatherMade(householdId, a.rule.id, a.forDate, ids))) continue;
          claimed = true;
          for (const [i, row] of rows.entries()) await addMemory({ id: ids[i], household_id: householdId, body: row.body, due_on: row.due_on, notes: row.notes, tags: row.tags });
          madeList = [...madeList, { rule_id: a.rule.id, for_date: a.forDate, memory_ids: ids }];
          created = true;
        } catch {
          // Before the database update, or offline: the card shows instead. A claim without its to-dos is given back so the next load tries again.
          if (claimed) void releaseWeatherMade(a.rule.id, a.forDate);
        }
      }
      setMade(madeList);
      const statuses = await listMemoryStatuses(madeList.flatMap((m) => m.memory_ids)).catch(() => []);
      setDone((cur) => mergeDone(cur, doneFromTodos(madeList, statuses)));
      if (created) madeRef.current?.();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setRules((cur) => cur ?? []);
      if (MISSING.test(m)) setNeedsUpgrade(true); else setError(m);
    }
  }, [householdId, t]);
  useEffect(() => { void load(); }, [load]);

  const alerts = useMemo<WeatherAlert[]>(() => buildAlerts({ rules: rules ?? [], places, forecasts, today: isoOf(new Date()), userId }), [rules, places, forecasts, userId]);

  const tick = useCallback(async (a: WeatherAlert, item: string) => {
    const cur = doneItems(a, done);
    const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
    setDone((d) => [...d.filter((x) => !(x.rule_id === a.rule.id && x.for_date === a.forDate)), { rule_id: a.rule.id, for_date: a.forDate, items: next }]);
    try { await setWeatherDone(householdId, a.rule.id, a.forDate, next); } catch (e) { setError(e instanceof Error ? e.message : String(e)); void load(); }
  }, [done, householdId, load]);

  return { rules, places, home: homeOf(places), forecasts, done, alerts, made, error, needsUpgrade, forecastError, userId, members, reload: load, tick, active: activeAlerts(alerts, new Date(), done, made) };
}
