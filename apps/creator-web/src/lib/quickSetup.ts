// הקמה מהירה / Quick Setup — the creator-side flow (change: quick-setup-wizard).
//
// `@rushpoint/shared/templateWizard` answers "what does this step point at, and is
// that field filled in?". This module answers the three questions the Builder has:
//
//   • Which step are we on, and where does "next" / "חזור לזה מאוחר יותר" go?
//   • How many fields does this creator still owe? (the pill)
//   • Given a resolved target, WHICH tab, WHICH collapsed group and WHICH control
//     do we have to open, scroll to and focus?
//
// Two decisions are load-bearing:
//
//   1. "REMAINING" IS DERIVED, ALWAYS. Nothing here stores "this step is done". The
//      pill and the launch guard recompute from the live game, so a creator who
//      fills a deferred field by hand sees the count drop, and an emptied field
//      comes back. Only the DEFERRAL LIST is stored, because "I chose to postpone
//      this" is a preference and cannot be derived from anything.
//   2. THE FOCUS PLAN IS A TABLE. Deep navigation reads `QUICK_SETUP_FIELDS`
//      instead of branching per field in JSX, so an unknown field degrades to
//      "open the mission editor and focus nothing" rather than throwing inside a
//      render.
//
// Dependency-free (no React, no Firebase, no `window`) so the whole flow is
// assertable without a DOM — scripts/test-quick-setup-flow.ts.
import type { Game } from '@rushpoint/shared';
import {
  type TemplateWizardStep,
  type WizardTarget,
  orderQuickSetupSteps,
  isWizardStepConfigured,
} from '@rushpoint/shared';

