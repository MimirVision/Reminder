import { useCallback, useEffect, useMemo, useState } from 'react';
import { completeTask, listTaskEvents, listTasks, retireTask, seedHouseTemplate } from '../lib/api';
import { groupTasks } from '../lib/maintenance';
import { scheduleLabel, taskNotes, taskTitle } from '../lib/labels';
import type { HouseProfile, Household, MaintenanceEvent, MaintenanceTask } from '../lib/types';
import { useI18n } from '../i18n';
import { todayISO } from '../lib/when';
import { Icon } from './icons';
import { AddTaskForm } from './AddTaskForm';
import { FactsView } from './FactsView';
import { MovingView } from './MovingView';
import { ReportImport } from './ReportImport';
import { useToast } from './Toast';

const PROFILE: (keyof HouseProfile)[] = ['has_garden', 'has_wood_stove', 'has_heat_pump', 'has_balanced_ventilation', 'has_basement', 'has_wooden_facade', 'has_septic', 'has_well'];

function Ribbon({ task }: { task: MaintenanceTask }) {
  const { t } = useI18n();
  if (task.schedule !== 'seasonal' || !task.window_start_month || !task.window_end_month) return null;
  const s = task.window_start_month, e = task.window_end_month, now = new Date().getMonth() + 1;
  return (
    <div className="ribbon" aria-label={scheduleLabel(task, t)}>
      {t('ribbon.months').split('').map((m, idx) => {
        const i = idx + 1;
        const on = s <= e ? i >= s && i <= e : i >= s || i <= e;
        return <span key={idx} className={`${on ? 'on' : ''} ${i === now ? 'now' : ''}`}>{m}</span>;
      })}
    </div>
  );
}

export function House({ household }: { household: Household }) {
  const { t, lang } = useI18n();
  const toast = useToast();
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
  const [mode, setMode] = useState<'calendar' | 'facts' | 'moving'>(() => {
    // The setup checklist can send you straight to the Facts tab (once).
    try { const m = sessionStorage.getItem('hm.houseMode'); sessionStorage.removeItem('hm.houseMode'); return m === 'Facts' ? 'facts' : 'calendar'; } catch { return 'calendar'; }
  });
  const [addingTask, setAddingTask] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try { setTasks(await listTasks(household.id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setTasks([]); }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupTasks(tasks ?? [], todayISO()), [tasks]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function toggle(task: MaintenanceTask) {
    if (openId === task.id) return setOpenId(null);
    setOpenId(task.id); setCost(''); setNote('');
    setHistory(await listTaskEvents(task.id).catch(() => []));
  }

  if (tasks === null) return <main className="page"><span className="muted">{t('common.loading')}</span></main>;

  const switcher = (
    <div className="seg glass" role="group">
      {(['calendar', 'facts', 'moving'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{t(`house.${m}` as const)}</button>)}
    </div>
  );
  const head = <div className="head"><h1>{t('house.title')}</h1>{switcher}</div>;

  if (mode === 'moving') return <main className="page">{head}<MovingView household={household} /></main>;
  if (mode === 'facts') return <main className="page">{head}<FactsView household={household} /></main>;

  if (tasks.length === 0) {
    return (
      <main className="page">
        {head}
        {err && <p className="error">{err}</p>}
        <span className="muted">{t('house.intro')}</span>
        <div className="card">
          {PROFILE.map((k) => (
            <label key={k} className="row checkrow">
              <input type="checkbox" checked={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.checked })} />
              {t(`prof.${k}` as const)}
            </label>
          ))}
        </div>
        <button className="btn primary big" onClick={() => void run(async () => void (await seedHouseTemplate(household.id, profile)))}>{t('house.create')}</button>
      </main>
    );
  }

  const section = (title: string, list: MaintenanceTask[]) =>
    list.length === 0 ? null : (
      <>
        <div className="label">{title}</div>
        {list.map((task) => {
          const notes = taskNotes(task, lang);
          return (
            <div className="card" key={task.id}>
              <div className="todo">
                <button className="check" aria-label={t('house.details')} onClick={() => void toggle(task)} />
                <div className="text">
                  <button className="body" onClick={() => void toggle(task)}>{taskTitle(task, lang)}</button>
                  <span className="muted">{scheduleLabel(task, t)} · {task.last_done_at ? t('house.lastDone', { date: task.last_done_at }) : t('house.notDone')}</span>
                </div>
              </div>
              <Ribbon task={task} />
              {openId === task.id && (
                <>
                  {notes && <p className="muted notes">{notes}</p>}
                  <div className="row">
                    <input className="narrowfield" placeholder={t('house.cost')} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
                    <input className="growfield" placeholder={t('house.note')} value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn primary" onClick={() => void run(async () => {
                      const c = cost.trim() ? Number(cost.replace(',', '.')) : null;
                      if (c !== null && Number.isNaN(c)) throw new Error(t('house.costNumber'));
                      await completeTask(task.id, { cost: c, note });
                      setOpenId(null);
                      toast({ text: t('toast.done') });
                    })}><Icon name="check" size={16} /> {t('house.markDone')}</button>
                  </div>
                  {history.length > 0 && (
                    <div className="muted">{t('house.history')}{history.map((h) => <div key={h.id}>{h.done_at}{h.cost_nok != null ? ` · ${h.cost_nok} kr` : ''}{h.note ? ` · ${h.note}` : ''}</div>)}</div>
                  )}
                  <button className="link danger left" onClick={() => confirm(t('house.confirmRemove')) && void run(() => retireTask(task.id))}>{t('house.remove')}</button>
                </>
              )}
            </div>
          );
        })}
      </>
    );

  return (
    <main className="page">
      {head}
      {addingTask
        ? <AddTaskForm household={household} onDone={() => { setAddingTask(false); void load(); }} />
        : <button className="btn" onClick={() => setAddingTask(true)}>{t('house.addOwn')}</button>}
      {err && <p className="error">{err}</p>}
      {groups.due.length === 0 && groups.soon.length === 0 && <p className="muted">{t('house.nothingDue')}</p>}
      {section(t('house.due'), groups.due)}
      {section(t('house.soon'), groups.soon)}
      {groups.later.length > 0 && <button className="btn" onClick={() => setShowLater(!showLater)}>{showLater ? t('house.hideLater') : t('house.laterN', { n: groups.later.length })}</button>}
      {showLater && section(t('house.later'), groups.later)}
      <div className="label">{t('house.bought')}</div>
      {importing
        ? <ReportImport household={household} onClose={() => setImporting(false)} onAdded={() => {}} />
        : <button className="btn" onClick={() => setImporting(true)}>{t('house.import')}</button>}
    </main>
  );
}
