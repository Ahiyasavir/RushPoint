import { Suspense, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { FIRESTORE_PATHS, computeStreak, beatHasContent, localizedBeatBody, gameInstructionsHasContent, localizedInstructionsBody, isUnlocked, chatSeenMarker, countUnreadChatMessages, type ChatMessage, type Trackable, type CaptureZone, type RunStageRecord, type GameInstructions, CANONICAL_CREATOR_URL } from '@rushpoint/shared';
import { getMyTeamState, triggerSOS, updateLocation, reportArrival, getRunTrackables, pickUpTrackable, dropTrackable, getRunZones, captureZone, type MyTeamState, type StageNarrative } from '../services/calls';
import { shouldSendPing } from '../lib/pingGate';
import { db, ensureAuth, uid } from '../services/firebase';
import { clearSession, loadChatSeen, saveChatSeen, type Session } from '../store';
import { useWakeLock } from '../hooks/useWakeLock';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { syncErrorVerdict } from '../lib/syncError';
// Why a not-yet-started team is not started (change: held-team-visibility).
import { heldNotice } from '../lib/holdNotice';
// Which sealed hidden missions may be drawn as a search circle
// (change: hidden-mission-search-area).
import { selectSearchAreas } from '../lib/searchAreas';
// Whether to run GPS and draw the map at all. Extracted from this file so the
// decision is unit-testable — it had silently latched ON for every game; see
// lib/locationRelevance.ts (change: locationless-fail-safe-vs-task-gating).
import { computeLocationRelevant } from '../lib/locationRelevance';
import { Button, Progress, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { dialog } from '../components/dialog';
import TaskRunner from '../components/TaskRunner';
import { LoadingView } from '../components/LoadingView';
import TeamDevicesPanel from '../components/TeamDevicesPanel';
import InRunAlerts from '../components/InRunAlerts';
// Shared top overlay stack (change: play-top-overlay-stack) — see components/TopOverlays.tsx.
import { TopOverlay } from '../components/TopOverlays';
import type { NavTarget } from '../components/NavMap';
import { lazyWithRetry } from '../lib/lazyWithRetry';
// Lazy-loaded so the heavy MapLibre bundle isn't in the initial download — the
// join screen doesn't need it; it loads when the participant starts racing.
// lazyWithRetry so a stale-shell chunk 404 after a redeploy self-heals instead of
// hanging the map on a spinner for a mid-game player (wave-g robustness #2).
const NavMap = lazyWithRetry('navmap', () => import('../components/NavMap'));
// Live photo feed (live-photo-feed): lazy so the feed chunk loads on first open.
const FeedPanel = lazyWithRetry('feed', () => import('../components/FeedPanel'));
// Team ↔ HQ chat (team-hq-chat): lazy so the chat chunk + listener load on first open.
const ChatPanel = lazyWithRetry('chat', () => import('../components/ChatPanel'));
import LiveOps, { LeaderboardPeek } from '../components/LiveOps';
// Which secondary panels exist right now, and which opens first — pure, so the
// "an empty feature must not become an empty tab" rule is testable.
import { planMoreDrawer, type DrawerTabId } from '../lib/moreDrawer';
import FinalScreen from './FinalScreen';
import { formatDuration } from '../lib/boardTime';
import { feedback, feedbackIfQuiet, isRankUp } from '../lib/sound';
import { missionProgress, type MissionProgress } from '../lib/missionProgress';
import { crossedMilestone, type Milestone } from '../lib/milestones';

// Creator app — viral CTA baked into every shared progress card.
const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? CANONICAL_CREATOR_URL);


export default function PlayScreen({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const { t, lang } = useT();
  const [state, setState] = useState<MyTeamState | null>(null);
  const [err, setErr] = useState<'' | 'game-gone' | 'sync-failed'>('');
  // Offline continuity (change: fix-play-offline-continuity): a transient poll
  // failure keeps the last state on screen and flips `reconnecting` (a subtle,
  // non-blocking pill) instead of blanking to the error screen. `hasState` lets the
  // error handler know we already have something worth keeping without adding
  // `state` to refresh()'s deps (which would tear down the poll effect each poll).
  const [reconnecting, setReconnecting] = useState(false);
  const hasState = useRef(false);
  // First-load retry grace (change: fix-play-first-load-retry-grace): count
  // consecutive FIRST-load failures so a single transient tunnel blip degrades to
  // the branded loader + auto-retry instead of the hard "sync failed" screen. Reset
  // on any success and by the manual "try again" button.
  const firstLoadFails = useRef(0);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const timer = useRef<number>();
  // Territory zones (change: fix-territory-map-visibility): fetched once here so the
  // SAME list feeds both the NavMap circles and the ZonesPanel list, and both
  // refresh together after a capture.
  const [zones, setZones] = useState<CaptureZone[]>([]);
  // Trackables are lifted here for the same reason zones already were
  // (change: play-card-simplification): the "more" drawer must know whether this
  // run HAS collectibles before it offers a tab for them. A tab that opens onto an
  // empty panel is exactly the clutter the drawer exists to remove.
  const [trackables, setTrackables] = useState<Trackable[]>([]);
  // Power-ups (change: power-ups): a transient award toast fired when the team's
  // powerUps.log grows across polls (ref-compared), for both award types.
  const [powerUpToast, setPowerUpToast] = useState<'double_points' | 'bonus_points' | null>(null);
  const powerUpLogLen = useRef<number | null>(null);
  // Audio/haptic cue baselines (change: audio-haptic-feedback) — ref-compared
  // across polls, like the power-up toast. null/undefined = not yet observed, so a
  // mid-run reload records the baseline instead of replaying past events.
  const taskDoneCount = useRef<number | null>(null);
  const stageDoneCount = useRef<number | null>(null);
  const lastRank = useRef<number | undefined>(undefined);
  // Milestone beats (change: test-mode-game-feel). A sealed run has no score, no
  // streak and no board, so these are the only mid-run acknowledgement a player
  // gets — and they are legitimate in test mode precisely because they measure
  // persistence, identically for a player getting everything right and everything
  // wrong. Ref-compared across polls like the cue baselines above: the first
  // observation only records where the player already is, so a mid-run reload
  // replays nothing.
  const milestoneDone = useRef<number | null>(null);
  // Named `beat`, not `milestone` — computeStreak already owns that name below.
  const [beat, setBeat] = useState<Milestone | null>(null);
  // Whether the team is currently launched/active — read by the geolocation
  // watcher (which mounts once) to decide if it should ping the live map.
  const activeRef = useRef(false);
  // Chat unread, lifted so the CLOSED drawer can badge it. Declared with the other
  // hooks at the top — never below an early return, which is the hooks-order
  // mistake that crashed TaskRunner in production (CLAUDE.md, rules-of-hooks).
  // `session.teamId` is stable for the life of this screen.
  const [viewingTab, setViewingTab] = useState<DrawerTabId | null>(null);
  const { unreadCount: chatUnread } = useTeamChat(session, session.teamId ?? uid() ?? '', viewingTab === 'chat');
  // Shared team devices: only the CONTROLLING phone pings the live map, so the
  // team's pin follows whoever is actually playing instead of flickering.
  const controllerRef = useRef(true);
  // The last fix this device actually SENT (position + time), not merely the last time we
  // tried. `shouldSendPing` needs the position to judge whether the team has really moved;
  // a bare timestamp could only ever express a fixed throttle (change: participant-read-budget).
  const lastPing = useRef<{ lat: number; lng: number; atMs: number } | null>(null);
  // play-task-gating: the id of the team's assigned hidden-location task that is
  // still SEALED (awaiting a server-confirmed arrival), or null. Read by the
  // geolocation watcher (which mounts once) so it can probe reportArrival on the
  // same tick it already has a fix — no extra GPS work, no hot-path server write
  // for teams with nothing sealed.
  const pendingArrivalRef = useRef<string | null>(null);
  const lastArrivalProbe = useRef(0);
  // Latch for the location verdict above. A ref, not state: it must never itself
  // trigger a render, and it is read during render right after it is written.
  const everLocationRelevant = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await getMyTeamState({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId });
      setState(s); hasState.current = true; setErr(''); setReconnecting(false);
      firstLoadFails.current = 0;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // A transient blip → keep the game on screen (or the branded loader on first
      // load) and auto-retry via `reconnecting`; only a fatal code, a deleted run,
      // or a first load that has missed FIRST_LOAD_MAX_FAILS times shows a hard
      // screen. Never surface a raw English server message to a Hebrew-default
      // participant — map to the localized gameGone / syncFailed copy.
      if (!hasState.current) firstLoadFails.current += 1;
      const verdict = syncErrorVerdict(code, hasState.current, firstLoadFails.current);
      if (verdict === 'reconnect') {
        setReconnecting(true);
      } else {
        setReconnecting(false);
        // Store the verdict KIND, not the localized string, so refresh() no longer
        // closes over `t` — a mid-run language toggle otherwise changes refresh()'s
        // identity and tears down the live team listener + restarts the 12s poll.
        // The copy is localized at render time, so a toggle while this error shows
        // still switches the message.
        setErr(verdict === 'game-gone' ? 'game-gone' : 'sync-failed');
      }
    }
  }, [session]);

  const reloadZones = useCallback(async () => {
    try {
      const r = await getRunZones({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId });
      setZones(r.zones);
    } catch { /* zones are best-effort; keep the last list */ }
  }, [session]);
  useEffect(() => { void reloadZones(); }, [reloadZones]);

  const reloadTrackables = useCallback(async () => {
    try {
      const r = await getRunTrackables({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId });
      setTrackables(r.trackables);
    } catch { /* best-effort, exactly as before; keep the last list */ }
  }, [session]);
  useEffect(() => { void reloadTrackables(); }, [reloadTrackables]);

  useEffect(() => {
    let alive = true;
    let unsubDoc: (() => void) | undefined;

    void refresh(); // immediate first paint

    // Live trigger: our own team doc changes when the host starts the race,
    // routing assigns a task, our score moves, or we finish. Reacting to the
    // snapshot makes those feel instant instead of waiting for the next poll.
    // The snapshot is only a trigger — we still fetch the server-sanitized
    // state via getMyTeamState so answer keys never reach the client.
    void ensureAuth().then(() => {
      if (!alive) return;
      // Shared team devices: an attached viewer phone's uid is NOT the team id —
      // the session carries the real teamId (legacy sessions fall back to uid).
      const teamId = session.teamId ?? uid();
      if (!teamId) return;
      const ref = doc(db, FIRESTORE_PATHS.team(session.ownerUid, session.gameId, session.runId, teamId));
      unsubDoc = onSnapshot(ref, () => { void refresh(); }, () => undefined);
    }).catch(() => undefined);
    // ensureAuth() deliberately rejects (and clears its cached promise) on a
    // transient first-auth failure, so a reload on flaky signal would otherwise throw
    // an unhandled promise rejection and skip attaching the listener for this mount.
    // Swallow it — the 12s fallback poll below still recovers gameplay state.

    // Slow fallback poll keeps the leaderboard fresh (it arrives via the callable, not our
    // team doc) and recovers if the listener can't attach. Gameplay state does NOT depend on
    // it — the onSnapshot listener above refreshes on every change to our own team document.
    //
    // 60s, not 12s (changes: participant-read-budget, then hot-path-read-cost).
    //
    // getMyTeamState costs ~1.54 Firestore reads per call measured under real production load.
    // At the original 12s that is 375 calls x 120 teams = ~69,000 reads for ONE 75-minute run,
    // against a Spark ceiling of 50,000 READS PER DAY — the fallback poll alone exceeded the
    // whole day's budget. 45s brought it to ~18,500; 60s brings it to ~13,900.
    //
    // The extra step to 60s is not fine-tuning: the first budget was built from per-call costs
    // measured in a COMPRESSED simulation, which understates anything wall-clock-throttled.
    // Re-measured at real time-scale the run needed roughly another 5,000 reads of headroom.
    //
    // Gameplay does not wait for this. The onSnapshot listener above refreshes on every change
    // to this team's own document; the interval exists for the leaderboard and to recover a
    // listener that never attached. If you shorten it, do the arithmetic for the largest run
    // you intend to support and check it against the ceiling — this is a cost decision.
    timer.current = window.setInterval(() => { void refresh(); }, 60_000);

    return () => {
      alive = false;
      unsubDoc?.();
      window.clearInterval(timer.current);
    };
  }, [refresh, session]);

  // Offline continuity: resume the instant the browser reports it's back online
  // (don't wait up to 12s for the fallback poll). We deliberately do NOT flip
  // `reconnecting` on the `offline` event — the globally-mounted ConnectionBanner
  // already owns the offline message, and stacking both produced two overlapping
  // fixed top banners. The ReconnectingPill is reserved for the "online but a
  // poll/sync is failing" case, still driven by refresh() below.
  useEffect(() => {
    const onOnline = () => { void refresh(); };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  // While reconnecting, retry on a short interval so recovery doesn't wait for the
  // slow fallback poll. Stops as soon as a refresh succeeds (clears reconnecting).
  useEffect(() => {
    if (!reconnecting) return;
    const id = window.setInterval(() => { void refresh(); }, 3_000);
    return () => window.clearInterval(id);
  }, [reconnecting, refresh]);

  // Is location relevant for this render? Drives BOTH the GPS watcher (below) and
  // the map block. A boolean, so the watcher effect only re-mounts when the value
  // actually flips (not on every poll). When a later located stage flips it true,
  // the watcher starts THEN — so an all-locationless demo never prompts for GPS.
  // Sticky: a game does not shed its places mid-run, and re-judging each render
  // would make the map vanish and return in the gap between two missions — a
  // ~224px layout jump twice per mission. See lib/locationRelevance.ts.
  // The latch is deliberately NOT the same value as the verdict: the pre-payload
  // TRUE is a safe default, not an observation, and latching it would pin every
  // game ON from its first render. See lib/locationRelevance.ts.
  const locationVerdict = computeLocationRelevant(state, zones, everLocationRelevant.current);
  const locationRelevant = locationVerdict.relevant;
  everLocationRelevant.current = locationVerdict.latch;

  // Track the participant's live position for the navigation map, and report it
  // to the host's live team map (throttled to once per ~20s, only while active).
  useEffect(() => {
    // Locationless-only render: no map, no live ping, no arrival probe — and,
    // crucially, no browser location prompt. When location becomes relevant this
    // effect re-runs (locationRelevant is a dep) and the watcher starts then.
    if (!locationRelevant) return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        setMe({ lat, lng });
        const now = Date.now();
        // change: participant-read-budget. A flat 20s throttle spent a callable — and a
        // Firestore read, measured at 1.00/call in production — on fixes the server was
        // going to discard anyway. `shouldSendPing` applies the SAME verdict the server
        // uses (so the two cannot drift about what "moved" means) plus a hard silence
        // floor, because the safe-zone check only runs when a ping arrives. A walking
        // team still reports ~76 times per 75-minute run; a stationary one stops paying
        // for fixes nobody writes.
        const accuracyMeters = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : undefined;
        const gate = shouldSendPing({
          fix: { lat, lng, accuracyMeters },
          lastSent: lastPing.current,
          nowMs: now,
        });
        if (activeRef.current && controllerRef.current && gate.send) {
          lastPing.current = { lat, lng, atMs: now };
          // Send the fix's own error radius (change: out-of-bounds-recovery) so the
          // server's safe-zone verdict can tell "50 m outside, ±5 m" from "50 m
          // outside, ±300 m". Purely a report — the decision stays server-side.
          updateLocation({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId, lat, lng, accuracyMeters })
            .catch(() => undefined);
        }
        // play-task-gating: while the assigned task is a still-sealed hidden
        // location, ask the server (throttled, controller-only) whether we have
        // arrived. The server latches the verdict, so a single success is
        // permanent — we stop probing as soon as the refreshed state clears
        // `arrivalPending`. A failure is silent: the manual button is the
        // fallback and the next tick retries anyway.
        const sealedId = pendingArrivalRef.current;
        if (activeRef.current && controllerRef.current && sealedId && now - lastArrivalProbe.current >= 15_000) {
          lastArrivalProbe.current = now;
          reportArrival({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId, taskId: sealedId, lat, lng })
            .then((r) => { if (r.arrived) { pendingArrivalRef.current = null; void refresh(); } })
            .catch(() => undefined);
        }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [session, refresh, locationRelevant]);

  // Keep the screen awake while actively racing (map open, navigating).
  useWakeLock(!!state && state.team.launched && state.team.status !== 'finished');

  // Power-ups: fire a toast when the log grows. The FIRST observation only records
  // the baseline length (so a mid-run reload doesn't replay every past award).
  useEffect(() => {
    const log = state?.team.powerUps?.log ?? [];
    if (powerUpLogLen.current === null) { powerUpLogLen.current = log.length; return; }
    if (log.length > powerUpLogLen.current) {
      const latest = log[log.length - 1];
      if (latest?.type) setPowerUpToast(latest.type);
    }
    powerUpLogLen.current = log.length;
  }, [state?.team.powerUps?.log]);

  // Auto-hide the toast ~4s after it appears. Keyed on the toast value itself, NOT
  // on the team state — the detection effect above re-runs on every poll/snapshot
  // (powerUps.log is a fresh array reference each fetch), so scheduling the timeout
  // there let a refresh arriving inside the 4s window run that effect's cleanup and
  // clear the pending timer, leaving the toast stuck on screen forever.
  useEffect(() => {
    if (!powerUpToast) return;
    const id = window.setTimeout(() => setPowerUpToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [powerUpToast]);

  // Task-complete cue: fire when the total count of completed tasks grows across
  // polls. Counting the server-confirmed 'completed' status (not the callable
  // return) covers every task type from one place AND correctly stays silent for a
  // photo/audio submission that is still pending staff review (not yet completed).
  useEffect(() => {
    const done = state?.team.stages.reduce(
      (n, s) => n + s.tasks.filter((tk) => tk.status === 'completed').length, 0) ?? 0;
    if (taskDoneCount.current === null) { taskDoneCount.current = done; return; }
    // BACKSTOP only. The submit handlers in TaskRunner cue the moment the server
    // answers; this poll sees the same completion again one refresh later, which
    // in a question-after-question run means two blips per answer. `feedbackIfQuiet`
    // swallows the echo and still cues a completion this device did not submit —
    // a staff photo approval, a geofence auto check-in (change: test-mode-game-feel).
    if (done > taskDoneCount.current) feedbackIfQuiet('task');
    taskDoneCount.current = done;
  }, [state?.team.stages]);

  // Stage-complete cue: fire when the count of completed stages grows across polls.
  // First observation only records the baseline (a reload mid-run doesn't replay).
  useEffect(() => {
    const done = state?.team.stages.filter((s) => s.status === 'completed').length ?? 0;
    if (stageDoneCount.current === null) { stageDoneCount.current = done; return; }
    if (done > stageDoneCount.current) feedback('stage');
    stageDoneCount.current = done;
  }, [state?.team.stages]);

  // Rank-up cue: fire only when our leaderboard rank strictly improves. Rank is
  // present only once the board carries our team; undefined ranks never cue.
  useEffect(() => {
    const board = state?.run.leaderboard;
    const teamId = state?.team.id;
    const rank = board?.rankings.find((r) => r.teamId === teamId)?.rank;
    if (isRankUp(lastRank.current, rank)) feedback('rankUp');
    lastRank.current = rank;
  }, [state?.run.leaderboard, state?.team.id]);

  // Milestone banner: fires when the mission counter crosses a threshold. One
  // banner per crossing even when a partial stage auto-skips several siblings at
  // once, and never at the finish — that celebration belongs to FinalScreen.
  useEffect(() => {
    const { done, total } = missionProgress(state?.team.stages);
    const prev = milestoneDone.current;
    milestoneDone.current = done;
    if (prev === null) return;
    const hit = crossedMilestone(prev, done, total);
    if (hit) setBeat(hit);
  }, [state?.team.stages]);

  // The dismiss timer is keyed on the banner itself, NOT on the effect above.
  // Hung off that effect it was cancelled by its cleanup on the very next poll —
  // a few seconds later, with no crossing to arm a replacement — and the banner
  // then sat on screen for the rest of the run.
  useEffect(() => {
    if (!beat) return;
    const id = window.setTimeout(() => setBeat(null), 3_000);
    return () => window.clearTimeout(id);
  }, [beat]);

  async function leave() {
    // A finished run has nothing left to lose, so skip the "are you sure" prompt
    // (this is the demo-finish exit path via FinalScreen). Mid-run still confirms.
    if (state?.team.status === 'finished') { clearSession(); onLeave(); return; }
    if (await dialog.confirm(t.play.leaveConfirm)) { clearSession(); onLeave(); }
  }

  async function sos() {
    if (!(await dialog.confirm(t.play.sosConfirm, { confirmLabel: t.play.sosSend, danger: true }))) return;
    // Resolve a best-effort location first, THEN actually send — and only confirm
    // "sent" once triggerSOS resolves. Reporting success before the call (or
    // ignoring its failure) on a SAFETY feature could leave a team in trouble
    // believing help is coming when the alert never reached the host.
    const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { timeout: 8000 },
      );
    });
    try {
      await triggerSOS({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId, ...(coords ?? {}) });
      feedback('alert');
      await dialog.alert(t.play.sosSent);
    } catch {
      await dialog.alert(t.play.sosFailed);
    }
  }

  // Mid-race brag card — same branded story image as the finish screen, but with
  // a "we're racing / we're #N" headline. Every share carries the build-your-own
  // CTA, so an in-progress flex doubles as marketing for the creator app.
  async function shareProgress() {
    if (!state) return;
    {
      const { team, game } = state;
      const name = game.branding?.name ?? game.title;
      const done = team.stages.filter((s) => s.status === 'completed').length;
      const board = state.run.leaderboard;
      const rank = board?.published ? board.rankings.find((r) => r.teamId === team.id)?.rank : undefined;
      const headline = rank === 1 ? t.play.headlineFirst : rank && rank <= 3 ? t.play.headlineClimbing({ rank }) : t.play.headlineTrail;
      const text = t.play.shareText({
        team: team.displayName,
        game: name,
        rankPart: rank ? t.play.shareRankPart({ rank }) : '',
        score: team.score,
        url: CREATOR_URL.replace(/^https?:\/\//, ''),
      });
      const { shareStoryCard } = await import('../lib/storyCard');
      await shareStoryCard({
        gameName: name,
        teamName: team.displayName,
        score: team.score,
        rank,
        stagesDone: `${done}/${team.stages.length}`,
        ctaUrl: CREATOR_URL,
        headline,
        scoreLabel: t.play.pointsSoFar,
      }, text);
    }
  }

  // In-flight guards (change: wave-b/async-action-guard). SOS was completely
  // unguarded — a panicked double tap fired triggerSOS twice and stacked two
  // confirm dialogs on a SAFETY feature. shareProgress re-entrancy would kick off
  // two canvas renders + two native share sheets.
  const sosAction = useAsyncAction(sos);
  const shareAction = useAsyncAction(shareProgress);
  const sharing = shareAction.busy;

  // A FATAL sync verdict (run deleted/finalized, or the team pruned → "Team not
  // found") must surface even AFTER the first successful load — otherwise a run
  // that ends mid-game froze the player on a stale board with no message and no
  // way out, because this recovery card used to live only inside the `!state`
  // first-load branch below. `err` is set ONLY for fatal verdicts (a transient
  // blip flips `reconnecting`, never `err` — see refresh()), so rendering the
  // recovery card whenever `err !== ''` is safe and never pre-empts the
  // ReconnectingPill. Copy is localized here at render time so a language toggle
  // while it shows still switches the message.
  if (err) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <div className="text-4xl">⚠️</div>
          <p className="text-danger text-sm">{err === 'game-gone' ? t.play.gameGone : t.play.syncFailed}</p>
          <div className="flex gap-2 mt-1">
            <Button variant="ghost" onClick={() => { firstLoadFails.current = 0; setErr(''); setReconnecting(true); void refresh(); }}>{t.common.tryAgain}</Button>
            <Button variant="ghost" onClick={() => { clearSession(); onLeave(); }}>{t.play.leave}</Button>
          </div>
        </div>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <LoadingView messages={[t.play.loadingWarm, t.play.loadingGame, t.play.syncingProgress, t.play.almostReady]} />
        </div>
      </Screen>
    );
  }

  const { team, game } = state;
  // Ping the live map only while the team is launched and still racing.
  activeRef.current = team.launched && team.status !== 'finished';
  // Role is DERIVED live from the team doc (never persisted): a transfer flips
  // every phone's UI on the next snapshot. Legacy docs: founding uid controls.
  const myUid = uid();
  const isController = (team.controllerUid ?? team.id) === myUid;
  controllerRef.current = isController;
  // play-task-gating: which assigned task (if any) is a hidden location the
  // server has not unsealed yet. `arrivalPending` is server-set, so this can
  // never disagree with what the payload actually contains.
  pendingArrivalRef.current =
    state.activeStageTasks.find((c) => c.arrivalPending)?.id ?? null;
  const controllerName = team.devices?.find((d) => d.uid === (team.controllerUid ?? team.id))?.name
    ?? t.devices.deviceFallbackName;
  const hasTeammateDevices = (team.deviceUids?.length ?? 1) > 1 || game.mode === 'team';
  const accent = game.branding?.primaryColor ?? '#F97316';
  // Progress is counted in MISSIONS, not stages (change: test-mode-game-feel). A
  // 24-question assessment is authored as ONE stage, so the stage count drew a
  // single empty segment that never moved until the run ended — twenty answers with
  // no way to tell question 3 from question 17. `missionProgress` is also what makes
  // the "mission 8 of 20" counter honest, which incidentally fixes the OTHER half of
  // that complaint: adaptive routing hands missions out in fit order, so their
  // TITLES jump around; a position in the player's own run never does.
  const progress = missionProgress(team.stages);

  if (team.status === 'finished') {
    return <FinalScreen state={state} session={session} onLeave={leave} />;
  }

  if (!team.launched) {
    // Held-team visibility (change: held-team-visibility). The server holds back
    // any team it will not start (today: guardian consent) WITHOUT writing to it,
    // so this branch used to tell a held team the host had not started yet, which
    // for them is false and never resolves. `heldNotice` is total: an unknown
    // reason still produces a card, and a missing one claims no hold at all.
    //
    // Read-only. The only affordance is the SOS/host route already on this screen
    // — nothing here can grant, request or bypass the hold. The server releases
    // teams, via the organizer's start path, or nothing does.
    const hold = heldNotice({ launched: team.launched, holdReason: state.holdReason });
    return (
      <Screen>
        <ReconnectingPill show={reconnecting} text={t.play.reconnecting} />
        <Header game={game} score={team.score} accent={accent} onLeave={leave}
          timeOnly={game.scoringPreset === 'time_only'} startedAt={team.startedAt} />
        <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id} lang={lang} timeOnly={game.scoringPreset === 'time_only'} showBoard={game.testMode !== true} />
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <div className="text-5xl">{hold.held ? '🙋' : '⏳'}</div>
          <h2 dir="auto" className="text-xl font-bold">{t.play.youreIn({ name: team.displayName })}</h2>
          {hold.held ? (
            <div className="w-full max-w-sm rounded-xl bg-app-raised border border-rp-amber/40 px-4 py-3 text-start space-y-1.5">
              <p className="text-sm font-bold text-ink-amber">{t.play.heldTitle}</p>
              <p className="text-sm text-zinc-400">
                {hold.kind === 'guardian_consent' ? t.play.heldConsent : t.play.heldGeneric}
              </p>
              <p className="text-sm text-zinc-400">{t.play.heldAskHost}</p>
            </div>
          ) : (
            <p className="text-zinc-500">{t.play.waitingStart}</p>
          )}
          <HowToPlayCard instructions={game.instructions} lang={lang} />
        </div>
        {hasTeammateDevices && myUid && (
          <TeamDevicesPanel team={team} myUid={myUid} ctx={session} onChanged={refresh} />
        )}
        <Button variant="danger" loading={sosAction.busy} onClick={() => void sosAction.run()}>SOS</Button>
      </Screen>
    );
  }

  const activeStage = team.stages.find((s) => s.status === 'active');

  // Streak/momentum: consecutive completions across the run, in play order. A
  // skip or a long idle gap resets it (computeStreak). Chip hidden below 2.
  // computeStreak counts the TRAILING run and detects idle gaps via lastAt, so it
  // must be fed in completion-TIME order — the stage→task-index order these records
  // sit in can diverge from it (non-linear routing, or a partial-completion stage
  // whose non-chosen tasks auto-skip at the end), which would reset or inflate the
  // streak on the wrong element. Sort by completedAt first.
  const { streak, milestone } = computeStreak(
    team.stages
      .flatMap((s) => s.tasks)
      .filter((rec) => rec.status === 'completed' || rec.status === 'skipped')
      .map((rec) => ({ status: rec.status, completedAt: rec.completedAt }))
      .sort((a, b) => (a.completedAt ? Date.parse(a.completedAt) : 0) - (b.completedAt ? Date.parse(b.completedAt) : 0)),
    { now: new Date().toISOString() },
  );

  // Build map targets from the active stage's not-yet-completed tasks, joining
  // each run-record to its sanitized coordinates. The assigned task is "active".
  const targets: NavTarget[] = activeStage
    ? activeStage.tasks
        .filter((t) => t.status !== 'completed' && t.status !== 'skipped')
        .map((rec) => {
          const content = state.activeStageTasks.find((c) => c.id === rec.taskId);
          if (content?.locationless) return null; // general task — not on the map
          // play-task-gating: a hidden spot has no pin only while it is still
          // SEALED. Once the server confirms arrival it releases the coordinates,
          // so a player who wanders off can navigate back to it.
          if (content?.arrivalPending) return null;
          const coords = content?.smart?.stationCoords ?? content?.coordinates;
          return coords && (coords.lat !== 0 || coords.lng !== 0)
            ? { id: rec.taskId, lat: coords.lat, lng: coords.lng, title: content?.title ?? 'Mission', active: rec.status === 'assigned' }
            : null;
        })
        .filter((t): t is NavTarget => t !== null)
    : [];

  // Hidden-mission map (change: hidden-mission-map): while the team's ACTIVE
  // mission is a still-sealed hidden target, the normal map has no pin to show and
  // used to fall back to a placeholder. Instead, plot the SAFE trail of missions
  // they've already completed (server-provided `completedTaskPins`, built from
  // completed records only) plus their own GPS. We do NOT plot the hidden active
  // target — its coordinates stay sealed until reportArrival. For a NORMAL active
  // task these stay empty, so its map is byte-identical to before (its own pin).
  const activeMissionSealed = state.activeStageTasks.some((c) => c.arrivalPending);
  const completedPins: NavTarget[] = activeMissionSealed
    ? (state.completedTaskPins ?? []).map((p) => ({
        id: p.id, lat: p.coordinates.lat, lng: p.coordinates.lng, title: p.title, active: false,
      }))
    : [];
  const mapTargets = [...targets, ...completedPins];

  // Sealed hidden missions now also get a coarse SEARCH CIRCLE (change:
  // hidden-mission-search-area) — the server-derived `searchArea`, which contains
  // the real spot but is never it. The pin filter above is unchanged: a sealed
  // mission still gets no pin, only an area. Total selector, so a malformed
  // payload costs a circle and never the screen.
  const searchAreas = selectSearchAreas(state.activeStageTasks);

  const powerUpArmed = team.powerUps?.active === 'double_points';

  // What the "more" drawer holds right now. A tab appears only for a feature
  // actually in play, so nothing empty can surface.
  const drawerPlan = planMoreDrawer({
    hasBoard: !!state.run.leaderboard?.published && (state.run.leaderboard?.rankings?.length ?? 0) > 0,
    hasFeed: state.game.photoFeedEnabled !== false && !!myUid,
    hasChat: true,
    unreadChat: chatUnread,
    trackableCount: trackables.length,
    zoneCount: zones.length,
    hasTeammateDevices: hasTeammateDevices && !!myUid,
  });

  return (
    <Screen>
      <ReconnectingPill show={reconnecting} text={t.play.reconnecting} />
      <StoryInterstitial narratives={state.stageNarratives ?? []} runId={session.runId} lang={lang} />
      <PowerUpToast type={powerUpToast} />
      {/* ONE compact strip (change: play-card-simplification). Identity, score,
          progress, streak and every utility used to be EIGHT stacked full-width
          rows before the map — so on a phone the player scrolled past their own
          chrome to reach the mission. Now: two lines and an icon row.
          How-to-play and share became icon buttons; both carry aria-labels,
          because an icon-only button with no accessible name is a defect the
          play-web a11y scan fails on. */}
      {/* Test mode (change: test-mode-hidden-scoring): the brag card is withheld —
          storyCard bakes score and rank into the image pixels, and a sealed run
          has neither, so the button would draw blanks. */}
      <Header game={game} score={team.score} accent={accent} onLeave={leave} powerUpArmed={powerUpArmed}
        timeOnly={game.scoringPreset === 'time_only'} startedAt={team.startedAt}
        onSos={() => void sosAction.run()} sosBusy={sosAction.busy}
        isTestDrive={session.isTestDrive}
        streak={streak} streakMilestone={milestone}
        progress={progress.total > 0 ? (
          <MissionProgressRow progress={progress} beat={beat} accent={accent} />
        ) : undefined}
        howToPlay={<HowToPlayButton instructions={game.instructions} lang={lang} />}
        onShare={game.testMode === true ? undefined : () => void shareAction.run()} sharing={sharing}
      />
      {/* Announcements + flash missions are the organizer TALKING to this team
          mid-race. They used to render below the mission with the other secondary
          panels — i.e. below the fold on a phone. The leaderboard half moved into
          the drawer (showBoard={false}), which is what let the urgent half come up
          here without dragging a scoreboard with it. */}
      <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id}
        lang={lang} timeOnly={game.scoringPreset === 'time_only'} showBoard={false} />
      <InRunAlerts
        hotZone={state.run.hotZone}
        outOfBounds={team.outOfBounds}
        held={team.held}
        heldReason={team.heldReason}
      />

      {/* PRIMARY: the map + current task sit at the TOP, prominent
          (change: fix-play-screen-hierarchy) — the family playtest buried the task
          under status panels and the screen scrolled to find it. */}
      {locationRelevant && (
        <Suspense fallback={<div className="h-52 mb-4 rounded-xl bg-app-card border border-glass-border animate-pulse" />}>
          <NavMap targets={mapTargets} me={me} hotZone={state.run.hotZone} zones={zones} searchAreas={searchAreas} myTeamId={team.id} accent={accent} keepMapWithMe={activeMissionSealed} className="h-52 mb-4" />
        </Suspense>
      )}

      <div className="mb-4">
        {activeStage ? (
          <>
            <TaskRunner session={session} state={state} stage={activeStage} onChanged={refresh} readOnly={!isController} />
            <LockedTasksList stage={activeStage} state={state} />
          </>
        ) : state.nextStageReleaseAt && state.nextStageReleaseAt > Date.now() ? (
          <StageDropCountdown releaseAt={state.nextStageReleaseAt} onOpen={refresh} />
        ) : (
          /* Not a dead end any more (change: play-no-silent-failures): a bare
              sentence gave the player nothing to do. Same recovery shape as the
              load-failure state above. */
          <div className="flex flex-col items-center text-center gap-2 mt-10">
            <div className="text-4xl">⏳</div>
            <p className="text-sm font-semibold text-zinc-200">{t.play.noActiveStageTitle}</p>
            <p className="text-xs text-zinc-500">{t.play.noActiveStageBody}</p>
            <Button variant="ghost" className="mt-1" onClick={() => void refresh()}>{t.common.tryAgain}</Button>
          </div>
        )}
      </div>

      {/* SECONDARY: ONE drawer (change: play-card-simplification). These six were
          six always-mounted, separately-bordered sections competing in one long
          scroll below the mission — standings, photos, chat, collectibles,
          territory, devices. Almost nobody needs more than one at a time, and
          during a race the mission IS the screen, so the drawer starts closed and
          the badge is what keeps that honest (an unread word from the organizer
          still announces itself).
          A tab exists only when its feature is actually in play, so folding them
          together did not resurrect the empty sections that used to self-hide. */}
      <div className="mt-1 -mx-1 px-1">
        {!isController && (
          <div dir="auto" className="mb-3 rounded-lg bg-app-raised border border-glass-border px-3 py-2 text-sm text-zinc-400 flex items-center gap-2">
            👀 {t.devices.viewingBanner({ name: controllerName })}
          </div>
        )}
        <MoreDrawer
          plan={drawerPlan}
          onActiveTabChange={setViewingTab}
          renderTab={(id) => {
            if (id === 'board') {
              return state.run.leaderboard
                ? <LeaderboardPeek leaderboard={state.run.leaderboard} myTeamId={team.id} lang={lang} timeOnly={game.scoringPreset === 'time_only'} />
                : null;
            }
            if (id === 'feed') {
              return myUid ? (
                <Suspense fallback={<div className="h-24 rounded-xl bg-app-raised animate-pulse" />}>
                  <FeedPanel ctx={session} myUid={myUid} />
                </Suspense>
              ) : null;
            }
            if (id === 'chat') {
              return (
                <Suspense fallback={<div className="h-24 rounded-xl bg-app-raised animate-pulse" />}>
                  <ChatPanel ctx={session} teamId={team.id} />
                </Suspense>
              );
            }
            if (id === 'trackables') {
              return <TrackablesPanel ctx={session} items={trackables} myTeamId={team.id} isController={isController} onChanged={() => { void reloadTrackables(); }} />;
            }
            if (id === 'zones') {
              return <ZonesPanel zones={zones} myTeamId={team.id} isController={isController} me={me} ctx={session} onCaptured={reloadZones} />;
            }
            return myUid ? <TeamDevicesPanel team={team} myUid={myUid} ctx={session} onChanged={refresh} /> : null;
          }}
        />
      </div>
    </Screen>
  );
}

