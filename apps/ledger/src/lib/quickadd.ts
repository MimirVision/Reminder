// Quick add: one line of text becomes a task. "Chase receipts @nordvik fri !high #receipts" gives the title
// "Chase receipts", client Nordvik Snekkeri AS, due this Friday, high priority and the tag "receipts".
// Everything recognised is shown back to the person as chips before they press Enter, so nothing is guessed silently.

import { addDays, daysInMonth, endOfMonth, fromParts, isISODate, parts, weekday, type ISODate } from './dates';
import type { Client, Priority } from './types';

export interface QuickAdd {
  title: string;
  clientId: string | null;
  /** How the client was found: typed with @, or a distinctive word of its name. */
  clientBy: 'mention' | 'name' | null;
  due: ISODate | null;
  dueText: string | null;
  priority: Priority | null;
  tags: string[];
}

const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, man: 1, mandag: 1,
  tue: 2, tues: 2, tuesday: 2, tir: 2, tirsdag: 2,
  wed: 3, wednesday: 3, ons: 3, onsdag: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, tor: 4, torsdag: 4,
  fri: 5, friday: 5, fre: 5, fredag: 5,
  sat: 6, saturday: 6, lør: 6, lørdag: 6,
  sun: 7, sunday: 7, søn: 7, søndag: 7,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januar: 1, feb: 2, february: 2, februar: 2, mar: 3, march: 3, mars: 3, apr: 4, april: 4,
  may: 5, mai: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, des: 12, desember: 12,
};

const norm = (s: string) => s.toLowerCase().normalize('NFC');

/** The next date (after today) that is this ISO weekday. */
function nextWeekday(today: ISODate, wd: number): ISODate {
  return addDays(today, ((wd - weekday(today) + 7) % 7) || 7);
}

/**
 * A calendar date without a year. Up to two months back it means this year (a deadline just missed, to be done now);
 * further back it means the next time the date comes round.
 */
const RECENT_DAYS = 61;

function upcoming(today: ISODate, month: number, day: number, year?: number): ISODate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year !== undefined) {
    const y = year < 100 ? year + 2000 : year;
    return day <= daysInMonth(y, month) ? fromParts(y, month, day) : null;
  }
  const [ty] = parts(today);
  if (day <= daysInMonth(ty, month)) {
    const thisYear = fromParts(ty, month, day);
    if (thisYear >= addDays(today, -RECENT_DAYS)) return thisYear;
  }
  // Otherwise the next time this date comes round (29 February may be up to four years away).
  for (let y = ty; y <= ty + 4; y++) {
    if (day > daysInMonth(y, month)) continue;
    const d = fromParts(y, month, day);
    if (d >= today) return d;
  }
  return null;
}

interface DateMatch { due: ISODate; length: number }

/** Tries to read a date starting at word i. Returns how many words it used. */
function readDate(words: string[], i: number, today: ISODate): DateMatch | null {
  const w = norm(words[i]);
  const next = words[i + 1] ? norm(words[i + 1]) : '';
  const after = words[i + 2] ? norm(words[i + 2]) : '';
  if (w === 'today' || w === 'idag' || w === 'tod') return { due: today, length: 1 };
  if (w === 'tomorrow' || w === 'tmr' || w === 'imorgen' || w === 'tom') return { due: addDays(today, 1), length: 1 };
  if (w === 'i' && next === 'dag') return { due: today, length: 2 };
  if (w === 'i' && next === 'morgen') return { due: addDays(today, 1), length: 2 };
  if ((w === 'next' || w === 'neste') && (next === 'week' || next === 'uke')) return { due: nextWeekday(today, 1), length: 2 };
  if ((w === 'next' || w === 'neste' || w === 'on' || w === 'på') && WEEKDAYS[next]) return { due: nextWeekday(today, WEEKDAYS[next]), length: 2 };
  if (w === 'eom' || (w === 'end' && next === 'of' && after === 'month')) return { due: endOfMonth(today), length: w === 'eom' ? 1 : 3 };
  if (WEEKDAYS[w]) return { due: nextWeekday(today, WEEKDAYS[w]), length: 1 };
  if ((w === 'in' || w === 'om') && /^\d{1,3}$/.test(next)) {
    const n = Number(next);
    if (/^(day|days|d|dag|dager)$/.test(after)) return { due: addDays(today, n), length: 3 };
    if (/^(week|weeks|w|uke|uker)$/.test(after)) return { due: addDays(today, 7 * n), length: 3 };
  }
  if (isISODate(w)) return { due: w, length: 1 };
  // 15.11, 15/11, 15.11.26, 15.11.2026
  const m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(w);
  if (m) {
    const d = upcoming(today, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined);
    if (d) return { due: d, length: 1 };
  }
  // "15 nov", "15. nov", "nov 15"
  const dayNum = /^(\d{1,2})\.?$/.exec(w);
  if (dayNum && MONTHS[next.replace(/\.$/, '')]) {
    const d = upcoming(today, MONTHS[next.replace(/\.$/, '')], Number(dayNum[1]));
    if (d) return { due: d, length: 2 };
  }
  if (MONTHS[w] && /^\d{1,2}$/.test(next)) {
    const d = upcoming(today, MONTHS[w], Number(next));
    if (d) return { due: d, length: 2 };
  }
  return null;
}

