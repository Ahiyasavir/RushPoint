// Live navigation map for participants — a central element, not a side tab (§13א).
// Shows the active stage's task location(s) and the participant's live GPS dot,
// framed together so "where am I vs. where do I go" is always visible.
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, isValidCoord } from '@rushpoint/shared';

export interface NavTarget {
  id: string;
  lat: number;
  lng: number;
  title: string;
  active: boolean;   // the task currently assigned to this team
}

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

export default function NavMap({
  targets, me, accent = '#22D3EE', className = '',
}: {
  targets: NavTarget[];
  me?: { lat: number; lng: number } | null;
  accent?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const fitted = useRef(false);

  const valid = targets.filter((t) => isValidCoord(t.lat, t.lng) && (t.lat !== 0 || t.lng !== 0));

  // Create the map once.
  useEffect(() => {
    if (!ref.current || map.current) return;
    const first = valid[0];
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: first ? [first.lng, first.lat] : [35.21, 31.77],
      zoom: first ? 14 : 7,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: true }),
      'top-right',
    );
    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync target markers.
  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((m) => m.remove());
    markers.current = valid.map((t) => {
      const el = document.createElement('div');
      el.style.cssText = `width:${t.active ? 22 : 16}px;height:${t.active ? 22 : 16}px;border-radius:50%;
        background:${t.active ? accent : '#64748b'};border:3px solid #0b0f17;
        box-shadow:0 0 0 2px ${t.active ? accent : '#475569'};cursor:pointer;`;
      return new maplibregl.Marker({ element: el })
        .setLngLat([t.lng, t.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(t.title))
        .addTo(map.current!);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(valid.map((t) => [t.id, t.lat, t.lng, t.active])), accent]);

  // Sync the "me" marker.
  useEffect(() => {
    if (!map.current) return;
    if (me && isValidCoord(me.lat, me.lng)) {
      if (!meMarker.current) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 8px #3b82f6;';
        meMarker.current = new maplibregl.Marker({ element: el });
      }
      meMarker.current.setLngLat([me.lng, me.lat]).addTo(map.current);
    } else {
      meMarker.current?.remove();
    }
  }, [me?.lat, me?.lng]);

  // Fit bounds to frame targets + me — once we actually have something to show.
  useEffect(() => {
    if (!map.current || fitted.current) return;
    const pts: [number, number][] = valid.map((t) => [t.lng, t.lat]);
    if (me && isValidCoord(me.lat, me.lng)) pts.push([me.lng, me.lat]);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.current.easeTo({ center: pts[0], zoom: 14 });
    } else {
      const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((p) => b.extend(p));
      map.current.fitBounds(b, { padding: 56, maxZoom: 16, duration: 600 });
    }
    fitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid.length, me?.lat, me?.lng]);

  if (valid.length === 0) {
    return (
      <div className={`rounded-2xl bg-app-card border border-glass-border flex items-center justify-center text-zinc-600 text-sm ${className}`}>
        Map will appear once your task has a location.
      </div>
    );
  }

  return <div ref={ref} className={`rounded-2xl overflow-hidden border border-glass-border ${className}`} />;
}
