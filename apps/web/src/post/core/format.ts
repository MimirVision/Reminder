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

export function displayName(name: string, address: string): string {
  return name.trim() || address;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
