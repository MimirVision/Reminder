import { useCallback, useState } from 'react';
import { setWeatherDone } from './api';
import { scheduleWeather, weatherState, type WeatherState } from './reminders';
import { activeAlerts, doneItems, type WeatherAlert } from '../shared/lib/weather';

/** Weather alerts for the to-do list: loaded on demand (the list reload calls `refresh`), ticking an item is saved and the notifications re-planned. */
export function useWeatherCard(householdId: string | undefined) {
  const [state, setState] = useState<WeatherState | null>(null);
  const refresh = useCallback(async () => {
    if (!householdId) return;
    try { setState(await weatherState(householdId)); } catch { /* before the upgrade, or offline: no card */ }
  }, [householdId]);
  const tick = useCallback(async (a: WeatherAlert, item: string) => {
    if (!householdId || !state) return;
    const cur = doneItems(a, state.done);
    const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
    setState({ ...state, done: [...state.done.filter((x) => !(x.rule_id === a.rule.id && x.for_date === a.forDate)), { rule_id: a.rule.id, for_date: a.forDate, items: next }] });
    try { await setWeatherDone(householdId, a.rule.id, a.forDate, next); void scheduleWeather(householdId); } catch { void refresh(); }
  }, [householdId, state, refresh]);
  return { done: state?.done ?? [], active: state ? activeAlerts(state.alerts, new Date(), state.done) : [], refresh, tick };
}
