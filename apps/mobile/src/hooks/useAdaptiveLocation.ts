import { useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase.config';
import { useGameStore } from '../store/gameStore';

// Adaptive polling cadence (ms). Slow while stationary (checked in / crafting) to
// save battery; fast while in transit so the heatmap stays current.
const FAST_MS = 20_000;   // in transit — routing to a station / searching for the Tene
const SLOW_MS = 240_000;  // stationary — checked in (clock frozen) or crafting

function getCoords(): Promise<{ lat: number; lng: number } | null> {
  const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    geo.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10_000 },
    );
  });
}

/**
 * Foreground geo-throttling: pings the team's location to Firestore (via the lean
 * `updateLocation` callable) on an interval that adapts to the game state —
 * SLOW_MS while stationary (judge clock frozen, or in the 20-min crafting window)
 * and FAST_MS while in transit. Uses navigator.geolocation so it works on Expo web
 * (the demo target); on native this is the foreground equivalent of a background
 * task. No-ops cleanly when geolocation/permission is unavailable.
 */
export function useAdaptiveLocation(teamId: string | null): void {
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const ping = httpsCallable(functions, 'updateLocation');

    function intervalForState(): number {
      const s = useGameStore.getState();
      const g = s.live;
      const stationary = !!g?.judging || g?.craftingStartedAt != null;
      return stationary ? SLOW_MS : FAST_MS;
    }

    async function tick() {
      const coords = await getCoords();
      if (cancelled) return;
      if (coords) {
        const s = useGameStore.getState();
        const slotType = s.live?.slots.find((sl) => sl.status === 'active')?.type;
        try {
          await ping({ ...coords, teamName: s.teamName, slotType });
        } catch { /* transient — retried on next tick */ }
      }
      if (cancelled) return;
      timer = setTimeout(() => void tick(), intervalForState());
    }

    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [teamId]);
}
