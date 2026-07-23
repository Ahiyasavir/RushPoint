// First-run checklist derivation (change: creator-onboarding-and-plain-language).
// Deliberately dependency-free (no React, no Firebase) so it runs in the node-env
// vitest lane and so the checklist can never disagree with the dashboard's data.
//
// The rule that matters: every step's done state is DERIVED from the creator's
// real games and runs. Nothing here reads a stored "progress" flag, because a
// stored flag drifts the moment a creator deletes their only game and would then
// tell them a step is behind them when it is not.

export type OnboardingStepId = 'createGame' | 'addTask' | 'preview' | 'testRun' | 'launch';

/** The five steps, in the order the creator walks them. */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStepId[] =
  ['createGame', 'addTask', 'preview', 'testRun', 'launch'] as const;

export interface OnboardingGame {
  id: string;
  stages: { tasks: unknown[] }[];
  playCount?: number;
}

export interface OnboardingRun {
  runId: string;
  testDrive?: boolean;
  status?: string;
}

export interface OnboardingInput {
  games: OnboardingGame[];
  runs: OnboardingRun[];
  /** Local-only signal: previewing is a Builder tab, not a mutation (design D2). */
  previewedGameIds: string[];
  dismissed: boolean;
}

export interface OnboardingChecklist {
  visible: boolean;
  steps: { id: OnboardingStepId; done: boolean }[];
  completedCount: number;
}

const PREVIEWED_STORAGE_KEY = 'rp-previewed-games';
export const ONBOARDING_DISMISSED_KEY = 'rp-onboarding-dismissed';
export { PREVIEWED_STORAGE_KEY };

export function buildOnboardingChecklist(input: OnboardingInput): OnboardingChecklist {
  const games = input.games ?? [];
  const runs = input.runs ?? [];
  const previewed = new Set(input.previewedGameIds ?? []);

  const createGame = games.length > 0;
  const addTask = games.some((g) => (g.stages ?? []).some((s) => (s.tasks ?? []).length > 0));
  // Only counts for a game the creator still owns, so a deleted game cannot keep
  // the step ticked forever.
  const preview = games.some((g) => previewed.has(g.id));
  // A test drive is a rehearsal and never increments playCount (launchRun), so a
  // recorded play is proof of a real launch even after that run has finished.
  const launch = games.some((g) => (g.playCount ?? 0) > 0) || runs.some((r) => r.testDrive === false);
  // A real launch means the rehearsal step is behind them either way.
  const testRun = launch || runs.length > 0;

  const doneById: Record<OnboardingStepId, boolean> = { createGame, addTask, preview, testRun, launch };
  const steps = ONBOARDING_STEP_ORDER.map((id) => ({ id, done: doneById[id] }));
  const completedCount = steps.filter((s) => s.done).length;

  return {
    steps,
    completedCount,
    visible: !input.dismissed && completedCount < steps.length && !isEstablished(input),
  };
}

/**
 * An account that already has a game and a real run was established before the
 * checklist existed; walking it back through "create a game" would be noise.
 */
function isEstablished(input: OnboardingInput): boolean {
  const games = input.games ?? [];
  const runs = input.runs ?? [];
  const hasGame = games.length > 0;
  const hasRealRun = games.some((g) => (g.playCount ?? 0) > 0) || runs.some((r) => r.testDrive === false);
  return hasGame && hasRealRun;
}

/** Parse the stored previewed-game ids. Malformed or missing data degrades to none. */
export function readPreviewedGames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

/** Serialize previewed-game ids, de-duplicated and blank-free. */
export function writePreviewedGames(ids: string[]): string {
  const clean = [...new Set((ids ?? []).filter((v) => typeof v === 'string' && v.length > 0))];
  return JSON.stringify(clean);
}

/**
 * Remembered game count, so the loading placeholder matches what they have.
 *
 * This is the KEY PREFIX, never a key: the count is a fact about ONE account, and
 * a browser can hold several (change: post-review-fixes A). It kept its name and
 * value so the legacy global entry is still identifiable and removable.
 */
export const KNOWN_GAME_COUNT_KEY = 'rp-known-game-count';

