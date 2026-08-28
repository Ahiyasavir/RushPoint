import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Game, GameMode, Stage, GameFile } from '@rushpoint/shared';
import {
  GAME_TRASH_RETENTION_DAYS, PAYMENTS_ENABLED, resolvePlayOrigin, CANONICAL_PLAY_URL,
  DEFAULT_WRONG_ANSWER_LEVEL, parseGameFile, AGE_BANDS,
} from '@rushpoint/shared';
import {
  createGame, updateGame, listGames, launchRun, deleteGame, publishGame,
  createGameFromTemplate, importGameFile, type TemplateGroupEntry,
} from '../services/calls';
import { peekTemplates, fetchTemplates } from '../lib/templateCache';
import { composeGame, previewShape, seededRng, type ComposerDescriptionCopy } from '../lib/composeGame';
import SmartBuildReveal, { type RevealStage } from '../components/SmartBuildReveal';
import { readRecentPicks, recordRecentPicks } from '../lib/recentBankPicks';
import { TASK_BANK } from '../taskBank';
import NewGameWizard, { type WizardSubmission, type WizardTemplate } from '../components/NewGameWizard';
import { Badge, Button, Card, EmptyState, Input, Label, Skeleton } from '../components/ui';
import { LaunchLiftoff } from '../components/LaunchLiftoff';
import { LoadingState } from '../components/LoadingState';
import { OverflowMenu } from '../components/OverflowMenu';
import { dashboardCardActions } from '../lib/dashboardCardActions';
import { matchesGameDeleteConfirmation } from '../lib/deleteConfirm';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import { ShareSheet } from '../components/ShareSheet';
import { orderTemplatesForPicker, type ResolvedTemplate } from '../lib/templatePicker';
import { firstLaunchBlocker, splitTestDriveReadiness, type ReadinessIssue } from '../lib/gameReadiness';
import { describeCallFailure } from '../lib/callFeedback';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { useAuth } from '../components/AuthGate';
import { useT } from '../components/LanguageContext';
import { useLanguage } from '../components/LanguageContext';
import { useLiveRuns } from '../hooks/useLiveRuns';
import { liveRunForGame } from '../lib/creatorNav';
import {
  KNOWN_GAME_COUNT_KEY, ONBOARDING_DISMISSED_KEY, PREVIEWED_STORAGE_KEY, TOUR_FIRST_GAME_KEY, firstGameIdKey,
  buildOnboardingChecklist, knownGameCountKey, readKnownGameCount, readPreviewedGames,
  skeletonCardCount,
  type OnboardingStepId,
} from '../lib/creatorOnboarding';

// "Blank" stays a hardcoded, always-first, client-side special case — NOT a real
// admin-editable template (design decision, admin-manage-game-templates). One
// empty stage with one empty-titled task, matching the old templates.ts build().
function blankStage(): Stage {
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  return {
    id: uuid(), order: 0, title: 'שלב 1', requiredTaskCount: 1,
    tasks: [{
      id: uuid(), title: '', type: 'field', coordinates: { lat: 0, lng: 0 },
      locationless: true, triggerMode: 'locationless',
      difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5,
    }],
  };
}
const BLANK_MODE: GameMode = 'team';

/** The creator's picker choice: the hardcoded Blank option, or a resolved
 *  (language-picked) Firestore-backed template. */
type PickerChoice = { kind: 'blank' } | { kind: 'template'; resolved: ResolvedTemplate };

// Module-level cache so navigating back to dashboard is instant (no spinner).
// Scoped to the owner uid: sign-out doesn't reload the page, so without the uid
// guard this cache would survive an account switch on the same device and leak
// the previous user's game list to the next login for up to the TTL.
let _gamesCache: { uid: string; data: Game[]; ts: number } | null = null;
const CACHE_TTL = 45_000;

function readGamesCache(uid: string | undefined): Game[] | null {
  if (!uid || !_gamesCache || _gamesCache.uid !== uid) return null;
  if (Date.now() - _gamesCache.ts >= CACHE_TTL) return null;
  return _gamesCache.data;
}

const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? CANONICAL_PLAY_URL);

function getAccentBar(g: Game): string {
  if (g.visibility === 'public') return 'from-rp-plasma to-rp-go';
  return 'from-rp-fire to-rp-amber';
}

// localStorage is read through these so a blocked or malformed store degrades to
// a sensible default instead of throwing on first paint.
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function readStoredPreviewed(): string[] {
  try { return readPreviewedGames(localStorage.getItem(PREVIEWED_STORAGE_KEY)); } catch { return []; }
}

