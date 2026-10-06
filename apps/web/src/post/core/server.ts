// The phone's (or computer's) side of the conversation with your own Post server (the Supabase function). It never holds a shared key:
// after Microsoft has confirmed who signed in, the server hands this device a session secret, and that is what proves which mailbox
// the device belongs to. Jobs: sign in, hand out short-lived Graph tokens, store alert settings, clear the icon number.

export type Fetcher = typeof fetch;

export class ServerError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = 'ServerError'; this.status = status; }
}

export interface AccountStatus { id?: string; email: string; label: string; mode: 'people' | 'all' | 'vips' | 'off'; quiet: { days: number[]; from: string; to: string } | null; vips: string[]; subscription_expires_at: string | null; last_alert_at: string | null;
  /** Why Microsoft would not start new-mail alerts for this mailbox (the mailbox itself works). */
  sub_error?: string | null }
export interface SignedIn { id: string; email: string; label: string; session: string; expires: string; alertsError?: string | null }
export type SigninPoll = { status: 'pending' } | ({ status: 'done' } & SignedIn);

export function createServer(url: string, f: Fetcher = (...a) => fetch(...a)) {
  async function call<T = any>(body: Record<string, unknown>, session?: string): Promise<T> {
    let res: Response;
    try {
      res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'x-post-session': session } : {}) }, body: JSON.stringify(body) });
    } catch {
      throw new ServerError(0, 'Cannot reach your Post server. Check the connection.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const said = json as { error?: string; message?: string };
      const msg = res.status === 401 ? 'Signed out. Sign in again.' : res.status === 503 ? (said.message ?? 'The Post server is not set up yet. See docs/POST.md.') : String(said.error ?? `Error ${res.status}`);
      throw new ServerError(res.status, msg);
    }
    return json as T;
  }
  return {
    call,
    vapid: () => call<{ publicKey: string }>({ op: 'vapid' }),
    /** The Microsoft sign-in address for this device, and a handle to collect the result if the sign-in finishes in another window. */
    signinStart: (redirectUri: string, hint?: string) => call<{ url: string; handle: string }>({ op: 'signin_start', redirectUri, ...(hint ? { hint } : {}) }),
    signinFinish: (p: { code: string; state: string; label?: string }) => call<{ status: 'done'; handle: string } & SignedIn>({ op: 'signin_finish', ...p }),
    signinPoll: (handle: string) => call<SigninPoll>({ op: 'signin_poll', handle }),
    signinForget: (handle: string) => call<{ ok: true }>({ op: 'signin_forget', handle }),
    token: (session: string) => call<{ accessToken: string; expiresIn: number; email: string }>({ op: 'token' }, session),
    status: (session: string) => call<{ devices: number; accounts: AccountStatus[] }>({ op: 'status' }, session),
    update: (session: string, patch: { label?: string; mode?: string; vips?: string[]; quiet?: unknown; tz?: string }) => call<{ ok: true }>({ op: 'update', ...patch }, session),
    unregister: (session: string) => call<{ removed: boolean }>({ op: 'unregister' }, session),
    seen: (session: string, endpoint: string) => call<{ ok: boolean }>({ op: 'seen', endpoint }, session),
    pair: (session: string, p: { endpoint: string; p256dh: string; auth: string; lang: string }) => call<{ ok: true }>({ op: 'pair', ...p }, session),
    test: (session: string) => call<{ sent: number }>({ op: 'test' }, session),
  };
}
export type Server = ReturnType<typeof createServer>;

/** The things a device needs for alerts, already tied to a signed-in session. */
export interface DeviceApi {
  vapid(): Promise<{ publicKey: string }>;
  pair(p: { endpoint: string; p256dh: string; auth: string; lang: string }): Promise<unknown>;
  seen(endpoint: string): Promise<unknown>;
  test(): Promise<{ sent: number }>;
  ping(): Promise<number>;
}

/** Hands out access tokens per account: reused until two minutes before they expire, one request at a time, never logged. */
export function createTokens(server: Pick<Server, 'token'>, sessionOf: (email: string) => string | undefined, now: () => number = () => Date.now()) {
  const cache = new Map<string, { token: string; until: number }>();
  const inflight = new Map<string, Promise<string>>();
  return {
    source(email: string) {
      return async (fresh = false): Promise<string> => {
        const hit = cache.get(email);
        if (!fresh && hit && hit.until > now()) return hit.token;
        const running = inflight.get(email);
        if (running) return running;
        const session = sessionOf(email);
        if (!session) throw new ServerError(401, 'Signed out. Sign in again.');
        const p = server.token(session).then((t) => {
          cache.set(email, { token: t.accessToken, until: now() + Math.max(60, t.expiresIn - 120) * 1000 });
          return t.accessToken;
        }).finally(() => inflight.delete(email));
        inflight.set(email, p);
        return p;
      };
    },
    forget(email: string) { cache.delete(email); },
  };
}
