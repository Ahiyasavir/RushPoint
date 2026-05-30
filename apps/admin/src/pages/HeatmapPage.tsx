import React, { useEffect, useState } from 'react';
import Map, { Marker, NavigationControl, Source, Layer, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { RACE_DEFAULT_ZOOM, RACE_START, RACE_FINISH, ROUTE_GEOJSON } from '@rushpoint/shared';
import { db, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import { JERUSALEM, STATIONS, STATION_COLOR } from '../data/stations';
import { getMapStyle } from '../data/mapStyle';

interface LiveTeam { teamId: string; teamName?: string; lat: number; lng: number; updatedAt?: string }
interface ActiveAlert {
  id: string;
  teamId: string;
  teamName?: string;
  kind?: 'emergency' | 'technical';
  captainPhone?: string;
  memberNames?: string[];
  message?: string;
  lat: number;
  lng: number;
}

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

/** Live, unacknowledged SOS/help alerts that carry a GPS location. */
function useActiveAlerts(): ActiveAlert[] {
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  useEffect(() => {
    let unsub = () => {};
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        collection(db, `artifacts/${APP_ID}/public/data/adminAlerts`),
        (snap) => setAlerts(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
            .filter((a) => a.type === 'sos' && !a.acknowledged && a.location &&
              typeof (a.location as { lat?: number }).lat === 'number')
            .map((a) => ({
              id: a.id as string,
              teamId: a.teamId as string,
              teamName: a.teamName as string | undefined,
              kind: (a.kind as 'emergency' | 'technical' | undefined) ?? 'emergency',
              captainPhone: a.captainPhone as string | undefined,
              memberNames: (a.memberNames as string[] | undefined) ?? [],
              message: a.message as string | undefined,
              lat: (a.location as { lat: number }).lat,
              lng: (a.location as { lng: number }).lng,
            })),
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
  const [selected, setSelected] = useState<ActiveAlert | null>(null);

  // A team with an active alert is shown as a flashing siren, not a normal dot.
  const alertedTeamIds = new Set(alerts.map((a) => a.teamId));
  const calmTeams = liveTeams.filter((tm) => !alertedTeamIds.has(tm.teamId));

  return (
    <div className="p-6 md:p-8 min-h-screen">
      <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('heatmap.title')}</h1>
      <p className="text-zinc-500 text-sm mb-6">{t('heatmap.subtitle')}</p>

      <div className="rounded-2xl overflow-hidden border border-neon-green/20 shadow-glow-green h-[600px]">
        <Map
          initialViewState={{ longitude: JERUSALEM.lng, latitude: JERUSALEM.lat, zoom: RACE_DEFAULT_ZOOM }}
          mapStyle={getMapStyle()}
          attributionControl={true}
        >
          <NavigationControl position="top-right" />

          {/* Route line: Motza → Gan HaKipod */}
          <Source id="route" type="geojson" data={ROUTE_GEOJSON}>
            <Layer
              id="route-line"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{ 'line-color': '#00ffaa', 'line-width': 4, 'line-opacity': 0.85 }}
            />
          </Source>

          {/* Start (Motza) + Finish (Gan HaKipod) */}
          <Marker longitude={RACE_START.lng} latitude={RACE_START.lat} anchor="bottom">
            <div title="Start — Motza" className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-white text-black border border-neon-green shadow-lg">
              ▶ START
            </div>
          </Marker>
          <Marker longitude={RACE_FINISH.lng} latitude={RACE_FINISH.lat} anchor="bottom">
            <div title="Finish — Gan HaKipod" className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-neon-gold text-black border border-white shadow-lg">
              🏁 גן הקיפוד
            </div>
          </Marker>

          {/* Station markers */}
          {STATIONS.map((s) => (
            <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="bottom">
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
          {alerts.map((a) => (
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
  const items: { key: string; type: 'green' | 'orange' | 'gold' }[] = [
    { key: 'heatmap.legendGreen', type: 'green' },
    { key: 'heatmap.legendOrange', type: 'orange' },
    { key: 'heatmap.legendGold', type: 'gold' },
  ];
  return (
    <div className="flex gap-6 mt-5 text-sm text-zinc-400 flex-wrap">
      {items.map(({ key, type }) => (
        <span key={key} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full border border-white/40 shadow-[0_0_8px_2px_currentColor]"
            style={{ backgroundColor: STATION_COLOR[type], color: STATION_COLOR[type] }}
          />
          {t(key)}
        </span>
      ))}
    </div>
  );
}
