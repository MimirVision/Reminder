import { FormEvent, useEffect, useRef, useState } from 'react';
import { addMemory, notifyPartnerIfSet, resolveWhere, updateMemoryFields, uploadPhoto, type Where } from '../lib/api';
import { isNetworkError } from '../lib/outbox';
import { findExistingPlace } from '../lib/placeSearch';
import type { Household, Memory, Place } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { WhenField, type Due } from './WhenField';
import { WhereField, whereFrom } from './WhereField';

export type SavedInfo = { added: Memory[]; edited: Memory | null; createdPlace: Place | null };

// Add or edit a to-do: text, where (search a shop, kind of shop or address), when (date and time) and photos.
export function TodoSheet({ household, places, memory, photos, initialPlaceId, initialBody, onClose, onSaved, onDelete }: {
  household: Household; places: Place[]; memory?: Memory; photos?: string[]; initialPlaceId?: string | null; initialBody?: string;
  onClose: () => void; onSaved: (info: SavedInfo) => void; onDelete?: (m: Memory) => void;
}) {
  const { t, tn } = useI18n();
  const [body, setBody] = useState(memory?.body ?? initialBody ?? '');
  const [where, setWhere] = useState<Where>(whereFrom(memory?.place_id ?? initialPlaceId ?? null));
  const [due, setDue] = useState<Due>({ due_on: memory?.due_on ?? null, due_time: memory?.due_time ?? null, repeat_rule: memory?.repeat_rule ?? null });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const editing = !!memory;

  useEffect(() => { if (!editing) area.current?.focus(); }, [editing]);
  // Grow the text box with what you type.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [body]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (editing) { if (lines.length === 0 && files.length === 0 && photos?.length === 0) { setErr(t('sheet.needText')); return; } }
    else if (lines.length === 0 && files.length === 0) { setErr(t('sheet.needText')); return; }
    setSaving(true);
    setErr(null);
    try {
      const { placeId, created } = await resolveWhere(household.id, where, places, findExistingPlace);
      if (memory) {
        const text = body.trim();
        await updateMemoryFields(memory.id, { body: text, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule });
        for (const f of files) await uploadPhoto(household.id, memory.id, f);
        onSaved({ added: [], edited: { ...memory, body: text, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule ?? null }, createdPlace: created });
        return;
      }
      // One to-do per line, so a pasted list becomes several.
      const bodies = lines.length > 0 ? lines : [''];
      const added: Memory[] = [];
      for (const [i, b] of bodies.entries()) {
        const m = await addMemory({ household_id: household.id, body: b, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule });
        added.push(m);
        if (i === 0 && files.length > 0) {
          if (m.pending) throw new Error(t('offline.noPhoto'));
          for (const f of files) await uploadPhoto(household.id, m.id, f);
        }
      }
      notifyPartnerIfSet(added.filter((m) => !m.pending).map((m) => m.id));
      onSaved({ added, edited: null, createdPlace: created });
    } catch (e2) {
      setErr(isNetworkError(e2, navigator.onLine) ? t('offline.needsNet') : e2 instanceof Error ? e2.message : String(e2));
      setSaving(false);
    }
  }

  return (
    <Sheet label={editing ? t('sheet.edit') : t('sheet.new')} onClose={onClose}>
      <form className="sheet-form" onSubmit={submit}>
        <div className="row spread">
          <h2>{editing ? t('sheet.edit') : t('sheet.new')}</h2>
          <button type="button" className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button>
        </div>
        <textarea
          ref={area} rows={2} className="bodyfield" placeholder={t('sheet.placeholder')} value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
        />
        <div className="label">{t('sheet.where')}</div>
        <WhereField places={places} value={where} onChange={setWhere} />
        <div className="label">{t('sheet.when')}</div>
        <WhenField value={due} onChange={setDue} />
        {(photos?.length ?? 0) > 0 && <div className="photos">{photos!.map((u) => <img key={u} src={u} alt="" />)}</div>}
        <div className="row">
          <label className="chipbtn">
            <Icon name="camera" size={16} /> {files.length > 0 ? tn('sheet.photos', files.length) : t('sheet.photo')}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
        </div>
        <p className="muted hint">{t('sheet.hint')}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? t('sheet.saving') : editing ? t('sheet.save') : t('sheet.add')}</button>
        {editing && onDelete && (
          <button type="button" className="btn danger" onClick={() => onDelete(memory!)}><Icon name="trash" size={16} /> {t('sheet.delete')}</button>
        )}
      </form>
    </Sheet>
  );
}
