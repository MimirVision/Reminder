import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, buildIcs, daysBetween, digestText, escapeText, fold, loadFeed, placeText, scheduleText, todayIn } from './feed.mjs';

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

test('schedule text', () => {
  assert.equal(scheduleText(feed.tasks[0]), 'every year, Sep-Oct');
  assert.equal(scheduleText(feed.tasks[1]), 'every 3 months');
  assert.equal(scheduleText(feed.tasks[2]), 'every year');
});

test('ics escaping and folding', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\;c\\\\d\\ne');
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
