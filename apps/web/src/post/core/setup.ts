// The "setup code": the three values this phone needs (your alert server, its key, and the Azure app id) in one pasteable string.
// Safari and the Home Screen app keep separate storage on iOS, so the code is how the second one learns what the first one knows.

export interface Config { url: string; key: string; clientId: string }

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s: string) => decodeURIComponent(escape(atob(s)));

export function makeSetupCode(c: Config): string {
  return `post1.${b64(JSON.stringify([c.url, c.key, c.clientId]))}`;
}

export function validConfig(c: Partial<Config>): c is Config {
  return !!c.url && /^https:\/\/[^\s]+$/.test(c.url) && !!c.key && c.key.length >= 8 && !!c.clientId && /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(c.clientId.trim());
}

/** Accepts the bare code, a link that ends in #s=<code>, or text with the code somewhere in it. Returns null when it is not a code. */
export function parseSetupCode(text: string): Config | null {
  const m = /post1\.([A-Za-z0-9+/=_-]+)/.exec(text.trim());
  if (!m) return null;
  try {
    const [url, key, clientId] = JSON.parse(unb64(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    const c = { url: String(url).trim(), key: String(key).trim(), clientId: String(clientId).trim() };
    return validConfig(c) ? c : null;
  } catch {
    return null;
  }
}
