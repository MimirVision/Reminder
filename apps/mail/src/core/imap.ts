import { base64Encode, utf8Encode } from './bytes.ts';
import { decodeMutf7, fetchItems, ResponseReader, tokenText, type Response, type Status, type Token } from './imapParser.ts';
import { parseHeaders } from './mime.ts';
import type { ConnectOptions, MailSocket, SocketConnector } from './socket.ts';

export type ImapErrorCode = 'network' | 'timeout' | 'closed' | 'auth' | 'no' | 'protocol';

export class ImapError extends Error {
  code: ImapErrorCode;
  serverCode?: string;
  constructor(code: ImapErrorCode, message: string, serverCode?: string) {
    super(message);
    this.name = 'ImapError';
    this.code = code;
    this.serverCode = serverCode;
  }
}

type Untagged = Extract<Response, { kind: 'untagged' }>;
type Tagged = Extract<Response, { kind: 'tagged' }>;

export interface CommandResult {
  status: Status;
  code?: string;
  text: string;
  untagged: Untagged[];
}

export interface Mailbox {
  path: string; // exactly as the server wants it back in commands
  name: string; // decoded for display
  delimiter: string | null;
  flags: string[];
  specialUse?: 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | 'inbox';
}

export interface Selected {
  exists: number;
  uidValidity: number;
  uidNext: number;
  highestModSeq?: number;
}

export interface HeaderRow {
  seq: number;
  uid: number;
  flags: string[];
  internalDate: string;
  size: number;
  headers: Record<string, string>;
}

const SPECIAL: Record<string, Mailbox['specialUse']> = {
  '\\sent': 'sent',
  '\\drafts': 'drafts',
  '\\trash': 'trash',
  '\\junk': 'junk',
  '\\archive': 'archive',
  '\\all': 'all',
  '\\flagged': 'flagged',
};

