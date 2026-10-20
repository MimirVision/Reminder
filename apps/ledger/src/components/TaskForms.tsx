import { useEffect, useRef, useState } from 'react';
import { parseQuickAdd } from '../lib/quickadd';
import { CalendarDays } from 'lucide-react';
import { useStore } from '../data/store';
import { formatDayLong } from '../lib/format';
import { PRIORITY_LABEL, TYPE_LABEL } from '../lib/labels';
import { PRIORITIES, TASK_TYPES, type Client, type Priority, type TaskType } from '../lib/types';
import { Button } from '../ui/button';
import { DatePicker } from '../ui/datepicker';
import { Field, Input, Select, Textarea } from '../ui/field';
import { Dialog } from '../ui/overlay';
import { fromLines } from './Checklist';
import { ClientsPicker } from './ClientsPicker';
import { useToast } from '../ui/toast';
import { cn } from '../ui/cn';
import { useUI } from './ui-state';

export function NewTaskDialog() {
  const ui = useUI();
  const { snap, today, run, clientById } = useStore();
  const open = ui.newTask !== null;
  const clients = snap.clients.filter((c) => c.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [due, setDue] = useState(today);
  const [priority, setPriority] = useState<Priority>('normal');
  const [type, setType] = useState<TaskType>('follow_up');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  // Several clients: the same task created once for each, as separate tasks with nothing linking them.
  const [multi, setMulti] = useState(false);
  const [many, setMany] = useState<string[]>([]);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setTitle(ui.newTask?.title ?? ''); setNotes(''); setTags(''); setPriority('normal'); setType('follow_up'); setTried(false);
    setMulti(!!ui.newTask?.multi); setMany([]);
    setClientId(ui.newTask?.clientId ?? '');
    setDue(ui.newTask?.dueDate ?? today);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The title understands the quick-add shorthand too (@client, fri, !high, #tag); recognised parts fill the fields.
  const parsed = parseQuickAdd(title, snap.clients, today);
  const titleRef = useRef<HTMLInputElement>(null);
  const effective = { clientId: parsed.clientId ?? clientId, due: parsed.due ?? due, priority: parsed.priority ?? priority };
  // In several-clients mode an @client in the title adds that client to the ticked ones.
  const targets = multi ? [...new Set([...many, ...(parsed.clientId ? [parsed.clientId] : [])])] : effective.clientId ? [effective.clientId] : [];
  const errors = {
    title: !parsed.title ? 'Give the task a title.' : null,
    client: targets.length ? null : multi ? 'Tick at least one client.' : 'Choose a client.',
  };
  const submit = async (another = false) => {
    setTried(true);
    if (errors.title || errors.client) return;
    setBusy(true);
    const base = {
      scheduleId: null, title: parsed.title, description: notes, taskType: type, periodKey: null, periodStart: null, periodEnd: null,
      dueDate: effective.due, scheduledDueDate: null, status: 'todo' as const, priority: effective.priority,
      tags: [...new Set([...parsed.tags, ...tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)])],
    };
    const n = targets.length;
    const created = await run(async (r) => {
      const ids: string[] = [];
      // Each client gets its own task, with its own copy of the checklist.
      for (const clientId of targets) ids.push((await r.createOccurrence({ ...base, clientId, checklist: fromLines(snap.workspace.settings.checklistTemplates?.[type]) })).id);
      return ids;
    }, { success: n === 1 ? (another ? 'Task created. Add the next one.' : 'Task created') : undefined });
    setBusy(false);
    if (!created) return;
    if (n > 1) {
      toast.show(`Created ${n} tasks: “${parsed.title}”`, {
        undo: () => void run(async (r) => { for (const id of created) await r.deleteOccurrence(id); }, { success: `Removed the ${n} tasks` }),
      });
    }
    if (another) {
      // Keep client(s), date and type for a run of similar tasks; clear the rest.
      setClientId(effective.clientId); setMany(targets); setDue(effective.due); setTitle(''); setNotes(''); setTags(''); setTried(false);
      titleRef.current?.focus();
    } else ui.closeNewTask();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeNewTask()} title="New task" description="A one-off task. For work that repeats, add a recurring schedule instead."
      footer={<>
        <span className={cn('mr-auto hidden text-[12px] text-ink-3', !multi && 'sm:block')}>Enter to create · Shift+Enter to add another</span>
        <Button onClick={ui.closeNewTask}>Cancel</Button>
        <Button onClick={() => void submit(true)} disabled={busy}>Create &amp; add another</Button>
        <Button variant="primary" loading={busy} onClick={() => void submit()}>{targets.length > 1 ? `Create ${targets.length} tasks` : 'Create task'}</Button>
      </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}
        onKeyDown={(e) => {
          // Only Enter typed in this form's own fields: not in a date picker or menu opened from it, nor on a button.
          const t = e.target as HTMLElement;
          if (e.key !== 'Enter' || !e.currentTarget.contains(t) || t.tagName === 'BUTTON' || (t.tagName === 'TEXTAREA' && !(e.ctrlKey || e.metaKey))) return;
          e.preventDefault(); void submit(e.shiftKey);
        }}>
        <Field label="Title" error={tried ? errors.title : null}
          hint={parsed.clientId || parsed.due || parsed.priority || parsed.tags.length
            ? <span className="text-accent-ink">Will use: {[parsed.clientId && clientById.get(parsed.clientId)?.name, parsed.due && formatDayLong(parsed.due), parsed.priority && `${PRIORITY_LABEL[parsed.priority]} priority`, ...parsed.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ')}</span>
            : 'Tip: type @client, a date like fri or 15.11, !high or #tag right in the title.'}>
          {(p) => <Input {...p} ref={titleRef} value={title} maxLength={200} placeholder="e.g. Chase missing receipts @nordvik fri" onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {multi ? (
            <Field label="Clients" className="sm:col-span-2" error={tried ? errors.client : null}
              hint={<button type="button" className="text-accent hover:underline" onClick={() => { setMulti(false); setClientId(targets[0] ?? ''); }}>Just one client</button>}>
              {() => <ClientsPicker selected={targets} onChange={setMany}
                onGroup={(g) => { if (g.type && type === 'follow_up') setType(g.type); }} />}
            </Field>
          ) : (
            <Field label="Client" error={tried ? errors.client : null}
              hint={<button type="button" className="text-accent hover:underline" onClick={() => { setMulti(true); setMany(effective.clientId ? [effective.clientId] : []); }}>Several clients…</button>}>
              {(p) => (
                <Select {...p} value={effective.clientId} disabled={!!parsed.clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="" disabled>Choose a client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Due date">
            {(p) => (
              <DatePicker value={effective.due} today={today} onChange={setDue} trigger={
                <button {...p} type="button" className="flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-[13px] hover:bg-hover">
                  <CalendarDays className="size-4 text-ink-3" /><span className="tnum truncate">{formatDayLong(effective.due)}</span>
                </button>
              } />
            )}
          </Field>
          <Field label="Priority">
            {(p) => <Select {...p} value={effective.priority} disabled={!!parsed.priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}</Select>}
          </Field>
          <Field label="Type">
            {(p) => <Select {...p} value={type} onChange={(e) => setType(e.target.value as TaskType)}>{TASK_TYPES.map((x) => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}</Select>}
          </Field>
        </div>
        <Field label="Notes">{(p) => <Textarea {...p} rows={3} value={notes} maxLength={10000} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <Field label="Tags" hint="Optional, separated by commas.">{(p) => <Input {...p} value={tags} placeholder="receipts, meeting" onChange={(e) => setTags(e.target.value)} />}</Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function ClientDialog({ open, onOpenChange, client, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; client?: Client; onSaved?: (c: Client) => void }) {
  const { snap, run, repo } = useStore();
  const [name, setName] = useState('');
  const [contact, setContact] = useState({ contactName: '', contactEmail: '', contactPhone: '' });
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(client?.name ?? ''); setReference(client?.reference ?? ''); setNotes(client?.notes ?? ''); setTried(false);
    setContact({ contactName: client?.contactName ?? '', contactEmail: client?.contactEmail ?? '', contactPhone: client?.contactPhone ?? '' });
  }, [open, client?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- a refresh mustn't wipe what is being typed

  const refTaken = reference.trim() && snap.clients.some((c) => c.id !== client?.id && c.reference?.toLowerCase() === reference.trim().toLowerCase());
  const emailBad = contact.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.contactEmail.trim());
  const errors = {
    name: !name.trim() ? 'A client needs a name.' : null, reference: refTaken ? 'Another client already uses this reference.' : null,
    email: emailBad ? 'That doesn’t look like an email address.' : null,
  };
  const submit = async () => {
    setTried(true);
    if (errors.name || errors.reference || errors.email) return;
    setBusy(true);
    const values = {
      name: name.trim(), reference: reference.trim() || null, notes,
      ...(repo.current ? { contactName: contact.contactName.trim(), contactEmail: contact.contactEmail.trim(), contactPhone: contact.contactPhone.trim() } : {}),
    };
    const saved = await run(async (r) => {
      if (client) { await r.updateClient(client.id, values); return { ...client, ...values }; }
      return r.createClient(values);
    }, { success: client ? 'Client saved' : 'Client added' });
    setBusy(false);
    if (saved) { onOpenChange(false); onSaved?.(saved); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={client ? 'Edit client' : 'New client'} footer={<>
      <Button onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button variant="primary" loading={busy} onClick={submit}>{client ? 'Save' : 'Add client'}</Button>
    </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Name" error={tried ? errors.name : null}>{(p) => <Input {...p} value={name} maxLength={200} placeholder="Company or person" onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Reference" hint="Optional. Your own code for the client." error={errors.reference}>
          {(p) => <Input {...p} value={reference} maxLength={50} placeholder="e.g. C-1021" onChange={(e) => setReference(e.target.value)} />}
        </Field>
        {repo.current && (
          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="sr-only">Contact person (optional)</legend>
            <Field label="Contact name" className="sm:col-span-2">{(p) => <Input {...p} value={contact.contactName} maxLength={200} autoComplete="off" onChange={(e) => setContact((c) => ({ ...c, contactName: e.target.value }))} />}</Field>
            <Field label="Contact email" error={tried ? errors.email : null}>{(p) => <Input {...p} type="email" value={contact.contactEmail} maxLength={200} autoComplete="off" onChange={(e) => setContact((c) => ({ ...c, contactEmail: e.target.value }))} />}</Field>
            <Field label="Contact phone">{(p) => <Input {...p} type="tel" value={contact.contactPhone} maxLength={50} autoComplete="off" onChange={(e) => setContact((c) => ({ ...c, contactPhone: e.target.value }))} />}</Field>
          </fieldset>
        )}
        <Field label="Notes" hint="Working notes only. Avoid sensitive personal or financial details.">
          {(p) => <Textarea {...p} rows={4} value={notes} maxLength={10000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
