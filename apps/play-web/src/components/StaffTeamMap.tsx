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
import { FIRESTORE_PATHS, resolveMapStyle, isValidCoord, teamMarkerLook, FOLLOWED_MARKER_COLOR, teamMarkerColor, shouldAutoFrame, isUserCameraEvent, USER_MAP_INPUTS } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useT } from '../i18nContext';
import { locationAge, type MissionSpot } from '../lib/staffMap';
import { Icon, iconSvgMarkup } from './Icon';
import { mapLocale } from '../lib/mapLocale';

// Hebrew labels must not render backwards on the satellite style. See lib/mapRtl.
ensureRtlTextPlugin(maplibregl);

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

// Calm hues only, one shared palette (never red/amber, which mean alarm, nor the followed purple):
// packages/shared/src/teamMarkerColor.ts.
const colorForTeam = teamMarkerColor;

/**
 * followed-teams: how one team's dot and label look. A followed team is a bigger purple dot with a star
 * and a bold name, drawn above the rest; with "mine only" every other team is dimmed, never hidden.
 * Opacity lives on the dot and label, never the marker element (MapLibre owns that one's opacity).
 */
function applyTeamLook(el: HTMLDivElement, teamId: string, stale: boolean, followed: readonly string[], mineOnly: boolean) {
  const look = teamMarkerLook(teamId, followed, mineOnly);
  const dot = el.firstElementChild as HTMLDivElement | null;
  const label = el.querySelector('span');
  const opacity = look.dimmed ? '0.3' : stale ? '0.45' : '1';
  if (dot) {
    const size = look.followed ? 24 : 18;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.background = look.followed ? FOLLOWED_MARKER_COLOR : colorForTeam(teamId);
    dot.style.display = 'flex';
    dot.style.alignItems = 'center';
    dot.style.justifyContent = 'center';
    dot.style.font = '700 13px system-ui';
    dot.style.color = '#fff';
    dot.innerHTML = look.followed ? iconSvgMarkup('star', 14, '#ffffff', true) : '';
    dot.style.opacity = opacity;
  }
  if (label) {
    label.style.border = look.followed ? `2px solid ${FOLLOWED_MARKER_COLOR}` : 'none';
    label.style.fontWeight = look.followed ? '800' : '600';
    label.style.opacity = opacity;
  }
  el.style.zIndex = String(look.zIndex);
  el.dataset.followed = look.followed ? '1' : '0';
}

interface TeamLoc {
  teamId: string;
  lat: number;
  lng: number;
  updatedAt?: string;
}

