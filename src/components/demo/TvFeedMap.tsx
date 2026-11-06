'use client';

// Leaflet over the SELF-HOSTED PMTiles basemap shipped in public/tiles: the
// archive travels with the app, so there is no third-party tile host and no
// token in the client to leak.
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

export interface TvPin {
  id: string;
  lat: number;
  lng: number;
  headline?: string | null;
  rent_pcm?: number | null;
  currency?: string | null;
  photo_url?: string | null;
  source?: string | null;
  correlation_id?: string | null;
  /** True until the authoritative row lands: photo, price and badge are still blank. */
  pending: boolean;
}

const CSS = `
.leaflet-container{background:#0b1220}
.tv-dot{display:block;width:14px;height:14px;border-radius:9999px;background:#22d3ee;box-shadow:0 0 0 4px rgba(34,211,238,.25)}
.tv-dot-pulse{animation:tv-pulse 1.4s ease-out infinite}
@keyframes tv-pulse{0%{box-shadow:0 0 0 0 rgba(34,211,238,.65)}100%{box-shadow:0 0 0 26px rgba(34,211,238,0)}}
.tv-pin{display:flex;gap:8px;align-items:center;max-width:260px;font:600 13px/1.3 system-ui,sans-serif;color:#e2e8f0}
.tv-pin img{width:56px;height:42px;object-fit:cover;border-radius:6px}
.tv-pin em{font-style:normal;font-size:11px;letter-spacing:.08em;color:#22d3ee}
`;

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function pinHtml(pin: TvPin): string {
  const price = pin.rent_pcm ? `<span>${esc(pin.currency ?? 'GBP')} ${pin.rent_pcm}/mo</span>` : '';
  const badge = pin.source ? `<span>Just listed via ${esc(pin.source)}</span>` : '';
  const photo = pin.photo_url ? `<img src="${esc(pin.photo_url)}" alt="" />` : '';
  return `<div class="tv-pin">${photo}<span><strong>${esc(pin.headline ?? 'New listing')}</strong>${price}${badge}<em>${
    pin.pending ? 'RECEIVED / PROCESSING' : 'RECEIVED'
  }</em></span></div>`;
}

export default function TvFeedMap({ pins, focusId }: { pins: TvPin[]; focusId: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const map = useRef<import('leaflet').Map | null>(null);
  const markers = useRef(new Map<string, import('leaflet').Marker>());
  const focused = useRef<string | null>(null);

  // Leaflet and the protomaps renderer both touch window at import time, so
  // both load after mount instead of at module scope.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (!alive || !host.current || map.current) return;
      const { leafletLayer } = await import('protomaps-leaflet');
      const instance = L.map(host.current, { zoomControl: false, attributionControl: true }).setView([51.5, -0.12], 13);
      // protomaps returns its own GridLayer subclass; leaflet's d.ts never saw it.
      const tiles = leafletLayer({ url: '/tiles/london.pmtiles', flavor: 'light', lang: 'en' }) as unknown as import('leaflet').Layer;
      instance.addLayer(tiles);
      map.current = instance;
      instance.invalidateSize();
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    let alive = true;
    void (async () => {
      const L = (await import('leaflet')).default;
      const seen = new Set(pins.map((pin) => pin.id));
      for (const [id, marker] of [...markers.current]) {
        if (!seen.has(id)) {
          marker.remove();
          markers.current.delete(id);
        }
      }
      for (const pin of pins) {
        const existing = markers.current.get(pin.id);
        if (existing) {
          existing.setLatLng([pin.lat, pin.lng]);
          existing.setIcon(L.divIcon({ className: '', html: pinHtml(pin), iconSize: [14, 14] }));
          continue;
        }
        const marker = L.marker([pin.lat, pin.lng], {
          icon: L.divIcon({ className: '', html: pinHtml(pin), iconSize: [14, 14] }),
          riseOnHover: true
        }).addTo(instance);
        markers.current.set(pin.id, marker);
      }
      const focus = focusId ? markers.current.get(focusId) : undefined;
      if (alive && focus && focused.current !== focusId) {
        focused.current = focusId;
        instance.flyTo(focus.getLatLng(), 16, { duration: 1.2 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [pins, focusId, ready]);

  return (
    <>
      <style>{CSS}</style>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    </>
  );
}
