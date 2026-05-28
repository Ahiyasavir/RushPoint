import React from 'react';
import Map, { Marker, NavigationControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useI18n } from '../i18n';
import { JERUSALEM, STATIONS, STATION_COLOR } from '../data/stations';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export default function HeatmapPage() {
  const { t } = useI18n();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">{t('heatmap.title')}</h1>
      <p className="text-zinc-500 text-sm mb-6">{t('heatmap.subtitle')}</p>

      {MAPBOX_TOKEN ? (
        <>
          <div className="rounded-xl overflow-hidden border border-zinc-800 h-[600px]">
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
            </Map>
          </div>
          <Legend />
        </>
      ) : (
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 h-[600px] flex flex-col items-center justify-center gap-3 px-8 text-center">
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
    <div className="flex gap-5 mt-4 text-sm text-zinc-400">
      {items.map(({ key, type }) => (
        <span key={key} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full border border-white/40"
            style={{ backgroundColor: STATION_COLOR[type] }}
          />
          {t(key)}
        </span>
      ))}
    </div>
  );
}
