// Map-based location picker for the Builder (§13ב — "מיקום על מפה").
// Click anywhere to place the task; drag the marker to fine-tune. Numeric
// lat/lng stay available alongside it for precision.
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, isValidCoord } from '@rushpoint/shared';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
// Sensible default view when a task has no coordinates yet (central Israel).
const DEFAULT_CENTER: [number, number] = [35.21, 31.77];

export default function LocationPicker({
  lat, lng, onChange, className = '',
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const hasCoord = isValidCoord(lat, lng) && (lat !== 0 || lng !== 0);

  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: hasCoord ? [lng, lat] : DEFAULT_CENTER,
      zoom: hasCoord ? 14 : 8,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const place = (lngLat: maplibregl.LngLat) => {
      setMarker(lngLat.lat, lngLat.lng);
      onChangeRef.current(round(lngLat.lat), round(lngLat.lng));
    };
    map.current.on('click', (e) => place(e.lngLat));

    if (hasCoord) setMarker(lat, lng);
    return () => { map.current?.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external numeric edits onto the marker/center.
  useEffect(() => {
    if (!map.current) return;
    if (hasCoord) {
      setMarker(lat, lng);
      map.current.easeTo({ center: [lng, lat], duration: 300 });
    } else {
      marker.current?.remove();
      marker.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  function setMarker(la: number, ln: number) {
    if (!map.current) return;
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ color: '#22c55e', draggable: true });
      marker.current.on('dragend', () => {
        const p = marker.current!.getLngLat();
        onChangeRef.current(round(p.lat), round(p.lng));
      });
    }
    marker.current.setLngLat([ln, la]).addTo(map.current);
  }

  return (
    <div className="relative">
      <div ref={ref} className={`rounded-lg overflow-hidden border border-glass-border ${className}`} />
      {!hasCoord && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-app-bg/80 text-zinc-300 text-xs px-3 py-1.5 rounded-full">
            Tap the map to set the task location
          </span>
        </div>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
