import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { addMemory, notifyPartnerIfSet, parseTasksAI, resolveWhere, updateMemoryFields, uploadPhoto, type Where } from '../lib/api';
import { categoryName, placeLabel } from '../lib/labels';
import { isNetworkError } from '../lib/outbox';
import { findExistingPlace } from '../lib/placeSearch';
import { isInteresting, parseTasks, type ParsedTask } from '../lib/quickAdd';
import { changedFields, detailsOf, newFields, type Details } from '../lib/details';
import { dueLabel } from '../lib/when';
import type { Household, Member, Memory, Place } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { TodoDetails } from './TodoDetails';
import { WhenField, type Due } from './WhenField';
import { WhereField, whereFrom } from './WhereField';

export type SavedInfo = { added: Memory[]; edited: Memory | null; createdPlace: Place | null };

// Add or edit a to-do: text, where (search a shop, kind of shop or address), when (date and time) and photos.
export function TodoSheet({ household, places, members = [], userId = '', memory, photos, initialPlaceId, initialBody, onClose, onSaved, onDelete }: {
  household: Household; places: Place[]; members?: Member[]; userId?: string; memory?: Memory; photos?: string[]; initialPlaceId?: string | null; initialBody?: string;
  onClose: () => void; onSaved: (info: SavedInfo) => void; onDelete?: (m: Memory) => void;
}) {
  const { t, tn, lang, locale } = useI18n();
  const [body, setBody] = useState(memory?.body ?? initialBody ?? '');
  const [where, setWhere] = useState<Where>(whereFrom(memory?.place_id ?? initialPlaceId ?? null));
  const [due, setDue] = useState<Due>({ due_on: memory?.due_on ?? null, due_time: memory?.due_time ?? null, repeat_rule: memory?.repeat_rule ?? null });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const partner = members.find((m) => m.user_id !== userId) ?? null;
  const [forId, setForId] = useState<string | null>(memory?.assignee_id ?? null);
  const [pinned, setPinned] = useState(!!memory?.pinned);
  const [details, setDetails] = useState<Details>(() => detailsOf(memory));
  const [showMore, setShowMore] = useState(() => !!memory && (!!memory.notes || (memory.checklist?.length ?? 0) > 0 || !!memory.priority || memory.remind_before != null));
  const [smart, setSmart] = useState(true);
  const [ai, setAi] = useState<{ text: string; tasks: ParsedTask[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [dropped, setDropped] = useState<number[]>([]);
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

  // What the text means: a date, a place, several to-dos... (new to-dos only). The AI's answer replaces the built-in reader until the text changes.
  const plan = useMemo<ParsedTask[] | null>(() => {
    if (editing || !smart || !body.trim()) return null;
    const tasks = ai && ai.text === body ? ai.tasks : parseTasks(body, { places, partnerName: partner?.display_name });
    return isInteresting(tasks) ? tasks : null;
  }, [editing, smart, body, ai, places, partner?.display_name]);
  useEffect(() => { setDropped([]); setAiNote(null); }, [body]);
  const kept = plan ? plan.filter((_, i) => !dropped.includes(i)) : null;

  async function sortWithAI() {
    setAiBusy(true);
    setAiNote(null);
    const r = await parseTasksAI(household.id, body, lang, partner?.display_name ?? null).catch(() => ({ tasks: null, error: 'failed' as const }));
    setAiBusy(false);
    if (r.tasks && r.tasks.length > 0) { setAi({ text: body, tasks: r.tasks }); setDropped([]); return; }
    setAiNote(t(r.error === 'unavailable' ? 'smart.unavailable' : r.error === 'limit' ? 'smart.limit' : 'smart.failed'));
  }

  const idFor = (who: ParsedTask['assignee']): string | null => (who === 'me' ? userId || null : who === 'partner' ? partner?.user_id ?? null : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (kept && kept.length > 0) { await submitPlan(kept); return; }
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    if (editing) { if (lines.length === 0 && files.length === 0 && photos?.length === 0) { setErr(t('sheet.needText')); return; } }
    else if (lines.length === 0 && files.length === 0) { setErr(t('sheet.needText')); return; }
    setSaving(true);
    setErr(null);
    try {
      const { placeId, created } = await resolveWhere(household.id, where, places, findExistingPlace);
      if (memory) {
        const text = body.trim();
        const extra = { ...(members.length > 1 && forId !== (memory.assignee_id ?? null) ? { assignee_id: forId } : {}), ...(pinned !== !!memory.pinned ? { pinned } : {}), ...changedFields(details, detailsOf(memory), !!due.due_on) };
        await updateMemoryFields(memory.id, { body: text, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule, ...extra });
        for (const f of files) await uploadPhoto(household.id, memory.id, f);
        onSaved({ added: [], edited: { ...memory, body: text, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule ?? null, assignee_id: forId, pinned, notes: details.notes.trim() || null, checklist: details.checklist, priority: details.priority, remind_before: due.due_on ? details.remind_before : null }, createdPlace: created });
        return;
      }
      // One to-do per line, so a pasted list becomes several.
      const bodies = lines.length > 0 ? lines : [''];
      const added: Memory[] = [];
      for (const [i, b] of bodies.entries()) {
        const m = await addMemory({ household_id: household.id, body: b, place_id: placeId, due_on: due.due_on, due_time: due.due_time, repeat_rule: due.repeat_rule, ...(forId ? { assignee_id: forId } : {}), ...(pinned ? { pinned } : {}), ...newFields(bodies.length === 1 ? details : { ...details, notes: '', checklist: [] }, !!due.due_on) });
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

  // Save what was understood: each to-do with its own place, day, time and person, falling back to what is chosen in the form.
  async function submitPlan(tasks: ParsedTask[]) {
    setSaving(true);
    setErr(null);
    try {
      let known = places;
      let lastCreated: Place | null = null;
      let sheetPlace: string | null | undefined;
      const added: Memory[] = [];
      for (const [i, task] of tasks.entries()) {
        let placeId = task.placeId;
        if (!placeId && task.category) {
          const r = await resolveWhere(household.id, { kind: 'category', category: task.category, name: categoryName(task.category, t) }, known, findExistingPlace);
          placeId = r.placeId;
          if (r.created) { known = [...known, r.created]; lastCreated = r.created; }
        }
        if (!placeId) {
          if (sheetPlace === undefined) { const r = await resolveWhere(household.id, where, known, findExistingPlace); sheetPlace = r.placeId; if (r.created) { known = [...known, r.created]; lastCreated = r.created; } }
          placeId = sheetPlace;
        }
        const dated = !!task.due_on;
        const assignee = task.assignee ? idFor(task.assignee) : forId;
        const m = await addMemory({
          household_id: household.id, body: task.title, place_id: placeId,
          due_on: dated ? task.due_on : due.due_on, due_time: dated ? task.due_time : due.due_time, repeat_rule: dated ? task.repeat_rule : due.repeat_rule,
          ...(assignee ? { assignee_id: assignee } : {}), ...(pinned ? { pinned } : {}),
          // Notes and a checklist belong to one to-do; priority and the reminder go to each.
          ...newFields({ ...(tasks.length === 1 ? details : { ...details, notes: '', checklist: [] }), priority: task.priority || details.priority }, dated || !!due.due_on),
        });
        added.push(m);
        if (i === 0 && files.length > 0) {
          if (m.pending) throw new Error(t('offline.noPhoto'));
          for (const f of files) await uploadPhoto(household.id, m.id, f);
        }
      }
      notifyPartnerIfSet(added.filter((m) => !m.pending).map((m) => m.id));
      onSaved({ added, edited: null, createdPlace: lastCreated });
    } catch (e2) {
      setErr(isNetworkError(e2, navigator.onLine) ? t('offline.needsNet') : e2 instanceof Error ? e2.message : String(e2));
      setSaving(false);
    }
  }

  const placeText = (task: ParsedTask) => {
    const p = task.placeId ? places.find((x) => x.id === task.placeId) : null;
    return p ? placeLabel(p, t) : task.category ? categoryName(task.category, t) : '';
  };
  const whoText = (who: ParsedTask['assignee']) => who === 'me' ? t('assign.me') : who === 'partner' ? partner?.display_name || t('common.partner') : who === 'both' ? t('assign.anyone') : '';

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
        {plan && kept && (
          <div className="smart" role="group" aria-label={t('smart.title')}>
            <div className="row spread">
              <span className="label nopad">{ai && ai.text === body ? t('smart.aiDone') : t('smart.title')}</span>
              {!(ai && ai.text === body) && <button type="button" className="btn small" disabled={aiBusy} onClick={() => void sortWithAI()}>{aiBusy ? t('smart.aiBusy') : t('smart.ai')}</button>}
            </div>
            {plan.map((task, i) => dropped.includes(i) ? null : (
              <div className="smart-item" key={i}>
                <div className="smart-main">
                  <strong>{task.title}</strong>
                  <div className="meta">
                    {(task.due_on || task.due_time) && <span className="chip"><Icon name="calendar" size={12} />{task.due_on ? dueLabel({ due_on: task.due_on, due_time: task.due_time }, t, locale) : task.due_time}</span>}
                    {task.repeat_rule && <span className="chip plain"><Icon name="repeat" size={12} />{t(`repeat.short.${task.repeat_rule}` as 'repeat.short.daily')}</span>}
                    {(task.placeId || task.category) && <span className="chip plain"><Icon name="pin" size={12} />{task.leaving ? t('smart.leaving', { place: placeText(task) }) : placeText(task)}</span>}
                    {task.priority > 0 && <span className="chip plain"><Icon name="flag" size={12} />{t(`prio.short.${task.priority}` as 'prio.short.1')}</span>}
                    {task.assignee && task.assignee !== 'both' && <span className="chip plain">{t('row.for', { name: whoText(task.assignee) })}</span>}
                  </div>
                </div>
                <button type="button" className="mini" aria-label={t('smart.remove', { title: task.title })} onClick={() => setDropped((d) => [...d, i])}><Icon name="x" size={14} /></button>
              </div>
            ))}
            {plan.some((x, i) => x.leaving && !dropped.includes(i)) && <p className="muted hint">{t('smart.leaveNote')}</p>}
            {aiNote && <p className="muted hint" role="status">{aiNote}</p>}
            <button type="button" className="link" onClick={() => setSmart(false)}>{t('smart.plain')}</button>
          </div>
        )}
        {!editing && !smart && <button type="button" className="link" onClick={() => setSmart(true)}>{t('smart.smart')}</button>}
        <div className="label">{t('sheet.where')}</div>
        <WhereField places={places} value={where} onChange={setWhere} />
        <div className="label">{t('sheet.when')}</div>
        <WhenField value={due} onChange={setDue} />
        <button type="button" className="link left" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
          <Icon name="list" size={15} /> {showMore ? t('todo.detailLess') : `${t('todo.detail')}: ${t('prio.label').toLowerCase()}, ${t('check.label').toLowerCase()}, ${t('notes.label').toLowerCase()}`}
        </button>
        {showMore && <TodoDetails value={details} onChange={setDetails} hasDate={!!due.due_on} />}
        {(photos?.length ?? 0) > 0 && <div className="photos">{photos!.map((u) => <img key={u} src={u} alt="" />)}</div>}
        {members.length > 1 && partner && (
          <>
            <div className="label">{t('assign.label')}</div>
            <div className="chips" role="group" aria-label={t('assign.label')}>
              {([[null, t('assign.anyone')], [userId, t('assign.me')], [partner.user_id, partner.display_name || t('common.partner')]] as [string | null, string][]).map(([id, label]) => (
                <button key={label} type="button" className={`chipbtn${forId === id ? ' on' : ''}`} aria-pressed={forId === id} onClick={() => setForId(id)}>{label}</button>
              ))}
            </div>
          </>
        )}
        <div className="row">
          <button type="button" className={`chipbtn${pinned ? ' on' : ''}`} aria-pressed={pinned} onClick={() => setPinned(!pinned)}><Icon name="pin" size={16} /> {pinned ? t('pin.on') : t('pin.label')}</button>
          <label className="chipbtn">
            <Icon name="camera" size={16} /> {files.length > 0 ? tn('sheet.photos', files.length) : t('sheet.photo')}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
        </div>
        <p className="muted hint">{t('sheet.hint')}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? t('sheet.saving') : editing ? t('sheet.save') : kept && kept.length > 0 ? tn('sheet.addN', kept.length) : t('sheet.add')}</button>
        {editing && onDelete && (
          <button type="button" className="btn danger" onClick={() => onDelete(memory!)}><Icon name="trash" size={16} /> {t('sheet.delete')}</button>
        )}
      </form>
    </Sheet>
  );
}
