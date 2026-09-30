import { useCallback, useEffect, useMemo, useState } from 'react';
import { completeTask, listTaskEvents, listTasks, retireTask, seedHouseTemplate } from '../lib/api';
import { groupTasks, scheduleLabel } from '../lib/maintenance';
import type { HouseProfile, Household, MaintenanceEvent, MaintenanceTask } from '../lib/types';
import { Icon } from './icons';
import { AddTaskForm } from './AddTaskForm';
import { FactsView } from './FactsView';
import { ReportImport } from './ReportImport';

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
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const today = () => new Date().toISOString().slice(0, 10);

function Ribbon({ t }: { t: MaintenanceTask }) {
  if (t.schedule !== 'seasonal' || !t.window_start_month || !t.window_end_month) return null;
  const s = t.window_start_month, e = t.window_end_month, now = new Date().getMonth() + 1;
  return (
    <div className="ribbon" aria-label={scheduleLabel(t)}>
      {MONTHS.map((m, idx) => {
        const i = idx + 1;
        const on = s <= e ? i >= s && i <= e : i >= s || i <= e;
        return <span key={idx} className={`${on ? 'on' : ''} ${i === now ? 'now' : ''}`}>{m}</span>;
      })}
    </div>
  );
}

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
  const [mode, setMode] = useState<'Calendar' | 'Facts'>(() => {
    // The setup checklist can send you straight to the Facts tab (once).
    try { const m = sessionStorage.getItem('hm.houseMode'); sessionStorage.removeItem('hm.houseMode'); return m === 'Facts' ? 'Facts' : 'Calendar'; } catch { return 'Calendar'; }
  });
  const [addingTask, setAddingTask] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try { setTasks(await listTasks(household.id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setTasks([]); }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupTasks(tasks ?? [], today()), [tasks]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function toggle(t: MaintenanceTask) {
    if (openId === t.id) return setOpenId(null);
    setOpenId(t.id); setCost(''); setNote('');
    setHistory(await listTaskEvents(t.id).catch(() => []));
  }

  if (tasks === null) return <main className="page"><span className="muted">Loading…</span></main>;

  const toggle2 = (
    <div className="row">
      {(['Calendar', 'Facts'] as const).map((m) => <button key={m} className={`btn small${mode === m ? ' primary' : ''}`} onClick={() => setMode(m)}>{m}</button>)}
    </div>
  );

  if (mode === 'Facts') {
    return <main className="page"><h1>House</h1>{toggle2}<FactsView household={household} /></main>;
  }

  if (tasks.length === 0) {
    return (
      <main className="page">
        <h1>House</h1>
        {toggle2}
        {err && <p className="error">{err}</p>}
        <span className="muted">
          Pick what applies and a starter maintenance calendar for a Norwegian house is added. It is a starting point you can
          edit, not professional advice. Check your kommune's rules for chimney sweeping and septic tanks.
        </span>
        <div className="card">
          {PROFILE.map(([k, label]) => (
            <label key={k} className="row" style={{ gap: 10 }}>
              <input type="checkbox" style={{ width: 20, height: 20 }} checked={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <button className="btn primary" onClick={() => void run(async () => void (await seedHouseTemplate(household.id, profile)))}>Create my maintenance calendar</button>
      </main>
    );
  }

  const section = (title: string, list: MaintenanceTask[]) =>
    list.length === 0 ? null : (
      <>
        <div className="label">{title}</div>
        {list.map((t) => (
          <div className="card" key={t.id}>
            <div className="todo">
              <button className="check" aria-label="Details and mark as done" onClick={() => void toggle(t)} />
              <div className="text">
                <button className="link" style={{ textAlign: 'left', color: 'var(--ink)', font: '600 18px/24px var(--font-body)' }} onClick={() => void toggle(t)}>{t.title}</button>
                <span className="muted">{scheduleLabel(t)}{t.last_done_at ? ` · last done ${t.last_done_at}` : ' · not done yet'}</span>
              </div>
            </div>
            <Ribbon t={t} />
            {openId === t.id && (
              <>
                {t.notes && <p className="muted" style={{ margin: 0, fontSize: 15 }}>{t.notes}</p>}
                <div className="row">
                  <input placeholder="Cost in NOK (optional)" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} style={{ maxWidth: 200 }} />
                  <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                  <button className="btn primary" onClick={() => void run(async () => {
                    const c = cost.trim() ? Number(cost.replace(',', '.')) : null;
                    if (c !== null && Number.isNaN(c)) throw new Error('Cost must be a number');
                    await completeTask(t.id, { cost: c, note });
                    setOpenId(null);
                  })}><Icon name="check" size={16} /> Mark as done</button>
                </div>
                {history.length > 0 && (
                  <div className="muted">History{history.map((h) => <div key={h.id}>{h.done_at}{h.cost_nok != null ? ` · ${h.cost_nok} kr` : ''}{h.note ? ` · ${h.note}` : ''}</div>)}</div>
                )}
                <button className="link danger" style={{ textAlign: 'left' }} onClick={() => confirm('Remove this from your calendar?') && void run(() => retireTask(t.id))}>Remove from calendar</button>
              </>
            )}
          </div>
        ))}
      </>
    );

  return (
    <main className="page">
      <h1>House</h1>
      {toggle2}
      {addingTask
        ? <AddTaskForm household={household} onDone={() => { setAddingTask(false); void load(); }} />
        : <button className="btn" onClick={() => setAddingTask(true)}>+ Add your own task</button>}
      {err && <p className="error">{err}</p>}
      {groups.due.length === 0 && groups.soon.length === 0 && <p className="muted">Nothing due. Enjoy the quiet.</p>}
      {section('Due now', groups.due)}
      {section('Coming up', groups.soon)}
      {groups.later.length > 0 && <button className="btn" onClick={() => setShowLater(!showLater)}>{showLater ? 'Hide later' : `Later (${groups.later.length})`}</button>}
      {showLater && section('Later', groups.later)}
      <div className="label">Bought a house?</div>
      {importing
        ? <ReportImport household={household} onClose={() => setImporting(false)} onAdded={() => {}} />
        : <button className="btn" onClick={() => setImporting(true)}>Import the tilstandsrapport (PDF)</button>}
    </main>
  );
}
