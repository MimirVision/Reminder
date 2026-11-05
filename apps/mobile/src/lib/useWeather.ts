import { useCallback, useRef, useState } from 'react';
import { claimWeatherMade, releaseWeatherMade, setWeatherDone } from './api';
import { uuid } from './id';
import { tNow } from './i18n';
import { capture } from './outbox';
import { scheduleWeather, weatherState, type WeatherState } from './reminders';
import { activeAlerts, doneItems, todoRows, todosToMake, type WeatherAlert } from '../shared/lib/weather';

/** Weather alerts for the to-do list: loaded on demand (the list reload calls `refresh`). An alert that has rung makes its checklist into to-dos
 *  (once: the first device to claim it makes them); ticking an item on the card is saved and the notifications re-planned. */
export function useWeatherCard(householdId: string | undefined, onTodosMade?: () => void) {
  const [state, setState] = useState<WeatherState | null>(null);
  const madeRef = useRef(onTodosMade);
  madeRef.current = onTodosMade;
  const refresh = useCallback(async () => {
    if (!householdId) return;
    try {
      let s = await weatherState(householdId);
      let created = false;
      for (const a of todosToMake(s.alerts, new Date(), s.made)) {
        const rows = todoRows(tNow, a);
        const ids = rows.map(() => uuid());
        let claimed = false;
        try {
          if (!(await claimWeatherMade(householdId, a.rule.id, a.forDate, ids))) continue;
          claimed = true;
          for (const [i, row] of rows.entries()) await capture({ id: ids[i], household_id: householdId, body: row.body, place_id: null, capture_lat: null, capture_lon: null, due_on: row.due_on, notes: row.notes, tags: row.tags, photoUris: [] });
          s = { ...s, made: [...s.made, { rule_id: a.rule.id, for_date: a.forDate, memory_ids: ids }] };
          created = true;
        } catch {
          // Before the database update: the card shows instead. A claim without its to-dos is given back so the next load tries again.
          if (claimed) void releaseWeatherMade(a.rule.id, a.forDate);
        }
      }
      setState(s);
      if (created) madeRef.current?.();
    } catch { /* before the upgrade, or offline: no card */ }
  }, [householdId]);
  const tick = useCallback(async (a: WeatherAlert, item: string) => {
    if (!householdId || !state) return;
    const cur = doneItems(a, state.done);
    const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
    setState({ ...state, done: [...state.done.filter((x) => !(x.rule_id === a.rule.id && x.for_date === a.forDate)), { rule_id: a.rule.id, for_date: a.forDate, items: next }] });
    try { await setWeatherDone(householdId, a.rule.id, a.forDate, next); void scheduleWeather(householdId); } catch { void refresh(); }
  }, [householdId, state, refresh]);
  return { done: state?.done ?? [], active: state ? activeAlerts(state.alerts, new Date(), state.done, state.made) : [], refresh, tick };
}
