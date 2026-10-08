// Small display helpers: dates, names, initials. Deterministic given `now`, so they are testable.

const DAY = 86_400_000;

export function dayStart(d: Date): number { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

/** "08:42" today, "Sun" within the last week, "28 Sep" before that, "28 Sep 2025" in other years. */
export function shortTime(iso: string, now: Date = new Date(), locale = 'en-GB'): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / DAY);
  if (days <= 0) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (days < 7) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The section a message sits under in the list: Today, Yesterday, This week, or the month. */
export function dayGroup(iso: string, now: Date = new Date(), locale = 'en-GB'): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(locale, { weekday: 'long' });
  return d.toLocaleDateString(locale, d.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

export function initials(name: string, address = ''): string {
  const base = name.trim() || address.split('@')[0];
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The hues an avatar can have: ten, spread round the colour wheel so the people who write to you are easy to tell apart at a glance. */
export const AVATAR_HUES = [4, 30, 46, 96, 150, 176, 204, 226, 266, 318] as const;

/** Which hue a sender gets. It comes from the address (a display name changes, an address does not), so one sender is always the same colour. */
export function senderHue(address: string, name = ''): number {
  const key = (address.trim() || name.trim()).toLowerCase();
  let h = 0x811c9dc5; // FNV-1a: small, and the same everywhere
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return AVATAR_HUES[(h >>> 0) % AVATAR_HUES.length];
}

export function displayName(name: string, address: string): string {
  return name.trim() || address;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
