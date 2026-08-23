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
  const real = orderQuickSetupSteps(game, game.wizardSteps);
  if (real.length === 0) return real;
  const hasGameTitleStep = real.some((s) => s.stageId === '' && s.taskId === '' && s.targetFieldPath === 'title');
  return hasGameTitleStep ? real : [SYNTHETIC_GAME_TITLE_STEP, ...real];
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
 * The five things the flow can be doing.
 *
 *   idle     — never entered
 *   welcome  — the opening invitation, shown ONCE per creator per game
 *   intro    — a context card naming the mission we are about to work on
 *   running  — the creator is at a control, the step bar is up
 *   closed   — dismissed; the pill still tells the truth
 *   done     — nothing outstanding, celebrate
 *
 * `welcome` and `intro` are not decoration. Every jump this flow makes moves the
 * canvas, opens a drawer and puts a caret somewhere — and arriving inside an input
 * with no idea which mission it belongs to is exactly what made the first version
 * read as a machine driving the screen rather than as help.
 */
export type QuickSetupStatus = 'idle' | 'welcome' | 'intro' | 'running' | 'closed' | 'done';

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
 * Which mission does this step belong to? Two steps sharing a key are the same
 * "chapter" of the flow and need no card between them.
 *
 * Keyed on stage + mission rather than on the mission alone, so two missions that
 * somehow share an id across stages still read as separate chapters.
 */
export function quickSetupChapterKey(step: TemplateWizardStep | null | undefined): string {
  if (!step) return '';
  const stageId = typeof step.stageId === 'string' ? step.stageId.trim() : '';
  const taskId = typeof step.taskId === 'string' ? step.taskId.trim() : '';
  return `${stageId}|${taskId}`;
}

/**
 * The status to land in when the flow moves from `fromIndex` to `toIndex`.
 *
 * A move that CHANGES chapter earns a context card; a move between two fields of
 * the SAME mission goes straight to the control, because the creator is already
 * looking at that mission and a card per field would be noise, not orientation.
 * That distinction is the whole difference between "guided" and "interrogated".
 */
function statusForMove(
  steps: readonly TemplateWizardStep[],
  fromIndex: number,
  toIndex: number,
): 'intro' | 'running' {
  const from = steps[clampIndex(fromIndex, steps)];
  const to = steps[clampIndex(toIndex, steps)];
  return quickSetupChapterKey(from) === quickSetupChapterKey(to) ? 'running' : 'intro';
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
 *   • Every ENTRY into the flow (`open`, `resume`, `jump`) lands on `intro`, never
 *     on `running`. Entering means the creator's screen is about to move somewhere
 *     they did not choose, which is precisely when they need to be told where.
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
      return { ...state, status: 'intro', index: entryIndex(state, ctx) };

    // "Yes, take me there." Two different sources, two different destinations:
    // the WELCOME card has not shown a single mission yet, so it steps down to
    // that mission's INTRO first — skipping straight to `running` would mean the
    // very first mission of the whole flow never gets its context card, which is
    // exactly the "landed inside a field with no idea why" failure this flow
    // exists to fix. An INTRO card, by contrast, has already oriented the
    // creator, so its own `begin` goes the rest of the way, into `running`.
    case 'begin':
      if (empty) return { ...state, status: 'done', index: 0 };
      if (state.status === 'welcome') return { ...state, status: 'intro', index: clampIndex(state.index, steps) };
      if (state.status !== 'intro') return state;
      return { ...state, status: 'running', index: clampIndex(state.index, steps) };

    // `next` fires only from the RUNNING bar — the intro card's forward button is
    // `begin`, not `next`, so a chapter's introduction can never be stepped past
    // without being seen. `defer` is different: it is offered on BOTH surfaces,
    // because "not this mission, not now" is a decision a creator can reasonably
    // make from the context card, before touching anything.
    case 'next': {
      if (state.status !== 'running') return state;
      if (empty) return { ...state, status: 'done', index: 0 };
      if (state.index < last) {
        const index = clampIndex(state.index + 1, steps);
        return { ...state, status: statusForMove(steps, state.index, index), index };
      }
      // Off the end: go back for anything postponed and still unconfigured.
      const outstanding = new Set(ctx.outstanding);
      const pending = steps.findIndex((s) => state.deferred.includes(s.id) && outstanding.has(s.id));
      if (pending >= 0) return { ...state, status: statusForMove(steps, state.index, pending), index: pending };
      return { ...state, status: 'done', index: last };
    }

    case 'defer': {
      if (state.status !== 'running' && state.status !== 'intro') return state;
      if (empty) return { ...state, status: 'done', index: 0 };
      const current = steps[clampIndex(state.index, steps)];
      const deferred = current && !state.deferred.includes(current.id)
        ? [...state.deferred, current.id]
        : state.deferred;
      if (state.index < last) {
        const index = clampIndex(state.index + 1, steps);
        return { ...state, deferred, status: statusForMove(steps, state.index, index), index };
      }
      return { ...state, deferred, status: 'done', index: last };
    }

    case 'jump':
      if (empty) return { ...state, status: 'done', index: 0 };
      return { ...state, status: 'intro', index: clampIndex(action.index, steps) };

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

/**
 * The step the CONTEXT CARD is about, or null.
 *
 * Separate from `currentQuickSetupStep` on purpose: the two are mutually exclusive
 * by status, so the bar and the card can never be on screen together and neither
 * has to know the other exists.
 */
export function quickSetupIntroStep(
  state: QuickSetupState,
  steps: readonly TemplateWizardStep[],
): TemplateWizardStep | null {
  if (!state || state.status !== 'intro') return null;
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
 *
 * The invitation is an OVERLAY, never a jump: nothing on the canvas moves until the
 * creator says yes, so declining costs one click and changes nothing.
 */
export function shouldAutoOpenQuickSetup(input: {
  hasRecord: boolean;
  outstanding: number;
  total: number;
}): boolean {
  if (!input) return false;
  if (input.hasRecord) return false;
  if (!Number.isFinite(input.total) || input.total <= 0) return false;
  return Number.isFinite(input.outstanding) && input.outstanding > 0;
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
