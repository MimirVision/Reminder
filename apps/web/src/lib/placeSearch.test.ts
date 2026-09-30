import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryFromName, categoryFromOsm, categoryFromQuery, findExistingPlace, matchSaved, parsePhoton } from './placeSearch.ts';

const feature = (props: Record<string, unknown>, lon = 10.7, lat = 59.9) => ({ geometry: { coordinates: [lon, lat] }, properties: { countrycode: 'NO', ...props } });

test('generic words mean a kind of shop; brands stay a normal search', () => {
  assert.equal(categoryFromQuery('apotek'), 'pharmacy');
  assert.equal(categoryFromQuery('  Apotek '), 'pharmacy');
  assert.equal(categoryFromQuery('byggevare'), 'hardware');
  assert.equal(categoryFromQuery('apot'), 'pharmacy'); // typing on the way
  assert.equal(categoryFromQuery('kiwi myren'), null);
  assert.equal(categoryFromQuery('kiwi'), null);
  assert.equal(categoryFromQuery('ap'), null);
});

test('brands tag a saved shop with its kind', () => {
  assert.equal(categoryFromName('Kiwi Myren'), 'grocery');
  assert.equal(categoryFromName('Vitus Apotek Ullevål'), 'pharmacy');
  assert.equal(categoryFromName('Home'), null);
});

test('osm tags map to kinds', () => {
  assert.equal(categoryFromOsm('amenity', 'pharmacy'), 'pharmacy');
  assert.equal(categoryFromOsm('shop', 'doityourself'), 'hardware');
  assert.equal(categoryFromOsm('shop', 'supermarket'), 'grocery');
  assert.equal(categoryFromOsm('shop', 'clothes'), null);
  assert.equal(categoryFromOsm(undefined, undefined), null);
});

test('parsePhoton: a shop, an address, junk and non-Norwegian results', () => {
  const hits = parsePhoton({ features: [
    feature({ osm_type: 'N', osm_id: 1, osm_key: 'shop', osm_value: 'supermarket', name: 'Kiwi Myren', street: 'Sinsenveien', housenumber: '2', postcode: '0572', city: 'Oslo' }),
    feature({ osm_type: 'W', osm_id: 2, osm_key: 'building', osm_value: 'yes', street: 'Storgata', housenumber: '5', postcode: '0155', city: 'Oslo' }),
    feature({ osm_type: 'N', osm_id: 3, name: 'Stockholm shop', countrycode: 'SE' }),
    feature({ osm_type: 'N', osm_id: 1, name: 'dupe', osm_key: 'shop', osm_value: 'supermarket' }),
    { properties: {} },
    { geometry: { coordinates: ['x', 1] }, properties: { name: 'bad' } },
  ] });
  assert.equal(hits.length, 2);
  assert.deepEqual([hits[0].name, hits[0].address, hits[0].category, hits[0].isAddress], ['Kiwi Myren', 'Sinsenveien 2, 0572 Oslo', 'grocery', false]);
  assert.deepEqual([hits[1].name, hits[1].address, hits[1].isAddress], ['Storgata 5', '0155 Oslo', true]);
  assert.deepEqual(parsePhoton(null), []);
  assert.deepEqual(parsePhoton({ features: 'nope' }), []);
});

test('an existing saved place is reused when it is the same spot', () => {
  const places = [{ id: 'a', name: 'Kiwi Myren', lat: 59.9, lon: 10.7 }, { id: 'b', name: 'Cabin', lat: null, lon: null }];
  assert.equal(findExistingPlace(places, { name: 'KIWI myren', lat: 59.9003, lon: 10.7 })?.id, 'a');
  assert.equal(findExistingPlace(places, { name: 'Rema', lat: 59.95, lon: 10.7 }), null);
});

test('saved places are matched by word start, best first', () => {
  const places = [{ name: 'Byggmax Skøyen' }, { name: 'Kiwi Myren' }, { name: 'Home', address: 'Myrveien 3' }];
  assert.deepEqual(matchSaved(places, 'myr').map((p) => p.name), ['Kiwi Myren', 'Home']);
  assert.deepEqual(matchSaved(places, ''), []);
  assert.deepEqual(matchSaved(places, 'zzz'), []);
});
