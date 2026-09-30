import { useCallback, useEffect, useMemo, useState } from 'react';
import { completeTask, listTaskEvents, listTasks, retireTask, seedHouseTemplate } from '../lib/api';
import { groupTasks, scheduleLabel } from '../lib/maintenance';
import type { HouseProfile, Household, MaintenanceEvent, MaintenanceTask } from '../lib/types';

const PROFILE: [keyof HouseProfile, string][] = [
  ['has_garden', 'Garden'],
  ['has_wood_stove', 'Wood stove / chimney'],
  ['has_heat_pump', 'Heat pump'],
  ['has_balanced_ventilation', 'Balanced ventilation (heat recovery)'],
  ['has_basement', 'Basement'],
  ['has_wooden_facade', 'Wooden facade'],
  ['has_septic', 'Private septic tank'],
  ['has_well', 'Private well'],
];

const today = () => new Date().toISOString().slice(0, 10);

export function House({ household }: { household: Household }) {
  const [tasks, setTasks] = useState<MaintenanceTask[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<HouseProfile>({
    has_garden: true, has_wood_stove: false, has_heat_pump: false, has_balanced_ventilation: false,
    has_septic: false, has_well: false, has_basement: false, has_wooden_facade: false,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<MaintenanceEvent[]>([]);
  const [showLater, setShowLater] = useState(false);

  const load = useCallback(async () => {
    try {
      setTasks(await listTasks(household.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTasks([]);
    }
  }, [household.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupTasks(tasks ?? [], today()), [tasks]);

  async function run(fn: () => Promise<void>) {
    try {
      setErr(null);
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggle(t: MaintenanceTask) {
    if (openId === t.id) return setOpenId(null);
    setOpenId(t.id);
    setCost('');
    setNote('');
    setHistory(await listTaskEvents(t.id).catch(() => []));
  }

  if (tasks === null) return <main className="muted">Loading…</main>;

  if (tasks.length === 0) {
    return (
      <main>
        <h2>Set up your house</h2>
        {err && <p className="error">{err}</p>}
        <p className="muted">
          Pick what applies and a starter maintenance calendar for a Norwegian house is added. It is a starting point you
          can edit, not professional advice. Check your kommune's rules for chimney sweeping and septic tanks.
        </p>
        <div className="item">
          {PROFILE.map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <p><button className="primary" onClick={() => void run(async () => void (await seedHouseTemplate(household.id, profile)))}>Create my maintenance calendar</button></p>
      </main>
    );
  }

  const section = (title: string, list: MaintenanceTask[]) =>
    list.length === 0 ? null : (
      <>
        <h2>{title}</h2>
        <ul className="list">
          {list.map((t) => (
            <li key={t.id} className="item">
              <div className="row spread">
                <span>
                  <strong>{t.title}</strong>
                  <span className="muted"> · {scheduleLabel(t)}{t.last_done_at ? ` · last done ${t.last_done_at}` : ' · not done yet'}</span>
                </span>
                <button onClick={() => void toggle(t)}>{openId === t.id ? 'Close' : 'Details / Done'}</button>
              </div>
              {openId === t.id && (
                <>
                  {t.notes && <p className="body">{t.notes}</p>}
                  <div className="row">
                    <input placeholder="Cost in NOK (optional)" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} style={{ maxWidth: 200 }} />
                    <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button
                      className="primary"
                      onClick={() =>
                        void run(async () => {
                          const c = cost.trim() ? Number(cost.replace(',', '.')) : null;
                          if (c !== null && Number.isNaN(c)) throw new Error('Cost must be a number');
                          await completeTask(t.id, { cost: c, note });
                          setOpenId(null);
                        })
                      }
                    >
                      Mark as done
                    </button>
                  </div>
                  {history.length > 0 && (
                    <div className="muted">
                      History
                      {history.map((h) => (
                        <div key={h.id}>{h.done_at}{h.cost_nok != null ? ` · ${h.cost_nok} kr` : ''}{h.note ? ` · ${h.note}` : ''}</div>
                      ))}
                    </div>
                  )}
                  <button className="link danger" onClick={() => confirm('Remove this from your calendar?') && void run(() => retireTask(t.id))}>Remove from calendar</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <main>
      {err && <p className="error">{err}</p>}
      {groups.due.length === 0 && groups.soon.length === 0 && <p className="muted">Nothing due. Enjoy the quiet.</p>}
      {section('Due now', groups.due)}
      {section('Coming up', groups.soon)}
      {groups.later.length > 0 && (
        <p><button className="link" onClick={() => setShowLater(!showLater)}>{showLater ? 'Hide later' : `Later (${groups.later.length})`}</button></p>
      )}
      {showLater && section('Later', groups.later)}
    </main>
  );
}
