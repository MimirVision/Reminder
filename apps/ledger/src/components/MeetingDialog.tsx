// Booking and editing a meeting: what, with whom, when (day and time), where.
import { useEffect, useState } from 'react';
import { CalendarDays, ListPlus, Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { formatDayLong } from '../lib/format';
import { durationMinutes, formatDuration, fromMinutes, isTime, meetingErrors, toMinutes } from '../lib/meetings';
import type { NewMeeting } from '../data/repo';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { DatePicker } from '../ui/datepicker';
import { Field, Input, Select, Textarea } from '../ui/field';
import { Confirm, Dialog } from '../ui/overlay';
import { useUI } from './ui-state';
import { ReminderPicker } from './Notifications';
import { notifySettings } from '../lib/reminders';

const LENGTHS = [15, 30, 45, 60, 90, 120];

/** The next half hour from now, within working hours, for a meeting booked without a time. */
function nextSlot(): string {
  const d = new Date();
  const m = Math.ceil((d.getHours() * 60 + d.getMinutes() + 1) / 30) * 30;
  return fromMinutes(Math.min(Math.max(m, 8 * 60), 17 * 60));
}

export function MeetingDialog() {
  const ui = useUI();
  return ui.meeting ? <Editor key={ui.meeting.mode === 'edit' ? ui.meeting.id : 'new'} /> : null;
}

function Editor() {
  const ui = useUI();
  const { snap, today, run, repo } = useStore();
  const ed = ui.meeting!;
  const existing = ed.mode === 'edit' ? snap.meetings.find((m) => m.id === ed.id) : undefined;
  const [m, setM] = useState<NewMeeting>(() => {
    if (existing) return { clientId: existing.clientId, title: existing.title, date: existing.date, start: existing.start, end: existing.end, location: existing.location, notes: existing.notes, notifyMinutes: existing.notifyMinutes ?? null };
    const n = ed.mode === 'new' ? ed : { mode: 'new' as const };
    const start = n.start ?? nextSlot();
    return { clientId: n.clientId ?? null, title: '', date: n.date ?? today, start, end: n.end ?? fromMinutes(toMinutes(start) + 60), location: '', notes: '', notifyMinutes: null };
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const close = () => ui.openMeeting(null);
  const set = <K extends keyof NewMeeting>(k: K, v: NewMeeting[K]) => setM((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (ed.mode === 'edit' && !existing) close(); }, [existing]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = meetingErrors(m);
  const clients = snap.clients.filter((c) => c.status === 'active' || c.id === m.clientId).sort((a, b) => a.name.localeCompare(b.name));
  const length = isTime(m.start) && isTime(m.end) ? durationMinutes(m) : 0;

  // Moving the start keeps the meeting's length.
  const setStart = (start: string) => setM((x) => {
    if (!isTime(start)) return { ...x, start };
    const len = isTime(x.start) && isTime(x.end) && durationMinutes(x) > 0 ? durationMinutes(x) : 60;
    return { ...x, start, end: fromMinutes(Math.min(toMinutes(start) + len, 23 * 60 + 59)) };
  });

  const save = async () => {
    setTried(true);
    if (errors.title || errors.time) return;
    setBusy(true);
    const values = { ...m, title: m.title.trim(), location: m.location.trim() };
    const ok = await run(async (r) => { if (existing) await r.updateMeeting(existing.id, values); else await r.createMeeting(values); return true; },
      { success: existing ? 'Meeting saved' : `Meeting booked: ${formatDayLong(m.date)} at ${m.start}` });
    setBusy(false);
    if (ok) close();
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && close()} title={existing ? 'Meeting' : 'New meeting'} width="max-w-xl"
        footer={<>
          {existing && (
            <div className="mr-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirm(true)}><Trash2 /> Delete</Button>
              <Button variant="ghost" size="sm" onClick={() => { close(); ui.openNewTask({ clientId: m.clientId ?? undefined, dueDate: m.date, title: `Follow up: ${m.title}` }); }}><ListPlus /> Follow-up task</Button>
            </div>
          )}
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{existing ? 'Save' : 'Book meeting'}</Button>
        </>}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Title" error={tried ? errors.title : null}>
            {(p) => <Input {...p} autoFocus={!existing} value={m.title} maxLength={200} placeholder="e.g. Year-end planning call" onChange={(e) => set('title', e.target.value)} />}
          </Field>
          <Field label="Client" hint="Optional. Leave empty for an internal meeting.">
            {(p) => (
              <Select {...p} value={m.clientId ?? ''} onChange={(e) => set('clientId', e.target.value || null)}>
                <option value="">No client (internal)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto]">
            <Field label="Day">
              {(p) => (
                <DatePicker value={m.date} today={today} onChange={(d) => set('date', d)} trigger={
                  <button {...p} type="button" className="flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-[13px] hover:bg-hover">
                    <CalendarDays className="size-4 text-ink-3" /><span className="truncate">{formatDayLong(m.date)}</span>
                  </button>
                } />
              )}
            </Field>
            <Field label="Starts" error={tried ? errors.time : null}>
              {(p) => <Input {...p} type="time" step={300} className="w-28" value={m.start} onChange={(e) => setStart(e.target.value)} />}
            </Field>
            <Field label="Ends">
              {(p) => <Input {...p} type="time" step={300} className="w-28" value={m.end} onChange={(e) => set('end', e.target.value)} />}
            </Field>
          </div>
          <div className="-mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Length">
            {LENGTHS.map((n) => (
              <button key={n} type="button" aria-pressed={length === n} disabled={!isTime(m.start)}
                onClick={() => set('end', fromMinutes(Math.min(toMinutes(m.start) + n, 23 * 60 + 59)))}
                className={cn('h-6 rounded-md border px-2 text-[12px] transition-colors', length === n ? 'border-accent/50 bg-accent-soft text-accent-ink' : 'border-line text-ink-2 hover:bg-hover')}>
                {formatDuration(n)}
              </button>
            ))}
          </div>
          <Field label="Notify me" hint={repo.notify ? undefined : 'Choosing per meeting needs the database update (Settings).'}>
            {(p) => <ReminderPicker id={p.id} kind="minutes" value={m.notifyMinutes} disabled={!repo.notify} inheritedFrom="Settings"
              inherited={notifySettings(snap.workspace.settings.notifications).meetingMinutes} onChange={(v) => set('notifyMinutes', v)} />}
          </Field>
          <Field label="Where" hint="A room, an address, or Teams/phone.">
            {(p) => <Input {...p} value={m.location} maxLength={500} placeholder="e.g. Teams" onChange={(e) => set('location', e.target.value)} />}
          </Field>
          <Field label="Notes">
            {(p) => <Textarea {...p} rows={3} value={m.notes} maxLength={10000} placeholder="Agenda, what to bring, what was agreed…" onChange={(e) => set('notes', e.target.value)} />}
          </Field>
          <button type="submit" hidden />
        </form>
      </Dialog>
      <Confirm open={confirm} onOpenChange={setConfirm} title="Delete this meeting?" confirmLabel="Delete meeting"
        body={<>“{m.title}” on {formatDayLong(m.date)} will be removed.</>}
        onConfirm={async () => { const ok = await run(async (r) => { await r.deleteMeeting(existing!.id); return true; }, { success: 'Meeting deleted' }); if (ok) close(); }} />
    </>
  );
}
