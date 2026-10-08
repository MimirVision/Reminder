// Reading what Microsoft put in the address after sign-in. The sign-in itself (PKCE, the address to send you to) is built by your own Post
// server, so it works the same in a browser tab, a computer, or a Home Screen app.

export type Callback = { kind: 'none' } | { kind: 'code'; code: string; state: string } | { kind: 'error'; message: string };

export function parseCallback(search: string): Callback {
  const q = new URLSearchParams(search);
  if (!q.has('code') && !q.has('error')) return { kind: 'none' };
  if (q.has('error')) {
    const d = q.get('error_description') ?? q.get('error') ?? 'Sign-in failed';
    return { kind: 'error', message: friendlyAuthError(q.get('error') ?? '', d) };
  }
  const state = q.get('state') ?? '';
  if (!state) return { kind: 'error', message: 'This sign-in did not start from Post. Try again.' };
  return { kind: 'code', code: q.get('code') ?? '', state };
}

export function friendlyAuthError(code: string, description: string): string {
  if (code === 'access_denied') return 'You cancelled the sign-in.';
  if (/AADSTS65001|consent/i.test(description)) return 'Your organisation needs to approve Post first. Ask your IT admin to allow it (or use a personal account).';
  if (/AADSTS50011|redirect/i.test(description)) return 'The redirect address is not set up in Azure yet. See docs/POST.md, step 1 (Microsoft registration).';
  if (/AADSTS700016|AADSTS700054|not found in the directory/i.test(description)) return 'The app id is wrong or the app is not set up for personal accounts in Azure.';
  return description.replace(/\s+/g, ' ').slice(0, 200);
}
