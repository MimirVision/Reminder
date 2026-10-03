import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, buildIcs, daysBetween, digestText, escapeText, fold, loadFeed, pickLang, placeText, scheduleText, taskTitle, todayIn, todayText } from './feed.mjs';

const feed = {
  household: 'Home',
  generated_at: '2026-09-30T08:00:00Z',
  places: [
    { id: 'p1', name: 'Any pharmacy (apotek)', kind: 'category', category: 'pharmacy', radius_m: 150 },
    { id: 'p2', name: 'IKEA Furuset', kind: 'fixed', category: 'hardware', radius_m: 300 },
    { id: 'p3', name: 'Byggmax', kind: 'fixed', category: 'hardware', radius_m: 200 },
  ],
  todos: [
    { id: 't1', body: 'Buy plasters', place_id: 'p1', created_at: '2026-09-29' },
    { id: 't2', body: 'Bookshelf, white\nsecond line ignored', place_id: 'p2', created_at: '2026-09-28' },
    { id: 't3', body: 'LED bulbs E27', place_id: 'p2', created_at: '2026-09-27' },
    { id: 't4', body: 'Order wood stain', place_id: null, created_at: '2026-09-26' },
    { id: 't5', body: '', place_id: 'p3', created_at: '2026-09-25' },
  ],
  tasks: [
    { id: 'k1', title: 'Clean gutters, front & back', notes: 'Check brackets; joints', schedule: 'seasonal', interval_months: null, window_start_month: 9, window_end_month: 10, next_due_at: '2026-09-01', due_until: '2026-10-31', last_done_at: null },
    { id: 'k2', title: 'Test smoke detectors', notes: null, schedule: 'interval', interval_months: 3, window_start_month: null, window_end_month: null, next_due_at: '2026-10-05', due_until: null, last_done_at: '2026-07-05' },
    { id: 'k3', title: 'Service boiler', notes: null, schedule: 'interval', interval_months: 12, window_start_month: null, window_end_month: null, next_due_at: '2027-03-01', due_until: null, last_done_at: null },
  ],
  facts: [{ title: 'Hallway bulbs', value: 'E27, 3000 K\nsecond', surface_at: ['hardware'] }, { title: 'Bedroom paint', value: 'NCS S0502-Y', surface_at: ['paint'] }],
};

test('dates in Oslo time and day arithmetic', () => {
  assert.equal(todayIn('Europe/Oslo', new Date('2026-09-30T22:30:00Z')), '2026-10-01', 'after midnight in Oslo');
  assert.equal(todayIn('UTC', new Date('2026-09-30T22:30:00Z')), '2026-09-30');
  assert.equal(daysBetween('2026-09-30', '2026-10-05'), 5);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('place text: by category, by name, several places, empty cases', () => {
  assert.equal(placeText(feed, { category: 'pharmacy' }), '1 to-do at Any pharmacy (apotek):\n- Buy plasters');
  const ikea = placeText(feed, { place: 'ikea' });
  assert.match(ikea, /^2 to-dos at IKEA Furuset:\n- Bookshelf, white\n- LED bulbs E27/);
  assert.doesNotMatch(ikea, /second line ignored/, 'only the first line of a to-do');
  assert.match(ikea, /Useful here:\n- Hallway bulbs: E27, 3000 K$/, 'facts tagged for this kind of shop, first line only');
  const hardware = placeText(feed, { category: 'hardware' });
  assert.match(hardware, /^3 to-dos at hardware:/, 'two places of one kind are labelled by the kind');
  assert.match(hardware, /- \(photo\)/, 'empty text shows as (photo)');
  assert.equal(placeText(feed, { place: 'nowhere' }), '');
  assert.equal(placeText(feed, {}), '');
  assert.equal(placeText({ ...feed, todos: [] }, { place: 'ikea' }), '', 'nothing to do there -> no notification');
});

test('place text caps long lists', () => {
  const many = { ...feed, todos: Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, body: `item ${i}`, place_id: 'p2', created_at: '' })) };
  const t = placeText(many, { place: 'ikea' });
  assert.match(t, /^12 to-dos at IKEA Furuset:/);
  assert.equal(t.split('\n').filter((l) => l.startsWith('- item')).length, 8);
  assert.match(t, /\+ 4 more/);
});

test('digest: due now, coming up, waiting to-dos', () => {
  const d = digestText(feed, { tz: 'Europe/Oslo', now: new Date('2026-09-30T09:00:00Z') });
  assert.equal(d, 'Home Memory\nDue now: Clean gutters, front & back\nComing up: Test smoke detectors (in 5 days)\nTo-dos: 5 waiting (1 anytime, 4 at places)');
  assert.equal(digestText({ ...feed, tasks: [], todos: [] }), '', 'nothing to say -> empty');
  const far = digestText({ ...feed, todos: [] }, { now: new Date('2026-06-01T09:00:00Z') });
  assert.equal(far, '', 'nothing due or soon and no to-dos: no notification that week');
  const soonOnly = digestText({ ...feed, todos: [] }, { now: new Date('2026-09-20T09:00:00Z') });
  assert.equal(soonOnly, 'Home Memory\nDue now: Clean gutters, front & back\nComing up: Test smoke detectors (in 2 weeks)');
});

