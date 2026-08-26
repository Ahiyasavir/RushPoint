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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui';
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
        className="text-rp-fire transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
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
}

export interface SteppedWizardProps {
  steps: readonly WizardStepConfig[];
  /** Which step is showing. Out-of-range renders nothing rather than throwing. */
  index: number;
  onBack: () => void;
  onNext: () => void;
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
  };
}

export default function SteppedWizard({
  steps, index, onBack, onNext, canAdvance = true, busy, labels, finalNote,
}: SteppedWizardProps) {
  const total = steps.length;
  const step = steps[index];

  // Which way the last move went, so the question animates in from the side it
  // came from. A ref, not state: it is read during the render that the index
  // change already triggered, and making it state would cost a second render to
  // say something the first one already knew.
  const previousIndex = useRef(index);
  const direction = index >= previousIndex.current ? 1 : -1;
  useEffect(() => {
    // Advancing is the moment worth acknowledging. `haptic` is itself a silent
    // no-op without vibration support and under reduced motion, so no guard is
    // needed here and a device without it simply advances.
    if (index !== previousIndex.current) haptic('tap');
    previousIndex.current = index;
  }, [index]);

  // Re-keying on the index restarts the entry animation for each question.
  // `motion-safe:` is what honours a reduced-motion preference — under it the
  // question simply appears, which is the correct behaviour, not a degraded one.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(false);
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [index]);

  // An out-of-range index is a real state (the flow just finished, or the parent
  // is mid-transition). Rendering nothing is correct; throwing would take the
  // whole dashboard to the ErrorBoundary over a transient.
  if (!step) return null;

  const isLast = index === total - 1;
  const percent = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Progress first: a creator deciding whether to start should see the cost
          before the first question, not after the third. */}
      <div>
        <div className="flex items-center gap-2">
          <ProgressRing step={index + 1} total={total} label={labels.progress(index + 1, total)} />
          <span className="text-[11px] text-[--ink-3]">{labels.progress(index + 1, total)}</span>
        </div>
        {/* The bar stays: the ring reads as "how far", the bar as "how much is
            left", and on a narrow screen the bar is the one visible at a glance.
            aria-hidden because the ring above already announces the same values,
            and two progressbars would be read twice. */}
        <div className="mt-1.5 h-1 rounded-full bg-[--surface-2] overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-rp-fire transition-all duration-300 motion-reduce:transition-none"
            style={{ inlineSize: `${percent}%` }}
          />
        </div>
      </div>

      <div
        key={index}
        className={[
          'flex flex-col gap-4',
          'motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out',
          entered ? 'opacity-100 translate-x-0' : 'motion-safe:opacity-0',
          entered ? '' : direction > 0 ? 'motion-safe:translate-x-4' : 'motion-safe:-translate-x-4',
        ].join(' ')}
      >
        <div>
          <h3 className="font-brand font-bold text-[--ink-1] text-lg">{step.title}</h3>
          {step.subtitle && <p className="text-[--ink-3] text-[13px] mt-0.5">{step.subtitle}</p>}
        </div>

        <div className="flex flex-col gap-4">{step.render()}</div>
      </div>

      {isLast && finalNote && (
        <div className="rounded-xl border border-[--rp-border] bg-[--surface-1] px-3 py-2.5 text-[12px] text-[--ink-2] leading-relaxed">
          {finalNote}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack} className="min-h-[44px]">
          {labels.back}
        </Button>
        <Button
          onClick={onNext}
          disabled={!canAdvance}
          loading={isLast ? busy : false}
          className="flex-1 min-h-[44px]"
        >
          {isLast ? labels.finish : labels.next}
        </Button>
      </div>
    </div>
  );
}
