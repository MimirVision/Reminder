import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS, ACCOUNT_COLOURS, DEFAULT_SETTINGS, accountColour, loadSettings, themeVars } from './settings.ts';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('there are 8 accents and each is readable on both grounds and with text on top', () => {
  assert.equal(ACCENTS.length, 8);
  for (const a of ACCENTS) {
    assert.ok(ratio(a.light, '#FFFFFF') >= 4.5, `${a.id} light on white ${ratio(a.light, '#FFFFFF').toFixed(2)}`);
    assert.ok(ratio(a.light, '#F2F3F5') >= 4.2, `${a.id} light on grey ${ratio(a.light, '#F2F3F5').toFixed(2)}`);
    assert.ok(ratio(a.dark, '#0F1217') >= 4.5, `${a.id} dark on bg ${ratio(a.dark, '#0F1217').toFixed(2)}`);
    assert.ok(ratio(a.dark, '#1A1F27') >= 4.5, `${a.id} dark on card`);
    assert.ok(ratio(a.inkLight, a.tintLight) >= 4.5, `${a.id} ink on tint (light)`);
    assert.ok(ratio(a.inkDark, a.tintDark) >= 4.5, `${a.id} ink on tint (dark)`);
  }
});

test('account colours are readable as a badge with white / dark text', () => {
  for (const c of ACCOUNT_COLOURS) assert.ok(ratio(c, '#FFFFFF') >= 4.5, c);
});

test('loadSettings: garbage and unknown values fall back to defaults', () => {
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings('x'), DEFAULT_SETTINGS);
  const s = loadSettings({ theme: 'neon', accent: 'nope', rowSize: 5, undoSend: 99, accountColours: { a: '#123456', b: ACCOUNT_COLOURS[2] }, blockImages: false, signature: 'x'.repeat(900) });
  assert.equal(s.theme, 'system');
  assert.equal(s.accent, 'ember');
  assert.equal(s.rowSize, 'comfortable');
  assert.equal(s.undoSend, 10);
  assert.deepEqual(s.accountColours, { b: ACCOUNT_COLOURS[2] });
  assert.equal(s.blockImages, false);
  assert.equal(s.signature.length, 500);
});

test('valid settings round-trip', () => {
  const s = { ...DEFAULT_SETTINGS, theme: 'dark' as const, accent: 'ocean', pureBlack: true, rowSize: 'compact' as const, swipeRight: 'delete' as const, undoSend: 0 };
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(s))), s);
});

test('pure black changes only the dark ground', () => {
  assert.equal(themeVars({ ...DEFAULT_SETTINGS, pureBlack: true }, true)['--bg'], '#000000');
  assert.equal(themeVars({ ...DEFAULT_SETTINGS, pureBlack: true }, false)['--bg'], '#F2F3F5');
});

test('each account gets its own colour unless the user chose one', () => {
  const accts = ['a@o.no', 'w@f.no'];
  assert.notEqual(accountColour(accts[0], accts, {}), accountColour(accts[1], accts, {}));
  assert.equal(accountColour(accts[0], accts, { [accts[0]]: ACCOUNT_COLOURS[3] }), ACCOUNT_COLOURS[3]);
});
