// First-run guided tour overlay (change: creator-guided-tour).
//
// This file renders; it decides nothing. The step list, the ordering, every
// transition, the "has this creator seen it" predicate, the anchoring fallback
// and the card clamp all live in the pure `lib/creatorOnboarding` module and are
// unit-tested without a DOM (scripts/test-creator-tour.ts).
//
// Three rules it must keep:
//   1. A missing anchor is NOT an error — the step degrades to a centred card,
//      so a Builder step read from the Dashboard still teaches.
//   2. Nothing is stored until the tour actually ends (skipped / completed), so
//      a closed tab is not silently counted as "seen".
//   3. It never navigates on its own. A step only OFFERS its destination.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { PAYMENTS_ENABLED } from '@rushpoint/shared';
import { useAuth } from './AuthGate';
import { useT } from './LanguageContext';
import {
  INITIAL_TOUR_STATE, TOUR_FIRST_GAME_KEY,
  buildTourSteps, currentTourStep, isEstablishedCreator, knownGameCountKey, readTourRecord,
  resolveTourAnchoring, shouldAutoStartTour, tourCardPosition, tourProgress,
  tourRecordFor, tourReducer, tourStepTarget, tourStorageKey, writeTourRecord,
  type TourAction, type TourRect, type TourState,
} from '../lib/creatorOnboarding';

/** Event the header help button and the Settings card fire to replay the tour. */
export const TOUR_RESTART_EVENT = 'rp-tour-restart';

/**
 * Replay the tour from step one. A plain window event rather than a context, so
 * any surface can offer the affordance without threading a provider through the
 * whole console.
 */
export function restartCreatorTour(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(TOUR_RESTART_EVENT));
}

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

const EMPTY_RECT: TourRect = { top: 0, left: 0, width: 0, height: 0 };