// Scheduled-release (change: scheduled-release): the team finished a chapter but
// the next one is a TIMED DROP. Show a live countdown; when it hits zero, poll so
// the server unlocks the stage and play resumes.

// Offline continuity (change: fix-play-offline-continuity): a small non-blocking
// pill shown while a poll is failing but we still have state — the game stays on
// screen and this reassures the player it's syncing (never a full-screen takeover).
function ReconnectingPill({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  // In the shared top stack's TOAST slot (change: play-top-overlay-stack): it
  // floats, because a poll that fails for one cycle and recovers must not shove
  // the mission down and back. It sits BELOW the offline banner when both show,
  // which is the pair that actually co-occurs: losing the radio is what fails the
  // poll, and the two used to be laid out as though only one could ever exist.
  return (
    <TopOverlay kind="reconnecting">
      <div className="flex items-center gap-2 rounded-full bg-zinc-800/90 text-zinc-100 text-xs px-3 py-1.5 shadow" role="status" aria-live="polite">
        <span className="w-3 h-3 rounded-full border-2 border-zinc-400/40 border-t-zinc-100 animate-spin" />
        {text}
      </div>
    </TopOverlay>
  );
}

// Narrative chapters (change: narrative-chapters): a full-card story beat shown when a
// chapter opens (intro) or closes (outro). Outro of the most-recently-completed stage
// takes priority so it appears before the next chapter's intro. Dismissal is local
// (localStorage per run+stage+kind) so each beat shows once.
function StoryInterstitial({ narratives, runId, lang }: { narratives: StageNarrative[]; runId: string; lang: 'he' | 'en' }) {
  const { t } = useT();
  const [, bump] = useState(0);
  const titleId = useId();
  const key = (sid: string, kind: string) => `rp.story.${runId}.${sid}.${kind}`;
  const seen = (sid: string, kind: string) => {
    try { return localStorage.getItem(key(sid, kind)) === '1'; } catch { return false; }
  };

  const completed = narratives.filter((n) => n.status === 'completed').sort((a, b) => b.order - a.order)[0];
  const active = narratives.find((n) => n.status === 'active');
  let pick: { sid: string; kind: 'intro' | 'outro'; order: number; stageTitle: string; beat: NonNullable<StageNarrative['narrative']['intro']> } | null = null;
  if (completed?.narrative.outro && beatHasContent(completed.narrative.outro) && !seen(completed.stageId, 'outro')) {
    pick = { sid: completed.stageId, kind: 'outro', order: completed.order, stageTitle: completed.title, beat: completed.narrative.outro };
  } else if (active?.narrative.intro && beatHasContent(active.narrative.intro) && !seen(active.stageId, 'intro')) {
    pick = { sid: active.stageId, kind: 'intro', order: active.order, stageTitle: active.title, beat: active.narrative.intro };
  }
  useDialogReturnFocus(!!pick);
  if (!pick) return null;

  const body = localizedBeatBody(pick.beat, lang);
  function dismiss() {
    try { localStorage.setItem(key(pick!.sid, pick!.kind), '1'); } catch { /* private mode */ }
    bump((x) => x + 1);
  }
  return (
    <>
    <EscapeKey onEscape={dismiss} />
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-5 animate-fade-up">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-2xl bg-app-card border border-glass-border shadow-task-card overflow-hidden">
        {pick.beat.imageUrl && (
          <img src={pick.beat.imageUrl} alt="" className="w-full max-h-48 object-cover" />
        )}
        <div className="p-5 space-y-3">
          <div className="text-xs font-bold text-ink-fire uppercase tracking-wide">
            {t.play.chapterLabel({ n: pick.order + 1 })}
          </div>
          <h2 id={titleId} className="text-lg font-bold text-zinc-100" dir="auto">{pick.beat.title ?? pick.stageTitle}</h2>
          {body && <p className="text-sm text-zinc-300 whitespace-pre-line" dir="auto">{body}</p>}
          <Button autoFocus onClick={dismiss} className="w-full">{t.play.storyContinue}</Button>
        </div>
      </div>
    </div>
    </>
  );
}

// A full-screen overlay must be dismissible from the keyboard
// (change: play-touch-rtl-a11y). Kept as a nodeless component so each overlay
// subscribes only while it is actually mounted.
function EscapeKey({ onEscape }: { onEscape: () => void }) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); cb.current(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return null;
}

