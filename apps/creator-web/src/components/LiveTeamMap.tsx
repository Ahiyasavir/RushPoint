// Live team map for the Run Console — every team's last reported GPS position as
// a marker, fed by an onSnapshot listener on the run's teamLocations collection
// (written by the play app's throttled updateLocation pings). Map/Satellite toggle.
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { ensureRtlTextPlugin } from '../lib/mapRtl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { resolveMapStyle, isValidCoord, type MapMode } from '@rushpoint/shared';
import { db } from '../services/firebase';
import MapModeToggle from './MapModeToggle';
import { useT } from './LanguageContext';

// Hebrew labels must not render backwards on the satellite style. See lib/mapRtl.
ensureRtlTextPlugin(maplibregl);

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

// A few distinct hues so adjacent teams are visually separable.
const COLORS = ['#22c55e', '#3b82f6', '#f97316', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

// Stable color per team: derived from the teamId (not the snapshot array index),
// so a team keeps the same hue even as other teams join and reorder the docs.
function colorForTeam(teamId: string): string {
  let h = 0;
  for (let i = 0; i < teamId.length; i++) h = (h * 31 + teamId.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

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
  const rc = useT().runConsole;
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // One persistent marker per team, keyed by teamId — updated in place on each
  // GPS ping instead of a full teardown, so the map doesn't flicker/close popups.
  const markersById = useRef<Map<string, maplibregl.Marker>>(new Map());
  // The set of teamIds we last framed to — reframe only when the set changes.
  const framedKey = useRef<string>('');
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

  // Update marker positions in place on every GPS ping; create/remove markers
  // only for teams that join/leave. This avoids the full teardown that made the
  // map flicker and slammed popups shut with 20 teams pinging constantly.
  useEffect(() => {
    if (!map.current) return;
    const present = new Set(locs.map((l) => l.teamId));

    // Drop markers for teams no longer reporting.
    for (const [teamId, marker] of markersById.current) {
      if (!present.has(teamId)) { marker.remove(); markersById.current.delete(teamId); }
    }

    // Move existing markers; create new ones for first-seen teams.
    for (const l of locs) {
      const existing = markersById.current.get(l.teamId);
      if (existing) {
        existing.setLngLat([l.lng, l.lat]);
      } else {
        const color = colorForTeam(l.teamId);
        const el = document.createElement('div');
        el.style.cssText =
          `width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
          `background:${color};border:2px solid #fff;cursor:pointer;box-shadow:0 0 0 2px ${color}55;`;
        el.title = nameOf(l.teamId);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([l.lng, l.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
              `<div style="font-weight:600">${escapeHtml(nameOf(l.teamId))}</div>`,
            ),
          )
          .addTo(map.current!);
        markersById.current.set(l.teamId, marker);
      }
    }

    // Frame only when the SET of reporting teams changes (first load or a team
    // joins/leaves) — never on a mere position update, so the map stays put and
    // open popups survive while teams move.
    const key = [...present].sort().join(',');
    if (key !== framedKey.current && locs.length > 0) {
      framedKey.current = key;
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
            {rc.waitingForTeams}
          </span>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
