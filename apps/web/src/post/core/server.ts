// The phone's side of the conversation with your own alert server (the Supabase function). Four jobs: trade the sign-in code for an
// account, hand out short-lived tokens for Graph, store alert settings, and clear the icon number.

export interface ServerConfig { url: string; key: string }
export type Fetcher = typeof fetch;

export class ServerError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = 'ServerError'; this.status = status; }
}

export interface AccountStatus { id?: string; email: string; label: string; mode: 'people' | 'all' | 'vips' | 'off'; quiet: { days: number[]; from: string; to: string } | null; vips: string[]; subscription_expires_at: string | null; last_alert_at: string | null }

export function createServer(cfg: ServerConfig, f: Fetcher = (...a) => fetch(...a)) {
  async function call<T = any>(body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await f(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-alerts-key': cfg.key }, body: JSON.stringify(body) });
    } catch {
      throw new ServerError(0, 'Cannot reach your alert server. Check the connection.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = res.status === 401 ? 'The alerts key was not accepted.' : res.status === 503 ? 'The alert server is not set up yet (missing secrets).' : String((json as { error?: string }).error ?? `Error ${res.status}`);
      throw new ServerError(res.status, msg);
    }
    return json as T;
  }
  return {
    call,
    vapid: () => call<{ publicKey: string }>({ op: 'vapid' }),
    connect: (p: { code: string; verifier: string; redirectUri: string; label?: string }) => call<{ id: string; email: string; expires: string }>({ op: 'connect', ...p }),
    token: (email: string) => call<{ accessToken: string; expiresIn: number; email: string }>({ op: 'token', email }),
    status: () => call<{ devices: number; accounts: AccountStatus[] }>({ op: 'status' }),
    update: (email: string, patch: { label?: string; mode?: string; vips?: string[]; quiet?: unknown; tz?: string }) => call<{ ok: true }>({ op: 'update', email, ...patch }),
    unregister: (email: string) => call<{ removed: boolean }>({ op: 'unregister', email }),
    seen: (endpoint: string) => call<{ ok: boolean }>({ op: 'seen', endpoint }),
    pair: (p: { endpoint: string; p256dh: string; auth: string; lang: string }) => call<{ ok: true }>({ op: 'pair', ...p }),
    test: () => call<{ sent: number }>({ op: 'test' }),
  };
}
export type Server = ReturnType<typeof createServer>;

/** Hands out access tokens per account: reused until two minutes before they expire, one request at a time, never logged. */
export function createTokens(server: Pick<Server, 'token'>, now: () => number = () => Date.now()) {
  const cache = new Map<string, { token: string; until: number }>();
  const inflight = new Map<string, Promise<string>>();
  return {
    source(email: string) {
      return async (fresh = false): Promise<string> => {
        const hit = cache.get(email);
        if (!fresh && hit && hit.until > now()) return hit.token;
        const running = inflight.get(email);
        if (running) return running;
        const p = server.token(email).then((t) => {
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