/** Per-creator key, so two accounts on one browser never share a count. */
export function knownGameCountKey(uid: string | null | undefined): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${KNOWN_GAME_COUNT_KEY}:${clean || 'anon'}`;
}

/**
 * Has THIS account been seen holding at least one game on this browser?
 *
 * The one place "established" is decided, so the tour's auto-start and anything
 * else that asks cannot disagree. Unreadable or absent data is NOT established:
 * assuming nothing shows a creator the tour, and showing it once is the friendlier
 * failure than silently withholding it forever.
 */
export function isEstablishedCreator(rawKnownGameCount: string | null | undefined): boolean {
  return (readKnownGameCount(rawKnownGameCount) ?? 0) >= 1;
}

/** `null` means "we have never seen this account load" — assume nothing. */
export function readKnownGameCount(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * How many game-card placeholders the loading state should draw. Zero for an
 * account last seen empty, so a first-time creator no longer watches six cards
 * resolve into an empty state.
 */
export function skeletonCardCount(known: number | null, fallback = 6, max = 6): number {
  if (known === null) return fallback;
  return Math.max(0, Math.min(max, known));
}

// ═══════════════════════════════════════════════════════════════════════════
// First-run GUIDED TOUR (change: creator-guided-tour)
//
// The checklist above answers "what have I done?". The tour answers "what IS
// this?" — a spotlight walkthrough of the whole console for a creator who has
// never seen it. It is deliberately DATA: an ordered table plus a reducer, so
// the sequence, the free-mode filtering and every transition are assertable
// without a DOM (scripts/test-creator-tour.ts). The overlay component only
// renders what these functions decide.
//
// Still dependency-free: no React, no Firebase, no window.
// ═══════════════════════════════════════════════════════════════════════════

export type TourStepId =
  | 'welcome'
  | 'newGame'
  | 'gameList'
  | 'builderStages'
  | 'builderTasks'
  | 'builderTaskTypes'
  | 'builderLocation'
  | 'builderScoring'
  | 'builderPreview'
  | 'builderLaunch'
  | 'runConsole'
  | 'gallery'
  | 'wallet'
  | 'settings'
  | 'finish';

/** Which console area a step is ABOUT (drives the optional "take me there"). */
export type TourSurface =
  | 'dashboard' | 'builder' | 'run' | 'gallery' | 'wallet' | 'settings' | 'anywhere';

export type TourPlacement = 'top' | 'bottom' | 'start' | 'end' | 'center';

export interface TourStep {
  id: TourStepId;
  surface: TourSurface;
  /** `data-tour` value to spotlight, or null for a deliberately centred card. */
  anchor: string | null;
  placement: TourPlacement;
  /** Free mode hides the wallet entirely, so its step must go with it. */
  requiresPayments?: boolean;
}

/**
 * The walkthrough, in the order a creator walks it. Copy lives in i18n
 * (`t.tour.steps[id]`) so the table stays language-free.
 *
 * Steps 5-7 share the canvas anchor on purpose: tasks, their types and their
 * locations are all authored in that one workspace, and pointing at three
 * different boxes for one pane would be theatre.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome',          surface: 'anywhere',  anchor: null,               placement: 'center' },
  { id: 'newGame',          surface: 'dashboard', anchor: 'new-game',         placement: 'bottom' },
  { id: 'gameList',         surface: 'dashboard', anchor: 'game-list',        placement: 'top' },
  { id: 'builderStages',    surface: 'builder',   anchor: 'builder-stages',   placement: 'end' },
  { id: 'builderTasks',     surface: 'builder',   anchor: 'builder-canvas',   placement: 'center' },
  { id: 'builderTaskTypes', surface: 'builder',   anchor: 'builder-canvas',   placement: 'center' },
  { id: 'builderLocation',  surface: 'builder',   anchor: 'builder-canvas',   placement: 'center' },
  { id: 'builderScoring',   surface: 'builder',   anchor: 'builder-tabs',     placement: 'bottom' },
  { id: 'builderPreview',   surface: 'builder',   anchor: 'builder-tabs',     placement: 'bottom' },
  { id: 'builderLaunch',    surface: 'builder',   anchor: 'builder-launch',   placement: 'bottom' },
  { id: 'runConsole',       surface: 'run',       anchor: null,               placement: 'center' },
  { id: 'gallery',          surface: 'gallery',   anchor: 'nav-gallery',      placement: 'bottom' },
  { id: 'wallet',           surface: 'wallet',    anchor: 'nav-wallet',       placement: 'bottom', requiresPayments: true },
  { id: 'settings',         surface: 'settings',  anchor: 'nav-settings',     placement: 'bottom' },
  { id: 'finish',           surface: 'anywhere',  anchor: null,               placement: 'center' },
] as const;

/** The table minus the steps this deployment has no surface for. */
export function buildTourSteps({ paymentsEnabled }: { paymentsEnabled: boolean }): TourStep[] {
  return TOUR_STEPS.filter((s) => (s.requiresPayments ? paymentsEnabled : true)).map((s) => ({ ...s }));
}

// ── State machine ──────────────────────────────────────────────────────────

export type TourStatus = 'idle' | 'running' | 'skipped' | 'completed';

export interface TourState {
  status: TourStatus;
  index: number;
}

export type TourAction =
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' }
  | { type: 'restart' }
  | { type: 'jump'; index: number };

export const INITIAL_TOUR_STATE: TourState = { status: 'idle', index: 0 };

/**
 * Pure transition table (design §4). Never mutates its input, never produces an
 * out-of-range index — including for an EMPTY step list, which a future
 * deployment-filtered table could legitimately be.
 */
export function tourReducer(state: TourState, action: TourAction, steps: readonly TourStep[]): TourState {
  const last = Math.max(0, (steps?.length ?? 0) - 1);
  const empty = !steps || steps.length === 0;
  const clamp = (i: number): number => {
    if (!Number.isFinite(i)) return state.index;
    return Math.max(0, Math.min(last, Math.floor(i)));
  };

  switch (action.type) {
    // Replaying a finished tour is `restart` and only `restart`, so an automatic
    // start can never re-nag a creator who already skipped it.
    case 'start':
      if (state.status !== 'idle') return state;
      return empty ? { status: 'completed', index: 0 } : { status: 'running', index: 0 };
    case 'restart':
      return empty ? { status: 'completed', index: 0 } : { status: 'running', index: 0 };
    case 'next':
      if (state.status !== 'running') return state;
      if (empty || state.index >= last) return { status: 'completed', index: empty ? 0 : last };
      return { status: 'running', index: state.index + 1 };
    case 'back':
      if (state.status !== 'running') return state;
      return { status: 'running', index: Math.max(0, clamp(state.index) - 1) };
    // Skip preserves the index so the stored record remembers where they left.
    case 'skip':
      if (state.status !== 'running') return state;
      return { status: 'skipped', index: empty ? 0 : clamp(state.index) };
    case 'jump':
      if (state.status !== 'running') return state;
      return { status: 'running', index: empty ? 0 : clamp(action.index) };
    default:
      return state;
  }
}

/** The step to render, or null — the ONE source of truth for "is it showing?". */
export function currentTourStep(state: TourState, steps: readonly TourStep[]): TourStep | null {
  if (state.status !== 'running') return null;
  if (!steps || steps.length === 0) return null;
  return steps[Math.max(0, Math.min(steps.length - 1, state.index))] ?? null;
}

/** One-based progress for the "step 3 of 15" readout. */
export function tourProgress(state: TourState, steps: readonly TourStep[]): { step: number; total: number } {
  const total = steps?.length ?? 0;
  if (total === 0) return { step: 0, total: 0 };
  return { step: Math.max(0, Math.min(total - 1, state.index)) + 1, total };
}

// ── Persistence (client-side, per uid, no callable) ────────────────────────

export const TOUR_VERSION = 1;
export const TOUR_SEEN_KEY_PREFIX = 'rp-tour-seen';
/**
 * Last known first game id, remembered by the dashboard so a Builder step can
 * offer "take me there" without the tour holding a data subscription of its own.
 */
export const TOUR_FIRST_GAME_KEY = 'rp-first-game-id';

export interface TourRecord {
  version: number;
  status: 'skipped' | 'completed';
  lastStepId?: TourStepId;
}

/** Per-creator key, so two accounts on one browser never share a record. */
export function tourStorageKey(uid: string | null | undefined): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${TOUR_SEEN_KEY_PREFIX}:${clean || 'anon'}`;
}

