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
//   3. It DRIVES the creator (change: tour-auto-navigate). This used to say the
//      opposite — "it never navigates on its own, a step only OFFERS its
//      destination" — and that is exactly what made it useless: reaching the
//      screen a step described was a click the creator had to notice, and for a
//      brand-new account the seven Builder steps had no destination at all, so
//      half the walkthrough narrated screens that could not be opened. Where a
//      step cannot be reached until something is created, it now points at the
//      control that creates it and waits. `tourNavIntent` holds those rules.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { PAYMENTS_ENABLED } from '@rushpoint/shared';
import { useAuth } from './AuthGate';
import { useT } from './LanguageContext';
import {
  INITIAL_TOUR_STATE, firstGameIdKey,
  buildTourSteps, currentTourStep, isEstablishedCreator, knownGameCountKey, readTourRecord,
  resolveTourAnchoring, shouldAutoStartTour, tourCardPosition, tourProgress,
  consumeJustSignedUp, POST_SIGNUP_TOUR_DELAY_MS, JUST_SIGNED_UP_EVENT,
  tourNavIntent, TOUR_ACTION_ANCHORS,
  tourRecordFor, tourReducer, tourStorageKey, writeTourRecord,
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
  // Latches ONLY a positive read of the one-shot signup flag. A `false` is never
  // latched, because at mount time the flag legitimately may not be written yet
  // (see the race described below) — latching it would permanently blind the
  // component to the signup that is about to happen.
  const sawSignupRef = useRef(false);

  // ── Auto-start fires for a FIRST-EVER SIGNUP and nothing else
  //    (change: post-signup-redirect). Everywhere else the tour stays on-demand
  //    only (the header "?" button, via restartCreatorTour), which is the rule
  //    onboarding-overload-fix established: auto-launching the deep 15-step
  //    walkthrough on a brand new creator's empty dashboard pointed its seven
  //    Builder steps at screens that did not exist yet and buried the first-run
  //    checklist. The narrow case is different because the creator has just
  //    finished signing up and been sent here deliberately, so a welcome is
  //    expected rather than an interruption. Anyone with a tour record (seen or
  //    dismissed) or any established creator is still never interrupted —
  //    `shouldAutoStartTour` holds those rules; this effect only supplies inputs.
  //
  // TWO ordering hazards make a plain "read the flag on mount" wrong, and the
  // tour never started for anyone because of them:
  //   1. THE RACE. `markJustSignedUp()` runs after `await signUpWithEmail(...)`,
  //      but auth flips the instant that promise resolves — so AuthProvider swaps
  //      in the app tree and THIS component mounts and reads the flag before
  //      AuthGate has written it. Mount-time polling always lost.
  //   2. STRICTMODE. main.tsx:19 double-invokes effects: pass 1 would consume the
  //      flag and arm the timer, the interleaved cleanup disarmed it, and pass 2
  //      read the now-cleared flag as false and never re-armed.
  // Subscribing to JUST_SIGNED_UP_EVENT fixes (1) by making the hand-off
  // order-independent, and latching only a positive read fixes (2).
  useEffect(() => {
    if (!uid) return;
    let timer = 0;
    const evaluate = () => {
      if (timer) return; // already armed
      // Consumed on read (one-shot): a creator who does not qualify cannot have a
      // stale "you just signed up" greet them on a later navigation.
      if (!sawSignupRef.current && consumeJustSignedUp()) sawSignupRef.current = true;
      const record = readTourRecord(readLocal(tourStorageKey(uid)));
      const established = isEstablishedCreator(readLocal(knownGameCountKey(uid)));
      if (!shouldAutoStartTour({ record, established, justSignedUp: sawSignupRef.current })) return;
      // Let the dashboard mount and settle before the welcome appears — starting
      // on the same tick anchors steps against a half-rendered page.
      timer = window.setTimeout(() => dispatch({ type: 'start' }), POST_SIGNUP_TOUR_DELAY_MS);
    };
    evaluate();
    window.addEventListener(JUST_SIGNED_UP_EVENT, evaluate);
    return () => {
      window.removeEventListener(JUST_SIGNED_UP_EVENT, evaluate);
      if (timer) window.clearTimeout(timer);
    };
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

  // ── Drive the creator to the step's surface (change: tour-auto-navigate).
  //    `firstGameId` is re-read on every navigation and while a step is waiting
  //    for an action, because the value only appears AFTER the creator creates
  //    their first game — which is precisely what the waiting step asked for.
  //    Without the re-read the tour would keep asking for a game that now exists.
  const [firstGameId, setFirstGameId] = useState<string | null>(() => readLocal(firstGameIdKey(uid)));
  const intent = step
    ? tourNavIntent(step, { firstGameId, liveRunPath: null }, pathname)
    : ({ kind: 'stay' } as const);

  useEffect(() => {
    if (state.status !== 'running') return;
    if (intent.kind !== 'awaitAction') return;
    // Poll only while a step is actually blocked on the creator doing something.
    const id = window.setInterval(() => setFirstGameId(readLocal(firstGameIdKey(uid))), 600);
    return () => window.clearInterval(id);
  }, [state.status, intent.kind, uid]);

  useEffect(() => { setFirstGameId(readLocal(firstGameIdKey(uid))); }, [pathname, uid]);

  useEffect(() => {
    if (state.status !== 'running') return;
    if (intent.kind !== 'navigate') return;
    // NOT `replace`: the tour moving a creator around should stay undoable with
    // the browser Back button, the same as if they had clicked the nav themselves.
    nav(intent.to);
  }, [state.status, intent.kind, intent.kind === 'navigate' ? intent.to : null, nav]);

  // ── Measure the anchor. Re-measured on resize and on any scroll (capture
  //    phase, so a scroll inside the Builder's own panes counts too).
  //    A waiting step spotlights the CONTROL the creator must press instead of
  //    its own anchor, which by definition is not on screen yet.
  const [rect, setRect] = useState<TourRect | null>(null);
  const anchor = intent.kind === 'awaitAction' ? intent.anchor : (step?.anchor ?? null);
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

  const awaiting = intent.kind === 'awaitAction' ? intent.anchor : null;
  const anchoring = resolveTourAnchoring(step, rect !== null);
  // A WAITING step is pointing at a borrowed anchor (the control the creator must
  // press), not its own, so it must borrow that anchor's placement too. Keeping
  // the step's own placement put the card ON TOP of the button — clicks passed
  // through the overlay only to land on the card's paragraph instead. Every
  // action anchor is a control near the top of its surface, so the card sits
  // below it.
  const effectivePlacement = awaiting ? 'bottom' : step.placement;
  const pos = tourCardPosition({
    rect: anchoring === 'anchored' && rect ? rect : EMPTY_RECT,
    viewport,
    card: cardSize,
    placement: anchoring === 'anchored' ? effectivePlacement : 'center',
    rtl,
  });

  const { step: stepNumber, total } = tourProgress(state, steps);
  const isLast = stepNumber === total;
  const isFirst = stepNumber === 1;
  const copy = tour.steps[step.id];
  // The tour now moves the creator itself, so the old manual "take me there" link
  // is gone. What remains is the opposite case: a step that CANNOT be reached
  // until the creator acts, which says so and points at the control.
  const awaitPrompt = awaiting === TOUR_ACTION_ANCHORS.createGame
    ? tour.awaitCreateGame
    : awaiting === TOUR_ACTION_ANCHORS.launchRun
      ? tour.awaitLaunchRun
      : null;

  return createPortal(
    // While a step is WAITING for the creator to press something, the overlay must
    // stop swallowing that press. It is a full-viewport `fixed inset-0` layer with
    // default `pointer-events: auto`, so it sat on top of the very button the step
    // was pointing at — `elementFromPoint` over "+ new game" returned this div, not
    // the button. The tour was asking for an action it physically prevented.
    // Clicks pass through while waiting; the card below re-enables its own.
    <div
      className={`fixed inset-0 z-[70] ${awaiting ? 'pointer-events-none' : ''}`}
      role="presentation"
    >
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
        <div aria-hidden="true" className="absolute inset-0 bg-black/60 pointer-events-none" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-label={tour.dialogLabel}
        aria-live="polite"
        tabIndex={-1}
        className="pointer-events-auto absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[--rp-border] bg-[--surface-1] dark:bg-[--surface-0] shadow-2xl p-5 focus:outline-none"
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

        {awaitPrompt && (
          <p className="mt-3 flex items-start gap-1.5 text-xs font-semibold text-rp-fire text-start">
            <span aria-hidden>👆</span>
            <span>{awaitPrompt}</span>
          </p>
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