export default function StaffTeamMap({
  ctx, teams, spots = [], followed = [], mineOnly = false,
}: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: { id: string; displayName: string }[];
  /** staff-event-map: where the missions are (getRunOutline `spot`), drawn under the teams. */
  spots?: MissionSpot[];
  /** followed-teams: this person's teams, drawn in purple with a star. */
  followed?: readonly string[];
  /** followed-teams: dim everyone else. */
  mineOnly?: boolean;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // One persistent marker per team, updated in place rather than torn down on each
  // ping — a full rebuild every few seconds closes any popup the marshal just opened.
  const markersById = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLDivElement; popup: maplibregl.Popup }>>(new Map());
  const spotMarkers = useRef<maplibregl.Marker[]>([]);
  const framedKey = useRef<string>('');
  // Issue 52: once the marshal moves the map, it never moves itself again ("show all" is the way back).
  const userMoved = useRef(false);
  const [locs, setLocs] = useState<TeamLoc[]>([]);
  // Re-renders the "updated N min ago" lines and the faded dots once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The restyle effect keys on the list's CONTENT, not the array identity (a new array every render).
  const followedKey = followed.join(',');

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
      locale: mapLocale(t.mapUi),
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: [35.2137, 31.7683],
      zoom: 12,
      attributionControl: false,
    });
    // No GeolocateControl: play-web runs exactly ONE geolocation watch (see
    // lib/recenter.ts) and a second watcher here would double the GPS drain on a
    // phone that has to survive a whole event.
    const m = map.current;
    m.on('movestart', (e) => { if (isUserCameraEvent(e)) userMoved.current = true; });
    // A wheel zoom's movestart carries no DOM event, so the canvas input itself also counts (7.10).
    for (const type of USER_MAP_INPUTS) m.getCanvas().addEventListener(type, () => { userMoved.current = true; }, { passive: true });
    const markers = markersById.current;
    return () => { m.remove(); map.current = null; markers.clear(); spotMarkers.current = []; };
  }, []);

  // staff-event-map: the missions, as small numbered squares UNDER the team dots. Rebuilt only
  // when the set of spots changes (the outline is fetched once).
  const spotsKey = spots.map((sp) => `${sp.id}:${sp.lat}:${sp.lng}:${sp.hidden ? 1 : 0}`).join('|');
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of spotMarkers.current) mk.remove();
    spotMarkers.current = spots.map((sp) => {
      const el = document.createElement('div');
      el.textContent = String(sp.stage);
      el.style.cssText = `width:20px;height:20px;border-radius:5px;display:flex;align-items:center;justify-content:center;font:700 11px system-ui;color:#fff;background:${sp.hidden ? '#6b7280' : '#b45309'};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);opacity:.9`;
      el.setAttribute('aria-label', sp.title);
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
        `<div dir="auto" style="font-size:13px;font-weight:600">${escapeHtml(sp.title)}</div>`
        + `<div dir="auto" style="font-size:12px;opacity:.75">${escapeHtml(sp.hidden ? t.staff.teamMapHiddenMission : t.staff.teamMapMissionStage({ stage: sp.stage }))}</div>`,
      );
      return new maplibregl.Marker({ element: el }).setLngLat([sp.lng, sp.lat]).setPopup(popup).addTo(m);
    });
    // Frame the missions before any team has reported, so the map opens on the event, not on a default city.
    if (framedKey.current === '' && spots.length > 0 && locs.length === 0) {
      const b = new maplibregl.LngLatBounds();
      for (const sp of spots) b.extend([sp.lng, sp.lat]);
      if (spots.length === 1) m.easeTo({ center: [spots[0].lng, spots[0].lat], zoom: 15 });
      else m.fitBounds(b, { padding: 40, maxZoom: 16, duration: 0 });
    }
  }, [spotsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync team markers to the live positions: a name label beside each dot, faded when stale.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();

    for (const loc of locs) {
      seen.add(loc.teamId);
      const age = locationAge(loc.updatedAt, now);
      const name = nameOf(loc.teamId);
      const dir = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=walking`;
      const html = `<div dir="auto" style="font-size:13px;font-weight:600;margin-bottom:2px">${escapeHtml(name)}</div>`
        + `<div dir="auto" style="font-size:12px;opacity:.75;margin-bottom:4px">${escapeHtml(t.staff.teamMapUpdated({ min: age.minutes }))}</div>`
        // The popup carries the one action a marshal actually wants from a pin:
        // walking directions. Reuses the same maps deep-link shape the SOS alert
        // rows already use, so there is one "navigate there" convention in the app.
        + `<a href="${dir}" target="_blank" rel="noreferrer" style="font-size:12px;text-decoration:underline">${escapeHtml(t.staff.teamMapOpen)}</a>`;
      const existing = markersById.current.get(loc.teamId);
      if (existing) {
        existing.marker.setLngLat([loc.lng, loc.lat]);
        existing.popup.setHTML(html);
        existing.el.dataset.stale = age.stale ? '1' : '0';
        const label = existing.el.querySelector('span');
        if (label) label.textContent = name;
        applyTeamLook(existing.el, loc.teamId, age.stale, followed, mineOnly);
        continue;
      }
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;gap:4px;pointer-events:auto';
      el.dataset.stale = age.stale ? '1' : '0';
      const dot = document.createElement('div');
      dot.style.cssText = `width:18px;height:18px;border-radius:9999px;border:2px solid #fff;background:${colorForTeam(loc.teamId)};box-shadow:0 1px 4px rgba(0,0,0,.4);flex:none`;
      const label = document.createElement('span');
      label.textContent = name;
      label.setAttribute('dir', 'auto');
      label.style.cssText = 'font:600 11px system-ui;color:#111;background:rgba(255,255,255,.9);border-radius:6px;padding:1px 5px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 2px rgba(0,0,0,.25)';
      el.append(dot, label);
      applyTeamLook(el, loc.teamId, age.stale, followed, mineOnly);
      el.setAttribute('aria-label', name);
      const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(html);
      const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [-9, 0] }).setLngLat([loc.lng, loc.lat]).setPopup(popup).addTo(m);
      markersById.current.set(loc.teamId, { marker, el, popup });
    }

    // Drop markers for teams that no longer report (e.g. after a data prune).
    for (const [teamId, entry] of markersById.current) {
      if (!seen.has(teamId)) { entry.marker.remove(); markersById.current.delete(teamId); }
    }

    // Frame the group only when the SET of teams changes, not on every ping —
    // otherwise the camera yanks itself around while a marshal is reading it.
    // ...and never after the marshal has moved the map (issue 52, 7.10: it zoomed out on its own).
    const key = [...seen].sort().join(',');
    if (shouldAutoFrame({ presentKey: key, framedKey: framedKey.current, userMoved: userMoved.current, count: seen.size })) {
      framedKey.current = key;
      frameAll(m);
    }
  }, [locs, nameOf, now, spotsKey, t, followedKey, mineOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  function frameAll(m: maplibregl.Map) {
    const bounds = new maplibregl.LngLatBounds();
    for (const loc of locs) bounds.extend([loc.lng, loc.lat]);
    for (const sp of spots) bounds.extend([sp.lng, sp.lat]);
    if (locs.length === 1 && spots.length === 0) {
      m.easeTo({ center: [locs[0].lng, locs[0].lat], zoom: 15 });
    } else if (!bounds.isEmpty()) {
      m.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 400 });
    }
  }

  const showTeam = (loc: TeamLoc) => {
    const entry = markersById.current.get(loc.teamId);
    map.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 16, duration: 500 });
    if (entry && !entry.popup.isOpen()) entry.marker.togglePopup();
  };
  const reported = new Set(locs.map((l) => l.teamId));
  const noFix = teams.filter((tm) => !reported.has(tm.id)).length;
  // followed-teams: my teams first in the list under the map, then everyone by name.
  const rows = [...locs].sort((a, b) =>
    Number(followed.includes(b.teamId)) - Number(followed.includes(a.teamId)) || nameOf(a.teamId).localeCompare(nameOf(b.teamId)));

  return (
    <div>
      <div className="relative">
        <div ref={ref} className="h-80 w-full rounded-xl overflow-hidden border border-glass-border" data-testid="staff-map" />
        {locs.length > 0 && (
          <button type="button" data-testid="staff-map-show-all"
            onClick={() => { if (!map.current) return; userMoved.current = false; frameAll(map.current); }}
            className="absolute top-2 start-2 min-h-[36px] px-3 rounded-full bg-app-card/95 border border-glass-border text-xs font-semibold text-zinc-100 shadow hover:border-accent/50">
            {t.staff.mapShowAll}
          </button>
        )}
      </div>
      {locs.length === 0 ? (
        <p className="text-zinc-500 text-sm mt-2">{t.staff.teamMapEmpty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-glass-border rounded-xl border border-glass-border bg-app-card" data-testid="staff-map-teams" aria-label={t.staff.teamMapLegendTeams}>
          {rows.map((loc) => {
            const age = locationAge(loc.updatedAt, now);
            return (
              <li key={loc.teamId}>
                <button type="button" onClick={() => showTeam(loc)} aria-label={t.staff.teamMapShowTeam({ name: nameOf(loc.teamId) })}
                  className={`w-full min-h-[44px] flex items-center gap-2 px-3 text-start ${age.stale ? 'opacity-60' : ''}`}>
                  <span aria-hidden className="w-3 h-3 rounded-full shrink-0 border border-white" style={{ background: followed.includes(loc.teamId) ? FOLLOWED_MARKER_COLOR : colorForTeam(loc.teamId) }} />
                  {followed.includes(loc.teamId) && <Icon name="star" className="w-4 h-4 shrink-0 fill-current" style={{ color: FOLLOWED_MARKER_COLOR }} />}
                  <span dir="auto" className="flex-1 truncate text-sm text-zinc-100">{nameOf(loc.teamId)}</span>
                  <span dir="auto" className="text-xs text-zinc-500 shrink-0">{t.staff.teamMapUpdated({ min: age.minutes })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {noFix > 0 && locs.length > 0 && (
        <p className="text-zinc-500 text-xs mt-1" dir="auto">{t.staff.teamMapNoFix({ n: noFix })}</p>
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
