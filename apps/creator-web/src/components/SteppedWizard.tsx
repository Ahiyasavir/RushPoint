// A generic stepped-wizard shell (change: smart-game-composer).
//
// Presentational ONLY. It knows about steps, an index, a progress bar and two
// buttons — and nothing about games, templates, missions or the task bank. That
// is deliberate and load-bearing: the story path is due to move onto this same
// shell in a later change, and a shell that had learned anything about the smart
// build would have to be untangled first.
//
// Everything it renders comes from props, including every string, so it carries
// no copy of its own and cannot leak an untranslated word.
//
// One question per screen, rather than the four-in-one-scroll the guided path
// uses: the smart build asks six or seven, and a single scroll of seven chip
// rows on a 390px phone is a form, not a conversation. The progress bar is what
// makes that trade honest — a creator can always see how much is left.
//
// Swipe, not "Next" (Ahiya, 30.10: "אני לא אוהב את ה'הבא'"). The questions are slides in an Embla
// carousel: a swipe moves between them with real snap physics (RTL aware), and a step marked
// `autoAdvance` (one answer from a list) moves on by itself once it is answered, so the common path
// is tap, tap, tap. The Next button remains only where an answer needs confirming: several choices,
// typed text, and the final "build my game".
import { useEffect, useRef, type ReactNode } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import AutoHeight from 'embla-carousel-auto-height';
import { Button } from './ui';
import { Icon } from './Icon';
import { haptic } from '../lib/haptics';

/**
 * The progress ring (change: smart-build-delight).
 *
 * Drawn with a stroke-dash offset rather than an SVG arc path: an arc needs
 * trigonometry to place its endpoint and degenerates at 0% and 100%, where a
 * dash offset is simply "all" and "none".
 *
 * Carries the `progressbar` role and its values, so the textual step count
 * beside it is not the only thing announced. Copy-free — the label is a prop.
 */
function ProgressRing({ step, total, label }: { step: number; total: number; label: string }) {
  const r = 9;
  const circumference = 2 * Math.PI * r;
  const fraction = total > 0 ? Math.min(1, Math.max(0, step / total)) : 0;

  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 -rotate-90"
      role="progressbar"
      aria-valuenow={step}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={label}
    >
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[--surface-2]" />
      <circle
        cx="12" cy="12" r={r}
        fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        className="text-ink-fire transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
      />
    </svg>
  );
}

export interface WizardStepConfig {
  id: string;
  title: string;
  subtitle?: string;
  render: () => ReactNode;
  /** One answer from a list: the caller moves on by itself once it is picked, so no Next button. */
  autoAdvance?: boolean;
  /** The last answer is the go signal: picking it builds, so the step has no finish button. */
  finishOnAnswer?: boolean;
}

export interface SteppedWizardProps {
  steps: readonly WizardStepConfig[];
  /** Which step is showing. Out-of-range renders nothing rather than throwing. */
  index: number;
  onBack: () => void;
  onNext: () => void;
  /** A swipe landed on another question. The caller moves its own index there. */
  onSwipeTo?: (index: number) => void;
  /** False disables Next — for a question that genuinely cannot be skipped. */
  canAdvance?: boolean;
  /**
   * Rendered between the step body and the buttons, on the LAST step only.
   *
   * The shell's one concession to "what happens when I press this": a caller
   * that wants to tell the creator what the final tap will produce needs it
   * adjacent to the button, not buried above the options. Still content-free
   * here — the shell decides only WHERE it goes, never what it says.
   */
  finalNote?: ReactNode;
  busy?: boolean;
  labels: {
    back: string;
    next: string;
    /** The final step's call to action, e.g. "build my game". */
    finish: string;
    /** "step 2 of 7" — the caller formats it, so word order stays translatable. */
    progress: (step: number, total: number) => string;
    /** Under a question that moves on by itself: "tap an answer, or swipe". */
    swipeHint?: string;
  };
}

