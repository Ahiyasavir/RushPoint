// Live navigation map for participants — a central element, not a side tab (§13א).
// Shows the active stage's task location(s) and the participant's live GPS dot,
// framed together so "where am I vs. where do I go" is always visible.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, isValidCoord, isHotZoneActive, circlePolygonGeoJSON, type MapMode, type HotZone } from '@rushpoint/shared';
import MapModeToggle from './MapModeToggle';
import { useT } from '../i18nContext';

export interface NavTarget {
  id: string;
  lat: number;
  lng: number;
  title: string;
  active: boolean;   // the task currently assigned to this team
}

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
const HOT_ZONE_SOURCE = 'hot-zone';

export default function NavMap({
  targets, me, hotZone = null, accent = '#F97316', className = '',
}: {
  targets: NavTarget[];
  me?: { lat: number; lng: number } | null;
  hotZone?: HotZone | null;
  accent?: string;
  className?: string;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const fitted = useRef(false);
  const [mode, setMode] = useState<MapMode>('topo');

  const valid = targets.filter((t) => isValidCoord(t.lat, t.lng) && (t.lat !== 0 || t.lng !== 0));

  // Latest hot zone, read inside styledata (which fires on setStyle) so the
  // overlay is re-applied after a tile-style switch wipes GeoJSON layers.
  const hotZoneRef = useRef<HotZone | null>(hotZone);
  hotZoneRef.current = hotZone;

  // Draw / update / remove the active hot-zone circle. A metres-radius circle
  // needs a geographic polygon (a fixed-pixel marker wouldn't scale with zoom).
  function applyHotZone(m: maplibregl.Map) {
    if (!m.isStyleLoaded()) return;
    const hz = hotZoneRef.current;
    const active = isHotZoneActive(hz, Date.now());
    const src = m.getSource(HOT_ZONE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (active && hz) {
      const data = circlePolygonGeoJSON(hz.center, hz.radiusMeters) as GeoJSON.Feature;
      if (src) {
        src.setData(data);
      } else {
        m.addSource(HOT_ZONE_SOURCE, { type: 'geojson', data });
        m.addLayer({ id: `${HOT_ZONE_SOURCE}-fill`, type: 'fill', source: HOT_ZONE_SOURCE,
          paint: { 'fill-color': '#F97316', 'fill-opacity': 0.15 } });
        m.addLayer({ id: `${HOT_ZONE_SOURCE}-line`, type: 'line', source: HOT_ZONE_SOURCE,
          paint: { 'line-color': '#F97316', 'line-width': 2 } });
      }
    } else {
      if (m.getLayer(`${HOT_ZONE_SOURCE}-fill`)) m.removeLayer(`${HOT_ZONE_SOURCE}-fill`);
      if (m.getLayer(`${HOT_ZONE_SOURCE}-line`)) m.removeLayer(`${HOT_ZONE_SOURCE}-line`);
      if (src) m.removeSource(HOT_ZONE_SOURCE);
    }
  }

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
    // styledata fires on initial load AND after each setStyle (mode toggle),
    // which wipes GeoJSON sources/layers — re-apply the overlay each time.
    map.current.on('styledata', () => { if (map.current) applyHotZone(map.current); });
    return () => { map.current?.remove(); map.current = null; };
    // Re-run when the map container appears/disappears: while `valid` is empty the
    // component renders a placeholder with NO ref div, so a NavMap that mounts
    // before its targets load would otherwise create the map against a null ref
    // once and never retry — a permanently blank map. Keyed on emptiness (not the
    // full target list) so the happy path, where targets are present throughout,
    // is byte-identical to `[]` (the value never changes, so it fires once).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid.length === 0]);

  // Switch tile style on mode change (HTML markers persist across setStyle).
  useEffect(() => {
    map.current?.setStyle(resolveMapStyle(KEY, mode) as maplibregl.StyleSpecification | string);
  }, [mode]);

  // Re-apply the hot-zone overlay when the zone is activated/expired/moved
  // (no style change involved). Keyed on active-state + centre + radius so it
  // fires only on a real change, not on every GPS ping.
  const hzActive = isHotZoneActive(hotZone, Date.now());
  useEffect(() => {
    if (map.current) applyHotZone(map.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hzActive, hotZone?.center.lat, hotZone?.center.lng, hotZone?.radiusMeters]);

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
        {t.task.mapAppears}
      </div>
    );
  }

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-glass-border ${className}`}>
      <div ref={ref} className="w-full h-full" />
      <MapModeToggle mode={mode} onChange={setMode} />
    </div>
  );
}
