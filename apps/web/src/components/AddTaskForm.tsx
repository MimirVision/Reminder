import { FormEvent, useState } from 'react';
import { addTask } from '../lib/api';
import type { Household } from '../lib/types';
import { useI18n, type Key } from '../i18n';

const INTERVALS = [1, 3, 6, 12, 24, 60];
const intervalKey = (n: number): Key => (n === 1 ? 'task.i1' : `task.i${n}` as Key);

// Your own recurring task ("oil the terrace every year", "clean the gutters every autumn").
export function AddTaskForm({ household, onDone }: { household: Household; onDone: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [kind, setKind] = useState<'interval' | 'seasonal'>('interval');
  const [months, setMonths] = useState(12);
  const [ws, setWs] = useState(9);
  const [we, setWe] = useState(10);
  const [lastDone, setLastDone] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await addTask({
        householdId: household.id, title: title.trim(), notes, schedule: kind,
        intervalMonths: kind === 'interval' ? months : undefined,
        windowStart: kind === 'seasonal' ? ws : undefined, windowEnd: kind === 'seasonal' ? we : undefined,
        lastDone: lastDone || null,
      });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  const monthSelect = (value: number, set: (n: number) => void, label: string) => (
    <label className="muted">{label}{' '}
      <select value={value} onChange={(e) => set(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{t(`month.${i + 1}` as 'month.1')}</option>)}</select>
    </label>
  );

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('task.new')}</h2>
      <input placeholder={t('task.titlePh')} required value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder={t('task.notesPh')} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="chips">
        <button type="button" className={`chipbtn${kind === 'interval' ? ' on' : ''}`} onClick={() => setKind('interval')}>{t('task.interval')}</button>
        <button type="button" className={`chipbtn${kind === 'seasonal' ? ' on' : ''}`} onClick={() => setKind('seasonal')}>{t('task.seasonal')}</button>
      </div>
      {kind === 'interval' ? (
        <div className="chips">{INTERVALS.map((n) => (
          <button type="button" key={n} className={`chipbtn${months === n ? ' on' : ''}`} onClick={() => setMonths(n)}>{t(intervalKey(n))}</button>
        ))}</div>
      ) : (
        <div className="row">{monthSelect(ws, setWs, t('task.from'))}{monthSelect(we, setWe, t('task.until'))}</div>
      )}
      <label className="muted">{t('task.lastDone')} <input type="date" className="autowidth" value={lastDone} onChange={(e) => setLastDone(e.target.value)} /></label>
      {err && <p className="error">{err}</p>}
      <button className="btn primary">{t('task.add')}</button>
      <button type="button" className="btn" onClick={onDone}>{t('common.cancel')}</button>
    </form>
  );
}
