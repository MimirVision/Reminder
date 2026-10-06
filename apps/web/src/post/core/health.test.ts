import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, findings, healthReport, type HealthInput } from './health.ts';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const base = (over: Partial<HealthInput['state']> = {}, more: Partial<HealthInput> = {}): HealthInput => ({
  build: 'abc123', now: NOW,
  state: { online: true, accounts: [{ id: '1', email: 'anna@firma.no', label: 'Work', mode: 'people', quiet: null, vips: [], subscription_expires_at: null, last_alert_at: null, needsSignIn: false }], sync: { running: false, at: NOW - 30_000, error: null }, waiting: 0, outbox: [], alertsOn: true, ready: true, ...over },
  storage: { kind: 'device', reopened: 0, lastError: null }, problems: [],
  device: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', standalone: true, language: 'nb-NO', room: { usage: 12 * 1024 * 1024, quota: 900 * 1024 * 1024, persisted: true } },
  ...more,
});
const item = (sendAt: number) => ({ id: 'o1', account: 'anna@firma.no', sendAt, kind: 'new' as const, to: ['bob@x.no'], cc: [], subject: 'Hemmelig tittel', body: 'Hemmelig tekst' });

test('time is told the way a person says it', () => {
  assert.equal(ago(null, NOW), 'never');
  assert.equal(ago(NOW - 5_000, NOW), 'just now');
  assert.equal(ago(NOW - 3 * 60_000, NOW), '3 min ago');
  assert.equal(ago(NOW - 2 * 3_600_000, NOW), '2 h ago');
  assert.equal(ago(NOW - 4 * 86_400_000, NOW), '4 days ago');
  assert.equal(ago(NOW + 5000, NOW), 'just now');
});

test('when nothing is wrong it says so in one line', () => {
  assert.deepEqual(findings(base()), [{ level: 'ok', title: 'Everything looks fine' }]);
});

test('what needs a look is named plainly, the worst first', () => {
  const f = findings(base({
    online: true, waiting: 2, sync: { running: false, at: NOW - 40 * 60_000, error: 'Work: Error 500' },
    accounts: [{ id: '1', email: 'anna@firma.no', label: 'Work', mode: 'people', quiet: null, vips: [], subscription_expires_at: null, last_alert_at: null, needsSignIn: true }],
    outbox: [item(NOW - 5 * 60_000)],
  }, { storage: { kind: 'memory', reopened: 1, lastError: 'cannot open' } }));
  assert.deepEqual(f.map((x) => x.level), ['bad', 'bad', 'bad', 'bad', 'warn']);
  assert.deepEqual(f.slice(0, 4).map((x) => x.title), ['Work needs you to sign in again', 'Post cannot save on this phone right now', 'A message has been waiting to be sent for 5 min', 'The last read of your mail failed']);
  assert.match(f[4].title, /Mail was last read 40 min ago/);
  // what waits is not counted twice: a message that is overdue already says it
  assert.equal(f.some((x) => /waiting to go to Outlook/.test(x.title)), false);
  assert.match(findings(base({ waiting: 2 }))[0].title, /^2 things waiting to go to Outlook$/);
});

test('being offline is a notice, not an alarm, and a message that is not yet due is not "waiting"', () => {
  const f = findings(base({ online: false, outbox: [item(NOW + 8000)] }));
  assert.deepEqual(f.map((x) => [x.level, x.title]), [['warn', 'No connection']]);
});

test('a phone that is nearly out of room, and problems written down lately, are noticed', () => {
  const f = findings(base({}, { device: { userAgent: 'x', standalone: false, room: { usage: 95, quota: 100 } }, problems: [{ at: NOW - 60_000, kind: 'send', text: 'boom', count: 3 }, { at: NOW - 3_600_000, kind: 'old', text: 'old', count: 1 }] }));
  assert.deepEqual(f.map((x) => x.title), ['The phone is almost out of room for Post', '3 problems written down in the last 10 minutes']);
});

test('the report says what is going on, and carries nothing from inside a message or any address', () => {
  const text = healthReport(base({ waiting: 1, outbox: [item(NOW - 3 * 60_000)], sync: { running: false, at: NOW - 120_000, error: 'No connection. Showing what is on this phone.' } }, { problems: [{ at: NOW - 100_000, kind: 'send', text: 'GraphError: The recipient [address] is invalid', count: 2 }] }));
  assert.match(text, /^Post problem report\nTime: 2026-10-06 12:00:00 UTC\nVersion: abc123\nOpened as: Home Screen app/);
  assert.match(text, /Connection: online/);
  assert.match(text, /Mailboxes: 1 \(signed in\)/);
  assert.match(text, /Last read of mail: 2 min ago; error: No connection/);
  assert.match(text, /Messages waiting to be sent: 1 \(longest overdue 3 min\)/);
  assert.match(text, /Storage: saved on this phone/);
  assert.match(text, /Room: 12 MB of 900 MB; kept/);
  assert.match(text, /Needs a look: A message has been waiting to be sent for 3 min/);
  assert.match(text, / send x2: GraphError: The recipient \[address\] is invalid/);
  for (const secret of ['Hemmelig', 'bob@x.no', 'anna@firma.no']) assert.equal(text.includes(secret), false, secret);
});

test('an empty report is still a report', () => {
  const text = healthReport(base({ accounts: [], sync: { running: false, at: null, error: null } }, { storage: { kind: 'memory', reopened: 2, lastError: 'blocked' }, device: { userAgent: 'x', standalone: false } }));
  assert.match(text, /Mailboxes: 0\n/);
  assert.match(text, /Last read of mail: never/);
  assert.match(text, /Storage: NOT saved \(memory only\); connection reopened 2x; last error: blocked/);
  assert.match(text, /Written down \(0, oldest first\):\n  nothing$/);
});
