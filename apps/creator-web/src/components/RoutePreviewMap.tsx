// Whole-route preview for the Builder — every located task as a numbered pin,
// connected in play order by a dashed path. Locationless tasks are skipped.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Stage } from '@rushpoint/shared';
import { resolveMapStyle, isValidCoord, type MapMode } from '@rushpoint/shared';
import MapModeToggle from './MapModeToggle';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

export default function RoutePreviewMap({ stages, className = '' }: { stages: Stage[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [mode, setMode] = useState<MapMode>('topo');

  // Located tasks in play order (stage order → task order).
  const stops = stages
    .slice().sort((a, b) => a.order - b.order)
    .flatMap((s) => s.tasks)
    .filter((t) => !t.locationless && t.coordinates && isValidCoord(t.coordinates.lat, t.coordinates.lng)
      && (t.coordinates.lat !== 0 || t.coordinates.lng !== 0))
    .map((t) => ({ title: t.title || 'Task', lat: t.coordinates.lat, lng: t.coordinates.lng }));

  // Keep a ref to the latest drawRoute closure so the map's 'load'/'styledata'
  // listeners (registered once at mount) always call the current version — not
  // the one captured when stops were still empty (P7 stale-closure bug).
  const drawRouteRef = useRef<() => void>(() => {});

  function drawRoute() {
    const m = map.current;
    if (!m || !m.isStyleLoaded()) return; // 'load'/'styledata' will call again when ready
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: stops.map((s) => [s.lng, s.lat]) },
    };
    const existing = m.getSource('route') as maplibregl.GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }
    if (stops.length < 2) return;
    m.addSource('route', { type: 'geojson', data });
    m.addLayer({
      id: 'route-line', type: 'line', source: 'route',
      paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 },
    });
  }
  drawRouteRef.current = drawRoute;

  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: [35.21, 31.77], zoom: 8,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current.on('load', () => drawRouteRef.current());
    map.current.on('styledata', () => drawRouteRef.current()); // re-add the line after a tile-style swap
    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setStyle(resolveMapStyle(KEY, mode) as maplibregl.StyleSpecification | string);
  }, [mode]);

  // Re-render numbered markers + reframe whenever the stops change.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = stops.map((s, i) => {
      const el = document.createElement('div');
      el.style.cssText =
        'width:24px;height:24px;border-radius:50%;background:#22c55e;color:#0b0f17;border:2px solid #0b0f17;' +
        'display:flex;align-items:center;justify-content:center;font:600 12px/1 system-ui;box-shadow:0 0 0 2px #22c55e55;';
      el.textContent = String(i + 1);
      el.title = s.title;
      return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m);
    });
    drawRoute();

    if (stops.length === 1) {
      m.easeTo({ center: [stops[0].lng, stops[0].lat], zoom: 13 });
    } else if (stops.length > 1) {
      const b = new maplibregl.LngLatBounds([stops[0].lng, stops[0].lat], [stops[0].lng, stops[0].lat]);
      stops.forEach((s) => b.extend([s.lng, s.lat]));
      m.fitBounds(b, { padding: 50, maxZoom: 15, duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stops)]);

  return (
    <div className="relative">
      <div ref={ref} className={`rounded-xl overflow-hidden border border-glass-border ${className}`} />
      <MapModeToggle mode={mode} onChange={setMode} />
      {stops.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-app-bg/80 text-zinc-400 text-xs px-3 py-1.5 rounded-full">
            No located tasks yet. Add a map location to see the route.
          </span>
        </div>
      )}
    </div>
  );
}