// Move focus back to whatever was focused before a modal overlay opened, so a
// keyboard/screen-reader user is not dumped at the top of the page when it closes.
// Focus INTO the dialog is handled by autoFocus on the primary button.
function useDialogReturnFocus(active: boolean) {
  const prevFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    prevFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    return () => { try { prevFocus.current?.focus?.(); } catch { /* element gone */ } };
  }, [active]);
}

// Game intro primer (change: game-intro-instructions): the game-level "How to play"
// content. The waiting-screen card (below) and the in-run button/modal both reuse
// the narrative StoryInterstitial visual language so players see one consistent
// "read this" surface. Renders nothing when the game has no primer.

// Waiting/pre-start card: a joined player reading the lobby learns the mechanics
// before the run goes live. Static (not an overlay) — it lives inline on the page.
function HowToPlayCard({ instructions, lang }: { instructions?: GameInstructions | null; lang: 'he' | 'en' }) {
  const { t } = useT();
  if (!gameInstructionsHasContent(instructions ?? undefined)) return null;
  const ins = instructions!;
  const body = localizedInstructionsBody(ins, lang);
  return (
    <div className="w-full max-w-md mt-4 rounded-2xl bg-app-card border border-glass-border shadow-task-card overflow-hidden text-start">
      {ins.imageUrl && <img src={ins.imageUrl} alt="" className="w-full max-h-40 object-cover" />}
      <div className="p-4 space-y-2">
        <h3 className="text-base font-bold text-zinc-100" dir="auto">{ins.title ?? t.play.howToPlayTitle}</h3>
        {body && <p className="text-sm text-zinc-300 whitespace-pre-line" dir="auto">{body}</p>}
      </div>
    </div>
  );
}

