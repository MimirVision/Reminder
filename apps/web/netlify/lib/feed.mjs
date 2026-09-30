// Pure helpers for the reminder links served by the Netlify function: the text shown in a Shortcuts notification
// (a place list, a weekly digest) and the Calendar (.ics) feed. Plain ES module, no dependencies, so it is tested
// with plain Node (feed.test.mjs).

export const DEFAULT_TZ = 'Europe/Oslo';

/** @typedef {{id:string,name:string,kind:string,category:string|null,radius_m:number}} Place */
/** @typedef {{id:string,body:string,place_id:string|null,created_at:string}} Todo */
/** @typedef {{id:string,title:string,notes:string|null,schedule:string,interval_months:number|null,window_start_month:number|null,window_end_month:number|null,next_due_at:string,due_until:string|null,last_done_at:string|null}} Task */
/** @typedef {{household:string,generated_at:string,places:Place[],todos:Todo[],tasks:Task[],facts:{title:string,value:string,surface_at:string[]}[]}} Feed */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's date (yyyy-mm-dd) in a time zone. */
export function todayIn(tz = DEFAULT_TZ, now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const utc = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
export const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86_400_000);
export function addDays(ymd, n) {
  return new Date(utc(ymd) + n * 86_400_000).toISOString().slice(0, 10);
}

const firstLine = (s) => String(s ?? '').split('\n')[0].trim() || '(photo)';

export function scheduleText(t) {
  if (t.schedule === 'seasonal' && t.window_start_month && t.window_end_month) {
    const a = MONTHS[t.window_start_month - 1];
    const b = MONTHS[t.window_end_month - 1];
    return `every year, ${a === b ? a : `${a}-${b}`}`;
  }
  const n = t.interval_months ?? 12;
  if (n % 12 === 0) return n === 12 ? 'every year' : `every ${n / 12} years`;
  return n === 1 ? 'every month' : `every ${n} months`;
}

function when(days) {
  if (days <= 0) return 'now';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}

const MAX_ITEMS = 8;

/**
 * The to-dos for a place, as notification text. Matches saved places by name (contains, any case) and/or by shop
 * category. Empty string when there is nothing there, so a Shortcut can skip the notification.
 * @param {Feed} feed
 * @param {{place?: string|null, category?: string|null}} q
 */
export function placeText(feed, { place, category }) {
  const q = (place ?? '').trim().toLowerCase();
  const c = (category ?? '').trim().toLowerCase();
  if (!q && !c) return '';
  const matched = feed.places.filter((p) => (q && p.name.toLowerCase().includes(q)) || (c && (p.category ?? '').toLowerCase() === c));
  if (matched.length === 0) return '';
  const ids = new Set(matched.map((p) => p.id));
  const todos = feed.todos.filter((t) => t.place_id && ids.has(t.place_id));
  if (todos.length === 0) return '';

  const label = matched.length === 1 ? matched[0].name : c || matched[0].name;
  const shown = todos.slice(0, MAX_ITEMS).map((t) => `- ${firstLine(t.body)}`);
  const lines = [`${todos.length} to-do${todos.length === 1 ? '' : 's'} at ${label}:`, ...shown];
  if (todos.length > MAX_ITEMS) lines.push(`+ ${todos.length - MAX_ITEMS} more`);

  const cats = new Set(matched.map((p) => (p.category ?? '').toLowerCase()).filter(Boolean));
  const useful = feed.facts.filter((f) => f.surface_at.some((s) => cats.has(s.toLowerCase())));
  if (useful.length) {
    lines.push('', 'Useful here:', ...useful.slice(0, 5).map((f) => `- ${f.title}${f.value ? `: ${firstLine(f.value)}` : ''}`));
  }
  return lines.join('\n');
}

/**
 * Weekly digest: house tasks due, coming up soon, and how many to-dos are waiting. Empty string when there is
 * nothing to say (no notification that week).
 * @param {Feed} feed
 * @param {{tz?: string, now?: Date}} [opts]
 */
export function digestText(feed, { tz = DEFAULT_TZ, now = new Date() } = {}) {
  const today = todayIn(tz, now);
  const due = feed.tasks.filter((t) => t.next_due_at <= today);
  const soon = feed.tasks.filter((t) => t.next_due_at > today && daysBetween(today, t.next_due_at) <= 21);
  const lines = [];
  if (due.length) lines.push(`Due now: ${due.slice(0, 5).map((t) => t.title).join(', ')}${due.length > 5 ? ` +${due.length - 5}` : ''}`);
  if (soon.length) lines.push(`Coming up: ${soon.slice(0, 3).map((t) => `${t.title} (${when(daysBetween(today, t.next_due_at))})`).join(', ')}`);
  const anytime = feed.todos.filter((t) => !t.place_id).length;
  const atPlace = feed.todos.length - anytime;
  if (feed.todos.length) lines.push(`To-dos: ${feed.todos.length} waiting (${anytime} anytime, ${atPlace} at places)`);
  return lines.length ? ['Home Memory', ...lines].join('\n') : '';
}

// ---------------------------------------------------------------------------------------------- calendar (.ics)

const CRLF = '\r\n';

export function escapeText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding at 75 octets, never splitting a multi-byte character. */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) {
      out.push(cur);
      cur = ` ${ch}`;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join(CRLF);
}

const compact = (ymd) => ymd.replaceAll('-', '');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * A calendar of the house tasks: one all-day event per task (spanning the season for yearly windows) with an alert
 * at 09:00 on the first day. Calendar apps re-fetch it, so completed tasks move to their next date by themselves.
 * @param {Feed} feed
 * @param {{now?: Date}} [opts]
 */
export function buildIcs(feed, { now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Home Memory//House tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${feed.household} house tasks`)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const t of feed.tasks) {
    const start = t.next_due_at;
    const endInclusive = t.due_until && t.due_until >= start ? t.due_until : start;
    const description = [`${scheduleText(t)}.`, t.last_done_at ? `Last done ${t.last_done_at}.` : 'Not done yet.', t.notes].filter(Boolean).join(' ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:task-${t.id}@homememory`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `DTEND;VALUE=DATE:${compact(addDays(endInclusive, 1))}`,
      `SUMMARY:${escapeText(t.title)}`,
      `DESCRIPTION:${escapeText(description)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(t.title)}`,
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------------------------- server side

/**
 * Reads the feed for a key from Supabase (anonymous RPC; the key is the credential).
 * @returns {Promise<{status:'ok',feed:Feed}|{status:'invalid'}|{status:'error'}>}
 */
export async function loadFeed({ url, anonKey, key, fetchImpl = fetch }) {
  try {
    // Only the apikey header: the new publishable keys are not JWTs and must not be sent as a Bearer token.
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/rpc/reminder_feed`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: key }),
    });
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    return data ? { status: 'ok', feed: data } : { status: 'invalid' };
  } catch {
    return { status: 'error' };
  }
}
