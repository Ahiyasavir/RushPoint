// Live race geography for the admin app — the editable source of truth lives in
// Firestore (raceConfig/current + tasks + basketZones) and is edited in the Race
// Builder. Both the heatmap and the builder read through these hooks; when nothing
// is seeded yet they fall back to the hardcoded DEFAULT_RACE_CONFIG / STATION_GEO
// from @rushpoint/shared, so the maps are never blank.
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { DEFAULT_RACE_CONFIG, STATION_GEO, type RaceConfig, type StationType } from '@rushpoint/shared';
import { db, APP_ID, ensureAuth } from '../services/firebase';

/** A station as shown/edited on the map — a green/gold `task` or an orange `zone`. */
export interface BuilderStation {
  id: string;
  kind: 'task' | 'zone';
  type: StationType;           // green | orange | gold (gate is config, not a station)
  label: string;
  lat: number;
  lng: number;
  // task fields
  title?: string;
  titleHe?: string;
  description?: string;
  descriptionHe?: string;
  difficulty?: number;
  pointValue?: number;
  estimatedMinutes?: number;
  maxConcurrentTeams?: number;
  maxDurationMinutes?: number;
  locationHint?: string;
  status?: string;
  isActive?: boolean;
  // zone (orange) fields
  riddle?: string;
  riddleHe?: string;
  maxTeams?: number;
}

const pubPath = (col: string) => `artifacts/${APP_ID}/public/data/${col}`;

/** Live raceConfig/current, falling back to DEFAULT_RACE_CONFIG until one is saved. */
export function useRaceConfig(): RaceConfig {
  const [cfg, setCfg] = useState<RaceConfig>(DEFAULT_RACE_CONFIG);
  useEffect(() => {
    let unsub = () => {};
    void ensureAuth().then(() => {
      unsub = onSnapshot(
        doc(db, `${pubPath('raceConfig')}/current`),
        (snap) => {
          const data = snap.data() as Partial<RaceConfig> | undefined;
          setCfg(data && data.start && data.finish ? { ...DEFAULT_RACE_CONFIG, ...data } : DEFAULT_RACE_CONFIG);
        },
        () => setCfg(DEFAULT_RACE_CONFIG),
      );
    });
    return () => unsub();
  }, []);
  return cfg;
}

/** Live green/gold tasks + orange basketZones, normalised to BuilderStation[]. */
export function useStations(): BuilderStation[] {
  const [tasks, setTasks] = useState<BuilderStation[]>([]);
  const [zones, setZones] = useState<BuilderStation[]>([]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    let unsubTasks = () => {};
    let unsubZones = () => {};
    void ensureAuth().then(() => {
      unsubTasks = onSnapshot(collection(db, pubPath('tasks')), (snap) => {
        setSeeded(true);
        setTasks(
          snap.docs
            .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
            .filter(({ data }) => typeof (data.coordinates as { lat?: number } | undefined)?.lat === 'number')
            .map(({ id, data }) => {
              const c = data.coordinates as { lat: number; lng: number };
              return {
                id,
                kind: 'task' as const,
                type: (data.type as StationType) ?? 'green',
                label: (data.title as string) ?? id,
                lat: c.lat,
                lng: c.lng,
                title: data.title as string,
                titleHe: data.titleHe as string,
                description: data.description as string,
                descriptionHe: data.descriptionHe as string,
                difficulty: data.difficulty as number,
                pointValue: data.pointValue as number,
                estimatedMinutes: data.estimatedMinutes as number,
                maxConcurrentTeams: data.maxConcurrentTeams as number,
                maxDurationMinutes: data.maxDurationMinutes as number,
                locationHint: data.locationHint as string,
                status: data.status as string,
                isActive: data.isActive as boolean,
              };
            }),
        );
      });
      unsubZones = onSnapshot(collection(db, pubPath('basketZones')), (snap) => {
        setZones(
          snap.docs
            .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
            .filter(({ data }) => typeof (data.coordinates as { lat?: number } | undefined)?.lat === 'number')
            .map(({ id, data }) => {
              const c = data.coordinates as { lat: number; lng: number };
              return {
                id,
                kind: 'zone' as const,
                type: 'orange' as StationType,
                label: (data.name as string) ?? id,
                lat: c.lat,
                lng: c.lng,
                title: data.name as string,
                titleHe: data.nameHe as string,
                riddle: data.riddle as string,
                riddleHe: data.riddleHe as string,
                maxTeams: data.maxTeams as number,
              };
            }),
        );
      });
    });
    return () => { unsubTasks(); unsubZones(); };
  }, []);

  // Until any task is loaded, show the hardcoded default stations so the map isn't empty.
  if (!seeded && tasks.length === 0 && zones.length === 0) {
    return STATION_GEO.filter((s) => s.type !== 'gate').map((s) => ({
      id: s.id,
      kind: s.type === 'orange' ? 'zone' : 'task',
      type: s.type,
      label: s.id,
      lat: s.lat,
      lng: s.lng,
    }));
  }
  return [...tasks, ...zones];
}
