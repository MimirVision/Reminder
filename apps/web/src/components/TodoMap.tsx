import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Icon } from './icons';
import { useI18n } from '../i18n';
import type { LatLon } from '../lib/geo';
import { circlePolygon } from '../lib/geoCircle';
import type { MapPin } from '../lib/pins';
import { MAP_ATTRIBUTION_FALLBACK, MAP_STYLE_URL, RASTER_FALLBACK_STYLE } from '../theme-core';

maplibregl.setWorkerUrl(workerUrl); // the map's background worker, bundled as its own file

const OSLO: [number, number] = [10.7522, 59.9139];
const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/></svg>';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

type Props = {
  pins: MapPin[]; here: LatLon | null; selectedKey: string | null; resolved: 'light' | 'dark';
  /** Pixels at the bottom covered by the sheet, so pins are kept clear of it. */
  bottomInset: number; onSelect: (p: MapPin) => void; onLocate: () => void; onAdd: () => void;
  /** A planned day route: the line to draw and the numbered stops along it. */
  route?: { line: [number, number][]; stops: { lat: number; lon: number; n: number }[] } | null;
};

/** A modern vector map (OpenFreeMap, no key needed) behind the to-do screen. Created once; pins, circles and position are updated in place. */
export default function TodoMap({ pins, here, selectedKey, resolved, bottomInset, onSelect, onLocate, onAdd, route }: Props) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const me = useRef<maplibregl.Marker | null>(null);
  const stopMarkers = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef('');
  const flyToMe = useRef(false);
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // The style comes from OpenFreeMap; if it cannot be fetched, plain OpenStreetMap tiles are used instead.
  useEffect(() => {
    if (!el.current) return;
    let cancelled = false;
    let m: maplibregl.Map | null = null;
    let ro: ResizeObserver | null = null;
    (async () => {
      let style = RASTER_FALLBACK_STYLE as unknown as maplibregl.StyleSpecification;
      let fallback = true;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(MAP_STYLE_URL, { signal: ctl.signal });
        clearTimeout(timer);
        if (res.ok) { style = (await res.json()) as maplibregl.StyleSpecification; fallback = false; }
      } catch { /* use the fallback */ }
      if (cancelled || !el.current) return;
      m = new maplibregl.Map({
        container: el.current, style, center: OSLO, zoom: 11, attributionControl: false, dragRotate: false, pitchWithRotate: false,
        touchPitch: false, fadeDuration: 120, canvasContextAttributes: { antialias: true },
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: fallback ? MAP_ATTRIBUTION_FALLBACK : undefined }), 'bottom-left');
      m.on('load', () => {
        m!.addSource('radius', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m!.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#C8431F', 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.18, 0.08] } });
        m!.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#C8431F', 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 0.9, 0.45], 'line-width': 1.5 } });
        m!.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m!.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 } });
        m!.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#C8431F', 'line-width': 5 } });
        setReady(true);
      });
      const failTimer = setTimeout(() => { if (m && !m.loaded()) setFailed(true); }, 9000);
      m.once('idle', () => { clearTimeout(failTimer); setFailed(false); });
      ro = new ResizeObserver(() => m?.resize());
      ro.observe(el.current);
      map.current = m;
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      markers.current.forEach((x) => x.remove());
      me.current?.remove();
      m?.remove();
      map.current = null; me.current = null; markers.current = []; fitted.current = '';
      setReady(false);
    };
  }, []);

  // Pins (with a label on the selected one) and the radius circles.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    markers.current.forEach((x) => x.remove());
    markers.current = pins.map((p) => {
      const sel = p.key === selectedKey;
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `mpin${p.count ? '' : ' quiet'}${sel ? ' sel' : ''}`;
      node.setAttribute('aria-label', p.label);
      node.innerHTML = `<span class="mpin-body">${p.count ? `${PIN}<b>${p.count}</b>` : ''}</span>${sel ? `<span class="mpin-label">${esc(p.label)}</span>` : ''}`;
      node.addEventListener('click', (e) => { e.stopPropagation(); selectRef.current(p); });
      return new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(m);
    });
    const src = m.getSource('radius') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: pins.filter((p) => p.radius && (p.key === selectedKey || p.count > 0)).map((p) => ({
        type: 'Feature', properties: { sel: p.key === selectedKey ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [circlePolygon(p.lat, p.lon, p.radius as number)] },
      })),
    });
  }, [pins, selectedKey, ready]);

  // A planned route: the line, numbered stops, and the view framed around it.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    stopMarkers.current.forEach((x) => x.remove());
    stopMarkers.current = [];
    const src = m.getSource('route') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: route && route.line.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.line } }] : [] });
    if (!route) return;
    stopMarkers.current = route.stops.map((s) => {
      const node = document.createElement('div');
      node.className = 'rstop';
      node.textContent = String(s.n);
      return new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat([s.lon, s.lat]).addTo(m);
    });
    const pts = route.line.length > 1 ? route.line : route.stops.map((s) => [s.lon, s.lat] as [number, number]);
    if (pts.length > 1) {
      const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((c) => b.extend(c));
      m.fitBounds(b, { padding: { top: 120, left: 28, right: 28, bottom: inset.current + 24 }, maxZoom: 16, duration: 500 });
    }
    return () => { stopMarkers.current.forEach((x) => x.remove()); stopMarkers.current = []; };
  }, [route, ready]);

  // Where you are.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    me.current?.remove();
    me.current = null;
    if (!here) return;
    const node = document.createElement('div');
    node.className = 'me';
    node.innerHTML = '<i></i>';
    me.current = new maplibregl.Marker({ element: node }).setLngLat([here.lon, here.lat]).addTo(m);
  }, [here, ready]);

  // Frame the pins once per set of pins (and you, when there are none), keeping them above the sheet.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const sig = pins.map((p) => p.key).sort().join(',') + (pins.length === 0 && here ? '|here' : '');
    if (sig === fitted.current || (sig === '' && !here)) return;
    fitted.current = sig;
    const withTodos = pins.filter((p) => p.count > 0);
    const pts: [number, number][] = (withTodos.length ? withTodos : pins).map((p) => [p.lon, p.lat]);
    if (here && pts.length) pts.push([here.lon, here.lat]);
    const padding = { top: 120, left: 28, right: 28, bottom: inset.current + 24 };
    if (pts.length > 1) {
      const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((c) => b.extend(c));
      m.fitBounds(b, { padding, maxZoom: 16, duration: 0 });
    } else if (pts.length === 1) m.jumpTo({ center: pts[0], zoom: 15, padding });
    else if (here) m.jumpTo({ center: [here.lon, here.lat], zoom: 14, padding });
  }, [pins, here, ready]);

  // Selecting a card (or a pin) glides to the place and keeps it above the sheet.
  useEffect(() => {
    const m = map.current;
    const p = pins.find((x) => x.key === selectedKey);
    if (!m || !ready || !p) return;
    m.easeTo({ center: [p.lon, p.lat], zoom: Math.max(m.getZoom(), 15), padding: { top: 100, left: 20, right: 20, bottom: inset.current + 20 }, duration: 550 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const flyTo = (p: LatLon) => map.current?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.current.getZoom(), 15), padding: { top: 100, left: 20, right: 20, bottom: inset.current + 20 }, duration: 600 });
  useEffect(() => {
    if (here && flyToMe.current) { flyToMe.current = false; flyTo(here); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here]);

  return (
    <div className="mapwrap" style={{ ['--sheet' as string]: `${bottomInset}px` }}>
      <div className={`map${resolved === 'dark' ? ' dark' : ''}`} ref={el} role="region" aria-label={t('map.aria')} />
      {failed && <p className="map-note glass" role="status">{t('map.tilesFailed')}</p>}
      <div className="map-controls" style={{ bottom: bottomInset + 20 }}>
        <div className="glass stack">
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => map.current?.zoomIn({ duration: 250 })}><Icon name="plus" size={20} /></button>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => map.current?.zoomOut({ duration: 250 })}><Icon name="minus" size={20} /></button>
        </div>
        <button type="button" className="glass round" aria-label={t('map.locate')} onClick={() => { if (here) flyTo(here); else flyToMe.current = true; onLocate(); }}><Icon name="locate" size={20} /></button>
        <button type="button" className="round accent" aria-label={t('todo.addAria')} onClick={onAdd}><Icon name="plus" size={22} /></button>
      </div>
    </div>
  );
}
