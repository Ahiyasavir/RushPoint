// Live team map for the MOBILE staff console (change: staff-console-field-ops).
//
// Before this, a marshal's only positional signal was the single Google-Maps link
// attached to an SOS alert — they could see where an emergency was, but never where
// anyone else had got to, which is exactly what "is the whole group stuck at
// station 3?" needs.
//
// Deliberately NOT shared with creator-web's LiveTeamMap: `packages/shared` is
// framework-free (no React dependency), and the two surfaces have genuinely
// different requirements — that one is a desktop panel with a map/satellite toggle
// and hover popups; this one is a phone-sized viewport where a popup is a tap
// target and the useful action is "navigate me there". Same DATA contract
// (teamLocations), different presentation. The same trade-off CLAUDE.md records for
// lazyWithRetry.
//
// This module is the reason MapLibre must stay lazy: it is imported ONLY through
// lazyWithRetry from a collapsed-by-default section, so the library never enters
// play-web's entry chunk. `npm run bundle:budget` asserts that directly.
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { ensureRtlTextPlugin } from '../lib/mapRtl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { FIRESTORE_PATHS, resolveMapStyle, isValidCoord } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useT } from '../i18nContext';

// Hebrew labels must not render backwards on the satellite style. See lib/mapRtl.
ensureRtlTextPlugin(maplibregl);

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

// A few distinct hues so adjacent teams are separable at a glance.
const COLORS = ['#22c55e', '#3b82f6', '#f97316', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

/** Stable colour per team, derived from the id rather than the snapshot index, so a
 *  team keeps its hue as others join and reorder the docs. */
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

export default function StaffTeamMap({
  ctx, teams,
}: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: { id: string; displayName: string }[];
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // One persistent marker per team, updated in place rather than torn down on each
  // ping — a full rebuild every few seconds closes any popup the marshal just opened.
  const markersById = useRef<Map<string, maplibregl.Marker>>(new Map());
  const framedKey = useRef<string>('');
  const [locs, setLocs] = useState<TeamLoc[]>([]);

  const nameOf = useMemo(() => {
    const m = new Map(teams.map((tm) => [tm.id, tm.displayName]));
    return (id: string) => m.get(id) ?? id.slice(0, 8);
  }, [teams]);

  // Live team positions. A team with no ping yet simply has no doc, and a doc with
  // unusable coordinates is dropped rather than rendered at null island — a marker
  // off the coast of Africa reads as a real team in trouble.
  useEffect(() => {
    const col = collection(db, `${FIRESTORE_PATHS.run(ctx.ownerUid, ctx.gameId, ctx.runId)}/teamLocations`);
    return onSnapshot(col, (snap) => {
      setLocs(
        snap.docs
          .map((d) => d.data() as TeamLoc)
          .filter((l) => isValidCoord(l?.lat, l?.lng) && (l.lat !== 0 || l.lng !== 0)),
      );
    // A read failure degrades to an empty map, never an error banner: a staff token
    // minted before this feature's rule shipped legitimately cannot read this
    // collection, and that must not look like an outage mid-event.
    }, () => setLocs([]));
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);

  // Create the map once.
  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: [35.2137, 31.7683],
      zoom: 12,
      attributionControl: false,
    });
    // No GeolocateControl: play-web runs exactly ONE geolocation watch (see
    // lib/recenter.ts) and a second watcher here would double the GPS drain on a
    // phone that has to survive a whole event.
    const m = map.current;
    return () => { m.remove(); map.current = null; markersById.current.clear(); };
  }, []);

  // Sync markers to the live positions.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();

    for (const loc of locs) {
      seen.add(loc.teamId);
      const existing = markersById.current.get(loc.teamId);
      if (existing) {
        existing.setLngLat([loc.lng, loc.lat]);
        continue;
      }
      const el = document.createElement('div');
      el.style.cssText = `width:18px;height:18px;border-radius:9999px;border:2px solid #fff;background:${colorForTeam(loc.teamId)};box-shadow:0 1px 4px rgba(0,0,0,.4)`;
      el.setAttribute('aria-label', nameOf(loc.teamId));
      // The popup carries the one action a marshal actually wants from a pin:
      // walking directions. Reuses the same maps deep-link shape the SOS alert
      // rows already use, so there is one "navigate there" convention in the app.
      const dir = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=walking`;
      const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
        `<div dir="auto" style="font-size:13px;font-weight:600;margin-bottom:4px">${escapeHtml(nameOf(loc.teamId))}</div>`
        + `<a href="${dir}" target="_blank" rel="noreferrer" style="font-size:12px;text-decoration:underline">${escapeHtml(t.staff.teamMapOpen)}</a>`,
      );
      markersById.current.set(
        loc.teamId,
        new maplibregl.Marker({ element: el }).setLngLat([loc.lng, loc.lat]).setPopup(popup).addTo(m),
      );
    }

    // Drop markers for teams that no longer report (e.g. after a data prune).
    for (const [teamId, marker] of markersById.current) {
      if (!seen.has(teamId)) { marker.remove(); markersById.current.delete(teamId); }
    }

    // Frame the group only when the SET of teams changes, not on every ping —
    // otherwise the camera yanks itself around while a marshal is reading it.
    const key = [...seen].sort().join(',');
    if (key && key !== framedKey.current) {
      framedKey.current = key;
      const bounds = new maplibregl.LngLatBounds();
      for (const loc of locs) bounds.extend([loc.lng, loc.lat]);
      if (locs.length === 1) {
        m.easeTo({ center: [locs[0].lng, locs[0].lat], zoom: 15 });
      } else if (!bounds.isEmpty()) {
        m.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 400 });
      }
    }
  }, [locs, nameOf, t.staff.teamMapOpen]);

  return (
    <div>
      <div ref={ref} className="h-56 w-full rounded-xl overflow-hidden border border-glass-border" />
      {locs.length === 0 && (
        <p className="text-zinc-500 text-sm mt-2">{t.staff.teamMapEmpty}</p>
      )}
    </div>
  );
}

/** Popup content is built as an HTML string (MapLibre's API), and a team's display
 *  name is participant-authored — so it is escaped rather than interpolated raw. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
