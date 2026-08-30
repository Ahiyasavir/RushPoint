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
 * reach the Builder without the tour holding a data subscription of its own.
 *
 * The bare constant is the LEGACY global key, kept only so the stale entry it
 * wrote can still be identified and removed. Read and write through
 * `firstGameIdKey(uid)` instead — see below.
 */
export const TOUR_FIRST_GAME_KEY = 'rp-first-game-id';

/**
 * Per-creator key, so two accounts on one browser never share a game id.
 *
 * Its siblings (`knownGameCountKey`, `tourStorageKey`) were scoped from the
 * start; this one was not, and once the tour began NAVIGATING on its own
 * (change: tour-auto-navigate) that gap became a wall: a brand-new creator
 * signing up in a browser that had held another account was driven straight into
 * `/build/<the other account's game>` and met "Game not found". While the step
 * was only an optional "take me there" link the same staleness was merely a dead
 * link, which is why it survived this long.
 */
export function firstGameIdKey(uid: string | null | undefined): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${TOUR_FIRST_GAME_KEY}:${clean || 'anon'}`;
}

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
 * Auto-start is scoped to a FIRST-EVER SIGNUP and nothing else
 * (change: post-signup-redirect). Every other visit keeps the on-demand-only rule
 * that `onboarding-overload-fix` established: auto-firing the deep 15-step
 * walkthrough on a brand-new creator's EMPTY dashboard pointed seven Builder steps
 * at screens that did not exist yet — "take me there" was dead and every anchored
 * step degraded to a centred card over the (now clickable) first-run checklist.
 *
 * `justSignedUp` is what makes the narrow case different: the creator has just
 * finished signing up and has been sent to the dashboard deliberately, so a welcome
 * is expected rather than an interruption. It is a POSITIVE, explicit opt-in — an
 * omitted flag reads as `false`, so no existing call site can start firing the tour
 * by accident.
 *
 * Still false for anyone who already has a tour record (seen or dismissed) or who is
 * an established creator, so a returning creator is never interrupted.
 */
export function shouldAutoStartTour(args: {
  record: TourRecord | null;
  established: boolean;
  justSignedUp?: boolean;
}): boolean {
  if (!args?.justSignedUp) return false;
  if (args.established) return false;
  return args.record == null;
}

// ── Post-signup landing (change: post-signup-redirect) ──────────────────────

/** How long to let the dashboard settle before offering the tour. */
export const POST_SIGNUP_TOUR_DELAY_MS = 2000;

/**
 * Should the app move this creator to the dashboard now that auth succeeded?
 *
 * AuthGate never navigated after a successful sign-in, and creator-web is
 * URL-driven — so whatever path was in the address bar when auth flipped is what
 * rendered. Signing up while sitting on /settings therefore "redirected to
 * settings", which is what creators reported.
 *
 * Only a genuinely NEW account is moved. FAIL-SAFE by design: anything other than a
 * confirmed `true` means stay put. A missed redirect costs a new creator one click;
 * a wrong redirect yanks a returning creator off a page they deliberately opened,
 * which is a worse bug than the one being fixed. Total and non-throwing — it runs on
 * the auth path, where a throw would surface as a failed sign-in.
 */
export function shouldRedirectAfterSignup(args: { isNewUser: boolean }): boolean {
  return args?.isNewUser === true;
}

/**
 * One-shot hand-off from AuthGate (which knows a signup just happened) to
 * CreatorTour (which is mounted elsewhere and decides whether to greet).
 *
 * sessionStorage, not a module variable: the two components are in different
 * subtrees and the navigation to the dashboard happens in between. It is
 * deliberately SESSION scoped and consumed on read, so a welcome fires exactly once
 * and never resurrects on a later reload. Storage can throw (private mode, disabled
 * cookies) — both helpers swallow it, because failing to show a tour must never
 * break signing up.
 */
const JUST_SIGNED_UP_KEY = 'rp-just-signed-up';

/**
 * Fired the moment the flag is written, because WRITING IT IS A RACE.
 *
 * `markJustSignedUp()` runs after `await signUpWithEmail(...)` — but auth flips as
 * soon as that promise resolves, so AuthProvider swaps in the app tree and
 * CreatorTour mounts and reads the flag BEFORE this function has run. Polling
 * once at mount therefore always lost the race and no creator ever saw the tour.
 * Listening to this event makes the hand-off order-independent: whichever happens
 * first, the tour still learns about the signup.
 */
export const JUST_SIGNED_UP_EVENT = 'rp-just-signed-up-event';

export function markJustSignedUp(): void {
  try { sessionStorage.setItem(JUST_SIGNED_UP_KEY, '1'); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new Event(JUST_SIGNED_UP_EVENT)); } catch { /* no window */ }
}

/** Undo the mark — used when the signup that set it then failed. */
export function clearJustSignedUp(): void {
  try { sessionStorage.removeItem(JUST_SIGNED_UP_KEY); } catch { /* storage unavailable */ }
}

/** True at most once per signup: reading it clears it. */
export function consumeJustSignedUp(): boolean {
  try {
    const hit = sessionStorage.getItem(JUST_SIGNED_UP_KEY) === '1';
    if (hit) sessionStorage.removeItem(JUST_SIGNED_UP_KEY);
    return hit;
  } catch { return false; }
}

// ── "Start building" intent, carried in from the marketing site ─────────────
//
// The marketing CTA used to land on the creator LANDING page — a second pitch,
// to somebody who had just read the first one and clicked anyway. This carries
// their intent across the sign-in instead: the login screen drops the marketing
// copy and shows only the auth card, and the Dashboard opens the new-game wizard
// (whose first step is already "what is this game called") the moment it mounts.
//
// SESSION scoped, not local: it describes one arrival, not a standing
// preference. A creator who clicks the link, closes the tab and comes back next
// week should get their ordinary dashboard, not a modal they never asked for.

const START_INTENT_KEY = 'rp-start-intent';

/**
 * Does this URL ask to go straight to building?
 *
 * Pure and total — it is read at module load on every single page view, so a
 * malformed query string must yield `false` rather than throw and take the whole
 * app down before it renders. Only the exact value is honoured: `?start=` on its
 * own, or any other value, is not an instruction.
 */
export function readStartIntent(search: unknown): boolean {
  if (typeof search !== 'string' || search === '') return false;
  try {
    return new URLSearchParams(search).get('start') === 'game';
  } catch { return false; }
}

export function markStartIntent(): void {
  try { sessionStorage.setItem(START_INTENT_KEY, '1'); } catch { /* storage unavailable */ }
}

/** Is the intent still pending? Does NOT clear it — see `consumeStartIntent`. */
export function hasStartIntent(): boolean {
  try { return sessionStorage.getItem(START_INTENT_KEY) === '1'; } catch { return false; }
}

/**
 * True at most once per arrival: reading it clears it.
 *
 * Consumed by the Dashboard rather than the login screen, because the login
 * screen may be rendered several times over one arrival (a failed password, a
 * switch between sign-in and sign-up) and each of those still needs the bare
 * layout. Only the thing that ACTS on the intent gets to spend it.
 */
export function consumeStartIntent(): boolean {
  try {
    const hit = sessionStorage.getItem(START_INTENT_KEY) === '1';
    if (hit) sessionStorage.removeItem(START_INTENT_KEY);
    return hit;
  } catch { return false; }
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
 * The step's destination, or null when it cannot be resolved (no game yet, no
 * live run). Read through `tourNavIntent` below, which decides what to DO about
 * it — this only answers "where does this step live".
 */
export function tourStepTarget(step: TourStep, ctx: TourTargetContext): string | null {
  switch (step.surface) {
    case 'dashboard': return '/';
    case 'builder':   return ctx?.firstGameId ? `/build/${ctx.firstGameId}` : null;
    case 'run':       return ctx?.liveRunPath || null;
    case 'gallery':   return '/gallery';
    case 'wallet':    return '/wallet';
    case 'settings':  return '/settings';
    default:          return null;
  }
}

// ── Driving the creator (change: tour-auto-navigate) ─────────────────────────
//
// The tour used to refuse to navigate: a step only OFFERED its destination behind
// a "take me there" link. That produced the reported failure — "you are not able
// to get inside a game and see it visually" — because reaching the screen a step
// described was a manual click, and for the case the tour now auto-starts in (a
// brand-new creator with ZERO games) the Builder steps had no destination at all.
// Seven of fourteen steps narrated screens that could not be reached.
//
// A step now resolves to one of three intents. The important one is the third:
// when a destination cannot exist YET because the creator has to do something
// first, point at the control that does it instead of describing a screen they
// cannot open.

/** `data-tour` anchors of the controls the tour can ask a creator to press. */
export const TOUR_ACTION_ANCHORS = {
  createGame: 'new-game',
  launchRun: 'builder-launch',
} as const;

export type TourNavIntent =
  /** Already on a surface that teaches this step, or the step is placeless. */
  | { kind: 'stay' }
  /** Go here now, without asking. */
  | { kind: 'navigate'; to: string }
  /** The destination needs an action first: spotlight `anchor`, found at `at`. */
  | { kind: 'awaitAction'; anchor: string; at: string };

/** Is `pathname` already a Builder screen? Any game's builder teaches a Builder step. */
function isBuilderPath(pathname: string): boolean {
  return typeof pathname === 'string' && pathname.startsWith('/build/');
}

/**
 * What should the tour DO for this step, given what the creator actually has?
 *
 * Total by construction: unknown surfaces, a missing context and a missing
 * pathname all resolve to `stay`, because the one thing a tour must never do is
 * throw inside the console it is explaining.
 */
export function tourNavIntent(
  step: TourStep,
  ctx: TourTargetContext,
  pathname: string,
): TourNavIntent {
  const here = typeof pathname === 'string' ? pathname : '';
  const target = tourStepTarget(step, ctx ?? {});

  if (target) {
    // A Builder step is satisfied by ANY builder: a creator already editing a
    // different game is looking at exactly what the step is about, and yanking
    // them to their first game would lose their place for nothing.
    if (step?.surface === 'builder' && isBuilderPath(here)) return { kind: 'stay' };
    return target === here ? { kind: 'stay' } : { kind: 'navigate', to: target };
  }

  // No destination. For the two surfaces that depend on state the creator has to
  // create, ask them to create it — the prompt has to be issued where the control
  // actually lives, so anyone standing elsewhere is walked there first.
  if (step?.surface === 'builder') {
    if (isBuilderPath(here)) return { kind: 'stay' };
    return here === '/'
      ? { kind: 'awaitAction', anchor: TOUR_ACTION_ANCHORS.createGame, at: '/' }
      : { kind: 'navigate', to: '/' };
  }
  if (step?.surface === 'run') {
    return here === '/'
      ? { kind: 'awaitAction', anchor: TOUR_ACTION_ANCHORS.launchRun, at: '/' }
      : { kind: 'navigate', to: '/' };
  }

  return { kind: 'stay' };
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

// ═══════════════════════════════════════════════════════════════════════════
// Builder first-open spotlight (change: guided-new-game-wizard)
// ═══════════════════════════════════════════════════════════════════════════
//
// The full TOUR_STEPS walkthrough above owns the first-SIGNUP moment, and git
// history records why it must not be stretched to cover this one: auto-firing it
// on an empty dashboard described screens that did not exist yet (ae512a5). But
// the hardest reported problem with this product is not building a mission — it is
// understanding what a "stage" and a "mission" even are, and that question is
// asked while staring at the Builder, not the dashboard.
//
// So the Builder gets its own two-step explainer, pointing at the real panes.
// Deliberately tiny: three steps is the ceiling, because anything longer stops
// being an explanation and becomes a thing to dismiss.
//
// WHO ACTUALLY SEES IT. It yields to both the full tour and Quick Setup, and Quick
// Setup auto-opens on Builder mount for any game built from a template — so a
// guided-path creator is never shown two overlays at once, and this becomes the
// SCRATCH creator's explainer. That is precisely the creator who gets no other
// guidance anywhere in the product.

/** One spotlight step. Copy lives in i18n (`t.tour.spotlight[id]`). */
export interface SpotlightStep {
  id: string;
  /** `data-tour` value to point at. Never null — a centred card would explain
   *  nothing here, and scripts/test-builder-spotlight.ts asserts each anchor
   *  really exists in BuilderPage.tsx. */
  anchor: string;
  placement: TourPlacement;
}

export const SPOTLIGHT_STEPS: readonly SpotlightStep[] = [
  // The stage rail lives inside the canvas region on a phone (the 3-pane shell
  // restacks below `sm`), so both steps anchor on elements that exist at every
  // width rather than on a desktop-only pane.
  { id: 'stages', anchor: 'builder-breadcrumb', placement: 'bottom' },
  { id: 'missions', anchor: 'builder-canvas', placement: 'center' },
];

/** Separate from TOUR_SEEN_KEY_PREFIX on purpose: dismissing one must not
 *  silently dismiss the other. */
export const SPOTLIGHT_SEEN_KEY_PREFIX = 'rp-builder-spotlight-seen';

export interface SpotlightRecord { seen: true }

/** Per-creator key, so two accounts on one browser never share a record. */
export function spotlightSeenKey(uid: string | undefined | null): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${SPOTLIGHT_SEEN_KEY_PREFIX}:${clean || 'anon'}`;
}

