// הקמה מהירה / Quick Setup — the Builder surface (change: quick-setup-wizard).
//
// Every decision this file renders is made in lib/quickSetup (which step, what is
// still outstanding, which tab/group/control to open, which chapter we are in).
// What lives HERE is the chrome, written to feel like a friendly co-builder rather
// than a form validator working through a checklist:
//
//   • QuickSetupWelcome     — the one-time invitation on a fresh template
//   • QuickSetupBar         — the ONE card per step: which mission, what to do
//                             here, and a real progress trail
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
import { useEffect, useState } from 'react';
import type { TemplateWizardStep } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Button } from './ui';
import ConfettiBurst from './ConfettiBurst';
import { finishVerdict, isShortNote, type QuickSetupCopyKey } from '../lib/quickSetup';
import { splitAsk, pickSupportLine } from '../lib/quickSetupAsk';
import { TAP_TARGET, TAP_TEXT } from '../lib/interaction';
import { Icon } from './Icon';

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
/**
 * ONE progress indicator (change: quick-setup-card-clarity). The card used to show "2 מתוך 2", a
 * bar AND a row of dots for the same fact; three signals for one number is noise. Dots while the flow
 * is short enough to count at a glance, a thin bar beyond that, never both.
 */
function QuickSetupProgress({ index, total }: { index: number; total: number }) {
  if (total > 1 && total <= 8) {
    return (
      <span className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === index ? 'w-4 bg-rp-fire' : i < index ? 'w-1.5 bg-rp-fire/50' : 'w-1.5 bg-[--surface-2]'}`}
          />
        ))}
      </span>
    );
  }
  const pct = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  return (
    <span className="block w-16 h-1 rounded-full bg-[--surface-2] overflow-hidden" aria-hidden>
      <span className="block h-full rounded-full bg-rp-fire transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
    </span>
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
          <Icon name="sparkle" className="w-5 h-5" />
        </div>
        <p className="text-xs font-semibold text-ink-fire mt-4">{q.welcomeEyebrow}</p>
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
 * The step card — the ONE message about one change (change: quick-setup-one-card).
 *
 * It used to be two. A separate context card ("here is the mission we are about to
 * set up") came first whenever the flow crossed into a new mission, and the step
 * card came after it. The reasoning was sound — landing inside an input with no
 * idea which mission it belongs to reads as a machine driving the screen — but the
 * cure asked the creator to read and dismiss two screens to learn one thing, and
 * the creator said so plainly: all the information about one change belongs in a
 * single message. So the mission context moved in here, above the instruction, and
 * the second card is gone.
 *
 * The card carries, top to bottom:
 *
 *   • WHERE we are — stop N of M, required or optional;
 *   • WHICH mission — its name and, when it has one, the creator's own first line
 *     about it (authored CONTENT, hence dir="auto");
 *   • WHAT to do here — product copy for this exact control (`copyKey`);
 *   • the template author's note, when there is one, LABELLED as a quotation.
 *     That label is the whole point: the note is prose someone else wrote, often
 *     in the other language, and unlabelled directly beneath a Hebrew headline it
 *     read as one broken bilingual paragraph the product had written. The comment
 *     at the top of this file has claimed the note was "quietly labelled" since
 *     the day it was written; the markup never labelled it at all.
 *
 * Fixed to the top of the Builder rather than docked into the header: it has to
 * stay legible while the creator is typing into a control anywhere on the page,
 * including inside the mission drawer, which the header sits behind.
 */
export function QuickSetupBar({
  step, index, total, copyKey, taskTitle, summary, scope,
  onNext, onBack, onDefer, onClose, inline = false, beside = false,
}: {
  step: TemplateWizardStep;
  index: number;
  total: number;
  copyKey: QuickSetupCopyKey;
  /** Resolved mission title, or `''` for an untitled one. `null` for a game-level step. */
  taskTitle?: string | null;
  /**
   * What players actually do in this mission, in the creator's own words — the
   * mission's description, trimmed to its first sentence. `''` when the mission
   * has none yet, which is precisely the case the generic line covers.
   */
  summary?: string;
  scope?: 'game' | 'stage' | 'task';
  onNext: () => void;
  /**
   * One step back, or undefined at the first step — where there is nothing to go
   * back TO, and a control that can only explain its own refusal is worse than no
   * control.
   */
  onBack?: () => void;
  onDefer: () => void;
  onClose: () => void;
  /**
   * Render IN FLOW instead of floating (change: builder-mission-editor-route).
   *
   * While the mission editor is full-screen on a phone, this card lives inside it
   * rather than over it. As a `fixed z-50` element it claimed the same corner as
   * the editor's own surface, and the two negotiated by hand — the editor gave up
   * a third of its height so both could be seen. Nothing inside the editor has to
   * negotiate with the editor.
   *
   * Same component and the same copy on purpose: an instruction that reworded
   * itself depending on where it was shown would be a second thing to keep in
   * sync, and this one is already translated in two dictionaries.
   */
  inline?: boolean;
  /**
   * This card is in its OWN COLUMN beside the work, not stacked above it
   * (change: guided-card-should-not-scroll).
   *
   * The height cap below exists because a stacked card eats the height of the very
   * control the step is about. Beside, it competes with nothing — the column is
   * its own — so capping it there bought nothing and cost a scrollbar inside a
   * three-sentence instruction, on a screen with room to spare. The creator's
   * words: "you have enough room, you don't need scrolling here."
   */
  beside?: boolean;
}) {
  const q = useT().quickSetup;
  // The "פרטים" disclosure, reset on every step: this component is NOT remounted between steps
  // (the flow swaps the `step` prop), so without the reset it stayed open into the next mission.
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => { setDetailsOpen(false); }, [step.id]);
  // READING ORDER (change: quick-setup-card-clarity). Ahiya, 2026-10-06: the card was "מפוזר" and
  // its side text "מתיש". It glued four pieces of prose into one paragraph with the request LAST,
  // and readers take in the first two words of a line, so the first thing read was never the thing
  // to do. Now: the action is the title (the copy line's first sentence, written verb first), ONE
  // supporting line under it, and everything else behind "פרטים".
  const ask = splitAsk(copyLine(q.copy, copyKey));
  const note = step.instructionPrompt && step.instructionPrompt.trim() !== '' && step.instructionPrompt !== ask.title
    ? step.instructionPrompt.trim() : '';
  const shortNote = note !== '' && isShortNote(note) ? note : '';
  const longNote = note !== '' && shortNote === '' ? note : '';
  const support = pickSupportLine({ rest: ask.rest, shortNote });
  const isTask = scope === 'task' && typeof taskTitle === 'string';
  // The mission's own words, only behind the disclosure: it names WHAT the mission is, which the
  // creator needs on demand, not before every request.
  const description = isTask && summary && summary.trim() !== '' ? summary.trim() : '';
  const hasDetails = description !== '' || longNote !== '';
  return (
    <div
      role="region"
      aria-label={q.title}
      // INLINE: in flow at the top of (or beside) the mission editor. The height cap matters only
      // where the card is stacked ABOVE the mission it instructs about (below `lg`, and always when
      // not `beside`): it must never eat that column. Beside, it has its own column and never
      // scrolls. FLOATING: one column always (the old `sm:flex-row` squeezed the text into a ribbon
      // beside a sentence-long action cluster), narrow enough that a line stays readable.
      className={inline
        ? `shrink-0 m-2 mb-0 px-4 py-3 flex flex-col gap-2.5 ${GLASS_CARD} ${
            beside
              ? 'max-h-[45dvh] overflow-y-auto lg:max-h-none lg:overflow-visible'
              : 'max-h-[45%] overflow-y-auto'}`
        : `fixed z-50 top-2 mx-auto w-[min(30rem,calc(100%-1rem))] max-h-[60vh] overflow-y-auto px-4 py-3 flex flex-col gap-2.5 ${GLASS_CARD}`}
      style={inline ? undefined : { insetInlineStart: 0, insetInlineEnd: 0 }}
    >
      {/* HEADER: where you are, and the way out. One indicator, one counter, one badge, ✕. */}
      <div className="flex items-center gap-2" data-testid="qs-header">
        <QuickSetupProgress index={index} total={total} />
        <span className="text-[13px] font-semibold text-ink-fire">{q.introEyebrow(index + 1, total)}</span>
        <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${step.isRequired ? 'bg-rp-fire/10 text-ink-fire' : 'bg-[--surface-2] text-[--ink-1]'}`}>
          {step.isRequired ? q.requiredBadge : q.optionalBadge}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={q.close}
          title={q.close}
          className={`${TAP_TARGET} -my-2 -me-2 ms-auto shrink-0 rounded-lg text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none`}
        >
          ✕
        </button>
      </div>
      {/* TITLE: the action itself, first, large. */}
      <p className="text-base font-bold leading-snug text-[--ink-1]" data-testid="qs-title">{ask.title}</p>
      {/* ONE supporting line: the template's short note (specific to this game) or the rest of the
          copy line. Never both, never a side-ruled quote. */}
      {support !== '' && (
        <p className="-mt-1.5 text-sm leading-snug text-[--ink-2]" dir="auto" data-testid="qs-support">{support}</p>
      )}
      {/* CONTEXT: which mission, and its details on demand. */}
      {(isTask || hasDetails) && (
        <div className="text-xs text-[--ink-3]">
          <div className="flex items-center gap-2 flex-wrap">
            {isTask && <span dir="auto">{q.introTaskLabel(taskTitle as string)}</span>}
            {hasDetails && (
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                aria-expanded={detailsOpen}
                className={`${TAP_TEXT} -my-2 underline underline-offset-2 hover:text-[--ink-1]`}
              >
                {detailsOpen ? q.detailsHide : q.detailsShow}
              </button>
            )}
          </div>
          {detailsOpen && (
            <div className="mt-1 space-y-1 text-sm leading-snug text-[--ink-2]">
              {description !== '' && <p dir="auto">{description}</p>}
              {longNote !== '' && (
                <p dir="auto"><span className="text-[--ink-3]">{q.templateNote} </span>{longNote}</p>
              )}
            </div>
          )}
        </div>
      )}
      {/* ACTIONS: the primary first in reading order, then back, then a short "later". */}
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        <Button onClick={onNext}>{q.next} →</Button>
        {onBack && (
          <Button variant="ghost" onClick={onBack}>← {q.back}</Button>
        )}
        <button
          type="button"
          onClick={onDefer}
          className={`${TAP_TEXT} ms-auto text-sm text-[--ink-2] underline underline-offset-2 hover:text-[--ink-1]`}
        >
          {q.defer}
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
export function QuickSetupCelebration({ onClose, remaining = 0 }: { onClose: () => void; remaining?: number }) {
  const q = useT().quickSetup;
  // Walking to the end is not the same as being ready (finishVerdict): with
  // required steps still open, no confetti and no "ready to launch".
  const verdict = finishVerdict(remaining);
  const ready = verdict.kind === 'celebrate';
  const title = ready ? q.celebrateTitle : q.finishedWithGapsTitle;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      {ready && <ConfettiBurst />}
      <div className={`relative w-full max-w-md p-6 text-center ${GLASS_CARD}`}>
        {ready && (
          <div className="mx-auto w-16 h-16 rounded-full bg-rp-go/15 border-2 border-rp-go flex items-center justify-center text-3xl rp-qs-checkmark" aria-hidden>
            ✓
          </div>
        )}
        <h2 className="text-xl font-bold text-[--ink-1] mt-4">{title}</h2>
        <p className="text-sm text-[--ink-1] leading-relaxed mt-2">
          {verdict.kind === 'celebrate' ? q.celebrateBody : q.finishedWithGapsBody(verdict.count)}
        </p>
        <Button onClick={onClose} className="w-full justify-center mt-5">{ready ? q.celebrateCta : q.finishedWithGapsCta}</Button>
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
          ? 'border-rp-go/40 text-ink-go hover:bg-rp-go/10'
          : 'border-rp-fire/40 text-ink-fire hover:bg-rp-fire/10'}`}
    >
      {done ? <span aria-hidden>✓</span> : <Icon name="bolt" className="w-4 h-4 shrink-0" />}
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
                <span className="block text-[13px] text-[--ink-1] mt-0.5" dir="auto">{labelFor(step)}</span>
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
