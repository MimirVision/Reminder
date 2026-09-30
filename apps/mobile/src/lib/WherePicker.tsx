import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { CATEGORIES, categoryName, placeLabel, shopName, type Category } from '../shared/lib/labels';
import { categoryFromName, categoryFromQuery, directionsUrl, findExistingPlace, matchSaved, searchPlaces, type Hit } from '../shared/lib/placeSearch';
import type { LatLon } from '../shared/lib/geo';
import type { Where } from './api';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import type { Place } from './types';
import { Field, Icon, Muted, styles } from './ui';

export type Pick = { type: 'saved'; place: Place } | { type: 'kind'; category: Category } | { type: 'hit'; hit: Hit };

async function lastKnown(): Promise<LatLon | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const p = await Location.getLastKnownPositionAsync();
    return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : null;
  } catch { return null; }
}

/** One search box for shops ("kiwi myren"), kinds of shop ("apotek") and addresses. Also used on the Places screen (showSaved=false). */
export function PlaceSearch({ places, showSaved, onPick }: { places: Place[]; showSaved: boolean; onPick: (p: Pick) => void }) {
  const { t } = useI18n();
  const th = useTheme();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = q.trim();

  useEffect(() => {
    setFailed(false);
    if (text.length < 2) { setHits([]); setBusy(false); return; }
    setBusy(true);
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      try { setHits(await searchPlaces(text, { near: await lastKnown(), signal: ctl.signal })); setBusy(false); }
      catch (e) { if ((e as Error).name === 'AbortError') return; setHits([]); setFailed(true); setBusy(false); }
    }, 250);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [text]);

  const saved = showSaved ? matchSaved(places, text, (p) => placeLabel(p, t)) : [];
  const kind = text ? categoryFromQuery(text) : null;
  const kindSaved = kind ? places.find((p) => p.kind === 'category' && p.category === kind) : undefined;
  const rows: { key: string; title: string; sub?: string; tag?: string; icon: 'mappin' | 'storefront'; pick?: Pick }[] = [];
  for (const p of saved) rows.push({ key: `s${p.id}`, title: placeLabel(p, t), sub: p.address ?? undefined, tag: t('where.saved'), icon: p.kind === 'category' ? 'storefront' : 'mappin', pick: { type: 'saved', place: p } });
  if (kind && !(showSaved && kindSaved && saved.includes(kindSaved))) rows.push({ key: `k${kind}`, title: categoryName(kind, t), sub: t('places.kindCategory'), tag: kindSaved && !showSaved ? t('places.already') : t('where.kinds'), icon: 'storefront', pick: kindSaved && !showSaved ? undefined : { type: 'kind', category: kind } });
  for (const hit of hits) {
    const existing = findExistingPlace(places, hit);
    if (existing && showSaved) continue;
    rows.push({ key: `h${hit.key}`, title: hit.name, sub: hit.address || undefined, tag: existing ? t('places.already') : hit.isAddress ? t('where.address') : hit.category ? shopName(hit.category, t) : undefined, icon: hit.isAddress ? 'mappin' : 'storefront', pick: existing ? undefined : { type: 'hit', hit } });
  }

  return (
    <View style={{ gap: 10 }}>
      <Field placeholder={t('where.placeholder')} accessibilityLabel={t('where.label')} value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
        onSubmitEditing={() => { const first = rows.find((r) => r.pick); if (first?.pick) onPick(first.pick); }} />
      {text.length >= 2 && (
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: th.line, backgroundColor: th.card, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <Pressable key={r.key} disabled={!r.pick} accessibilityRole="button" onPress={() => r.pick && onPick(r.pick)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 54, opacity: r.pick ? 1 : 0.5, borderTopWidth: i ? 1 : 0, borderTopColor: th.line }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: th.tint, alignItems: 'center', justifyContent: 'center' }}><Icon name={r.icon} size={17} color={th.tintInk} /></View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{r.title}</Text>
                {r.sub ? <Text numberOfLines={1} style={{ color: th.muted, fontFamily: font.body, fontSize: 13 }}>{r.sub}</Text> : null}
              </View>
              {r.tag ? <Text style={{ color: th.muted, fontFamily: font.semi, fontSize: 11 }}>{r.tag}</Text> : null}
            </Pressable>
          ))}
          {rows.length === 0 && <View style={{ padding: 14 }}>{busy ? <ActivityIndicator /> : <Muted>{failed ? t('where.offline') : t('where.none')}</Muted>}</View>}
          {rows.length > 0 && busy && <View style={{ padding: 10 }}><ActivityIndicator /></View>}
        </View>
      )}
    </View>
  );
}

// Where a to-do belongs: one of your places, or search a shop, a kind of shop or an address.
export function WherePicker({ places, value, onChange }: { places: Place[]; value: Where; onChange: (w: Where) => void }) {
  const { t } = useI18n();
  const th = useTheme();

  const pick = (p: Pick) => {
    if (p.type === 'saved') onChange({ kind: 'place', placeId: p.place.id });
    else if (p.type === 'kind') onChange({ kind: 'category', category: p.category, name: categoryName(p.category, t) });
    else onChange({ kind: 'hit', hit: p.hit, kindOfShop: p.hit.category ?? categoryFromName(p.hit.name) });
  };

  if (value.kind !== 'none') {
    const place = value.kind === 'place' ? places.find((p) => p.id === value.placeId) : undefined;
    const label = value.kind === 'place' ? (place ? placeLabel(place, t) : '…') : value.kind === 'category' ? value.name : value.hit.name;
    const address = value.kind === 'place' ? place?.address : value.kind === 'hit' ? value.hit.address : null;
    const coords = value.kind === 'hit' ? value.hit : place?.lat != null && place.lon != null ? { lat: place.lat, lon: place.lon } : null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: th.tint, padding: 12 }}>
        <Icon name={value.kind === 'category' ? 'storefront' : 'mappin'} size={18} color={th.tintInk} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: th.tintInk, fontFamily: font.semi, fontSize: 16 }}>{label}</Text>
          {address ? <Text style={{ color: th.tintInk, opacity: 0.8, fontSize: 13, fontFamily: font.body }}>{address}</Text> : null}
        </View>
        {coords && <Pressable accessibilityLabel={t('where.directions')} hitSlop={8} onPress={() => void Linking.openURL(directionsUrl(coords))} style={{ padding: 6 }}><Icon name="location.north.fill" size={16} color={th.tintInk} /></Pressable>}
        <Pressable accessibilityLabel={t('where.clear')} hitSlop={8} onPress={() => onChange({ kind: 'none' })} style={{ padding: 6 }}><Icon name="xmark" size={16} color={th.tintInk} /></Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <PlaceSearch places={places} showSaved onPick={pick} />
      {places.length > 0 && (
        <View style={styles.row}>
          {places.slice(0, 8).map((p) => <Chip key={p.id} icon={p.kind === 'category' ? 'storefront' : 'mappin'} label={placeLabel(p, t)} onPress={() => onChange({ kind: 'place', placeId: p.id })} />)}
        </View>
      )}
    </View>
  );
}

export { CATEGORIES };
