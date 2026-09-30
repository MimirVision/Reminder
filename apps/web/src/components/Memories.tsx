import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  addMemory, deleteMemory, listMembers, listMemories, listPhotoUrls, listPlaces, markDone, reopen,
  updateMemory, uploadPhoto,
} from '../lib/api';
import type { Household, Member, Memory, Place } from '../lib/types';

const STAMP_KEY = 'hm.stampLocation';

function readStamp(): boolean {
  try {
    return localStorage.getItem(STAMP_KEY) === '1';
  } catch {
    return false;
  }
}

function currentPosition(): Promise<GeolocationPosition | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 3000, maximumAge: 300_000 }),
  );
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function Memories({ household, userId }: { household: Household; userId: string }) {
  const [showDone, setShowDone] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [photos, setPhotos] = useState<Map<string, string[]>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [stamp, setStamp] = useState(readStamp);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const list = await listMemories(household.id, showDone ? ['done'] : ['inbox', 'active']);
      setMemories(list);
      setPhotos(await listPhotoUrls(list.map((m) => m.id)));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [household.id, showDone]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listPlaces(household.id).then(setPlaces).catch(() => {});
    listMembers(household.id).then(setMembers).catch(() => {});
  }, [household.id]);

  const who = (id: string) => (id === userId ? 'You' : members.find((m) => m.user_id === id)?.display_name ?? 'Partner');
  const placeName = (id: string | null) => places.find((p) => p.id === id)?.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && files.length === 0) return;
    setSaving(true);
    try {
      const pos = stamp ? await currentPosition() : null;
      const m = await addMemory({
        household_id: household.id,
        body: body.trim(),
        place_id: placeId || null,
        capture_lat: pos?.coords.latitude ?? null,
        capture_lon: pos?.coords.longitude ?? null,
        capture_accuracy_m: pos?.coords.accuracy ?? null,
      });
      for (const f of files) await uploadPhoto(household.id, m.id, f);
      setBody('');
      setFiles([]);
      setPlaceId('');
      if (fileInput.current) fileInput.current.value = '';
      setShowDone(false);
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSaving(false);
    }
  }

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main>
      <form className="capture" onSubmit={submit}>
        <textarea
          placeholder="What do you want to remember?"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="row">
          <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} aria-label="Remind me at">
            <option value="">No place (just remember)</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>Remind me at: {p.name}</option>
            ))}
          </select>
          <label className="filebtn">
            📷 {files.length > 0 ? `${files.length} photo${files.length > 1 ? 's' : ''}` : 'Add photo'}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
        </div>
        <div className="row spread">
          <label className="check">
            <input
              type="checkbox"
              checked={stamp}
              onChange={(e) => {
                setStamp(e.target.checked);
                try { localStorage.setItem(STAMP_KEY, e.target.checked ? '1' : '0'); } catch { /* ignore */ }
              }}
            />
            Stamp my location
          </label>
          <button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>

      {err && <p className="error">{err}</p>}

      <div className="row spread">
        <h2>{showDone ? 'Done' : 'To remember'}</h2>
        <button className="link" onClick={() => setShowDone(!showDone)}>{showDone ? 'Show open' : 'Show done'}</button>
      </div>

      <ul className="list">
        {memories.length === 0 && <li className="muted">Nothing here.</li>}
        {memories.map((m) => (
          <li key={m.id} className="item">
            {m.body && <p className="body">{m.body}</p>}
            {(photos.get(m.id) ?? []).length > 0 && (
              <div className="photos">
                {photos.get(m.id)!.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" loading="lazy" /></a>
                ))}
              </div>
            )}
            <div className="row spread">
              <span className="muted">
                {who(m.author_id)} · {ago(m.created_at)}
                {placeName(m.place_id) ? ` · 📍 ${placeName(m.place_id)}` : ''}
              </span>
              <span className="row">
                {!showDone && (
                  <select
                    value={m.place_id ?? ''}
                    onChange={(e) =>
                      void act(() =>
                        updateMemory(m.id, { place_id: e.target.value || null, status: e.target.value ? 'active' : 'inbox' }),
                      )
                    }
                    aria-label="Place"
                  >
                    <option value="">No place</option>
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
                {showDone ? (
                  <button onClick={() => void act(() => reopen(m.id, Boolean(m.place_id)))}>Reopen</button>
                ) : (
                  <button onClick={() => void act(() => markDone(m.id))}>Done</button>
                )}
                <button className="danger" onClick={() => confirm('Delete this memory?') && void act(() => deleteMemory(m.id))}>✕</button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
