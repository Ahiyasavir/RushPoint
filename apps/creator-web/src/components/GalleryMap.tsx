// Gallery map view (§10) — every public game with an approxLocation as a marker.
// Clicking a marker selects that game (the page scrolls/highlights its card).
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { PublicGame } from '@rushpoint/shared';
import { resolveMapStyle, isValidCoord, type MapMode } from '@rushpoint/shared';
import MapModeToggle from './MapModeToggle';
import { useT } from './LanguageContext';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

export default function GalleryMap({
  games, onSelect, className = '',
}: {
  games: PublicGame[];
  onSelect: (gameId: string) => void;
  className?: string;
}) {
  const gl = useT().gallery;
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [mode, setMode] = useState<MapMode>('topo');
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const located = games.filter(
    (g) => g.approxLocation && isValidCoord(g.approxLocation.lat, g.approxLocation.lng),
  );

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
    markers.current = located.map((g) => {
      const loc = g.approxLocation!;
      const el = document.createElement('div');
      el.style.cssText =
        'width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
        'background:#22c55e;border:2px solid #0b0f17;cursor:pointer;box-shadow:0 0 0 2px #22c55e55;';
      el.title = g.title;
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([loc.lng, loc.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
            `<div style="font-weight:600">${escapeHtml(g.title)}</div>` +
              `<div style="font-size:11px;color:#64748b">${escapeHtml(gl.stages(g.stageCount))} · ${escapeHtml(gl.plays(g.playCount))}</div>`,
          ),
        )
        .addTo(map.current!);
      el.addEventListener('click', () => onSelectRef.current(g.id));
      return m;
    });

    // Frame all located games.
    if (located.length > 0) {
      const pts = located.map((g) => [g.approxLocation!.lng, g.approxLocation!.lat] as [number, number]);
      if (pts.length === 1) {
        map.current.easeTo({ center: pts[0], zoom: 11 });
      } else {
        const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
        pts.forEach((p) => b.extend(p));
        map.current.fitBounds(b, { padding: 60, maxZoom: 12, duration: 500 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(located.map((g) => [g.id, g.approxLocation?.lat, g.approxLocation?.lng]))]);

  return (
    <div className="relative">
      <div ref={ref} className={`rounded-xl overflow-hidden border border-glass-border ${className}`} />
      <MapModeToggle mode={mode} onChange={setMode} />
      {located.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-app-bg/80 text-zinc-400 text-xs px-3 py-1.5 rounded-full">
            {gl.noLocatedGames}
          </span>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
