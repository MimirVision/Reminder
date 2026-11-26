// Chasing documents: pick what is still missing from a client, and Ledger writes the email (Norwegian or English),
// opens it in your own email program, marks those documents as requested today, and adds a follow-up task for the
// day you'd like them by. Nothing is sent from Ledger: the email goes from your own mailbox, as you write it.
import { useMemo, useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { useStore } from '../data/store';
import { addDays } from '../lib/dates';
import { formatDate, formatDayLong } from '../lib/format';
import type { Client, ClientDocument, Occurrence } from '../lib/types';
import { Button } from '../ui/button';
import { Checkbox, Field, Input, Segmented, Textarea } from '../ui/field';
import { Dialog } from '../ui/overlay';
import { useToast } from '../ui/toast';
import { outstanding } from './ClientDocuments';
import { requestEmail, type Lang } from '../lib/documentRequest';

const DAYS = [3, 5, 7, 14] as const;

export function RequestDocumentsDialog({ client, task, open, onOpenChange }: {
  client: Client; task?: Occurrence; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const { snap, today, run, saveSettings, patchOccurrence } = useStore();
  const toast = useToast();
  const docs = outstanding(client);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(docs.map((d) => d.id)));
  const [to, setTo] = useState(client.contactEmail);
  const [lang, setLang] = useState<Lang>((snap.workspace.settings.documentRequestLang as Lang) ?? 'nb');
  const [days, setDays] = useState<number>(7);
  const [followUp, setFollowUp] = useState(true);
  const [setWaiting, setSetWaiting] = useState(!!task && task.status !== 'waiting');
  const [edited, setEdited] = useState<{ subject: string; body: string } | null>(null);
  const by = addDays(today, days);
  const chosen = docs.filter((d) => picked.has(d.id));
  // Asked for before: the email says it is a reminder.
  const again = chosen.some((d) => d.requestedOn && d.requestedOn < today);
  const sender = snap.workspace.settings.displayName?.trim() || '';
  const draft = useMemo(() => requestEmail({ lang, client, docs: chosen.map((d) => d.text), by, sender, again }), [lang, client, chosen, by, sender, again]);
  const mail = edited ?? draft;

  const href = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;

  const record = async () => {
    const ids = new Set(chosen.map((d) => d.id));
    const ok = await run(async (r) => {
      const next: ClientDocument[] = client.documents.map((d) => (ids.has(d.id) ? { ...d, requestedOn: today } : d));
      await r.updateClient(client.id, { documents: next });
      if (followUp) {
        await r.createOccurrence({
          clientId: client.id, scheduleId: null, title: `Follow up: documents from ${client.name}`.slice(0, 200),
          description: `Requested ${formatDate(today)}:\n${chosen.map((d) => `• ${d.text}`).join('\n')}`,
          taskType: 'follow_up', periodKey: null, periodStart: null, periodEnd: null, dueDate: by, scheduledDueDate: null,
          status: 'todo', priority: 'normal', tags: ['documents'],
        });
      }
      return true;
    }, { success: followUp ? `Requested. A follow-up is on ${formatDayLong(by)}.` : 'Marked as requested today' });
    if (ok && task && setWaiting) await patchOccurrence(task.id, { status: 'waiting' });
    if (ok && lang !== snap.workspace.settings.documentRequestLang) void saveSettings({ documentRequestLang: lang });
    if (ok) onOpenChange(false);
  };

  const send = () => {
    // Your own email program writes and sends it; Ledger only records that it was asked for.
    const a = document.createElement('a');
    a.href = href;
    a.click();
    void record();
  };
  const copy = () => {
    navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`).then(
      () => { toast.show('Copied. Paste it into an email, then press “Mark as requested”.'); },
      () => toast.show('Your browser didn’t allow copying.', { tone: 'error' }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request documents" width="max-w-2xl"
      description={<>Ledger writes the email; your own email program sends it.</>}
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={copy}><Copy /> Copy text</Button>
        <Button disabled={!chosen.length} onClick={() => void record()}>Mark as requested</Button>
        <Button variant="primary" disabled={!chosen.length} onClick={send}><Mail /> Open in email</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[12.5px] font-medium text-ink-2">What’s missing</legend>
          {docs.length === 0 && <p className="text-[12.5px] text-ink-3">Nothing is outstanding. Add the documents you need on the client’s Documents tab first.</p>}
          {docs.map((d) => (
            <Checkbox key={d.id} checked={picked.has(d.id)} label={d.text}
              description={d.requestedOn ? `Requested ${formatDate(d.requestedOn)}` : undefined}
              onChange={(v) => { setEdited(null); setPicked((s) => { const n = new Set(s); if (v) n.add(d.id); else n.delete(d.id); return n; }); }} />
          ))}
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="To" hint={to.trim() ? undefined : 'No email address for this client yet: add one, or open the email and fill it in there.'}>
            {(p) => <Input {...p} type="email" value={to} placeholder="name@example.com" onChange={(e) => setTo(e.target.value)} />}
          </Field>
          <Field label="Language">
            {() => <div><Segmented label="Language" value={lang} onChange={(v) => { setEdited(null); setLang(v); }} options={[{ value: 'nb', label: 'Norsk' }, { value: 'en', label: 'English' }]} /></div>}
          </Field>
        </div>
        <Field label="Ask for them by" hint={`${formatDayLong(by)}. The email says so, and the follow-up task is due then.`}>
          {() => <div><Segmented label="Ask for them by" value={String(days)} onChange={(v) => { setEdited(null); setDays(Number(v)); }}
            options={DAYS.map((n) => ({ value: String(n), label: n === 7 ? '1 week' : n === 14 ? '2 weeks' : `${n} days` }))} /></div>}
        </Field>
        <Field label="Subject">
          {(p) => <Input {...p} value={mail.subject} onChange={(e) => setEdited({ ...mail, subject: e.target.value })} />}
        </Field>
        <Field label="Message" hint={edited ? <button type="button" className="text-accent hover:underline" onClick={() => setEdited(null)}>Start over from the template</button> : 'You can change it here or in your email program.'}>
          {(p) => <Textarea {...p} rows={10} value={mail.body} onChange={(e) => setEdited({ ...mail, body: e.target.value })} />}
        </Field>
        <div className="flex flex-col gap-2.5">
          <Checkbox checked={followUp} onChange={setFollowUp} label={`Add a follow-up task for ${formatDayLong(by)}`} description="If the documents arrive first, tick them off and close the task." />
          {task && task.status !== 'waiting' && <Checkbox checked={setWaiting} onChange={setSetWaiting} label={`Set “${task.title}” to waiting for client`} />}
        </div>
      </div>
    </Dialog>
  );
}
