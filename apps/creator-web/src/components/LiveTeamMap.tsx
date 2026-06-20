// Live team map for the Run Console — every team's last reported GPS position as
// a marker, fed by an onSnapshot listener on the run's teamLocations collection
// (written by the play app's throttled updateLocation pings). Map/Satellite toggle.
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { resolveMapStyle, isValidCoord, type MapMode } from '@rushpoint/shared';
import { db } from '../services/firebase';
import MapModeToggle from './MapModeToggle';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

// A few distinct hues so adjacent teams are visually separable.
const COLORS = ['#22c55e', '#3b82f6', '#f97316', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

interface TeamLoc {
  teamId: string;
  lat: number;
  lng: number;
}

export default function LiveTeamMap({
  ownerUid, gameId, runId, teams, className = '',
}: {
  ownerUid: string;
  gameId: string;
  runId: string;
  teams: { id: string; displayName: string }[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [mode, setMode] = useState<MapMode>('topo');
  const [locs, setLocs] = useState<TeamLoc[]>([]);

  // Resolve a team id → display name for popups.
  const nameOf = useMemo(() => {
    const m = new Map(teams.map((t) => [t.id, t.displayName]));
    return (id: string) => m.get(id) ?? id;
  }, [teams]);

  // Live-subscribe to the run's reported team locations.
  useEffect(() => {
    const col = collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/teamLocations`);
    return onSnapshot(col, (snap) => {
      setLocs(
        snap.docs
          .map((d) => d.data() as TeamLoc)
          .filter((l) => isValidCoord(l.lat, l.lng) && (l.lat !== 0 || l.lng !== 0)),
      );
    });
  }, [ownerUid, gameId, runId]);

  // Create the map once.
  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: [35.21, 31.77],
      zoom: 7,
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

  // Recreate markers whenever the reported locations change, and frame them.
  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((m) => m.remove());
    markers.current = locs.map((l, i) => {
      const color = COLORS[i % COLORS.length];
      const el = document.createElement('div');
      el.style.cssText =
        `width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
        `background:${color};border:2px solid #fff;cursor:pointer;box-shadow:0 0 0 2px ${color}55;`;
      el.title = nameOf(l.teamId);
      return new maplibregl.Marker({ element: el })
        .setLngLat([l.lng, l.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
            `<div style="font-weight:600">${escapeHtml(nameOf(l.teamId))}</div>`,
          ),
        )
        .addTo(map.current!);
    });

    // Frame all reported teams.
    if (locs.length > 0) {
      const pts = locs.map((l) => [l.lng, l.lat] as [number, number]);
      if (pts.length === 1) {
        map.current.easeTo({ center: pts[0], zoom: 13 });
      } else {
        const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
        pts.forEach((p) => b.extend(p));
        map.current.fitBounds(b, { padding: 60, maxZoom: 15, duration: 500 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(locs.map((l) => [l.teamId, l.lat, l.lng]))]);

  return (
    <div className="relative">
      <div ref={ref} className={`rounded-xl overflow-hidden border border-glass-border ${className}`} />
      <MapModeToggle mode={mode} onChange={setMode} />
      {locs.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-app-card/90 text-zinc-500 text-xs px-3 py-1.5 rounded-full">
            Waiting for teams to report their location…
          </span>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
