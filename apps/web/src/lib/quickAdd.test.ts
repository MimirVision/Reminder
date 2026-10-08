import test from 'node:test';
import assert from 'node:assert/strict';
import { isInteresting, parseTasks, splitShoppingLine, type ParseContext } from './quickAdd.ts';

// Thursday 1 Oct 2026, 14:30
const now = new Date(2026, 9, 1, 14, 30);
const places: ParseContext['places'] = [
  { id: 'work', name: 'Jobb Aker Brygge', kind: 'fixed', category: null },
  { id: 'kiwi', name: 'Kiwi Myren', kind: 'fixed', category: 'grocery' },
  { id: 'home', name: 'Home', kind: 'fixed', category: null },
];
const ctx: ParseContext = { places, partnerName: 'Kari', now };
const one = (text: string, c = ctx) => { const r = parseTasks(text, c); assert.equal(r.length, 1, JSON.stringify(r)); return r[0]; };

test('plain text stays plain', () => {
  const t = one('buy milk');
  assert.equal(t.title, 'Buy milk');
  assert.deepEqual([t.due_on, t.due_time, t.placeId, t.category, t.assignee], [null, null, null, null, null]);
  assert.equal(isInteresting([t]), false);
});

test('tomorrow with a deadline time and a saved shop', () => {
  const t = one('buy milk at kiwi tomorrow before 18:00');
  assert.deepEqual([t.title, t.due_on, t.due_time, t.placeId], ['Buy milk', '2026-10-02', '18:00', 'kiwi']);
});

test('norwegian: i morgen, kl, apotek', () => {
  const t = one('husk å hente resept på apoteket i morgen kl 10');
  assert.deepEqual([t.title, t.due_on, t.due_time, t.category], ['Hente resept', '2026-10-02', '10:00', 'pharmacy']);
});

test('a saved kind-of-shop place is reused instead of a new category', () => {
  const t = one('buy ibuprofen at the pharmacy', { ...ctx, places: [...places, { id: 'ph', name: 'Any pharmacy', kind: 'category', category: 'pharmacy' }] });
  assert.deepEqual([t.placeId, t.category], ['ph', null]);
});

test('"paint the fence" is not a shop', () => {
  const t = one('paint the fence');
  assert.deepEqual([t.category, t.placeId], [null, null]);
});

test('weekdays are the next one, never today', () => {
  assert.equal(one('call the plumber on wednesday').due_on, '2026-10-07');
  assert.equal(one('ring rørlegger fredag').due_on, '2026-10-02');
});

test('times: pm, bare at, rolled to tomorrow when already past', () => {
  assert.equal(one('call mum at 6pm today').due_time, '18:00');
  const early = one('wake the kids at 07:00');
  assert.deepEqual([early.due_on, early.due_time], ['2026-10-02', '07:00']);
  const late = one('finish report before 21.00');
  assert.deepEqual([late.due_on, late.due_time], ['2026-10-01', '21:00']);
});

test('repeat', () => {
  const t = one('water the plants every week on friday');
  assert.deepEqual([t.repeat_rule, t.due_on], ['weekly', '2026-10-02']);
  assert.equal(one('betal husleie hver måned').repeat_rule, 'monthly');
});

test('who it is for', () => {
  assert.equal(one('take out the bins for Kari').assignee, 'partner');
  assert.equal(one('ask my wife to book the dentist').assignee, 'partner');
  assert.equal(one('Kari: pick up the kids').assignee, 'partner');
  assert.equal(one('fix the shelf for me').assignee, 'me');
  assert.equal(one('book a table for both of us on friday').assignee, 'both');
});

test('the long sentence: several to-dos, a leave-work trigger and a deadline for "that"', () => {
  const r = parseTasks('I need to pick up the parcel at that store when I leave work and then later today I need to do the taxes, I need to do that before 21.00', ctx);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].title, r[0].placeId, r[0].leaving, r[0].due_on], ['Pick up the parcel at that store', 'work', true, null]);
  assert.deepEqual([r[1].title, r[1].due_on, r[1].due_time], ['Do the taxes', '2026-10-01', '21:00']);
});