/**
 * Parse a stored record. Anything unparseable reads as never-seen, which is the
 * friendlier failure: a blocked storage shows the explainer rather than
 * swallowing it.
 */
export function readSpotlightRecord(raw: string | null | undefined): SpotlightRecord | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return (parsed as SpotlightRecord).seen === true ? { seen: true } : null;
  } catch {
    return null;
  }
}

/** Should the Builder spotlight run right now? Total — never throws. */
export function shouldStartBuilderSpotlight(args: {
  record: SpotlightRecord | null;
  tourRunning: boolean;
  quickSetupActive: boolean;
}): boolean {
  if (!args || typeof args !== 'object') return false;
  if (args.record?.seen === true) return false;
  // Two guided overlays at once is worse than none.
  if (args.tourRunning === true) return false;
  if (args.quickSetupActive === true) return false;
  return true;
}

/**
 * The steps whose anchors are actually on screen. A step whose target is not
 * mounted is SKIPPED rather than highlighting empty space — a collapsed panel, a
 * narrow viewport or a game with no missions yet all produce missing anchors.
 */
export function visibleSpotlightSteps(isMounted: (anchor: string) => boolean): SpotlightStep[] {
  if (typeof isMounted !== 'function') return [];
  return SPOTLIGHT_STEPS.filter((s) => {
    try {
      return isMounted(s.anchor) === true;
    } catch {
      return false;
    }
  });
}