/**
 * Parse a stored record. Missing / malformed / unknown-outcome data yields
 * `null` ("never seen"), which is the friendlier failure: a blocked storage
 * shows the tour rather than swallowing it.
 *
 * A record carrying ANY version parses, deliberately: bumping TOUR_VERSION must
 * not re-fire the tour for everyone who already dismissed it (design §5).
 */
export function readTourRecord(raw: string | null | undefined): TourRecord | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.status !== 'skipped' && obj.status !== 'completed') return null;
    if (typeof obj.version !== 'number' || !Number.isFinite(obj.version)) return null;
    const rec: TourRecord = { version: obj.version, status: obj.status };
    if (typeof obj.lastStepId === 'string' && obj.lastStepId) rec.lastStepId = obj.lastStepId as TourStepId;
    return rec;
  } catch {
    return null;
  }
}

export function writeTourRecord(record: TourRecord): string {
  return JSON.stringify(record);
}

/**
 * What to store for this state, or `null` while there is nothing to remember.
 * A tour abandoned by closing the tab is NOT "seen" and greets them again.
 */
export function tourRecordFor(state: TourState, steps: readonly TourStep[]): TourRecord | null {
  if (state.status !== 'skipped' && state.status !== 'completed') return null;
  const rec: TourRecord = { version: TOUR_VERSION, status: state.status };
  const step = steps && steps.length > 0
    ? steps[Math.max(0, Math.min(steps.length - 1, state.index))]
    : undefined;
  if (step) rec.lastStepId = step.id;
  return rec;
}