test('a list on separate lines and "then" splits', () => {
  const r = parseTasks('buy bread\nbuy eggs then call dad tomorrow', ctx);
  assert.deepEqual(r.map((t) => t.title), ['Buy bread', 'Buy eggs', 'Call dad']);
  assert.equal(r[2].due_on, '2026-10-02');
  assert.equal(isInteresting(r), true);
});

test('norwegian multi-task with når jeg forlater jobben', () => {
  const r = parseTasks('jeg må hente pakken når jeg forlater jobben, og så må jeg ringe tannlegen i dag før kl 16', ctx);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].title, r[0].placeId, r[0].leaving], ['Hente pakken', 'work', true]);
  assert.deepEqual([r[1].title, r[1].due_on, r[1].due_time], ['Ringe tannlegen', '2026-10-01', '16:00']);
});

test('an unknown place stays in the text rather than being lost', () => {
  const t = one('buy a drill at biltema');
  assert.equal(t.title, 'Buy a drill at biltema');
  assert.equal(t.placeId, null);
});

test('quantities are not times', () => {
  const t = one('buy 2 kg potatoes');
  assert.equal(t.due_time, null);
  assert.equal(one('get at 3 kg of flour').due_time, null);
});

test('empty and junk input', () => {
  assert.deepEqual(parseTasks('', ctx), []);
  assert.deepEqual(parseTasks('   \n  ', ctx), []);
});

test('a shopping list: items split, place and day stay with each', () => {
  const r = parseTasks('buy milk, eggs and bread at kiwi tomorrow', ctx);
  assert.deepEqual(r.map((t) => t.title), ['Milk', 'Eggs', 'Bread']);
  assert.ok(r.every((t) => t.placeId === 'kiwi' && t.due_on === '2026-10-02'));
  const nb = parseTasks('handleliste: melk, egg og brød på kiwi', ctx);
  assert.deepEqual(nb.map((t) => t.title), ['Melk', 'Egg', 'Brød']);
  assert.ok(nb.every((t) => t.placeId === 'kiwi'));
  assert.deepEqual(parseTasks('buy paint and brushes', ctx).map((t) => t.title), ['Paint', 'Brushes']);
  assert.equal(isInteresting(parseTasks('buy milk, eggs', ctx)), true);
});

test('lists are only split for shopping, and never when an item is really another task', () => {
  assert.equal(parseTasks('buy milk and call mum', ctx).length, 1);
  assert.equal(parseTasks('pick up the kids and the dog', ctx).length, 1);
  assert.equal(parseTasks('buy a new vacuum cleaner for the whole house and garage today', ctx).length, 1);
  const two = parseTasks('buy milk, eggs. then call dad tomorrow', ctx);
  assert.deepEqual(two.map((t) => t.title), ['Milk', 'Eggs', 'Call dad']);
});

test('a line typed into a place list', () => {
  assert.deepEqual(splitShoppingLine('milk, eggs and bread'), ['Milk', 'Eggs', 'Bread']);
  assert.deepEqual(splitShoppingLine('buy milk and bread'), ['Milk', 'Bread']);
  assert.deepEqual(splitShoppingLine('call the plumber and ask about the tap'), ['call the plumber and ask about the tap']);
  assert.deepEqual(splitShoppingLine('2 kg potatoes'), ['2 kg potatoes']);
});

