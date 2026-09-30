import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, findingToTodo, type Finding } from '../functions/import-report/logic.ts';

const f = (over: Partial<Finding> = {}) => ({
  title: 'Bytt tak', part: 'Tak', tg: 'TG3', what: 'Råte i taktro.', action: 'Skift taktekking.', horizon: 'now',
  estimate_nok_min: 150000, estimate_nok_max: 250000, ...over,
});

test('clean keeps valid findings, sorts by seriousness and normalises the year', () => {
  const r = clean({ build_year: 1974, summary: ' Eldre bolig. ', findings: [f({ tg: 'TG2', title: 'B' }), f({ tg: 'TG3', title: 'A' }), f({ tg: 'TGIU', title: 'C' })] });
  assert.deepEqual(r?.findings.map((x) => x.title), ['A', 'C', 'B']);
  assert.equal(r?.build_year, 1974);
  assert.equal(r?.summary, 'Eldre bolig.');
  assert.equal(clean({ build_year: 0, summary: '', findings: [] })?.build_year, null);
});

test('clean drops junk and enforces enums and limits', () => {
  const r = clean({ build_year: 3000, summary: 'x', findings: [
    f({ tg: 'TG1' as never }), f({ title: '   ' }), null, 'x', f({ horizon: 'someday' as never }),
    f({ title: 'y'.repeat(500) }), f({ estimate_nok_min: -5, estimate_nok_max: 1e12 }),
  ] });
  assert.equal(r?.build_year, null);
  assert.equal(r?.findings.length, 3, 'TG1, blank title and non-objects are dropped');
  assert.equal(r?.findings.find((x) => x.title.startsWith('y'))?.title.length, 140);
  assert.equal(r?.findings.find((x) => x.horizon === 'unknown') !== undefined, true);
  const money = r?.findings.find((x) => x.estimate_nok_min === 0 && x.estimate_nok_max === 0);
  assert.ok(money, 'nonsense costs become 0, never invented');
});

test('clean caps the number of findings and rejects non-reports', () => {
  assert.equal(clean({ build_year: 2000, summary: '', findings: Array.from({ length: 100 }, () => f()) })?.findings.length, 60);
  for (const junk of [null, 'x', 3, {}, { findings: 'no' }]) assert.equal(clean(junk), null);
});

test('max is never below min', () => {
  const r = clean({ build_year: 0, summary: '', findings: [f({ estimate_nok_min: 50000, estimate_nok_max: 10000 })] });
  assert.deepEqual([r?.findings[0].estimate_nok_min, r?.findings[0].estimate_nok_max], [50000, 50000]);
});

test('findingToTodo writes a readable to-do', () => {
  assert.equal(findingToTodo(f() as Finding), 'Bytt tak\nTG3 · Tak · do soon · 150 000–250 000 kr\nSkift taktekking. Råte i taktro.');
  assert.equal(
    findingToTodo(f({ horizon: '3-5 years', estimate_nok_min: 0, estimate_nok_max: 0, action: '', part: '' }) as Finding),
    'Bytt tak\nTG3 · within 3-5 years\nRåte i taktro.',
  );
  assert.match(findingToTodo(f({ estimate_nok_min: 20000, estimate_nok_max: 20000, horizon: 'unknown' }) as Finding), /~20 000 kr/);
});