// One time "you are going live" confirmation, shared with the Builder header
// (change: creator-first-launch-confirm). The FIRST real launch a creator ever
// runs asks once, gated by a per uid localStorage flag; confirming here or in the
// Builder counts, so an established creator is never nagged. Fails safe: a blocked
// store reads as "not yet confirmed" so the check shows once rather than silently
// vanishing. Test run is never gated.
const FIRST_LAUNCH_CONFIRMED_PREFIX = 'rp-first-launch-confirmed';
function firstLaunchConfirmedKey(uid: string | null | undefined): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${FIRST_LAUNCH_CONFIRMED_PREFIX}:${clean || 'anon'}`;
}
function hasConfirmedFirstLaunch(uid: string | null | undefined): boolean {
  try { return localStorage.getItem(firstLaunchConfirmedKey(uid)) === '1'; }
  catch { return false; }
}
function markFirstLaunchConfirmed(uid: string | null | undefined): void {
  try { localStorage.setItem(firstLaunchConfirmedKey(uid), '1'); }
  catch { /* storage blocked: the confirm simply shows again next time */ }
}

// First-run checklist. Every step's state is derived by buildOnboardingChecklist
// from the creator's real games and runs, so there is deliberately no
// "mark as done" control here.
function OnboardingChecklist({ checklist, onDismiss, onStep }: {
  checklist: { steps: { id: OnboardingStepId; done: boolean }[]; completedCount: number };
  onDismiss: () => void;
  // Navigate the creator to where they'd DO an incomplete step. No mark-as-done:
  // every step's completion still derives from real progress, this only routes.
  onStep: (id: OnboardingStepId) => void;
}) {
  const t = useT();
  const o = t.dashboard.onboarding;
  return (
    <section className="mb-10 rounded-3xl border border-[--rp-border] bg-[--surface-0]/70 dark:bg-white/[0.03] backdrop-blur-sm p-6 animate-fade-up">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-brand text-xl font-extrabold text-[--ink-1]">{o.title}</h2>
          <p className="text-sm text-[--ink-3] mt-1">{o.body}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs font-semibold text-[--ink-3] tabular-nums">
            {o.progress({ done: checklist.completedCount, total: checklist.steps.length })}
          </span>
          <button
            onClick={onDismiss}
            className="text-[13px] font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
          >
            {o.dismiss}
          </button>
        </div>
      </div>
      <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {checklist.steps.map((step, i) => {
          const copy = o.steps[step.id];
          const rowClass = `flex items-start gap-3 rounded-xl border p-3 transition-colors ${
            step.done ? 'border-rp-go/40 bg-rp-go/5' : 'border-[--rp-border] bg-[--surface-1] dark:bg-[--surface-2]/40'}`;
          const inner = (
            <>
              <span aria-hidden="true"
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step.done ? 'bg-rp-go/20 text-ink-go' : 'bg-[--surface-2] text-[--ink-3]'}`}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <div className="min-w-0 text-start">
                <div className="text-sm font-semibold text-[--ink-1]">{copy.title}</div>
                <p className="text-[13px] text-[--ink-3] mt-0.5 leading-relaxed">{copy.body}</p>
                {step.done && <span className="sr-only">{o.stepDone}</span>}
              </div>
            </>
          );
          // Completed steps stay inert. An incomplete step is a real <button>
          // that routes the creator to where they'd finish it (keyboard-safe;
          // no onClick on a non-interactive element).
          return (
            <li key={step.id}>
              {step.done ? (
                <div className={rowClass}>{inner}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => onStep(step.id)}
                  className={`${rowClass} w-full text-start hover:border-rp-fire/50 hover:bg-rp-fire/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50`}
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const TASK_TYPE_EMOJI: Record<string, string> = {
  field: '📍', self_report: '✅', smart_station: '🔢',
  photo: '📷', quiz: '❓', numeric: '#️⃣', geofence: '📡', sequence: '🧩', survey: '🗳️',
};

export default function DashboardPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const d = t.dashboard;
  const b = t.builder;
  // Localized task-type chip labels (never show raw English enum values in a
  // Hebrew UI). Mirrors the Builder's TaskCard type labels.
  const TASK_TYPE_LABEL: Record<string, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation,
    photo: b.typePhoto, quiz: b.typeQuiz, numeric: b.typeNumeric,
    geofence: b.typeGeofence, sequence: b.typeSequence, survey: b.typeSurvey,
  };

  const [games, setGames] = useState<Game[] | null>(() => readGamesCache(user?.uid));
  const [picking, setPicking] = useState(false);
  // The composed game waiting to be revealed (change: smart-build-delight).
  // Non-null only between "the game was created" and "the creator continued", so
  // it is never a source of truth for anything — the game is already on the
  // server by the time this is set.
  const [reveal, setReveal] = useState<
    { gameId: string; title: string; stages: RevealStage[] } | null
  >(null);
  // The template the creator selected but has not confirmed yet — the moment the
  // play mode and scoring style are DISCLOSED instead of silently assigned.
  const [chosen, setChosen] = useState<PickerChoice | null>(null);
  // Escape closes the template picker, matching its backdrop click. Gated on
  // `picking` because this page renders the whole dashboard behind it.
  useModalDismiss(() => { setPicking(false); setChosen(null); }, undefined, picking);
  // Firestore-backed templates (change: admin-manage-game-templates). null = still
  // loading; [] + failed = the fetch errored. Seeded SYNCHRONOUSLY from the cache
  // (perf: template-picker-latency) so a returning creator's picker paints its menu
  // on the very first frame instead of a spinner — the callable is a cross-origin
  // round trip and the menu is the same short list for everyone.
  const [templateGroups, setTemplateGroups] = useState<TemplateGroupEntry[] | null>(
    () => peekTemplates()?.entry.templates ?? null,
  );
  // Only written, never read: the wizard's scratch path works with no templates
  // at all, so a failed menu load must not become a dead end.
  const [, setTemplatesFailed] = useState(false);
  const { lang } = useLanguage();
  // Scoring is an easy-wizard default: Create proceeds on the template's own
  // preset unless the creator opens this disclosure to change it.
  // Picking a template card reveals a settings + "Create" panel that often sits
  // below the fold, so the creator sees only a highlight and thinks nothing happened.
  // Bring it into view and land focus on the Create button whenever the choice changes.
  const chosenPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!chosen) return;
    const panel = chosenPanelRef.current;
    panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    panel?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [chosen]);
  // First-run checklist. Only `dismissed` is stored; every step is derived.
  const [dismissed, setDismissed] = useState(() => readFlag(ONBOARDING_DISMISSED_KEY));
  const previewedGameIds = readStoredPreviewed();
  const { runs: liveRuns } = useLiveRuns();
  const [sharing, setSharing] = useState<Game | null>(null);
  // The game whose delete confirmation is open (change: recoverable-game-deletion).
  // A creator destroyed a real game with the old single-click dialog.confirm, so
  // deleting now costs a deliberate act: type this game's title.
  const [deleting, setDeleting] = useState<Game | null>(null);
  // Launch is a single opaque `launchRun` round-trip with no on-screen feedback
  // until now (change: creator-launch-liftoff). While it is in flight we show the
  // <LaunchLiftoff> overlay (the per-card button loading state is separate).
  const [launching, setLaunching] = useState(false);
  // Import-from-file (change: dashboard-import-entry-point). The Builder already
  // let a creator load a copy from a file, but only from inside an ALREADY-open
  // game's File menu — there was no way to bring a file in before any game
  // existed, or without knowing that menu was there. Same hidden-input + parse
  // pattern as BuilderPage.importFromFile, just reachable from the dashboard.
  const importInput = useRef<HTMLInputElement | null>(null);

  // Double-click / re-entrancy guards (change: wave-b/async-action-guard). A
  // `useState` busy flag can't stop a second click in the SAME React batch —
  // setState is async, so both clicks read busy === false and both fire the
  // callable. These hold for the whole duration of the promise instead.
  // launch/publish/delete are keyed by game id so acting on one card never
  // blocks another.
  const newGameAction = useAsyncAction<[WizardSubmission], void>(newGame);
  const launchAction = useAsyncAction<[Game, { testDrive?: boolean }?], void>(launch, (g) => g.id);
  const publishAction = useAsyncAction(togglePublish, (g: Game) => g.id);
  const removeAction = useAsyncAction(remove, (g: Game) => g.id);
  const busy = newGameAction.busy || launchAction.busy;

  /**
   * The templates the wizard can offer, flattened out of the grouped menu and
   * resolved to the creator's own language (change: guided-new-game-wizard).
   * `templateGenre` rides along so the wizard can map "a story, or missions?" onto
   * a real template without guessing.
   */
  const wizardTemplates: WizardTemplate[] = useMemo(
    () => orderTemplatesForPicker(templateGroups ?? [], lang).map((r) => ({
      groupKey: r.groupKey,
      templateEmoji: r.templateEmoji,
      templateGenre: r.variant.templateGenre,
      title: r.variant.title,
      description: r.variant.description,
      stageCount: r.variant.stageCount,
      taskCount: r.variant.taskCount,
      id: r.variant.id,
      ownerUid: r.variant.ownerUid,
    })),
    [templateGroups, lang],
  );

  async function load(invalidate = false) {
    if (!invalidate && readGamesCache(user?.uid)) return;
    try {
      const { games: allGames } = await listGames();
      // Admin-managed TEMPLATES are ordinary Game documents owned by the admin who
      // authored them, so they come back from listGames like any other game — and
      // an admin editing one then found it sitting in "my games", which is exactly
      // where a template must NOT be. Templates belong to /admin/templates only;
      // the creator-facing copy of one is what createGameFromTemplate produces, and
      // that copy is not flagged.
      const games = allGames.filter((g) => g.isTemplate !== true);
      if (user?.uid) _gamesCache = { uid: user.uid, data: games, ts: Date.now() };
      // Remember the count so the NEXT first paint draws a placeholder that
      // matches what this creator actually has (never six cards for zero games).
      // Keyed per uid: a browser can hold several accounts, and the guided tour
      // reads this same signal to decide whether the creator in front of it is a
      // first-timer (change: post-review-fixes A). The legacy GLOBAL entry is
      // dropped on the way past so a stale cross-account count cannot outlive it.
      try {
        localStorage.setItem(knownGameCountKey(user?.uid), String(games.length));
        localStorage.removeItem(KNOWN_GAME_COUNT_KEY);
      } catch { /* storage unavailable */ }
      // Remember one game id so the guided tour's Builder step has a real
      // destination without holding a data subscription of its own. Scoped PER
      // CREATOR: the tour now navigates on its own, so a stale id left by another
      // account on this browser would drive a new creator into a game they do not
      // own ("Game not found"). The legacy global entry is swept for the same
      // reason (change: tour-auto-navigate).
      try {
        const key = firstGameIdKey(user?.uid);
        if (games[0]?.id) localStorage.setItem(key, games[0].id);
        else localStorage.removeItem(key);
        localStorage.removeItem(TOUR_FIRST_GAME_KEY);
      } catch { /* storage unavailable */ }
      setGames(games);
    } catch (e) {
      // Escape the spinner on a first-load failure, but never blank an already-
      // loaded dashboard if a post-mutation refresh fails.
      setGames((prev) => prev ?? []);
      // Never leak a raw Firebase error CODE ("not-found", "unavailable", …) into
      // the UI — a load failure is always technical, not user-actionable. Show the
      // friendly localized message and keep the real error in the console.
      console.error('[dashboard] listGames failed:', e);
      // One cause is worth naming: when the project's daily Firestore budget is
      // spent, EVERY load fails until it resets, and the generic "failed to load"
      // reads as a broken app for hours (2026-08-28). Say what is actually
      // happening and when to come back; everything else keeps the generic copy.
      const failure = describeCallFailure(e, { online: navigator.onLine });
      await dialog.alert(
        failure.key === 'dailyCapacity' ? t.callFailure.dailyCapacity : d.loadGamesFailed,
      );
    }
  }
  useEffect(() => { void load(); }, []);

  // Lock background scroll while the (portalled) template picker is open, so the
  // page behind can't scroll under the full-screen overlay.
  useEffect(() => {
    if (!picking) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [picking]);

  // Warm the template menu when the DASHBOARD mounts, not when the picker opens
  // (perf: template-picker-latency). The fetch is a cross-origin callable — CORS
  // preflight, token verification, a rate-limit transaction and a collectionGroup
  // query — so starting it on the click meant the creator watched a spinner every
  // single time. Starting it on mount hides that behind the time they spend looking
  // at their dashboard, and the cache makes every LATER open instant.
  //
  // Re-runs when the picker opens, which is the retry path: if the warm-up failed
  // (offline at mount) reaching for New game tries again. `fetchTemplates` shares
  // one in-flight promise between callers, so this can never open two round trips.
  useEffect(() => {
    const cached = peekTemplates();
    if (cached) { setTemplateGroups(cached.entry.templates); setTemplatesFailed(false); }
    if (cached?.verdict === 'fresh') return;
    let cancelled = false;
    // A retry is underway: show the loader, not the error left by the attempt that
    // failed. Otherwise a creator who was offline at mount opens the picker onto a
    // stale "couldn't load" message while the successful retry is already in flight.
    if (!cached) { setTemplateGroups(null); setTemplatesFailed(false); }
    void fetchTemplates()
      .then((templates) => { if (!cancelled) { setTemplateGroups(templates); setTemplatesFailed(false); } })
      .catch((e) => {
        console.error('[dashboard] listGameTemplates failed:', e);
        // A cached-but-stale menu stays on screen: it is almost certainly still
        // correct, and an error message in its place would be a downgrade.
        if (!cancelled && !cached) { setTemplateGroups([]); setTemplatesFailed(true); }
      });
    return () => { cancelled = true; };
  }, [picking]);

  /**
   * The localized copy the composer writes a game's description and tags from
   * (change: smart-game-composer).
   *
   * lib/composeGame.ts holds no Hebrew and no English of its own — the same rule
   * lib/describeNewGame.ts lives by — so every human-readable word a composed
   * game carries comes from here, through `t.*`.
   */
  const composerCopy: ComposerDescriptionCopy = {
    lead: ({ people, minutes, ageLabel }) => d.wizard.descriptionLead(people, minutes, ageLabel),
    ageLabel: (bandId) => {
      const band = AGE_BANDS.find((b) => b.id === bandId);
      if (!band) return '';
      // Spelled out in words: the copy standard forbids every hyphen, so a band
      // id can never be shown (scripts/test-no-dashes.ts).
      return band.to === undefined ? d.wizard.agePlus(band.from) : d.wizard.ageRange(band.from, band.to);
    },
    ageTag: (bandId) => {
      const band = AGE_BANDS.find((b) => b.id === bandId);
      if (!band) return '';
      const label = band.to === undefined ? d.wizard.agePlus(band.from) : d.wizard.ageRange(band.from, band.to);
      return d.wizard.ageTag(label);
    },
    durationTag: (minutes) => d.wizard.durationTag(minutes),
    composedLead: ({ people, minutes, ageLabel }) => d.wizard.composedLead(people, minutes, ageLabel),
    // The dictionary holds these as DATA (one checkable string per activity), so
    // the lookup lives here rather than inside i18n.ts. An unknown id yields '',
    // which the composer drops — never a raw tag id on a creator's screen.
    activityPhrase: (tag) => d.wizard.activityPhrases[tag] ?? '',
    // The connector is written ONCE, in front of the joined phrases — not baked
    // into each one, which read "with photo missions and with riddles".
    activityJoin: (phrases) => (phrases.length === 0
      ? ''
      : `${d.wizard.activityPrefix} ${phrases.join(d.wizard.activityJoinSeparator)}`),
    activityTag: (tag) => d.wizard.activityTags[tag] ?? '',
    // Also DATA: a list per position, which the composer picks from. An unknown
    // role yields [], and the composer leaves that stage's title empty rather
    // than inventing one.
    stageNames: (role) => d.wizard.composedStageNames[role] ?? [],
    // Per-OCCASION titles, same DATA shape one level deeper. A missing occasion
    // or a missing role yields [], and the composer falls straight back to the
    // generic list above — so this map may stay partial on purpose.
    occasionStageNames: (occasion, role) => d.wizard.occasionStageNames[occasion]?.[role] ?? [],
    // Asked only for a mission the composer just pinned — see siteableInPlacedGame.
    placeMissionPrompt: () => d.wizard.placeMissionPrompt,
  };

  /**
   * Create whatever the wizard asked for (change: guided-new-game-wizard).
   *
   * ONE call per path, and the guided path is a single atomic
   * `createGameFromTemplate` — personalization is applied server-side inside that
   * same write, so a failure can never leave a half-personalized game behind.
   * Navigating to /build/<id> IS the Quick Setup handoff: BuilderPage already
   * offers it on mount for a game carrying wizardSteps.
   */
  async function newGame(submission: WizardSubmission) {
    const { plan } = submission;
    setPicking(false);

    if (plan.kind === 'blank') {
      try {
        const { gameId } = await createGame({ title: plan.title, mode: BLANK_MODE, tags: [] });
        // Wrong-answer cost (change: wrong-answer-cost): NEW games are seeded at
        // the default level so brute forcing a quiz is no longer free.
        await updateGame({
          gameId, stages: [blankStage()], scoringPreset: 'smart_weighted',
          scoringOptions: { wrongAnswerPenalty: DEFAULT_WRONG_ANSWER_LEVEL },
        });
        _gamesCache = null;
        nav(`/build/${gameId}`);
      } catch (e) {
        console.error('[dashboard] create blank game failed:', e);
        await dialog.alert(d.templateFailed);
        setPicking(true);
      }
      return;
    }

    if (plan.kind === 'smart_build') {
      // Compose FIRST, entirely on the client, before either network call — a
      // composition problem can then never leave a half-built game on the server.
      // ⚠️ `seededRng(plan.composerSeed)`, NEVER `Math.random`: the questionnaire's
      // live panel already showed this creator the shape of their game, predicted
      // from this exact seed. Composing under a different stream would hand them a
      // different shape from the one they watched being built — the specific lie
      // this change exists to make impossible (change: smart-build-delight).
      const result = composeGame(
        TASK_BANK,
        plan.composerAnswers,
        composerCopy,
        seededRng(plan.composerSeed),
        readRecentPicks(user?.uid),
      );

      // `null` means the mission bank could not make a game at all. Hand the
      // creator a blank one and SAY SO, rather than silently degrading a smart
      // build into an empty page they did not ask for.
      if (!result) {
        console.error('[dashboard] composer produced no game');
        try {
          const { gameId } = await createGame({ title: plan.title, mode: BLANK_MODE, tags: [] });
          await updateGame({
            gameId, stages: [blankStage()], scoringPreset: 'smart_weighted',
            scoringOptions: { wrongAnswerPenalty: DEFAULT_WRONG_ANSWER_LEVEL },
          });
          _gamesCache = null;
          await dialog.alert(d.wizard.smartFailed);
          nav(`/build/${gameId}`);
        } catch (e) {
          console.error('[dashboard] blank fallback failed:', e);
          await dialog.alert(d.templateFailed);
          setPicking(true);
        }
        return;
      }

      try {
        const { gameId } = await createGame({ title: plan.title, mode: result.mode, tags: [] });
        await updateGame({
          gameId,
          stages: result.stages,
          scoringPreset: result.scoringPreset,
          description: result.description,
          tags: result.tags,
          wizardSteps: result.wizardSteps,
          scoringOptions: { wrongAnswerPenalty: DEFAULT_WRONG_ANSWER_LEVEL },
        });
        _gamesCache = null;
        // Only after BOTH calls succeeded: recording a generation the creator
        // never received would push good missions out of the recency window for
        // nothing.
        recordRecentPicks(user?.uid, result.usedBankKeys);
        // A game materially shorter than the creator asked for is told BEFORE the
        // Builder opens, and told as advice rather than as a number: the usual
        // cause is that no places were named, and that is something they can fix
        // in one answer. Silence here is how someone finds out on the day.
        if (result.shortfall) {
          const { askedMinutes, estimatedMinutes, namedPlaces } = result.shortfall;
          const say = namedPlaces ? d.wizard.shortWithPlaces : d.wizard.shortNoPlaces;
          await dialog.alert(say({ asked: askedMinutes, got: estimatedMinutes }));
        }
        // The reveal, not a navigation (change: smart-build-delight). The game
        // already exists at this point, so nothing here is load-bearing — the
        // creator can continue at any moment, and closing the tab loses nothing.
        //
        // The PLANNED slot counts are recomputed from the same answers and the
        // same seed the panel used, which is exactly the agreement
        // scripts/test-preview-shape.ts pins: it returns the shape the creator
        // watched accumulate, so the reveal can show which planned slots the
        // composer could not fill instead of quietly shipping a shorter stage.
        const planned = previewShape(
          TASK_BANK,
          plan.composerAnswers,
          plan.composerSeed,
          readRecentPicks(user?.uid),
        );
        setPicking(false);
        setReveal({
          gameId,
          title: plan.title,
          stages: result.stages.map((s, i) => ({
            missions: (s.tasks ?? []).map((task) => task.title ?? ''),
            plannedSlots: planned.stages[i]?.slots ?? (s.tasks ?? []).length,
          })),
        });
      } catch (e) {
        // Same rule as every other path here: the wizard already closed, so a
        // silent failure would leave the creator on an unchanged dashboard with
        // no game and no error. Re-open so the answers are not lost.
        console.error('[dashboard] compose game failed:', e);
        await dialog.alert(d.templateFailed);
        setPicking(true);
      }
      return;
    }

    const template = submission.template;
    if (!template) { await dialog.alert(d.templateFailed); setPicking(true); return; }
    try {
      const res = await createGameFromTemplate({
        templateGameId: template.id,
        title: plan.title,
        // Which admin owns this template — straight from the menu the server just
        // sent us, so the server reads one document instead of every template in
        // full (perf: template-picker-latency).
        templateOwnerUid: template.ownerUid,
        description: submission.description,
        tags: submission.tags,
        personalize: plan.personalize,
      });
      _gamesCache = null;
      // Told, not hidden: the client cannot estimate play time (the template menu
      // carries counts, not stages), so this is the only honest moment to say the
      // game may overrun the duration that was asked for.
      if (res?.fitsRequestedDuration === false && typeof res.estimatedMinutes === 'number') {
        await dialog.alert(d.wizard.longerThanAsked(res.estimatedMinutes));
      }
      nav(`/build/${res.gameId}`);
    } catch (e) {
      // The wizard closes FIRST, so a failure here used to leave the creator on an
      // unchanged dashboard with no game and no error at all
      // (change: play-no-silent-failures). Re-open so the answers are not lost.
      console.error('[dashboard] create from template failed:', e);
      await dialog.alert(d.templateFailed);
      setPicking(true);
    }
  }

  // The Dashboard's rendering of a readiness issue. The wording for the three
  // issues the old inline guards could produce is unchanged, byte for byte; the
  // fourth (a stage with no tasks) reuses the Builder's readiness label, which
  // the Dashboard could never reach before because it never ran that rule.
  function launchBlockedMessage(issue: ReadinessIssue): string {
    switch (issue.code) {
      case 'stageHasNoTask':
        // No stageId at all = a game with no stages, the old d.emptyBody case.
        return issue.stageId
          ? `${b.issueStageHasNoTask}\n${issue.stageTitle || b.untitledStage}`
          : d.emptyBody;
      case 'taskNotCompletable':
        return b.taskNotCompletable(issue.taskTitle || b.untitledTask);
      case 'taskNotPlaced':
        return b.taskNeedsLocation(issue.taskTitle || b.untitledTask);
      case 'stageUnwinnable':
        return b.stageUnwinnable(issue.stageTitle || b.stageTitlePlaceholder);
    }
  }

  async function launch(g: Game, opts?: { testDrive?: boolean }) {
    // ONE launch rule (change: builder-first-task-flow). These used to be four
    // inline predicates duplicating the Builder's guards, and they had already
    // drifted: the Dashboard never checked for a stage with NO tasks, so it
    // would happily launch a game the Builder refused. `lib/gameReadiness` is
    // now the single source of truth for both. The Dashboard has no readiness
    // panel to point at, so it still names one offender, exactly as before.
    if (opts?.testDrive) {
      // A rehearsal is for looking at an UNFINISHED game (change:
      // test-drive-not-ready-warning): an unplaced pin or a stage that can't be
      // fully won is a warning the creator may accept, not a wall. Only what
      // launchRun itself refuses stays fatal.
      const { hard, soft } = splitTestDriveReadiness(g);
      if (hard[0]) { await dialog.alert(launchBlockedMessage(hard[0])); return; }
      if (soft.length > 0) {
        const ok = await dialog.confirm(
          t.builder.testDriveNotReadyBody(soft.length),
          t.builder.testDriveNotReadyCta,
        );
        if (!ok) return;
      }
    } else {
      const blocker = firstLaunchBlocker(g);
      if (blocker) {
        await dialog.alert(launchBlockedMessage(blocker));
        return;
      }
    }
    // The one time "am I sure" gate before a creator's FIRST real launch ever
    // (change: creator-first-launch-confirm). Only the real launch is gated, never
    // Test run, and only once the game is known launchable (the blocker check above
    // already passed). Shares its flag with the Builder header.
    // Ask, but burn the one-time flag only after a successful launch below — a
    // launch failure must leave the gate intact for the next attempt.
    const needFirstLaunchConfirm = !opts?.testDrive && !hasConfirmedFirstLaunch(user?.uid);
    if (needFirstLaunchConfirm) {
      const ok = await dialog.confirm(t.builder.firstLaunchConfirmBody, t.builder.firstLaunchConfirmCta);
      if (!ok) return;
    }
    // Show the liftoff overlay for the launch wait, always cleared in `finally` so
    // an error can never leave it stuck open (change: creator-launch-liftoff). On
    // success `nav(...)` leaves the Dashboard before the flag would matter.
    setLaunching(true);
    try {
      const { runId } = await launchRun({ gameId: g.id, testDrive: opts?.testDrive });
      if (needFirstLaunchConfirm) markFirstLaunchConfirmed(user?.uid);
      nav(`/run/${g.id}/${runId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // Out of free runs + credits → route the creator to buy more. In free
      // mode launches never fail for billing, so just surface other errors.
      if (PAYMENTS_ENABLED && /credit|pro/i.test(msg)) {
        if (await dialog.confirm(msg, t.nav.wallet)) nav('/wallet');
      } else {
        // Generic failure: the raw server string is English, so show the
        // localized copy to the creator and keep the raw error in the console.
        console.error('[RushPoint] launch failed:', e);
        await dialog.alert(d.launchFailed);
      }
    } finally {
      setLaunching(false);
    }
  }

  // Deleting is now reversible AND deliberate. The old body was a single
  // dialog.confirm whose accept button was one click away from an irreversible
  // recursiveDelete of the game and every run, team and photo under it.
  async function remove(g: Game) {
    try {
      await deleteGame({ gameId: g.id });
      setDeleting(null);
      void load(true);
    } catch (e) {
      setDeleting(null);
      // The one expected failure: a run is still in progress. The server sends a
      // `failed-precondition` whose message names the access code, so surface
      // that text. Every other rejection is a raw English string a Hebrew-UI
      // creator shouldn't see, so localize it and keep the raw error in console.
      const code = (e as { code?: unknown }).code;
      const bare = typeof code === 'string' ? code.replace(/^functions\//, '') : '';
      if (bare === 'failed-precondition' && e instanceof Error) {
        await dialog.alert(e.message);
      } else {
        console.error('[RushPoint] delete failed:', e);
        await dialog.alert(d.deleteFailed);
      }
    }
  }

  async function importFromFile(file: File) {
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      await dialog.alert(b.importNotAFile);
      return;
    }
    // Same pure parser the server runs, so an obviously bad file fails instantly
    // with the real reason instead of a round trip (mirrors BuilderPage.importFromFile).
    const pre = parseGameFile(doc);
    if (pre.errors.length > 0) { await dialog.alert(pre.errors.join(' · ')); return; }
    try {
      const { gameId } = await importGameFile({ file: doc as GameFile });
      _gamesCache = null;
      nav(`/build/${gameId}`);
    } catch (e) {
      console.error('[dashboard] importGameFile failed:', e);
      await dialog.alert(e instanceof Error ? e.message : b.importFailed);
    }
  }

  async function togglePublish(g: Game) {
    try {
      await publishGame({ gameId: g.id, visibility: g.visibility === 'public' ? 'private' : 'public' });
      void load(true);
    } catch (e) {
      // A failed publish used to be reported ONLY by the badge not changing
      // (change: play-no-silent-failures).
      console.error('[dashboard] publishGame failed:', e);
      toast.error(d.publishFailed);
    }
  }

  if (!games) return <DashboardSkeleton uid={user?.uid} />;

  // Derived from the creator's REAL games and runs. Nothing here reads a stored
  // progress flag, so the list can never claim a step is behind them when it is not.
  const checklist = buildOnboardingChecklist({
    games: games.map((g) => ({ id: g.id, stages: g.stages, playCount: g.playCount })),
    runs: (liveRuns ?? []).map((r) => ({ runId: r.runId })),
    previewedGameIds,
    dismissed,
  });
  function dismissChecklist() {
    setDismissed(true);
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); } catch { /* storage unavailable */ }
  }
  // Route an incomplete checklist step to where the creator would finish it.
  // With no game yet, "create/add" opens the template picker; otherwise every
  // step lands in the first game's Builder. Navigation only — no state change.
  function onChecklistStep() {
    const firstGameId = games?.[0]?.id;
    if (firstGameId) nav(`/build/${firstGameId}`);
    else setPicking(true);
  }
  const firstName = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? d.creatorFallback;

  return (
    <div className="animate-fade-up">
      <LaunchLiftoff
        open={launching}
        title={t.launch.title}
        messages={[t.launch.step1, t.launch.step2, t.launch.step3]}
      />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden mb-10 pb-10 border-b border-[--rp-border]">
        <div className="absolute -top-8 -left-8 w-96 h-48 bg-gradient-radial from-rp-fire/8 to-transparent pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div>
            <p className="text-[--ink-3] text-sm font-medium mb-1 uppercase tracking-widest">
              {d.welcomeBack(firstName)}
            </p>
            <h1 className="font-brand text-3xl sm:text-4xl font-extrabold tracking-tight leading-none bg-gradient-to-r from-rp-fire via-rp-amber to-rp-amber bg-clip-text text-transparent">
              {d.title}
            </h1>
            <p className="text-[--ink-3] mt-3 text-base max-w-sm">{d.subtitle}</p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <Button
                disabled={busy}
                onClick={() => setPicking(true)}
                data-tour="new-game"
                className="!px-6 !py-2.5 !text-sm flex items-center gap-2"
              >
                {d.newGame}
              </Button>
              {/* Import-from-file (change: dashboard-import-entry-point): the
                  only other place this action lived was buried in an already-open
                  game's File menu — a creator with a saved .rushpoint.json file
                  had nowhere on this page to bring it in. */}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => importInput.current?.click()}
                title={d.importGameHint}
                aria-label={d.importGameAria}
                className="!px-4 !py-2.5 !text-sm"
              >
                {d.importGame}
              </Button>
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void importFromFile(f);
                }}
              />
            </div>
            {/* Recently deleted (change: recoverable-game-deletion). A rarely
                opened recovery surface, so it lives here rather than competing
                with Build/Gallery/Wallet in the top nav. */}
            <button
              onClick={() => nav('/trash')}
              className="text-[13px] font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
            >
              {d.trashLink}
            </button>
          </div>
        </div>

        {/* Stats row */}
        {games.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-8">
            {/* The runs tile is a LINK (change: post-run-player-report). It counted
                the one thing a creator most wants to look back at and did nothing
                when clicked, while finished runs had no route into them at all.
                The other two tiles stay inert — they summarise what is already on
                this page, so there is nowhere for them to lead. */}
            {[
              { label: d.statGamesBuilt, value: games.length, icon: '🗺️', tint: 'from-rp-fire/12 to-rp-amber/5', ring: 'group-hover:border-rp-fire/30', to: null as string | null },
              { label: d.statPublished, value: games.filter(g => g.visibility === 'public').length, icon: '🌐', tint: 'from-rp-plasma/12 to-rp-plasma/5', ring: 'group-hover:border-rp-plasma/30', to: null as string | null },
              { label: d.statTotalPlays, value: games.reduce((s, g) => s + (g.playCount ?? 0), 0), icon: '🏁', tint: 'from-rp-signal/12 to-rp-signal/5', ring: 'group-hover:border-rp-signal/30', to: '/history' as string | null },
            ].map((s) => {
              const inner = (
                <>
                  <div className={`absolute inset-0 bg-gradient-to-br ${s.tint} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  <div className="relative flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-[--surface-2] shrink-0">{s.icon}</div>
                    <div className="min-w-0 text-start">
                      <div className="font-brand text-2xl font-extrabold text-[--ink-1] leading-none tabular-nums">{s.value}</div>
                      <div className="text-[13px] text-[--ink-3] mt-1 font-medium truncate">{s.label}</div>
                    </div>
                    {s.to && (
                      <div className="relative ms-auto text-[13px] text-[--ink-3] group-hover:text-ink-signal transition-colors shrink-0">
                        {d.statTotalPlaysCta}
                      </div>
                    )}
                  </div>
                </>
              );
              const shell = `group relative overflow-hidden w-full rounded-2xl border border-[--rp-border] bg-[--surface-0]/80 dark:bg-white/[0.03] backdrop-blur-sm px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 ${s.ring}`;
              return s.to ? (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => nav(s.to as string)}
                  title={d.statTotalPlaysHint}
                  className={`${shell} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-signal/60`}
                >
                  {inner}
                </button>
              ) : (
                <div key={s.label} className={shell}>{inner}</div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── First-run checklist (change: creator-onboarding-and-plain-language) ──
          Suppressed at zero games: the empty state below is then the single focal
          "create your first game" CTA, not a checklist stacked over an identical one. */}
      {games.length > 0 && checklist.visible && (
        <OnboardingChecklist checklist={checklist} onDismiss={dismissChecklist} onStep={onChecklistStep} />
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {games.length === 0 ? (
        <EmptyState
          icon="🗺️"
          title={d.emptyTitle}
          body={d.emptyBody}
          action={
            <Button disabled={busy} onClick={() => setPicking(true)} className="!px-8 !py-3 !text-base">
              {d.emptyBtn}
            </Button>
          }
        />

      ) : (
        /* ── Game cards ──────────────────────────────────────────────────── */
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5" data-tour="game-list">
          {games.map((g, idx) => {
            const taskCount = g.stages.reduce((s, st) => s + st.tasks.length, 0);
            const allTaskTypes = [...new Set(g.stages.flatMap(st => st.tasks.map(tsk => tsk.type)))].slice(0, 4);
            // A run in progress is now reachable from the game it belongs to,
            // which is what replaces the removed top-level "Live runs" menu.
            const live = liveRunForGame(g.id, liveRuns);

            return (
              <div key={g.id} className="animate-fade-up" style={{ animationDelay: `${idx * 60}ms` }}>
                <Card className="p-0 overflow-hidden flex flex-col h-full">
                  <div className={`h-[3px] w-full bg-gradient-to-r ${getAccentBar(g)} flex-shrink-0`} />
                  <div className="p-5 flex flex-col gap-4 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-brand font-bold text-[--ink-1] text-base leading-snug flex-1">{g.title}</h3>
                      <Badge color={g.visibility === 'public' ? 'cyan' : 'zinc'}>
                        {g.visibility === 'public' ? d.visPublic : d.visPrivate}
                      </Badge>
                    </div>

                    <p className="text-xs text-[--ink-3] line-clamp-2 leading-relaxed min-h-[2.5rem]">
                      {g.description || d.noDescription}
                    </p>

                    {allTaskTypes.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {allTaskTypes.map(type => (
                          <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[--surface-2] text-[--ink-3] text-[12px] font-medium">
                            {TASK_TYPE_EMOJI[type] ?? '●'} {TASK_TYPE_LABEL[type] ?? type}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[13px] text-[--ink-3] font-medium">
                      <span>{d.cardStages(g.stages.length)}</span>
                      <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                      <span>{d.cardTasks(taskCount)}</span>
                      <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                      <span>{d.cardPlays(g.playCount ?? 0)}</span>
                    </div>

                    {live && (
                      <button
                        onClick={() => nav(`/run/${live.gameId}/${live.runId}`)}
                        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-ink-alert bg-rp-alert/10 hover:bg-rp-alert/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-alert/40"
                      >
                        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-rp-alert animate-pulse" />
                        {d.cardOpenRun}
                      </button>
                    )}

                    {/* Edit + Launch stay primary and inline; the four secondary
                        actions collapse into one "⋯" overflow menu so the card is
                        not a wall of six equal-weight buttons with Delete a hairline
                        from the primaries. The inline-vs-overflow split is the pure
                        `dashboardCardActions` decision (change:
                        dashboard-card-actions-overflow), mirroring the Run Console
                        team row, and every action stays one click away. */}
                    <div className="flex gap-2 mt-auto items-stretch">
                      <button
                        onClick={() => nav(`/build/${g.id}`)}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-[--ink-2] bg-[--surface-2] hover:bg-[--rp-border] hover:text-[--ink-1] transition-all duration-150"
                      >
                        {d.cardEdit}
                      </button>
                      <Button
                        className="flex-1 !py-2 !text-xs !font-semibold"
                        disabled={busy}
                        loading={launchAction.isBusy(g.id)}
                        onClick={() => void launchAction.run(g)}
                      >
                        {d.cardLaunch}
                      </Button>
                      <OverflowMenu label="⋯" ariaLabel={d.cardMoreActions}>
                        {dashboardCardActions(g).overflow.map((id) => {
                          const items: Record<'testRun' | 'history' | 'publish' | 'unpublish' | 'share' | 'delete', {
                            label: string; title: string | undefined; disabled: boolean;
                            onClick: () => void; destructive: boolean;
                          }> = {
                            testRun: {
                              label: d.cardTestRun,
                              title: d.cardTestRunHint,
                              disabled: busy,
                              onClick: () => void launchAction.run(g, { testDrive: true }),
                              destructive: false,
                            },
                            // Run history (change: post-run-player-report): the way back
                            // into a run that has already ENDED. Every other post-run
                            // surface is keyed by access code and reachable only from
                            // the live console, so without this a finished run has no
                            // door at all.
                            history: {
                              label: d.cardHistory,
                              title: d.cardHistoryHint,
                              disabled: false,
                              onClick: () => nav(`/history?game=${encodeURIComponent(g.id)}`),
                              destructive: false,
                            },
                            publish: {
                              label: d.cardPublish,
                              title: undefined as string | undefined,
                              disabled: publishAction.isBusy(g.id),
                              onClick: () => void publishAction.run(g),
                              destructive: false,
                            },
                            unpublish: {
                              label: d.cardUnpublish,
                              title: undefined as string | undefined,
                              disabled: publishAction.isBusy(g.id),
                              onClick: () => void publishAction.run(g),
                              destructive: false,
                            },
                            share: {
                              label: d.cardShare,
                              title: undefined as string | undefined,
                              disabled: false,
                              onClick: () => setSharing(g),
                              destructive: false,
                            },
                            delete: {
                              label: d.cardDelete,
                              title: undefined as string | undefined,
                              disabled: removeAction.isBusy(g.id),
                              onClick: () => setDeleting(g),
                              destructive: true,
                            },
                          };
                          const item = items[id as keyof typeof items];
                          return (
                            <button
                              key={id}
                              role="menuitem"
                              disabled={item.disabled}
                              title={item.title}
                              onClick={item.onClick}
                              className={`w-full justify-start text-start min-h-[36px] px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                                item.destructive
                                  ? 'text-ink-alert/80 hover:text-ink-alert hover:bg-rp-alert/8 focus-visible:ring-rp-alert/40'
                                  : 'text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] focus-visible:ring-rp-fire/50'
                              }`}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </OverflowMenu>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}

          {/* Persistent create tile */}
          <button
            onClick={() => setPicking(true)}
            disabled={busy}
            className="group animate-fade-up min-h-[220px] rounded-2xl border-2 border-dashed border-[--rp-border] hover:border-rp-fire/50 bg-[--surface-0]/40 dark:bg-white/[0.02] hover:bg-rp-fire/[0.04] transition-all duration-200 flex flex-col items-center justify-center gap-3 text-center px-5"
            style={{ animationDelay: `${games.length * 60}ms` }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl bg-[--surface-2] text-[--ink-2] group-hover:bg-gradient-to-br group-hover:from-rp-fire group-hover:to-rp-amber group-hover:text-white group-hover:scale-105 transition-all duration-200 shadow-sm">
              ＋
            </div>
            <div>
              <div className="font-brand font-bold text-sm text-[--ink-2] group-hover:text-ink-fire transition-colors">{d.newAdventureLabel}</div>
              <div className="text-[13px] text-[--ink-3] mt-0.5">{d.newAdventureSub}</div>
            </div>
          </button>
        </div>
      )}

      {/* ── The smart build's reveal (change: smart-build-delight) ────────────
          Deliberately NOT dismissible by backdrop click or Escape: every other
          modal here can be cancelled because cancelling means "do not do the
          thing", but the game already exists. A stray click that dropped the
          creator back on the dashboard would look exactly like the build having
          failed. The one way out is the button, and it is live immediately. */}
      {reveal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative glass-card grad-border bg-[--surface-0] dark:bg-[--surface-1]/80 border border-[--rp-border] rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-fade-up">
            <SmartBuildReveal
              gameTitle={reveal.title}
              stages={reveal.stages}
              onContinue={() => {
                const { gameId } = reveal;
                setReveal(null);
                nav(`/build/${gameId}`);
              }}
              labels={{
                title: d.wizard.revealTitle,
                subtitle: d.wizard.revealSub,
                stage: (n) => d.wizard.shapeStage(n),
                missions: (n) => d.wizard.revealMissions(n),
                continue: d.wizard.revealContinue,
                aria: d.wizard.revealAria,
              }}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* ── Template picker modal ─────────────────────────────────────────── */}
      {picking && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setPicking(false); setChosen(null); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            // 92vh is a safety net for very short viewports, not the fix: the
            // questionnaire and shape panel were both trimmed (smaller cards, a
            // fixed 4-col grid, a one-line stage strip) so the tallest step fits
            // a normal phone/laptop screen without touching this cap at all
            // (change: smart-build-wizard-no-scroll).
            className="relative glass-card grad-border bg-[--surface-0] dark:bg-[--surface-1]/80 border border-[--rp-border] rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — fixed; never scrolls away. */}
            <div className="flex items-start justify-between gap-4 p-4 pb-3 shrink-0 border-b border-[--rp-border]">
              <div>
                <h3 className="font-brand font-bold text-[--ink-1] text-xl">{d.modalTitle}</h3>
                <p className="text-[--ink-3] text-sm mt-0.5">{d.modalSub}</p>
              </div>
              <button onClick={() => { setPicking(false); setChosen(null); }}
                aria-label={b.closePanel} title={b.closePanel}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[--ink-3] hover:bg-[--surface-2] hover:text-[--ink-1] transition-colors">✕</button>
            </div>
            {/* Body — bounded to the modal; the compact cards fit without scrolling
                on a normal screen, and only this region (never the page) scrolls on
                a very short viewport. */}
            <div className="overflow-y-auto p-4 pt-3">
              {templateGroups === null ? (
                <div className="flex items-center gap-2 text-sm text-[--ink-3] p-3">
                  <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                  {d.templatesLoading}
                </div>
              ) : (
                /* The wizard, not a template list (change: guided-new-game-wizard).
                   A failed template load is NOT fatal here: the wizard still offers
                   the scratch path, which needs no template at all, so a creator is
                   never stranded by a menu that would not load. */
                <NewGameWizard
                  templates={wizardTemplates}
                  busy={busy || newGameAction.busy}
                  onSubmit={(submission) => void newGameAction.run(submission)}
                  // The SAME list the composer is handed above, so the smart
                  // build's preview and the game it delivers are priced from one
                  // pool (change: smart-build-delight, D4).
                  recentBankKeys={readRecentPicks(user?.uid).recentBankKeys}
                />
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {sharing && (
        <ShareSheet
          title={d.shareTitle(sharing.title)}
          text={d.shareText(sharing.title)}
          url={`${PLAY_URL}/?game=${sharing.id}`}
          notPublic={sharing.visibility !== 'public'}
          onPublish={async () => {
            await publishGame({ gameId: sharing.id, visibility: 'public' });
            setSharing({ ...sharing, visibility: 'public' });
            void load(true);
          }}
          onClose={() => setSharing(null)}
        />
      )}

      {/* ── Delete confirmation (change: recoverable-game-deletion) ────────── */}
      {deleting && createPortal(
        <DeleteGameDialog
          game={deleting}
          busy={removeAction.isBusy(deleting.id)}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void removeAction.run(deleting)}
        />,
        document.body,
      )}
    </div>
  );
}

// Two-step, type-the-title confirmation for deleting a game.
//
// Reuses the mechanics and tone of the Settings danger zone (SettingsPage
// DangerCard) with ONE deliberate difference: the creator types the GAME'S OWN
// TITLE, not a fixed word. The incident was deleting the WRONG game, and a fixed
// word like "DELETE" reads identically on every card, so it cannot discriminate
// between two of them. The copy also states the truth that is now true: the game
// is recoverable for the whole retention window.
function DeleteGameDialog({ game, busy, onCancel, onConfirm }: {
  game: Game;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const d = t.dashboard;
  const [typed, setTyped] = useState('');
  // Escape cancels the destructive confirm — the one dialog that must never be
  // hard to back out of.
  useModalDismiss(onCancel);
  const confirmed = matchesGameDeleteConfirmation(typed, game.title);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-[--surface-0] dark:bg-[--surface-1] border border-rp-alert/30 rounded-2xl w-full max-w-md p-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-brand font-bold text-ink-alert text-lg mb-1">{d.deleteDialogTitle}</div>
        <p className="text-xs text-[--ink-2] leading-relaxed mb-1">{d.deleteDialogBody(game.title)}</p>
        <p className="text-xs text-[--ink-3] leading-relaxed mb-4">{d.deleteDialogRecoverable(GAME_TRASH_RETENTION_DAYS)}</p>

        <Label>{d.deleteDialogHint}</Label>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={game.title}
          disabled={busy}
          autoFocus
          dir="auto"
        />

        <div className="flex gap-2 mt-4">
          <Button variant="danger" disabled={!confirmed || busy} loading={busy} onClick={onConfirm}>
            {d.deleteDialogCta}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {d.deleteDialogCancel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Content-shaped loading placeholder mirroring the hero + stats + card grid, so
// the first paint has the same footprint as the loaded dashboard (no layout jump).
function DashboardSkeleton({ uid }: { uid?: string }) {
  const t = useT();
  // A creator with no games used to watch six game-card placeholders resolve
  // into an empty state. Draw only what THIS account is known to have — the
  // count is per uid, so a colleague's six games cannot size this grid.
  let known: number | null = null;
  try { known = readKnownGameCount(localStorage.getItem(knownGameCountKey(uid))); } catch { /* storage unavailable */ }
  const cards = skeletonCardCount(known);
  return (
    <div className="animate-fade-up">
      <LoadingState messages={t.dashboard.loading} className="!py-6" />
      <div className="mb-10 pb-10 border-b border-[--rp-border]">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div className="space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-12 w-64" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-8">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-2xl" />)}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[--rp-border] p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-2 mt-auto">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 flex-1" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
