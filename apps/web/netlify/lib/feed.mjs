// Pure helpers for the reminder links served by the Netlify function: the text shown in a Shortcuts notification
// (a place list, a weekly digest) and the Calendar (.ics) feed. Plain ES module, no dependencies, so it is tested
// with plain Node (feed.test.mjs).

import houseNb from '../../src/i18n/houseTasks.nb.json' with { type: 'json' };

export const DEFAULT_TZ = 'Europe/Oslo';

// Words for the notification text and the calendar, in English and Norwegian (?lang=nb on the link).
const WORDS = {
  en: {
    photo: '(photo)', months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    everyYear: 'every year', everyYearIn: 'every year, {a}', everyYearSeason: 'every year, {a}-{b}', everyYears: 'every {n} years', everyMonth: 'every month', everyMonths: 'every {n} months',
    now: 'now', tomorrow: 'tomorrow', inDays: 'in {n} days', inWeeks: 'in {n} weeks',
    todosAt_one: '{n} to-do at {label}:', todosAt_other: '{n} to-dos at {label}:', more: '+ {n} more', useful: 'Useful here:',
    dueNow: 'Due now: {list}', comingUp: 'Coming up: {list}', dueToday: 'Due today: {list}', todosWaiting: 'To-dos: {n} waiting ({a} anytime, {b} at places)', doneWeek: 'Done this week: {n}',
    forToday_one: '{n} to-do for today:', forToday_other: '{n} to-dos for today:', lastDone: 'Last done {d}.', notDone: 'Not done yet.',
  },
  nb: {
    photo: '(bilde)', months: ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'],
    everyYear: 'hvert år', everyYearIn: 'hvert år, {a}', everyYearSeason: 'hvert år, {a}-{b}', everyYears: 'hvert {n}. år', everyMonth: 'hver måned', everyMonths: 'hver {n}. måned',
    now: 'nå', tomorrow: 'i morgen', inDays: 'om {n} dager', inWeeks: 'om {n} uker',
    todosAt_one: '{n} oppgave hos {label}:', todosAt_other: '{n} oppgaver hos {label}:', more: '+ {n} til', useful: 'Nyttig her:',
    dueNow: 'Aktuelt nå: {list}', comingUp: 'Kommer snart: {list}', dueToday: 'I dag: {list}', todosWaiting: 'Oppgaver: {n} venter ({a} når som helst, {b} på steder)', doneWeek: 'Ferdig denne uken: {n}',
    forToday_one: '{n} oppgave i dag:', forToday_other: '{n} oppgaver i dag:', lastDone: 'Sist gjort {d}.', notDone: 'Ikke gjort ennå.',
  },
};
const NB_TASKS = houseNb;

/** 'en' unless the link asked for Norwegian. */
export const pickLang = (v) => (String(v ?? '').toLowerCase().startsWith('nb') || String(v ?? '').toLowerCase() === 'no' ? 'nb' : 'en');
const w = (lang) => WORDS[lang] ?? WORDS.en;
const fmt = (str, params = {}) => str.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
const plural = (lang, base, n, params = {}) => fmt(w(lang)[`${base}_${n === 1 ? 'one' : 'other'}`], { n, ...params });

/** Titles and notes of the starter house calendar exist in Norwegian; your own tasks are shown as written. */
export const taskTitle = (t, lang = 'en') => (lang === 'nb' && t.template_key && NB_TASKS[t.template_key]?.title) || t.title;
export const taskNotes = (t, lang = 'en') => (lang === 'nb' && t.template_key && NB_TASKS[t.template_key]?.notes) || t.notes;

/** @typedef {{id:string,name:string,kind:string,category:string|null,radius_m:number,address?:string|null}} Place */
/** @typedef {{id:string,body:string,place_id:string|null,created_at:string,due_on?:string|null,due_time?:string|null,repeat_rule?:string|null}} Todo */
/** @typedef {{id:string,template_key?:string|null,title:string,notes:string|null,schedule:string,interval_months:number|null,window_start_month:number|null,window_end_month:number|null,next_due_at:string,due_until:string|null,last_done_at:string|null}} Task */
/** @typedef {{household:string,generated_at:string,done_week?:number,places:Place[],todos:Todo[],tasks:Task[],facts:{title:string,value:string,surface_at:string[]}[]}} Feed */

