import React, { useEffect, useRef, useState } from 'react';
import Map, { Marker, NavigationControl, Source, Layer, Popup, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { routePathFor, routeGeoJSON, STATION_COLOR } from '@rushpoint/shared';
import { db, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import { useRaceConfig, useStations } from '../data/raceConfig';
import { getMapStyle, type MapVariant } from '../data/mapStyle';

interface LiveTeam { teamId: string; teamName?: string; lat: number; lng: number; updatedAt?: string }
interface ActiveAlert {
  id: string;
  teamId: string;
  teamName?: string;
  kind?: 'emergency' | 'technical';
  captainPhone?: string;
  memberNames?: string[];
  message?: string;
  lat?: number; // present only if the SOS payload carried GPS coords
  lng?: number;
}
/** An alert resolved to a map position (own coords, or the team's last known). */
type PositionedAlert = ActiveAlert & { lat: number; lng: number };

/** Live team positions, pinged by the mobile app's adaptive-location hook. */
function useLiveTeams(): LiveTeam[] {
  const [teams, setTeams] = useState<LiveTeam[]>([]);
  useEffect(() => {
    let unsub = () => {};
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        collection(db, `artifacts/${APP_ID}/public/data/teamLocations`),
        (snap) => setTeams(snap.docs.map((d) => d.data() as LiveTeam).filter((x) => typeof x.lat === 'number')),
        () => setTeams([]),
      );
    });
    return () => unsub();
  }, []);
  return teams;
}

/**
 * Live, unacknowledged SOS/help alerts. Keeps alerts even when the SOS payload
 * had no GPS (denied/timed-out) — the component falls back to the team's last
 * known position so the siren still renders.
 */
function useActiveAlerts(): ActiveAlert[] {
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  useEffect(() => {
    let unsub = () => {};
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        collection(db, `artifacts/${APP_ID}/public/data/adminAlerts`),
        (snap) => setAlerts(
          snap.docs
            .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
            .filter(({ data }) => data.type === 'sos' && !data.acknowledged)
            .map(({ id, data }) => {
              const loc = data.location as { lat?: number; lng?: number } | undefined;
              return {
                id,
                teamId: data.teamId as string,
                teamName: data.teamName as string | undefined,
                kind: (data.kind as 'emergency' | 'technical' | undefined) ?? 'emergency',
                captainPhone: data.captainPhone as string | undefined,
                memberNames: (data.memberNames as string[] | undefined) ?? [],
                message: data.message as string | undefined,
                lat: typeof loc?.lat === 'number' ? loc.lat : undefined,
                lng: typeof loc?.lng === 'number' ? loc.lng : undefined,
              };
            }),
        ),
        () => setAlerts([]),
      );
    });
    return () => unsub();
  }, []);
  return alerts;
}

