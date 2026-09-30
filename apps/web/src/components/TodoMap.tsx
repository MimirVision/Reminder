import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon } from './icons';
import { useI18n } from '../i18n';
import type { LatLon } from '../lib/geo';
import type { MapPin } from '../lib/pins';

import { TILE_ATTRIBUTION as ATTRIBUTION, TILE_URLS as TILES } from '../theme-core';

const OSLO: L.LatLngTuple = [59.9139, 10.7522];

type Props = {
  pins: MapPin[]; here: LatLon | null; selectedKey: string | null; resolved: 'light' | 'dark';
  /** Pixels at the bottom covered by the sheet, so pins are kept clear of it. */
  bottomInset: number; onSelect: (p: MapPin) => void; onLocate: () => void; onAdd: () => void;
};

// The map behind the to-do screen. It is created once; pins, theme and position are updated in place, never rebuilt.
export default function TodoMap({ pins, here, selectedKey, resolved, bottomInset, onSelect, onLocate, onAdd }: Props) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const me = useRef<L.Marker | null>(null);
  const fitted = useRef('');
  const flyToMe = useRef(false);
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: false, zoomSnap: 0.5, zoomDelta: 1, worldCopyJump: false }).setView(OSLO, 11);
    L.control.attribution({ prefix: false, position: 'bottomleft' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; tiles.current = null; layer.current = null; me.current = null; fitted.current = ''; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(TILES[resolved], { subdomains: 'abcd', maxZoom: 20, detectRetina: true, attribution: ATTRIBUTION }).addTo(m);
    tiles.current.bringToBack();
  }, [resolved]);

  // Pins, radius circles and the selection.
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const p of pins) {
      const sel = p.key === selectedKey;
      if (p.radius && (sel || p.count > 0)) L.circle([p.lat, p.lon], { radius: p.radius, interactive: false, className: `radius${sel ? ' sel' : ''}`, weight: 1.5 }).addTo(g);
    }
    for (const p of pins) {
      const sel = p.key === selectedKey;
      const icon = L.divIcon({
        className: 'pin-wrap', iconSize: [44, 44], iconAnchor: [22, 22],
        html: `<div class="pin${p.count ? '' : ' empty'}${sel ? ' sel' : ''}"><span>${p.count || ''}</span></div>`,
      });
      L.marker([p.lat, p.lon], { icon, title: p.label, alt: p.label, zIndexOffset: sel ? 1000 : p.count ? 100 : 0 }).addTo(g).on('click', () => selectRef.current(p));
    }
  }, [pins, selectedKey]);

  // Where you are.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    me.current?.remove();
    me.current = null;
    if (!here) return;
    me.current = L.marker([here.lat, here.lon], {
      interactive: false, keyboard: false, zIndexOffset: 2000,
      icon: L.divIcon({ className: 'pin-wrap', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="me"><i></i></div>' }),
    }).addTo(m);
  }, [here]);

  // Frame the pins once per set of pins (and you, when there are none), keeping them above the sheet.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const sig = pins.map((p) => p.key).sort().join(',') + (pins.length === 0 && here ? '|here' : '');
    if (sig === fitted.current || (sig === '' && !here)) return;
    fitted.current = sig;
    const padding = { paddingTopLeft: [28, 120] as L.PointTuple, paddingBottomRight: [28, inset.current + 24] as L.PointTuple };
    const pts = pins.filter((p) => p.count > 0 || pins.length === 1).map((p) => [p.lat, p.lon] as L.LatLngTuple);
    const all = pts.length ? pts : pins.map((p) => [p.lat, p.lon] as L.LatLngTuple);
    if (here && all.length) all.push([here.lat, here.lon]);
    if (all.length > 1) m.fitBounds(L.latLngBounds(all), { ...padding, maxZoom: 16, animate: false });
    else if (all.length === 1) m.setView(all[0], 15, { animate: false });
    else if (here) m.setView([here.lat, here.lon], 14, { animate: false });
  }, [pins, here]);

  // Selecting a card (or a pin) brings the place into the open part of the map.
  useEffect(() => {
    const m = map.current;
    const p = pins.find((x) => x.key === selectedKey);
    if (!m || !p) return;
    const zoom = Math.max(m.getZoom(), 15);
    const target = m.project([p.lat, p.lon], zoom).add([0, inset.current / 2 - 30]);
    m.flyTo(m.unproject(target, zoom), zoom, { duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const flyTo = (p: LatLon) => {
    const m = map.current;
    if (!m) return;
    const zoom = Math.max(m.getZoom(), 15);
    m.flyTo(m.unproject(m.project([p.lat, p.lon], zoom).add([0, inset.current / 2 - 30]), zoom), zoom, { duration: 0.6 });
  };
  // The position arrived after a tap on the locate button.
  useEffect(() => {
    if (here && flyToMe.current) { flyToMe.current = false; flyTo(here); }
  }, [here]);

  return (
    <div className="mapwrap" style={{ ['--sheet' as string]: `${bottomInset}px` }}>
      <div className="map" ref={el} role="region" aria-label={t('map.aria')} />
      <div className="map-controls" style={{ bottom: bottomInset + 20 }}>
        <div className="glass stack">
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => map.current?.zoomIn()}><Icon name="plus" size={20} /></button>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => map.current?.zoomOut()}><Icon name="minus" size={20} /></button>
        </div>
        <button type="button" className="glass round" aria-label={t('map.locate')} onClick={() => { if (here) flyTo(here); else flyToMe.current = true; onLocate(); }}><Icon name="locate" size={20} /></button>
        <button type="button" className="round accent" aria-label={t('todo.addAria')} onClick={onAdd}><Icon name="plus" size={22} /></button>
      </div>
    </div>
  );
}
