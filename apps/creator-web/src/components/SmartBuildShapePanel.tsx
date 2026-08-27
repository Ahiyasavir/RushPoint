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
    /** The accessible name of one unfilled slot. */
    slotPending: string;
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

  return (
    <aside
      className="rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3 sm:p-4"
      // A live region: the panel changes in response to an answer given
      // elsewhere, which a screen-reader user would otherwise never learn about.
      // `polite` so it waits for them to finish with the question they are on.
      aria-live="polite"
    >
      <h4 className="font-brand font-bold text-[--ink-1] text-sm">{labels.title}</h4>
      <p className="text-[11px] text-[--ink-3] mt-0.5 leading-relaxed">{labels.hint}</p>

      {!possible || list.length === 0 ? (
        <p className="text-[12px] text-[--ink-3] mt-3 py-6 text-center">{labels.empty}</p>
      ) : (
        <ol className="mt-3 flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {list.map((stage, i) => {
            const slots = Math.max(0, Math.floor(stage?.slots ?? 0));
            // Only a card that was not there a render ago animates in.
            const isNew = i >= previousCount;
            return (
              <li
                key={i}
                className={[
                  'shrink-0 min-w-[9rem] lg:min-w-0 rounded-xl border border-[--rp-border]',
                  'bg-[--surface-0] px-3 py-2.5',
                  // The app's own keyframe, not a bespoke one; `motion-safe`
                  // is what honours a reduced-motion preference.
                  isNew ? 'motion-safe:animate-fade-up' : '',
                ].join(' ')}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[--ink-1]">{labels.stage(i + 1)}</span>
                  <span className="text-[11px] text-[--ink-3]">{labels.slots(slots)}</span>
                </div>
                {/* One bar per stage, not one per mission (change: smart-build-delight
                    follow-up) — a stage with 6-7 missions used to enumerate 6-7
                    individual dots and push the panel past the modal's height,
                    forcing an internal scroll the questionnaire never needed before
                    this panel existed. The bar still fills as `slots` grows, so the
                    "building" feeling survives; it just costs one row instead of N. */}
                <div
                  title={labels.slotPending}
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-full rounded-full bg-[--surface-2] overflow-hidden"
                >
                  <div className="h-full w-full rounded-full bg-[--rp-border]" />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
