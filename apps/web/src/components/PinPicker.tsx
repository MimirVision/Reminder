import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { useI18n } from '../i18n';
import { pinHit, reverseGeocode, type Hit } from '../lib/placeSearch';
import { getLastKnown } from '../lib/useHere';
import { MAP_ATTRIBUTION_FALLBACK, MAP_STYLE_URL, RASTER_FALLBACK_STYLE } from '../theme-core';

maplibregl.setWorkerUrl(workerUrl);

const OSLO: [number, number] = [10.7522, 59.9139];

/** Choose a spot by moving the map under a fixed pin. The name and address of what is there are looked up and shown; "Use this spot" hands back a place. */
export default function PinPicker({ start, onPick, onClose }: { start?: { lat: number; lon: number } | null; onPick: (h: Hit) => void; onClose: () => void }) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [centre, setCentre] = useState<{ lat: number; lon: number } | null>(null);
  const [found, setFound] = useState<Hit | null>(null);
  const [looking, setLooking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);

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
      const from = start ?? getLastKnown();
      m = new maplibregl.Map({
        container: el.current, style, center: from ? [from.lon, from.lat] : OSLO, zoom: from ? 16 : 11, attributionControl: false,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 120,
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: fallback ? MAP_ATTRIBUTION_FALLBACK : undefined }), 'bottom-left');
      const sync = () => { const c = m!.getCenter(); setCentre({ lat: c.lat, lon: c.lng }); };
      m.on('load', () => { sync(); if (!from) setFailed(false); });
      m.on('moveend', sync);
      const failTimer = setTimeout(() => { if (m && !m.loaded()) setFailed(true); }, 9000);
      m.once('idle', () => { clearTimeout(failTimer); setFailed(false); });
      ro = new ResizeObserver(() => m?.resize());
      ro.observe(el.current);
      map.current = m;
    })();
    return () => { cancelled = true; ro?.disconnect(); m?.remove(); map.current = null; };
  }, [start]);

  // What is at the pin: looked up a moment after the map stops moving.
  useEffect(() => {
    if (!centre) return;
    setLooking(true); setOffline(false);
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      reverseGeocode(centre.lat, centre.lon, ctl.signal)
        .then((h) => { setFound(h); setLooking(false); })
        .catch((e) => { if ((e as Error).name === 'AbortError') return; setFound(null); setOffline(true); setLooking(false); });
    }, 350);
    return () => { window.clearTimeout(id); ctl.abort(); };
  }, [centre]);

  const toMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); map.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17, duration: 600 }); },
      () => setLocating(false), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  const label = found ? (found.name || found.address) : '';
  return (
    <Sheet label={t('pin.title')} onClose={onClose}>
      <div className="row spread"><h2>{t('pin.title')}</h2><button type="button" className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      <p className="muted">{t('pin.help')}</p>
      <div className="pinpick">
        <div ref={el} className="pinpick-map" role="application" aria-label={t('pin.mapAria')} />
        <span className="pinpick-pin" aria-hidden="true"><Icon name="pin" size={34} /></span>
        <button type="button" className="pinpick-me" aria-label={t('pin.locate')} onClick={toMe} disabled={locating}><Icon name="locate" size={20} /></button>
        {failed && <span className="pinpick-note muted" role="status">{t('pin.mapFail')}</span>}
      </div>
      <p className="pinpick-found" role="status" aria-live="polite">
        {looking ? <span className="muted">{t('where.searching')}</span>
          : offline ? <span className="muted">{t('pin.offline')}</span>
          : found ? <><strong>{label}</strong>{found.address && found.name && <span className="muted"> · {found.address}</span>}</>
          : <span className="muted">{t('pin.nothing')}</span>}
      </p>
      <div className="row">
        <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn primary" disabled={!centre || looking} onClick={() => centre && onPick(pinHit(centre.lat, centre.lon, found, t('pin.defaultName')))}>{t('pin.use')}</button>
      </div>
    </Sheet>
  );
}
