import { leftCounts } from './leftlog.ts';
import type { Problem } from './diag.ts';
import type { OutboxItem, State } from './controller.ts';
import type { StoreStatus } from './store.ts';

// What Post can tell about its own health, as plain data in and plain words out: the "Health" page shows it, and the problem report is the
// same facts as text to paste into a message. Nothing from inside a message is in it: no subject, no sender, no address, no text.

export interface HealthInput {
  build: string;
  now: number;
  state: Pick<State, 'online' | 'accounts' | 'sync' | 'waiting' | 'outbox' | 'alertsOn' | 'ready'> & { left?: State['left'] };
  storage: StoreStatus;
  problems: Problem[];
  device: {
    userAgent: string;
    /** Opened from the Home Screen (as an app) rather than in a browser tab. */
    standalone: boolean;
    language?: string;
    /** What the phone says about the room for Post's copy of the mail. */
    room?: { usage: number; quota: number; persisted?: boolean };
  };
}

export interface Finding { level: 'ok' | 'warn' | 'bad'; title: string; detail?: string }

const MINUTE = 60_000;

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
export function ago(then: number | null | undefined, now: number): string {
  if (!then) return 'never';
  const d = Math.max(0, now - then);
  if (d < MINUTE) return 'just now';
  if (d < 60 * MINUTE) return `${Math.floor(d / MINUTE)} min ago`;
  if (d < 24 * 60 * MINUTE) return `${Math.floor(d / (60 * MINUTE))} h ago`;
  return `${Math.floor(d / (24 * 60 * MINUTE))} days ago`;
}

const mb = (n: number) => (n >= 10 * 1024 * 1024 ? `${Math.round(n / 1024 / 1024)} MB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The oldest message still waiting to leave, in minutes past when it should have gone. */
const overdue = (outbox: OutboxItem[], now: number) => outbox.reduce((m, x) => Math.max(m, x.sendAt <= now ? Math.floor((now - x.sendAt) / MINUTE) : 0), 0);

/** What needs a look, worst first. When there is nothing, one line says so. */
export function findings(i: HealthInput): Finding[] {
  const out: Finding[] = [];
  const { state } = i;
  for (const a of state.accounts) if (a.needsSignIn) out.push({ level: 'bad', title: `${a.label} needs you to sign in again`, detail: 'Mail keeps its place and nothing is lost. Sign in from the account list.' });
  if (i.storage.kind === 'memory') out.push({ level: 'bad', title: 'Post cannot save on this phone right now', detail: 'What you do here is kept only until Post is closed. Mail itself is safe in Outlook. Closing Post and opening it again usually fixes this.' });
  const late = overdue(state.outbox, i.now);
  if (state.outbox.length && late >= 2) out.push({ level: 'bad', title: `${state.outbox.length === 1 ? 'A message has' : `${state.outbox.length} messages have`} been waiting to be sent for ${late} min`, detail: state.online ? 'Post tries again every minute. Open Post and pull down the list to try now.' : 'Post sends it as soon as the connection is back.' });
  if (state.online && state.sync.error && !state.sync.running) out.push({ level: 'bad', title: 'The last read of your mail failed', detail: state.sync.error });
  if (!state.online) out.push({ level: 'warn', title: 'No connection', detail: 'Post shows what is on this phone and sends what waits as soon as it is back.' });
  if (state.waiting && !late) out.push({ level: 'warn', title: `${state.waiting} thing${state.waiting > 1 ? 's' : ''} waiting to go to Outlook` });
  if (state.online && !state.sync.running && state.sync.at && i.now - state.sync.at > 15 * MINUTE) out.push({ level: 'warn', title: `Mail was last read ${ago(state.sync.at, i.now)}`, detail: 'Post reads it again whenever it is open, and every minute.' });
  if (i.device.room && i.device.room.quota > 0 && i.device.room.usage / i.device.room.quota > 0.9) out.push({ level: 'warn', title: 'The phone is almost out of room for Post', detail: `${mb(i.device.room.usage)} of ${mb(i.device.room.quota)} used.` });
  const recent = i.problems.filter((p) => i.now - p.at < 10 * MINUTE);
  if (recent.length) out.push({ level: 'warn', title: `${recent.reduce((n, p) => n + p.count, 0)} problem${recent.reduce((n, p) => n + p.count, 0) > 1 ? 's' : ''} written down in the last 10 minutes`, detail: 'They are listed below.' });
  return out.length ? out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1)) : [{ level: 'ok', title: 'Everything looks fine' }];
}

const clock = (t: number) => new Date(t).toISOString().slice(11, 19);

/** The facts as plain text to paste into a message. Safe to share: see the note at the top of this file. */
export function healthReport(i: HealthInput): string {
  const { state } = i;
  const waitingOut = state.outbox.length;
  const lines = [
    'Post problem report',
    `Time: ${new Date(i.now).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `Version: ${i.build}`,
    `Opened as: ${i.device.standalone ? 'Home Screen app' : 'browser tab'}`,
    `Device: ${i.device.userAgent}`,
    ...(i.device.language ? [`Language: ${i.device.language}`] : []),
    `Connection: ${state.online ? 'online' : 'offline'}`,
    `Mailboxes: ${state.accounts.length}${state.accounts.length ? ` (${state.accounts.map((a) => (a.needsSignIn ? 'needs sign-in' : 'signed in')).join(', ')})` : ''}`,
    `Last read of mail: ${ago(state.sync.at, i.now)}${state.sync.running ? ' (running now)' : ''}${state.sync.error ? `; error: ${state.sync.error}` : ''}`,
    `Waiting to go to Outlook: ${state.waiting}`,
    `Messages waiting to be sent: ${waitingOut}${waitingOut ? ` (longest overdue ${overdue(state.outbox, i.now)} min)` : ''}`,
    `Storage: ${i.storage.kind === 'device' ? 'saved on this phone' : 'NOT saved (memory only)'}${i.storage.reopened ? `; connection reopened ${i.storage.reopened}x` : ''}${i.storage.lastError ? `; last error: ${i.storage.lastError}` : ''}`,
    ...(i.device.room ? [`Room: ${mb(i.device.room.usage)} of ${mb(i.device.room.quota)}${i.device.room.persisted === undefined ? '' : i.device.room.persisted ? '; kept' : '; may be cleared by the phone'}`] : []),
    `Alerts: ${state.alertsOn ? 'on' : 'off'}`,
    `Left the inbox list or changed tab (last ${(state.left ?? []).length}): ${leftCounts(state.left ?? [])}`,
    `Needs a look: ${findings(i).filter((f) => f.level !== 'ok').map((f) => f.title).join('; ') || 'nothing'}`,
    '',
    `Written down (${i.problems.length}, oldest first):`,
    ...(i.problems.length ? i.problems.map((p) => `  ${clock(p.at)} ${p.kind}${p.count > 1 ? ` x${p.count}` : ''}: ${p.text}`) : ['  nothing']),
  ];
  return lines.join('\n');
}
