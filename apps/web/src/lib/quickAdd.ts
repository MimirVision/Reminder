// Natural-language add, the part that works on the device with no network and no AI: "buy milk at kiwi tomorrow before 18"
// and longer text with several to-dos ("pick up X at the pharmacy when I leave work, then later today do Y before 21.00").
// English and Norwegian are both understood, whichever language the app is in. Pure functions, unit tested.
import type { Place, Priority, RepeatRule } from './types';
import { extractTags } from './tags.ts';
import { addDays, parseISODate, quickDates, todayISO } from './when.ts';

export type Assignee = 'me' | 'partner' | 'both';

export type ParsedTask = {
  title: string;
  due_on: string | null;
  due_time: string | null;
  repeat_rule: RepeatRule | null;
  placeId: string | null; // a saved place
  category: string | null; // a kind of shop that is not saved yet (the app creates "Any pharmacy" etc.)
  leaving: boolean; // "when I leave work": the app reminds at the place, this only labels it
  assignee: Assignee | null;
  priority: Priority; // 0 = none
  tags: string[]; // "#errands"
  remind_before: number | null; // "remind me 30 min before"
  duration_min: number | null; // "takes 45 min"
};

export type ParseContext = {
  places: Pick<Place, 'id' | 'name' | 'kind' | 'category'>[];
  partnerName?: string | null;
  now?: Date;
};

type Meta = Omit<ParsedTask, 'title'>;
const noMeta = (): Meta => ({ due_on: null, due_time: null, repeat_rule: null, placeId: null, category: null, leaving: false, assignee: null, priority: 0, tags: [], remind_before: null, duration_min: null });
export const hasMeta = (t: Pick<ParsedTask, keyof Meta>) => !!(t.due_on || t.due_time || t.repeat_rule || t.placeId || t.category || t.leaving || t.assignee || t.priority || t.tags.length || t.remind_before != null || t.duration_min != null);

const L = '\\p{L}\\p{N}';
/** Whole-word, case-insensitive, Unicode aware (JS \b does not know å, ø, æ). */
const W = (src: string, flags = 'iu') => new RegExp(`(?<![${L}])(?:${src})(?![${L}])`, flags);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s: string) => s.toLocaleLowerCase('nb').normalize('NFC');
const pad = (n: number) => String(n).padStart(2, '0');

const SPLIT = new RegExp(
  [
    '\\n+',
    ';\\s*',
    '\\.\\s+(?=\\S)',
    '\\s+(?:and then|and later|and after that|after that|afterwards|then|plus|og deretter|deretter|og så|etterpå|og senere)\\s+',
    ',?\\s+(?=(?:i|we|jeg|vi)\\s+(?:need to|have to|must|should|want to|got to|skal|må|trenger å|burde|vil)(?![\\p{L}]))',
  ].join('|'), 'iu',
);

const DAYS: [RegExp, number][] = [
  [/sunday|søndag/, 0], [/monday|mandag/, 1], [/tuesday|tirsdag/, 2], [/wednesday|onsdag/, 3], [/thursday|torsdag/, 4], [/friday|fredag/, 5], [/saturday|lørdag/, 6],
];
const DAY_WORDS = 'sunday|søndag|monday|mandag|tuesday|tirsdag|wednesday|onsdag|thursday|torsdag|friday|fredag|saturday|lørdag';

const REPEATS: [RegExp, RepeatRule][] = [
  [W('every weekday|every weekdays|on weekdays|weekdays|hver ukedag|hver hverdag|p\u00e5 hverdager|hverdager|hver dag p\u00e5 hverdager'), 'weekdays'],
  [W('every other week|every 2 weeks|every two weeks|biweekly|fortnightly|annenhver uke|hver andre uke|hver 14\\. dag'), 'biweekly'],
  [W('every day|daily|each day|hver dag|daglig'), 'daily'],
  [W('every week|weekly|each week|hver uke|ukentlig'), 'weekly'],
  [W('every month|monthly|each month|hver måned|månedlig'), 'monthly'],
  [W('every year|yearly|annually|each year|hvert år|årlig'), 'yearly'],
];

