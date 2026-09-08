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
import type { QuickSetupCopyKey } from '../lib/quickSetup';
import { TAP_TARGET, TAP_TEXT } from '../lib/interaction';

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
  onNext, onBack, onDefer, onClose, inline = false,
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
}) {
  const q = useT().quickSetup;
  /**
   * Is the template author's note expanded? (change: quick-setup-card-height)
   *
   * Collapsed by default, and reset HERE on every step rather than by a `key` at
   * the call site. This component is NOT remounted between steps — neither call
   * site keys it, and the flow advances by swapping the `step` prop — so without
   * this the note stayed open from one mission into the next and the card arrived
   * at its tallest on a mission the creator had not asked to see a note about.
   * That is the failure CLAUDE.md already records for TaskRunner's entry
   * components; the reset lives inside the component because a third call site
   * cannot forget it.
   */
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => { setNoteOpen(false); }, [step.id]);
  const headline = copyLine(q.copy, copyKey);
  const isTask = scope === 'task' && typeof taskTitle === 'string';
  const where = isTask ? q.introTaskLabel(taskTitle as string) : scope ? q.introGameLabel : '';
  // The mission's own words, when it has any. NO generic fallback here: the
  // sentence this joins already names the mission and already asks for something,
  // so "בואו נשלים פרט קטן במשימה X" would only repeat the title back and push the
  // ask further down the line.
  const context = isTask && summary && summary.trim() !== '' ? summary : '';
  return (
    <div
      role="region"
      aria-label={q.title}
      // Logical inset (not left/right) so the card centres identically in RTL and
      // LTR; the inline style carries it because Tailwind has no logical-inset
      // utility and a template-string class would not exist at build time.
      // FLOATING: stacked on a phone, side-by-side from `sm` up. As one row it was
      // unreadable on a narrow screen: the action cluster below is `shrink-0` and
      // holds a full Hebrew sentence ("חזור לזה מאוחר יותר") plus a button and a
      // close box, so on a ~390px viewport it claimed almost the whole width and
      // left the text column — `flex-1 min-w-0`, which is allowed to shrink to
      // nothing — about two words per line, turning three sentences into a tall
      // ribbon down one edge. The viewport breakpoint is right HERE, where the
      // card really does span the viewport, and wrong inline (see below).
      // THE CARD MAY NOT EAT THE COLUMN IT INSTRUCTS ABOUT
      // (change: quick-setup-card-height). Inline, this sits at the top of the
      // mission editor's own column, `shrink-0`, above the mission it is talking
      // about — and it carries two pieces of prose nobody here wrote: the
      // mission's description and the template author's note. Measured in the
      // editor's 500px column at a 620px viewport: the card was 387px of the
      // column's 510px, 76%, leaving 113px for the mission itself. The creator's
      // words for it were "it completely hides the whole mission", and they were
      // describing the arithmetic exactly.
      //
      // Collapsing the template note (below) and stacking (next paragraph) are
      // what make the card short in practice — measured on the same step, same
      // window: 387px down to 201px, 76% of the column down to 39%. This cap is
      // what makes "it can never take the column" TRUE for content nobody has
      // written yet, in a language whose lines are longer, on a shorter window.
      // 45% leaves the mission the majority of its own column by construction,
      // and `overflow-y-auto` is the honest way to hold a note that still will
      // not fit, because the alternative is pushing the ask off the card.
      // INLINE ALWAYS STACKS. `sm:flex-row` is a VIEWPORT query, and inline this
      // card's width is its COLUMN's — the mission editor pane, `min(500px, …)`.
      // On a 1400px viewport the row applied to a 482px card: the action cluster
      // is `shrink-0` and holds a full Hebrew sentence plus two buttons and a
      // close box, so it took ~250px and left the text column ~230px, wrapping
      // three short sentences into six lines. The breakpoint was answering a
      // question about the window when the constraint was the panel.
      className={inline
        ? `shrink-0 max-h-[45%] overflow-y-auto m-2 mb-0 px-4 py-3 flex flex-col gap-2 ${GLASS_CARD}`
        : `fixed z-50 top-2 mx-auto w-[min(46rem,calc(100%-1rem))] max-h-[60vh] overflow-y-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3 ${GLASS_CARD}`}
      // The logical insets only mean anything for the floating variant; in flow the
      // element is already laid out by its parent.
      //
      // This used to reserve the mission editor pane's width on the end side, via a
      // `besidePanel` prop. That prop was DEAD and had been since the card moved
      // inline: the floating variant renders only when the editor is CLOSED
      // (`!qsCardInline`), and the prop was passed `missionEditorOpen`, so it was
      // provably always false. It is deleted rather than left as a documented
      // maybe — a prop that cannot fire is a claim about the layout that no longer
      // holds, and the next reader has to prove it dead all over again.
      style={inline ? undefined : { insetInlineStart: 0, insetInlineEnd: 0 }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-fire">
          <span>{q.introEyebrow(index + 1, total)}</span>
          <span className={`rounded px-1.5 py-0.5 ${step.isRequired ? 'bg-rp-fire/10 text-ink-fire' : 'bg-[--surface-2] text-[--ink-1]'}`}>
            {step.isRequired ? q.requiredBadge : q.optionalBadge}
          </span>
        </div>
        {/* ONE SENTENCE: which mission, what it is, and what to do — in that order,
            in a single paragraph (change: quick-setup-one-card).
 
            Merging the two CARDS was not enough. The card still opened with the
            mission's name on its own line, the mission's description on a second,
            and only then the ask — which reads as an explanation followed by an
            instruction, and the creator's verdict is the one every product person
            eventually learns: *"people skip explanations when you are not asking
            them to do anything."* An explanation nobody reads is worse than none,
            because it pushes the ask below the fold of attention.
 
            So the explanation stops being a preamble and becomes the opening of
            the instruction itself. The mission is named in bold INSIDE the
            sentence, its own description follows in the same flow, and the ask
            closes it. Every step therefore explains its mission — which is the
            other half of what was asked — without ever being a block that can be
            skipped separately from the request. */}
        <p className="text-sm text-[--ink-1] leading-snug mt-1.5">
          {where !== '' && (
            <span className="font-semibold" dir="auto">{where} </span>
          )}
          {/* The creator's own words about the mission: CONTENT, hence dir="auto"
              even mid-sentence, so a Hebrew description inside an English UI (and
              the reverse) still reads in its own direction. */}
          {context !== '' && <span className="text-[--ink-2]" dir="auto">{context} </span>}
          <span className="font-medium">{headline}</span>
        </p>
        {/* The template author's own note — a QUOTATION, marked as one, and
            COLLAPSED (change: quick-setup-card-height).
 
            It is the single longest thing on this card and the least urgent: prose
            somebody else wrote, about a mission the sentence above already names,
            frequently in the other language. Open by default it was most of the
            card's height — a paragraph of English under a Hebrew instruction, sat
            between the ask and the mission the creator came here to edit.
 
            A disclosure, not a deletion: the note is often the only place a
            template says WHY a stop matters, and a creator who wants it must be
            able to have it without leaving the flow. The toggle names what is
            behind it rather than saying "more", so the choice can be made without
            opening it. */}
        {step.instructionPrompt && step.instructionPrompt !== headline && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              aria-expanded={noteOpen}
              /* A text-styled button's width comes from its copy, so only the
                 height needs declaring; `-my-2` keeps a 44px target from shoving
                 the card's own rows apart. Same shape as the front door's links
                 (commit b69e20f) — the rule travels or it is not a rule. */
              className={`${TAP_TEXT} -my-2 text-xs text-[--ink-3] underline underline-offset-2 hover:text-[--ink-1]`}
            >
              {noteOpen ? q.templateNoteHide : q.templateNoteShow}
            </button>
            {noteOpen && (
              <p className="text-xs text-[--ink-2] leading-snug mt-1 ps-2 border-s-2 border-[--rp-border]" dir="auto">
                <span className="text-[--ink-3]">{q.templateNote} </span>
                {step.instructionPrompt}
              </p>
            )}
          </div>
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
        {/* BACK. Arrowed like the mission editor's own footer so the pair reads as
            navigation rather than as two unrelated buttons, and rendered only when
            there IS a previous step — see the reducer's `back` case. The arrow is
            a logical direction: `←` points backwards in RTL, which is the language
            this console is used in, and the editor beside it has spelled it that
            way since it was written. */}
        {onBack && (
          <Button variant="ghost" onClick={onBack}>← {q.back}</Button>
        )}
        <Button onClick={onNext}>{q.next} →</Button>
        <button
          type="button"
          onClick={onClose}
          aria-label={q.close}
          title={q.close}
          className={`${TAP_TARGET} -me-2 shrink-0 rounded-lg text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none`}
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
          ? 'border-rp-go/40 text-ink-go hover:bg-rp-go/10'
          : 'border-rp-fire/40 text-ink-fire hover:bg-rp-fire/10'}`}
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
