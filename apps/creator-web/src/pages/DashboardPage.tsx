import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Game, ScoringPreset } from '@rushpoint/shared';
import { GAME_TRASH_RETENTION_DAYS, PAYMENTS_ENABLED, resolvePlayOrigin, CANONICAL_PLAY_URL, DEFAULT_WRONG_ANSWER_LEVEL } from '@rushpoint/shared';
import { createGame, updateGame, listGames, launchRun, deleteGame, publishGame } from '../services/calls';
import { Advanced, Badge, Button, Card, EmptyState, Input, Label, Select, Skeleton } from '../components/ui';
import { LaunchLiftoff } from '../components/LaunchLiftoff';
import { LoadingState } from '../components/LoadingState';
import { OverflowMenu } from '../components/OverflowMenu';
import { dashboardCardActions } from '../lib/dashboardCardActions';
import { matchesGameDeleteConfirmation } from '../lib/deleteConfirm';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import { ShareSheet } from '../components/ShareSheet';
import { TEMPLATES, type GameTemplate } from '../templates';
import { firstLaunchBlocker, type ReadinessIssue } from '../lib/gameReadiness';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useAuth } from '../components/AuthGate';
import { useT } from '../components/LanguageContext';
import { useLiveRuns } from '../hooks/useLiveRuns';
import { liveRunForGame } from '../lib/creatorNav';
import {
  KNOWN_GAME_COUNT_KEY, ONBOARDING_DISMISSED_KEY, PREVIEWED_STORAGE_KEY, TOUR_FIRST_GAME_KEY, firstGameIdKey,
  buildOnboardingChecklist, knownGameCountKey, readKnownGameCount, readPreviewedGames,
  skeletonCardCount,
  type OnboardingStepId,
} from '../lib/creatorOnboarding';
import {
  describeGameSettings,
  templateDescription, templateLabel,
} from '../lib/templateLabels';

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
            className="text-[11px] font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
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
                  step.done ? 'bg-rp-go/20 text-rp-go' : 'bg-[--surface-2] text-[--ink-3]'}`}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <div className="min-w-0 text-start">
                <div className="text-sm font-semibold text-[--ink-1]">{copy.title}</div>
                <p className="text-[11px] text-[--ink-3] mt-0.5 leading-relaxed">{copy.body}</p>
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
  // The template the creator selected but has not confirmed yet — the moment the
  // play mode and scoring style are DISCLOSED instead of silently assigned.
  const [chosen, setChosen] = useState<GameTemplate | null>(null);
  const [chosenPreset, setChosenPreset] = useState<ScoringPreset>('smart_weighted');
  // Scoring is an easy-wizard default: Create proceeds on the template's own
  // preset unless the creator opens this disclosure to change it.
  const [showScoring, setShowScoring] = useState(false);
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

  // Double-click / re-entrancy guards (change: wave-b/async-action-guard). A
  // `useState` busy flag can't stop a second click in the SAME React batch —
  // setState is async, so both clicks read busy === false and both fire the
  // callable. These hold for the whole duration of the promise instead.
  // launch/publish/delete are keyed by game id so acting on one card never
  // blocks another.
  const newGameAction = useAsyncAction<[GameTemplate, ScoringPreset?], void>(newGame);
  const launchAction = useAsyncAction<[Game, { testDrive?: boolean }?], void>(launch, (g) => g.id);
  const publishAction = useAsyncAction(togglePublish, (g: Game) => g.id);
  const removeAction = useAsyncAction(remove, (g: Game) => g.id);
  const busy = newGameAction.busy || launchAction.busy;

  async function load(invalidate = false) {
    if (!invalidate && readGamesCache(user?.uid)) return;
    try {
      const { games } = await listGames();
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
      await dialog.alert(d.loadGamesFailed);
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

  async function newGame(tpl: GameTemplate, preset: ScoringPreset = tpl.scoringPreset) {
    setPicking(false);
    setChosen(null);
    // The title follows the interface language now that the name is translated.
    const title = tpl.key === 'blank' ? d.untitledGame : templateLabel(tpl.key, t);
    // Tracks the doc created by createGame so a FAILURE in the follow-up seeding
    // step can clean up the orphan. Undefined while createGame itself is still
    // in flight, so the catch never deletes a game that was never created.
    let createdGameId: string | undefined;
    try {
      const { gameId } = await createGame({ title, mode: tpl.mode, tags: [] });
      createdGameId = gameId;
      const stages = tpl.build().map((s, i) => ({ ...s, order: i }));
      // Same callable, same fields — but with the scoring style the creator saw
      // and could change, rather than one assigned invisibly.
      // Wrong-answer cost (change: wrong-answer-cost): NEW games are seeded at the
      // default level so brute forcing a quiz is no longer free. It is written
      // explicitly (never inferred from an absent field) so the Builder's selector
      // shows the creator what they got, and so no PRE-EXISTING game is ever
      // changed underneath a live run.
      await updateGame({
        gameId, stages, scoringPreset: preset,
        scoringOptions: { wrongAnswerPenalty: DEFAULT_WRONG_ANSWER_LEVEL },
      });
      // Invalidate the games cache — otherwise returning to the dashboard within
      // the TTL serves a stale list that's missing this just-created game.
      _gamesCache = null;
      nav(`/build/${gameId}`);
    } catch (e) {
      // The picker closes FIRST, so a failure here used to leave the creator on
      // an unchanged dashboard with no game, no navigation and no error at all
      // (change: play-no-silent-failures). Re-open the picker so the choice the
      // creator already made is not lost.
      console.error('[dashboard] create from template failed:', e);
      // If createGame SUCCEEDED but the seeding updateGame threw, the empty game
      // doc is already on the dashboard and every retry would add another. Soft-
      // delete (tombstone) the orphan before re-opening the picker. Best-effort:
      // a cleanup failure must not mask the original template-failed error.
      if (createdGameId) {
        try {
          await deleteGame({ gameId: createdGameId });
          _gamesCache = null;
        } catch (cleanupErr) {
          console.error('[dashboard] failed to clean up orphaned game:', cleanupErr);
        }
      }
      await dialog.alert(d.templateFailed);
      setPicking(true);
      setChosen(tpl);
      setChosenPreset(preset);
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
    const blocker = firstLaunchBlocker(g);
    if (blocker) {
      await dialog.alert(launchBlockedMessage(blocker));
      return;
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
            <Button
              disabled={busy}
              onClick={() => setPicking(true)}
              data-tour="new-game"
              className="!px-6 !py-2.5 !text-sm flex items-center gap-2"
            >
              {d.newGame}
            </Button>
            {/* Recently deleted (change: recoverable-game-deletion). A rarely
                opened recovery surface, so it lives here rather than competing
                with Build/Gallery/Wallet in the top nav. */}
            <button
              onClick={() => nav('/trash')}
              className="text-[11px] font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
            >
              {d.trashLink}
            </button>
          </div>
        </div>

        {/* Stats row */}
        {games.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-8">
            {[
              { label: d.statGamesBuilt, value: games.length, icon: '🗺️', tint: 'from-rp-fire/12 to-rp-amber/5', ring: 'group-hover:border-rp-fire/30' },
              { label: d.statPublished, value: games.filter(g => g.visibility === 'public').length, icon: '🌐', tint: 'from-rp-plasma/12 to-rp-plasma/5', ring: 'group-hover:border-rp-plasma/30' },
              { label: d.statTotalPlays, value: games.reduce((s, g) => s + (g.playCount ?? 0), 0), icon: '🏁', tint: 'from-rp-signal/12 to-rp-signal/5', ring: 'group-hover:border-rp-signal/30' },
            ].map((s) => (
              <div key={s.label}
                className={`group relative overflow-hidden rounded-2xl border border-[--rp-border] bg-[--surface-0]/80 dark:bg-white/[0.03] backdrop-blur-sm px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 ${s.ring}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${s.tint} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className="relative flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-[--surface-2] shrink-0">{s.icon}</div>
                  <div className="min-w-0">
                    <div className="font-brand text-2xl font-extrabold text-[--ink-1] leading-none tabular-nums">{s.value}</div>
                    <div className="text-[11px] text-[--ink-3] mt-1 font-medium truncate">{s.label}</div>
                  </div>
                </div>
              </div>
            ))}
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
                          <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[--surface-2] text-[--ink-3] text-[10px] font-medium">
                            {TASK_TYPE_EMOJI[type] ?? '●'} {TASK_TYPE_LABEL[type] ?? type}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-[--ink-3] font-medium">
                      <span>{d.cardStages(g.stages.length)}</span>
                      <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                      <span>{d.cardTasks(taskCount)}</span>
                      <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                      <span>{d.cardPlays(g.playCount ?? 0)}</span>
                    </div>

                    {live && (
                      <button
                        onClick={() => nav(`/run/${live.gameId}/${live.runId}`)}
                        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rp-alert bg-rp-alert/10 hover:bg-rp-alert/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-alert/40"
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
                          const items: Record<'testRun' | 'publish' | 'unpublish' | 'share' | 'delete', {
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
                              className={`w-full justify-start text-start min-h-[36px] px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                                item.destructive
                                  ? 'text-rp-alert/80 hover:text-rp-alert hover:bg-rp-alert/8 focus-visible:ring-rp-alert/40'
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
              <div className="font-brand font-bold text-sm text-[--ink-2] group-hover:text-rp-fire transition-colors">{d.newAdventureLabel}</div>
              <div className="text-[11px] text-[--ink-3] mt-0.5">{d.newAdventureSub}</div>
            </div>
          </button>
        </div>
      )}

      {/* ── Template picker modal ─────────────────────────────────────────── */}
      {picking && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setPicking(false); setChosen(null); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative glass-card grad-border bg-[--surface-0] dark:bg-[--surface-1]/80 border border-[--rp-border] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — fixed; never scrolls away. */}
            <div className="flex items-start justify-between gap-4 p-5 pb-4 shrink-0 border-b border-[--rp-border]">
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
            <div className="overflow-y-auto p-5 pt-4">
              <div className="grid sm:grid-cols-2 gap-2.5">
                {TEMPLATES.map((tpl) => {
                  const selected = chosen?.key === tpl.key;
                  // Preview what the card yields. `build()` is pure; called once per
                  // card render just to count its stages and tasks.
                  const built = tpl.build();
                  const tplTasks = built.reduce((sum, st) => sum + st.tasks.length, 0);
                  return (
                  <button key={tpl.key} disabled={busy}
                    onClick={() => { setChosen(tpl); setChosenPreset(tpl.scoringPreset); }}
                    aria-pressed={selected}
                    className={`flex items-start gap-3 text-start rounded-xl border bg-[--surface-1] dark:bg-[--surface-2]/50 p-3 hover:border-rp-fire/40 hover:bg-rp-fire/5 dark:hover:bg-rp-fire/8 transition-all duration-150 disabled:opacity-40 group ${
                      selected ? 'border-rp-fire bg-rp-fire/5' : 'border-[--rp-border]'}`}>
                    <div className="text-2xl leading-none shrink-0 mt-0.5">{tpl.emoji}</div>
                    <div className="min-w-0">
                      <div className="font-brand font-semibold text-[--ink-1] text-sm group-hover:text-rp-fire transition-colors">{templateLabel(tpl.key, t)}</div>
                      <div className="text-[11px] text-[--ink-3] mt-0.5 leading-relaxed line-clamp-2">{templateDescription(tpl.key, t)}</div>
                      <div className="text-[10px] text-[--ink-3] mt-1 font-medium tabular-nums">{d.templateMeta(built.length, tplTasks)}</div>
                    </div>
                  </button>
                  );
                })}
              </div>

              {/* Nothing that shapes the game is assigned invisibly: the play mode
                  and the scoring style are stated here, and the scoring style can
                  be changed BEFORE the game is created. */}
              {chosen && (
                <div ref={chosenPanelRef} className="mt-4 rounded-xl border border-[--rp-border] bg-[--surface-1] dark:bg-[--surface-2]/40 p-4">
                  <p className="text-[11px] text-[--ink-3] mb-3">{d.settingsIntro}</p>
                  <div className="mb-3">
                    <Label>{d.modeLabel}</Label>
                    <p className="text-sm text-[--ink-2]">{describeGameSettings(chosen.mode, chosenPreset, t).mode}</p>
                  </div>
                  {/* The template sets a sensible scoring preset; Create uses it as
                      is. Scoring only surfaces on demand, with its one-line
                      description — no unexplained decision before the game exists. */}
                  <Advanced
                    dense
                    title={d.changeScoring}
                    meta={b.presetLabels[chosenPreset].name}
                    open={showScoring}
                    onToggle={() => setShowScoring((v) => !v)}
                  >
                    <Label>{d.scoringLabel}</Label>
                    <Select value={chosenPreset} onChange={(e) => setChosenPreset(e.target.value as ScoringPreset)}>
                      <option value="time_only">{d.scoringTimeOnly}</option>
                      <option value="fixed_points_speed">{d.scoringFixedPointsSpeed}</option>
                      <option value="smart_weighted">{d.scoringSmartWeighted}</option>
                    </Select>
                    <p className="text-[11px] text-[--ink-3] leading-relaxed">{b.presetLabels[chosenPreset].desc}</p>
                  </Advanced>
                  <Button
                    className="mt-4 w-full"
                    disabled={busy}
                    loading={newGameAction.busy}
                    onClick={() => void newGameAction.run(chosen, chosenPreset)}
                  >
                    {d.createFromTemplate}
                  </Button>
                </div>
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
  const confirmed = matchesGameDeleteConfirmation(typed, game.title);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-[--surface-0] dark:bg-[--surface-1] border border-rp-alert/30 rounded-2xl w-full max-w-md p-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-brand font-bold text-rp-alert text-lg mb-1">{d.deleteDialogTitle}</div>
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
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-8">
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