export default function CreatorTour() {
  const t = useT();
  const tour = t.tour;
  const { user } = useAuth();
  const nav = useNavigate();
  const pathname = useLocation().pathname;

  const steps = useMemo(() => buildTourSteps({ paymentsEnabled: PAYMENTS_ENABLED }), []);
  const [state, setState] = useState<TourState>(INITIAL_TOUR_STATE);
  const dispatch = useCallback(
    (action: TourAction) => setState((s) => tourReducer(s, action, steps)),
    [steps],
  );

  const step = currentTourStep(state, steps);
  const uid = user?.uid ?? '';

  // ── Auto-start: only a creator with no record who does not already look
  //    established. A returning creator is never interrupted; they get the "?".
  //    BOTH signals are read per uid: a browser can hold several accounts, and
  //    judging this creator by a colleague's game count is how a real first-timer
  //    never saw the tour (change: post-review-fixes A).
  useEffect(() => {
    if (!uid) return;
    const record = readTourRecord(readLocal(tourStorageKey(uid)));
    const established = isEstablishedCreator(readLocal(knownGameCountKey(uid)));
    if (shouldAutoStartTour({ record, established })) dispatch({ type: 'start' });
  }, [uid, dispatch]);

  // ── Persist only a terminal outcome.
  useEffect(() => {
    if (!uid) return;
    const record = tourRecordFor(state, steps);
    if (!record) return;
    try { localStorage.setItem(tourStorageKey(uid), writeTourRecord(record)); } catch { /* storage unavailable */ }
  }, [state, steps, uid]);

  // ── Replay on demand.
  useEffect(() => {
    const handler = () => dispatch({ type: 'restart' });
    window.addEventListener(TOUR_RESTART_EVENT, handler);
    return () => window.removeEventListener(TOUR_RESTART_EVENT, handler);
  }, [dispatch]);

  // ── Measure the anchor. Re-measured on resize and on any scroll (capture
  //    phase, so a scroll inside the Builder's own panes counts too).
  const [rect, setRect] = useState<TourRect | null>(null);
  const anchor = step?.anchor ?? null;
  useLayoutEffect(() => {
    if (!anchor) { setRect(null); return; }
    const measure = () => {
      const el = document.querySelector(`[data-tour="${anchor}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      // A hidden element (the desktop nav below `sm`) measures 0x0. Treat that as
      // "not on screen" so the step centres instead of pointing at the corner.
      if (r.width <= 0 || r.height <= 0) { setRect(null); return; }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, pathname]);

  // ── Measure the card itself (its copy length decides its height) and the
  //    viewport, so the clamp works off real numbers and survives a resize.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 340, height: 220 });
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useLayoutEffect(() => {
    const sync = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const el = cardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCardSize((prev) =>
        Math.abs(prev.width - r.width) > 1 || Math.abs(prev.height - r.height) > 1
          ? { width: r.width, height: r.height }
          : prev);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [step?.id]);

  // ── Keyboard: escape always leaves, arrows walk. Bound only while running.
  const rtl = t.dir === 'rtl';
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); dispatch({ type: 'skip' }); return; }
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
      const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === forward) { e.preventDefault(); dispatch({ type: 'next' }); }
      if (e.key === backward) { e.preventDefault(); dispatch({ type: 'back' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, rtl, dispatch]);

  // Move focus onto the card whenever the step changes, so a keyboard user is
  // never left tabbing behind the overlay.
  useEffect(() => { if (step) cardRef.current?.focus(); }, [step?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!step || typeof document === 'undefined') return null;

  const anchoring = resolveTourAnchoring(step, rect !== null);
  const pos = tourCardPosition({
    rect: anchoring === 'anchored' && rect ? rect : EMPTY_RECT,
    viewport,
    card: cardSize,
    placement: anchoring === 'anchored' ? step.placement : 'center',
    rtl,
  });

  const { step: stepNumber, total } = tourProgress(state, steps);
  const isLast = stepNumber === total;
  const isFirst = stepNumber === 1;
  const copy = tour.steps[step.id];
  const target = tourStepTarget(step, {
    firstGameId: readLocal(TOUR_FIRST_GAME_KEY),
    liveRunPath: null,
  });
  const showTarget = !!target && target !== pathname;

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="presentation">
      {/* Spotlight: one box whose enormous shadow dims everything around it. The
          geometry is dynamic, so it is an inline style — the static-Tailwind rule
          stands for every class here. */}
      {anchoring === 'anchored' && rect ? (
        <div
          aria-hidden="true"
          className="absolute rounded-xl ring-2 ring-rp-fire pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-label={tour.dialogLabel}
        aria-live="polite"
        tabIndex={-1}
        className="absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[--rp-border] bg-[--surface-1] dark:bg-[--surface-0] shadow-2xl p-5 focus:outline-none"
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-rp-fire tabular-nums">
            {tour.progress({ step: stepNumber, total })}
          </span>
          <button
            onClick={() => dispatch({ type: 'skip' })}
            aria-label={tour.skip}
            title={tour.skip}
            className="text-[11px] font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
          >
            {tour.skip}
          </button>
        </div>

        <h2 className="font-brand text-lg font-extrabold text-[--ink-1] text-start">{copy.title}</h2>
        <p className="text-sm text-[--ink-3] mt-1.5 leading-relaxed text-start">{copy.body}</p>

        {showTarget && (
          <button
            onClick={() => { if (target) nav(target); }}
            className="mt-3 text-xs font-semibold text-rp-fire hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
          >
            {tour.takeMeThere}
          </button>
        )}

        <div className="flex items-center justify-between gap-2 mt-5">
          <button
            onClick={() => dispatch({ type: 'back' })}
            disabled={isFirst}
            aria-label={tour.back}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] disabled:opacity-30 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
          >
            {tour.back}
          </button>
          <button
            onClick={() => dispatch({ type: 'next' })}
            aria-label={isLast ? tour.finish : tour.next}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-rp-fire to-rp-amber shadow-sm hover:brightness-105 active:brightness-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
          >
            {isLast ? tour.finish : tour.next}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
