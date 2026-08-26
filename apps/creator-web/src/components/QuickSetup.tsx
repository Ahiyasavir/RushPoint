// הקמה מהירה / Quick Setup — the Builder surface (change: quick-setup-wizard).
//
// Every decision this file renders is made in lib/quickSetup (which step, what is
// still outstanding, which tab/group/control to open, which chapter we are in).
// What lives HERE is the chrome, written to feel like a friendly co-builder rather
// than a form validator working through a checklist:
//
//   • QuickSetupWelcome     — the one-time invitation on a fresh template
//   • QuickSetupIntro       — "here's the mission we're about to set up", BEFORE
//                             any control is touched (context-first navigation)
//   • QuickSetupBar         — the running step bar, with a real progress trail
//   • QuickSetupCelebration — a small, genuine "you did it" moment at the end
//   • QuickSetupPill        — the persistent "נותרו N שדות" indicator
//   • QuickSetupBlocked     — the launch refusal, one activatable row per missing field
//   • useQuickSetupFocus    — scroll to the target control, focus it, pulse it
//
// Each step's HEADLINE is product copy (t.quickSetup.copy[step's slot]) — short,
// conversational, written for a human about to touch that exact control. The
// template's own `instructionPrompt` is kept underneath, quietly labelled as the
// template author's note: nothing authored is thrown away, it just stops being the
// voice the product itself speaks in. That authored text IS content, not a
// dictionary key, so it alone renders with dir="auto".
import { useEffect } from 'react';
import type { TemplateWizardStep } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Button } from './ui';
import ConfettiBurst from './ConfettiBurst';
import type { QuickSetupCopyKey } from '../lib/quickSetup';

/** How long the ring stays on the target after we focus it. */
const PULSE_MS = 2600;

/**
 * How often to re-check for the target, and how long to keep trying before
 * giving up.
 *
 * `setTimeout`, deliberately, NOT `requestAnimationFrame`. This is a "wait until
 * something mounts" poll, not animation-timed work — and rAF is throttled to
 * ZERO on a hidden or non-composited tab (`document.visibilityState !==
 * 'visible'`), which silently stopped this whole feature from ever landing a
 * single retry when the Builder isn't the foregrounded, painted tab. A creator
 * who opens Quick Setup, then alt-tabs away while the drawer is still sliding in,
 * would have come back to a step that navigated but never focused or rang
 * anything — with nothing wrong that a stack trace would show, because rAF
 * doesn't throw when suspended, it just never calls back. `setTimeout` keeps
 * firing regardless of tab visibility, so the retry budget is honoured either way.
 *
 * The chain between "step activated" and "control exists in the DOM" is not one
 * render, either: BuilderPage sets stage/task state, StepStages' effect opens the
 * mission editor, ContextPanel MOUNTS (a fresh `key`, not a re-render), its own
 * slide-in effect schedules a frame, TaskWizard mounts, and ITS `focusNonce`
 * effect switches editor tabs. Each hop is a separate commit, easily outrunning a
 * handful of frames under unminified dev-mode React — hence a multi-second
 * wall-clock budget, not a frame count.
 */
const FOCUS_POLL_MS = 60;
const FOCUS_RETRY_BUDGET_MS = 3000;

/**
 * Scroll the anchored control into view, focus it, and ring it.
 *
 * Runs on a `nonce` rather than on the anchor alone, so activating the SAME step
 * twice (a creator pressing the pill again) navigates again instead of silently
 * doing nothing.
 *
 * Deliberately tolerant end to end: the drawer animates in, so the element may not
 * exist yet; retrying for a few seconds covers that, and if it never appears the
 * creator simply lands on the right mission with the instruction on screen. A
 * missing anchor must never throw inside a Builder effect.
 */
