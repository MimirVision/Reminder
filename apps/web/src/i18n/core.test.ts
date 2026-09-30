import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, dictionaries, interpolate, makeT, makeTN, translate } from './core.ts';

const { en, nb } = dictionaries;

test('language detection prefers Norwegian variants, otherwise English', () => {
  assert.equal(detectLang(['nb-NO', 'en']), 'nb');
  assert.equal(detectLang(['nn']), 'nb');
  assert.equal(detectLang(['no']), 'nb');
  assert.equal(detectLang(['en-GB']), 'en');
  assert.equal(detectLang(['de-DE', 'nb']), 'nb', 'first supported language wins');
  assert.equal(detectLang(['de-DE']), 'en', 'unsupported falls back to English');
  assert.equal(detectLang([]), 'en');
});

test('placeholders and plurals', () => {
  assert.equal(interpolate('Hi {name}, {n} left', { name: 'Ola', n: 3 }), 'Hi Ola, 3 left');
  assert.equal(interpolate('Hi {name}', {}), 'Hi {name}', 'unknown placeholder is left visible');
  assert.equal(makeT('nb')('nav.todo'), 'Oppgaver');
  assert.equal(makeT('en')('nav.todo'), 'To-do');
  assert.equal(translate('nb', 'time.min', { n: 5 }), 'for 5 min siden');
});

test('every English key has a Norwegian translation and vice versa', () => {
  assert.deepEqual(Object.keys(nb).sort(), Object.keys(en).sort());
});

test('no empty strings, and placeholders match between languages', () => {
  const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const k of Object.keys(en) as (keyof typeof en)[]) {
    assert.ok(en[k].trim() !== '' && nb[k].trim() !== '', `empty text for ${k}`);
    assert.equal(slots(nb[k]), slots(en[k]), `placeholders differ for ${k}: "${en[k]}" vs "${nb[k]}"`);
  }
});

test('every plural base has both forms in both languages', () => {
  const bases = Object.keys(en).filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4));
  for (const b of bases) for (const l of [en, nb] as Record<string, string>[]) {
    assert.ok(`${b}_one` in l && `${b}_other` in l, `plural forms missing for ${b}`);
  }
  for (const k of Object.keys(en)) if (k.endsWith('_other')) assert.ok(`${k.slice(0, -6)}_one` in en, `${k} has no _one`);
  void makeTN;
});
