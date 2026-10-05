// Microsoft sign-in with PKCE, done in a normal browser tab (never inside the Home Screen app, where iOS cuts off the sign-in page).
// This file only builds the sign-in address and reads the answer. The code is traded for tokens on the alert server, which keeps the
// long-lived refresh token; the phone only ever holds short-lived access tokens.

export const AUTH_SCOPE = 'offline_access User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send';
const AUTHORIZE = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export interface SignIn { url: string; verifier: string; state: string }

export async function startSignIn(p: { clientId: string; redirectUri: string; loginHint?: string; label?: string }): Promise<SignIn> {
  const verifier = random(48);
  const state = random(16);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({
    client_id: p.clientId, response_type: 'code', redirect_uri: p.redirectUri, response_mode: 'query', scope: AUTH_SCOPE,
    code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account',
  });
  if (p.loginHint) q.set('login_hint', p.loginHint);
  return { url: `${AUTHORIZE}?${q.toString()}`, verifier, state };
}

export type Callback = { kind: 'none' } | { kind: 'code'; code: string } | { kind: 'error'; message: string };

/** Reads what Microsoft put in the address after sign-in. A wrong `state` is refused (someone else's sign-in link). */
export function parseCallback(search: string, expectedState: string | null): Callback {
  const q = new URLSearchParams(search);
  if (!q.has('code') && !q.has('error')) return { kind: 'none' };
  if (!expectedState || q.get('state') !== expectedState) return { kind: 'error', message: 'This sign-in did not start from this phone. Try again.' };
  if (q.has('error')) {
    const d = q.get('error_description') ?? q.get('error') ?? 'Sign-in failed';
    return { kind: 'error', message: friendlyAuthError(q.get('error') ?? '', d) };
  }
  return { kind: 'code', code: q.get('code') ?? '' };
}

export function friendlyAuthError(code: string, description: string): string {
  if (code === 'access_denied') return 'You cancelled the sign-in.';
  if (/AADSTS65001|consent/i.test(description)) return 'Your organisation needs to approve Post first. Ask your IT admin to allow it (or use a personal account).';
  if (/AADSTS50011|redirect/i.test(description)) return 'The redirect address is not set up in Azure yet. See docs/POST.md, step 1 (Microsoft registration).';
  if (/AADSTS700016|AADSTS700054|not found in the directory/i.test(description)) return 'The app id is wrong or the app is not set up for personal accounts in Azure.';
  return description.replace(/\s+/g, ' ').slice(0, 200);
}
