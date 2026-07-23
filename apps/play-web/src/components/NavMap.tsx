// Live navigation map for participants — a central element, not a side tab (§13א).
// Shows the active stage's task location(s) and the participant's live GPS dot,
// framed together so "where am I vs. where do I go" is always visible.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, isValidCoord, isHotZoneActive, circlePolygonGeoJSON, type MapMode, type HotZone, type CaptureZone } from '@rushpoint/shared';
import MapModeToggle from './MapModeToggle';
import { useT } from '../i18nContext';
import type { MapSearchArea } from '../lib/searchAreas';
import { recenterVerdict } from '../lib/recenter';

export interface NavTarget {
  id: string;
  lat: number;
  lng: number;
  title: string;
  active: boolean;   // the task currently assigned to this team
}

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
const HOT_ZONE_SOURCE = 'hot-zone';
const ZONES_SOURCE = 'capture-zones';
// Sealed hidden-mission search circles (change: hidden-mission-search-area).
// Violet + DASHED on purpose: a solid pin says "the spot is here", a dashed area
// says "it is somewhere in here". A player must never confuse the two, so the
// search area deliberately does NOT use the game's accent colour.
const SEARCH_SOURCE = 'search-areas';
const SEARCH_COLOR = '#8B5CF6';

// Capturable-territory circle color by holder (change: fix-territory-map-visibility):
// mine = green, a rival's = red, unclaimed = slate. Static hex (painted by the map,
// not Tailwind) so it never becomes a dynamic class string.
function zoneColor(z: CaptureZone, myTeamId?: string): string {
  if (!z.ownerTeamId) return '#94A3B8';
  return z.ownerTeamId === myTeamId ? '#22C55E' : '#EF4444';
}

