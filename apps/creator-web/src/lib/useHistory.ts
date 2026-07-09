import { useCallback, useRef, useState } from 'react';

// Undo/redo history for a single piece of state (the Builder's `game`).
//
// Rapid successive edits (typing into a title/description) are *coalesced* into
// the current checkpoint instead of pushing one undo step per keystroke — so a
// single Ctrl+Z reverts a whole burst of typing, not one character. Edits that
// land after a short pause (or any structural op like delete/reorder, which is
// naturally separated in time) start a fresh checkpoint. undo()/redo() reset the
// coalesce window so the next edit can never merge into a restored snapshot.

const COALESCE_MS = 600;
const MAX_DEPTH = 100;

export interface HistoryApi<T> {
  state: T;
  set: (updater: T | ((prev: T) => T)) => void;
  /** Replace the state and clear all history (e.g. after a fresh load). */
  reset: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<T>(initial: T): HistoryApi<T> {
  const [hist, setHist] = useState<{ past: T[]; present: T; future: T[] }>(
    { past: [], present: initial, future: [] },
  );
  // Wall-clock of the last user edit; drives the coalesce window. Reset to 0 on
  // load/undo/redo so the following edit always opens a new checkpoint.
  const lastEdit = useRef(0);

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    const now = Date.now();
    const coalesce = now - lastEdit.current < COALESCE_MS;
    lastEdit.current = now;
    setHist((h) => {
      const next = typeof updater === 'function'
        ? (updater as (p: T) => T)(h.present)
        : updater;
      if (Object.is(next, h.present)) return h;
      const past = coalesce ? h.past : [...h.past, h.present].slice(-MAX_DEPTH);
      return { past, present: next, future: [] };
    });
  }, []);

  const reset = useCallback((value: T) => {
    lastEdit.current = 0;
    setHist({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    lastEdit.current = 0;
    setHist((h) => {
      if (!h.past.length) return h;
      const previous = h.past[h.past.length - 1];
      return {
        past: h.past.slice(0, -1),
        present: previous,
        future: [h.present, ...h.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = 0;
    setHist((h) => {
      if (!h.future.length) return h;
      const next = h.future[0];
      return {
        past: [...h.past, h.present],
        present: next,
        future: h.future.slice(1),
      };
    });
  }, []);

  return {
    state: hist.present,
    set,
    reset,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}
