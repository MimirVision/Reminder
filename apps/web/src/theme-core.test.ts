import test from 'node:test';
import assert from 'node:assert/strict';
import { isThemePref, MAP_STYLE_URL, RASTER_FALLBACK_STYLE, resolveTheme, themeColor } from './theme-core.ts';

test('system follows the device, explicit choices win', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('only the three preferences are accepted', () => {
  for (const ok of ['system', 'light', 'dark']) assert.equal(isThemePref(ok), true);
  for (const bad of ['', 'auto', null, undefined, 1]) assert.equal(isThemePref(bad), false);
});

test('status-bar colour and map tiles exist for both themes', () => {
  assert.notEqual(themeColor('light'), themeColor('dark'));
  assert.match(MAP_STYLE_URL, /^https:\/\/tiles\.openfreemap\.org\/styles\//);
  assert.match(RASTER_FALLBACK_STYLE.sources.osm.tiles[0], /\{z\}\/\{x\}\/\{y\}/);
});
