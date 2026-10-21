import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canPromptInstall, isInstalled, onInstallChange, promptInstall } from '../lib/install';
import { CheckCircle2, Database, Download, LogOut, RefreshCw, RotateCcw, Trash2, Upload, AlertTriangle } from 'lucide-react';
import { cn } from '../ui/cn';
import { Page } from '../components/Shell';
import { useStore } from '../data/store';
import { parseBackup, toBackup } from '../data/repo';
import { buildSeed } from '../data/seed';
import { DemoRepo } from '../data/demoRepo';
import { DEFAULT_THEME, IS_ARTIFACT, supabase, setDemoChoice, supabaseConfigured } from '../data/config';
import { useToast } from '../ui/toast';
import { formatTimestamp, setLocale } from '../lib/format';
import { STATUS_LABEL, TYPE_LABEL, PRIORITY_LABEL } from '../lib/labels';
import { TASK_TYPES, type Accent, type TaskType, type WorkspaceSettings } from '../lib/types';
import { calendarOf } from '../lib/holidays';
import { ChecklistEditor, fromLines } from '../components/Checklist';
import { Button } from '../ui/button';
import { Field, Input, Segmented, Select } from '../ui/field';
import { Confirm } from '../ui/overlay';
import { NotificationSettings } from '../components/Notifications';

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-b border-line py-6 first:pt-0 last:border-b-0 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] text-ink-3">{description}</p>}
      </div>
      <div className="flex max-w-md flex-col gap-4">{children}</div>
    </section>
  );
}

