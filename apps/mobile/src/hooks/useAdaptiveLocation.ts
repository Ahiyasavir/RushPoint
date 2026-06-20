import { useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { isValidCoord, INVALID_LOCATION } from '@rushpoint/shared';
import { functions } from '../services/firebase.config';
import { useGameStore } from '../store/gameStore';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n';
import { createGeoSmoother, type Fix } from '../lib/geoSmooth';

// Adaptive polling cadence (ms). Slow while stationary (checked in / crafting) to
// save battery; fast while in transit so the heatmap stays current.
const FAST_MS = 20_000;   // in transit — routing to a station / searching for the Tene
const SLOW_MS = 240_000;  // stationary — checked in (clock frozen) or crafting

function getCoords(): Promise<Fix | null> {
  const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    geo.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
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
/** True when a callable rejected with our typed INVALID_LOCATION error. */
function isInvalidLocationError(err: unknown): boolean {
  const details = (err as { details?: { code?: string } } | null)?.details;
  return details?.code === INVALID_LOCATION;
}

export function useAdaptiveLocation(teamId: string | null): void {
  // Toast + translator are kept in refs so the polling effect isn't restarted
  // every render (it only depends on teamId).
  const { show } = useToast();
  const { t } = useTranslation();
  const showRef = useRef(show);
  const tRef = useRef(t);
  showRef.current = show;
  tRef.current = t;

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    let warnedInvalid = false; // surface "Location unavailable" at most once per mount
    let timer: ReturnType<typeof setTimeout>;

    const warnOnce = () => {
      if (warnedInvalid) return;
      warnedInvalid = true;
      showRef.current(tRef.current('location.unavailable'), 'error');
    };

    const ping = httpsCallable(functions, 'updateLocation');
    // Per-mount GPS jitter filter — rejects spikes and smooths wobble so the
    // heatmap marker doesn't flicker (see lib/geoSmooth).
    const smooth = createGeoSmoother();

    function intervalForState(): number {
      const s = useGameStore.getState();
      const g = s.live;
      const stationary = !!g?.judging || g?.craftingStartedAt != null;
      return stationary ? SLOW_MS : FAST_MS;
    }

    async function tick() {
      const raw = await getCoords();
      if (cancelled) return;
      // Validate BEFORE sending: a malformed/out-of-range fix is dropped locally
      // (no network call → no retry spam) and the player is told once.
      if (raw && isValidCoord(raw.lat, raw.lng)) {
        const fix = smooth(raw, Date.now());
        if (isValidCoord(fix.lat, fix.lng)) {
          const s = useGameStore.getState();
          const slotType = s.live?.slots.find((sl) => sl.status === 'active')?.type;
          try {
            await ping({ lat: fix.lat, lng: fix.lng, teamName: s.teamName, slotType });
          } catch (err) {
            // INVALID_LOCATION from the server → surface once, never retry-spam.
            if (isInvalidLocationError(err)) warnOnce();
            /* otherwise transient — retried on next tick */
          }
        }
      } else if (raw) {
        warnOnce();
      }
      if (cancelled) return;
      timer = setTimeout(() => void tick(), intervalForState());
    }

    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [teamId]);
}
