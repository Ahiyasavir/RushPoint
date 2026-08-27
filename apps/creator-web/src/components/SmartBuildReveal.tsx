// The reveal — the moment the composed game becomes visible
// (change: smart-build-delight).
//
// ═══════════════════════════════════════════════════════════════════════════
// What this exists to fix
// ═══════════════════════════════════════════════════════════════════════════
//
// The smart build used to end by navigating: eight questions, then a Builder
// route with a game already in it. The single best moment in the flow was spent
// on a route change. This is that moment given somewhere to happen — the slots
// the creator watched accumulate in the shape panel fill in, one at a time, with
// the missions that were actually chosen.
//
// ─── Reconciling the plan with the delivery ──────────────────────────────────
// The panel showed a PLAN. `composeGame` drops a planned slot whose candidate
// pool is exhausted, so a stage can arrive holding fewer missions than were
// promised. A placeholder that never fills reads as a bug, so a dropped slot is
// RETIRED visibly instead: `plannedSlots` is compared against the missions that
// actually arrived, and the difference is rendered as a struck-through rest.
// Never hidden — the creator watched those slots appear.
//
// ─── Never a gate ────────────────────────────────────────────────────────────
// The continue action is live from the first frame. An animation the creator has
// to sit through is a worse experience than the navigation it replaced, and the
// game already exists by the time this renders — nothing here is load-bearing.
// Under `prefers-reduced-motion` the finished game is presented immediately.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui';
import ConfettiBurst from './ConfettiBurst';

/** One stage as the reveal shows it: what was planned, and what arrived. */
export interface RevealStage {
  /** Titles of the missions the composer actually chose, in order. */
  missions: string[];
  /** How many slots the shape panel promised for this stage. */
  plannedSlots: number;
}

export interface SmartBuildRevealProps {
  gameTitle: string;
  stages: readonly RevealStage[];
  onContinue: () => void;
  /** Rendered beside Continue when the caller has something to share. */
  shareSlot?: React.ReactNode;
  labels: {
    title: string;
    subtitle: string;
    /** "stage 2" — caller formats it, so word order stays translatable. */
    stage: (n: number) => string;
    missions: (n: number) => string;
    continue: string;
    /** Accessible name for the revealed game as a whole. */
    aria: string;
  };
}

/** Does this viewer want motion? Read once — it is a preference, not a stream. */
function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    // A blocked or absent matchMedia must not decide "animate anyway" — erring
    // toward less motion is the safe direction for a preference about motion.
    return true;
  }
}

const STEP_MS = 260;

export default function SmartBuildReveal({
  gameTitle, stages, onContinue, shareSlot, labels,
}: SmartBuildRevealProps) {
  const list = useMemo(() => (Array.isArray(stages) ? stages : []), [stages]);
  const reduced = useRef(prefersReducedMotion()).current;

  // Every mission across every stage, flattened, so the fill is one running
  // count rather than a timer per stage. Reduced motion starts at "all shown".
  const totalMissions = useMemo(
    () => list.reduce((n, s) => n + (Array.isArray(s.missions) ? s.missions.length : 0), 0),
    [list],
  );
  const [shown, setShown] = useState(() => (reduced ? Number.MAX_SAFE_INTEGER : 0));

  useEffect(() => {
    if (reduced || shown >= totalMissions) return;
    const id = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [reduced, shown, totalMissions]);

  // Running index across stages, so stage 2's first mission knows how many came
  // before it and can wait its turn.
  let cursor = 0;

  return (
    <div className="relative flex flex-col gap-4" role="group" aria-label={labels.aria}>
      <ConfettiBurst />

      <div className="text-center">
        <h3 className="font-brand font-extrabold text-[--ink-1] text-xl">{labels.title}</h3>
        <p className="text-[13px] text-[--ink-3] mt-1">{labels.subtitle}</p>
      </div>

      <div className="rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3 sm:p-4">
        <p className="font-brand font-bold text-[--ink-1] text-base text-center" dir="auto">{gameTitle}</p>

        <ol className="mt-3 flex flex-col gap-2">
          {list.map((stage, i) => {
            // Typed explicitly: `Array.isArray` narrows to `any[]`, which would
            // let an untyped title through into the markup below.
            const missions: string[] = Array.isArray(stage.missions) ? stage.missions : [];
            const planned = Math.max(0, Math.floor(stage.plannedSlots ?? 0));
            // Slots the panel promised that the composer could not fill.
            const retired = Math.max(0, planned - missions.length);

            return (
              <li key={i} className="rounded-xl border border-[--rp-border] bg-[--surface-0] px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[--ink-1]">{labels.stage(i + 1)}</span>
                  <span className="text-[11px] text-[--ink-3]">{labels.missions(missions.length)}</span>
                </div>

                <ul className="mt-1.5 flex flex-col gap-1">
                  {missions.map((title, m) => {
                    const isShown = cursor < shown;
                    cursor++;
                    return (
                      <li
                        key={m}
                        className={[
                          'text-[12px] text-[--ink-2] flex items-center gap-2',
                          'motion-safe:transition-opacity motion-safe:duration-200',
                          isShown ? 'opacity-100' : 'opacity-0',
                        ].join(' ')}
                        // Until it has been revealed it is not content yet —
                        // hiding it from assistive tech keeps the reading order
                        // matching what is on screen.
                        aria-hidden={!isShown}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-rp-fire shrink-0" aria-hidden="true" />
                        <span dir="auto">{title}</span>
                      </li>
                    );
                  })}

                  {/* A promised slot the bank could not fill. Shown, struck
                      through, never silently dropped — the creator watched it
                      appear in the panel and would notice it vanish. */}
                  {Array.from({ length: retired }, (_, r) => (
                    <li key={`retired-${r}`} className="flex items-center gap-2" aria-hidden="true">
                      <span className="h-1.5 w-1.5 rounded-full bg-[--surface-2] shrink-0" />
                      <span className="h-1.5 w-16 rounded-full bg-[--surface-2] relative">
                        <span className="absolute inset-x-0 top-1/2 h-px bg-[--ink-3]/50" />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Live from the first frame — see the header. */}
      <div className="flex gap-2">
        {shareSlot}
        <Button onClick={onContinue} className="flex-1 min-h-[44px]">{labels.continue}</Button>
      </div>
    </div>
  );
}