const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'cobalt', label: 'Cobalt', swatch: '#2b59e3' }, { id: 'violet', label: 'Violet', swatch: '#6a45d9' }, { id: 'teal', label: 'Teal', swatch: '#0e7c72' },
  { id: 'amber', label: 'Amber', swatch: '#b4560f' }, { id: 'rose', label: 'Rose', swatch: '#c03462' }, { id: 'graphite', label: 'Graphite', swatch: '#2e3038' },
];

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
  const { snap, repo, run, lastGeneration, today, clientById, reload, saveSettings: store } = useStore();
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
    store(patch).then((ok) => { if (ok) toast.show(msg); });
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
              {(ZONES.includes(snap.workspace.timezone) ? ZONES : [snap.workspace.timezone, ...ZONES]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
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
        <Field label="Public holidays" hint={repo.current
          ? 'Schedules set to move off weekends also move off these days. Tasks already created keep their dates.'
          : 'Available after the database update below.'}>
          {() => <div><Segmented label="Public holidays" value={calendarOf(s)} onChange={(v) => void saveSettings({ holidays: v }, v === 'NO' ? 'Norwegian holidays are now non-working days' : 'Only weekends move due dates now')}
            options={[{ value: 'NO', label: 'Norway' }, { value: 'none', label: 'None (weekends only)' }]} /></div>}
        </Field>
      </Section>

      <Section title="Defaults">
        <Field label="Calendar opens in">
          {() => <div><Segmented label="Default calendar view" value={s.defaultCalendarView ?? 'month'} onChange={(v) => void saveSettings({ defaultCalendarView: v })} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} /></div>}
        </Field>
        <Field label="New schedules create tasks" hint="Each schedule can override this.">
          {(p) => (
            <div className="flex items-center gap-2">
              <div className="w-20"><Input {...p} type="number" min={0} max={366} defaultValue={s.defaultLeadDays ?? 21}
                onBlur={(e) => { const n = Math.max(0, Math.min(366, Math.round(Number(e.target.value) || 0))); if (n !== (s.defaultLeadDays ?? 21)) void saveSettings({ defaultLeadDays: n }); }} /></div>
              <span className="text-[13px] text-ink-2">days before they are due</span>
            </div>
          )}
        </Field>
      </Section>

      <Section title="Notifications" description="Reminders on your phone and PC. Turn them on once on each device; what you are reminded of, and when, is shared by all of them.">
        <NotificationSettings />
      </Section>

      <Section title="Checklist templates" description="Steps every new task of a type starts with. New schedules of that type start with them too, and each schedule can change its own.">
        {repo.current ? <Templates value={s.checklistTemplates ?? {}} onSave={(checklistTemplates) => void saveSettings({ checklistTemplates }, 'Template saved')} />
          : <p className="text-[12.5px] text-ink-3">Available after the database update below.</p>}
      </Section>

      <Section title="Appearance" description="How Ledger looks and feels. Saved to your workspace, so it follows you to other devices.">
        <Field label="Theme">
          {() => <div><Segmented label="Theme" value={s.theme ?? DEFAULT_THEME} onChange={(v) => void saveSettings({ theme: v })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></div>}
        </Field>
        <Field label="Accent colour">
          {() => (
            <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => {
                const on = (s.accent ?? 'cobalt') === a.id;
                return (
                  <button key={a.id} role="radio" aria-checked={on} aria-label={a.label} title={a.label} onClick={() => !on && void saveSettings({ accent: a.id }, `Accent: ${a.label}`)}
                    className={cn('flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow', on ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line-strong')}>
                    <span className="size-7 rounded-full ring-1 ring-ink/15" style={{ background: a.swatch }} />
                  </button>
                );
              })}
            </div>
          )}
        </Field>
        <Field label="Density" hint="Compact fits more rows on screen in task lists.">
          {() => <div><Segmented label="Density" value={s.density ?? 'comfortable'} onChange={(v) => void saveSettings({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></div>}
        </Field>
        <Field label="Open Ledger on">
          {() => <div><Segmented label="Start page" value={s.startPage ?? 'home'} onChange={(v) => void saveSettings({ startPage: v })} options={[{ value: 'home', label: 'Home' }, { value: 'tasks', label: 'My Tasks' }, { value: 'calendar', label: 'Calendar' }]} /></div>}
        </Field>
        {!IS_ARTIFACT && <Field label="Install as an app">{() => <InstallApp />}</Field>}
        <Field label="Home dashboard" hint="Use Customize on Home to add, move and resize widgets.">
          {() => <div><Button size="sm" onClick={() => void saveSettings({ homeLayout: undefined }, 'Home reset to the default layout')}><RotateCcw /> Reset Home layout</Button></div>}
        </Field>
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
        {repo.mode === 'supabase' && !repo.notify && <DatabaseUpdate />}
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
        onConfirm={() => run(async (r) => { const b = toBackup(buildSeed(today)); // Keep the person's own settings (name, theme, layout, notes, views); only the demo's checklist templates are added.
          await r.restore({ ...b, workspace: { name: snap.workspace.name, timezone: snap.workspace.timezone,
            settings: { ...snap.workspace.settings, checklistTemplates: snap.workspace.settings.checklistTemplates ?? b.workspace.settings.checklistTemplates } } }); }, { generate: true, success: 'Demo data loaded' })} />
      <Confirm open={confirm === 'reset-demo'} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title="Reset the demo?" confirmLabel="Reset"
        body="Replaces everything in this browser’s demo with fresh fictional data."
        onConfirm={async () => { (repo as DemoRepo).reset(today); await reload(); }} />
    </Page>
  );
}

/** Shown while the database is on an older ledger.sql: which features wait for it, and how to run it. */
export function DatabaseUpdate() {
  const { repo } = useStore();
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-soft p-4 text-[12.5px] text-warn">
      <p className="font-semibold">Database update available</p>
      <p className="mt-1 text-ink-2">
        Run <code className="num rounded bg-surface px-1">apps/ledger/supabase/ledger.sql</code> again in Supabase → SQL Editor to turn on {repo.meetings ? 'notifications on your phone and PC with Ledger closed, and choosing them per task and meeting'
          : repo.current ? 'meetings in the calendar and phone/PC notifications' : <>meetings, notifications, checklists,
        “waiting since”, client contacts and documents, and holiday-aware due dates</>}. It only adds to Ledger’s own tables; Home Memory and Post
        are not touched, and nothing you have is changed.
      </p>
    </div>
  );
}

function Templates({ value, onSave }: { value: Partial<Record<TaskType, string[]>>; onSave: (v: Partial<Record<TaskType, string[]>>) => void }) {
  const [type, setType] = useState<TaskType>('bookkeeping');
  return (
    <div className="flex flex-col gap-3">
      <Select aria-label="Task type" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
        {TASK_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}{value[t]?.length ? ` (${value[t]!.length})` : ''}</option>)}
      </Select>
      <TemplateEditor key={type} lines={value[type]} label={`${TYPE_LABEL[type]} checklist`} onChange={(lines) => onSave({ ...value, [type]: lines })} />
    </div>
  );
}

function TemplateEditor({ lines, label, onChange }: { lines: string[] | undefined; label: string; onChange: (lines: string[]) => void }) {
  // Items keep their ids while you edit; only the text is stored.
  const [items, setItems] = useState(() => fromLines(lines));
  return <ChecklistEditor template items={items} label={label} onChange={(next) => { setItems(next); onChange(next.map((i) => i.text)); }} />;
}

function InstallApp() {
  const toast = useToast();
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  if (isInstalled()) return <p className="text-[12.5px] text-ok">Ledger is running as an installed app.</p>;
  if (canPromptInstall()) {
    return (
      <div>
        <Button size="sm" onClick={() => void promptInstall().then((ok) => ok && toast.show('Ledger is installed. Open it from your apps or home screen.'))}><Download /> Install Ledger</Button>
        <p className="mt-1.5 text-[12px] text-ink-3">Opens in its own window, with its own icon. Your data stays in the same database.</p>
      </div>
    );
  }
  return (
    <p className="text-[12.5px] text-ink-3">
      On iPhone or iPad: Safari → Share → <span className="text-ink-2">Add to Home Screen</span>. On a computer: the install icon at the right of the address bar in Chrome or Edge.
      The app opens in its own window and uses the same data.
    </p>
  );
}