export default function HeatmapPage() {
  const { t } = useI18n();
  const liveTeams = useLiveTeams();
  const alerts = useActiveAlerts();
  const raceConfig = useRaceConfig();
  const stations = useStations();
  const routeData = routeGeoJSON(routePathFor(raceConfig));
  const [selected, setSelected] = useState<PositionedAlert | null>(null);

  // initialViewState only applies ONCE at mount — and the map mounts before
  // Firestore delivers the saved raceConfig, so the camera would otherwise stay
  // on the hardcoded default (old Gan HaKipod). Re-center the live map whenever
  // the saved center/zoom changes (e.g. after editing the finish in the Builder).
  const mapRef = useRef<MapRef | null>(null);
  const lastCenterRef = useRef<string>('');
  useEffect(() => {
    const key = `${raceConfig.center.lat},${raceConfig.center.lng},${raceConfig.zoom}`;
    if (key === lastCenterRef.current) return;
    lastCenterRef.current = key;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [raceConfig.center.lng, raceConfig.center.lat],
      zoom: raceConfig.zoom,
      duration: 600,
    });
  }, [raceConfig.center.lat, raceConfig.center.lng, raceConfig.zoom]);
  // Map base-layer variant. Switching only swaps the GL style — the live-team and
  // alert onSnapshot listeners live in React state (useLiveTeams/useActiveAlerts),
  // so they are untouched, and Markers + the route Source/Layer are re-applied by
  // react-map-gl on styledata. No listener re-init, no marker loss.
  const [mapVariant, setMapVariant] = useState<MapVariant>('outdoor');

  // A team with an active alert is shown as a flashing siren, not a normal dot.
  const alertedTeamIds = new Set(alerts.map((a) => a.teamId));
  const calmTeams = liveTeams.filter((tm) => !alertedTeamIds.has(tm.teamId));

  // Resolve each alert to a map position: its own SOS coords, else the team's last
  // known position from teamLocations (#1 — keeps the siren visible if GPS failed).
  // NB: `Map` is the react-map-gl component here, so use a plain lookup object.
  const lastPosByTeam: Record<string, LiveTeam> = {};
  for (const tm of liveTeams) lastPosByTeam[tm.teamId] = tm;
  const positionedAlerts: PositionedAlert[] = alerts
    .map((a): PositionedAlert | null => {
      if (typeof a.lat === 'number' && typeof a.lng === 'number') return { ...a, lat: a.lat, lng: a.lng };
      const last = lastPosByTeam[a.teamId];
      return last ? { ...a, lat: last.lat, lng: last.lng } : null;
    })
    .filter((a): a is PositionedAlert => a !== null);

  return (
    <div className="p-6 md:p-8 min-h-screen">
      <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('heatmap.title')}</h1>
      <p className="text-zinc-500 text-sm mb-6">{t('heatmap.subtitle')}</p>

      <div className="relative rounded-2xl overflow-hidden border border-neon-green/20 shadow-glow-green h-[600px]">
        {/* Base-layer toggle: topographic ⇄ satellite/hybrid */}
        <div className="absolute top-3 left-3 z-10 flex rounded-lg overflow-hidden border border-white/20 shadow-lg backdrop-blur-sm">
          {(['outdoor', 'satellite'] as MapVariant[]).map((v) => (
            <button
              key={v}
              onClick={() => setMapVariant(v)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                mapVariant === v ? 'bg-neon-green text-black' : 'bg-app-surface/80 text-zinc-300 hover:text-white'
              }`}
            >
              {v === 'outdoor' ? t('heatmap.layerTopo') : t('heatmap.layerSatellite')}
            </button>
          ))}
        </div>
        <Map
          ref={mapRef}
          initialViewState={{ longitude: raceConfig.center.lng, latitude: raceConfig.center.lat, zoom: raceConfig.zoom }}
          mapStyle={getMapStyle(mapVariant)}
          attributionControl={true}
        >
          <NavigationControl position="top-right" />

          {/* Route line: start → waypoints → finish */}
          <Source id="route" type="geojson" data={routeData}>
            <Layer
              id="route-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{ 'line-color': '#3d6152', 'line-width': 4, 'line-opacity': 0.85 }}
            />
          </Source>

          {/* Start + Finish + Gate */}
          <Marker longitude={raceConfig.start.lng} latitude={raceConfig.start.lat} anchor="bottom">
            <div title="Start" className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-white text-black border border-neon-green shadow-lg">
              ▶ START
            </div>
          </Marker>
          <Marker longitude={raceConfig.finish.lng} latitude={raceConfig.finish.lat} anchor="bottom">
            <div title="Finish — Gan HaKipod" className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-neon-gold text-black border border-white shadow-lg">
              🏁 גן הקיפוד
            </div>
          </Marker>
          <Marker longitude={raceConfig.gate.lng} latitude={raceConfig.gate.lat} anchor="center">
            <div title="Gate — Matchmaking" className="w-4 h-4 rounded-full border-2 border-white shadow-lg" style={{ backgroundColor: STATION_COLOR.gate }} />
          </Marker>

          {/* Station markers (live: green/gold tasks + orange Tene zones) */}
          {stations.map((s) => (
            <Marker key={`${s.kind}-${s.id}`} longitude={s.lng} latitude={s.lat} anchor="bottom">
              <div
                title={s.label}
                className="w-4 h-4 rounded-full border-2 border-white shadow-lg"
                style={{ backgroundColor: STATION_COLOR[s.type] }}
              />
            </Marker>
          ))}

          {/* Live team positions (pinged by the mobile adaptive-location hook) */}
          {calmTeams.map((team) => (
            <Marker key={team.teamId} longitude={team.lng} latitude={team.lat} anchor="center">
              <div
                title={team.teamName ?? team.teamId}
                className="w-3.5 h-3.5 rounded-full bg-white border border-neon-green animate-pulse shadow-[0_0_10px_3px_rgba(0,255,170,0.7)]"
              />
            </Marker>
          ))}

          {/* Active SOS / help alerts — flashing siren, click for captain phone */}
          {positionedAlerts.map((a) => (
            <Marker
              key={a.id}
              longitude={a.lng}
              latitude={a.lat}
              anchor="center"
              onClick={(e) => { e.originalEvent.stopPropagation(); setSelected(a); }}
            >
              <div
                title={a.teamName ?? a.teamId}
                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 border-white cursor-pointer animate-pulse ${
                  a.kind === 'technical'
                    ? 'bg-neon-orange shadow-[0_0_14px_5px_rgba(249,115,22,0.85)]'
                    : 'bg-neon-red shadow-[0_0_14px_5px_rgba(239,68,68,0.9)]'
                }`}
              >
                <span className="text-sm leading-none">{a.kind === 'technical' ? '🛠️' : '🚨'}</span>
              </div>
            </Marker>
          ))}

          {selected && (
            <Popup
              longitude={selected.lng}
              latitude={selected.lat}
              anchor="bottom"
              offset={20}
              closeOnClick={false}
              onClose={() => setSelected(null)}
            >
              <div className="min-w-[180px] text-sm">
                <p className="font-bold text-black flex items-center gap-1">
                  {selected.kind === 'technical' ? '🛠️' : '🚨'} {selected.teamName ?? selected.teamId}
                </p>
                {selected.message && <p className="text-zinc-700 mt-0.5">{selected.message}</p>}
                {selected.memberNames && selected.memberNames.length > 0 && (
                  <p className="text-zinc-600 text-xs mt-1">👥 {selected.memberNames.join(', ')}</p>
                )}
                {selected.captainPhone ? (
                  <a href={`tel:${selected.captainPhone}`} className="mt-2 inline-block font-mono font-semibold text-blue-600 hover:underline">
                    📞 {selected.captainPhone}
                  </a>
                ) : (
                  <p className="text-zinc-500 text-xs mt-2">{t('heatmap.noPhone')}</p>
                )}
              </div>
            </Popup>
          )}
        </Map>
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  const dots: { key: string; type: 'green' | 'gate' | 'orange' | 'gold' }[] = [
    { key: 'heatmap.legendGreen', type: 'green' },
    { key: 'heatmap.legendGate', type: 'gate' },
    { key: 'heatmap.legendOrange', type: 'orange' },
    { key: 'heatmap.legendGold', type: 'gold' },
  ];
  return (
    <div className="flex gap-x-6 gap-y-2 mt-5 text-sm text-zinc-400 flex-wrap items-center">
      {dots.map(({ key, type }) => (
        <span key={key} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full border border-white/40 shadow-[0_0_8px_2px_currentColor]"
            style={{ backgroundColor: STATION_COLOR[type], color: STATION_COLOR[type] }}
          />
          {t(key)}
        </span>
      ))}
      {/* Start / Finish / live team / SOS */}
      <span className="flex items-center gap-2">
        <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-white text-black border border-neon-green">▶</span>
        {t('heatmap.legendStart')}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-xs">🏁</span>
        {t('heatmap.legendFinish')}
      </span>
      <span className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-white border border-neon-green shadow-[0_0_8px_2px_rgba(0,255,170,0.7)]" />
        {t('heatmap.legendTeam')}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-xs">🚨</span>
        {t('heatmap.legendSos')}
      </span>
    </div>
  );
}