const PRIORITY_WORDS: Record<string, Priority> = {
  '!': 'high', '!!': 'urgent', '!!!': 'urgent', '!urgent': 'urgent', '!high': 'high', '!normal': 'normal', '!low': 'low',
  '!haster': 'urgent', '!høy': 'high', '!lav': 'low', p1: 'urgent', p2: 'high', p3: 'normal', p4: 'low',
};

function findClient(token: string, clients: Pick<Client, 'id' | 'name' | 'reference'>[]): Pick<Client, 'id' | 'name' | 'reference'> | null {
  const raw = norm(token);
  const t = raw.replace(/[-_]/g, ' ');
  if (!t) return null;
  const byRef = clients.filter((c) => c.reference && norm(c.reference) === raw);
  if (byRef.length === 1) return byRef[0];
  const starts = clients.filter((c) => norm(c.name).startsWith(t) || norm(c.name).split(/\s+/).some((w) => w.startsWith(t)));
  if (starts.length === 1) return starts[0];
  const exactFirst = starts.filter((c) => norm(c.name).split(/\s+/)[0] === t);
  return exactFirst.length === 1 ? exactFirst[0] : null;
}

/** Words too common in task titles to be read as a client name on their own. */
const COMMON = new Set(['monthly', 'annual', 'payroll', 'vat', 'invoice', 'invoices', 'bank', 'call', 'email', 'meeting', 'check', 'send', 'review', 'year', 'report']);

export function parseQuickAdd(input: string, clients: Pick<Client, 'id' | 'name' | 'reference' | 'status'>[], today: ISODate): QuickAdd {
  const active = clients.filter((c) => c.status === 'active');
  const words = input.trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  const out: QuickAdd = { title: '', clientId: null, clientBy: null, due: null, dueText: null, priority: null, tags: [] };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lw = norm(w);
    if (w.length > 1 && w.startsWith('#')) {
      const tag = lw.slice(1).replace(/[^\p{L}\p{N}_-]/gu, '');
      if (tag && !out.tags.includes(tag)) out.tags.push(tag);
      continue;
    }
    if (PRIORITY_WORDS[lw] && !out.priority) { out.priority = PRIORITY_WORDS[lw]; continue; }
    if (w.length > 1 && w.startsWith('@') && !out.clientId) {
      const c = findClient(w.slice(1), active);
      if (c) { out.clientId = c.id; out.clientBy = 'mention'; continue; }
    }
    if (!out.due) {
      const d = readDate(words, i, today);
      if (d) {
        out.due = d.due;
        out.dueText = words.slice(i, i + d.length).join(' ');
        i += d.length - 1;
        continue;
      }
    }
    keep.push(w);
  }

  // No @mention: a single distinctive word that uniquely starts one active client's name ("Nordvik").
  if (!out.clientId) {
    for (let i = 0; i < keep.length; i++) {
      const lw = norm(keep[i]).replace(/[.,:;]$/, '');
      if (lw.length < 4 || COMMON.has(lw)) continue;
      const hits = active.filter((c) => norm(c.name).split(/\s+/)[0] === lw);
      if (hits.length === 1) {
        out.clientId = hits[0].id;
        out.clientBy = 'name';
        keep.splice(i, 1);
        break;
      }
    }
  }

  out.title = keep.join(' ').replace(/\s+([,.;:])/g, '$1').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '');
  return out;
}