/** Today's date (yyyy-mm-dd) in a time zone. */
export function todayIn(tz = DEFAULT_TZ, now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const utc = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
export const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86_400_000);
export function addDays(ymd, n) {
  return new Date(utc(ymd) + n * 86_400_000).toISOString().slice(0, 10);
}

const firstLine = (s, lang = 'en') => String(s ?? '').split('\n')[0].trim() || w(lang).photo;

export function scheduleText(t, lang = 'en') {
  const x = w(lang);
  if (t.schedule === 'seasonal' && t.window_start_month && t.window_end_month) {
    const a = x.months[t.window_start_month - 1];
    const b = x.months[t.window_end_month - 1];
    return a === b ? fmt(x.everyYearIn, { a }) : fmt(x.everyYearSeason, { a, b });
  }
  const n = t.interval_months ?? 12;
  if (n % 12 === 0) return n === 12 ? x.everyYear : fmt(x.everyYears, { n: n / 12 });
  return n === 1 ? x.everyMonth : fmt(x.everyMonths, { n });
}

function when(days, lang) {
  const x = w(lang);
  if (days <= 0) return x.now;
  if (days === 1) return x.tomorrow;
  if (days < 14) return fmt(x.inDays, { n: days });
  return fmt(x.inWeeks, { n: Math.round(days / 7) });
}

const MAX_ITEMS = 8;

/**
 * The to-dos for a place, as notification text. Matches saved places by name (contains, any case) and/or by shop
 * category. Empty string when there is nothing there, so a Shortcut can skip the notification.
 * @param {Feed} feed
 * @param {{place?: string|null, category?: string|null, lang?: string}} q
 */
export function placeText(feed, { place, category, lang = 'en' }) {
  const q = (place ?? '').trim().toLowerCase();
  const c = (category ?? '').trim().toLowerCase();
  if (!q && !c) return '';
  const matched = feed.places.filter((p) => (q && p.name.toLowerCase().includes(q)) || (c && (p.category ?? '').toLowerCase() === c));
  if (matched.length === 0) return '';
  const ids = new Set(matched.map((p) => p.id));
  const todos = feed.todos.filter((t) => t.place_id && ids.has(t.place_id));
  if (todos.length === 0) return '';

  const label = matched.length === 1 ? matched[0].name : c || matched[0].name;
  const shown = todos.slice(0, MAX_ITEMS).map((t) => `- ${firstLine(t.body, lang)}`);
  const lines = [plural(lang, 'todosAt', todos.length, { label }), ...shown];
  if (todos.length > MAX_ITEMS) lines.push(fmt(w(lang).more, { n: todos.length - MAX_ITEMS }));

  const cats = new Set(matched.map((p) => (p.category ?? '').toLowerCase()).filter(Boolean));
  const useful = feed.facts.filter((f) => f.surface_at.some((s) => cats.has(s.toLowerCase())));
  if (useful.length) {
    lines.push('', w(lang).useful, ...useful.slice(0, 5).map((f) => `- ${f.title}${f.value ? `: ${firstLine(f.value, lang)}` : ''}`));
  }
  return lines.join('\n');
}

/**
 * Weekly digest: house tasks due, coming up soon, and how many to-dos are waiting. Empty string when there is
 * nothing to say (no notification that week).
 * @param {Feed} feed
 * @param {{tz?: string, now?: Date, lang?: string}} [opts]
 */
