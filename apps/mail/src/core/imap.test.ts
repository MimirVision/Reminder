import test from 'node:test';
import assert from 'node:assert/strict';
import { ImapClient, ImapError, quote } from './imap.ts';
import { nodeConnector, startFakeImap, type FakeOptions } from './testkit.ts';

async function withServer<T>(opts: FakeOptions, fn: (port: number) => Promise<T>): Promise<T> {
  const s = await startFakeImap(opts);
  try {
    return await fn(s.port);
  } finally {
    await s.close();
  }
}
const connect = (port: number, timeoutMs = 2000) => ImapClient.connect(nodeConnector, { host: '127.0.0.1', port, tls: false, timeoutMs });

test('login, list folders, select and read decoded headers', async () => {
  await withServer({}, async (port) => {
    const c = await connect(port);
    await c.capability();
    assert.ok(c.caps.includes('IMAP4REV1'));
    await c.login('andreas@example.com', 'secret');

    const boxes = await c.list();
    assert.deepEqual(boxes.map((b) => [b.name, b.specialUse]), [['INBOX', 'inbox'], ['Sendt', 'sent'], ['Søppelkasse', 'trash']]);
    assert.equal(boxes[2].path, 'S&APg-ppelkasse');

    const sel = await c.select('INBOX');
    assert.deepEqual(sel, { exists: 2, uidValidity: 3857529045, uidNext: 103 });

    const rows = await c.fetchHeaders('1:*');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].uid, 101);
    assert.deepEqual(rows[0].flags, ['\\Seen']);
    assert.equal(rows[1].headers['list-unsubscribe'], '<https://example.no/u/1>');

    const byUid = await c.fetchHeaders('102', true);
    assert.equal(byUid.length, 1);
    assert.equal(byUid[0].seq, 2);
    await c.logout();
    assert.equal(c.isOpen, false);
  });
});

test('replies delivered one byte at a time still parse (slow, split mobile connections)', async () => {
  await withServer({ chunk: 1 }, async (port) => {
    const c = await connect(port);
    await c.login('andreas@example.com', 'secret');
    await c.select('INBOX');
    const rows = await c.fetchHeaders('1:2');
    assert.equal(rows.length, 2);
    assert.match(rows[0].headers.from, /ola@example\.no/);
    c.close();
  });
});

test('wrong password becomes an auth error carrying the server code', async () => {
  await withServer({}, async (port) => {
    const c = await connect(port);
    await assert.rejects(c.login('andreas@example.com', 'nope'), (e: unknown) => e instanceof ImapError && e.code === 'auth' && e.serverCode === 'AUTHENTICATIONFAILED');
    // The connection is still usable after a failed login, so the app can offer a retry without reconnecting.
    assert.equal(c.isOpen, true);
    c.close();
  });
});

test('a command that never gets an answer times out, and the dead connection rejects later commands', async () => {
  await withServer({ hangOn: 'SELECT' }, async (port) => {
    const c = await connect(port, 300);
    await c.login('andreas@example.com', 'secret');
    await assert.rejects(c.select('INBOX'), (e: unknown) => e instanceof ImapError && e.code === 'timeout');
    assert.equal(c.isOpen, false);
    await assert.rejects(c.list(), (e: unknown) => e instanceof ImapError);
  });
});

test('the server hanging up mid-command is a clean error, not a hang', async () => {
  await withServer({ dropOn: 'LIST' }, async (port) => {
    const c = await connect(port);
    await c.login('andreas@example.com', 'secret');
    await assert.rejects(c.list(), (e: unknown) => e instanceof ImapError && (e.code === 'closed' || e.code === 'network'));
  });
});

test('a BYE greeting and an unreachable port fail fast with readable errors', async () => {
  await withServer({ greeting: '* BYE Too many connections\r\n' }, async (port) => {
    await assert.rejects(connect(port), (e: unknown) => e instanceof ImapError && /Too many/.test(e.message));
  });
  await assert.rejects(connect(1), (e: unknown) => e instanceof ImapError && e.code === 'network');
});

test('commands issued at the same time run one after another and each gets its own answer', async () => {
  await withServer({ chunk: 7 }, async (port) => {
    const c = await connect(port);
    await c.login('andreas@example.com', 'secret');
    const [list, sel, cap] = await Promise.all([c.list(), c.select('INBOX'), c.capability()]);
    assert.equal(list.length, 3);
    assert.equal(sel.exists, 2);
    assert.ok(cap.length > 0);
    c.close();
  });
});

test('quote escapes, and refuses text that could inject extra commands', () => {
  assert.equal(quote('a"b\\c'), '"a\\"b\\\\c"');
  assert.throws(() => quote('x\r\nA2 DELETE INBOX'), ImapError);
  assert.throws(() => quote('pässword'), ImapError);
});

test('fetchHeaders refuses a malformed range', async () => {
  await withServer({}, async (port) => {
    const c = await connect(port);
    await c.login('andreas@example.com', 'secret');
    await assert.rejects(c.fetchHeaders('1:2 (BODY[])'), ImapError);
    c.close();
  });
});

test('Sign in with Google (XOAUTH2): a good token logs in, a bad one is refused without hanging', async () => {
  await withServer({ token: 'ya29.abc' }, async (port) => {
    const ok = await connect(port);
    await ok.authXoauth2('andreas@example.com', 'ya29.abc');
    assert.equal((await ok.select('INBOX')).exists, 2);
    ok.close();

    const bad = await connect(port);
    await assert.rejects(bad.authXoauth2('andreas@example.com', 'expired'), (e: unknown) => e instanceof ImapError && e.code === 'auth');
    assert.equal(bad.isOpen, true);
    bad.close();
  });
});