/** Just enough of a game to drive the flow, so tests and callers stay light. */
type QuickSetupGame = Pick<Game, 'stages'> & Partial<Pick<Game, 'title' | 'description' | 'instructions' | 'wizardSteps'>>;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Derived work
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The one step every Quick Setup flow gets for free: the game's own name.
 *
 * Not something a template author writes a note about — a game genuinely has no
 * OTHER way to end up with a "set the game name" instruction, because a template
 * always ships WITH a title (even a placeholder one), so extraction never
 * produces this step on its own. But the game's name is the first thing a
 * template cannot know for the creator, and it is, structurally, always the
 * first thing a creator should decide — so it is synthesized rather than left to
 * chance, with no `instructionPrompt` of its own (there is no authored note to
 * show; the flow's own `gameTitle` copy line carries the whole thing).
 */
const SYNTHETIC_GAME_TITLE_STEP: TemplateWizardStep = {
  id: 'qs-synthetic-game-title',
  stageId: '', taskId: '', targetFieldPath: 'title',
  instructionPrompt: '', isRequired: true,
};

/**
 * This game's steps, in the recommended order, unresolvable ones already
 * dropped, with the synthetic game-name step prepended.
 *
 * Prepended rather than merely sorted-first: game scope already sorts ahead of
 * every stage (`stageIndex: -1`), so a real title step written by extraction
 * would already land here — this only fills the gap when NO step targets the
 * game's title yet, so "the name is step one" holds for every game that has
 * Quick Setup at all, not only the ones whose template happened to leave a note
 * on it.
 *
 * A game with NO real steps gets none synthesized either: an empty flow means
 * this game does not participate in Quick Setup, and inventing one step for it
 * would turn every ordinary, template-free game into a Quick Setup candidate.
 */
export function quickSetupSteps(game: QuickSetupGame | null | undefined): TemplateWizardStep[] {
  if (!game) return [];
  const authored = Array.isArray(game.wizardSteps) ? game.wizardSteps : [];
  // DOES THIS GAME PARTICIPATE AT ALL? Asked of the AUTHORED steps alone, and
  // before anything is synthesized: a game with no template notes has no Quick
  // Setup, and it must not acquire one just because it has missions without pins
  // — that is the readiness surface's job. Ordering twice is the price of asking
  // that question first, and it is worth paying explicitly; the alternative
  // (checking the merged list) turns every ordinary hand-built game into a Quick
  // Setup candidate, which is exactly what the test below caught.
  if (orderQuickSetupSteps(game, authored).length === 0) return [];
  // A template that mentions a mission's location produced a step for it; nothing
  // produced one for the missions its author never wrote a note about. See
  // `syntheticLocationSteps` — the gap that left is a game launched with missions
  // that have no pin, never mentioned once.
  const real = orderQuickSetupSteps(game, [...authored, ...syntheticLocationSteps(game, authored)]);
  if (real.length === 0) return real;
  const hasGameTitleStep = real.some((s) => s.stageId === '' && s.taskId === '' && s.targetFieldPath === 'title');
  return hasGameTitleStep ? real : [SYNTHETIC_GAME_TITLE_STEP, ...real];
}

/** The id a synthesized location step gets, so a caller can recognise one. */
export function syntheticLocationStepId(stageId: string, taskId: string): string {
  return `qs-synthetic-coordinates:${stageId}:${taskId}`;
}

/**
 * A "put this mission on the map" step for every LOCATED mission the template's
 * own notes never mentioned.
 *
 * The gap this closes, in the creator's words: *"I don't see missions asking for a
 * location, which is strange — the first thing the user should do is give the
 * missions a location."* Quick Setup's steps came ENTIRELY from extraction, which
 * reads the operator notes a template author happened to leave behind. A mission
 * with no note produced no step — and a mission's pin is exactly the thing a
 * template cannot know and the creator must supply, so the flow walked past
 * unplaced mission after unplaced mission and then the launch was refused for
 * `taskNotPlaced` with no explanation of when it could have been avoided.
 *
 * Three rules hold it together:
 *
 * 1. SYNTHESIZED FROM A STABLE PROPERTY, NOT FROM "IS IT DONE YET". The set keys
 *    off `locationless`, which the creator changes deliberately — never off
 *    whether the pin is filled in. A list that shrank as fields were filled would
 *    renumber itself under a creator standing on step 7, because the reducer's
 *    index points INTO this list. "Filled in or not" is `isWizardStepConfigured`'s
 *    job, exactly as it is for every authored step.
 * 2. NEVER A DUPLICATE. A mission whose template already carries a `coordinates`
 *    step keeps the authored one, with its author's own wording.
 * 3. NEVER TURNS A NON-TEMPLATE GAME INTO A TEMPLATE ONE. `quickSetupSteps` still
 *    returns `[]` when ordering yields nothing, so a game that does not
 *    participate in Quick Setup does not start participating because it has
 *    missions with no pins — that is the readiness surface's job, not a flow's.
 *
 * `isRequired: true` matches what already happens: `computeGameReadiness` raises
 * `taskNotPlaced` for exactly these missions and the launch is refused, so this
 * changes what the creator is ASKED, never what the game is allowed to do.
 */
function syntheticLocationSteps(
  game: QuickSetupGame,
  authored: readonly TemplateWizardStep[],
): TemplateWizardStep[] {
  const already = new Set(
    authored
      .filter((s) => s?.targetFieldPath === 'coordinates')
      .map((s) => `${s.stageId ?? ''}|${s.taskId ?? ''}`),
  );
  const out: TemplateWizardStep[] = [];
  for (const stage of game.stages ?? []) {
    for (const task of stage?.tasks ?? []) {
      if (!stage?.id || !task?.id) continue;
      // A mission played from anywhere has no pin to place, and asking for one
      // would be asking the creator to undo the template's decision.
      if (task.locationless === true || task.triggerMode === 'locationless') continue;
      if (already.has(`${stage.id}|${task.id}`)) continue;
      out.push({
        id: syntheticLocationStepId(stage.id, task.id),
        stageId: stage.id,
        taskId: task.id,
        targetFieldPath: 'coordinates',
        // No authored note to quote — the flow's own `coordinates` copy line is
        // the whole instruction, same as the synthetic game-title step.
        instructionPrompt: '',
        isRequired: true,
      });
    }
  }
  return out;
}

/** The ids of the steps whose target field is still unconfigured. */
export function outstandingQuickSetupIds(game: QuickSetupGame | null | undefined): string[] {
  if (!game) return [];
  return quickSetupSteps(game).filter((s) => !isWizardStepConfigured(game, s)).map((s) => s.id);
}

/** What the pill shows: "נותרו N שדות בהקמה מהירה". */
export function quickSetupRemainingCount(game: QuickSetupGame | null | undefined): number {
  return outstandingQuickSetupIds(game).length;
}

/**
 * The required steps that are still unconfigured — the launch refusal, in
 * recommended order.
 *
 * Consulted AFTER `canLaunchGame`, so an existing readiness blocker still reports
 * first and the two lists never interleave.
 */
export function quickSetupLaunchBlockers(game: QuickSetupGame | null | undefined): TemplateWizardStep[] {
  if (!game) return [];
  return quickSetupSteps(game).filter((s) => s.isRequired && !isWizardStepConfigured(game, s));
}

/** The one blocker a caller with no modal should name. `null` ⇔ the launch may proceed. */
export function firstQuickSetupBlocker(game: QuickSetupGame | null | undefined): TemplateWizardStep | null {
  return quickSetupLaunchBlockers(game)[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. State machine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The four things the flow can be doing.
 *
 *   idle     — never entered
 *   welcome  — the opening invitation, shown ONCE per creator per game
 *   running  — the creator is at a control, the step card is up
 *   closed   — dismissed; the pill still tells the truth
 *   done     — nothing outstanding, celebrate
 *
 * THERE WAS A FIFTH, `intro`: a context card naming the mission, shown BEFORE the
 * step card whenever the flow crossed into a new mission. It was added for a real
 * reason — arriving inside an input with no idea which mission it belongs to reads
 * as a machine driving the screen — and it solved that by making the creator read
 * TWO cards, in sequence, to learn one thing. The creator's verdict: *"I want all
 * the information about one change to be in a single message, not in two like it
 * was — an explanation about the mission and then the change."* So the mission
 * context moved INTO the step card (`QuickSetupBar` now names the mission it is
 * about), and the orientation is delivered without a second screen to dismiss.
 *
 * Keeping the status but never producing it would leave a state machine with an
 * unreachable node, so it is gone from the union. Nothing has to migrate:
 * `readQuickSetupRecord` only ever accepted `idle`/`running`/`closed`/`done`, so
 * no stored record can name it.
 */
export type QuickSetupStatus = 'idle' | 'welcome' | 'running' | 'closed' | 'done';

export interface QuickSetupState {
  status: QuickSetupStatus;
  index: number;
  /** Step ids the creator pressed "חזור לזה מאוחר יותר" on. A preference, not truth. */
  deferred: string[];
}

export type QuickSetupAction =
  | { type: 'invite' }
  | { type: 'open' }
  | { type: 'begin' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'defer' }
  | { type: 'jump'; index: number }
  | { type: 'close' }
  | { type: 'resume' }
  | { type: 'reset' };

/** What the reducer needs to know about the world, passed in rather than derived. */
export interface QuickSetupContext {
  steps: readonly TemplateWizardStep[];
  /** Ids of steps whose field is still unconfigured, from the LIVE game. */
  outstanding: readonly string[];
}

export const INITIAL_QUICK_SETUP_STATE: QuickSetupState = { status: 'idle', index: 0, deferred: [] };

function clampIndex(index: number, steps: readonly TemplateWizardStep[]): number {
  const last = Math.max(0, steps.length - 1);
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(last, Math.floor(index)));
}

/** Where should the flow land when it is (re)entered? First deferred, else first outstanding. */
function entryIndex(state: QuickSetupState, ctx: QuickSetupContext): number {
  const outstanding = new Set(ctx.outstanding);
  const deferredIdx = ctx.steps.findIndex((s) => state.deferred.includes(s.id) && outstanding.has(s.id));
  if (deferredIdx >= 0) return deferredIdx;
  const firstOutstanding = ctx.steps.findIndex((s) => outstanding.has(s.id));
  return firstOutstanding >= 0 ? firstOutstanding : 0;
}

/**
 * Pure transition table. Never mutates its input, never produces an out-of-range
 * index, and tolerates an EMPTY step list (a game with no quick setup at all).
 *
 * Two rules worth naming:
 *
 *   • `next` off the end does NOT finish while a deferred step is still
 *     unconfigured — it re-enters that step. "Come back to this later" that never
 *     comes back is just a slower way of losing the instruction.
 *   • Every ENTRY into the flow (`open`, `resume`, `jump`) lands on `running` —
 *     which is now also where the creator is told WHERE they have been taken,
 *     because the step card names its own mission. That naming is not optional:
 *     entering means the screen moves somewhere the creator did not choose.
 */
export function quickSetupReducer(
  state: QuickSetupState,
  action: QuickSetupAction,
  ctx: QuickSetupContext,
): QuickSetupState {
  const steps = ctx?.steps ?? [];
  const empty = steps.length === 0;
  const last = Math.max(0, steps.length - 1);

  switch (action?.type) {
    // The opening invitation. Distinct from `open` because it is offered rather
    // than asked for: nothing has moved on the creator's screen yet.
    case 'invite':
      if (empty) return { ...state, status: 'done', index: 0 };
      return { ...state, status: 'welcome', index: entryIndex(state, ctx) };

    case 'open':
    case 'resume':
      if (empty) return { ...state, status: 'done', index: 0 };
      return { ...state, status: 'running', index: entryIndex(state, ctx) };

    // "Yes, take me there." One destination now: the step card itself, which names
    // the mission it is about, so the orientation the old two-card sequence
    // delivered arrives in the same message as the request.
    case 'begin':
      if (empty) return { ...state, status: 'done', index: 0 };
      if (state.status !== 'welcome') return state;
      return { ...state, status: 'running', index: clampIndex(state.index, steps) };

    case 'next': {
      if (state.status !== 'running') return state;
      if (empty) return { ...state, status: 'done', index: 0 };
      if (state.index < last) return { ...state, index: clampIndex(state.index + 1, steps) };
      // Off the end: go back for anything postponed and still unconfigured.
      const outstanding = new Set(ctx.outstanding);
      const pending = steps.findIndex((s) => state.deferred.includes(s.id) && outstanding.has(s.id));
      if (pending >= 0) return { ...state, index: pending };
      return { ...state, status: 'done', index: last };
    }

    // One step BACK, and nothing else (change: quick-setup-one-card).
    //
    // The flow had no way back at all: next, defer and close each moved forward or
    // left, so a creator who realised the previous answer was wrong could only
    // close the flow and hunt for that field by hand. Their words: "it is a
    // problem that you cannot go back".
    //
    // Deliberately NOT undo. It re-enters the previous step and touches nothing
    // else, not the game and not the deferral list, so a creator who walks back
    // into a step they postponed finds it exactly as they left it and postponing
    // it again is a no-op rather than a second entry.
    //
    // At the first step there is no previous one, so this is a no-op and the
    // control is not rendered at all. That is the one case where saying nothing is
    // honest: a back button whose only job is to explain that it cannot go back
    // should not be on screen.
    case 'back':
      if (state.status !== 'running') return state;
      if (empty) return { ...state, status: 'done', index: 0 };
      if (state.index <= 0) return state;
      return { ...state, index: clampIndex(state.index - 1, steps) };

    case 'defer': {
      if (state.status !== 'running') return state;
      if (empty) return { ...state, status: 'done', index: 0 };
      const current = steps[clampIndex(state.index, steps)];
      const deferred = current && !state.deferred.includes(current.id)
        ? [...state.deferred, current.id]
        : state.deferred;
      if (state.index < last) return { ...state, deferred, index: clampIndex(state.index + 1, steps) };
      return { ...state, deferred, status: 'done', index: last };
    }

    case 'jump':
      if (empty) return { ...state, status: 'done', index: 0 };
      return { ...state, status: 'running', index: clampIndex(action.index, steps) };

    // Closing is a decision about the OVERLAY only: it changes nothing in the game
    // and keeps every deferral, so the pill still tells the truth afterwards.
    case 'close':
      return { ...state, status: 'closed', index: clampIndex(state.index, steps) };

    case 'reset':
      return { ...INITIAL_QUICK_SETUP_STATE };

    default:
      return state;
  }
}

/** The step to render, or null — the ONE source of truth for "is the bar showing?". */
export function currentQuickSetupStep(
  state: QuickSetupState,
  steps: readonly TemplateWizardStep[],
): TemplateWizardStep | null {
  if (!state || state.status !== 'running') return null;
  if (!steps || steps.length === 0) return null;
  return steps[clampIndex(state.index, steps)] ?? null;
}

/** How much of a mission's description the context card is willing to quote. */
const SUMMARY_MAX_CHARS = 140;

/**
 * One line saying what players actually do in this mission, in the creator's own
 * words — the first sentence of its description.
 *
 * Quoting the creator beats any generic line we could write, but only up to a
 * point: a description can be three paragraphs, and a context card is not the
 * place to read them. Falls back to `''` (the caller then shows its own generic
 * line) when there is nothing usable, which includes the case that matters most —
 * a mission whose description the Quick Setup flow is on its way to go fill in.
 */
export function missionSummaryLine(description: string | null | undefined): string {
  if (typeof description !== 'string') return '';
  const text = description.replace(/\s+/g, ' ').trim();
  if (text === '') return '';
  // First sentence, if one ends early enough to be worth cutting at.
  const stop = text.search(/[.!?？。]\s/);
  const firstSentence = stop > 0 ? text.slice(0, stop + 1) : text;
  if (firstSentence.length <= SUMMARY_MAX_CHARS) return firstSentence;
  // Otherwise trim on a word boundary rather than mid-word.
  const clipped = firstSentence.slice(0, SUMMARY_MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * Should the Builder OFFER Quick Setup on its own, without being asked?
 *
 * A creator who has just cloned a template does not know this flow exists, and the
 * fields it is about are exactly the ones a template cannot fill for them. Waiting
 * for them to notice a pill is waiting for them to launch a half-configured game.
 *
 * Offered exactly once, and only when there is genuinely something to do:
 *
 *   • `hasRecord` — this creator has already met the flow on this game. Their
 *     stored status (closed, done, mid-flow) is a decision, and re-offering would
 *     override it every time they open the Builder.
 *   • `outstanding === 0` — nothing to guide them to. A welcome card that opens onto
 *     a finished checklist is a interruption with no payload.
 *   • `justCreated` — this mount is the landing from the new-game wizard, so the
 *     creator has just finished answering one guided flow and has not yet laid
 *     eyes on the game it built. Opening a SECOND guided flow's welcome card on
 *     top of that is what makes the setup read as chaotic rather than helpful:
 *     three screens of ceremony (questionnaire, reveal, welcome) before the
 *     product itself. Let them land and look.
 *
 *     This DEFERS the invitation, it does not cancel it — refusing here writes no
 *     record, so the very next time this creator opens the Builder the welcome
 *     card is offered exactly as before, and the pill is on screen meanwhile. The
 *     rationale for auto-offering at all (a creator who cloned a template does not
 *     know the flow exists) is about discovery over a session, not about this
 *     particular second.
 *
 * The invitation is an OVERLAY, never a jump: nothing on the canvas moves until the
 * creator says yes, so declining costs one click and changes nothing.
 */
export function shouldAutoOpenQuickSetup(input: {
  hasRecord: boolean;
  outstanding: number;
  total: number;
  /** Did this Builder mount come straight from the new-game wizard? */
  justCreated?: boolean;
}): boolean {
  if (!input) return false;
  if (input.hasRecord) return false;
  if (input.justCreated === true) return false;
  if (!Number.isFinite(input.total) || input.total <= 0) return false;
  return Number.isFinite(input.outstanding) && input.outstanding > 0;
}

/**
 * Router state stamped on the hop from the new-game wizard into the Builder, so
 * that mount can tell "the creator just answered a questionnaire" from "the
 * creator opened this game".
 *
 * It is deliberately router state and not a query param or a stored flag: it
 * describes ONE navigation, it must not survive a reload (a reload is the
 * creator arriving fresh, which is exactly when the invitation is welcome), and
 * it must leave no trace to clean up.
 */
export const JUST_CREATED_NAV_STATE = { rpJustCreated: true } as const;

/**
 * Read that stamp back. Total and defensive: router state is `unknown` by type
 * and genuinely arbitrary at runtime (a deep link, a restored session, another
 * page's state shape), and every unreadable value must mean "an ordinary open"
 * — the behaviour this app had before the stamp existed.
 */
export function isJustCreatedNavState(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  return (state as { rpJustCreated?: unknown }).rpJustCreated === true;
}

/** One-based "שלב 2 מתוך 7". */
export function quickSetupProgress(
  state: QuickSetupState,
  steps: readonly TemplateWizardStep[],
): { step: number; total: number } {
  const total = steps?.length ?? 0;
  if (total === 0) return { step: 0, total: 0 };
  return { step: clampIndex(state?.index ?? 0, steps) + 1, total };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Persistence (client-side, no callable)
// ═══════════════════════════════════════════════════════════════════════════

export const QUICK_SETUP_VERSION = 1;
export const QUICK_SETUP_KEY_PREFIX = 'rp-quick-setup';

/**
 * Scoped by uid AND by game id.
 *
 * Two accounts on one browser must not share deferrals (the lesson `firstGameIdKey`
 * learned the hard way, when a stale global key drove a brand-new creator into
 * another account's game), and neither must two games of one account: the steps
 * belong to a specific game's missions.
 */
export function quickSetupStorageKey(uid: string | null | undefined, gameId: string | null | undefined): string {
  const u = typeof uid === 'string' ? uid.trim() : '';
  const g = typeof gameId === 'string' ? gameId.trim() : '';
  return `${QUICK_SETUP_KEY_PREFIX}:${u || 'anon'}:${g || 'unknown'}`;
}

export interface QuickSetupRecord {
  version: number;
  status: QuickSetupStatus;
  index: number;
  deferred: string[];
}

/**
 * Parse a stored record. Missing, malformed or unrecognised data yields `null`
 * ("never started"), which is the friendlier failure: a blocked or corrupted
 * storage shows the flow rather than silently swallowing it.
 */
export function readQuickSetupRecord(raw: string | null | undefined): QuickSetupRecord | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const status = obj.status;
    if (status !== 'idle' && status !== 'running' && status !== 'closed' && status !== 'done') return null;
    const index = typeof obj.index === 'number' && Number.isFinite(obj.index) ? Math.max(0, Math.floor(obj.index)) : 0;
    const deferred = Array.isArray(obj.deferred)
      ? obj.deferred.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [];
    const version = typeof obj.version === 'number' && Number.isFinite(obj.version) ? obj.version : QUICK_SETUP_VERSION;
    return { version, status, index, deferred };
  } catch {
    return null;
  }
}

export function writeQuickSetupRecord(state: QuickSetupState): string {
  return JSON.stringify({
    version: QUICK_SETUP_VERSION,
    status: state?.status ?? 'idle',
    index: Math.max(0, Math.floor(state?.index ?? 0)),
    deferred: (state?.deferred ?? []).filter((v) => typeof v === 'string' && v.trim() !== ''),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. The focus plan — which tab, which group, which control
// ═══════════════════════════════════════════════════════════════════════════

/** The three tabs of the mission editor (TaskWizard's WIZARD_STEP_ORDER). */
export type TaskEditorTab = 'location' | 'details' | 'execution';
/**
 * A collapsed panel a step's target field may hide inside. `hint`/`timerPoints`/
 * `rules` are the execution tab's opt-in chips (lib/taskOptInGroups);
 * `locationAdvanced` is the Location step's own "⚙ advanced" panel (radius /
 * skip-GPS / hide-location + its clue) — it has no chip, so it is not one of
 * `OptInGroupKey`, but it is exactly as collapsed-by-default and exactly as
 * unreachable-without-opening-it, and a step that targets `locationClue` or
 * `geofenceRadiusMeters` or `locationHidden` is otherwise navigated to a tab with
 * nothing visibly there to focus (change: quick-setup-mobile-visibility).
 */
export type TaskOptInGroup = 'hint' | 'timerPoints' | 'rules' | 'locationAdvanced';

/**
 * The copy slots the flow speaks in.
 *
 * WHY THE INSTRUCTION IS NOT THE PROMPT. A step's `instructionPrompt` is prose a
 * template author wrote for themselves — long, operational, and often a paragraph
 * about three things at once ("recommended somewhere busy; for manual approval turn
 * off auto-approve in execution; get a sheet and collect 20 signatures"). Reading it
 * back verbatim as the flow's headline is what made the bar feel like a machine
 * relaying a work order.
 *
 * So the flow LEADS with copy of its own, one short line per slot, written for the
 * creator who is about to touch that specific control. The authored note is kept and
 * shown UNDER it, quietly labelled as coming from the template — nothing an author
 * wrote is thrown away, it just stops being the voice of the product.
 *
 * One slot per CONCEPT, not per field: `hint` and `hintPenalty` are the same
 * sentence to a human, and splitting them would only produce two ways to say it that
 * can drift apart.
 */
export const QUICK_SETUP_COPY_KEYS = [
  'gameTitle', 'gameOverview', 'gamePrimer',
  'title', 'description', 'media',
  'answers', 'numericAnswer', 'surveyChoices', 'steps', 'orderItems',
  'secretCode', 'captureKind', 'longInstructions',
  'coordinates', 'geofence', 'locationClue', 'locationHidden',
  'autoApprove', 'hint', 'points', 'duration', 'difficulty', 'capacity', 'unlock', 'tags',
  'fallback',
] as const;

export type QuickSetupCopyKey = (typeof QUICK_SETUP_COPY_KEYS)[number];

export interface QuickSetupFieldEntry {
  /** The `data-qs-field` value the Builder renders on that control. */
  anchor: string;
  scope: 'game' | 'task';
  wizardStep: TaskEditorTab | null;
  optInGroup: TaskOptInGroup | null;
  /** Which line the flow says out loud when it arrives here. */
  copy: QuickSetupCopyKey;
}

export interface QuickSetupFocusPlan {
  /** `null` ⇒ open the editor but focus nothing (an unrecognised field). */
  anchor: string | null;
  wizardStep: TaskEditorTab | null;
  optInGroup: TaskOptInGroup | null;
  /** Which line the flow says out loud. `'fallback'` for anything unrecognised. */
  copy: QuickSetupCopyKey;
}

/**
 * Every field a step may target, and where it lives in the Builder.
 *
 * Declared, never inferred: a control that moves between tabs, or a new field a
 * template can point at, is a visible edit HERE rather than a step that silently
 * scrolls to nothing. The test asserts this table covers everything
 * `extractQuickSetupSteps` can produce.
 */
export const QUICK_SETUP_FIELDS: Record<string, QuickSetupFieldEntry> = {
  // `title` and `description` are registered as the MISSION's fields. At game scope
  // the same leaf names the Builder's own controls, and `quickSetupFocusPlan`
  // rewrites them to `game.*` — one entry per leaf, with the scope deciding, rather
  // than two near-identical rows that could drift apart.
  'title': { anchor: 'title', scope: 'task', wizardStep: 'details', optInGroup: null, copy: 'title' },
  'description': { anchor: 'description', scope: 'task', wizardStep: 'details', optInGroup: null, copy: 'description' },
  // ── Game level only (the Builder shell, not the mission editor) ──
  'instructions.bodyHe': { anchor: 'game.instructions', scope: 'game', wizardStep: null, optInGroup: null, copy: 'gamePrimer' },
  'instructions.body': { anchor: 'game.instructions', scope: 'game', wizardStep: null, optInGroup: null, copy: 'gamePrimer' },
  'instructions.title': { anchor: 'game.instructions', scope: 'game', wizardStep: null, optInGroup: null, copy: 'gamePrimer' },

  // ── Mission editor, tab 1: where it happens ──
  'coordinates': { anchor: 'coordinates', scope: 'task', wizardStep: 'location', optInGroup: null, copy: 'coordinates' },
  'geofenceRadiusMeters': { anchor: 'geofenceRadiusMeters', scope: 'task', wizardStep: 'location', optInGroup: 'locationAdvanced', copy: 'geofence' },
  'locationClue': { anchor: 'locationClue', scope: 'task', wizardStep: 'location', optInGroup: 'locationAdvanced', copy: 'locationClue' },
  'locationHidden': { anchor: 'locationHidden', scope: 'task', wizardStep: 'location', optInGroup: 'locationAdvanced', copy: 'locationHidden' },

  // ── tab 2: what it says ──
  // `media` is deliberately NOT behind a chip: a picture is part of describing a
  // mission, so it sits beside the description (see lib/taskOptInGroups).
  'media': { anchor: 'media', scope: 'task', wizardStep: 'details', optInGroup: null, copy: 'media' },
  'tags': { anchor: 'tags', scope: 'task', wizardStep: 'execution', optInGroup: 'rules', copy: 'tags' },

  // ── tab 3: how it is completed ──
  'answers': { anchor: 'answers', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'answers' },
  'choices': { anchor: 'answers', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'answers' },
  'numericAnswer': { anchor: 'numericAnswer', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'numericAnswer' },
  'numericTolerance': { anchor: 'numericAnswer', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'numericAnswer' },
  'surveyChoices': { anchor: 'surveyChoices', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'surveyChoices' },
  'steps': { anchor: 'steps', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'steps' },
  'orderItems': { anchor: 'orderItems', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'orderItems' },
  'smart.secretCode': { anchor: 'smart.secretCode', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'secretCode' },
  'smart.longInstructions': { anchor: 'smart.longInstructions', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'longInstructions' },
  'smart.autoApprove': { anchor: 'smart.autoApprove', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'autoApprove' },
  'smart.captureKind': { anchor: 'smart.captureKind', scope: 'task', wizardStep: 'execution', optInGroup: null, copy: 'captureKind' },

  // ── tab 3, behind a chip ──
  'hint': { anchor: 'hint', scope: 'task', wizardStep: 'execution', optInGroup: 'hint', copy: 'hint' },
  'hintPenalty': { anchor: 'hintPenalty', scope: 'task', wizardStep: 'execution', optInGroup: 'hint', copy: 'hint' },
  'pointValue': { anchor: 'pointValue', scope: 'task', wizardStep: 'execution', optInGroup: 'timerPoints', copy: 'points' },
  'expectedDurationMinutes': { anchor: 'expectedDurationMinutes', scope: 'task', wizardStep: 'execution', optInGroup: 'timerPoints', copy: 'duration' },
  'difficulty': { anchor: 'difficulty', scope: 'task', wizardStep: 'execution', optInGroup: 'timerPoints', copy: 'difficulty' },
  'maxConcurrentTeams': { anchor: 'maxConcurrentTeams', scope: 'task', wizardStep: 'execution', optInGroup: 'rules', copy: 'capacity' },
  'unlockAfterTaskIds': { anchor: 'unlockAfterTaskIds', scope: 'task', wizardStep: 'execution', optInGroup: 'rules', copy: 'unlock' },
};

/**
 * Where to navigate for this target.
 *
 * TOTAL and never throwing: it runs inside a Builder effect, where a throw would
 * replace a navigation with a crash screen. An unrecognised field degrades to
 * "the mission editor opens, nothing is focused" — the creator still lands on the
 * right mission and reads the instruction.
 */
export function quickSetupFocusPlan(target: WizardTarget | null | undefined): QuickSetupFocusPlan {
  const none: QuickSetupFocusPlan = { anchor: null, wizardStep: null, optInGroup: null, copy: 'fallback' };
  if (!target || typeof target.fieldPath !== 'string') return none;
  const entry = QUICK_SETUP_FIELDS[target.fieldPath];
  if (!entry) return none;
  // The same leaf name can mean two things: a game's `description` is the Builder's
  // own field, a mission's is the editor's. The scope decides — including WHICH
  // line the flow speaks: the game's own title/description read as
  // gameTitle/gameOverview, never as the mission copy of the same leaf name.
  if (target.scope === 'game') {
    if (entry.scope === 'game') return { anchor: entry.anchor, wizardStep: null, optInGroup: null, copy: entry.copy };
    const copy: QuickSetupCopyKey = target.fieldPath === 'title' ? 'gameTitle'
      : target.fieldPath === 'description' ? 'gameOverview'
      : entry.copy;
    return { anchor: `game.${target.fieldPath}`, wizardStep: null, optInGroup: null, copy };
  }
  if (entry.scope === 'game') return none;
  return { anchor: entry.anchor, wizardStep: entry.wizardStep, optInGroup: entry.optInGroup, copy: entry.copy };
}
