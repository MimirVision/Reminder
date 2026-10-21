// Notifications in the app: the runner (reminders while Ledger is open, and opening what a notification points at),
// the "turn on for this device" prompt, the Settings section, and the picker each task, schedule and meeting uses
// to choose its own reminders.
import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Check, Laptop, Send, Smartphone, Trash2, X } from 'lucide-react';
import { IS_ARTIFACT } from '../data/config';
import type { PushDevice, PushStatus } from '../data/repo';
import { useStore } from '../data/store';
import {
  currentSubscription, deviceMode, disableDevice, dismissPrompt, enableDevice, needsHomeScreen, notificationsSupported, onDeviceChange,
  permission, promptDismissed, showLocal, syncDevice, type EnableResult,
} from '../lib/device';
import { formatTimestamp } from '../lib/format';
import {
  MAX_REMINDERS, MEETING_MINUTE_CHOICES, TASK_DAY_CHOICES, describeDays, describeMinutes, messagesFor, notifySettings, remindersBetween,
  type NotifySettings,
} from '../lib/reminders';
import { useRoute } from '../router';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Checkbox, Field, Input, Segmented } from '../ui/field';
import { Popover } from '../ui/overlay';
import { useToast } from '../ui/toast';
import { useUI } from './ui-state';

/** Re-renders when this device's notification state changes. */
export function useDevice() {
  const [, force] = useState(0);
  useEffect(() => {
    const off = onDeviceChange(() => force((n) => n + 1));
    // The permission can change in the browser's own settings while Ledger is in the background.
    const on = () => document.visibilityState === 'visible' && force((n) => n + 1);
    document.addEventListener('visibilitychange', on);
    return () => { off(); document.removeEventListener('visibilitychange', on); };
  }, []);
  return { mode: deviceMode(), permission: permission() };
}

/** A sentence for what turning a device on did. */
function enableMessage(r: EnableResult): { text: string; tone?: 'error' } {
  if (r.ok && r.mode === 'push') return { text: 'Notifications are on for this device. They arrive even when Ledger is closed.' };
  if (r.ok) {
    if (r.why === 'demo') return { text: 'Notifications are on. In the demo they appear while Ledger is open.' };
    if (r.why === 'not_deployed' || r.why === 'not_configured' || r.why === 'no-database') {
      return { text: 'Notifications are on while Ledger is open. To get them with Ledger closed too, finish the setup in Settings → Notifications.' };
    }
    return { text: 'Notifications are on while Ledger is open on this device.' };
  }
  if (r.why === 'denied') return { text: 'Notifications are blocked for Ledger in this browser. Allow them in the browser’s settings for this site, then try again.', tone: 'error' };
  if (r.why === 'home-screen') return { text: 'On iPhone and iPad, add Ledger to the Home Screen first (Share → Add to Home Screen), then turn notifications on from there.', tone: 'error' };
  return { text: 'This browser can’t show notifications.', tone: 'error' };
}

function useEnable() {
  const { repo } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      const r = await enableDevice(repo.push, { databaseReady: repo.notify });
      const m = enableMessage(r);
      toast.show(m.text, m.tone ? { tone: m.tone } : undefined);
      return r;
    } finally { setBusy(false); }
  };
  return { enable, busy };
}

// ---- the runner ----------------------------------------------------------------------------------------------

const FIRED_KEY = 'ledger-notified';
const LATE_MS = 30 * 60_000;
function fired(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
function markFired(keys: string[]) {
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(fired()).filter(([, t]) => now - t < 3 * 86_400_000));
  for (const k of keys) kept[k] = now;
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(kept)); } catch { /* storage blocked: may repeat once */ }
}

/**
 * Always mounted. Opens a task or meeting a notification points at (?task=… / ?meeting=…), and on a device in
 * "local" mode shows the reminders itself while Ledger is open.
 */
