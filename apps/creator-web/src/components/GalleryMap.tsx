// Gallery map view (§10) — the shared map behind BOTH gallery tabs.
//
// Generalised over a marker shape (change: task-library-map-view): it used to take
// `PublicGame[]` and reach into `approxLocation`/`stageCount`/`playCount`. The
// mission library needs the same affordance over `PublicTask`, and a second map
// component would be a second thing to keep in sync — so the component now knows
// nothing about games or tasks. It plots `MapPoint[]`.
//
// DOMAIN FILTERING BELONGS TO THE CALLER. Deciding what may appear on a map is a
// data-visibility decision (a hidden-location task must never be plotted), and it
// is made in `publicTaskLocation` / `isPlottablePublicTask` in @rushpoint/shared —
// where it is unit-tested — not in a renderer.
//
// MapLibre (~500 KB) stays behind this module's existing lazy boundary; both tabs
// share the same chunk.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, type MapMode } from '@rushpoint/shared';
import MapModeToggle from './MapModeToggle';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/** One plottable thing. Callers build these; the map asks no further questions. */
export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  /** Small dimmed line under the title in the popup. Already localized. */
  subtitle?: string;
}

export default function GalleryMap({
  points, onSelect, emptyLabel, emptyDetail, notice, markerColor = '#22c55e', className = '',
}: {
  points: MapPoint[];
  onSelect: (id: string) => void;
  /** Shown over the map when there is nothing to plot. Already localized. */
  emptyLabel: string;
  /**
   * Optional second line under `emptyLabel` explaining WHY nothing is plotted and
   * what would change it. Already localized. The component stays domain-free: the
   * caller decides whether an explanation applies (see `publicTaskMapCoverage`) —
   * an empty map that only states the fact is a dead end for the creator.
   */
  emptyDetail?: string;
  /** Optional standing caption (e.g. "pins are approximate"). Already localized. */
  notice?: string;
  markerColor?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [mode, setMode] = useState<MapMode>('topo');
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: [35, 31.5],
      zoom: 4,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch tile style on mode change (HTML markers persist across setStyle).
  useEffect(() => {
    map.current?.setStyle(resolveMapStyle(KEY, mode) as maplibregl.StyleSpecification | string);
  }, [mode]);

  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((m) => m.remove());
    markers.current = points.map((p) => {
      const el = document.createElement('div');
      el.style.cssText =
        'width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
        `background:${markerColor};border:2px solid #0b0f17;cursor:pointer;box-shadow:0 0 0 2px ${markerColor}55;`;
      el.title = p.title;
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
            `<div style="font-weight:600">${escapeHtml(p.title)}</div>` +
              (p.subtitle ? `<div style="font-size:11px;color:#64748b">${escapeHtml(p.subtitle)}</div>` : ''),
          ),
        )
        .addTo(map.current!);
      el.addEventListener('click', () => onSelectRef.current(p.id));
      return m;
    });

    // Frame everything we plotted.
    if (points.length > 0) {
      const pts = points.map((p) => [p.lng, p.lat] as [number, number]);
      if (pts.length === 1) {
        map.current.easeTo({ center: pts[0], zoom: 11 });
      } else {
        const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
        pts.forEach((p) => b.extend(p));
        map.current.fitBounds(b, { padding: 60, maxZoom: 12, duration: 500 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points.map((p) => [p.id, p.lat, p.lng])), markerColor]);

  return (
    <div className="relative">
      <div ref={ref} className={`rounded-xl overflow-hidden border border-glass-border ${className}`} />
      <MapModeToggle mode={mode} onChange={setMode} />
      {points.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-4 pointer-events-none">
          <span className="bg-app-bg/80 text-zinc-400 text-xs px-3 py-1.5 rounded-full">
            {emptyLabel}
          </span>
          {emptyDetail && (
            <span className="bg-app-bg/80 text-zinc-400 text-[11px] leading-relaxed px-3 py-1.5 rounded-xl max-w-md text-center">
              {emptyDetail}
            </span>
          )}
        </div>
      )}
      {/* A pin a creator can see is a pin a creator will believe. Say out loud
          that a task pin is an area, so it is never read as a location fix. */}
      {notice && (
        <p className="mt-1.5 text-[11px] text-[--ink-3] text-start">{notice}</p>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