const dated = {
  ...feed,
  places: [...feed.places, { id: 'p9', name: 'Kiwi Myren', kind: 'fixed', category: 'grocery', radius_m: 150, address: 'Myrens veg 5, 0473 Oslo' }],
  todos: [
    { id: 'd1', body: 'Buy milk\nand bread', place_id: 'p9', created_at: '', due_on: '2026-09-30', due_time: '18:00:00' },
    { id: 'd2', body: 'Call the plumber', place_id: null, created_at: '', due_on: '2026-09-30', due_time: null },
    { id: 'd3', body: 'Earlier job', place_id: null, created_at: '', due_on: '2026-09-28', due_time: '09:30:00' },
    { id: 'd4', body: 'Next week', place_id: null, created_at: '', due_on: '2026-10-07', due_time: null },
    { id: 'd5', body: 'Undated', place_id: null, created_at: '' },
  ],
};

test('today text lists what is due today and earlier, timed first, empty when nothing', () => {
  const now = new Date('2026-09-30T07:00:00Z');
  assert.equal(todayText(dated, { now }), '3 to-dos for today:\n- 09:30 Earlier job\n- Call the plumber\n- 18:00 Buy milk');
  assert.equal(todayText({ ...dated, todos: [dated.todos[3], dated.todos[4]] }, { now }), '', 'nothing due -> no notification');
  assert.equal(todayText(feed, { now }), '', 'feed without dates');
});

test('digest mentions what is due today', () => {
  const d = digestText(dated, { now: new Date('2026-09-30T07:00:00Z') });
  assert.match(d, /Due today: Earlier job, Call the plumber, Buy milk/);
});

test('ics has events for dated to-dos: timed ones alert at their time', () => {
  const ics = buildIcs(dated, { now: new Date('2026-09-30T08:15:30Z') });
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3 + 4, 'three house tasks + four dated to-dos');
  assert.match(ics, /UID:todo-d1@homememory/);
  assert.match(ics, /DTSTART:20260930T180000\r\nDTEND:20260930T183000/, 'timed: floating local time, 30 minutes');
  assert.match(ics, /LOCATION:Kiwi Myren\\, Myrens veg 5\\, 0473 Oslo/, 'place name and address');
  assert.match(ics, /SUMMARY:Buy milk\r\n/, 'first line only');
  assert.match(ics, /DTSTART;VALUE=DATE:20260930\r\nDTEND;VALUE=DATE:20261001\r\nSUMMARY:Call the plumber/, 'all-day to-do');
  assert.match(ics, /TRIGGER:PT0S/);
  assert.doesNotMatch(ics, /todo-d5@/, 'undated to-dos are not in the calendar');
});

test('a timed to-do late in the evening does not spill wrongly across midnight', () => {
  const late = { ...dated, todos: [{ id: 'z', body: 'Late', place_id: null, created_at: '', due_on: '2026-12-31', due_time: '23:45' }] };
  assert.match(buildIcs(late), /DTSTART:20261231T234500\r\nDTEND:20270101T001500/);
});

test('schedule text', () => {
  assert.equal(scheduleText(feed.tasks[0]), 'every year, Sep-Oct');
  assert.equal(scheduleText(feed.tasks[1]), 'every 3 months');
  assert.equal(scheduleText(feed.tasks[2]), 'every year');
});

test('ics escaping and folding', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = 'SUMMARY:' + 'æ'.repeat(60);
  const folded = fold(long);
  for (const part of folded.split('\r\n')) assert.ok(new TextEncoder().encode(part).length <= 75, `line too long: ${part.length}`);
  assert.equal(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join(''), long, 'unfolds back to the original');
  assert.equal(fold('short'), 'short');
});