export function NotificationRunner() {
  const { snap, repo } = useStore();
  const ui = useUI();
  const { path, query, navigate } = useRoute();
  const { mode } = useDevice();

  // A tapped notification lands here with the item in the address.
  useEffect(() => {
    const task = query.get('task'), meeting = query.get('meeting');
    if (!task && !meeting) return;
    if (task) ui.openTask(task);
    if (meeting) ui.openMeeting({ mode: 'edit', id: meeting });
    const rest = new URLSearchParams(query);
    rest.delete('task'); rest.delete('meeting');
    navigate(`${path}${rest.size ? `?${rest}` : ''}`, { replace: true });
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // ... or, when Ledger is already open, the service worker hands the address over.
  const nav = useRef(navigate);
  nav.current = navigate;
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => { if (e.data?.type === 'ledger-open' && typeof e.data.url === 'string') nav.current(e.data.url); };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, []);

  useEffect(() => { void syncDevice(repo.push); }, [repo]);

  const settings = notifySettings(snap.workspace.settings.notifications);
  const tz = snap.workspace.timezone;
  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (mode !== 'local' || IS_ARTIFACT) return;
    const data = { tasks: snap.occurrences, meetings: snap.meetings, schedules: snap.schedules, clientName: (id: string) => snap.clients.find((c) => c.id === id)?.name, settings, timeZone: tz };
    let timer = 0;
    const tick = () => {
      const now = Date.now();
      const done = fired();
      const due = remindersBetween(data, now - LATE_MS, now).filter((r) => !done[r.key]);
      if (due.length) {
        markFired(due.map((r) => r.key));
        for (const m of messagesFor(due, settings.details)) void showLocal(m, (url) => nav.current(url)).catch(() => { /* blocked meanwhile */ });
      }
      // Wake for the next one, and at least every 15 minutes (timers drift while a laptop sleeps).
      const next = remindersBetween(data, now, now + 15 * 60_000)[0];
      timer = window.setTimeout(tick, Math.max(1000, (next ? next.at - now : 15 * 60_000) + 500));
    };
    tick();
    const wake = () => { if (document.visibilityState === 'visible') { window.clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', wake);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  }, [mode, snap.occurrences, snap.meetings, snap.schedules, snap.clients, settingsKey, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ---- the prompt on Home ----------------------------------------------------------------------------------------

/** Asks once per device to turn notifications on: browsers only allow it after a tap. */
export function NotificationPrompt() {
  const { snap } = useStore();
  const { mode, permission: perm } = useDevice();
  const { enable, busy } = useEnable();
  const settings = notifySettings(snap.workspace.settings.notifications);
  if (IS_ARTIFACT || !settings.enabled || mode !== 'off' || promptDismissed() || perm === 'denied') return null;
  const homeScreen = needsHomeScreen();
  if (!homeScreen && !notificationsSupported()) return null;
  return (
    <div role="region" aria-label="Notifications" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft/60 px-4 py-3">
      <BellRing className="size-5 shrink-0 text-accent-ink" />
      <div className="min-w-[min(100%,260px)] flex-1 text-[13px]">
        <p className="font-medium text-ink">Get reminders on this {homeScreen || /Android|iPhone|iPad/.test(navigator.userAgent) ? 'phone' : 'computer'}</p>
        <p className="text-ink-2">
          {homeScreen ? 'On iPhone and iPad, add Ledger to the Home Screen first (Share → Add to Home Screen), then open it from there.'
            : <>{describeDays(settings.taskDays, settings.taskTime)} for tasks, {describeMinutes(settings.meetingMinutes).toLowerCase()} for meetings. Change it in Settings.</>}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {!homeScreen && <Button size="sm" variant="primary" loading={busy} onClick={() => void enable()}><Bell /> Turn on</Button>}
        <Button size="sm" variant="ghost" onClick={dismissPrompt}>Not now</Button>
      </div>
    </div>
  );
}

// ---- choosing reminders ------------------------------------------------------------------------------------------

const DAY_LABEL: Record<number, string> = { 0: 'On the day', 1: '1 day', 2: '2 days', 3: '3 days', 5: '5 days', 7: '1 week', 14: '2 weeks', 30: '30 days' };
const MINUTE_LABEL: Record<number, string> = { 0: 'At start', 5: '5 min', 10: '10 min', 15: '15 min', 30: '30 min', 60: '1 hour', 120: '2 hours', 1440: '1 day' };
const label = (kind: 'days' | 'minutes', n: number) => (kind === 'days' ? DAY_LABEL[n] ?? `${n} days` : MINUTE_LABEL[n] ?? `${n} min`);

/** Toggle buttons for days (or minutes) before. Up to four. */
export function ReminderChips({ kind, value, onChange, muted, label: groupLabel }: {
  kind: 'days' | 'minutes'; value: number[]; onChange: (v: number[]) => void; muted?: boolean; label: string;
}) {
  const choices = [...new Set([...(kind === 'days' ? TASK_DAY_CHOICES : MEETING_MINUTE_CHOICES), ...value])].sort((a, b) => a - b);
  const full = value.length >= MAX_REMINDERS;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={groupLabel}>
      {choices.map((n) => {
        const on = value.includes(n);
        return (
          <button key={n} type="button" aria-pressed={on} disabled={!on && full} title={!on && full ? 'Up to four notifications' : undefined}
            onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n].sort((a, b) => b - a))}
            className={cn('inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors disabled:opacity-40',
              on ? (muted ? 'border-line-strong bg-sunken text-ink-2' : 'border-accent/50 bg-accent-soft text-accent-ink') : 'border-line-strong text-ink-2 hover:bg-hover hover:text-ink')}>
            {on && <Check className="size-3" />}{label(kind, n)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Notify me" for one task, schedule or meeting: its own reminders, or (null) the inherited ones. Shown as a compact
 * button that opens the choices.
 */
export function ReminderPicker({ id, kind, value, inherited, inheritedFrom, onChange, disabled, className }: {
  id?: string; kind: 'days' | 'minutes'; value: number[] | null | undefined; inherited: number[]; inheritedFrom: string;
  onChange: (v: number[] | null) => void; disabled?: boolean; className?: string;
}) {
  const { snap } = useStore();
  const s = notifySettings(snap.workspace.settings.notifications);
  const own = value != null;
  const shown = value ?? inherited;
  const describe = (v: number[]) => (kind === 'days' ? describeDays(v, v.length ? s.taskTime : undefined) : describeMinutes(v));
  const text = !s.enabled ? 'Notifications are paused' : own ? describe(shown) : `${describe(shown)} (${inheritedFrom})`;
  return (
    <Popover align="start" trigger={
      <button id={id} type="button" disabled={disabled} aria-label={`Notifications: ${text}`}
        className={cn('flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-[13px] hover:bg-hover disabled:opacity-50', className)}>
        {shown.length && s.enabled ? <Bell className="size-4 shrink-0 text-ink-3" /> : <BellOff className="size-4 shrink-0 text-ink-3" />}
        <span className={cn('truncate', !own && 'text-ink-2')}>{text}</span>
      </button>
    }>
      <div className="flex w-[min(340px,calc(100vw-24px))] flex-col gap-3 p-3">
        <p className="text-[12.5px] font-medium text-ink-2">{kind === 'days' ? 'Notify me before it is due' : 'Notify me before it starts'}</p>
        <ReminderChips kind={kind} label="Notifications" value={shown} muted={!own} onChange={(v) => onChange(v)} />
        <p className="text-[12px] text-ink-3">
          {own ? <>Chosen for this one. </> : <>Using the default from {inheritedFrom}. Pick to choose for this one. </>}
          {kind === 'days' && <>Task notifications arrive at {s.taskTime} (Settings).</>}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {own && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Use the default ({describe(inherited).toLowerCase()})</Button>}
          {shown.length > 0 && <Button size="sm" variant="ghost" onClick={() => onChange([])}><BellOff /> None for this one</Button>}
        </div>
      </div>
    </Popover>
  );
}

// ---- Settings ----------------------------------------------------------------------------------------------------

const minutesAgo = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 60_000);

/** The Notifications section in Settings. */
export function NotificationSettings() {
  const { snap, repo, saveSettings } = useStore();
  const toast = useToast();
  const s = notifySettings(snap.workspace.settings.notifications);
  const save = (patch: Partial<NotifySettings>, msg = 'Saved') =>
    saveSettings({ notifications: { ...s, ...patch } }).then((ok) => { if (ok) toast.show(msg); });
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const { mode } = useDevice();
  const refresh = () => {
    if (!repo.push) return;
    void repo.push.status().then(setStatus);
    if (repo.notify) void repo.push.devices().then(setDevices, () => setDevices([]));
    void currentSubscription().then((sub) => setEndpoint(sub?.endpoint ?? null));
  };
  useEffect(refresh, [repo, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Field label="This device">{() => <ThisDevice status={status} endpoint={endpoint} onChange={refresh} />}</Field>
      <Checkbox checked={s.enabled} onChange={(enabled) => void save({ enabled }, enabled ? 'Notifications are on' : 'Notifications are paused on every device')}
        label="Send notifications" description="Turn off to pause them on every device. The reminders inside Ledger stay." />
      <Field label="Tasks" hint="On the due date, or days before it. The default for every task; a task or schedule can choose its own.">
        {() => (
          <div className={cn('flex flex-col gap-2.5', !s.enabled && 'opacity-50')}>
            <ReminderChips kind="days" label="Task notifications" value={s.taskDays} onChange={(taskDays) => void save({ taskDays }, taskDays.length ? describeDays(taskDays, s.taskTime) : 'No task notifications')} />
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              at
              <span className="w-32"><Input type="time" step={300} aria-label="Time task notifications arrive" defaultValue={s.taskTime} key={s.taskTime}
                onBlur={(e) => { const v = e.target.value; if (/^\d\d:\d\d$/.test(v) && v !== s.taskTime) void save({ taskTime: v }, `Task notifications arrive at ${v}`); }} /></span>
            </label>
          </div>
        )}
      </Field>
      <Field label="Meetings" hint="Minutes before it starts. The default for every meeting; a meeting can choose its own.">
        {() => <div className={cn(!s.enabled && 'opacity-50')}><ReminderChips kind="minutes" label="Meeting notifications" value={s.meetingMinutes} onChange={(meetingMinutes) => void save({ meetingMinutes }, meetingMinutes.length ? `Meetings: ${describeMinutes(meetingMinutes).toLowerCase()}` : 'No meeting notifications')} /></div>}
      </Field>
      <Field label="On the lock screen" hint={s.details ? 'Shows the task or meeting and the client.' : 'Shows only “A task is due today”. Open Ledger to see which.'}>
        {() => <div><Segmented label="On the lock screen" value={s.details ? 'show' : 'hide'} onChange={(v) => void save({ details: v === 'show' })}
          options={[{ value: 'show', label: 'Show names' }, { value: 'hide', label: 'Hide names' }]} /></div>}
      </Field>
      {repo.push && repo.notify && devices && devices.length > 0 && (
        <Field label="Your devices" hint="Each gets the same notifications. Remove one you no longer use.">
          {() => <DeviceList devices={devices} endpoint={endpoint} onChange={refresh} />}
        </Field>
      )}
      {repo.push && <ServerStatus status={status} />}
    </>
  );
}

function ThisDevice({ status, endpoint, onChange }: { status: PushStatus | null; endpoint: string | null; onChange: () => void }) {
  const { repo } = useStore();
  const toast = useToast();
  const { mode, permission: perm } = useDevice();
  const { enable, busy } = useEnable();
  const { navigate } = useRoute();
  const [testing, setTesting] = useState(false);
  if (IS_ARTIFACT) return <p className="text-[12.5px] text-ink-3">Not available on this hosted demo page. Open Ledger itself to turn notifications on.</p>;
  if (needsHomeScreen()) return <p className="text-[12.5px] text-ink-2">On iPhone and iPad, notifications work in the Home Screen app: Safari → Share → <span className="font-medium">Add to Home Screen</span>, open Ledger from the new icon, and turn them on here. Needs iOS 16.4 or newer.</p>;
  if (!notificationsSupported()) return <p className="text-[12.5px] text-ink-3">This browser can’t show notifications.</p>;
  if (perm === 'denied') return <p className="text-[12.5px] text-warn">Blocked for Ledger in this browser. Allow notifications in the browser’s settings for this site (the icon left of the address), then reload.</p>;

  const test = async () => {
    setTesting(true);
    try {
      if (mode === 'push' && repo.push && endpoint) {
        const n = await repo.push.test(endpoint).catch(() => 0);
        toast.show(n ? 'Test sent. It should arrive in a few seconds.' : 'The test couldn’t be delivered. Turn notifications off and on again on this device.', n ? undefined : { tone: 'error' });
      } else {
        await showLocal({ title: 'Ledger notifications work', body: 'Reminders appear like this while Ledger is open.', tag: 'ledger-test', url: '/settings' }, navigate);
      }
    } finally { setTesting(false); }
  };
  const turnOff = async () => { await disableDevice(repo.push); toast.show('Notifications are off on this device'); onChange(); };
  const canUpgrade = mode === 'local' && repo.push && repo.notify && status?.ok;

  if (mode === 'off') {
    return (
      <div>
        <Button loading={busy} onClick={() => void enable().then(onChange)}><Bell /> Turn on for this device</Button>
        <p className="mt-1.5 text-[12px] text-ink-3">Do this once on your phone and once on your PC. The browser asks for permission.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-1.5 text-[13px]">
        <Check className="mt-0.5 size-4 shrink-0 text-ok" />
        {mode === 'push' ? <span>On. Notifications arrive even when Ledger is closed.</span>
          : <span>On while Ledger is open (a tab or the installed app).{repo.push ? ' With Ledger closed they need the server setup below.' : ''}</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {canUpgrade && <Button size="sm" variant="primary" loading={busy} onClick={() => void enable().then(onChange)}><BellRing /> Also with Ledger closed</Button>}
        <Button size="sm" loading={testing} onClick={() => void test()}><Send /> Send a test</Button>
        <Button size="sm" variant="ghost" onClick={() => void turnOff()}><BellOff /> Turn off here</Button>
      </div>
    </div>
  );
}

function DeviceList({ devices, endpoint, onChange }: { devices: PushDevice[]; endpoint: string | null; onChange: () => void }) {
  const { repo, run } = useStore();
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {devices.map((d) => {
        const Icon = /iPhone|iPad|Android/.test(d.label) ? Smartphone : Laptop;
        const here = d.endpoint === endpoint;
        return (
          <li key={d.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
            <Icon className="size-4 shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{d.label || 'A device'}{here && <span className="ml-1.5 text-[12px] text-accent-ink">This device</span>}</span>
            <span className="hidden text-[12px] text-ink-3 sm:inline">since {formatTimestamp(d.createdAt)}</span>
            <button type="button" aria-label={`Remove ${d.label}`} title="Remove" className="rounded p-1 text-ink-3 hover:bg-hover hover:text-danger"
              onClick={() => void run(async () => { if (here) await disableDevice(repo.push); else await repo.push!.removeDevice(d.endpoint); return true; }, { success: 'Device removed' }).then(onChange)}>
              {here ? <X className="size-4" /> : <Trash2 className="size-4" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ServerStatus({ status }: { status: PushStatus | null }) {
  const { repo } = useStore();
  if (!repo.notify) {
    return <p className="rounded-lg bg-sunken px-3 py-2 text-[12.5px] text-ink-2">Notifications with Ledger closed, and choosing them per task and meeting, need the database update (see the bottom of this page). Until then they show while Ledger is open.</p>;
  }
  if (!status) return null;
  const guide = <>Setup (about ten minutes, once): <code className="num rounded bg-surface px-1">apps/ledger/NOTIFICATIONS.md</code>.</>;
  if (!status.ok) {
    if (status.reason === 'offline') return null;
    return (
      <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-[12.5px]">
        <p className="font-medium text-warn">{status.reason === 'not_configured' ? 'The notification server is missing its keys' : 'Not set up yet for Ledger closed'}</p>
        <p className="mt-1 text-ink-2">
          {status.reason === 'not_configured' ? 'The ledger-notify function is deployed, but the VAPID keys are not in its secrets. '
            : 'The ledger-notify function is not deployed in Supabase yet, so notifications only show while Ledger is open. '}
          {guide}
        </p>
      </div>
    );
  }
  const ago = status.lastRun ? minutesAgo(status.lastRun) : null;
  if (ago === null || ago > 20) {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-[12.5px]">
        <p className="font-medium text-warn">{ago === null ? 'The 5-minute schedule has not run yet' : `The 5-minute schedule last ran ${formatTimestamp(status.lastRun!)}`}</p>
        <p className="mt-1 text-ink-2">The test works, but reminders are only sent when the schedule wakes the function (the Cron step). {guide}</p>
      </div>
    );
  }
  return <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3"><Check className="size-3.5 text-ok" /> Notification server running · checked {ago <= 1 ? 'just now' : `${ago} min ago`}</p>;
}
