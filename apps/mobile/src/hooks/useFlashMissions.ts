import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase.config';
import type { FlashMission } from '@rushpoint/shared';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

/**
 * Phase 3 live sync: subscribes to broadcast flash missions and returns the most
 * recent active, non-expired one (or null). The admin pushes these via the
 * `pushFlashMission` callable; every team's app surfaces them in real time.
 *
 * Filtering/sorting happens in memory (per the no-compound-query rule). A 1s
 * ticker re-evaluates expiry so the banner self-dismisses when the TTL lapses.
 */
export function useFlashMissions(): FlashMission | null {
  const [missions, setMissions] = useState<FlashMission[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const ref = collection(db, `artifacts/${APP_ID}/public/data/flashMissions`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FlashMission);
        setMissions(list);
      },
      () => setMissions([]),
    );
    return unsub;
  }, []);

  // Re-evaluate expiry once a second so expired missions drop off.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const live = missions
    .filter((m) => m.isActive && new Date(m.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());

  return live[0] ?? null;
}
