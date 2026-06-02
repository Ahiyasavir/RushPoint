import { useCallback, useEffect, useRef } from 'react';
import { doc, onSnapshot, getDocFromServer, type DocumentReference } from 'firebase/firestore';
import { db } from '../services/firebase.config';
import { useGameStore, type LiveGame, type LiveSlot } from '../store/gameStore';
import { useSlotSound } from './useSlotSound';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

/**
 * Phase 2 live sync: subscribes to the authoritative `gameState/current`
 * document and mirrors it into the Zustand store, so every screen reads one
 * source of truth. Also plays a chime whenever a slot newly unlocks.
 *
 * `includeMetadataChanges` lets us surface cache-vs-server state for the
 * offline indicator without a second listener.
 */
export function useGameSync(teamId: string | null): void {
  const applyLiveGame = useGameStore((s) => s.applyLiveGame);
  const setSyncState = useGameStore((s) => s.setSyncState);
  const { playUnlock } = useSlotSound();
  const prevSlots = useRef<LiveSlot[] | null>(null);
  const prevCrafting = useRef<boolean>(false);

  useEffect(() => {
    if (!teamId) return;
    setSyncState('loading');
    prevSlots.current = null;
    prevCrafting.current = false;

    const ref = doc(db, `artifacts/${APP_ID}/users/${teamId}/gameState/current`);
    const unsub = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as LiveGame;

        // Chime for any slot that just transitioned into 'active'.
        const prev = prevSlots.current;
        if (prev) {
          for (const slot of data.slots) {
            const before = prev.find((s) => s.index === slot.index);
            if (before && before.status !== 'active' && slot.status === 'active') {
              playUnlock(slot.type);
            }
          }
        }
        prevSlots.current = data.slots;

        // Crafting beep: the Tene Distributor just started the 20-min clock
        // (craftingStartedAt newly stamped) — alert the team with the gold chime.
        const craftingNow = data.craftingStartedAt != null;
        if (prev && craftingNow && !prevCrafting.current) {
          playUnlock('gold');
        }
        prevCrafting.current = craftingNow;

        applyLiveGame(data, snap.metadata.fromCache);
      },
      () => setSyncState('error'),
    );

    return unsub;
  }, [teamId, applyLiveGame, setSyncState, playUnlock]);
}
