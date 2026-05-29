import React, { useEffect, useState } from 'react';
import Map, { Marker, NavigationControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, APP_ID, ensureAuth } from '../services/firebase';
import { useI18n } from '../i18n';
import { JERUSALEM, STATIONS, STATION_COLOR } from '../data/stations';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

interface LiveTeam { teamId: string; teamName?: string; lat: number; lng: number; updatedAt?: string }

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

export default function HeatmapPage() {
  const { t } = useI18n();
  const liveTeams = useLiveTeams();

  return (
    <div className="p-6 md:p-8 min-h-screen">
      <h1 className="font-brand text-2xl font-bold text-white mb-1">{t('heatmap.title')}</h1>
      <p className="text-zinc-500 text-sm mb-6">{t('heatmap.subtitle')}</p>

      {MAPBOX_TOKEN ? (
        <>
          <div className="rounded-2xl overflow-hidden border border-neon-green/20 shadow-glow-green h-[600px]">
            <Map
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={{ longitude: JERUSALEM.lng, latitude: JERUSALEM.lat, zoom: 13.5 }}
              mapStyle="mapbox://styles/mapbox/dark-v11"
              attributionControl={false}
            >
              <NavigationControl position="top-right" />
              {STATIONS.map((s) => (
                <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="bottom">
                  <div
                    title={s.label}
                    className="w-4 h-4 rounded-full border-2 border-white shadow-lg"
                    style={{ backgroundColor: STATION_COLOR[s.type] }}
                  />
                </Marker>
              ))}
              {liveTeams.map((team) => (
                <Marker key={team.teamId} longitude={team.lng} latitude={team.lat} anchor="center">
                  <div
                    title={team.teamName ?? team.teamId}
                    className="w-3.5 h-3.5 rounded-full bg-white border border-neon-green animate-pulse shadow-[0_0_10px_3px_rgba(0,255,170,0.7)]"
                  />
                </Marker>
              ))}
            </Map>
          </div>
          <Legend />
        </>
      ) : (
        <div className="rounded-2xl bg-app-card border border-glass-border h-[600px] flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-zinc-400">{t('heatmap.placeholder')}</p>
          <p className="text-zinc-600 text-sm max-w-md">{t('heatmap.noToken')}</p>
        </div>
      )}
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
