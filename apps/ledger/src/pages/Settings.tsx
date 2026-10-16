import { useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Database, Download, LogOut, RefreshCw, Trash2, Upload, AlertTriangle } from 'lucide-react';
import { Page } from '../components/Shell';
import { useStore } from '../data/store';
import { parseBackup, toBackup } from '../data/repo';
import { buildSeed } from '../data/seed';
import { DemoRepo } from '../data/demoRepo';
import { DEFAULT_THEME, IS_ARTIFACT, supabase, setDemoChoice, supabaseConfigured } from '../data/config';
import { useToast } from '../ui/toast';
import { formatTimestamp, setLocale } from '../lib/format';
import { STATUS_LABEL, TYPE_LABEL, PRIORITY_LABEL } from '../lib/labels';
import type { WorkspaceSettings } from '../lib/types';
import { Button } from '../ui/button';
import { Field, Input, Segmented, Select } from '../ui/field';
import { Confirm } from '../ui/overlay';

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-b border-line py-6 first:pt-0 last:border-b-0 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] text-ink-3">{description}</p>}
      </div>
      <div className="flex max-w-xl flex-col gap-4">{children}</div>
    </section>
  );
}

const ZONES = (() => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return ['Europe/Oslo', 'Europe/Stockholm', 'Europe/Copenhagen', 'Europe/London', 'UTC']; }
})();

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function Settings({ email }: { email?: string | null }) {
  const { snap, repo, run, lastGeneration, today, clientById, reload } = useStore();
  const toast = useToast();
  // The hosted page can't start downloads, so there the export goes to the clipboard instead.
  const save = (name: string, text: string, type: string) => {
    if (!IS_ARTIFACT) return download(name, text, type);
    navigator.clipboard.writeText(text).then(
      () => toast.show(`Copied to the clipboard. Paste it into a file named ${name} to keep it.`),
      () => toast.show('Your browser didn’t allow copying. Run Ledger from the repository to download files.', { tone: 'error' }),
    );
  };
  const s = snap.workspace.settings;
  const [name, setName] = useState(s.displayName ?? '');
  const [wsName, setWsName] = useState(snap.workspace.name);
  const [confirm, setConfirm] = useState<null | 'erase' | 'seed' | 'reset-demo'>(null);
  const [eraseText, setEraseText] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const saveSettings = (patch: Partial<WorkspaceSettings>, msg = 'Saved') =>
    run((r) => r.updateWorkspace({ settings: { ...snap.workspace.settings, ...patch } }), { success: msg });
  const stamp = today;
  const empty = snap.clients.length === 0 && snap.occurrences.length === 0;

  const exportJson = () => save(`ledger-backup-${stamp}.json`, JSON.stringify(toBackup(snap), null, 2), 'application/json');
  const exportCsv = () => {
    const head = ['Client', 'Reference', 'Task', 'Period', 'Due date', 'Status', 'Priority', 'Type', 'Tags', 'Completed at', 'Notes'];
    const rows = [...snap.occurrences].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((o) => {
      const c = clientById.get(o.clientId);
      return [c?.name, c?.reference, o.title, o.periodKey ?? '', o.dueDate, STATUS_LABEL[o.status], PRIORITY_LABEL[o.priority], TYPE_LABEL[o.taskType], o.tags.join(' '), o.completedAt ?? '', o.description];
    });
    save(`ledger-tasks-${stamp}.csv`, '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
  };
  const restore = async (f: File) => {
    let backup;
    try { backup = parseBackup(JSON.parse(await f.text())); } catch (e) {
      await run(async () => { throw e instanceof SyntaxError ? new Error('That file is not valid JSON.') : e; });
      return;
    }
    await run((r) => r.restore(backup), { generate: true, success: `Restored ${backup.clients.length} clients and ${backup.occurrences.length} tasks` });
  };

  return (
    <Page title="Settings">
      <Section title="You" description="Used for the greeting on Home.">
        <Field label="Display name">
          {(p) => <Input {...p} value={name} maxLength={60} placeholder="Your first name" onChange={(e) => setName(e.target.value)} onBlur={() => name !== (s.displayName ?? '') && void saveSettings({ displayName: name.trim() })} />}
        </Field>
        <Field label="Workspace name">
          {(p) => <Input {...p} value={wsName} maxLength={100} onChange={(e) => setWsName(e.target.value)}
            onBlur={() => wsName.trim() && wsName !== snap.workspace.name && void run((r) => r.updateWorkspace({ name: wsName.trim() }), { success: 'Saved' })} />}
        </Field>
      </Section>

      <Section title="Date and locale" description="Due dates are calendar dates. The time zone decides when “today” starts, here and for the nightly run.">
        <Field label="Time zone">
          {(p) => (
            <Select {...p} value={snap.workspace.timezone} onChange={(e) => void run((r) => r.updateWorkspace({ timezone: e.target.value }), { generate: true, success: 'Time zone saved' })}>
              {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Date format">
          {(p) => (
            <Select {...p} value={s.locale ?? 'en-GB'} onChange={(e) => { setLocale(e.target.value); void saveSettings({ locale: e.target.value }); }}>
              <option value="en-GB">16 Oct 2026 (English, UK)</option>
              <option value="nb-NO">16. okt. 2026 (Norsk)</option>
              <option value="en-US">Oct 16, 2026 (English, US)</option>
              <option value="sv-SE">16 okt. 2026 (Svenska)</option>
              <option value="da-DK">16. okt. 2026 (Dansk)</option>
            </Select>
          )}
        </Field>
      </Section>

      <Section title="Defaults">
        <Field label="Calendar opens in">
          {() => <div><Segmented label="Default calendar view" value={s.defaultCalendarView ?? 'month'} onChange={(v) => void saveSettings({ defaultCalendarView: v })} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} /></div>}
        </Field>
        <Field label="New schedules create tasks" hint="days before they are due. Each schedule can override this.">
          {(p) => <Input {...p} className="w-24" type="number" min={0} max={366} defaultValue={s.defaultLeadDays ?? 21}
            onBlur={(e) => { const n = Math.max(0, Math.min(366, Math.round(Number(e.target.value) || 0))); if (n !== (s.defaultLeadDays ?? 21)) void saveSettings({ defaultLeadDays: n }); }} />}
        </Field>
        <Field label="Theme">
          {() => <div><Segmented label="Theme" value={s.theme ?? DEFAULT_THEME} onChange={(v) => void saveSettings({ theme: v })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></div>}
        </Field>
        <p className="text-[12px] text-ink-3">Reminders are shown inside Ledger (Home, overdue and due-today lists). Browser notifications are not used, so nothing depends on them.</p>
      </Section>

      <Section title="Backup and export" description="Export regularly. The JSON backup holds everything needed to restore this workspace.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportJson}><Download /> {IS_ARTIFACT ? 'Copy backup (JSON)' : 'Download backup (JSON)'}</Button>
          <Button onClick={exportCsv}><Download /> {IS_ARTIFACT ? 'Copy tasks (CSV)' : 'Export tasks (CSV)'}</Button>
        </div>
        <div>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} />
          <Button disabled={!empty} onClick={() => file.current?.click()}><Upload /> Restore from backup…</Button>
          <p className="mt-1.5 text-[12px] text-ink-3">{empty ? 'Restores clients, schedules, pauses, tasks and reviews with their original ids.' : 'Restore works on an empty workspace. Erase it first (below) if you mean to replace everything.'}</p>
        </div>
      </Section>

      <Section title="Application and data status">
        <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2 text-[13px]">
          <dt className="text-ink-3">Storage</dt>
          <dd className="flex items-center gap-1.5">
            {repo.mode === 'supabase' ? <><Database className="size-3.5 text-ok" /> Supabase database, protected by row level security</>
              : <><AlertTriangle className="size-3.5 text-warn" /> Demo mode: fictional data in this browser only. Not backed up or synced.</>}
          </dd>
          {email && <><dt className="text-ink-3">Signed in as</dt><dd>{email}</dd></>}
          <dt className="text-ink-3">Last task generation</dt>
          <dd>
            {lastGeneration ? <span className="inline-flex items-center gap-1.5">
              {lastGeneration.error ? <AlertTriangle className="size-3.5 text-danger" /> : <CheckCircle2 className="size-3.5 text-ok" />}
              {formatTimestamp(lastGeneration.at)} · {lastGeneration.created} created{lastGeneration.error && <span className="text-danger"> · {lastGeneration.error}</span>}
            </span> : 'Not run yet'}
          </dd>
          <dt className="text-ink-3">Records</dt>
          <dd className="tnum">{snap.clients.length} clients · {snap.schedules.length} schedules · {snap.occurrences.length} tasks</dd>
          <dt className="text-ink-3">Version</dt><dd className="tnum text-ink-3">{__BUILD__}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run((r) => r.generate(), { success: (n) => (n ? `${n} task${n === 1 ? '' : 's'} created` : 'Everything is up to date') })}><RefreshCw /> Run generation now</Button>
          {repo.mode === 'supabase' && empty && <Button onClick={() => setConfirm('seed')}><Database /> Load fictional demo data</Button>}
          {repo.mode === 'demo' && <Button onClick={() => setConfirm('reset-demo')}><RefreshCw /> Reset demo data</Button>}
          {repo.mode === 'demo' && supabaseConfigured && <Button onClick={() => { setDemoChoice(false); location.reload(); }}>Leave demo mode</Button>}
          {repo.mode === 'supabase' && <Button variant="ghost" onClick={() => void supabase().auth.signOut().then(() => location.reload())}><LogOut /> Sign out</Button>}
        </div>
        <div className="mt-2 rounded-lg border border-danger/25 p-4">
          <h3 className="text-[13px] font-semibold text-danger">Erase all data</h3>
          <p className="mt-1 text-[12.5px] text-ink-2">Deletes every client, schedule, task and history entry in this workspace. Download a backup first. Home Memory and Post are not affected.</p>
          <Button className="mt-3" variant="danger" size="sm" onClick={() => { setEraseText(''); setConfirm('erase'); }}><Trash2 /> Erase all data…</Button>
        </div>
      </Section>

      <Confirm open={confirm === 'erase'} onOpenChange={(o) => !o && setConfirm(null)} title="Erase everything in this workspace?" confirmLabel="Erase all data"
        body={<>This can’t be undone. Type <strong>ERASE</strong> to confirm.</>}
        disabled={eraseText !== 'ERASE'} onConfirm={() => run((r) => r.erase(), { success: 'Workspace erased' })}>
        <Input className="mt-3" aria-label="Type ERASE to confirm" value={eraseText} onChange={(e) => setEraseText(e.target.value)} placeholder="ERASE" />
      </Confirm>
      <Confirm open={confirm === 'seed'} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title="Load fictional demo data?" confirmLabel="Load demo data"
        body="Adds about 20 invented clients with schedules and tasks, so you can try everything. Erase it from here when you are ready to start for real."
        onConfirm={() => run(async (r) => { const b = toBackup(buildSeed(today)); await r.restore({ ...b, workspace: { ...b.workspace, name: snap.workspace.name, timezone: snap.workspace.timezone } }); }, { generate: true, success: 'Demo data loaded' })} />
      <Confirm open={confirm === 'reset-demo'} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title="Reset the demo?" confirmLabel="Reset"
        body="Replaces everything in this browser’s demo with fresh fictional data."
        onConfirm={async () => { (repo as DemoRepo).reset(today); await reload(); }} />
    </Page>
  );
}
