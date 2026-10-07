// Live team map for the Run Console — every team's last reported GPS position as
// a marker, fed by an onSnapshot listener on the run's teamLocations collection
// (written by the play app's throttled updateLocation pings). Map/Satellite toggle.
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { ensureRtlTextPlugin } from '../lib/mapRtl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { resolveMapStyle, isValidCoord, type MapMode, DEFAULT_MAP_MODE, teamMarkerLook, FOLLOWED_MARKER_COLOR, teamMarkerColor, shouldAutoFrame, isUserCameraEvent } from '@rushpoint/shared';
import { db } from '../services/firebase';
import MapModeToggle from './MapModeToggle';
import { useT } from './LanguageContext';
import { iconSvgMarkup } from './Icon';
import { mapLocale } from '../lib/mapLocale';

// Hebrew labels must not render backwards on the satellite style. See lib/mapRtl.
ensureRtlTextPlugin(maplibregl);

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

// Calm hues only, one shared palette (never red/amber, which mean alarm, nor the followed purple):
// packages/shared/src/teamMarkerColor.ts.
const colorForTeam = teamMarkerColor;

// followed-teams (Ahiya, 2026-09-30: "see them on the map in a different colour"): a followed team is
// a bigger star marker in one fixed indigo with its name, drawn above the rest; "mine only" dims the
// others (never hides them: where the other teams are still matters). Restyled in place, so a marker
// keeps its position and its click handler when the followed set changes.
function styleMarker(el: HTMLElement, teamId: string, name: string, followed: readonly string[], mineOnly: boolean) {
  const look = teamMarkerLook(teamId, followed, mineOnly);
  const pin = el.firstElementChild as HTMLElement | null;
  const label = el.querySelector('[data-follow-label]') as HTMLElement | null;
  if (pin) {
    if (look.followed) {
      pin.style.cssText =
        `width:28px;height:28px;border-radius:50%;background:${FOLLOWED_MARKER_COLOR};border:3px solid #fff;` +
        `box-shadow:0 0 0 3px ${FOLLOWED_MARKER_COLOR}66;display:flex;align-items:center;justify-content:center;` +
        `color:#fff;font-size:15px;line-height:1;cursor:pointer;`;
      pin.innerHTML = iconSvgMarkup('star', 15, '#ffffff', true);
    } else {
      const color = colorForTeam(teamId);
      pin.style.cssText =
        `width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
        `background:${color};border:2px solid #fff;cursor:pointer;box-shadow:0 0 0 2px ${color}55;`;
      pin.textContent = '';
    }
  }
  if (label) {
    label.textContent = look.followed ? name : '';
    label.style.display = look.followed ? 'block' : 'none';
  }
  el.style.opacity = look.dimmed ? '0.3' : '1';
  el.style.zIndex = String(look.zIndex);
  el.dataset.followed = look.followed ? 'true' : 'false';
}

interface TeamLoc {
  teamId: string;
  lat: number;
  lng: number;
}

