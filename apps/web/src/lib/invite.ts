// Invite links: https://your-site/?join=CODE opens sign-up with the partner's code already filled in.
const KEY = 'hm.joinCode';
const CODE = /^[0-9a-f]{8,32}$/;

/** The code in a query string like "?join=abc123...", or null when missing or not a plausible code. */
export function inviteFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get('join')?.trim().toLowerCase() ?? '';
  return CODE.test(v) ? v : null;
}

export const inviteLink = (origin: string, code: string) => `${new URL(origin).origin}/?join=${encodeURIComponent(code)}`;

/** Called once at startup: remembers a code from the address (it survives sign-up) and tidies the address bar. */
export function captureInviteFromUrl() {
  try {
    const code = inviteFromSearch(window.location.search);
    if (!code) return;
    localStorage.setItem(KEY, code);
    const url = new URL(window.location.href);
    url.searchParams.delete('join');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch { /* storage or history unavailable: the code can still be typed */ }
}

export function storedInvite(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function clearStoredInvite() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