const DEADLINE = /^(before|by|until|innen|før)$/i;
const TIME = W(`(before|by|until|at|innen|før|kl\\.?|klokka|klokken)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)?(?!\\s*(?:kg|g|l|stk|pcs|pieces|x|%|min|minutes|hours|timer|days|dager))`);
const PART: [RegExp, string][] = [
  [W('(?:this )?morning|i morges'), '09:00'], [W('(?:this )?afternoon|i ettermiddag'), '15:00'],
  [W('(?:this )?evening|i kveld'), '18:00'], [W('tonight|i natt'), '20:00'],
];
const PART_BARE: [RegExp, string][] = [[W('morning|morgenen'), '09:00'], [W('afternoon|ettermiddagen'), '15:00'], [W('evening|kvelden'), '18:00']];

// Words that stand for a kind of place; a saved place whose name has one of them matches when you say the word.
const ALIAS: string[][] = [
  ['work', 'office', 'jobb', 'jobben', 'kontoret', 'kontor', 'workplace'],
  ['home', 'house', 'hjem', 'hjemme', 'hjemmefra', 'huset', 'bolig'],
];
const CAT_WORDS: Record<string, string> = {
  pharmacy: 'pharmacy|chemist|apotek|apoteket', hardware: 'hardware store|hardware|byggevarehus|byggevare|jernvare|jernvarehandel',
  grocery: 'grocery store|grocery|supermarket|matbutikk|dagligvare|dagligvarebutikk', paint: 'paint shop|malingsbutikk|malingforretning',
  garden: 'garden centre|garden center|hagesenter|plantesenter',
};
const PREP = '(?:(?:at|in|from|to|on|the|a|any|på|hos|ved|fra|til|i|det|den|en|et|noen)\\s+)*';
const ARRIVE_TRIG = '(?:when|once|as soon as|after|before|as|n\u00e5r|etter at|f\u00f8r|idet)\\s+(?:(?:i|we|jeg|vi)\\s+)?(?:leave|leaving|left|forlater|drar fra|g\u00e5r fra|(?:drar|g\u00e5r|reiser)(?=\\s+hjemmefra)|kommer fra|get to|arrive at|arrive in|arrive|reach|get|kommer til|kommer|er p\u00e5|er hos|er)\\s+';
const LEAVE_TRIG = '(?:etter (?:at )?jeg (?:er )?ferdig p\u00e5|p\u00e5 vei fra|p\u00e5 vei ut (?:fra|av)|on my way out of|on my way out from|on my way from|after i finish at|after i am done at|after i\u2019m done at|after i\'m done at)\\s+';
const TRIGGER = `(?:(?:${ARRIVE_TRIG})|(?:${LEAVE_TRIG}))`;
const LEAVE_WORDS = /(?:leave|leaving|left|forlater|drar fra|g\u00e5r fra|hjemmefra|out of|out from|ut fra|ut av|kommer fra|ferdig p\u00e5|p\u00e5 vei fra|on my way from|finish at|done at)/i;