// In-run button + modal: a confused player can re-read the primer mid-game. The
// modal reuses the StoryInterstitial overlay layout (image header + title +
// pre-line body + close). Available for the whole run.
function HowToPlayButton({ instructions, lang }: { instructions?: GameInstructions | null; lang: 'he' | 'en' }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  useDialogReturnFocus(open);
  if (!gameInstructionsHasContent(instructions ?? undefined)) return null;
  const ins = instructions!;
  const body = localizedInstructionsBody(ins, lang);
  return (
    <>
      {/* An icon in the header action row now (change: play-card-simplification)
          — it used to be a full-width pill on its own line above the map. Icon-only,
          so the accessible name comes from aria-label; `title` gives sighted users
          the same words on hover. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.play.howToPlay}
        title={t.play.howToPlay}
        data-testid="how-to-play"
        className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-base text-zinc-400 hover:text-zinc-200"
      >
        📖
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-5 animate-fade-up">
          <EscapeKey onEscape={() => setOpen(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-2xl bg-app-card border border-glass-border shadow-task-card overflow-hidden">
            {ins.imageUrl && <img src={ins.imageUrl} alt="" className="w-full max-h-48 object-cover" />}
            <div className="p-5 space-y-3">
              <h2 id={titleId} className="text-lg font-bold text-zinc-100" dir="auto">{ins.title ?? t.play.howToPlayTitle}</h2>
              {body && <p className="text-sm text-zinc-300 whitespace-pre-line" dir="auto">{body}</p>}
              <Button autoFocus onClick={() => setOpen(false)} className="w-full">{t.play.howToPlayClose}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Team↔HQ chat state, lifted out of the panel (change: play-card-simplification).
// The drawer badges unread chat while CLOSED, so the count has to live above the
// panel that shows the thread — otherwise the only way to discover a message from
// the organizer is to go looking for it, which is the failure the badge exists to
// prevent. The unread decision is still the shared, unit-tested
// countUnreadChatMessages (ID-anchored, own messages excluded).
function useTeamChat(ctx: Session, teamId: string, viewing: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [seen, setSeen] = useState(() => loadChatSeen(ctx.runId, teamId));
  const myUid = uid();

  useEffect(() => {
    // No team id yet (a session saved before shared devices, mid-restore): do not
    // build a path out of an empty segment — just stay silent until it arrives.
    if (!teamId) return;
    const ref = doc(db, FIRESTORE_PATHS.runChat(ctx.ownerUid, ctx.gameId, ctx.runId, teamId));
    return onSnapshot(ref, (snap) => {
      setMessages((snap.data() as { messages?: ChatMessage[] } | undefined)?.messages ?? []);
    }, () => setMessages([]));
  }, [ctx.ownerUid, ctx.gameId, ctx.runId, teamId]);

  const unreadCount = countUnreadChatMessages(messages, seen, myUid);

  // Mirrors the original ChatSection exactly (change: play-card-simplification
  // regression catch): while the thread is actually being VIEWED — the chat tab
  // is the drawer's open tab — keep the seen marker in step with EVERY arriving
  // message, not just the one at the moment the tab opened. Without this, a
  // message that lands while the player is looking straight at it would still
  // read as unread the instant the drawer closes, because `seen` would have been
  // synced once, at open, and never again for the rest of the visit.
  useEffect(() => {
    if (!viewing || !teamId || unreadCount === 0) return;
    const marker = chatSeenMarker(messages);
    saveChatSeen(ctx.runId, teamId, marker);
    setSeen(marker);
  }, [viewing, unreadCount, messages, ctx.runId, teamId]);

  return { unreadCount };
}

// ONE drawer in place of six always-mounted sections (change:
// play-card-simplification). Which tabs exist, and which opens first, is
// `planMoreDrawer` — pure and tested. This renders it and owns only the open/active
// UI state.
//
// Closed by default: during a race the mission is the screen, and everything in
// here is something you go looking for. The badge is what keeps that honest.
function MoreDrawer({ plan, renderTab, onActiveTabChange }: {
  plan: ReturnType<typeof planMoreDrawer>;
  renderTab: (id: DrawerTabId) => ReactNode;
  /**
   * Fires with the tab actually ON SCREEN (drawer open + that tab active), or
   * `null` the instant neither is true. `null` matters as much as any id: it is
   * what lets the caller know viewing has STOPPED (change:
   * play-card-simplification), e.g. so the chat hook stops re-marking messages
   * seen the moment the drawer closes.
   */
  onActiveTabChange?: (id: DrawerTabId | null) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<DrawerTabId | null>(null);

  const label: Record<DrawerTabId, string> = {
    board: t.more.board, feed: t.more.feed, chat: t.more.chat,
    trackables: t.more.trackables, zones: t.more.zones, devices: t.more.devices,
  };

  // The tab a player picked can VANISH mid-race (the last collectible is taken,
  // a run ends its territory phase). Derive the active tab every render instead of
  // trusting stored state, so the drawer can never point at a tab that is gone.
  const active: DrawerTabId | null =
    picked && plan.tabs.some((x) => x.id === picked) ? picked : plan.defaultTab;

  useEffect(() => {
    onActiveTabChange?.(open ? active : null);
  }, [open, active, onActiveTabChange]);

  if (plan.empty) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="more-drawer-toggle"
        className="w-full inline-flex items-center justify-between gap-2 min-h-[48px] px-4 rounded-xl bg-app-card border border-glass-border text-sm font-semibold text-zinc-200"
      >
        <span className="inline-flex items-center gap-2">
          {t.more.toggle}
          {plan.totalBadge > 0 && (
            // The number alone is meaningless to a screen reader sitting next to
            // "עוד" — aria-label supplies the sentence the visible digit implies.
            <span data-testid="more-drawer-badge" aria-label={t.more.unread({ n: plan.totalBadge })}
              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-ink-fire text-white text-[13px] font-bold">
              {plan.totalBadge}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="text-zinc-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2" data-testid="more-drawer-body">
          {plan.tabs.length > 1 && (
            <div role="tablist" aria-label={t.more.tabsAria}
              className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
              {plan.tabs.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={active === tab.id}
                  onClick={() => setPicked(tab.id)}
                  data-testid={`more-tab-${tab.id}`}
                  className={`shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold border transition-colors ${
                    active === tab.id
                      ? 'bg-rp-fire/15 border-rp-fire/40 text-ink-fire'
                      : 'bg-app-card border-glass-border text-zinc-400'
                  }`}
                >
                  {label[tab.id]}
                  {tab.badge > 0 && (
                    <span aria-label={t.more.unread({ n: tab.badge })}
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-ink-fire text-white text-[12px] font-bold">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {active && <div data-testid={`more-panel-${active}`}>{renderTab(active)}</div>}
        </div>
      )}
    </div>
  );
}

// Trackable collectibles (change: trackable-collectibles): the run's items with their
// holder status; the controller can pick up an unheld item or drop one it carries.
// The list is now OWNED by PlayScreen (change: play-card-simplification) so the
// drawer can decide whether a collectibles tab should exist at all. This renders
// what it is given and asks the owner to refetch after an action.
function TrackablesPanel({ ctx, items, myTeamId, isController, onChanged }: {
  ctx: Session; items: Trackable[]; myTeamId: string; isController: boolean; onChanged: () => void;
}) {
  const { t } = useT();
  const load = onChanged;

  // Per-row failure copy (change: play-no-silent-failures): this used to be an
  // empty catch, so a rejected pick up looked exactly like nothing happening.
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function act(tr: Trackable, action: 'pickup' | 'drop') {
    setErrors((e) => ({ ...e, [tr.id]: '' }));
    try {
      const args = { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId, trackableId: tr.id };
      if (action === 'pickup') await pickUpTrackable(args); else await dropTrackable(args);
      await load();
    } catch {
      setErrors((e) => ({ ...e, [tr.id]: t.play.actionFailed }));
    }
  }
  // Keyed in-flight guard (change: wave-b/async-action-guard): a double-tapped
  // "pick up" fired pickUpTrackable twice; different trackables stay independent.
  const actAction = useAsyncAction<[Trackable, 'pickup' | 'drop'], void>(act, (tr) => tr.id);

  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-xl bg-app-card border border-glass-border p-3">
      <div className="text-sm font-bold text-zinc-100 mb-2">🎒 {t.trackables.title}</div>
      <div className="space-y-2">
        {items.map((tr) => {
          const mine = tr.currentHolderTeamId === myTeamId;
          const held = !!tr.currentHolderTeamId;
          return (
            <div key={tr.id}>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm text-zinc-200" dir="auto">
                {tr.name}
                {mine ? ` · ${t.trackables.carrying}` : held ? ` · ${t.trackables.held}` : ''}
              </span>
              {isController && (mine ? (
                <button disabled={actAction.isBusy(tr.id)} onClick={() => void actAction.run(tr, 'drop')}
                  className="inline-flex items-center justify-center min-h-[44px] text-xs font-bold px-4 py-2 rounded-full border border-glass-border text-zinc-200 disabled:opacity-40">
                  {t.trackables.drop}
                </button>
              ) : !held && (
                <button disabled={actAction.isBusy(tr.id)} onClick={() => void actAction.run(tr, 'pickup')}
                  className="inline-flex items-center justify-center min-h-[44px] text-xs font-bold px-4 py-2 rounded-full bg-accent/15 text-ink-fire border border-accent/30 disabled:opacity-40">
                  {t.trackables.pickUp}
                </button>
              ))}
            </div>
            {errors[tr.id] && (
              <p role="status" aria-live="polite" className="mt-1 text-xs font-medium text-ink-alert">⚠ {errors[tr.id]}</p>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Territory capture (change: territory-capture): the run's zones with their current
// owner; a controller standing inside a zone can capture (or flip) it for bonus points.
function ZonesPanel({ zones, ctx, myTeamId, isController, me, onCaptured }: { zones: CaptureZone[]; ctx: Session; myTeamId: string; isController: boolean; me: { lat: number; lng: number } | null; onCaptured: () => void }) {
  const { t } = useT();
  // Per-row failure copy (change: play-no-silent-failures): capturing AWARDS
  // POINTS, and both the no-GPS path and the rejection path used to be silent.
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function capture(z: CaptureZone) {
    setErrors((e) => ({ ...e, [z.id]: '' }));
    if (!me) { setErrors((e) => ({ ...e, [z.id]: t.play.locationNotReady })); return; }
    try {
      await captureZone({ ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId, zoneId: z.id, lat: me.lat, lng: me.lng });
      onCaptured(); // refresh both the map circles and this list
    } catch {
      setErrors((e) => ({ ...e, [z.id]: t.play.actionFailed }));
    }
  }
  // Keyed in-flight guard (change: wave-b/async-action-guard): captureZone awards
  // points, so a double-tapped capture was a real double-award window.
  const captureAction = useAsyncAction(capture, (z: CaptureZone) => z.id);

  if (!zones || zones.length === 0) return null;
  return (
    <div className="rounded-xl bg-app-card border border-glass-border p-3">
      <div className="text-sm font-bold text-zinc-100 mb-2">🚩 {t.zones.title}</div>
      <div className="space-y-2">
        {zones.map((z) => {
          const mine = z.ownerTeamId === myTeamId;
          return (
            <div key={z.id}>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm text-zinc-200" dir="auto">
                {z.title}
                <span className="text-zinc-500"> · {z.ownerTeamId ? (mine ? t.zones.yours : t.zones.heldBy({ name: z.ownerTeamName ?? '' })) : t.zones.open}</span>
              </span>
              {isController && !mine && (
                /* No longer disabled on a missing fix: a greyed button with no
                   reason is the dead end the audit found. Tapping now explains
                   that GPS has not settled yet, and calls nothing. */
                <button disabled={captureAction.isBusy(z.id)} onClick={() => void captureAction.run(z)}
                  className="inline-flex items-center justify-center min-h-[44px] text-xs font-bold px-4 py-2 rounded-full bg-rp-fire/15 text-ink-fire border border-rp-fire/30 disabled:opacity-40">
                  {t.zones.capture}
                </button>
              )}
            </div>
            {errors[z.id] && (
              <p role="status" aria-live="polite" className="mt-1 text-xs font-medium text-ink-alert">⚠ {errors[z.id]}</p>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Unlockable tasks (change: unlockable-tasks): the active stage's still-LOCKED
// tasks, shown under the runner so the chain is visible ("solve the cipher,
// THEN the vault opens"). Locked-ness is computed with the SAME shared
// isUnlocked used by the server routing + completion guard — display only, the
// server independently refuses locked completions.
//
// play-task-gating (wave D): this list is now normally EMPTY by design. The
// product decision is that a player only receives the task routing assigned them
// (plus the ones they finished), so an unassigned/locked task is absent from the
// payload entirely and there is nothing to look up. The component is kept — it
// renders null harmlessly and stays correct for any legacy/completed content —
// but do not "fix" it by re-shipping locked tasks to the client.
function LockedTasksList({ stage, state }: { stage: RunStageRecord; state: MyTeamState }) {
  const { t } = useT();
  const completedIds = state.team.stages
    .flatMap((s) => s.tasks)
    .filter((rec) => rec.status === 'completed')
    .map((rec) => rec.taskId);
  const locked = stage.tasks
    .filter((rec) => rec.status === 'unassigned')
    .map((rec) => state.activeStageTasks.find((c) => c.id === rec.taskId))
    .filter((c) => !!c && !isUnlocked(c, completedIds));
  if (locked.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {locked.map((c) => {
        const names = (c!.unlockAfterTaskIds ?? [])
          .filter((id) => !completedIds.includes(id))
          .map((id) => state.activeStageTasks.find((x) => x.id === id)?.title)
          .filter((n): n is string => !!n)
          .join(', ');
        return (
          <div key={c!.id} dir="auto" className="rounded-lg bg-app-raised border border-glass-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <span aria-hidden>🔒</span>
              <span className="font-medium truncate">{c!.title}</span>
              <span className="ms-auto text-[12px] uppercase tracking-wide text-zinc-500 shrink-0">{t.play.lockedTaskLabel}</span>
            </div>
            {names && <p className="text-xs text-zinc-500 mt-0.5">{t.play.lockedCompleteFirst({ names })}</p>}
          </div>
        );
      })}
    </div>
  );
}

// Guard a skewed device clock from misdriving the scheduled-drop countdown
// (CLAUDE.md: never count an absolute deadline against the phone's clock). The
// payload carries no server `now`, so we defend client-side only: cap the DISPLAYED
// remaining so a clock running far behind the server can't show an absurd multi-day
// wait, and hide the card entirely once the release moment passes — the server's
// advanceTeamStateOnPoll is the real authority and the next poll clears
// nextStageReleaseAt, so a slow phone clock can no longer pin a stale card up.
const MAX_STAGE_DROP_COUNTDOWN_MS = 24 * 60 * 60 * 1000;

function StageDropCountdown({ releaseAt, onOpen }: { releaseAt: number; onOpen: () => void }) {
  const { t } = useT();
  const [remainingMs, setRemainingMs] = useState(() => releaseAt - Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const left = releaseAt - Date.now();
      setRemainingMs(left);
      if (left <= 0) { clearInterval(id); onOpen(); }
    }, 1000);
    return () => clearInterval(id);
  }, [releaseAt, onOpen]);

  // Past the release instant → stop rendering; don't leave a stuck 00:00 card up.
  if (remainingMs <= 0) return null;
  const shownMs = Math.min(remainingMs, MAX_STAGE_DROP_COUNTDOWN_MS);
  const total = Math.max(0, Math.floor(shownMs / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;

  return (
    <div dir="auto" className="mt-8 mx-auto max-w-xs text-center rounded-2xl bg-app-card border border-glass-border px-6 py-8 shadow-task-card">
      <div className="text-4xl mb-3">⏳</div>
      <p className="text-sm text-zinc-400 mb-2">{t.play.nextDropTitle}</p>
      <p className="text-3xl font-bold tabular-nums text-ink-fire">{clock}</p>
      <p className="mt-3 text-xs text-zinc-500">{t.play.nextDropHint}</p>
    </div>
  );
}

function Header({
  game, score, accent, onLeave, powerUpArmed, timeOnly, startedAt, onSos, sosBusy,
  isTestDrive, streak = 0, streakMilestone, progress, howToPlay, onShare, sharing,
}: {
  game: MyTeamState['game']; score: number; accent: string; onLeave: () => void; powerUpArmed?: boolean;
  // time_only runs are ranked purely by time and never award points, so the
  // in-run "score" is a permanent 0 that misreads as a total — show a live
  // elapsed clock instead (mirrors the finish/TV/public boards).
  timeOnly?: boolean; startedAt?: string;
  // Always-reachable SOS entry point (active-race branch only). Drives the same
  // shared sosAction as the bottom SOS button, so sosBusy loads/disables both.
  onSos?: () => void; sosBusy?: boolean;
  // Everything below folded UP into this strip (change: play-card-simplification).
  // Each was its own full-width row above the map; together they cost the player a
  // scroll to reach their own mission.
  isTestDrive?: boolean;
  streak?: number; streakMilestone?: number | null;
  progress?: ReactNode;
  howToPlay?: ReactNode;
  onShare?: () => void; sharing?: boolean;
}) {
  const { t } = useT();
  // Test mode (change: test-mode-hidden-scoring): no score, no streak, no power-up
  // chip — every one of them is a scoring signal. Read off the game rather than
  // threaded as a prop, so a caller cannot forget to pass it. The server has
  // already stripped these values, so this only decides how the absence looks.
  const sealed = game.testMode === true;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div dir="auto" className="font-brand font-extrabold text-lg truncate" style={{ color: accent }}>
            {game.branding?.name ?? game.title}
          </div>
          <div className="text-xs text-zinc-500 flex items-center gap-2 flex-wrap">
            {sealed
              ? <span data-testid="test-mode-chip">{t.play.testModeChip}</span>
              : timeOnly
                ? <span aria-label={t.board.elapsed}>⏱ <ElapsedClock startedAt={startedAt} /></span>
                : <span>{t.play.score}: <span aria-live="polite" className="text-ink-fire font-mono">{score}</span></span>}
            {!sealed && streak >= 2 && (
              <span
                key={streakMilestone ?? streak}
                data-testid="streak-chip"
                className={`inline-flex items-center rounded-full bg-rp-fire/15 border border-rp-fire/30 px-2 py-0.5 text-[13px] font-bold text-ink-fire ${streakMilestone ? 'animate-score-pop motion-reduce:animate-none' : ''}`}
              >
                {t.play.streak({ n: streak })}
              </span>
            )}
            {!sealed && powerUpArmed && (
              <span className="inline-flex items-center rounded-full bg-accent/15 border border-accent/40 px-2 py-0.5 text-[13px] font-bold text-ink-fire">
                {t.play.powerUpArmedChip}
              </span>
            )}
            {isTestDrive && (
              <span data-testid="test-run-chip"
                className="inline-flex items-center rounded-full bg-app-raised border border-rp-amber/40 px-2 py-0.5 text-[13px] font-bold text-ink-amber">
                🧪 {t.play.testRunBanner}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {howToPlay}
          {onShare && (
            <button type="button" onClick={onShare} disabled={sharing}
              aria-label={t.play.shareProgress} title={t.play.shareProgress}
              data-testid="share-progress"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-base text-ink-fire disabled:opacity-50">
              {sharing ? '…' : '📸'}
            </button>
          )}
          {onSos && (
            <button type="button" onClick={onSos} aria-label={t.play.sosAria} disabled={sosBusy}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2 rounded-lg text-xs font-bold text-ink-alert border border-rp-alert/40 disabled:opacity-50">
              SOS
            </button>
          )}
          <button onClick={onLeave} aria-label={t.play.leaveAria} title={t.play.leave}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -me-2 rounded-lg text-base text-zinc-500">✕</button>
        </div>
      </div>
      {progress && <div className="mt-2">{progress}</div>}
    </div>
  );
}

// The progress line: a counter and a bar, on ONE row (change: test-mode-game-feel).
//
// A milestone beat takes over the COUNTER for a few seconds instead of arriving as
// its own banner. That was deliberate: this screen already stacks header, live-ops,
// alerts, map and mission on a phone, and a past playtest buried the mission under
// exactly that kind of status row. Two floating pills (power-up, reconnecting) also
// already share the top of the screen, so a third would have had to dodge them.
// Reusing the line progress already owns costs no space, shifts no layout and can
// collide with nothing — and it puts the beat where the player is already looking to
// see how far along they are.
//
// The copy is kept about as wide as the counter it replaces so the bar beside it
// doesn't visibly resize for the three seconds the beat is up.
function MissionProgressRow({ progress, beat, accent }: {
  progress: MissionProgress; beat: Milestone | null; accent: string;
}) {
  const { t } = useT();
  const beatLabel: Record<Milestone, string> = {
    quarter: t.play.milestoneQuarter,
    half: t.play.milestoneHalf,
    threeQuarters: t.play.milestoneThreeQuarters,
    lastFive: t.play.milestoneLastFive,
  };
  return (
    <div className="flex items-center gap-2">
      {beat ? (
        <span
          key={beat}
          role="status"
          data-testid="milestone-beat"
          className="text-[13px] font-bold shrink-0 animate-answer-pop motion-reduce:animate-none"
          style={{ color: accent }}
        >
          {beatLabel[beat]}
        </span>
      ) : (
        <span data-testid="mission-counter" className="text-[13px] tabular-nums text-zinc-500 shrink-0">
          {t.play.missionCounter({ current: progress.current, total: progress.total })}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <Progress done={progress.done} total={progress.total}
          label={t.play.missionProgressLabel({ done: progress.done, total: progress.total })} />
      </div>
    </div>
  );
}

// A live m:ss elapsed clock for time_only runs, ticking on its own so only this
// node re-renders each second (not the whole header/screen). Before the race is
// stamped (startedAt absent) it reads 0:00.
function ElapsedClock({ startedAt }: { startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const sec = startedAt ? Math.max(0, (now - new Date(startedAt).getTime()) / 1000) : 0;
  return <span className="text-ink-fire font-mono">{formatDuration(sec)}</span>;
}

// Power-ups (change: power-ups): a transient award toast at the top of the screen.
function PowerUpToast({ type }: { type: 'double_points' | 'bonus_points' | null }) {
  const { t } = useT();
  if (!type) return null;
  const text = type === 'double_points' ? t.play.powerUpDoubleToast : t.play.powerUpBonusToast;
  return (
    <TopOverlay kind="powerUp">
      <div role="status" aria-live="polite"
        className="max-w-[calc(100%-2rem)] rounded-full bg-ink-fire text-white font-bold text-sm px-4 py-2 shadow-lg animate-score-pop motion-reduce:animate-none">
        {text}
      </div>
    </TopOverlay>
  );
}