export default function NavMap({
  targets, me, hotZone = null, zones = [], searchAreas = [], myTeamId, accent = '#F97316', className = '', keepMapWithMe = false,
}: {
  targets: NavTarget[];
  me?: { lat: number; lng: number } | null;
  hotZone?: HotZone | null;
  zones?: CaptureZone[];
  // Sealed hidden-mission search circles (change: hidden-mission-search-area).
  // Already validated + clamped by `selectSearchAreas`; this component draws what
  // it is given and makes no second judgement about it.
  searchAreas?: MapSearchArea[];
  myTeamId?: string;
  accent?: string;
  className?: string;
  // Hidden-mission map (change: hidden-mission-map): keep the map alive showing
  // just the player's own GPS dot even when there is no target pin and no overlay
  // — used while the active mission is a still-sealed hidden target so the player
  // still sees where they are (plus any completed-mission trail pins passed as
  // targets). Off by default, so every other caller's placeholder-when-empty
  // behavior (e.g. a locationless-only stage) is byte-identical to before.
  keepMapWithMe?: boolean;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const fitted = useRef(false);
  const [mode, setMode] = useState<MapMode>('topo');

  const valid = targets.filter((t) => isValidCoord(t.lat, t.lng) && (t.lat !== 0 || t.lng !== 0));

  // Territory zones / hot zone are worth a map even when NO task has a pin
  // (change: fix-territory-map-visibility): a zones-only moment, or a stage of
  // only locationless/hidden tasks, must still show the capture circles. Without
  // this the component early-returns a placeholder and the map is never created,
  // so applyZones has nothing to draw on.
  const overlayPts = [
    ...(zones ?? []).filter((z) => z.center && isValidCoord(z.center.lat, z.center.lng)).map((z) => ({ lat: z.center.lat, lng: z.center.lng })),
    ...(isHotZoneActive(hotZone, Date.now()) && hotZone ? [{ lat: hotZone.center.lat, lng: hotZone.center.lng }] : []),
    // A sealed hidden mission's search circle is a real overlay, so it keeps the
    // map alive and frames the initial fit on its own — the map no longer has to
    // be propped up by `keepMapWithMe` when there is an area to draw.
    ...(searchAreas ?? []).map((s) => ({ lat: s.lat, lng: s.lng })),
  ];
  const hasOverlay = overlayPts.length > 0;

  // Hidden-mission map: with no target pin and no overlay, a valid `me` alone is
  // enough to keep the map alive (show the GPS dot) when the caller opts in.
  const hasMe = keepMapWithMe && !!me && isValidCoord(me.lat, me.lng);

  // Latest hot zone, read inside styledata (which fires on setStyle) so the
  // overlay is re-applied after a tile-style switch wipes GeoJSON layers.
  const hotZoneRef = useRef<HotZone | null>(hotZone);
  hotZoneRef.current = hotZone;

  // Latest capturable zones + my team, read inside styledata so the overlay is
  // re-applied after a tile-style switch wipes GeoJSON layers.
  const zonesRef = useRef<CaptureZone[]>(zones);
  zonesRef.current = zones;
  const myTeamIdRef = useRef<string | undefined>(myTeamId);
  myTeamIdRef.current = myTeamId;

  // Latest search circles, read inside styledata for the same reason as the two
  // overlays above: a tile-style switch wipes every GeoJSON source and layer.
  const searchRef = useRef<MapSearchArea[]>(searchAreas);
  searchRef.current = searchAreas;

  // Draw / update / remove the sealed hidden-mission search circles. Metres-
  // accurate (a fixed-pixel marker would not scale with zoom), dashed, and with
  // NO centre marker on purpose: a dot in the middle would read as the answer,
  // and the centre is precisely the thing that is not the answer.
  function applySearchAreas(m: maplibregl.Map) {
    if (!m.isStyleLoaded()) return;
    const areas = searchRef.current ?? [];
    const src = m.getSource(SEARCH_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (areas.length > 0) {
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: areas.map((a) => circlePolygonGeoJSON({ lat: a.lat, lng: a.lng }, a.radiusMeters) as GeoJSON.Feature),
      };
      if (src) {
        src.setData(data);
      } else {
        m.addSource(SEARCH_SOURCE, { type: 'geojson', data });
        m.addLayer({ id: `${SEARCH_SOURCE}-fill`, type: 'fill', source: SEARCH_SOURCE,
          paint: { 'fill-color': SEARCH_COLOR, 'fill-opacity': 0.14 } });
        m.addLayer({ id: `${SEARCH_SOURCE}-line`, type: 'line', source: SEARCH_SOURCE,
          paint: { 'line-color': SEARCH_COLOR, 'line-width': 2, 'line-dasharray': [2, 2] } });
      }
    } else {
      if (m.getLayer(`${SEARCH_SOURCE}-fill`)) m.removeLayer(`${SEARCH_SOURCE}-fill`);
      if (m.getLayer(`${SEARCH_SOURCE}-line`)) m.removeLayer(`${SEARCH_SOURCE}-line`);
      if (src) m.removeSource(SEARCH_SOURCE);
    }
  }

  // Draw / update / remove the capturable-territory circles (metres-accurate,
  // holder-colored). One data-driven fill+line pair reads `color` per feature.
  function applyZones(m: maplibregl.Map) {
    if (!m.isStyleLoaded()) return;
    const zs = (zonesRef.current ?? []).filter((z) => z.center && isValidCoord(z.center.lat, z.center.lng));
    const src = m.getSource(ZONES_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (zs.length > 0) {
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: zs.map((z) => {
          const f = circlePolygonGeoJSON(z.center, z.radiusMeters) as GeoJSON.Feature;
          f.properties = { color: zoneColor(z, myTeamIdRef.current) };
          return f;
        }),
      };
      if (src) {
        src.setData(data);
      } else {
        m.addSource(ZONES_SOURCE, { type: 'geojson', data });
        m.addLayer({ id: `${ZONES_SOURCE}-fill`, type: 'fill', source: ZONES_SOURCE,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 } });
        m.addLayer({ id: `${ZONES_SOURCE}-line`, type: 'line', source: ZONES_SOURCE,
          paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
      }
    } else {
      if (m.getLayer(`${ZONES_SOURCE}-fill`)) m.removeLayer(`${ZONES_SOURCE}-fill`);
      if (m.getLayer(`${ZONES_SOURCE}-line`)) m.removeLayer(`${ZONES_SOURCE}-line`);
      if (src) m.removeSource(ZONES_SOURCE);
    }
  }

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
    const first = valid[0] ?? overlayPts[0] ?? (hasMe && me ? { lat: me.lat, lng: me.lng } : undefined);
    map.current = new maplibregl.Map({
      container: ref.current,
      // Honor the current mode so a map RE-created after its targets briefly
      // emptied (which tears the map down) comes back in the tile style the user
      // last chose, instead of silently reverting to topo while the toggle still
      // reads "satellite". First mount: mode is 'topo', so this is unchanged.
      style: resolveMapStyle(KEY, mode) as maplibregl.StyleSpecification | string,
      center: first ? [first.lng, first.lat] : [35.21, 31.77],
      zoom: first ? 14 : 7,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // MapLibre's GeolocateControl was REMOVED here (change: play-map-recenter-control).
    // It opened a SECOND watchPosition alongside the one PlayScreen already runs
    // (two GPS subscriptions on a racing phone), re-triggered the permission
    // prompt, recentred on its OWN fix — which could disagree with the blue dot
    // the app drew from the app's fix — and on a denial failed silently while
    // still looking tappable, under MapLibre's own hardcoded English name on a
    // Hebrew-default app. The labelled RecenterButton below replaces it and flies
    // to the same position the marker is drawn from.
    // styledata fires on initial load AND after each setStyle (mode toggle),
    // which wipes GeoJSON sources/layers — re-apply the overlay each time.
    map.current.on('styledata', () => { if (map.current) { applyHotZone(map.current); applyZones(map.current); applySearchAreas(map.current); } });
    return () => { map.current?.remove(); map.current = null; };
    // Re-run when the map container appears/disappears: while `valid` is empty the
    // component renders a placeholder with NO ref div, so a NavMap that mounts
    // before its targets load would otherwise create the map against a null ref
    // once and never retry — a permanently blank map. Keyed on emptiness (not the
    // full target list) so the happy path, where targets are present throughout,
    // is byte-identical to `[]` (the value never changes, so it fires once).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid.length === 0 && !hasOverlay && !hasMe]);

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

  // Re-apply zone circles when a zone is added, moved, or changes holder
  // (recolor after a capture). Keyed on a stable signature so it fires only on a
  // real change, not on every GPS ping.
  useEffect(() => {
    if (map.current) applyZones(map.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify((zones ?? []).map((z) => [z.id, z.ownerTeamId, z.radiusMeters, z.center?.lat, z.center?.lng])), myTeamId]);

  // Re-apply the search circles when a mission is sealed/unsealed or its area
  // moves. Keyed on a stable signature so a GPS ping does not redraw them.
  useEffect(() => {
    if (map.current) applySearchAreas(map.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify((searchAreas ?? []).map((s) => [s.id, s.lat, s.lng, s.radiusMeters]))]);

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
    overlayPts.forEach((p) => pts.push([p.lng, p.lat]));
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

  // "Focus back on me" (change: play-map-recenter-control). The map frames its
  // content ONCE (`fitted`) and then never moves again, so a stray thumb drag —
  // the normal case on a 208px strip held while walking — used to leave the
  // player with no way back to their own dot. The verdict is computed by a pure
  // module (lib/recenter.ts) so the "is there a fix, and where does the camera
  // land" decision is testable; play-web has no component test runner.
  const rc = recenterVerdict(me);
  function recenter() {
    // Re-check rather than trusting the render-time verdict: a click can race a
    // fix disappearing, and easeTo with a non-finite centre leaves MapLibre in a
    // permanently broken camera state. A no-op is the correct outcome.
    const v = recenterVerdict(me);
    if (!map.current || !v.enabled || !v.center) return;
    map.current.easeTo({ center: v.center, zoom: v.zoom, duration: 500 });
  }

  if (valid.length === 0 && !hasOverlay && !hasMe) {
    return (
      <div className={`rounded-2xl bg-app-card border border-glass-border flex items-center justify-center text-zinc-500 text-sm ${className}`}>
        {t.task.mapAppears}
      </div>
    );
  }

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-glass-border ${className}`}>
      <div ref={ref} className="w-full h-full" />
      <MapModeToggle mode={mode} onChange={setMode} />
      {/* Sits directly under MapModeToggle (top-2, 44px tall), clear of
          MapLibre's NavigationControl (top-right) and the compact attribution
          (bottom-right). Logical `start-2` so it mirrors correctly in Hebrew. */}
      <button
        type="button"
        onClick={recenter}
        disabled={!rc.enabled}
        aria-label={rc.enabled ? t.play.recenter : t.play.recenterNoFix}
        title={rc.enabled ? t.play.recenter : t.play.recenterNoFix}
        className="absolute top-14 start-2 z-10 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-app-card/90 backdrop-blur border border-glass-border shadow-soft text-[11px] font-medium text-zinc-100 disabled:opacity-50"
      >
        <span aria-hidden="true">◎</span>
        {t.play.recenter}
      </button>
      {/* Legend for the dashed circle. Centred via a symmetric `inset-x-0` +
          flex rather than a physical offset, so it never lands on MapLibre's
          bottom-right attribution in either reading direction, and
          `pointer-events-none` so it can never eat a map drag. */}
      {(searchAreas ?? []).length > 0 && (
        <div className="absolute bottom-2 inset-x-0 z-10 flex justify-center pointer-events-none">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-app-card/90 backdrop-blur border border-glass-border px-2 py-1 text-[11px] font-medium text-zinc-400">
            <span aria-hidden="true" className="inline-block w-3 h-3 rounded-full border-2 border-dashed" style={{ borderColor: SEARCH_COLOR }} />
            {t.play.searchAreaLegend}
          </span>
        </div>
      )}
    </div>
  );
}
