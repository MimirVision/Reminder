import { FormEvent, useState } from 'react';
import { addTask } from '../lib/api';
import type { Household } from '../lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INTERVALS: [number, string][] = [[1, 'Monthly'], [3, '3 months'], [6, '6 months'], [12, 'Yearly'], [24, '2 years'], [60, '5 years']];

// Your own recurring task ("oil the terrace every year", "clean the gutters every autumn").
export function AddTaskForm({ household, onDone }: { household: Household; onDone: () => void }) {
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
      <select value={value} onChange={(e) => set(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
    </label>
  );

  return (
    <form className="card" onSubmit={submit}>
      <h2>New recurring task</h2>
      <input placeholder="What needs doing? (e.g. Oil the terrace)" required value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="row">
        <button type="button" className={`btn small${kind === 'interval' ? ' primary' : ''}`} onClick={() => setKind('interval')}>Every so often</button>
        <button type="button" className={`btn small${kind === 'seasonal' ? ' primary' : ''}`} onClick={() => setKind('seasonal')}>Same time each year</button>
      </div>
      {kind === 'interval' ? (
        <div className="row">{INTERVALS.map(([n, label]) => (
          <button type="button" key={n} className={`btn small${months === n ? ' primary' : ''}`} onClick={() => setMonths(n)}>{label}</button>
        ))}</div>
      ) : (
        <div className="row">{monthSelect(ws, setWs, 'From')}{monthSelect(we, setWe, 'Until')}</div>
      )}
      <label className="muted">Last done (optional) <input type="date" value={lastDone} onChange={(e) => setLastDone(e.target.value)} style={{ width: 'auto' }} /></label>
      {err && <p className="error">{err}</p>}
      <button className="btn primary">Add task</button>
      <button type="button" className="btn" onClick={onDone}>Cancel</button>
    </form>
  );
}
