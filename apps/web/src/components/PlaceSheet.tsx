import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { addMemory, listFacts, listMembers, listMemories, listPhotoUrls, listPlaces, markDone, notifyPartnerIfSet, reopen, subscribeHousehold } from '../lib/api';
import { tap } from '../lib/haptics';
import { factsForCategory, type Fact } from '../lib/facts';
import type { Household, Member, Memory } from '../lib/types';
import { useI18n } from '../i18n';
import { dueLabel } from '../lib/when';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { TodoRow } from './TodoRow';

// Everything to do at one place, as a tick list (the web version of "Are you here?").
export function PlaceSheet({ household, placeId, label, onClose, onChanged, onEdit }: {
  household: Household; placeId: string; label: string; onClose: () => void; onChanged: () => void; onEdit: (m: Memory) => void;
}) {
  const { t, tn, locale } = useI18n();
  const [items, setItems] = useState<Memory[]>([]);
  const [photos, setPhotos] = useState<Map<string, string[]>>(new Map());
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [useful, setUseful] = useState<Fact[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { listMembers(household.id).then(setMembers).catch(() => {}); }, [household.id]);

  // Shopping together: when your partner ticks something off at the shop, it changes here too.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let timer: number | undefined;
    const off = subscribeHousehold(household.id, () => { window.clearTimeout(timer); timer = window.setTimeout(() => void loadRef.current(), 250); });
    return () => { window.clearTimeout(timer); off(); };
  }, [household.id]);

  // Facts tagged for this kind of shop appear as "Useful here".
  useEffect(() => {
    Promise.all([listFacts(household.id), listPlaces(household.id)])
      .then(([facts, places]) => setUseful(factsForCategory(facts, places.find((p) => p.id === placeId)?.category ?? null)))
      .catch(() => {});
  }, [household.id, placeId]);

  async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try { const r = await fn(); await load(); onChanged(); return r; } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return undefined; }
  }
  const nameOf = (id: string | null | undefined) => (id ? members.find((x) => x.user_id === id)?.display_name ?? null : null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
    setDraft('');
    const ids = await act(async () => { const out: string[] = []; for (const body of lines) out.push((await addMemory({ household_id: household.id, body, place_id: placeId })).id); return out; });
    if (ids) notifyPartnerIfSet(ids);
  }

  const open = items.filter((m) => m.status !== 'done');
  const done = items.filter((m) => m.status === 'done');
  const row = (m: Memory) => (
    <TodoRow key={m.id} m={m} photos={photos.get(m.id)} done={m.status === 'done'} due={dueLabel(m, t, locale) || undefined}
      doneBy={m.status === 'done' && m.done_by ? nameOf(m.done_by) : null}
      author={members.length > 1 ? { id: m.author_id, name: nameOf(m.author_id) } : null}
      onToggle={() => { tap(m.status === 'done' ? 'light' : 'success'); void act(async () => { if (m.status === 'done') await reopen(m.id, m); else { const next = await markDone(m.id); void next; } }); }}
      onEdit={() => onEdit(m)} />
  );

  return (
    <Sheet label={label} onClose={onClose} tall>
      <div className="row spread">
        <div><h2>{label}</h2><span className="muted">{open.length === 0 ? t('list.allTicked') : tn('list.toGet', open.length)}</span></div>
        <button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="list">{open.map(row)}</div>
      {useful.length > 0 && (
        <div className="suggest" role="note" aria-label={t('list.useful')}>
          <div className="label nopad">{t('list.useful')}</div>
          {useful.map((f) => <div key={f.id}><strong>{f.title}</strong>{f.value && <div className="prewrap">{f.value}</div>}</div>)}
        </div>
      )}
      <form onSubmit={add}>
        <textarea rows={2} placeholder={t('list.addPlaceholder')} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn" disabled={!draft.trim()}>{t('common.add')}</button>
      </form>
      {done.length > 0 && <div className="label">{t('list.gotIt')}</div>}
      <div className="list">{done.map(row)}</div>
      <button className="btn primary" onClick={onClose}>{t('list.doneHere')}</button>
    </Sheet>
  );
}
