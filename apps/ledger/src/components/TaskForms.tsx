import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useStore } from '../data/store';
import { formatDayLong } from '../lib/format';
import { PRIORITY_LABEL, TYPE_LABEL } from '../lib/labels';
import { PRIORITIES, TASK_TYPES, type Client, type Priority, type TaskType } from '../lib/types';
import { Button } from '../ui/button';
import { DatePicker } from '../ui/datepicker';
import { Field, Input, Select, Textarea } from '../ui/field';
import { Dialog } from '../ui/overlay';
import { useUI } from './ui-state';

export function NewTaskDialog() {
  const ui = useUI();
  const { snap, today, run } = useStore();
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

  useEffect(() => {
    if (!open) return;
    setTitle(''); setNotes(''); setTags(''); setPriority('normal'); setType('follow_up'); setTried(false);
    setClientId(ui.newTask?.clientId ?? '');
    setDue(ui.newTask?.dueDate ?? today);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = { title: !title.trim() ? 'Give the task a title.' : null, client: !clientId ? 'Choose a client.' : null };
  const submit = async () => {
    setTried(true);
    if (errors.title || errors.client) return;
    setBusy(true);
    const created = await run((r) => r.createOccurrence({
      clientId, scheduleId: null, title: title.trim(), description: notes, taskType: type, periodKey: null, periodStart: null, periodEnd: null,
      dueDate: due, scheduledDueDate: null, status: 'todo', priority,
      tags: [...new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))],
    }), { success: 'Task created' });
    setBusy(false);
    if (created) ui.closeNewTask();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeNewTask()} title="New task" description="A one-off task. For work that repeats, add a recurring schedule instead."
      footer={<>
        <span className="mr-auto hidden text-[12px] text-ink-3 sm:block">Ctrl + Enter to save</span>
        <Button onClick={ui.closeNewTask}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={submit}>Create task</Button>
      </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}>
        <Field label="Title" error={tried ? errors.title : null}>
          {(p) => <Input {...p} value={title} maxLength={200} placeholder="e.g. Chase missing receipts for October" onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client" error={tried ? errors.client : null}>
            {(p) => (
              <Select {...p} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="" disabled>Choose a client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Due date">
            {(p) => (
              <DatePicker value={due} today={today} onChange={setDue} trigger={
                <button {...p} type="button" className="flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-[13px] hover:bg-hover">
                  <CalendarDays className="size-4 text-ink-3" /><span className="tnum truncate">{formatDayLong(due)}</span>
                </button>
              } />
            )}
          </Field>
          <Field label="Priority">
            {(p) => <Select {...p} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}</Select>}
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
  const { snap, run } = useStore();
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(client?.name ?? ''); setReference(client?.reference ?? ''); setNotes(client?.notes ?? ''); setTried(false);
  }, [open, client]);

  const refTaken = reference.trim() && snap.clients.some((c) => c.id !== client?.id && c.reference?.toLowerCase() === reference.trim().toLowerCase());
  const errors = { name: !name.trim() ? 'A client needs a name.' : null, reference: refTaken ? 'Another client already uses this reference.' : null };
  const submit = async () => {
    setTried(true);
    if (errors.name || errors.reference) return;
    setBusy(true);
    const values = { name: name.trim(), reference: reference.trim() || null, notes };
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
        <Field label="Notes" hint="Working notes only. Avoid sensitive personal or financial details.">
          {(p) => <Textarea {...p} rows={4} value={notes} maxLength={10000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
