// The one arbiter of Builder guidance (change: builder-guidance-arbiter).
//
// Five guidance surfaces compete for one screen. The ORDER lives in
// `lib/builderGuidance.ts` (pure, exhaustively tested); this file is the plumbing
// that lets surfaces which cannot see each other obey it.
//
// It is mounted in `App.tsx` above BOTH `<CreatorTour />` and the routed Builder,
// which is the whole reason it exists as a context rather than as state inside
// `BuilderPage`: the tour is not inside the Builder, so nothing in the Builder could
// ever have arbitrated with it. The previous answer to that was a module-level
// mutable flag (`isCreatorTourRunning`) assigned during render and read from another
// component's effect — which is also why the spotlight's yield was a snapshot taken
// at 700 ms and blind to a tour that auto-starts at 2000 ms.
//
// Here a surface only ever declares ITSELF ("I want to be on screen") and asks
// whether it may render. Nobody reads anybody. The decision is recomputed whenever
// the candidate set changes, so a surface that starts later correctly displaces a
// lower-priority one that is already up.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import {
  activeGuidance, tourRequestOutcome, type GuidanceSurface,
} from '../lib/builderGuidance';

type GuidanceContextValue = {
  /** The single surface that may be on screen right now, or null. */
  visible: GuidanceSurface | null;
  /** A surface declares its own eligibility. Idempotent. */
  setCandidate: (surface: GuidanceSurface, wants: boolean) => void;
  /**
   * Ask to start the guided tour. Returns what actually happened so the caller can
   * acknowledge a deferral — a help press that resolves silently is a dead button.
   */
  requestTour: (source: 'help' | 'auto') => 'start' | 'hold' | 'drop';
  /**
   * Increments each time the tour should actually begin. `CreatorTour` watches it
   * rather than being handed an imperative handle, so the tour keeps owning its own
   * state machine and this file stays a referee.
   */
  tourStartToken: number;
};

const NOOP_CONTEXT: GuidanceContextValue = {
  visible: null,
  setCandidate: () => {},
  requestTour: () => 'drop',
  tourStartToken: 0,
};

// Defaulting to the no-op rather than throwing on a missing provider is deliberate:
// this arbitrates hint bubbles. A creator-web screen rendered outside the provider
// (a test harness, a future standalone route) should lose its guidance, never its
// Builder.
const GuidanceContext = createContext<GuidanceContextValue>(NOOP_CONTEXT);

export function GuidanceProvider({ children }: { children: ReactNode }) {
  const [candidates, setCandidates] = useState<ReadonlySet<GuidanceSurface>>(
    () => new Set<GuidanceSurface>(),
  );
  const [tourStartToken, setTourStartToken] = useState(0);
  // A help request that lost. Held in a ref, not state: it must not itself trigger a
  // render, and the effect below reads it at exactly the moment the winner changes.
  const pendingHelpRef = useRef(false);

  const setCandidate = useCallback((surface: GuidanceSurface, wants: boolean) => {
    setCandidates((prev) => {
      if (prev.has(surface) === wants) return prev; // no re-render for a no-op
      const next = new Set(prev);
      if (wants) next.add(surface); else next.delete(surface);
      return next;
    });
  }, []);

  const visible = useMemo(() => activeGuidance(candidates), [candidates]);

  const requestTour = useCallback((source: 'help' | 'auto') => {
    // "Would the tour win if it joined?" — asked against the CURRENT candidates, so
    // the answer uses the same ordering everything else does.
    const withTour = new Set(candidates);
    withTour.add('tour');
    const outcome = tourRequestOutcome(source, activeGuidance(withTour) === 'tour');
    if (outcome === 'start') {
      pendingHelpRef.current = false;
      setTourStartToken((n) => n + 1);
    } else if (outcome === 'hold') {
      pendingHelpRef.current = true;
    }
    return outcome;
  }, [candidates]);

  // Release a held help request the moment the screen frees up. Runs on every change
  // to the candidate set, which is the only thing that can free it.
  useEffect(() => {
    if (!pendingHelpRef.current) return;
    const withTour = new Set(candidates);
    withTour.add('tour');
    if (activeGuidance(withTour) === 'tour') {
      pendingHelpRef.current = false;
      setTourStartToken((n) => n + 1);
    }
  }, [candidates]);

  // Memoised on the DERIVED winner rather than on the set, so a candidacy change
  // that does not change who is visible costs no consumer re-render.
  const value = useMemo<GuidanceContextValue>(
    () => ({ visible, setCandidate, requestTour, tourStartToken }),
    [visible, setCandidate, requestTour, tourStartToken],
  );

  return <GuidanceContext.Provider value={value}>{children}</GuidanceContext.Provider>;
}

/** Declare that this surface wants to be on screen (or no longer does). */
export function useGuidanceCandidate(surface: GuidanceSurface, wants: boolean): void {
  const { setCandidate } = useContext(GuidanceContext);
  useEffect(() => {
    setCandidate(surface, wants);
    // Withdraw on unmount, so a surface that disappears with the route cannot keep
    // suppressing everything below it forever.
    return () => setCandidate(surface, false);
  }, [surface, wants, setCandidate]);
}

/** May this surface render right now? */
export function useGuidanceVisible(surface: GuidanceSurface): boolean {
  return useContext(GuidanceContext).visible === surface;
}

/**
 * Declare candidacy and read the verdict in one call — the shape every rendered
 * surface wants. `wants` is the surface's OWN eligibility (its trigger, its record);
 * the return value is whether it also won arbitration.
 */
export function useGuidanceSlot(surface: GuidanceSurface, wants: boolean): boolean {
  useGuidanceCandidate(surface, wants);
  return useGuidanceVisible(surface) && wants;
}

/** The tour's request door + its start signal. */
export function useTourGuidance(): Pick<GuidanceContextValue, 'requestTour' | 'tourStartToken'> {
  const { requestTour, tourStartToken } = useContext(GuidanceContext);
  return { requestTour, tourStartToken };
}
