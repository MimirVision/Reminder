import { useCallback, useEffect, useState } from 'react';
import { addFact, deleteFact, listFacts } from '../lib/api';
import { FACT_LABELS, groupFacts, type Fact, type FactCategory } from '../lib/facts';
import type { Household } from '../lib/types';

const SHOPS: [string, string][] = [['hardware', 'Hardware'], ['paint', 'Paint'], ['garden', 'Garden'], ['grocery', 'Grocery'], ['pharmacy', 'Pharmacy']];

// What size was it? Where is the shutoff? Emergency facts come first.
export function FactsView({ household }: { household: Household }) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState<FactCategory>('other');
  const [shops, setShops] = useState<string[]>([]);

  const load = useCallback(async () => {
    try { setFacts(await listFacts(household.id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const groups = groupFacts(facts);
  return (
    <>
      <span className="muted">What size was it? Where is the shutoff? Save it once. Tag a fact with a shop and it shows on that store's list.</span>
      {err && <p className="error">{err}</p>}
      {groups.length === 0 && <p className="muted">No facts yet. Start with where the water shutoff and fuse box are.</p>}
      {groups.map((g) => (
        <div key={g.category} style={{ display: 'contents' }}>
          <div className="label">{g.category === 'emergency' ? 'Emergency card' : g.label}</div>
          {g.items.map((f) => (
            <div className="card" key={f.id}>
              <strong style={{ fontSize: g.category === 'emergency' ? 20 : 17 }}>{f.title}</strong>
              {f.value && <span style={{ whiteSpace: 'pre-wrap', fontSize: g.category === 'emergency' ? 18 : 16 }}>{f.value}</span>}
              {f.surface_at.length > 0 && <span className="muted">Shown at: {f.surface_at.join(', ')}</span>}
              <div className="row"><button className="btn small danger" onClick={() => confirm('Delete this fact?') && void run(() => deleteFact(f.id))}>Delete</button></div>
            </div>
          ))}
        </div>
      ))}
      {adding ? (
        <form className="card" onSubmit={(e) => { e.preventDefault(); void run(async () => {
          await addFact({ household_id: household.id, title: title.trim(), value: value.trim(), category, surface_at: shops });
          setTitle(''); setValue(''); setCategory('other'); setShops([]); setAdding(false);
        }); }}>
          <input placeholder="Title (e.g. Water shutoff, Bedroom paint)" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea placeholder="Details (e.g. under the kitchen sink, left valve)" value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="label">Type</div>
          <div className="row">{(Object.keys(FACT_LABELS) as FactCategory[]).map((c) => (
            <button type="button" key={c} className={`btn small${category === c ? ' primary' : ''}`} onClick={() => setCategory(c)}>{FACT_LABELS[c]}</button>
          ))}</div>
          <div className="label">Show on the list at</div>
          <div className="row">{SHOPS.map(([id, label]) => (
            <button type="button" key={id} className={`btn small${shops.includes(id) ? ' primary' : ''}`}
              onClick={() => setShops((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}>{label}</button>
          ))}</div>
          <button className="btn primary">Save fact</button>
          <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>+ Add a fact</button>
      )}
    </>
  );
}