export default function LiveTeamMap({
  ownerUid, gameId, runId, teams, className = '', onTeamClick, followed = [], mineOnly = false,
}: {
  /** followed-teams: ids this person follows, and whether "mine only" is on. */
  followed?: readonly string[];
  mineOnly?: boolean;
  ownerUid: string;
  gameId: string;
  runId: string;
  teams: { id: string; displayName: string }[];
  className?: string;
  /** team-lifecycle-controls: a click on a team opens its page (field report 2026-09-27). */
  onTeamClick?: (teamId: string) => void;
}) {
  const mapUi = useT().mapUi;
  const rc = useT().runConsole;
  // Markers are created once and moved in place, so they must read the CURRENT handler.
  const onTeamClickRef = useRef(onTeamClick);
  onTeamClickRef.current = onTeamClick;
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // One persistent marker per team, keyed by teamId — updated in place on each
  // GPS ping instead of a full teardown, so the map doesn't flicker/close popups.
  const markersById = useRef<Map<string, maplibregl.Marker>>(new Map());
  // The set of teamIds we last framed to — reframe only when the set changes.
  const framedKey = useRef<string>('');
  // Issue 52: once the person moves the map, it never moves itself again ("show all" is the way back).
  const userMoved = useRef(false);
  const [mode, setMode] = useState<MapMode>(DEFAULT_MAP_MODE);
  const [locs, setLocs] = useState<TeamLoc[]>([]);
  const locsRef = useRef<TeamLoc[]>([]);
  locsRef.current = locs;
  // Read by marker creation, which runs in an effect keyed on positions only.
  const followedRef = useRef(followed);
  followedRef.current = followed;
  const mineOnlyRef = useRef(mineOnly);
  mineOnlyRef.current = mineOnly;

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
      locale: mapLocale(mapUi),
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: [35.21, 31.77],
      zoom: 7,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current.on('movestart', (e) => { if (isUserCameraEvent(e)) userMoved.current = true; });
    // The console mounts this map inside a section that may be HIDDEN (0x0). Framing a 0x0 map is
    // lost, so it waits: when the box gets a real size, resize the canvas and frame then (7.10).
    const box = ref.current;
    const ro = new ResizeObserver(() => {
      const m = map.current;
      if (!m || box.clientWidth === 0 || box.clientHeight === 0) return;
      m.resize();
      const key = [...new Set(locsRef.current.map((l) => l.teamId))].sort().join(',');
      if (shouldAutoFrame({ presentKey: key, framedKey: framedKey.current, userMoved: userMoved.current, count: locsRef.current.length })) {
        framedKey.current = key;
        frameTeams(m, locsRef.current);
      }
    });
    ro.observe(box);
    return () => { ro.disconnect(); map.current?.remove(); map.current = null; };
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
        // A wrapper (moved by MapLibre) holding the pin and a name label, restyled by styleMarker.
        const el = document.createElement('div');
        // The label is positioned OUTSIDE the wrapper's box, so the wrapper stays exactly the pin's
        // size and MapLibre's centre anchor still sits on the team's position.
        // No `position` here: MapLibre's own `.maplibregl-marker { position:absolute }` places the
        // marker AND anchors the label. An inline `position:relative` stacked every marker in the page
        // flow, so each team after the first was drawn below its real spot (issue 52, 7.10).
        el.appendChild(document.createElement('div'));
        const label = document.createElement('div');
        label.setAttribute('data-follow-label', '');
        label.setAttribute('dir', 'auto');
        label.style.cssText =
          `background:${FOLLOWED_MARKER_COLOR};color:#fff;font:600 12px/1.2 system-ui,sans-serif;` +
          'padding:2px 6px;border-radius:9999px;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;display:none;' +
          'position:absolute;top:calc(100% + 3px);left:50%;transform:translateX(-50%);pointer-events:none;';
        el.appendChild(label);
        el.title = nameOf(l.teamId);
        styleMarker(el, l.teamId, nameOf(l.teamId), followedRef.current, mineOnlyRef.current);
        const marker = new maplibregl.Marker({ element: el }).setLngLat([l.lng, l.lat]);
        if (onTeamClickRef.current) {
          // Clicking a team opens its page, instead of a popup that only repeated its name.
          const teamId = l.teamId;
          el.setAttribute('role', 'button');
          el.setAttribute('tabindex', '0');
          el.setAttribute('aria-label', rc.openTeamAria({ team: nameOf(teamId) }));
          const open = (e: Event) => { e.stopPropagation(); onTeamClickRef.current?.(teamId); };
          el.addEventListener('click', open);
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
        } else {
          marker.setPopup(
            new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
              `<div style="font-weight:600">${escapeHtml(nameOf(l.teamId))}</div>`,
            ),
          );
        }
        marker.addTo(map.current!);
        markersById.current.set(l.teamId, marker);
      }
    }

    // Frame when the SET of reporting teams changes (first load or a team joins), never on a mere
    // position update, and never after the person has moved the map (issue 52: it zoomed out on
    // its own mid-run, throwing away the organizer's zoom).
    const key = [...present].sort().join(',');
    const visible = !!ref.current && ref.current.clientWidth > 0 && ref.current.clientHeight > 0;
    if (visible && shouldAutoFrame({ presentKey: key, framedKey: framedKey.current, userMoved: userMoved.current, count: locs.length })) {
      framedKey.current = key;
      frameTeams(map.current, locs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(locs.map((l) => [l.teamId, l.lat, l.lng]))]);

  // Restyle every marker when the followed set or "mine only" changes (and after new markers appear).
  const followedKey = followed.join(',');
  useEffect(() => {
    for (const [teamId, marker] of markersById.current) {
      styleMarker(marker.getElement(), teamId, nameOf(teamId), followed, mineOnly);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedKey, mineOnly, nameOf, locs.length]);

  return (
    <div className="relative">
      <div ref={ref} className={`rounded-xl overflow-hidden border border-glass-border ${className}`} />
      <MapModeToggle mode={mode} onChange={setMode} />
      {locs.length > 0 && (
        <button type="button" data-testid="live-map-show-all"
          onClick={() => { if (!map.current) return; userMoved.current = false; frameTeams(map.current, locs); }}
          className="absolute top-2 left-2 min-h-[36px] px-3 rounded-full bg-app-card/95 border border-glass-border text-xs font-semibold text-ink-700 shadow hover:border-accent/50">
          {rc.mapShowAll}
        </button>
      )}
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

// Fit the camera to every team with a position (one team: a street-level view around it).
function frameTeams(m: maplibregl.Map, locs: readonly TeamLoc[]) {
  const pts = locs.map((l) => [l.lng, l.lat] as [number, number]);
  if (pts.length === 0) return;
  if (pts.length === 1) {
    m.easeTo({ center: pts[0], zoom: 13 });
    return;
  }
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  pts.forEach((p) => b.extend(p));
  m.fitBounds(b, { padding: 60, maxZoom: 15, duration: 500 });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