export function digestText(feed, { tz = DEFAULT_TZ, now = new Date(), lang = 'en' } = {}) {
  const x = w(lang);
  const today = todayIn(tz, now);
  const due = feed.tasks.filter((t) => t.next_due_at <= today);
  const soon = feed.tasks.filter((t) => t.next_due_at > today && daysBetween(today, t.next_due_at) <= 21);
  const lines = [];
  if (due.length) lines.push(fmt(x.dueNow, { list: `${due.slice(0, 5).map((t) => taskTitle(t, lang)).join(', ')}${due.length > 5 ? ` +${due.length - 5}` : ''}` }));
  if (soon.length) lines.push(fmt(x.comingUp, { list: soon.slice(0, 3).map((t) => `${taskTitle(t, lang)} (${when(daysBetween(today, t.next_due_at), lang)})`).join(', ') }));
  const dated = dueToday(feed, today);
  if (dated.length) lines.push(fmt(x.dueToday, { list: `${dated.slice(0, 3).map((t) => firstLine(t.body, lang)).join(', ')}${dated.length > 3 ? ` +${dated.length - 3}` : ''}` }));
  const anytime = feed.todos.filter((t) => !t.place_id).length;
  const atPlace = feed.todos.length - anytime;
  if (feed.todos.length) lines.push(fmt(x.todosWaiting, { n: feed.todos.length, a: anytime, b: atPlace }));
  const doneWeek = Number(feed.done_week ?? 0);
  if (lines.length && doneWeek > 0) lines.push(fmt(x.doneWeek, { n: doneWeek }));
  return lines.length ? ['Home Memory', ...lines].join('\n') : '';
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const byDue = (a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? '') || hhmm(a.due_time).localeCompare(hhmm(b.due_time));

/** To-dos due today or earlier (still open). */
function dueToday(feed, today) {
  return feed.todos.filter((t) => t.due_on && t.due_on <= today).sort(byDue);
}

/**
 * The to-dos due today (and anything still open from earlier days), for a daily morning automation. Empty when none.
 * @param {Feed} feed
 * @param {{tz?: string, now?: Date, lang?: string}} [opts]
 */
export function todayText(feed, { tz = DEFAULT_TZ, now = new Date(), lang = 'en' } = {}) {
  const items = dueToday(feed, todayIn(tz, now));
  if (items.length === 0) return '';
  const lines = items.slice(0, MAX_ITEMS).map((t) => `- ${hhmm(t.due_time) ? `${hhmm(t.due_time)} ` : ''}${firstLine(t.body, lang)}`);
  if (items.length > MAX_ITEMS) lines.push(fmt(w(lang).more, { n: items.length - MAX_ITEMS }));
  return [plural(lang, 'forToday', items.length), ...lines].join('\n');
}

// ---------------------------------------------------------------------------------------------- calendar (.ics)

const CRLF = '\r\n';

export function escapeText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
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
 * A calendar of the house tasks (one all-day event per task, spanning the season for yearly windows, alert at 09:00 on
 * the first day) and of to-dos that have a date (timed ones alert at their time). Calendar apps re-fetch it, so completed
 * items move or disappear by themselves.
 * @param {Feed} feed
 * @param {{now?: Date, lang?: string}} [opts]
 */
export function buildIcs(feed, { now = new Date(), lang = 'en' } = {}) {
  const x = w(lang);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Home Memory//Tasks and to-dos//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${feed.household} Home Memory`)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const t of feed.tasks) {
    const start = t.next_due_at;
    const endInclusive = t.due_until && t.due_until >= start ? t.due_until : start;
    const title = taskTitle(t, lang);
    const description = [`${scheduleText(t, lang)}.`, t.last_done_at ? fmt(x.lastDone, { d: t.last_done_at }) : x.notDone, taskNotes(t, lang)].filter(Boolean).join(' ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:task-${t.id}@homememory`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `DTEND;VALUE=DATE:${compact(addDays(endInclusive, 1))}`,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(description)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(title)}`,
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  const placeById = new Map(feed.places.map((p) => [p.id, p]));
  for (const t of feed.todos) {
    if (!t.due_on) continue;
    const place = t.place_id ? placeById.get(t.place_id) : null;
    const time = hhmm(t.due_time);
    const title = firstLine(t.body, lang);
    const where = place ? [place.name, place.address].filter(Boolean).join(', ') : '';
    lines.push('BEGIN:VEVENT', `UID:todo-${t.id}@homememory`, `DTSTAMP:${stamp(now)}`);
    if (time) {
      // A timed reminder: floating local time (the phone's own time zone), 30 minutes long, alert at the start.
      const start = new Date(Date.UTC(+t.due_on.slice(0, 4), +t.due_on.slice(5, 7) - 1, +t.due_on.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5)));
      const end = new Date(start.getTime() + 30 * 60_000);
      const local = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
      lines.push(`DTSTART:${local(start)}`, `DTEND:${local(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(t.due_on)}`, `DTEND;VALUE=DATE:${compact(addDays(t.due_on, 1))}`);
    }
    const rrule = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' }[t.repeat_rule ?? ''];
    if (rrule) lines.push(`RRULE:${rrule}`);
    lines.push(`SUMMARY:${escapeText(title)}`);
    if (where) lines.push(`LOCATION:${escapeText(where)}`);
    lines.push('TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(title)}`, time ? 'TRIGGER:PT0S' : 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
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
