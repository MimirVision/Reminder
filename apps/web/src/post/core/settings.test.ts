import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS, ACCOUNT_COLOURS, DEFAULT_SETTINGS, LOOKS, LOOK_ACCENT, accountColour, avatarTone, lookChange, loadSettings, themeVars } from './settings.ts';
import { AVATAR_HUES } from './format.ts';

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

/** hsl(h s% l%) as #RRGGBB, so the same contrast arithmetic can judge it. */
const hsl = (h: number, s: number, l: number) => {
  const sat = s / 100, lig = l / 100, k = (n: number) => (n + h / 30) % 12, a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => Math.round(255 * (lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
};

test('both looks keep text, muted text and every accent readable on their own grounds', () => {
  for (const [look] of LOOKS) for (const dark of [false, true]) for (const pureBlack of [false, true]) {
    const v = themeVars({ ...DEFAULT_SETTINGS, look, pureBlack }, dark);
    const where = `${look} ${dark ? 'dark' : 'light'}${pureBlack ? ' black' : ''}`;
    assert.ok(ratio(v['--ink'], v['--bg']) >= 7, `${where}: ink on ground`);
    assert.ok(ratio(v['--ink'], v['--card']) >= 7, `${where}: ink on card`);
    assert.ok(ratio(v['--mu'], v['--bg']) >= 4.5, `${where}: muted on ground ${ratio(v['--mu'], v['--bg']).toFixed(2)}`);
    assert.ok(ratio(v['--mu'], v['--card']) >= 4.5, `${where}: muted on card`);
    for (const a of ACCENTS) {
      const ac = dark ? a.dark : a.light;
      assert.ok(ratio(ac, v['--card']) >= 4.5, `${where}: ${a.id} on card ${ratio(ac, v['--card']).toFixed(2)}`);
      assert.ok(ratio(ac, v['--bg']) >= 4.2, `${where}: ${a.id} on ground ${ratio(ac, v['--bg']).toFixed(2)}`);
    }
  }
});

test('the letters on every avatar colour are readable, in both looks, light and dark', () => {
  for (const [look] of LOOKS) for (const dark of [false, true]) {
    const t = avatarTone(look, dark);
    for (const h of AVATAR_HUES) {
      const r = ratio(hsl(h, t.fgS, t.fgL), hsl(h, t.bgS, t.bgL));
      assert.ok(r >= 4.5, `${look} ${dark ? 'dark' : 'light'} hue ${h}: ${r.toFixed(2)}`);
    }
    const v = themeVars({ ...DEFAULT_SETTINGS, look }, dark);
    assert.equal(v['--avb'], `${t.bgL}%`, 'the stylesheet gets the same numbers that were checked');
    assert.equal(v['--avf'], `${t.fgL}%`);
  }
});

test('the look is Refined unless the person chose Calm, and a damaged value falls back', () => {
  assert.equal(DEFAULT_SETTINGS.look, 'refined');
  assert.equal(loadSettings({}).look, 'refined');
  assert.equal(loadSettings({ look: 'calm' }).look, 'calm');
  assert.equal(loadSettings({ look: 'neon' }).look, 'refined');
  assert.equal(loadSettings({ look: 7 }).look, 'refined');
  assert.equal(loadSettings(JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, look: 'calm' }))).look, 'calm');
});

test('changing the look brings its own accent along, unless a colour was picked', () => {
  assert.ok(ACCENTS.some((a) => a.id === LOOK_ACCENT.refined) && ACCENTS.some((a) => a.id === LOOK_ACCENT.calm), 'each look names an accent that exists');
  assert.equal(LOOK_ACCENT.refined, DEFAULT_SETTINGS.accent, 'Refined is shown with the accent Post has always had');
  assert.deepEqual(lookChange({ look: 'refined', accent: LOOK_ACCENT.refined }, 'calm'), { look: 'calm', accent: LOOK_ACCENT.calm }, 'to Calm: its blue');
  assert.deepEqual(lookChange({ look: 'calm', accent: LOOK_ACCENT.calm }, 'refined'), { look: 'refined', accent: LOOK_ACCENT.refined }, 'and back again');
  assert.deepEqual(lookChange({ look: 'refined', accent: 'forest' }, 'calm'), { look: 'calm' }, 'a colour somebody picked stays');
  assert.deepEqual(lookChange({ look: 'calm', accent: 'plum' }, 'refined'), { look: 'refined' }, 'also on the way back');
  assert.deepEqual(lookChange({ look: 'calm', accent: LOOK_ACCENT.calm }, 'calm'), {}, 'choosing the look it already has changes nothing');
});

test('Calm has its own grounds, and pure black still only changes the dark one', () => {
  const a = themeVars({ ...DEFAULT_SETTINGS, look: 'calm' }, false), b = themeVars(DEFAULT_SETTINGS, false);
  assert.notEqual(a['--bg'], b['--bg']);
  assert.equal(themeVars({ ...DEFAULT_SETTINGS, look: 'calm', pureBlack: true }, true)['--bg'], '#000000');
  assert.equal(themeVars({ ...DEFAULT_SETTINGS, look: 'calm', pureBlack: true }, false)['--bg'], a['--bg']);
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

test('conversations are on unless the person turned them off', () => {
  assert.equal(DEFAULT_SETTINGS.threads, true);
  assert.equal(loadSettings({}).threads, true);
  assert.equal(loadSettings({ threads: 'no' }).threads, true); // only a real false turns it off, so a damaged value never hides the feature
  assert.equal(loadSettings({ threads: false }).threads, false);
  assert.equal(loadSettings(JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, threads: false }))).threads, false);
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
