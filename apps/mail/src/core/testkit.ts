// Test-only helpers: a Node socket connector and a small scripted IMAP server. Never imported by the app.
import net from 'node:net';
import type { ConnectOptions, MailSocket, SocketConnector } from './socket.ts';

export const nodeConnector: SocketConnector = (opts: ConnectOptions) =>
  new Promise<MailSocket>((resolve, reject) => {
    const s = net.connect(opts.port, opts.host);
    let onData: (c: Uint8Array) => void = () => {};
    let onClose: (e?: Error) => void = () => {};
    let lastError: Error | undefined;
    s.on('data', (d) => onData(new Uint8Array(d)));
    s.on('error', (e) => {
      lastError = e;
      reject(e);
    });
    s.on('close', () => onClose(lastError));
    s.once('connect', () =>
      resolve({
        write: (d) => void s.write(typeof d === 'string' ? d : Buffer.from(d)),
        onData: (cb) => (onData = cb),
        onClose: (cb) => (onClose = cb),
        startTls: () => Promise.reject(new Error('not in tests')),
        close: () => void s.destroy(),
      }),
    );
  });

export interface FakeMessage {
  uid: number;
  flags: string[];
  date: string;
  headers: string;
}

export interface FakeOptions {
  user?: string;
  pass?: string;
  messages?: FakeMessage[];
  greeting?: string;
  token?: string; // accepted XOAUTH2 access token
  loginNo?: string; // full text after "NO", to simulate provider-specific failures
  hangOn?: string; // command name to never answer
  dropOn?: string; // command name that makes the server hang up
  chunk?: number; // write replies in pieces of this many bytes
  chunkDelayMs?: number; // pause between pieces (a slow connection)
}

export const SAMPLE: FakeMessage[] = [
  {
    uid: 101,
    flags: ['\\Seen'],
    date: '03-Oct-2026 09:15:00 +0200',
    headers:
      'From: "Hansen, Ola" <ola@example.no>\r\nTo: andreas@example.com\r\nSubject: =?UTF-8?Q?M=C3=B8te_torsdag?=\r\n =?UTF-8?Q?_kl._10=3F?=\r\nDate: Sat, 3 Oct 2026 09:15:00 +0200\r\nMessage-ID: <a1@example.no>\r\n\r\n',
  },
  {
    uid: 102,
    flags: [],
    date: '05-Oct-2026 08:42:00 +0200',
    headers:
      'From: =?UTF-8?B?TWFqYSBCZXJn?= <maja@example.no>\r\nSubject: Re: Hytta i påska\r\nDate: Mon, 5 Oct 2026 08:42:00 +0200\r\nList-Unsubscribe: <https://example.no/u/1>\r\n\r\n',
  },
];

export async function startFakeImap(opts: FakeOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const user = opts.user ?? 'andreas@example.com';
  const pass = opts.pass ?? 'secret';
  const messages = opts.messages ?? SAMPLE;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    const send = async (text: string | Buffer) => {
      const buf = typeof text === 'string' ? Buffer.from(text, 'latin1') : text;
      if (!opts.chunk) {
        sock.write(buf);
        return;
      }
      for (let i = 0; i < buf.length; i += opts.chunk) {
        sock.write(buf.subarray(i, i + opts.chunk));
        await new Promise((r) => (opts.chunkDelayMs ? setTimeout(r, opts.chunkDelayMs) : setImmediate(r)));
      }
    };
    void send(opts.greeting ?? '* OK [CAPABILITY IMAP4rev1] Fake IMAP ready\r\n');

    let acc = '';
    sock.on('data', (d) => {
      acc += d.toString('latin1');
      let i: number;
      while ((i = acc.indexOf('\r\n')) >= 0) {
        const line = acc.slice(0, i);
        acc = acc.slice(i + 2);
        void handle(line);
      }
    });

    let pendingAuthTag = '';
    async function handle(line: string) {
      if (pendingAuthTag && line === '') {
        await send(`${pendingAuthTag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
        pendingAuthTag = '';
        return;
      }
      const sp = line.split(' ');
      const tag = sp[0];
      const upper = sp[1]?.toUpperCase();
      const isUid = upper === 'UID';
      const cmd = isUid ? sp[2]?.toUpperCase() : upper;
      if (opts.hangOn && cmd === opts.hangOn) return;
      if (opts.dropOn && cmd === opts.dropOn) return void sock.destroy();
      switch (cmd) {
        case 'CAPABILITY':
          await send(`* CAPABILITY IMAP4rev1 UIDPLUS IDLE\r\n${tag} OK Capability completed\r\n`);
          break;
        case 'LOGIN': {
          const q = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
          if (q[0] === user && q[1] === pass) await send(`${tag} OK [CAPABILITY IMAP4rev1] Logged in\r\n`);
          else await send(`${tag} NO ${opts.loginNo ?? '[AUTHENTICATIONFAILED] Invalid credentials (Failure)'}\r\n`);
          break;
        }
        case 'AUTHENTICATE': {
          const b64 = sp[3] ?? '';
          const decoded = Buffer.from(b64, 'base64').toString('utf8');
          const okToken = opts.token ?? 'good-token';
          if (decoded === `user=${user}\x01auth=Bearer ${okToken}\x01\x01`) await send(`${tag} OK [CAPABILITY IMAP4rev1] Authenticated\r\n`);
          else {
            // Real servers send a base64 JSON error and wait for an empty line before the final NO.
            await send(`+ ${Buffer.from('{"status":"401"}').toString('base64')}\r\n`);
            pendingAuthTag = tag;
          }
          break;
        }
        case 'LIST':
          await send(
            '* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sendt"\r\n* LIST (\\HasNoChildren \\Trash) "/" "S&APg-ppelkasse"\r\n' +
              `${tag} OK List completed\r\n`,
          );
          break;
        case 'SELECT':
          await send(
            `* ${messages.length} EXISTS\r\n* OK [UIDVALIDITY 3857529045] UIDs valid\r\n* OK [UIDNEXT ${(messages.at(-1)?.uid ?? 0) + 1}] Predicted next UID\r\n${tag} OK [READ-WRITE] Select completed\r\n`,
          );
          break;
        case 'FETCH': {
          const set = sp[isUid ? 3 : 2];
          const [a, b] = set.split(':');
          const lo = Number(a);
          const hi = b === undefined ? lo : b === '*' ? Infinity : Number(b);
          let out = '';
          messages.forEach((m, idx) => {
            const key = isUid ? m.uid : idx + 1;
            if (key < lo || key > hi) return;
            const body = Buffer.from(m.headers, 'utf8');
            out += `* ${idx + 1} FETCH (UID ${m.uid} FLAGS (${m.flags.join(' ')}) INTERNALDATE "${m.date}" RFC822.SIZE ${body.length + 900} BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)] {${body.length}}\r\n`;
            out += body.toString('latin1') + ')\r\n';
          });
          await send(Buffer.from(out + `${tag} OK Fetch completed\r\n`, 'latin1'));
          break;
        }
        case 'LOGOUT':
          await send(`* BYE Logging out\r\n${tag} OK Logout completed\r\n`);
          sock.end();
          break;
        default:
          await send(`${tag} BAD Unknown command\r\n`);
      }
    }
  });

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.close(() => res());
      }),
  };
}