/**
 * Whether the tour may greet this creator unprompted.
 *
 * `established` comes from the `rp-known-game-count:<uid>` signal via
 * `isEstablishedCreator`: a browser that has seen THIS ACCOUNT holding games is
 * not a first-timer, and the whole requirement is that a returning creator is
 * never interrupted. They still get the header help button.
 *
 * Per uid, exactly like the record beside it: the signal used to be one global
 * key, so a second creator signing in on a colleague's browser inherited their
 * history and never saw the tour at all (change: post-review-fixes A).
 */
export function shouldAutoStartTour({ record, established }: {
  record: TourRecord | null;
  established: boolean;
}): boolean {
  return record === null && !established;
}

// ── Presentation decisions (still pure) ────────────────────────────────────

/**
 * Anchored only when the step declares an anchor AND that element is really on
 * screen. A Builder step viewed from the Dashboard, or an anchor lost to a later
 * refactor, degrades to a centred card instead of pointing at nothing.
 */
export function resolveTourAnchoring(step: TourStep, anchorFound: boolean): 'anchored' | 'centered' {
  return step.anchor && anchorFound ? 'anchored' : 'centered';
}

export interface TourTargetContext {
  firstGameId?: string | null;
  liveRunPath?: string | null;
}

/**
 * The optional "take me there" destination, or null when it cannot be resolved
 * (no game yet, no live run). The tour never navigates on its own.
 */
export function tourStepTarget(step: TourStep, ctx: TourTargetContext): string | null {
  switch (step.surface) {
    case 'dashboard': return '/';
    case 'builder':   return ctx.firstGameId ? `/build/${ctx.firstGameId}` : null;
    case 'run':       return ctx.liveRunPath || null;
    case 'gallery':   return '/gallery';
    case 'wallet':    return '/wallet';
    case 'settings':  return '/settings';
    default:          return null;
  }
}

export interface TourRect { top: number; left: number; width: number; height: number }
export interface TourSize { width: number; height: number }

const TOUR_CARD_GAP = 14;

const finite = (n: unknown, fallback = 0): number =>
  (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

/**
 * Where the step card goes, clamped inside the viewport. A garbage rect (a
 * detached node measuring NaN) still yields a finite, non-negative, on-screen
 * position — the card must never be the reason a creator cannot dismiss it.
 */
export function tourCardPosition({ rect, viewport, card, placement, rtl = false }: {
  rect: TourRect;
  viewport: TourSize;
  card: TourSize;
  placement: TourPlacement;
  rtl?: boolean;
}): { top: number; left: number } {
  const vw = Math.max(0, finite(viewport?.width));
  const vh = Math.max(0, finite(viewport?.height));
  const cw = Math.max(0, finite(card?.width));
  const ch = Math.max(0, finite(card?.height));
  const r = {
    top: finite(rect?.top),
    left: finite(rect?.left),
    width: Math.max(0, finite(rect?.width)),
    height: Math.max(0, finite(rect?.height)),
  };

  const centreX = r.left + r.width / 2 - cw / 2;
  const centreY = r.top + r.height / 2 - ch / 2;

  let top: number;
  let left: number;
  switch (placement) {
    case 'top':
      top = r.top - ch - TOUR_CARD_GAP; left = centreX; break;
    case 'bottom':
      top = r.top + r.height + TOUR_CARD_GAP; left = centreX; break;
    // Logical sides: `start` is the left edge in LTR and the right edge in RTL.
    case 'start':
      top = centreY;
      left = rtl ? r.left + r.width + TOUR_CARD_GAP : r.left - cw - TOUR_CARD_GAP;
      break;
    case 'end':
      top = centreY;
      left = rtl ? r.left - cw - TOUR_CARD_GAP : r.left + r.width + TOUR_CARD_GAP;
      break;
    default:
      top = vh / 2 - ch / 2; left = vw / 2 - cw / 2; break;
  }

  const clampInto = (v: number, size: number, extent: number): number =>
    Math.max(0, Math.min(finite(v), Math.max(0, extent - size)));

  return { top: clampInto(top, ch, vh), left: clampInto(left, cw, vw) };
}
