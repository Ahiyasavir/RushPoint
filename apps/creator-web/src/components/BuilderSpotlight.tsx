// The Builder's first-open spotlight (change: guided-new-game-wizard).
//
// Two steps, in situ, naming the only two words the Builder is built on: a stage
// and a mission. It exists because the hardest reported problem with this product
// is not authoring a mission but understanding what the app IS — and that question
// gets asked while staring at this screen, not the dashboard.
//
// It is NOT the full CreatorTour and must never behave like one. Every decision
// (which anchors, when to run, when to yield) lives in lib/creatorOnboarding.ts
// and is unit-tested by scripts/test-builder-spotlight.ts; this file only renders.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './LanguageContext';
import { useAuth } from './AuthGate';
import {
  SPOTLIGHT_STEPS,
  readSpotlightRecord,
  shouldStartBuilderSpotlight,
  spotlightSeenKey,
  visibleSpotlightSteps,
  type SpotlightStep,
} from '../lib/creatorOnboarding';
import { isCreatorTourRunning } from './CreatorTour';

/** How long to let the Builder settle before pointing at any of it. */
const SETTLE_MS = 700;

function anchorRect(anchor: string): DOMRect | null {
  const el = document.querySelector(`[data-tour="${anchor}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // A mounted-but-zero-sized element is not on screen in any useful sense.
  return r.width > 0 && r.height > 0 ? r : null;
}

export default function BuilderSpotlight({ quickSetupActive }: { quickSetupActive: boolean }) {
  const t = useT();
  const copy = t.tour.spotlight;
  const { user } = useAuth();
  const [steps, setSteps] = useState<SpotlightStep[] | null>(null);
  const [index, setIndex] = useState(0);

  // Decide ONCE, after the Builder has settled. Deliberately not re-evaluated on
  // every render: a spotlight that reappears because a panel opened would be a
  // nag, not an explanation.
  useEffect(() => {
    const uid = user?.uid;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(spotlightSeenKey(uid));
    } catch { /* blocked storage reads as never-seen, which shows the explainer */ }
    if (!shouldStartBuilderSpotlight({
      record: readSpotlightRecord(raw),
      tourRunning: isCreatorTourRunning(),
      quickSetupActive,
    })) return;

    const timer = window.setTimeout(() => {
      // Re-check the yielders at fire time: Quick Setup's own auto-invite lands in
      // this same window, and whichever guided flow is already up must win.
      if (isCreatorTourRunning()) return;
      const visible = visibleSpotlightSteps((a) => anchorRect(a) !== null);
      if (visible.length > 0) setSteps(visible);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quick Setup can open AFTER we did — its invite is asynchronous. Close rather
  // than stack.
  useEffect(() => {
    if (quickSetupActive && steps) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSetupActive]);

  function finish() {
    setSteps(null);
    try {
      localStorage.setItem(spotlightSeenKey(user?.uid), JSON.stringify({ seen: true }));
    } catch { /* an unwritable record must never break the Builder */ }
  }

  if (!steps || steps.length === 0) return null;
  const step = steps[Math.min(index, steps.length - 1)];
  const rect = anchorRect(step.anchor);
  // The anchor vanished between deciding and rendering (a resize, a closed panel):
  // skip rather than point at nothing.
  if (!rect) return null;

  const last = index >= steps.length - 1;
  const stepCopy = (copy as unknown as Record<string, { title: string; body: string }>)[step.id];

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label={stepCopy?.title ?? ''}>
      {/* Click-through-proof scrim, but the highlighted element stays visible. */}
      <div className="absolute inset-0 bg-black/45" onClick={finish} />
      <div
        className="absolute rounded-xl ring-2 ring-rp-fire pointer-events-none transition-all"
        style={{
          top: Math.max(0, rect.top - 4), left: Math.max(0, rect.left - 4),
          width: rect.width + 8, height: rect.height + 8,
        }}
      />
      {/* The card is positioned BELOW the highlight when there is room and above
          it otherwise, and is width-capped so it cannot overflow a 390px phone. */}
      <div
        className="absolute w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-[--rp-border] bg-[--surface-0] p-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.35)]"
        style={{
          top: rect.bottom + 180 < window.innerHeight
            ? rect.bottom + 12
            : Math.max(12, rect.top - 176),
          left: Math.max(12, Math.min(rect.left, window.innerWidth - 12 - Math.min(320, window.innerWidth - 24))),
        }}
      >
        <div className="font-brand font-bold text-[--ink-1] text-sm">{stepCopy?.title}</div>
        <p className="text-[12px] text-[--ink-2] mt-1 leading-relaxed">{stepCopy?.body}</p>
        <div className="flex items-center justify-between gap-2 mt-3">
          <span className="text-[11px] text-[--ink-3] tabular-nums">{index + 1}/{steps.length}</span>
          <button
            type="button"
            onClick={() => (last ? finish() : setIndex((i) => i + 1))}
            className="min-h-[40px] px-4 rounded-lg bg-rp-fire text-white text-[13px] font-medium"
          >
            {last ? copy.gotIt : copy.next}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export { SPOTLIGHT_STEPS };
