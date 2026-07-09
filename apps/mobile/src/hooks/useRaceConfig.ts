import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import {
  DEFAULT_RACE_CONFIG,
  STATION_GEO,
  type GeoPoint,
  type RaceConfig,
  type StationType,
} from '@rushpoint/shared';
import { db } from '../services/firebase.config';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
const pub = (col: string) => `artifacts/${APP_ID}/public/data/${col}`;

export interface MapStation extends GeoPoint {
  type: StationType;
}

/** Default station markers (used until Firestore has tasks/zones). */
const DEFAULT_STATIONS: MapStation[] = STATION_GEO
  .filter((s) => s.type !== 'gate')
  .map((s) => ({ lat: s.lat, lng: s.lng, type: s.type }));

/**
 * Live race geography for the mobile mission map. Reads the editable
 * raceConfig/current + green/gold tasks + orange basketZones from Firestore,
 * falling back to the hardcoded defaults so the map renders even offline / unseeded.
 */
export function useRaceConfig(): { config: RaceConfig; stations: MapStation[] } {
  const [config, setConfig] = useState<RaceConfig>(DEFAULT_RACE_CONFIG);
  const [tasks, setTasks] = useState<MapStation[] | null>(null);
  const [zones, setZones] = useState<MapStation[]>([]);

  useEffect(() => {
    const unsubCfg = onSnapshot(
      doc(db, `${pub('raceConfig')}/current`),
      (snap) => {
        const d = snap.data() as Partial<RaceConfig> | undefined;
        setConfig(d && d.start && d.finish ? { ...DEFAULT_RACE_CONFIG, ...d } : DEFAULT_RACE_CONFIG);
      },
      () => setConfig(DEFAULT_RACE_CONFIG),
    );
    const unsubTasks = onSnapshot(
      collection(db, pub('tasks')),
      (snap) => {
        const pts = snap.docs
          .map((dd) => dd.data() as { type?: StationType; coordinates?: GeoPoint })
          .filter((t): t is { type: StationType; coordinates: GeoPoint } => typeof t.coordinates?.lat === 'number')
          .map((t) => ({ lat: t.coordinates.lat, lng: t.coordinates.lng, type: t.type ?? 'green' }));
        setTasks(pts);
      },
      () => setTasks(null),
    );
    const unsubZones = onSnapshot(
      collection(db, pub('basketZones')),
      (snap) => {
        const pts = snap.docs
          .map((dd) => dd.data() as { coordinates?: GeoPoint })
          .filter((z): z is { coordinates: GeoPoint } => typeof z.coordinates?.lat === 'number')
          .map((z) => ({ lat: z.coordinates.lat, lng: z.coordinates.lng, type: 'orange' as StationType }));
        setZones(pts);
      },
      () => setZones([]),
    );
    return () => { unsubCfg(); unsubTasks(); unsubZones(); };
  }, []);

  // Fall back to default stations until tasks have loaded at least once.
  const liveStations = tasks === null ? DEFAULT_STATIONS : [...tasks, ...zones];
  return { config, stations: liveStations.length > 0 ? liveStations : DEFAULT_STATIONS };
}
