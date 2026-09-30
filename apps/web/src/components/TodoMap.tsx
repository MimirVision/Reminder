import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { MapPin } from '../lib/pins';

// Map view of the to-do list: a pin per place with open to-dos (OpenStreetMap tiles).
export default function TodoMap({ pins, here, onOpen }: { pins: MapPin[]; here: { lat: number; lon: number } | null; onOpen: (p: MapPin) => void }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const center: [number, number] = here ? [here.lat, here.lon] : pins[0] ? [pins[0].lat, pins[0].lon] : [59.9139, 10.7522];
    const map = L.map(el.current, { zoomControl: true }).setView(center, here || pins.length ? 13 : 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    if (here) L.circleMarker([here.lat, here.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2F6BFF', fillOpacity: 1 }).addTo(map);
    for (const p of pins) {
      if (p.radius) L.circle([p.lat, p.lon], { radius: p.radius, color: '#C8431F', weight: 2, fillColor: '#C8431F', fillOpacity: 0.12 }).addTo(map);
      const icon = L.divIcon({ className: '', html: `<div class="pin">${p.count || ''}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
      L.marker([p.lat, p.lon], { icon, title: p.label, alt: p.label }).addTo(map).on('click', () => onOpen(p));
    }
    if (pins.length > 1) map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lon] as [number, number])).pad(0.3), { maxZoom: 15 });
    return () => { map.remove(); };
  }, [pins, here, onOpen]);

  return <div className="mapbox" ref={el} role="region" aria-label="Map of places with to-dos" />;
}