function matchAt(s: string, re: RegExp): { m: RegExpMatchArray; rest: string } | null {
  const m = s.match(re);
  return m && m.index != null ? { m, rest: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` } : null;
}

function nextWeekday(from: string, dow: number): string {
  const cur = parseISODate(from).getDay();
  return addDays(from, ((dow - cur + 7) % 7) || 7);
}

function readDate(s: string, today: string, quick: ReturnType<typeof quickDates>): { s: string; date: string | null } {
  let r;
  if ((r = matchAt(s, W('day after tomorrow|i overmorgen|overmorgen')))) return { s: r.rest, date: addDays(today, 2) };
  if ((r = matchAt(s, W('tomorrow|i morgen|imorgen')))) return { s: r.rest, date: addDays(today, 1) };
  if ((r = matchAt(s, W('(?:later )?today|i dag|idag|senere i dag|tonight|i kveld|i natt|this evening|this afternoon|this morning|i ettermiddag|i morges')))) {
    // The part of the day stays in the text for the time pass; only a plain "today" is removed here.
    return /today|dag/i.test(r.m[0]) ? { s: r.rest, date: today } : { s, date: today };
  }
  if ((r = matchAt(s, W('this weekend|i helga|i helgen|på helgen')))) return { s: r.rest, date: quick.weekend };
  if ((r = matchAt(s, W('next week|neste uke')))) return { s: r.rest, date: quick.nextWeek };
  if ((r = matchAt(s, W('in (\\d{1,2}) (days?|weeks?)|om (\\d{1,2}) (dager|dag|uker|uke)')))) {
    const n = Number(r.m[1] ?? r.m[3]);
    const week = /week|uke/i.test(r.m[2] ?? r.m[4]);
    return { s: r.rest, date: addDays(today, week ? n * 7 : n) };
  }
  if ((r = matchAt(s, W('(\\d{4})-(\\d{2})-(\\d{2})')))) return { s: r.rest, date: `${r.m[1]}-${r.m[2]}-${r.m[3]}` };
  if ((r = matchAt(s, W(`(?:(?:on|next|this|på|neste|denne|før|innen|before|by|til)\\s+)?(${DAY_WORDS})`)))) {
    const dow = DAYS.find(([re]) => re.test(r!.m[1].toLowerCase()))![1];
    return { s: r.rest, date: nextWeekday(today, dow) };
  }
  return { s, date: null };
}

function readTime(s: string, hasDate: boolean): { s: string; time: string | null; deadline: boolean; explicit: boolean } {
  const r = matchAt(s, TIME);
  if (r) {
    let h = Number(r.m[2]);
    const min = r.m[3] ? Number(r.m[3]) : 0;
    const ap = r.m[4]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h <= 23 && min <= 59) return { s: r.rest, time: `${pad(h)}:${pad(min)}`, deadline: DEADLINE.test(r.m[1]), explicit: true };
  }
  for (const [re, time] of PART) { const p = matchAt(s, re); if (p) return { s: p.rest, time, deadline: false, explicit: false }; }
  if (hasDate) for (const [re, time] of PART_BARE) { const p = matchAt(s, re); if (p) return { s: p.rest, time, deadline: false, explicit: false }; }
  return { s, time: null, deadline: false, explicit: false };
}

type Pl = ParseContext['places'][number];

/** The saved place a word or phrase in `s` points at: by its name, by "work"/"home" style words, or by a kind of shop. */
function findPlace(s: string, places: Pl[]): { place: Pl | null; category: string | null; re: RegExp } | null {
  const hay = norm(s);
  const hit = (re: RegExp) => re.test(hay);
  const mention = (words: string) => new RegExp(`${PREP}${W(words, 'iu').source}`, 'iu');

  // 1. A saved place by its full name, then by its distinctive first word when that is unambiguous.
  const fixed = places.filter((p) => p.kind === 'fixed');
  for (const p of fixed) {
    const full = norm(p.name).trim();
    if (full.length >= 3 && hit(W(esc(full)))) return { place: p, category: null, re: mention(esc(full)) };
  }
  const first = (p: Pl) => norm(p.name).split(/[\s,\-–]+/)[0] ?? '';
  for (const p of fixed) {
    const w = first(p);
    if (w.length >= 4 && fixed.filter((x) => first(x) === w).length === 1 && hit(W(esc(w)))) return { place: p, category: null, re: mention(esc(w)) };
  }
  // 2. Work, home and friends: "when I leave work" matches the place called "Jobb Aker Brygge" or "Office".
  for (const group of ALIAS) {
    const word = group.find((w) => hit(W(esc(w))));
    if (!word) continue;
    const p = fixed.find((x) => group.some((w) => W(esc(w)).test(norm(x.name))));
    if (p) return { place: p, category: null, re: mention(esc(word)) };
  }
  // 3. A kind of shop, only after a preposition ("at the pharmacy"), so "paint the fence" is not a shop.
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    const re = new RegExp(`(?<![${L}])(?:(?:at|in|from|to|på|hos|ved|fra|til|i)\\s+(?:(?:the|a|any|en|et|noen)\\s+)?)(?:${words})(?![${L}])`, 'iu');
    if (re.test(hay)) {
      const saved = places.find((p) => p.kind === 'category' && p.category === cat);
      return { place: saved ?? null, category: saved ? null : cat, re };
    }
  }
  return null;
}

const FILLER = /^(?:(?:please|also|and|so|then|later|remind me to|remind me|påminn meg om å|påminn meg om|husk meg på å|remember to|remember|don't forget to|dont forget to|i need to|i have to|i must|i should|i want to|i got to|we need to|we have to|need to|have to|must|gotta|husk å|husk|ikke glem å|må jeg|skal jeg|vil jeg|burde jeg|trenger jeg å|jeg må|jeg skal|jeg trenger å|jeg burde|jeg vil|vi må|vi skal|må|skal|og|så|også|senere)\s+)+/i;
const PRONOUN = /^(?:(?:do|get|finish|complete|make|have|gjøre|få|fullføre|ha)\s+)?(?:that|it|this|det|den|dette)(?:\s+(?:done|ferdig))?$/i;

function cleanTitle(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s,.;:\-–]+/, '');
  s = s.replace(FILLER, '');
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/[\s,.;:\-–]+$/, '').replace(/\s+(?:and|og|then|but|men|so|because|but then)$/i, '')
      .replace(/\s+(?:at|in|from|to|on|by|before|until|på|i|hos|ved|fra|til|innen|før|kl|when|når|the|a|an)$/i, '');
    if (s === before) break;
  }
  s = s.replace(/^to\s+/i, '');
  return s.replace(/^(\p{Ll}+)(?=\s|$)/u, (w) => w[0].toLocaleUpperCase('nb') + w.slice(1));
}

const PRIORITY: [RegExp, Priority][] = [
  [/(?<![\p{L}\p{N}!])!!!(?!!)|(?<![\p{L}\p{N}])p1(?![\p{L}\p{N}])/iu, 3],
  [W('urgent|asap|high priority|h\u00f8y prioritet|haster'), 3],
  [/(?<![\p{L}\p{N}!])!!(?!!)|(?<![\p{L}\p{N}])p2(?![\p{L}\p{N}])/iu, 2],
  [W('medium priority|middels prioritet'), 2],
  [/(?<![\p{L}\p{N}])p3(?![\p{L}\p{N}])/iu, 1],
  [W('low priority|lav prioritet'), 1],
];
function readPriority(s: string): { s: string; priority: Priority } {
  for (const [re, p] of PRIORITY) { const r = matchAt(s, re); if (r) return { s: r.rest, priority: p }; }
  return { s, priority: 0 };
}

const UNIT_MIN = (u: string) => (/^(?:h|hours?|timer?|t)$/i.test(u) ? 60 : /^(?:days?|dag(?:er)?)$/i.test(u) ? 1440 : 1);
const LEAD = W('(?:(?:remind|alert|påminn|varsle)(?:\\s+(?:me|meg))?\\s+)?(\\d{1,4})\\s*(min(?:utes?|utter)?|hours?|timer?|h|days?|dag(?:er)?)\\s+(?:before|ahead|early|før|i forveien)');
const TAKES = W('(?:takes?|taking|tar|varer|duration)\\s+(?:about\\s+|ca\\.?\\s+|rundt\\s+)?(\\d{1,4})\\s*(min(?:utes?|utter)?|hours?|timer?|h|t)');
function readLeadAndDuration(s: string): { s: string; lead: number | null; dur: number | null } {
  let lead: number | null = null, dur: number | null = null;
  const a = matchAt(s, LEAD);
  if (a) { const n = +a.m[1] * UNIT_MIN(a.m[2]); if (n >= 0 && n <= 20160) { lead = n; s = a.rest; } }
  const b = matchAt(s, TAKES);
  if (b) { const n = +b.m[1] * UNIT_MIN(b.m[2]); if (n >= 1 && n <= 1440) { dur = n; s = b.rest; } }
  return { s, lead, dur };
}

function readAssignee(s: string, partner: string | null | undefined): { s: string; who: Assignee | null } {
  let r;
  if ((r = matchAt(s, W('for (?:both of us|us|oss|begge)|til (?:oss|begge)|for both')))) return { s: r.rest, who: 'both' };
  if ((r = matchAt(s, W('(?:for|to|til)\\s+(?:me|myself|meg|meg selv)')))) return { s: r.rest, who: 'me' };
  const who = '(?:my |min |mi )?(?:wife|husband|partner|girlfriend|boyfriend|kone|mann|samboer|kjæreste|kjerringa)';
  const name = partner && partner.trim().length >= 2 ? `|${esc(partner.trim())}` : '';
  if ((r = matchAt(s, W(`(?:ask|tell|remind|be)\\s+(?:${who}${name})\\s+(?:to|om å)?|(?:for|til)\\s+(?:${who}${name})|(?:${who}${name})\\s+(?:needs to|must|should|has to|skal|må|bør|burde)|(?:${who}${name})\\s*[:\\-]`)))) {
    return { s: r.rest, who: 'partner' };
  }
  return { s, who: null };
}

function parseSegment(seg: string, ctx: ParseContext, now: Date, today: string, quick: ReturnType<typeof quickDates>): { title: string; meta: Meta; there: boolean } {
  const meta = noMeta();
  // "on my way home from work" is about work, not home.
  const tg = extractTags(seg);
  meta.tags = tg.tags;
  let s = ` ${tg.text} `.replace(/(p\u00e5 vei|on my way) (?:hjem|home) (fra|from)/gi, '$1 $2');
  // "... there" / "... der" at the end points back at the place named just before.
  let there = false;
  s = s.replace(/\s+(?:der|there|dit)\s*[.!]?\s*$/i, () => { there = true; return ' '; });

  // Where: "when I leave work", "at the pharmacy", "kiwi". A place named only as a moment ("when I leave work") is a trigger;
  // when a shop is named too, the to-do belongs at the shop ("buy milk at kiwi on my way home from work").
  let shop: { place: Pl | null; category: string | null } | null = null;
  let trigger: { place: Pl | null; category: string | null; leaving: boolean } | null = null;
  for (let i = 0; i < 3; i++) {
    const f = findPlace(s, ctx.places);
    if (!f) break;
    const trig = new RegExp(`${TRIGGER}${f.re.source}`, 'iu');
    const t = trig.exec(s);
    const next = t ? s.replace(trig, ' ') : s.replace(f.re, ' ');
    if (next === s) break;
    s = next;
    if (t) trigger = trigger ?? { place: f.place, category: f.category, leaving: LEAVE_WORDS.test(t[0]) };
    else shop = shop ?? { place: f.place, category: f.category };
  }
  const where = shop ?? trigger;
  if (where) { meta.placeId = where.place?.id ?? null; meta.category = where.category; meta.leaving = !shop && !!trigger?.leaving; }

  for (const [re, rule] of REPEATS) { const r = matchAt(s, re); if (r) { meta.repeat_rule = rule; s = r.rest; break; } }

  const a = readAssignee(s, ctx.partnerName);
  s = a.s; meta.assignee = a.who;
  const ld = readLeadAndDuration(s);
  s = ld.s; meta.remind_before = ld.lead; meta.duration_min = ld.dur;
  const pr = readPriority(s);
  s = pr.s; meta.priority = pr.priority;

  const d = readDate(s, today, quick);
  s = d.s;
  const t = readTime(s, !!d.date);
  s = t.s;
  meta.due_on = d.date;
  meta.due_time = t.time;
  if (t.time && !meta.due_on) {
    // "at 07:00" said late in the evening means tomorrow, but "before 21:00" is still today.
    const nowT = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    meta.due_on = t.explicit && !t.deadline && t.time < nowT ? addDays(today, 1) : today;
  }
  return { title: cleanTitle(s), meta, there };
}

const LIST_HEAD = /^(?:(?:shopping|grocery|groceries|shop)\s+list|handleliste(?:n)?|handlekurv)\s*[:\-\u2013]?\s*/i;
const SHOP_VERB = /^(buy|get|grab|purchase|pick up|kj\u00f8p|kj\u00f8pe|handle|hent|ta med)\s+/i;
const PLAIN_BUY = /^(?:buy|purchase|kj\u00f8p|kj\u00f8pe|handle)$/i;
const ACTION_START = /^(?:call|ring|book|bestill|clean|vask|fix|fiks|pay|betal|send|check|sjekk|take|ta|pick|hent|visit|meet|finish|do|make)\b/i;

/** "buy milk, eggs and bread" or "shopping list: milk, eggs, bread" becomes one item each (the place and date stay with every item).
 *  Only for shopping: a buying verb or a list heading, or a place was named. "buy milk and call mum" stays one to-do. */
export function expandList(title: string, hasPlace: boolean): string[] {
  let rest = title;
  let listed = false;
  const head = rest.match(LIST_HEAD);
  if (head) { rest = rest.slice(head[0].length); listed = true; }
  else {
    const verb = rest.match(SHOP_VERB);
    if (!verb) return [title];
    if (!hasPlace && !PLAIN_BUY.test(verb[1])) return [title];
    rest = rest.slice(verb[0].length);
    listed = true;
  }
  if (!listed) return [title];
  const items = rest.split(/\s*,\s*|\s+(?:and|og|&)\s+/i).map((x) => x.trim().replace(/[.;:]+$/, '')).filter(Boolean);
  if (items.length < 2 || items.some((i) => i.split(/\s+/).length > 4 || ACTION_START.test(i))) return [title];
  return items.map((i) => i.replace(/^(\p{Ll}+)(?=\s|$)/u, (w) => w[0].toLocaleUpperCase('nb') + w.slice(1)));
}

/** One line typed into a place's own list: "milk, eggs and bread" is three items; anything else stays as written. */
export function splitShoppingLine(line: string): string[] {
  const items = expandList(SHOP_VERB.test(line) || LIST_HEAD.test(line) ? line : `buy ${line}`, true);
  return items.length > 1 ? items : [line];
}

/** Splits free text into to-dos and pulls out place, day, time, repeat and who it is for. Plain text comes back as plain to-dos. */
export function parseTasks(text: string, ctx: ParseContext): ParsedTask[] {
  const now = ctx.now ?? new Date();
  const today = todayISO(now);
  const quick = quickDates(now);
  // "...hjem.Jeg må..." (no space after the full stop) is two sentences too.
  const segs = text.replace(/([a-z\u00e6\u00f8\u00e5)])\.(?=[A-Z\u00c6\u00d8\u00c5])/g, '$1. ').split(SPLIT).map((x) => x?.trim()).filter((x): x is string => !!x);
  const parts = segs.map((seg) => parseSegment(seg, ctx, now, today, quick));

  const fill = (to: Meta, from: Meta) => {
    for (const k of Object.keys(from) as (keyof Meta)[]) {
      if (k === 'leaving') { if (from.leaving && !to.leaving && !to.placeId) to.leaving = true; continue; }
      if (k === 'tags') { to.tags = [...new Set([...to.tags, ...from.tags])]; continue; }
      if (k === 'priority') { if (!to.priority && from.priority) to.priority = from.priority; continue; }
      if (to[k] == null && from[k] != null) (to as Record<string, unknown>)[k] = from[k];
    }
  };

  const out: { title: string; meta: Meta; there: boolean }[] = [];
  let carry: Meta | null = null; // "later today" on its own applies to the next to-do
  const BARE_SHOP = /^(?:handle(?: inn)?|buy|shop|shopping|go shopping|do the (?:grocery )?shopping|kj\u00f8p|g\u00e5 og handle)$/i;
  for (const [i, p] of parts.entries()) {
    // "Handle på kiwi." with the list in the next sentence: the place and time carry over to that sentence.
    const bare = p.title.replace(/\s+(?:p\u00e5 vei(?: hjem)? fra|on my way(?: home)? from)(?:\s+\S+){1,2}$/i, '');
    if (BARE_SHOP.test(bare) && i < parts.length - 1 && hasMeta(p.meta)) p.title = '';
    if (!p.title && hasMeta(p.meta)) {
      if (carry) fill(carry, p.meta); else carry = { ...p.meta };
      continue;
    }
    if (!p.title) continue;
    if (out.length > 0 && PRONOUN.test(p.title)) { fill(out[out.length - 1].meta, p.meta); continue; } // "do that before 21.00"
    if (carry) { fill(p.meta, carry); carry = null; }
    const prev = out[out.length - 1];
    if (p.there && prev && !p.meta.placeId && !p.meta.category) { p.meta.placeId = prev.meta.placeId; p.meta.category = prev.meta.category; }
    out.push(p);
  }
  if (carry && out.length > 0) fill(out[out.length - 1].meta, carry);
  return out.flatMap((p) => expandList(p.title, !!(p.meta.placeId || p.meta.category)).map((title) => ({ title, ...p.meta })));
}

/** True when the parse found something worth showing (a date, a place, several to-dos...), not just the text again. */
export const isInteresting = (tasks: ParsedTask[]) => tasks.length > 1 || tasks.some(hasMeta);