export function quote(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new ImapError('protocol', 'That text has a character mail servers do not accept.');
  if (/[^\x20-\x7e]/.test(s)) throw new ImapError('protocol', 'Non-English letters in a password or mailbox name are not supported yet.');
  return '"' + s.replace(/[\\"]/g, '\\$&') + '"';
}

const HEADER_FIELDS = 'FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST';

export class ImapClient {
  caps: string[] = [];
  private socket: MailSocket;
  private reader = new ResponseReader();
  private timeoutMs: number;
  private closed = false;
  private closeError?: ImapError;
  private tagN = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private cur?: { tag: string; resolve: (r: CommandResult) => void; reject: (e: Error) => void; untagged: Untagged[]; timer: ReturnType<typeof setTimeout>; onContinue?: () => void };
  private greetingDone = false;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;
  private greetingTimer?: ReturnType<typeof setTimeout>;
  readonly ready: Promise<void>;

  private constructor(socket: MailSocket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.ready = new Promise<void>((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });
    this.ready.catch(() => {});
    this.greetingTimer = setTimeout(() => this.fail(new ImapError('timeout', 'The mail server did not answer.')), timeoutMs);
    socket.onData((chunk) => this.onData(chunk));
    socket.onClose((err) => {
      if (this.closed) return;
      this.fail(new ImapError(err ? 'network' : 'closed', err ? err.message : 'The mail server closed the connection.'), false);
    });
  }

  static async connect(connector: SocketConnector, opts: ConnectOptions): Promise<ImapClient> {
    let socket: MailSocket;
    try {
      socket = await connector(opts);
    } catch (e) {
      throw new ImapError('network', e instanceof Error ? e.message : String(e));
    }
    const client = new ImapClient(socket, opts.timeoutMs ?? 20000);
    await client.ready;
    return client;
  }

  private onData(chunk: Uint8Array) {
    let responses: Response[];
    try {
      responses = this.reader.push(chunk);
    } catch (e) {
      this.fail(new ImapError('protocol', e instanceof Error ? e.message : 'Unreadable reply from the mail server.'));
      return;
    }
    for (const r of responses) this.handle(r);
  }

  private handle(r: Response) {
    if (!this.greetingDone) {
      if (r.kind === 'untagged' && (r.status === 'OK' || r.status === 'PREAUTH')) {
        this.greetingDone = true;
        clearTimeout(this.greetingTimer);
        this.noteCode(r);
        this.resolveReady();
      } else if (r.kind === 'untagged' && r.status === 'BYE') {
        this.fail(new ImapError('closed', r.text || 'The mail server refused the connection.'));
      }
      return;
    }
    if (r.kind === 'untagged') {
      if (this.cur) this.cur.untagged.push(r);
      this.noteCode(r);
      return;
    }
    if (r.kind === 'continue') {
      this.cur?.onContinue?.();
      return;
    }
    if (r.kind === 'tagged' && this.cur && r.tag === this.cur.tag) {
      const c = this.cur;
      this.cur = undefined;
      clearTimeout(c.timer);
      this.noteCode(r);
      c.resolve({ status: r.status, code: r.code, text: r.text, untagged: c.untagged });
    }
  }

  private noteCode(r: Untagged | Tagged) {
    const m = r.code && /^CAPABILITY (.*)$/i.exec(r.code);
    if (m) this.caps = m[1].toUpperCase().split(' ');
  }

  private fail(err: ImapError, closeSocket = true) {
    if (this.closed) return;
    this.closed = true;
    this.closeError = err;
    clearTimeout(this.greetingTimer);
    if (this.cur) {
      clearTimeout(this.cur.timer);
      this.cur.reject(err);
      this.cur = undefined;
    }
    this.rejectReady(err);
    if (closeSocket) this.socket.close();
  }

  // Runs one command and waits for its tagged reply. Commands are queued one at a time.
  // A timeout drops the whole connection: after one we no longer know what state the server is in.
  run(command: string, timeoutMs = this.timeoutMs): Promise<CommandResult> {
    const p = this.chain.then(() => this.exec(command, timeoutMs));
    this.chain = p.catch(() => undefined);
    return p;
  }

  private exec(command: string, timeoutMs: number, onContinue?: () => void): Promise<CommandResult> {
    if (this.closed) return Promise.reject(this.closeError ?? new ImapError('closed', 'The connection is closed.'));
    const tag = 'A' + String(++this.tagN).padStart(4, '0');
    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new ImapError('timeout', 'The mail server took too long to answer.')), timeoutMs);
      this.cur = { tag, resolve, reject, untagged: [], timer, onContinue };
      this.socket.write(utf8Encode(`${tag} ${command}\r\n`));
    });
  }

  // Like run(), but a NO or BAD reply becomes an error.
  async command(command: string, timeoutMs?: number): Promise<CommandResult> {
    const r = await this.run(command, timeoutMs);
    if (r.status === 'NO') throw new ImapError('no', r.text, r.code);
    if (r.status === 'BAD') throw new ImapError('protocol', r.text, r.code);
    return r;
  }

  async capability(): Promise<string[]> {
    const r = await this.command('CAPABILITY');
    const line = r.untagged.find((u) => u.name === 'CAPABILITY');
    if (line) this.caps = line.tokens.filter((t): t is string => typeof t === 'string').map((t) => t.toUpperCase());
    return this.caps;
  }

  async login(user: string, password: string): Promise<void> {
    const r = await this.run(`LOGIN ${quote(user)} ${quote(password)}`);
    if (r.status !== 'OK') throw new ImapError('auth', r.text, r.code);
  }

  // "Sign in with Google / Microsoft": the access token replaces the password. On a refusal the server sends a
  // continuation with a JSON error; answering with an empty line makes it send the final NO.
  async authXoauth2(user: string, accessToken: string): Promise<void> {
    if (/[\r\n\x01]/.test(user + accessToken)) throw new ImapError('protocol', 'Bad sign-in token.');
    const sasl = base64Encode(utf8Encode(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`));
    const p = this.chain.then(() => this.exec(`AUTHENTICATE XOAUTH2 ${sasl}`, this.timeoutMs, () => this.socket.write('\r\n')));
    this.chain = p.catch(() => undefined);
    const r = await p;
    if (r.status !== 'OK') throw new ImapError('auth', r.text || 'The sign-in was refused.', r.code);
  }

  async list(): Promise<Mailbox[]> {
    const r = await this.command('LIST "" "*"');
    const out: Mailbox[] = [];
    for (const u of r.untagged) {
      if (u.name !== 'LIST' && u.name !== 'LSUB') continue;
      const [flagsTok, delim, nameTok] = u.tokens;
      const path = tokenText(nameTok);
      if (path === null) continue;
      const flags = (Array.isArray(flagsTok) ? flagsTok : []).filter((t): t is string => typeof t === 'string');
      const lower = flags.map((f) => f.toLowerCase());
      let specialUse: Mailbox['specialUse'];
      for (const f of lower) if (SPECIAL[f]) specialUse = SPECIAL[f];
      if (path.toUpperCase() === 'INBOX') specialUse = 'inbox';
      out.push({ path, name: decodeMutf7(path), delimiter: typeof delim === 'string' ? delim : null, flags, specialUse });
    }
    return out;
  }

  async select(path: string): Promise<Selected> {
    const r = await this.command(`SELECT ${quote(path)}`);
    const sel: Selected = { exists: 0, uidValidity: 0, uidNext: 0 };
    for (const u of r.untagged) {
      if (u.name === 'EXISTS' && u.seq !== undefined) sel.exists = u.seq;
      const m = u.code && /^(UIDVALIDITY|UIDNEXT|HIGHESTMODSEQ) (\d+)$/i.exec(u.code);
      if (m) {
        const n = Number(m[2]);
        const k = m[1].toUpperCase();
        if (k === 'UIDVALIDITY') sel.uidValidity = n;
        else if (k === 'UIDNEXT') sel.uidNext = n;
        else sel.highestModSeq = n;
      }
    }
    return sel;
  }

  // `set` is an IMAP sequence set such as "1:20" or "5,7,9:*". With byUid it is UIDs, otherwise message numbers.
  async fetchHeaders(set: string, byUid = false): Promise<HeaderRow[]> {
    if (!/^[0-9:,*]+$/.test(set)) throw new ImapError('protocol', 'Bad message range.');
    const r = await this.command(`${byUid ? 'UID ' : ''}FETCH ${set} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (${HEADER_FIELDS})])`);
    const rows: HeaderRow[] = [];
    for (const u of r.untagged) {
      if (u.name !== 'FETCH' || u.seq === undefined) continue;
      const items = fetchItems(u.tokens[0]);
      const key = [...items.keys()].find((k) => k.startsWith('BODY[HEADER'));
      const flags = items.get('FLAGS');
      rows.push({
        seq: u.seq,
        uid: Number(tokenText(items.get('UID')) ?? 0),
        flags: Array.isArray(flags) ? flags.filter((t): t is string => typeof t === 'string') : [],
        internalDate: tokenText(items.get('INTERNALDATE')) ?? '',
        size: Number(tokenText(items.get('RFC822.SIZE')) ?? 0),
        headers: parseHeaders(key ? (tokenText(items.get(key)) ?? '') : ''),
      });
    }
    return rows;
  }

  async logout(): Promise<void> {
    try {
      await this.run('LOGOUT', 5000);
    } catch {
      // closing anyway
    }
    this.close();
  }

  close() {
    if (this.closed) return;
    this.fail(new ImapError('closed', 'The connection was closed.'));
  }

  get isOpen() {
    return !this.closed;
  }
}

export type { Token };
