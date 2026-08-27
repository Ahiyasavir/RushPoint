// The live shape panel — the game accumulating while the creator answers
// (change: smart-build-delight).
//
// ═══════════════════════════════════════════════════════════════════════════
// What this component must NEVER do
// ═══════════════════════════════════════════════════════════════════════════
//
// SHOW A MISSION. Not its title, not its type, not its media, not its location,
// not a hint of which one it is. The panel renders `slots: number` and nothing
// else, and the type it accepts is the reason that is not merely a promise:
// `previewShape` never reaches the composer's fill step, so there is no mission
// identity in scope here to leak by accident. Two things depend on it —
//   1. the reveal still has something to reveal, and
//   2. a hidden mission's identity never sits in a rendered payload.
// If a future change wants richer cards, widen `previewShape`, not this file.
//
// Stages are labelled BY POSITION ("stage 1"), never by their composed name:
// `nameStages` runs after every mission is chosen, so no preview can know the
// names without running the whole fill sequence. They are part of the reveal.
//
// Presentational and copy-free — every string arrives through props, so it
// cannot leak an untranslated word.
import { useEffect, useRef } from 'react';
import type { ShapeStage } from '../lib/composeGame';

export interface SmartBuildShapePanelProps {
  stages: readonly ShapeStage[];
  /** False when these answers cannot make a game — renders the empty state. */
  possible: boolean;
  labels: {
    title: string;
    hint: string;
    /** "stage 2" — the caller formats it, so word order stays translatable. */
    stage: (n: number) => string;
    slots: (n: number) => string;
    empty: string;
  };
}

/**
 * How many stages we have ever shown, so a card that appears is animated but a
 * card that was already there is not. Re-animating the whole panel on every
 * keystroke is what makes a live preview feel like a flicker rather than a build.
 */
function useGrownCount(count: number): number {
  const prev = useRef(0);
  // Read DURING the render, before the effect below moves it: that is what makes
  // the returned value "how many there were last time" rather than "how many
  // there are". Deliberately not state — writing state here would cost a second
  // render to say what this one already knows.
  const previous = prev.current;
  useEffect(() => { prev.current = count; }, [count]);
  return previous;
}

export default function SmartBuildShapePanel({ stages, possible, labels }: SmartBuildShapePanelProps) {
  const list = Array.isArray(stages) ? stages : [];
  const previousCount = useGrownCount(list.length);
  const totalSlots = list.reduce((sum, s) => sum + Math.max(0, Math.floor(s?.slots ?? 0)), 0);
  const hasShape = possible && list.length > 0;

  return (
    // Two renderings of the same fact, toggled by CSS alone — never a JS
    // breakpoint check, so there is nothing to get out of sync on resize
    // (change: smart-build-wizard-no-scroll).
    //
    // Below `lg` the panel sits ABOVE the question (see SmartBuildWizard's
    // layout note), and the full card-per-stage aside was costing it ~100px
    // of stacked height for a delight, not information — exactly what pushed
    // a normal phone into an internal scroll on the denser questions. There,
    // a one-line pill carries the one fact worth knowing before the reveal:
    // how big this is getting. The full growing-stages view is a desktop-only
    // treat, where it sits beside the question instead of above it.
    <>
      {hasShape && (
        <div className="flex lg:hidden items-center gap-1.5 w-fit rounded-full border border-[--rp-border] bg-[--surface-1] px-3 py-1 text-[13px] text-[--ink-2]" aria-live="polite">
          <span aria-hidden="true">🧩</span>
          <span>{labels.slots(totalSlots)}</span>
        </div>
      )}
      <aside
        className="hidden lg:block rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3"
        // A live region: the panel changes in response to an answer given
        // elsewhere, which a screen-reader user would otherwise never learn about.
        // `polite` so it waits for them to finish with the question they are on.
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="font-brand font-bold text-[--ink-1] text-sm">{labels.title}</h4>
          {hasShape && (
            <span className="shrink-0 text-[13px] text-[--ink-3]">{labels.slots(totalSlots)}</span>
          )}
        </div>
        <p className="text-[13px] text-[--ink-3] mt-0.5 leading-relaxed">{labels.hint}</p>

        {!hasShape ? (
          <p className="text-[12px] text-[--ink-3] mt-2 text-center">{labels.empty}</p>
        ) : (
          // One small numbered tile per stage, not a card (change:
          // smart-build-wizard-no-scroll) — a card-per-stage list grew without
          // bound (6-8 stages stacked into 300-400px) and forced the modal to
          // scroll on exactly the answers that produce a bigger game. A
          // flex-wrap row of tiles stays roughly one line tall regardless of
          // stage count: it wraps instead of growing downward per item.
          <ol className="mt-2 flex flex-wrap gap-1.5" aria-label={labels.title}>
            {list.map((stage, i) => {
              const slots = Math.max(0, Math.floor(stage?.slots ?? 0));
              // Only a tile that was not there a render ago animates in.
              const isNew = i >= previousCount;
              return (
                <li
                  key={i}
                  title={`${labels.stage(i + 1)} · ${labels.slots(slots)}`}
                  className={[
                    'flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-[--rp-border]',
                    'bg-[--surface-0] px-1.5 text-[13px] font-semibold text-[--ink-2]',
                    // The app's own keyframe, not a bespoke one; `motion-safe`
                    // is what honours a reduced-motion preference.
                    isNew ? 'motion-safe:animate-fade-up' : '',
                  ].join(' ')}
                >
                  {i + 1}
                </li>
              );
            })}
          </ol>
        )}
      </aside>
    </>
  );
}