export default function SteppedWizard({
  steps, index, onBack, onNext, onSwipeTo, canAdvance = true, busy, labels, finalNote,
}: SteppedWizardProps) {
  const total = steps.length;
  const step = steps[index];
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  const [viewportRef, embla] = useEmblaCarousel(
    { direction: rtl ? 'rtl' : 'ltr', startIndex: Math.max(0, index), align: 'start', duration: 24 },
    [AutoHeight()],
  );

  // The index is owned by the caller. A swipe reports where it landed; a tap that moved the
  // caller's index scrolls the carousel there. The ref keeps the swipe handler from echoing a
  // move the caller itself just made.
  const indexRef = useRef(index);
  indexRef.current = index;
  const swipeTo = useRef(onSwipeTo);
  swipeTo.current = onSwipeTo;
  useEffect(() => {
    if (!embla) return;
    const onSelect = () => {
      const i = embla.selectedScrollSnap();
      if (i !== indexRef.current) swipeTo.current?.(i);
    };
    embla.on('select', onSelect);
    return () => { embla.off('select', onSelect); };
  }, [embla]);
  useEffect(() => {
    if (embla && index >= 0 && index < total && embla.selectedScrollSnap() !== index) embla.scrollTo(index);
  }, [embla, index, total]);

  // Advancing is the moment worth acknowledging. `haptic` is itself a silent no-op without
  // vibration support and under reduced motion.
  const previousIndex = useRef(index);
  useEffect(() => {
    if (index !== previousIndex.current) haptic('tap');
    previousIndex.current = index;
  }, [index]);

  // An out-of-range index is a real state (the flow just finished, or the parent
  // is mid-transition). Rendering nothing is correct; throwing would take the
  // whole dashboard to the ErrorBoundary over a transient.
  if (!step) return null;

  const isLast = index === total - 1;
  const percent = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  const showNext = !step.finishOnAnswer && (isLast || !step.autoAdvance);

  return (
    <div className="flex flex-col gap-3">
      {/* Progress first: a creator deciding whether to start should see the cost
          before the first question, not after the third. */}
      <div>
        <div className="flex items-center gap-2">
          <ProgressRing step={index + 1} total={total} label={labels.progress(index + 1, total)} />
          <span className="text-[13px] text-[--ink-3]">{labels.progress(index + 1, total)}</span>
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-[--surface-2] overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-rp-fire transition-all duration-300 motion-reduce:transition-none"
            style={{ inlineSize: `${percent}%` }}
          />
        </div>
      </div>

      {/* Every question is a slide; only the current one is exposed to assistive tech. */}
      <div ref={viewportRef} className="overflow-hidden -mx-1 touch-pan-y">
        <div className="flex items-start transition-[height] duration-200 motion-reduce:transition-none">
          {steps.map((s, i) => (
            <section key={s.id} aria-hidden={i !== index} {...(i !== index ? { inert: "" } : {})}
              className="min-w-0 shrink-0 grow-0 basis-full px-1 flex flex-col gap-3">
              <div>
                <h3 className="font-brand font-bold text-[--ink-1] text-lg">{s.title}</h3>
                {s.subtitle && <p className="text-[--ink-3] text-[13px] mt-0.5">{s.subtitle}</p>}
              </div>
              <div className="flex flex-col gap-3">{s.render()}</div>
            </section>
          ))}
        </div>
      </div>

      {isLast && finalNote && (
        <div className="rounded-xl border border-[--rp-border] bg-[--surface-1] px-3 py-2.5 text-[12px] text-[--ink-2] leading-relaxed">
          {finalNote}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* A finger swipes back (Ahiya, 30.10); the button stays for a mouse and for a screen reader. */}
        <Button variant="ghost" onClick={onBack} className="min-h-[44px] [@media(pointer:coarse)]:sr-only">
          {labels.back}
        </Button>
        {showNext ? (
          <Button
            onClick={onNext}
            disabled={!canAdvance}
            loading={isLast ? busy : false}
            className="flex-1 min-h-[44px]"
          >
            {isLast ? labels.finish : labels.next}
          </Button>
        ) : (
          labels.swipeHint && index === 0 ? (
            <p className="flex-1 flex justify-center"><span className="ltr:rotate-90 rtl:-rotate-90 inline-flex"><Icon name="chevronUp" role="img" aria-hidden={false} aria-label={labels.swipeHint} className="w-7 h-7 text-ink-fire rp-swipe-hint" /></span></p>
          ) : <span className="flex-1" />
        )}
      </div>
    </div>
  );
}
