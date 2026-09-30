import { FormEvent, useEffect, useRef, useState } from 'react';
import { addMemory, uploadPhoto } from '../lib/api';
import type { Household, Place } from '../lib/types';
import { Icon } from './icons';

// Glass "Add a to-do…" bar + the sheet it opens.
export function AddBar({ onClick }: { onClick: () => void }) {
  return (
    <div className="dock add-dock">
      <button className="addbar glass" onClick={onClick} aria-label="Add a to-do">
        <span className="plus"><Icon name="plus" size={20} /></span>
        <span className="ph">Add a to-do…</span>
        <Icon name="camera" />
      </button>
    </div>
  );
}

export function AddSheet({ household, places, initialPlaceId, onClose, onSaved }: {
  household: Household; places: Place[]; initialPlaceId?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [body, setBody] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(initialPlaceId ?? null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0 && files.length === 0) return;
    setSaving(true);
    try {
      // One to-do per line, so a pasted list becomes several.
      const bodies = lines.length > 0 ? lines : [''];
      for (const [i, b] of bodies.entries()) {
        const m = await addMemory({ household_id: household.id, body: b, place_id: placeId });
        if (i === 0) for (const f of files) await uploadPhoto(household.id, m.id, f);
      }
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" role="dialog" aria-label="New to-do" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="grab" />
        <h2>New to-do</h2>
        <textarea
          ref={area}
          placeholder="What needs doing? One per line for several."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
        />
        <div className="row">
          <label className="btn small">
            <Icon name="camera" size={16} /> {files.length > 0 ? `${files.length} photo(s)` : 'Add photo'}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
        </div>
        <div className="label">Where?</div>
        <div className="row">
          <button type="button" className={`btn small${placeId === null ? ' primary' : ''}`} onClick={() => setPlaceId(null)}>Anytime</button>
          {places.map((p) => (
            <button type="button" key={p.id} className={`btn small${placeId === p.id ? ' primary' : ''}`} onClick={() => setPlaceId(p.id)}>{p.name}</button>
          ))}
        </div>
        <p className="muted" style={{ margin: 0 }}>Pick a place and you get a reminder when you are near it (on the phone app).</p>
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Add to-do'}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </form>
    </div>
  );
}
