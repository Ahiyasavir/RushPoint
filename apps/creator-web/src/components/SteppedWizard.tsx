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
import type { ReactNode } from 'react';
import { Button } from './ui';

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
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[--ink-3]">{labels.progress(index + 1, total)}</span>
        </div>
        <div
          className="mt-1.5 h-1 rounded-full bg-[--surface-2] overflow-hidden"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={labels.progress(index + 1, total)}
        >
          <div
            className="h-full bg-rp-fire transition-all duration-300"
            style={{ inlineSize: `${percent}%` }}
          />
        </div>
      </div>

      <div>
        <h3 className="font-brand font-bold text-[--ink-1] text-lg">{step.title}</h3>
        {step.subtitle && <p className="text-[--ink-3] text-[13px] mt-0.5">{step.subtitle}</p>}
      </div>

      <div className="flex flex-col gap-4">{step.render()}</div>

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