test('norwegian: no space after the full stop, "der" points at the place, "på vei hjem fra jobb" is leaving work', () => {
  const r = parseTasks('Handle på kiwi på vei hjem fra jobb.Jeg må handle melk, mel, yoghurt og tomater der', ctx);
  assert.deepEqual(r.map((t) => t.title), ['Melk', 'Mel', 'Yoghurt', 'Tomater']);
  assert.ok(r.every((t) => t.placeId === 'kiwi'));
  const w = parseTasks('hente pakken etter jeg er ferdig på jobb', ctx);
  assert.deepEqual([w[0].placeId, w[0].leaving, w[0].title], ['work', true, 'Hente pakken']);
  const h = parseTasks('buy bread on my way home from work', ctx);
  assert.deepEqual([h[0].placeId, h[0].leaving], ['work', true]);
});

test('the sentence from real use: shop named, work not saved', () => {
  const c: ParseContext = { ...ctx, places: [{ id: 'meny', name: 'Meny Saga', kind: 'fixed', category: 'grocery' }, { id: 'home', name: 'Home', kind: 'fixed', category: null }] };
  const r = parseTasks('Handle på meny saga på vei hjem fra jobb.Jeg må handle melk, mel, yoghurt og tomater der', c);
  assert.deepEqual(r.map((t) => t.title), ['Melk', 'Mel', 'Yoghurt', 'Tomater']);
  assert.ok(r.every((t) => t.placeId === 'meny'), JSON.stringify(r));
});

test('priority and the new repeat rules', () => {
  assert.equal(one('pay the electricity bill !!! tomorrow').priority, 3);
  assert.equal(one('urgent: call the plumber').priority, 3);
  assert.equal(one('haster: ring tannlegen').priority, 3);
  assert.equal(one('book dentist p2').priority, 2);
  assert.equal(one('sort the garage low priority').priority, 1);
  assert.equal(one('buy milk!').priority, 0, 'a single exclamation mark is just punctuation');
  assert.equal(one('take the bins out every weekday').repeat_rule, 'weekdays');
  assert.equal(one('ta ut søpla på hverdager').repeat_rule, 'weekdays');
  assert.equal(one('water the plants every other week').repeat_rule, 'biweekly');
  assert.equal(one('støvsuge annenhver uke').repeat_rule, 'biweekly');
  assert.equal(one('water the plants every week').repeat_rule, 'weekly');
  assert.equal(one('urgent: call the plumber').title, 'Call the plumber');
});

test('#tags are read and left out of the title', async () => {
  const { parseTasks } = await import('./quickAdd.ts');
  const r = parseTasks('buy light bulbs #house #Errands tomorrow', { places: [], now: new Date(2026, 9, 1, 9, 0) });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].tags, ['house', 'errands']);
  assert.ok(!r[0].title.includes('#'));
  assert.equal(r[0].due_on, '2026-10-02');
});

test('remind-me-before and how long it takes are read', async () => {
  const { parseTasks } = await import('./quickAdd.ts');
  const now = new Date(2026, 9, 1, 9, 0);
  const a = parseTasks('dentist tomorrow at 14:00, remind me 30 min before, takes 45 min', { places: [], now });
  assert.equal(a.length, 1);
  assert.equal(a[0].remind_before, 30);
  assert.equal(a[0].duration_min, 45);
  assert.equal(a[0].due_time, '14:00');
  assert.equal(a[0].title, 'Dentist');
  const b = parseTasks('tannlege i morgen kl 14:00 påminn meg 1 time før', { places: [], now });
  assert.equal(b[0].remind_before, 60);
  const c = parseTasks('pay the bill 2 days before', { places: [], now });
  assert.equal(c[0].remind_before, 2880);
});

test('"when I leave home" is a real leave trigger at that place', async () => {
  const { parseTasks } = await import('./quickAdd.ts');
  const places = [{ id: 'home', name: 'Home', kind: 'fixed' as const, category: null }];
  const a = parseTasks('remember to buy diapers when I leave home', { places, now: new Date(2026, 9, 8, 9, 0) });
  assert.equal(a.length, 1);
  assert.equal(a[0].placeId, 'home');
  assert.equal(a[0].leaving, true);
  assert.equal(a[0].title, 'Buy diapers');
});