test('ics has one event per task with a window and an alert', () => {
  const ics = buildIcs(feed, { now: new Date('2026-09-30T08:15:30.123Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.match(ics, /DTSTAMP:20260930T081530Z/);
  assert.match(ics, /UID:task-k1@homememory/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260901\r\nDTEND;VALUE=DATE:20261101/, 'season window ends the day after due_until');
  assert.match(ics, /DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006/, 'a single day for interval tasks');
  assert.match(ics, /SUMMARY:Clean gutters\\, front & back/);
  assert.match(ics, /TRIGGER:PT9H/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
  assert.doesNotMatch(ics, /[^\r]\n/, 'CRLF line endings only');
});

test('loadFeed sends only the apikey header and maps outcomes', async () => {
  const seen = [];
  const ok = await loadFeed({ url: 'https://x.supabase.co/', anonKey: 'sb_publishable_k', key: 'hmr_a', fetchImpl: async (u, init) => { seen.push([u, init]); return Response.json(feed); } });
  assert.equal(ok.status, 'ok');
  assert.equal(seen[0][0], 'https://x.supabase.co/rest/v1/rpc/reminder_feed');
  assert.deepEqual(Object.keys(seen[0][1].headers).sort(), ['Content-Type', 'apikey']);
  assert.equal(JSON.parse(seen[0][1].body).p_key, 'hmr_a');
  assert.equal((await loadFeed({ url: 'u', anonKey: 'k', key: 'x', fetchImpl: async () => Response.json(null) })).status, 'invalid');
  assert.equal((await loadFeed({ url: 'u', anonKey: 'k', key: 'x', fetchImpl: async () => new Response('no', { status: 500 }) })).status, 'error');
  assert.equal((await loadFeed({ url: 'u', anonKey: 'k', key: 'x', fetchImpl: async () => { throw new Error('offline'); } })).status, 'error');
});

test('the language comes from ?lang and defaults to English', () => {
  assert.equal(pickLang('nb'), 'nb');
  assert.equal(pickLang('NB-no'), 'nb');
  assert.equal(pickLang('no'), 'nb');
  assert.equal(pickLang('en'), 'en');
  assert.equal(pickLang(null), 'en');
  assert.equal(pickLang('fr'), 'en');
});

test('Norwegian notification text: places, digest, today, schedules', () => {
  const now = new Date('2026-09-30T08:00:00Z');
  const p = placeText(feed, { category: 'hardware', lang: 'nb' });
  assert.match(p, /^3 oppgaver hos hardware:/);
  assert.match(p, /Nyttig her:/);
  assert.match(placeText(feed, { category: 'pharmacy', lang: 'nb' }), /^1 oppgave hos Any pharmacy \(apotek\):/);
  const d = digestText(feed, { now, lang: 'nb' });
  assert.match(d, /Aktuelt nå: /);
  assert.match(d, /Kommer snart: .*\(om 5 dager\)/);
  assert.match(d, /Oppgaver: 5 venter \(1 når som helst, 4 på steder\)/);
  const withDue = { ...feed, todos: [{ id: 'd1', body: 'Ring rørlegger', place_id: null, created_at: '2026-09-29', due_on: '2026-09-30', due_time: '18:00:00' }] };
  assert.equal(todayText(withDue, { now, lang: 'nb' }), '1 oppgave i dag:\n- 18:00 Ring rørlegger');
  assert.equal(scheduleText({ schedule: 'seasonal', window_start_month: 9, window_end_month: 10 }, 'nb'), 'hvert år, sep-okt');
  assert.equal(scheduleText({ schedule: 'interval', interval_months: 24 }, 'nb'), 'hvert 2. år');
  assert.equal(scheduleText({ schedule: 'interval', interval_months: 3 }), 'every 3 months');
});

test('house template tasks are translated by their key; your own tasks are left alone', () => {
  const t = { template_key: 'gutters_autumn', title: 'Clean gutters and downpipes', notes: 'x' };
  assert.equal(taskTitle(t, 'nb'), 'Rens takrenner og nedløpsrør');
  assert.equal(taskTitle(t, 'en'), 'Clean gutters and downpipes');
  assert.equal(taskTitle({ template_key: null, title: 'Oil the terrace' }, 'nb'), 'Oil the terrace');
  assert.equal(taskTitle({ template_key: 'unknown_key', title: 'Mine' }, 'nb'), 'Mine');
  const ics = buildIcs({ ...feed, tasks: [{ ...feed.tasks[0], template_key: 'gutters_autumn' }] }, { now: new Date('2026-09-30T08:00:00Z'), lang: 'nb' });
  assert.match(ics, /SUMMARY:Rens takrenner og nedløpsrør/);
  assert.match(ics, /DESCRIPTION:hvert år\\, sep-okt\. Ikke gjort ennå\./);
});

test('repeating to-dos become repeating calendar events; the digest mentions what was finished this week', () => {
  const f = { ...feed, done_week: 7, todos: [{ id: 'r1', body: 'Bins', place_id: null, created_at: '2026-09-29', due_on: '2026-10-06', due_time: '07:30:00', repeat_rule: 'weekly' }, { id: 'r2', body: 'Once', place_id: null, created_at: '2026-09-29', due_on: '2026-10-07', due_time: null, repeat_rule: null }] };
  const ics = buildIcs(f, { now: new Date('2026-09-30T08:00:00Z') });
  assert.equal((ics.match(/RRULE:FREQ=WEEKLY/g) ?? []).length, 1, 'only the repeating one has a rule');
  assert.match(ics, /UID:todo-r1@homememory[\s\S]*?RRULE:FREQ=WEEKLY[\s\S]*?SUMMARY:Bins/);
  const now = new Date('2026-09-30T08:00:00Z');
  assert.match(digestText(f, { now }), /Done this week: 7$/);
  assert.match(digestText(f, { now, lang: 'nb' }), /Ferdig denne uken: 7$/);
  assert.doesNotMatch(digestText({ ...f, done_week: 0 }, { now }), /Done this week/);
});

test('weekdays and every-other-week become the matching calendar rules', () => {
  const f = { ...feed, todos: ['weekdays', 'biweekly'].map((r, i) => ({ id: `x${i}`, body: r, place_id: null, created_at: '2026-09-29', due_on: '2026-10-06', due_time: null, repeat_rule: r })) };
  const ics = buildIcs(f, { now: new Date('2026-09-30T08:00:00Z') });
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=2/);
});