export function useQuickSetupFocus(anchor: string | null, nonce: number): void {
  useEffect(() => {
    if (!anchor) return undefined;
    let poll: number | undefined;
    let pulseTimer: number | undefined;
    let ringed: Element | null = null;
    const deadline = performance.now() + FOCUS_RETRY_BUDGET_MS;

    const tryFocus = (): void => {
      const host = document.querySelector(`[data-qs-field="${CSS.escape(anchor)}"]`);
      if (!host) {
        if (performance.now() < deadline) poll = window.setTimeout(tryFocus, FOCUS_POLL_MS);
        return;
      }
      try {
        host.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { /* older engines: the focus below still brings it into view */ }
      // The anchor may BE the control, or may wrap it (a map, a chip group).
      const focusable = host.matches('input, textarea, select, button, [contenteditable]')
        ? (host as HTMLElement)
        : host.querySelector<HTMLElement>('input, textarea, select, button, [contenteditable], [tabindex]');
      try {
        focusable?.focus({ preventScroll: true });
        if (focusable instanceof HTMLInputElement || focusable instanceof HTMLTextAreaElement) {
          const end = focusable.value?.length ?? 0;
          focusable.setSelectionRange?.(end, end);
        }
      } catch { /* a control that refuses focus still gets the ring */ }
      host.classList.add('rp-qs-pulse');
      ringed = host;
      pulseTimer = window.setTimeout(() => host.classList.remove('rp-qs-pulse'), PULSE_MS);
    };

    poll = window.setTimeout(tryFocus, 0);
    return () => {
      if (poll) window.clearTimeout(poll);
      if (pulseTimer) window.clearTimeout(pulseTimer);
      ringed?.classList.remove('rp-qs-pulse');
    };
  }, [anchor, nonce]);
}

/**
 * Shared glass-card surface for every overlay this flow renders.
 *
 * The background/blur live in the `.rp-qs-glass` CSS class (index.css), not as
 * Tailwind utilities: `bg-[--surface-1]/80` cannot apply an opacity modifier to
 * an arbitrary CSS custom property (Tailwind 3 needs an r/g/b triplet to do
 * that), so it silently compiles to no rule — every "glass" card was rendering
 * fully transparent. `border`/`shadow` stay Tailwind since `white/10` and the
 * shadow's own rgba are values Tailwind CAN decompose.
 */
const GLASS_CARD = 'rp-qs-glass rounded-2xl border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.25)]';

/** A slim, capped progress trail — a bar past a handful of steps, dots below it. */
function QuickSetupProgressTrail({ index, total }: { index: number; total: number }) {
  const pct = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  const showDots = total > 1 && total <= 8;
  return (
    <div className="mt-1.5">
      <div className="h-1 rounded-full bg-[--surface-2] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-rp-fire to-rp-amber transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showDots && (
        <div className="flex items-center gap-1 mt-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-4 bg-rp-fire' : i < index ? 'w-1.5 bg-rp-fire/50' : 'w-1.5 bg-[--surface-2]'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** `t.quickSetup.copy[key]`, falling back to the generic line for a slot the dictionary lacks. */
function copyLine(copy: Record<string, string>, key: QuickSetupCopyKey): string {
  return copy[key] ?? copy.fallback;
}

/**
 * The opening invitation.
 *
 * Offered, not demanded: it appears once, on its own, over a fresh template with
 * outstanding fields — see `shouldAutoOpenQuickSetup`. Nothing on the canvas has
 * moved when this is on screen, so declining costs exactly one click.
 */
export function QuickSetupWelcome({ remaining, onBegin, onSkip }: {
  remaining: number;
  onBegin: () => void;
  onSkip: () => void;
}) {
  const q = useT().quickSetup;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={q.welcomeTitle}>
      <div className={`w-full max-w-md p-6 text-center ${GLASS_CARD}`}>
        <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-rp-fire to-rp-amber flex items-center justify-center text-2xl shadow-[0_4px_16px_rgba(255,87,34,0.35)]" aria-hidden>
          ✨
        </div>
        <p className="text-xs font-semibold text-rp-fire mt-4">{q.welcomeEyebrow}</p>
        <h2 className="text-xl font-bold text-[--ink-1] mt-1">{q.welcomeTitle}</h2>
        <p className="text-sm text-[--ink-1] leading-relaxed mt-2">{q.welcomeBody(remaining)}</p>
        <div className="flex flex-col gap-2 mt-5">
          <Button onClick={onBegin} className="w-full justify-center">{q.welcomeCta}</Button>
          <button type="button" onClick={onSkip} className="text-xs text-[--ink-1] underline underline-offset-2 py-1">
            {q.welcomeSkip}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The context card — "here's the mission we're about to work on" — shown BEFORE
 * any control is touched.
 *
 * This is the fix for the flow feeling robotic: version one jumped straight into
 * an input the instant a step activated. Landing on THIS card first, every time
 * the flow crosses into a new mission (never between two fields of the SAME one —
 * see `quickSetupChapterKey`), gives the creator a beat to read where they are
 * before the canvas asks anything of them.
 */
export function QuickSetupIntro({ step, index, total, taskTitle, summary, scope, onBegin, onDefer, onClose }: {
  step: TemplateWizardStep;
  index: number;
  total: number;
  /** Resolved mission title, or `''` for an untitled one. `null` for a game-level step. */
  taskTitle: string | null;
  /**
   * What players actually do in this mission, in the creator's own words — the
   * mission's description, trimmed to its first sentence. `''` when the mission has
   * no description yet, which is precisely the case the generic line covers.
   */
  summary: string;
  scope: 'game' | 'stage' | 'task';
  onBegin: () => void;
  onDefer: () => void;
  onClose: () => void;
}) {
  const q = useT().quickSetup;
  const isTask = scope === 'task' && taskTitle !== null;
  const heading = isTask ? q.introTaskLabel(taskTitle) : q.introGameLabel;
  const fallback = isTask ? q.introFallback(taskTitle) : q.introGameFallback;
  return (
    <div
      role="region"
      aria-label={q.title}
      className={`fixed z-50 top-2 mx-auto w-[min(30rem,calc(100%-1rem))] p-4 ${GLASS_CARD}`}
      style={{ insetInlineStart: 0, insetInlineEnd: 0 }}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold text-rp-fire">
        <span aria-hidden>🧭</span>
        <span>{q.introEyebrow(index + 1, total)}</span>
        <span className={`rounded px-1.5 py-0.5 ${step.isRequired ? 'bg-rp-fire/10 text-rp-fire' : 'bg-[--surface-2] text-[--ink-1]'}`}>
          {step.isRequired ? q.requiredBadge : q.optionalBadge}
        </span>
      </div>
      <h3 className="text-base font-bold text-[--ink-1] mt-1.5" dir="auto">{heading}</h3>
      {/* The creator's own description when there is one — authored CONTENT, hence
          dir="auto"; the generic line only when the mission has nothing to say yet. */}
      {summary
        ? <p className="text-sm text-[--ink-1] leading-snug mt-1" dir="auto">{summary}</p>
        : <p className="text-sm text-[--ink-1] leading-snug mt-1">{fallback}</p>}
      <div className="flex items-center gap-2 justify-end mt-3.5">
        <button type="button" onClick={onDefer} className="text-xs text-[--ink-1] underline underline-offset-2">
          {q.defer}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={q.close}
          title={q.close}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none"
        >
          ✕
        </button>
        <Button onClick={onBegin}>{q.introCta}</Button>
      </div>
    </div>
  );
}

/**
 * The running step bar.
 *
 * The HEADLINE is product copy — one short line written for whoever is about to
 * touch this specific control (`copyKey`). The template's own `instructionPrompt`
 * is kept, but demoted to a quiet secondary line: nothing an author wrote is
 * discarded, it simply stops being the voice the product speaks in. That authored
 * text is CONTENT, not copy, so only it renders with dir="auto".
 *
 * Fixed to the top of the Builder rather than docked into the header: it has to
 * stay legible while the creator is typing into a control anywhere on the page,
 * including inside the mission drawer, which the header sits behind.
 */
export function QuickSetupBar({ step, index, total, copyKey, onNext, onDefer, onClose }: {
  step: TemplateWizardStep;
  index: number;
  total: number;
  copyKey: QuickSetupCopyKey;
  onNext: () => void;
  onDefer: () => void;
  onClose: () => void;
}) {
  const q = useT().quickSetup;
  const headline = copyLine(q.copy, copyKey);
  return (
    <div
      role="region"
      aria-label={q.title}
      // Logical inset (not left/right) so the bar centres identically in RTL and
      // LTR; the inline style carries it because Tailwind has no logical-inset
      // utility and a template-string class would not exist at build time.
      // STACKED on a phone, side-by-side from `sm` up. As one row it was unreadable
      // on a narrow screen: the action cluster below is `shrink-0` and holds a full
      // Hebrew sentence ("חזור לזה מאוחר יותר") plus a button and a close box, so on
      // a ~390px viewport it claimed almost the whole width and left the text column
      // — `flex-1 min-w-0`, which is allowed to shrink to nothing — about two words
      // per line, turning three sentences into a tall ribbon down one edge.
      className={`fixed z-50 top-2 mx-auto w-[min(46rem,calc(100%-1rem))] px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3 ${GLASS_CARD}`}
      style={{ insetInlineStart: 0, insetInlineEnd: 0 }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-rp-fire">
          <span>{q.title}</span>
          <span className={`rounded px-1.5 py-0.5 ${step.isRequired ? 'bg-rp-fire/10 text-rp-fire' : 'bg-[--surface-2] text-[--ink-1]'}`}>
            {step.isRequired ? q.requiredBadge : q.optionalBadge}
          </span>
        </div>
        <p className="text-sm text-[--ink-1] font-medium leading-snug mt-1">{headline}</p>
        {/* The template author's own note, kept but quiet — authored CONTENT, not
            copy, so it alone renders with dir="auto". */}
        {step.instructionPrompt && step.instructionPrompt !== headline && (
          <p className="text-xs text-[--ink-1] leading-snug mt-0.5" dir="auto">{step.instructionPrompt}</p>
        )}
        <QuickSetupProgressTrail index={index} total={total} />
      </div>
      {/* Its own full-width row on a phone (wrapping if the defer sentence is long),
          a fixed-size cluster beside the text from `sm` up. */}
      <div className="flex items-center flex-wrap gap-1.5 justify-end shrink-0 sm:flex-nowrap sm:pt-0.5">
        <button
          type="button"
          onClick={onDefer}
          className="text-xs text-[--ink-1] underline underline-offset-2"
        >
          {q.defer}
        </button>
        <Button onClick={onNext}>{q.next}</Button>
        <button
          type="button"
          onClick={onClose}
          aria-label={q.close}
          title={q.close}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// The confetti now lives in components/ConfettiBurst.tsx so the smart build's
// reveal fires the SAME burst rather than a second copy of it
// (change: smart-build-delight).

/**
 * The finish-line moment.
 *
 * Shown once, exactly when the flow's OWN transitions carry it into `done` — never
 * on a page load that happens to find an already-finished game (that would be a
 * congratulations for nothing the creator just did).
 */
export function QuickSetupCelebration({ onClose }: { onClose: () => void }) {
  const q = useT().quickSetup;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={q.celebrateTitle}>
      <ConfettiBurst />
      <div className={`relative w-full max-w-md p-6 text-center ${GLASS_CARD}`}>
        <div className="mx-auto w-16 h-16 rounded-full bg-rp-go/15 border-2 border-rp-go flex items-center justify-center text-3xl rp-qs-checkmark" aria-hidden>
          ✓
        </div>
        <h2 className="text-xl font-bold text-[--ink-1] mt-4">{q.celebrateTitle}</h2>
        <p className="text-sm text-[--ink-1] leading-relaxed mt-2">{q.celebrateBody}</p>
        <Button onClick={onClose} className="w-full justify-center mt-5">{q.celebrateCta}</Button>
      </div>
    </div>
  );
}

/**
 * The persistent indicator.
 *
 * Its count is DERIVED from the live game on every render, so a creator who fills
 * a postponed field by hand watches it drop without ever reopening the flow.
 * Renders nothing when the game has no quick setup at all, so it is invisible for
 * every game that was not built from a template.
 */
export function QuickSetupPill({ remaining, total, onResume }: {
  remaining: number;
  total: number;
  onResume: () => void;
}) {
  const q = useT().quickSetup;
  if (total === 0) return null;
  const done = remaining === 0;
  return (
    <button
      type="button"
      onClick={onResume}
      data-tour="quick-setup-pill"
      title={done ? q.allDoneBody : q.remaining(remaining)}
      aria-label={done ? q.allDoneTitle : q.remaining(remaining)}
      className={`shrink-0 flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium border backdrop-blur-sm transition-colors ${
        done
          ? 'border-rp-go/40 text-rp-go hover:bg-rp-go/10'
          : 'border-rp-fire/40 text-rp-fire hover:bg-rp-fire/10'}`}
    >
      <span aria-hidden>{done ? '✓' : '⚡'}</span>
      {/* The pill carries the SHORT name; the full sentence stays in the tooltip
          and the accessible name, so the header strip cannot be pushed to a
          second row by a label that grows with the step count. */}
      <span className="hidden 2xl:inline">{q.pillLabel}</span>
      {!done && <span aria-hidden>{remaining}</span>}
    </button>
  );
}

/**
 * The launch refusal.
 *
 * Consulted only AFTER the existing readiness guard, so a game with a structural
 * blocker still gets that refusal and the two lists never interleave. Every row is
 * activatable: naming a missing field without being able to reach it is the exact
 * failure this whole feature exists to end.
 */
export function QuickSetupBlocked({ blockers, labelFor, onGo, onClose }: {
  blockers: TemplateWizardStep[];
  /** Where this step lives, e.g. "בשלב: משימות תחרות · במשימה: מצאו את המקום". */
  labelFor: (step: TemplateWizardStep) => string;
  onGo: (step: TemplateWizardStep) => void;
  onClose: () => void;
}) {
  const q = useT().quickSetup;
  if (blockers.length === 0) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={q.blockedTitle}>
      <div className={`w-full max-w-lg p-4 ${GLASS_CARD}`}>
        <h3 className="text-base font-bold text-[--ink-1]">{q.blockedTitle}</h3>
        <p className="text-xs text-[--ink-1] leading-snug mt-1">{q.blockedBody}</p>
        <ul className="mt-3 space-y-1.5 max-h-72 overflow-y-auto">
          {blockers.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => onGo(step)}
                className="w-full text-start rounded-lg border border-[--rp-border] hover:border-rp-fire/60 hover:bg-rp-fire/5 px-3 py-2 transition-colors"
              >
                <span className="block text-sm text-[--ink-1] leading-snug" dir="auto">
                  {step.instructionPrompt || labelFor(step)}
                </span>
                <span className="block text-[11px] text-[--ink-1] mt-0.5" dir="auto">{labelFor(step)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 justify-end pt-3">
          <Button variant="ghost" onClick={onClose}>{q.blockedDismiss}</Button>
          <Button onClick={() => onGo(blockers[0])}>{q.blockedCta}</Button>
        </div>
      </div>
    </div>
  );
}
