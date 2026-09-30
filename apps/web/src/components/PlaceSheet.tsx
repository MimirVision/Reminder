import { FormEvent, useCallback, useEffect, useState } from 'react';
import { addMemory, deleteMemory, listFacts, listMemories, listPhotoUrls, listPlaces, markDone, reopen } from '../lib/api';
import { factsForCategory, type Fact } from '../lib/facts';
import type { Household, Memory } from '../lib/types';
import { Icon } from './icons';

// Everything to do at one place, as a tick list (the web version of "I'm here").
export function PlaceSheet({ household, placeId, label, onClose, onChanged }: {
  household: Household; placeId: string; label: string; onClose: () => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<Memory[]>([]);
  const [photos, setPhotos] = useState<Map<string, string[]>>(new Map());
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [useful, setUseful] = useState<Fact[]>([]);

  const load = useCallback(async () => {
    try {
      const all = await listMemories(household.id, ['active', 'done']);
      const cutoff = Date.now() - 6 * 3600_000;
      const mine = all
        .filter((m) => m.place_id === placeId && (m.status === 'active' || (m.done_at && new Date(m.done_at).getTime() > cutoff)))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      setItems(mine);
      setPhotos(await listPhotoUrls(mine.map((m) => m.id)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [household.id, placeId]);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load, onClose]);

  // Facts tagged for this kind of shop appear as "Useful here".
  useEffect(() => {
    Promise.all([listFacts(household.id), listPlaces(household.id)])
      .then(([facts, places]) => setUseful(factsForCategory(facts, places.find((p) => p.id === placeId)?.category ?? null)))
      .catch(() => {});
  }, [household.id, placeId]);

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
    setDraft('');
    await act(async () => { for (const body of lines) await addMemory({ household_id: household.id, body, place_id: placeId }); });
  }

  const open = items.filter((m) => m.status !== 'done');
  const done = items.filter((m) => m.status === 'done');
  const row = (m: Memory) => (
    <div key={m.id} className={`list-row todo${m.status === 'done' ? ' done' : ''}`}>
      <button className={`check${m.status === 'done' ? ' on' : ''}`} aria-label={m.status === 'done' ? 'Mark as not done' : 'Mark as done'}
        onClick={() => void act(() => (m.status === 'done' ? reopen(m.id, true) : markDone(m.id)))}>
        {m.status === 'done' && <Icon name="check" size={14} />}
      </button>
      <div className="text">
        <p className="body">{m.body || '(photo)'}</p>
        {(photos.get(m.id) ?? []).length > 0 && <div className="photos">{photos.get(m.id)!.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" /></a>)}</div>}
      </div>
      <button className="link quiet" onClick={() => confirm('Delete this to-do?') && void act(() => deleteMemory(m.id))}>Delete</button>
    </div>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="row spread">
          <div><h2>{label}</h2><span className="muted">{open.length === 0 ? 'Everything is ticked off.' : `${open.length} to get`}</span></div>
          <button className="btn small" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        {err && <p className="error">{err}</p>}
        <div>{open.map(row)}</div>
        {useful.length > 0 && (
          <div className="suggest" role="note" aria-label="Useful here">
            <div className="label" style={{ padding: 0 }}>Useful here</div>
            {useful.map((f) => <div key={f.id}><strong>{f.title}</strong>{f.value && <div style={{ whiteSpace: 'pre-wrap' }}>{f.value}</div>}</div>)}
          </div>
        )}
        <form onSubmit={add}>
          <textarea placeholder="Add to this list (one per line)" style={{ minHeight: 60 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn" disabled={!draft.trim()}>Add</button>
        </form>
        {done.length > 0 && <div className="label">Got it</div>}
        <div>{done.map(row)}</div>
        <button className="btn primary" onClick={onClose}>Done here</button>
      </div>
    </div>
  );
}
