import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { Query, DocumentData, QuerySnapshot } from 'firebase/firestore';
import QRCode from 'qrcode';
import type { Run, HotZone, StationStatus, RunFeedback, RunFeedbackSummary, RunSummary, FeedbackRatingKey, FeedbackIssue, Trackable, CaptureZone } from '@rushpoint/shared';
import { hotZoneMultiplier, effectiveTaskStatus, FEEDBACK_ISSUES, buildStationQrPayload, FIRESTORE_PATHS, CHAT_TEXT_MAX_LEN, resolvePlayOrigin, CANONICAL_PLAY_URL, MAX_RUN_DEVICES, isRunDeviceCapActive, chatSeenMarker, countUnreadChatMessages, parseChatSeen, serializeChatSeen, chatSeenStorageKey, staffChannelMessageSide, type ChatMessage, type ChatSeenMarker, type StaffChannelMessage } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useAuth } from '../components/AuthGate';
import {
  listRunTeams, startTeams, finalizeRun, refreshLeaderboard, pushAnnouncement, pushFlashMission,
  inviteStaff, skipStage, skipTaskForTeam, adjustTeamScore, acknowledgeAlert, clearTeamOutOfBounds, activateHotZone, deactivateHotZone,
  getRunAnalytics, getRunSummary, getRunHeatmap, getRunFeedbackSummary, createTrackable, getRunTrackables,
  createZone, deleteZone, getRunZones, hideFeedItem, getRunSurveyResults, getGame,
  sendTeamChatMessage, sendStaffChannelMessage, reviewStationSubmission, setRunTaskStatus,
  type RunTeamRow, type RunAnalyticsResult, type RunHeatmapResult, type SurveyResultRow,
} from '../services/calls';
// Photo approval queue (wave-e task 13) — pure queue logic shared with the
// play-web StaffConsole so the two review surfaces can never disagree.
import {
  buildSubmissionQueues, submissionKey, isRenderableMedia,
  type SubmissionRow, type SubmissionTeamDoc, type RawSubmission,
} from '@rushpoint/shared';
// Review triage (change: photo-review-throughput): wait time, "who is actually
// blocked" priority, decision legality and the per-row failure map — all pure.
import {
  buildReviewQueueView, decideReview, moveFocus, recordFailure, clearFailure,
  type ReviewFailures,
} from '../lib/photoReviewQueue';
// Run media gallery (change: run-media-gallery-and-video-feed): every renderable
// submission, any review status — reuses the same flatten the review queue uses
// so the two views can never disagree about what counts as "this team's media".
import { buildRunMediaGallery } from '../lib/runMediaGallery';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { Badge, Button, Card, EmptyState, Input, Label, Spinner } from '../components/ui';
import { OverflowMenu } from '../components/OverflowMenu';
import RichTooltip from '../components/RichTooltip';
// Progressive disclosure (change: run-console-progressive-disclosure): the
// console's layout, action severity, share links and human labels are pure
// decisions that live in lib/ with tests, so the chrome and the summary badges
// cannot drift apart.
// Density + section navigation (change: run-console-density): the accordions are
// gone. A Builder style rail picks ONE section; the incident controls stay pinned
// above it; and which panel sits in which lane is decided by the same pure module
// so no panel can be silently unreachable.
import {
  buildRunConsolePlan, sectionStateKey,
  buildRunConsoleSections, resolveSectionWithReason, buildPinnedLayout, assignPanelColumns, panelPlacement,
  consoleColumnCount, sectionColumnCount, gridTemplateClass, columnSpanClass,
  summaryChips, CONSOLE_MEDIUM_QUERY, CONSOLE_WIDE_QUERY,
  type PanelId, type RunStatus, type GroupSummary, type SectionId, type RunConsoleSection,
  type ColumnLayout, type SummaryChipKey,
} from '../lib/runConsoleLayout';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  runActionVariant, runActionConsequence, runActionNeedsConfirm, teamRowActions,
  classifyRunAction, parseScoreDelta, FLASH_MISSION_TTL_SECONDS, FLASH_MISSION_TTL_MINUTES,
  type RunActionId,
} from '../lib/runConsoleActions';
import { buildShareArtifacts, SHARE_ARTIFACT_IDS, type ShareArtifactId } from '../lib/runShareArtifacts';
import { resolveTeamLabel, resolveTaskLabel, resolveEnumLabel, shortId } from '../lib/runConsoleLabels';
// Clarity + navigation (change: run-console-clarity): what needs the organizer
// right now, and the copy contract every panel renders through. Both pure.
import { buildRunSignals, type RunSignal } from '../lib/runConsoleSignals';
// Live-stream freshness (change: run-console-live-stream-resilience): the pure,
// total "is the teams board stale" verdict, so a failed poll surfaces instead of
// freezing the board silently.
import { isTeamsStale, secondsSinceSync } from '../lib/streamFreshness';
import { teamsFingerprint, teamsPollDelayFor } from '../lib/runConsolePolling';
import { panelCopy } from '../lib/runConsolePanelMeta';
// "Is anyone in trouble right now?" (change: run-console-attention) — a pure,
// quiet-by-default verdict over the row data listRunTeams already returns.
import {
  buildAttentionContext, classifyTeamAttention,
  type AttentionReason, type TeamAttention,
} from '../lib/teamAttention';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import { describeCallFailure } from '../lib/callFeedback';
import { playAlert, unlockAudio } from '../lib/sound';
import { useT } from '../components/LanguageContext';
import LiveTeamMap from '../components/LiveTeamMap';
import HeatmapMap from '../components/HeatmapMap';
import LocationStep from '../components/LocationStep';
import { isValidCoord } from '@rushpoint/shared';

// Where the participant app lives (for the shareable join link/QR).
const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? CANONICAL_PLAY_URL);

// Newest-N feed cards this console's listener will ever hold — matches the
// participant panel's window so the two surfaces never disagree about what
// "recent" means. Rationale for bounding at all lives on the listener below.
// Note the feed rail's badge count is therefore capped at this number; it is a
// "there is activity" cue, not an audited total, so a saturated badge is fine.
const FEED_WINDOW = 100;

// One way for this console to say "that did not work"
// (change: creator-no-silent-failures). Several live-ops handlers here used to
// have an empty catch, a `.catch(() => undefined)`, or a `finally` with no
// `catch` at all — so a rejected score adjustment, a rejected feed hide and a
// rejected standings publish all looked exactly like success. A toast (not a
// dialog) on purpose: these fire mid-event, and a host must not have to dismiss
// a modal to keep running the game. The original error is logged, never shown.
function useCallFailureToast() {
  const t = useT();
  return useCallback((e: unknown, where: string) => {
    console.error(`[runConsole] ${where} failed:`, e);
    toast.error(t.callFailure[describeCallFailure(e, { online: navigator.onLine }).key]);
  }, [t]);
}

// Clipboard copy that never fails in silence (item 3). Three share cards used to
// swallow a rejected `navigator.clipboard.writeText` in an empty catch, so the
// "Copied!" state never flipped and the host walked away with an empty clipboard
// believing they had the join link. On success flip the local copied state; on
// failure surface it on the same toast channel the rest of the console uses.
async function copyToClipboard(text: string, onCopied: () => void, failMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    onCopied();
  } catch (e) {
    console.error('[runConsole] clipboard copy failed:', e);
    toast.error(failMessage);
  }
}

export default function RunConsolePage() {
  const { gameId, runId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const reportFailure = useCallFailureToast();
  const ownerUid = user!.uid;
  const [run, setRun] = useState<Run | null>(null);
  // Run-doc resolution flags (change: run-console-run-not-found). notFound fires
  // ONLY after a real snapshot reports !exists() (never before the first
  // snapshot), so a normal pre-first-snapshot null is not misread as not-found.
  const [runNotFound, setRunNotFound] = useState(false);
  const [runLoadErr, setRunLoadErr] = useState(false);
  const [teams, setTeams] = useState<RunTeamRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [staffPin, setStaffPin] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; teamId: string; type: string; message: string; lat: number | null; lng: number | null; createdAt: string }[]>([]);
  // Live-stream resilience (change: run-console-live-stream-resilience). The teams
  // poll and the alerts listener are the console's live picture; when either
  // degrades the board must SAY so instead of freezing at last-known state.
  const [teamsStale, setTeamsStale] = useState(false);
  const [lastTeamsSyncAt, setLastTeamsSyncAt] = useState<number | null>(null);
  const [alertsStreamError, setAlertsStreamError] = useState(false);
  // A single low-frequency wall-clock ticker for time-derived render (the
  // "reconnecting · updated Xs ago" staleness age). On the 2nd+ consecutive
  // failed teams poll, setTeamsStale(true) is a no-op (already true) so React
  // bails out — and with zero unacknowledged alerts nothing else re-renders, so
  // an age read from a render-time Date.now() froze at ~5s during a sustained
  // outage, UNDERSTATING staleness. This drives a re-render every 5s so the age
  // counts up. One shared ticker (change: run-console-action-feedback).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Live run doc (owner can read directly)
  useEffect(() => {
    if (!gameId || !runId) return;
    const ref = doc(db, `users/${ownerUid}/games/${gameId}/runs/${runId}`);
    return onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) { setRun(snap.data() as Run); setRunNotFound(false); setRunLoadErr(false); }
        else { setRunNotFound(true); }
      },
      (e) => { console.warn('[runConsole] run-doc listener failed:', e); setRunLoadErr(true); },
    );
  }, [gameId, runId, ownerUid]);

  // Live unacknowledged SOS / alerts (owner reads its own run's alerts).
  // Safety path: when a NEW alert arrives the organizer gets an audible cue + a
  // document.title flash so a raised SOS never sits silent on a busy console.
  // Ref-baseline the seen ids (null until the first snapshot) so a fresh mount
  // doesn't replay existing alerts. Mirrors the StaffConsole cue.
  const seenAlertIds = useRef<Set<string> | null>(null);
  const baseTitle = useRef<string>(document.title);
  useEffect(() => {
    if (!gameId || !runId) return;
    // A swallowed listener error was the one place the console read "no SOS" when
    // the truth was "cannot tell". Mirror the photo listener: clear on the good
    // path, raise a visible flag on a persistent failure.
    setAlertsStreamError(false);
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`),
      where('acknowledged', '==', false),
    );
    return onSnapshot(ref, (snap) => {
      setAlertsStreamError(false);
      const rows = snap.docs.map((d) => {
        const a = d.data() as Partial<{ teamId: string; type: string; message: string; lat: number; lng: number; createdAt: string }>;
        return { id: d.id, teamId: a.teamId ?? '', type: a.type ?? 'sos', message: a.message ?? '', lat: a.lat ?? null, lng: a.lng ?? null, createdAt: a.createdAt ?? '' };
      });
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const ids = new Set(rows.map((r) => r.id));
      if (seenAlertIds.current === null) {
        seenAlertIds.current = ids; // baseline: don't cue on first paint
      } else if (rows.some((r) => !seenAlertIds.current!.has(r.id))) {
        playAlert();
      }
      seenAlertIds.current = ids;
      setAlerts(rows);
    }, (err) => {
      console.warn('[RunConsole] alerts listener error', err);
      setAlertsStreamError(true);
    });
  }, [gameId, runId, ownerUid]);

  // Flash the browser-tab title while any alert is unacknowledged so the
  // organizer notices even on another tab; restore it when all are cleared.
  useEffect(() => {
    if (alerts.length === 0) { document.title = baseTitle.current; return; }
    const id = setInterval(() => {
      document.title = document.title === baseTitle.current
        ? t.runConsole.newAlertTitleFlash({ n: alerts.length })
        : baseTitle.current;
    }, 1000);
    return () => { clearInterval(id); document.title = baseTitle.current; };
  }, [alerts.length, t]);

  // Unlock the SOS audio context on the creator's FIRST interaction with the page,
  // whatever it is (change: run-console-live-stream-resilience). unlockAudio() was
  // only called from Start-all / Invite-staff, so a creator who opens an ALREADY
  // live run and never presses those never unlocked audio, and every SOS cue
  // silently dropped (sound.ts autoplay gate). unlockAudio() is idempotent and a
  // no-op where Web Audio is unavailable, so this is safe; detach after first fire.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Poll pacing (perf: run-console-poll-cost) — policy in lib/runConsolePolling.ts.
  // Refs, not state: the scheduler must read the latest values without re-rendering
  // the console or re-subscribing its effect on every poll.
  const teamsFingerprintRef = useRef<string | null>(null);
  const quietPollsRef = useRef(0);

  const loadTeams = useCallback(async () => {
    if (!gameId || !runId) return;
    // The teams poll is the console's SINGLE live picture (the table, every score,
    // the attention verdict, the signal chips). A rejection (token refresh blip,
    // network drop, function cold start) used to reject unhandled and freeze the
    // whole board at last-known state with zero signal. Keep the last-known rows
    // (do NOT call setTeams on failure) and mark the board stale instead.
    try {
      const { teams } = await listRunTeams({ gameId, runId });
      // Did anything actually move? Only a provably unchanged board accrues back-off.
      const fingerprint = teamsFingerprint(teams);
      quietPollsRef.current = teamsFingerprintRef.current === fingerprint
        ? quietPollsRef.current + 1
        : 0;
      teamsFingerprintRef.current = fingerprint;
      setTeams(teams);            // last-known replaced only on SUCCESS
      setLastTeamsSyncAt(Date.now());
      setTeamsStale(false);
    } catch (e) {
      console.warn('[RunConsole] teams poll failed', e);
      // A failed poll says nothing about whether the field moved, so it must not
      // accrue back-off — that would slow the console down exactly when it is
      // already struggling to see the run.
      quietPollsRef.current = 0;
      setTeamsStale(true);        // keep the last board on screen, just mark it stale
    }
  }, [gameId, runId]);

  // Self-rescheduling instead of a flat setInterval, because the delay is a function
  // of what the last poll saw. Pauses entirely on a hidden tab and on a finished run;
  // returning to the tab polls immediately at full speed rather than waiting out a
  // back-off that was earned while nobody was watching.
  useEffect(() => {
    if (!gameId || !runId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const schedule = () => {
      if (cancelled) return;
      const delay = teamsPollDelayFor({
        hidden: isHidden(), runStatus: run?.status, quietPolls: quietPollsRef.current,
      });
      // null = paused. The visibilitychange listener and this effect's own
      // run?.status dependency are what re-arm it.
      if (delay === null) return;
      timer = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      await loadTeams();
      schedule();
    };

    const onVisibility = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (isHidden()) return;
      quietPollsRef.current = 0;
      void tick();
    };

    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadTeams, gameId, runId, run?.status]);

  // Keep the leaderboard snapshot fresh mid-run so the teams table + live
  // standings panel (both read the snapshot, the SAME source the TV/public board
  // uses) don't look "stuck" between manual refreshes. Skips a finished run and a
  // frozen board (the freeze feature must win — refreshLeaderboard recomputes even
  // when frozen, so we simply don't call it while frozen). No busy flag: this must
  // not disable the action buttons every interval.
  useEffect(() => {
    if (!gameId || !runId) return;
    if (run?.status === 'finished' || run?.leaderboard?.frozen) return;
    const id = setInterval(() => {
      refreshLeaderboard({ ownerUid, gameId, runId }).catch(() => undefined);
    }, 15000);
    return () => clearInterval(id);
  }, [gameId, runId, ownerUid, run?.status, run?.leaderboard?.frozen]);

  // A FINISHED run's teams / feed / chat no longer change, so a live listener on
  // them is pure cost that never fires again — and these three were lifted to the
  // page, so they now open for every console visit rather than only when someone
  // expanded the panel. Read once when the run is over, subscribe only while it
  // is live. Returns an unsubscribe (or undefined for the one-shot read).
  const watchOrRead = (
    ref: Query<DocumentData>,
    live: boolean,
    onData: (snap: QuerySnapshot<DocumentData>) => void,
    onError: (err: unknown) => void = () => undefined,
  ): (() => void) | undefined => {
    if (!live) {
      let cancelled = false;
      getDocs(ref).then((snap) => { if (!cancelled) onData(snap); }).catch(onError);
      return () => { cancelled = true; };
    }
    return onSnapshot(ref, onData, onError);
  };
  const runLive = run?.status !== 'finished';

  // ── Moderation + report feeds (change: run-console-progressive-disclosure) ──
  // These listeners live HERE and not inside their panels. The disclosure plan
  // decides whether a FOLDED group renders and what its header badge says, and a
  // collapsed group renders no children, so a panel that never mounted could
  // never report its own count. One place owns the numbers; the panels render.
  const [teamDocs, setTeamDocs] = useState<SubmissionTeamDoc[]>([]);
  // A read failure must NOT look like "no pending photos": at a live event a
  // manager would silently miss submissions. The listener auto retries, so this
  // clears itself on the next good snapshot.
  const [photoLoadError, setPhotoLoadError] = useState(false);
  useEffect(() => {
    if (!gameId || !runId) return;
    setPhotoLoadError(false);
    const ref = collection(db, FIRESTORE_PATHS.teamsCol(ownerUid, gameId, runId));
    return watchOrRead(ref, runLive, (snap) => {
      setPhotoLoadError(false);
      setTeamDocs(snap.docs.map((d) => {
        const data = d.data() as { displayName?: string; taskSubmissions?: Record<string, RawSubmission> };
        return { id: d.id, displayName: data.displayName, taskSubmissions: data.taskSubmissions };
      }));
    }, (err) => {
      console.warn('[RunConsole] submissions listener error', err);
      setPhotoLoadError(true);
    });
  }, [gameId, runId, ownerUid, runLive]);
  const photoQueues = useMemo(() => buildSubmissionQueues(teamDocs), [teamDocs]);
  // Everything the review queue's pending/reviewed split does NOT show on its
  // own: an autoApproved item, an already-rejected one — same source snapshot,
  // no extra listener.
  const mediaGalleryRows = useMemo(() => buildRunMediaGallery(teamDocs), [teamDocs]);
  // A finished team's submission still scores, but nobody is blocked on it, so
  // the review queue must not let it sit in front of a team still in the street.
  const finishedTeamIds = useMemo(() => teams.filter((t) => t.finished).map((t) => t.id), [teams]);

  const [feedItems, setFeedItems] = useState<FeedItemRow[]>([]);
  useEffect(() => {
    if (!gameId || !runId) return;
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems`),
      where('active', '==', true),
      // COST BOUND (why, not what): Firestore reads cannot be hard-capped on
      // Blaze — no user-lowerable read quota exists — so an unbounded listener
      // over a collection that grows for the whole run is the uncapped billing
      // tail. This console is left OPEN on a laptop for hours, and every
      // reconnect re-reads the feed from doc one. The panel is a recency wall of
      // photos, so the newest 100 is everything a moderator acts on.
      // The orderBy is load-bearing: feed docs carry Firestore auto-IDs, so a
      // bare limit() would order by __name__ and return an ARBITRARY 100 —
      // dropping the photo that just landed, which is exactly the one being
      // moderated. `createdAt` is the ISO string stamped by writeFeedItem.
      // ⚠ DEPLOY ORDER: `active` + `createdAt` needs the composite index in
      // firestore.indexes.json, and the emulator auto-indexes so a missing one
      // is invisible in dev and fails only in production. Indexes must ship
      // BEFORE this code: `deploy:all` is safe (deploy:backend precedes
      // deploy:hosting); a hosting-only deploy against an unindexed project is
      // not. (`watchOrRead` degrades a finished run to a one-shot getDocs — same
      // query, so the same index and the same bound apply there.)
      orderBy('createdAt', 'desc'),
      limit(FEED_WINDOW),
    );
    return watchOrRead(ref, runLive, (snap) => {
      const rows = snap.docs.map((d) => ({ ...(d.data() as Omit<FeedItemRow, 'id'>), id: d.id }));
      rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setFeedItems(rows);
    }, () => undefined);
  }, [gameId, runId, ownerUid, runLive]);

  const [chatThreads, setChatThreads] = useState<ChatThreadRow[]>([]);
  // Seen markers, PERSISTED per run+team (change: team-chat-unread-accuracy).
  // They used to live in React state alone, so reloading the console (or simply
  // remounting this page) reset them to {} and re-flagged EVERY non-empty
  // thread as unread — including threads whose only new message was HQ's own
  // reply. Read lazily per thread; written when a thread is opened/read.
  const [chatSeen, setChatSeen] = useState<Record<string, ChatSeenMarker>>({});
  useEffect(() => {
    if (!gameId || !runId) return;
    const ref = collection(db, FIRESTORE_PATHS.runChatCol(ownerUid, gameId, runId));
    return watchOrRead(ref, runLive, (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as { messages?: ChatMessage[]; updatedAt?: string };
        return { teamId: d.id, messages: data.messages ?? [], updatedAt: data.updatedAt ?? '' };
      });
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setChatThreads(rows);
    }, () => undefined);
  }, [gameId, runId, ownerUid, runLive]);
  // Storage access stays best-effort (private mode / storage off ⇒ "nothing
  // seen", the safe direction: a spurious badge beats a missed message).
  const chatMarkerFor = useCallback((teamId: string): ChatSeenMarker => {
    if (chatSeen[teamId]) return chatSeen[teamId];
    try { return parseChatSeen(localStorage.getItem(chatSeenStorageKey(runId ?? '', teamId))); }
    catch { return {}; }
  }, [chatSeen, runId]);
  const markChatRead = useCallback((teamId: string, messages: ChatMessage[]) => {
    const marker = chatSeenMarker(messages);
    try { localStorage.setItem(chatSeenStorageKey(runId ?? '', teamId), serializeChatSeen(marker)); }
    catch { /* storage off */ }
    setChatSeen((s) => (s[teamId]?.lastSeenId === marker.lastSeenId ? s : { ...s, [teamId]: marker }));
  }, [runId]);
  const unreadChatThreads = chatThreads.reduce(
    (n, th) => n + (countUnreadChatMessages(th.messages, chatMarkerFor(th.teamId), ownerUid) > 0 ? 1 : 0), 0);

  // Survey results, loaded here for the same reason (a folded group's panel
  // cannot load them and then say how many there are).
  const [surveyResults, setSurveyResults] = useState<SurveyResultRow[] | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  // A swallowed error left this card permanently blank, with a spinner line and
  // no way to tell "no surveys in this game" from "the load failed"
  // (change: run-console-clarity).
  const [surveyError, setSurveyError] = useState(false);
  const loadSurvey = useCallback(() => {
    if (!gameId || !runId) return;
    setSurveyLoading(true);
    setSurveyError(false);
    getRunSurveyResults({ gameId, runId })
      .then((d) => setSurveyResults(d.results))
      .catch(() => setSurveyError(true))
      .finally(() => setSurveyLoading(false));
  }, [gameId, runId]);
  useEffect(() => { loadSurvey(); }, [loadSurvey]);

  // Task titles, so the review queue shows a task's NAME where it used to print
  // a raw Firestore id. One owner scoped read of a game the owner already holds.
  const [taskTitles, setTaskTitles] = useState<Map<string, string>>(new Map());
  // Which game is live, for the console header. Display only — the same
  // owner-scoped read that builds taskTitles already returns it.
  const [gameTitle, setGameTitle] = useState('');
  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    getGame({ gameId })
      .then(({ game }) => {
        if (!alive) return;
        setGameTitle(game.title ?? '');
        const map = new Map<string, string>();
        for (const stage of game.stages ?? []) {
          for (const task of stage.tasks ?? []) map.set(task.id, task.title);
        }
        setTaskTitles(map);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [gameId]);

  // Which section of the rail this creator was last on for this run. A display
  // preference only (run docs are server write only); malformed or stale storage
  // degrades to the default section (resolveSectionWithReason) instead of throwing, and
  // never leaves the console showing nothing.
  const [sectionPref, setSectionPref] = useState<string | null>(null);
  useEffect(() => {
    if (!runId) return;
    try { setSectionPref(localStorage.getItem(sectionStateKey(runId))); }
    catch { setSectionPref(null); }
  }, [runId]);
  const openSection = useCallback((id: SectionId) => {
    setSectionPref(id);
    try { localStorage.setItem(sectionStateKey(runId ?? ''), id); } catch { /* storage off */ }
  }, [runId]);
  // Live DOM handles for the PINNED panels, so a chip whose target is pinned can
  // scroll it into view + flash it. The registry is populated as the pinned lanes
  // render (see the pinned <PanelLanes panelRef=…>); a section-lane panel is never
  // registered here because navigating to it opens its section instead.
  const pinnedPanelRefs = useRef<Partial<Record<PanelId, HTMLElement | null>>>({});
  const [flashedPanel, setFlashedPanel] = useState<PanelId | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  // A triage chip navigates to the panel that ANSWERS it. Where a panel lives is
  // answered by the layout module, never re-decided here, so a chip can never
  // point at a section that does not hold its panel. A pinned target is already
  // mounted but may be below the fold on a phone or a long console, so tapping
  // (e.g.) SOS must SCROLL to it and flash it — never be a dead click.
  const goToPanel = useCallback((panel: PanelId) => {
    const where = panelPlacement(panel);
    if (where !== 'pinned') { openSection(where); return; }
    const el = pinnedPanelRefs.current[panel];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try { el.focus({ preventScroll: true }); } catch { /* focus is best effort */ }
    setFlashedPanel(panel);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashedPanel(null), 1600);
  }, [openSection]);

  // How many lanes this viewport can carry. One mechanism only (useMediaQuery,
  // from the mobile-responsive pass) and it answers "phone" with no `window`.
  const mediumViewport = useMediaQuery(CONSOLE_MEDIUM_QUERY);
  const wideViewport = useMediaQuery(CONSOLE_WIDE_QUERY);
  const columns = consoleColumnCount({ medium: mediumViewport, wide: wideViewport });


  const ctx = { ownerUid, gameId: gameId!, runId: runId! };

  async function startAll() {
    // Unlock audio on this user gesture so the SOS cue can play later (autoplay).
    unlockAudio();
    // Starting every team's race clock used to fire with nothing said, while
    // "End run" one row below did confirm (change: run-console-clarity).
    if (!(await confirmAction('startTeams'))) return;
    setBusy(true);
    // A team held for guardian consent used to be subtracted from `launched` with
    // nothing said, so this toasted unqualified success over a no-op (change:
    // expose-enforced-settings). The server now reports the hold; say so.
    try {
      const res = await startTeams({ gameId: gameId!, runId: runId! });
      await loadTeams();
      const heldForConsent = res?.heldForConsent ?? 0;
      if (heldForConsent > 0) {
        toast.info(t.runConsole.heldForConsent({ launched: res?.launched ?? 0, held: heldForConsent }));
      } else {
        toast.success(t.runConsole.startedAllTeams);
      }
    }
    catch { await dialog.alert(t.runConsole.startFailed); }
    finally { setBusy(false); }
  }
  async function finalize() {
    // Ending the run is the one irreversible, everyone affecting action. Warn how
    // many teams are still racing (launched, not finished) so the host cannot end
    // it out from under a field full of players (item 2). Zero ⇒ the plain copy.
    const stillRacing = teams.filter((tm) => tm.launched && !tm.finished).length;
    const message = stillRacing > 0
      ? t.runConsole.finalizeConfirmMessageWithRacing({ n: stillRacing })
      : t.runConsole.finalizeConfirmMessage;
    if (!(await dialog.confirm(message, t.runConsole.finalizeConfirmTitle, true))) return;
    setBusy(true);
    try { await finalizeRun({ gameId: gameId!, runId: runId! }); toast.success(t.runConsole.finalizedRun); }
    catch { await dialog.alert(t.runConsole.finalizeFailed); }
    finally { setBusy(false); }
  }
  async function invite() {
    // A click gesture — also unlock audio for the SOS cue.
    unlockAudio();
    const name = await dialog.prompt(t.runConsole.staffNamePrompt);
    if (!name) return;
    try {
      const { pin } = await inviteStaff({ ...ctx, name, permissions: ['announce', 'review_photos', 'track_locations'] });
      setStaffPin(pin);
      // The PIN + staff link render inside the share section, so navigate there:
      // a host must never have to hunt for what they just created.
      openSection('shareAndScreens');
    } catch { await dialog.alert(t.runConsole.staffInviteFailed); }
  }
  async function refreshStandings(publish?: boolean) {
    // Turning the board ON is a PUBLIC act: one click and every player, plus
    // anyone holding the public link, sees the live standings. Turning it off
    // takes nothing away that was not already seen, so it is not confirmed.
    if (publish === true && !(await confirmAction('publishStandings'))) return;
    setBusy(true);
    // Was a `finally` with no `catch`, called un-awaited from two buttons — so a
    // failed publish to the teams/TV screen was an unhandled rejection and the
    // creator saw nothing. It also had no success signal, which made a working
    // refresh indistinguishable from a dead button.
    try {
      await refreshLeaderboard({ ...ctx, ...(publish === undefined ? {} : { publish }) });
      toast.success(t.runConsole.standingsRefreshed);
    }
    catch (e) { reportFailure(e, 'refreshLeaderboard'); }
    finally { setBusy(false); }
  }
  async function ack(alertId: string) {
    // "Acknowledge" reads as "seen", but the alerts listener queries
    // `acknowledged == false`, so the row never comes back. Say so first
    // (change: run-console-clarity).
    if (!(await confirmAction('acknowledgeAlert'))) return;
    // An SOS acknowledgement is not a place for an unexplained non-event: the
    // alert simply staying on screen is a hint, not a message.
    try { await acknowledgeAlert({ ...ctx, alertId }); }
    catch (e) { reportFailure(e, 'acknowledgeAlert'); }
  }
  // In-flight guard, keyed per alert id, so a double-tap on a raised SOS between
  // the tap and the next snapshot can't double-fire acknowledgeAlert — while a
  // different alert row can still act (change: run-console-action-feedback).
  const ackAction = useAsyncAction(ack, (alertId: string) => alertId);
  // In-flight guard, keyed per team id, so a double-tap on a held team's release
  // can't double-fire clearTeamOutOfBounds — while a different team row can still
  // act. Mirrors ackAction; the sibling row actions are guarded by their confirm
  // modals, but this one fires immediately on click. Declared here (before any
  // early return) so the hook order is stable — letTeamBackIn is a hoisted
  // function declaration, so referencing it above its definition is fine.
  const letBackInAction = useAsyncAction(letTeamBackIn, (team: RunTeamRow) => team.id);
  // Sharing a board/TV link implies the audience should see standings — publish
  // on share so the projection screen never sits on "not yet available".
  // EXCEPTION (change: manual-leaderboard-reveal): once the run is finished the
  // published flag IS the staged-reveal decision finalizeRun made from the game
  // setting. Auto publishing here would silently reveal the winner the moment the
  // host copies the TV/ceremony link — which is exactly the link they are meant to
  // open BEFORE revealing. After finish, reveal is only ever the explicit button.
  async function ensureBoardPublished() {
    if (run?.leaderboard?.published) return;
    if (run?.status === 'finished') return;
    // This used to be a bare `catch {}`: the host copied the TV link, walked to
    // the projector and found "not yet available" with nothing ever having said
    // the publish failed (change: run-console-clarity).
    try { await refreshLeaderboard({ ...ctx, publish: true }); }
    catch (e) { reportFailure(e, 'publishOnShare'); }
  }
  async function revealStandings() {
    if (!(await confirmAction('revealStandings'))) return;
    setBusy(true);
    try { await refreshLeaderboard({ ...ctx, publish: true }); toast.success(t.runConsole.standingsRevealed); }
    catch { await dialog.alert(t.runConsole.revealFailed); }
    finally { setBusy(false); }
  }

  if (!run) {
    if (runNotFound || runLoadErr) {
      return (
        <div className="max-w-2xl mx-auto animate-fade-up">
          <Card className="p-8 text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <p className="text-sm text-[--ink-2] mb-4">{t.runConsole.runNotFound}</p>
            <Button onClick={() => nav('/live')}>{t.runConsole.backToRuns}</Button>
          </Card>
        </div>
      );
    }
    return <Spinner label={t.runConsole.loadingRun} />;
  }

  const finished = run.status === 'finished';
  const rc = t.runConsole;
  // Narrowed once, so the panel renderers below do not each need a non null assertion.
  const activeRun = run;

  // Single source of truth for the number we show organizers: the ranked score
  // from the (auto-refreshed) leaderboard snapshot — the SAME value the live
  // standings panel, the TV screen, and the public board render. The teams
  // table joins each row to its ranking entry by teamId so it can never show a
  // different number than the panel right below it.
  const rankedScoreById = new Map<string, number>(
    (run.leaderboard?.rankings ?? []).map((r) => [r.teamId, r.score]),
  );

  // Who is in trouble RIGHT NOW (change: run-console-attention). The table used
  // to render a team standing still for 25 minutes exactly like a team deep in a
  // long task. Recomputed on each render (the rows repoll every 5s) and never
  // persisted: the verdict is a view of the current projection, not state.
  const attentionNow = Date.now();
  const attentionCtx = buildAttentionContext(teams, attentionNow);
  const attentionById = new Map<string, TeamAttention>(
    teams.map((tm) => [tm.id, classifyTeamAttention(tm, attentionCtx, attentionNow)]),
  );
  const attentionCount = teams.reduce(
    (n, tm) => n + (attentionById.get(tm.id)?.level !== 'ok' ? 1 : 0), 0,
  );
  // Alert types are STORED enum values. A new one must never reach a human as
  // its raw string (change: run-console-clarity).
  const ALERT_TYPE_LABELS: Record<string, string> = {
    sos: rc.alertTypeSos, technical: rc.alertTypeTechnical, stationary: rc.alertTypeStationary,
  };
  const attentionReasonLabel: Record<AttentionReason, string> = {
    outOfBounds: rc.attentionOutOfBounds,
    answerLockout: rc.attentionAnswerLockout,
    gpsSilent: rc.attentionGpsSilent,
    idle: rc.attentionIdle,
    awaitingReview: rc.attentionAwaitingReview,
  };

  // ONE pass decides which panels render, which group each sits in, and what a
  // folded group reports on its header, so a badge and its panel can never
  // disagree (change: run-console-progressive-disclosure). Panel visibility is
  // decided ONLY here: no `{!finished && …}` conditions in the body.
  const runStatus: RunStatus = run.status === 'finished' ? 'finished'
    : run.status === 'draft' ? 'draft' : 'live';
  // Stops taken out of play for THIS run only (change: live-task-pause). The
  // number is a state the organizer chose and used to be visible only by
  // opening the availability panel.
  const pausedTaskCount = Object.values(activeRun.taskStatusOverrides ?? {})
    .filter((s) => s !== 'active').length;
  // Submissions whose team has been standing still past the overdue tier: the
  // only queue in the console that BLOCKS a player.
  const overduePhotoCount = buildReviewQueueView(photoQueues.pending, {
    nowMs: attentionNow, finishedTeamIds, failures: {},
  }).filter((i) => i.tier === 'overdue' && !i.teamFinished).length;
  const SHARE_LINK_COUNT = SHARE_ARTIFACT_IDS.length;

  const plan = buildRunConsolePlan({
    status: runStatus,
    teamCount: teams.length,
    alertCount: alerts.length,
    pendingPhotoCount: photoQueues.pendingCount,
    photoQueueCount: photoQueues.pending.length + photoQueues.reviewed.length + (photoLoadError ? 1 : 0),
    feedItemCount: feedItems.length,
    mediaGalleryCount: mediaGalleryRows.length,
    chatThreadCount: chatThreads.length,
    unreadChatThreads,
    hotZoneActive: !!run.hotZone && hotZoneMultiplier(run.hotZone, run.hotZone.center, Date.now()) > 1,
    hasLeaderboard: (run.leaderboard?.rankings.length ?? 0) > 0,
    hasStaffPin: !!staffPin,
    surveyResultCount: surveyResults === null ? null : surveyResults.length,
    // A rail entry that reports nothing is a rail entry nobody opens
    // (change: run-console-clarity).
    attentionTeamCount: attentionCount,
    pausedTaskCount: pausedTaskCount,
    shareLinkCount: SHARE_LINK_COUNT,
  });
  // The rail's destinations, the one that is showing, and the lane layouts for
  // the pinned zone and for that section. All decided by the pure module.
  const sections = buildRunConsoleSections(plan);
  // Not just WHICH section, but WHY: a section that emptied under the
  // organizer's feet used to be replaced silently, which reads as the app
  // losing their place (change: run-console-clarity).
  const resolution = resolveSectionWithReason(sections, sectionPref, runStatus);
  const activeSection = resolution.id;
  const pinnedLayout = buildPinnedLayout(plan, columns, { teamCount: teams.length });
  const sectionPanels = sections.find((s) => s.id === activeSection)?.panels ?? [];
  const sectionLayout = assignPanelColumns(sectionPanels, sectionColumnCount(columns));

  const groupTitles: Record<SectionId, string> = {
    teamsAndScores: rc.groupTeams,
    moderation: rc.groupModeration,
    gameMechanics: rc.groupMechanics,
    shareAndScreens: rc.groupShare,
    afterTheRun: rc.groupAfter,
  };

  // ── What needs the organizer right now (change: run-console-clarity) ───────
  // Pure verdict, rendered as one chip row under the header so it is visible
  // whatever section the rail is showing. A quiet run produces [] and this
  // renders nothing at all.
  const signals = buildRunSignals({
    status: runStatus,
    alertCount: alerts.length,
    outOfBoundsCount: teams.filter((tm) => tm.outOfBounds).length,
    overduePhotoCount: overduePhotoCount,
    pendingPhotoCount: photoQueues.pendingCount,
    stuckTeamCount: teams.filter((tm) => attentionById.get(tm.id)?.level === 'stuck').length,
    heldForConsentCount: teams.filter((tm) => tm.heldForConsent).length,
    unreadChatThreads,
    pausedTaskCount,
    teamCount: teams.length,
    unstartedTeamCount: teams.filter((tm) => !tm.launched && !tm.finished).length,
  });
  const signalLabel = (s: RunSignal): string => rc.signal[s.id]({ n: s.count });
  // The single most urgent signal, for the polite live region (item 6). `signals`
  // is already severity sorted, so the first critical entry is the top one.
  const criticalSignal = signals.find((s) => s.severity === 'critical') ?? null;

  // What a rail entry says about a section the organizer is NOT looking at.
  // The chips themselves are DECIDED by the layout module (summaryChips), so a
  // section can never render a blank badge; this only turns a key into copy.
  const CHIP_COLOR: Record<'neutral' | 'warn' | 'alert', 'zinc' | 'gold' | 'red'> = {
    neutral: 'zinc', warn: 'gold', alert: 'red',
  };
  const chipText: Record<SummaryChipKey, (n: number) => string> = {
    attention: (n) => rc.chip.attention({ n }),
    pendingPhotos: (n) => rc.chip.pendingPhotos({ n }),
    unreadChats: (n) => rc.chip.unreadChats({ n }),
    hotZone: () => rc.chip.hotZone(),
    pausedTasks: (n) => rc.chip.pausedTasks({ n }),
    teams: (n) => rc.chip.teams({ n }),
    shareLinks: (n) => rc.chip.shareLinks({ n }),
    reports: (n) => rc.chip.reports({ n }),
    panels: (n) => rc.chip.panels({ n }),
  };
  function groupMeta(s: GroupSummary) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        {summaryChips(s).map((chip) => (
          <Badge key={chip.key} color={CHIP_COLOR[chip.tone]}>{chipText[chip.key](chip.value)}</Badge>
        ))}
      </span>
    );
  }

  /**
   * Ask before an action that reaches every team or the public, using the ONE
   * consequence table so the sentence in the dialog and the classification that
   * demanded it can never disagree (change: run-console-clarity).
   */
  async function confirmAction(id: RunActionId): Promise<boolean> {
    if (!runActionNeedsConfirm(id)) return true;
    const key = runActionConsequence(id).copyKey as keyof typeof rc.consequence;
    return dialog.confirm(rc.consequence[key], rc.confirmTitle, classifyRunAction(id) === 'destructive');
  }

  async function adjustScore(team: RunTeamRow) {
    const raw = await dialog.prompt(rc.scoreAdjustmentPrompt);
    const delta = parseScoreDelta(raw);
    // `parseInt(v) || 0` used to send a zero delta for any garbage input,
    // writing a permanent audit entry for a change that never happened.
    if (delta === null) { if (raw != null && raw.trim() !== '') await dialog.alert(rc.scoreAdjustmentInvalid); return; }
    const signed = delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
    // Show the arithmetic (item 8): this is irreversible, audit logged and can
    // decide a winner, yet it used to ask for a blind signed delta. The current
    // number is the SAME ranked score the row renders, so the anchor can never
    // disagree with what the operator is looking at.
    const current = rankedScoreById.get(team.id) ?? team.score;
    if (!(await dialog.confirm(
      rc.adjustScoreConfirmWithScore({ team: team.displayName, delta: signed, current, result: current + delta }),
      rc.adjustScoreConfirmTitle, true,
    ))) return;
    // This had NO try/catch and was invoked as `void adjustScore(team)`: a
    // rejection was an unhandled promise rejection, `loadTeams()` never ran, the
    // table kept the old number — and the creator believed the correction landed.
    // At a live event that is a wrong winner.
    try {
      await adjustTeamScore({ ...ctx, teamId: team.id, delta, reason: 'manual' });
      await loadTeams();
      toast.success(rc.adjustScoreApplied({ team: team.displayName, delta: signed }));
    } catch (e) {
      reportFailure(e, 'adjustTeamScore');
    }
  }

  // Out-of-bounds recovery: the ONLY human escape hatch from the safe-zone latch.
  // Before this existed, a team whose phone could not produce a good fix inside the
  // zone was blocked from receiving tasks for the rest of the run and nobody —
  // staff or creator — could do anything about it.
  async function letTeamBackIn(team: RunTeamRow) {
    try {
      await clearTeamOutOfBounds({ ...ctx, teamId: team.id, reason: 'staff release' });
      await loadTeams();
      toast.success(rc.letBackInDone({ team: team.displayName }));
    }
    catch { await dialog.alert(rc.letBackInFailed); }
  }

  async function skipTeamStage(team: RunTeamRow) {
    // The label said "skip"; it skipped the team's WHOLE STAGE. The consequence
    // table now says so out loud (change: run-console-clarity).
    if (!(await confirmAction('skipStage'))) return;
    try {
      await skipStage({ gameId: gameId!, runId: runId!, teamId: team.id });
      await loadTeams();
      toast.success(rc.skipStageDone({ team: team.displayName }));
    }
    catch { await dialog.alert(rc.skipFailed); }
  }

  // Skip ONE mission (change: skip-single-task). The stage-wide skip above used to
  // be the only option, so removing one unreachable stop also destroyed every other
  // stop the team still had. No taskId is sent: the server resolves the mission the
  // team is holding right now, which is what the operator is looking at.
  async function skipTeamTask(team: RunTeamRow) {
    if (!(await confirmAction('skipTask'))) return;
    try {
      await skipTaskForTeam({ ...ctx, teamId: team.id, reason: 'staff skip' });
      await loadTeams();
      toast.success(rc.skipTaskDone({ team: team.displayName }));
    } catch { await dialog.alert(rc.skipTaskFailed); }
  }

  function renderPanel(panel: PanelId) {
    switch (panel) {
      // ── Pinned zone. Addressed by id like every other panel so the lane
      //    layout (not a hardcoded span) decides where each one sits.
      case 'joinShare': return <JoinShare accessCode={activeRun.accessCode} />;
      case 'stationQr': return <StationQrPrint gameId={gameId!} />;
      case 'broadcast': return <AnnouncementCard ctx={ctx} teams={teams} />;

      // Live SOS / alerts — the organizer sees these the moment a team raises one.
      case 'alerts':
        return (
          <PanelShell panel="alerts" tone="alert" badge={<Badge color="red">{rc.activeAlerts({ n: alerts.length })}</Badge>}>
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                  {/* A new alert type must not reach a human as its stored enum
                      value in whatever language the database holds it. */}
                  <span className="text-rp-alert font-medium">
                    {resolveEnumLabel(a.type, ALERT_TYPE_LABELS, (id) => rc.unknownAlertType({ id }))}
                  </span>
                  {/* A host cannot act on a truncated document id: show the team's name. */}
                  <span dir="auto" className="text-[--ink-3] text-xs">
                    {resolveTeamLabel(a.teamId, teams, (id) => rc.unknownTeam({ id }))}
                  </span>
                  {a.message && <span dir="auto" className="text-[--ink-2] flex-1 truncate">{a.message}</span>}
                  {a.lat != null && a.lng != null && (
                    <a className="text-rp-fire text-xs underline" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">{rc.map}</a>
                  )}
                  <Button
                    variant={runActionVariant('acknowledgeAlert')}
                    className="min-h-0 px-2.5 py-1 text-xs rounded-lg ms-auto"
                    disabled={ackAction.isBusy(a.id)}
                    onClick={() => void ackAction.run(a.id)}
                  >
                    {rc.acknowledge}
                  </Button>
                </div>
              ))}
            </div>
          </PanelShell>
        );

      // Routine live-ops actions. Ending the run is NOT here: it sits in its own
      // separated end-of-run row at the bottom of the console.
      case 'startTeams':
        return (
          <PanelShell panel="startTeams">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={runActionVariant('startTeams')} disabled={busy} onClick={startAll}>{rc.startAllTeams}</Button>
              <Button variant={runActionVariant('refreshStandings')} disabled={busy} onClick={() => refreshStandings()}>{rc.refreshStandings}</Button>
              <Button variant={runActionVariant('inviteStaff')} onClick={invite}>{rc.inviteStaffPin}</Button>
            </div>
          </PanelShell>
        );

      // Live team map — where every team is right now, fed by GPS pings.
      case 'liveMap':
        return (
          <PanelShell panel="liveMap">
            <LiveTeamMap ownerUid={ownerUid} gameId={gameId!} runId={runId!} teams={teams} className="h-80" />
          </PanelShell>
        );

      case 'teams':
        return (
          <PanelShell
            panel="teams"
            /* The count answers the organizer's actual mid-event question
               before they read a single row. Absent when nobody is flagged, so
               a clean run stays visually clean. */
            badge={attentionCount > 0 ? <Badge color="gold">{rc.attentionCount({ n: attentionCount })}</Badge> : undefined}
          >
            {/* Live-stream resilience: a failed teams poll keeps the last-known
                rows below and only marks the board out of date. Unobtrusive,
                role="status", never gates or disables anything. */}
            {isTeamsStale(lastTeamsSyncAt, nowMs, teamsStale) && (
              <p role="status" className="text-[11px] text-rp-amber mb-2 px-1">
                {rc.teamsReconnecting}
                {(() => {
                  const secs = secondsSinceSync(lastTeamsSyncAt, nowMs);
                  return secs != null ? ` · ${rc.lastUpdatedAgo({ seconds: secs })}` : '';
                })()}
              </p>
            )}
            {teams.length === 0 ? (
              <PanelEmpty panel="teams" />
            ) : (
              <div className="space-y-2">
                {teams.map((team) => (
                  <div key={team.id} className="flex flex-wrap items-center gap-3 p-2 rounded-lg bg-[--surface-2]">
                    <div className="flex-1 min-w-[10rem]">
                      <div dir="auto" className="text-sm text-[--ink-2]">{team.displayName}</div>
                      <div className="text-[11px] text-[--ink-3]">
                        {team.finished
                          ? rc.teamStatusFinished
                          : !team.launched
                            ? rc.teamStatusWaiting
                            : team.activeStageOrder != null
                              ? rc.teamStageLabel({ n: team.activeStageOrder + 1 })
                              : rc.teamStatusBetween}
                        {' · '}{rc.stageDone({ n: team.completedStages })}
                      </div>
                      {team.outOfBounds && (
                        <div className="mt-1 text-[11px] text-rp-amber">{rc.outOfBoundsBadge}</div>
                      )}
                      {/* Held-team visibility (change: held-team-visibility).
                          `startTeams` reports how MANY teams it held back; a count
                          with no names is not actionable with a dozen teams milling
                          around. Its own line rather than an attention reason: this
                          is not a temporal signal, and it applies to unlaunched
                          teams, which the attention classifier suppresses by design. */}
                      {team.heldForConsent && (
                        <div className="mt-1 text-[11px] text-rp-amber">{rc.heldForConsentBadge}</div>
                      )}
                      {/* One badge, carrying the REASON: "needs attention" with
                          no cause is a puzzle, not a signal. Suppressed when the
                          safe-zone latch is the only reason, because that already
                          has its own line and its own rescue button on this row. */}
                      {(() => {
                        const at = attentionById.get(team.id);
                        if (!at || at.level === 'ok') return null;
                        if (at.reasons.length === 1 && at.reasons[0] === 'outOfBounds') return null;
                        return (
                          <div className="mt-1">
                            <Badge color={at.level === 'stuck' ? 'red' : 'gold'}>
                              {[
                                at.level === 'stuck' ? rc.attentionStuck : rc.attentionWatch,
                                ...at.reasons.map((r) => attentionReasonLabel[r]),
                              ].join(' · ')}
                            </Badge>
                          </div>
                        );
                      })()}
                    </div>
                    {/* Ranked score from the leaderboard snapshot — identical to
                        the live-standings panel + TV. Falls back to the raw earned
                        tally only until the first snapshot exists for this activeRun. */}
                    <div className="text-rp-fire font-mono font-semibold">
                      {rankedScoreById.get(team.id) ?? team.score}
                    </div>
                    {/* WHICH control sits on the row and which goes behind the
                        overflow is a pure decision (teamRowActions), not a
                        rendering accident: the row had grown to four buttons and
                        was unusable on the phone an organizer actually holds
                        (change: run-console-clarity). */}
                    {(() => {
                      const at = attentionById.get(team.id) ?? { level: 'ok' as const, reasons: [] };
                      const rowActions = teamRowActions(team, at);
                      const render = (id: RunActionId, inMenu: boolean) => {
                        const props = {
                          clearTeamOutOfBounds: {
                            label: rc.letBackIn,
                            aria: rc.letBackInAria({ team: team.displayName }),
                            run: () => void letBackInAction.run(team),
                            disabled: letBackInAction.isBusy(team.id),
                          },
                          skipTask: {
                            label: rc.skipTask,
                            aria: rc.skipTaskAria({ team: team.displayName }),
                            run: () => void skipTeamTask(team),
                            disabled: false,
                          },
                          skipStage: {
                            label: rc.skipStage,
                            aria: rc.skipStageAria({ team: team.displayName }),
                            run: () => void skipTeamStage(team),
                            disabled: false,
                          },
                          adjustTeamScore: {
                            label: rc.adjustScore,
                            aria: rc.adjustScoreAria({ team: team.displayName }),
                            run: () => void adjustScore(team),
                            disabled: false,
                          },
                        }[id as 'clearTeamOutOfBounds' | 'skipTask' | 'skipStage' | 'adjustTeamScore'];
                        return (
                          <Button
                            key={id}
                            variant={runActionVariant(id)}
                            role={inMenu ? 'menuitem' : undefined}
                            className={`min-h-0 px-2.5 py-1 text-[11px] rounded-lg ${inMenu ? 'w-full justify-start text-start' : ''}`}
                            aria-label={props.aria}
                            disabled={props.disabled}
                            onClick={props.run}
                          >
                            {props.label}
                          </Button>
                        );
                      };
                      return (
                        <div className="flex items-center gap-1.5">
                          {/* At most ONE control is ever immediate, and which one
                              is `teamRowActions`' call: the safety release for a
                              held team, otherwise the per-task skip for a team the
                              attention verdict flags as stuck. Everything else is
                              behind the menu. */}
                          {rowActions.inline.map((id) => render(id, false))}
                          <OverflowMenu
                            label={rc.moreActions}
                            ariaLabel={rc.moreActionsAria({ team: team.displayName })}
                          >
                            {rowActions.overflow.map((id) => render(id, true))}
                          </OverflowMenu>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </PanelShell>
        );

      case 'liveStandings':
        return (
          <PanelShell
            panel="liveStandings"
            badge={(
              <Badge color={activeRun.leaderboard!.published ? 'green' : 'zinc'}>
                {activeRun.leaderboard!.published ? rc.standingsVisibleToTeams : rc.standingsHiddenFromTeams}
              </Badge>
            )}
            /* This used to be a raw <button> whose LABEL WAS ITS CURRENT STATE:
               no verb, no aria-pressed, no confirm, and one click from showing
               live standings to every player (change: run-console-clarity). */
            actions={(
              <Button
                variant={runActionVariant('publishStandings')}
                className="min-h-0 px-3 py-1.5 text-xs rounded-lg"
                aria-pressed={activeRun.leaderboard!.published}
                disabled={busy}
                onClick={() => refreshStandings(!activeRun.leaderboard!.published)}
              >
                {activeRun.leaderboard!.published ? rc.standingsHideAction : rc.standingsPublishAction}
              </Button>
            )}
          >
            {/* Show ALL teams — at 20 teams a slice(0,12) hid ranks 13-20 mid-activeRun. */}
            <div className="space-y-1">
              {activeRun.leaderboard!.rankings.map((r) => (
                <div key={r.teamId} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-[--ink-3]">{r.rank}</span>
                  <span dir="auto" className="flex-1 text-[--ink-2]">{r.teamName}</span>
                  <span className="text-[11px] text-[--ink-3]">{rc.stageDone({ n: r.completedStages })}</span>
                  <span className="text-rp-fire font-mono">{r.score}</span>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-[--ink-3] mt-2">
              {rc.organizerOnlyUpdated({ time: new Date(activeRun.leaderboard!.updatedAt).toLocaleTimeString() })}
            </div>
          </PanelShell>
        );

      // The organizer ALWAYS sees the final standings (this reads the run doc
      // directly); `published` only controls the participant surfaces — with
      // manual reveal on, finalizeRun leaves the board unpublished and this
      // button is how the host reveals it.
      case 'finalStandings':
        return (
          <PanelShell
            panel="finalStandings"
            badge={activeRun.leaderboard!.published
              ? <Badge color="green">{rc.standingsVisibleToTeams}</Badge>
              : <Badge color="gold">{rc.standingsHiddenFromTeams}</Badge>}
            actions={!activeRun.leaderboard!.published ? (
              <Button
                variant={runActionVariant('revealStandings')}
                className="min-h-0 px-3 py-1.5 text-xs rounded-lg"
                disabled={busy}
                onClick={() => void revealStandings()}
              >
                {rc.revealStandings}
              </Button>
            ) : undefined}
          >
            {!activeRun.leaderboard!.published && (
              <div className="text-[11px] text-rp-amber mb-3">{rc.standingsHiddenUntilReveal}</div>
            )}
            <div className="space-y-1">
              {activeRun.leaderboard!.rankings.map((r) => (
                <div key={r.teamId} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-[--ink-3]">{r.rank}</span>
                  <span dir="auto" className="flex-1 text-[--ink-2]">{r.teamName}</span>
                  <span className="text-rp-fire font-mono">{r.score}</span>
                </div>
              ))}
            </div>
          </PanelShell>
        );

      case 'hotZone': return <HotZonePanel ctx={ctx} hotZone={activeRun.hotZone ?? null} />;
      case 'flashMission': return <FlashMissionCard ctx={ctx} />;
      case 'trackables': return <TrackablesConsole ownerUid={ownerUid} gameId={gameId!} runId={runId!} teams={teams} />;
      case 'zones': return <ZonesConsole ownerUid={ownerUid} gameId={gameId!} runId={runId!} />;
      case 'taskAvailability':
        return <TaskAvailabilityConsole ctx={ctx} overrides={activeRun.taskStatusOverrides} />;

      case 'photoReview':
        return (
          <PhotoReviewConsole
            ctx={ctx}
            pending={photoQueues.pending}
            reviewed={photoQueues.reviewed}
            pendingCount={photoQueues.pendingCount}
            loadError={photoLoadError}
            taskTitles={taskTitles}
            finishedTeamIds={finishedTeamIds}
          />
        );
      case 'feed': return <FeedConsole ownerUid={ownerUid} gameId={gameId!} runId={runId!} items={feedItems} />;
      case 'mediaGallery': return <RunMediaGalleryConsole rows={mediaGalleryRows} taskTitles={taskTitles} />;
      case 'chat':
        return (
          <ChatConsole
            ctx={ctx}
            teams={teams}
            threads={chatThreads}
            selfUid={ownerUid}
            markerFor={chatMarkerFor}
            onRead={markChatRead}
          />
        );
      case 'staffChannel':
        return <StaffChannelConsole ctx={ctx} selfUid={ownerUid} />;

      case 'shareScreens':
        return (
          <ShareScreens
            accessCode={activeRun.accessCode}
            ctx={ctx}
            status={finished ? 'finished' : 'live'}
            // The card warns "copying this publishes the standings" — so it has to
            // know they are already published, or it cries wolf for the rest of the
            // run (change: post-review-fixes B). Same flag the publish toggle above
            // renders from, and the same one ensureBoardPublished already no-ops on.
            published={!!activeRun.leaderboard?.published}
            hasStaffPin={!!staffPin}
            onShareBoard={ensureBoardPublished}
          />
        );
      case 'staffInvite': return <StaffInviteCard ctx={ctx} pin={staffPin!} />;

      case 'runSummary': return (
        <RunSummaryPanel
          accessCode={activeRun.accessCode}
          // Per-player report (change: post-run-player-report). The summary panel
          // is an AGGREGATE — standings, completion rate, a feedback digest — and
          // the question it always raised next was "what did THIS player actually
          // answer?". That lives on its own route, which unlike this console is
          // still reachable once the run is over and the console is closed.
          reportHref={`/report/${gameId}/${runId}`}
        />
      );
      case 'analytics': return <AnalyticsPanel accessCode={activeRun.accessCode} />;
      case 'heatmap': return <HeatmapPanel accessCode={activeRun.accessCode} />;
      case 'feedback': return <FeedbackPanel gameId={gameId} runId={runId} />;
      case 'survey': return <SurveyResultsPanel results={surveyResults} loading={surveyLoading} loadError={surveyError} onRefresh={loadSurvey} />;

      // The primary zone is rendered inline below, never through this switch.
      default: return null;
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 dir="auto" className="font-brand text-2xl font-extrabold tracking-tight text-[--ink-1]">{gameTitle || rc.liveRun}</h1>
          {gameTitle && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[--ink-3] mt-0.5">{rc.liveRun}</div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge color={finished ? 'zinc' : 'green'}>
              {run.status === 'draft' ? rc.statusDraft
                : run.status === 'finished' ? rc.statusFinished
                : rc.statusLive}
            </Badge>
            {run.billingType && (
              <span className="inline-flex items-center gap-1">
                <Badge color={run.billingType === 'test' ? 'gold' : run.billingType === 'pro' ? 'green' : run.billingType === 'credit' ? 'cyan' : 'zinc'}>
                  {run.billingType === 'test' ? rc.testRun
                    : run.billingType === 'free' ? rc.freeRun
                    : run.billingType === 'pro' ? rc.proRun
                    : rc.creditRun}
                </Badge>
                {/* The four billing chips used to sit beside the status with
                    nothing anywhere explaining what they mean. */}
                <RichTooltip concept="runBilling" />
              </span>
            )}
            <span className="text-[--ink-3] text-sm">
              {rc.participants({ n: run.participantCount ?? teams.length, max: String(run.maxParticipants ?? '∞') })}
            </span>
          </div>
        </div>
      </div>

      {/* ── WHAT NEEDS YOU RIGHT NOW ────────────────────────────────────────────
          One chip row, decided entirely by `buildRunSignals`, sitting under the
          header so it is visible whatever section the rail is showing. Urgency
          used to be computed on every render and then rendered ONLY inside the
          teams panel, so the console could say "6 teams" while three of them
          were stuck and a queue that was BLOCKING players sat off screen. A
          quiet run produces no signals and this renders nothing at all. */}
      {signals.length > 0 && (
        <nav aria-label={rc.signalsTitle} className="flex flex-wrap items-center gap-2">
          {/* A raised SOS already gets an audio cue + a tab title flash, but the
              on screen strip said nothing to a screen reader. This companion
              region announces the single most urgent signal politely, so a screen
              reader operator hears it without the whole strip being read on every
              recompute (change: run-console-hardening, item 6). */}
          <p className="sr-only" role="status" aria-live="polite">
            {criticalSignal ? signalLabel(criticalSignal) : ''}
          </p>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[--ink-3]">{rc.signalsTitle}</span>
          {signals.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goToPanel(s.panel)}
              aria-label={rc.goToSignal({ label: signalLabel(s) })}
              title={rc.goToSignal({ label: signalLabel(s) })}
              className={`inline-flex items-center gap-1 cursor-pointer rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                s.severity === 'critical'
                  ? 'border-rp-alert/40 bg-rp-alert/10 text-rp-alert hover:bg-rp-alert/20'
                  : s.severity === 'warn'
                    ? 'border-rp-amber/40 bg-rp-amber/10 text-rp-amber hover:bg-rp-amber/20'
                    : 'border-[--rp-border] bg-[--surface-2] text-[--ink-2] hover:bg-[--surface-0]'
              }`}
            >
              <span>{signalLabel(s)}</span>
              {/* Marks the chip as a jump target, not a read only badge. Flips with
                  the reading direction so it always points "onward". */}
              <span aria-hidden="true" className="rtl:-scale-x-100">›</span>
            </button>
          ))}
        </nav>
      )}

      {/* ── PINNED ZONE ─────────────────────────────────────────────────────────
          Always on screen, whatever section the rail is showing: an SOS must
          never be one navigation away. The lanes come from the layout module, so
          a run that has just launched no longer leaves two thirds of the widest
          part of the page empty. */}
      {/* The alerts panel only mounts when alertCount > 0, so a dead SOS stream
          sitting at zero alerts would be invisible there. Surface the degraded
          state in the always-rendered pinned zone (change:
          run-console-live-stream-resilience). */}
      {alertsStreamError && (
        <p role="status" className="text-xs text-rp-alert rounded-lg border border-rp-alert/40 bg-rp-alert/5 px-3 py-2">
          {rc.alertsStreamInterrupted}
        </p>
      )}
      <PanelLanes
        layout={pinnedLayout}
        render={renderPanel}
        panelRef={(panel, el) => { pinnedPanelRefs.current[panel] = el; }}
        flashedPanel={flashedPanel}
      />

      {/* ── SECTIONS ────────────────────────────────────────────────────────────
          The accordions are gone. A Builder style rail (StageRail's pattern: a
          vertical rail on a wide screen, a horizontally scrolling strip on a
          phone) picks ONE section and only that section renders. Every panel is
          still reachable: buildRunConsoleSections covers the catalogue. */}
      {activeSection && (
        <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-start">
          <aside className="w-full lg:w-52 shrink-0 lg:sticky lg:top-4">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[--ink-3]">{rc.sectionsHeader}</span>
              <span className="text-[10px] text-[--ink-4]">{sections.length}</span>
            </div>
            <nav
              aria-label={rc.sectionsHeader}
              className="flex lg:flex-col items-stretch gap-2 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0"
            >
              {sections.map((s: RunConsoleSection) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={s.id === activeSection ? 'true' : undefined}
                  onClick={() => openSection(s.id)}
                  className={`text-start rounded-xl border p-2.5 transition-colors w-44 shrink-0 lg:w-auto lg:shrink ${
                    s.id === activeSection
                      ? 'border-rp-fire bg-rp-fire/10'
                      : 'border-[--rp-border] hover:bg-[--surface-2]'
                  }`}
                >
                  <div className="text-sm font-medium text-[--ink-1]">{groupTitles[s.id]}</div>
                  <div className="mt-1">{groupMeta(s.summary)}</div>
                </button>
              ))}
            </nav>
          </aside>

          <section aria-label={groupTitles[activeSection]} className="flex-1 min-w-0 space-y-3">
            {/* Named in the pane too: on a phone the rail scrolls out of view. */}
            <h2 className="text-sm font-semibold text-[--ink-1] px-1">{groupTitles[activeSection]}</h2>
            {/* The console used to TELEPORT: a section that emptied under the
                organizer's feet was replaced with no explanation, which reads as
                the app losing their place (change: run-console-clarity). */}
            {resolution.reason === 'sectionEmptied' && (
              <p role="status" className="text-[11px] text-[--ink-3] px-1">
                {rc.sectionEmptiedNotice({ section: groupTitles[activeSection] })}
              </p>
            )}
            <PanelLanes layout={sectionLayout} render={renderPanel} />
          </section>
        </div>
      )}

      {/* ── End of run ─────────────────────────────────────────────────────────
          Deliberately out of the routine control bar: this ends the game for
          every team, and it used to sit one mis-click from "Refresh standings". */}
      {!finished && (
        <div className="rounded-2xl border border-rp-alert/30 bg-rp-alert/5 p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[14rem]">
            <div className="text-sm font-semibold text-[--ink-1]">{rc.endOfRunTitle}</div>
            <p className="text-xs text-[--ink-3] mt-1 leading-relaxed">{rc.endOfRunHelp}</p>
          </div>
          <Button variant={runActionVariant('finalizeRun')} disabled={busy} onClick={finalize}>{t.liveRuns.endRun}</Button>
        </div>
      )}
    </div>
  );
}


// Renders a computed lane layout (change: run-console-density). The component
// owns NO layout decisions: which panel sits in which lane, how wide each lane
// is and how many lanes there are all come from `runConsoleLayout`, so a panel
// cannot be dropped by a rendering accident. Classes are static lookups because
// Tailwind cannot see an interpolated `grid-cols-${n}`.
function PanelLanes({ layout, render, panelRef, flashedPanel }: {
  layout: ColumnLayout;
  render: (panel: PanelId) => ReactNode;
  // When provided (the pinned zone), each panel wrapper registers its DOM node so
  // a triage chip can scroll + flash it. Section lanes pass neither.
  panelRef?: (panel: PanelId, el: HTMLElement | null) => void;
  flashedPanel?: PanelId | null;
}) {
  if (layout.columns.length === 0) return null;
  return (
    <div className={gridTemplateClass(layout.gridColumns)}>
      {layout.columns.map((lane, i) => (
        <div key={lane.join('|')} className={`space-y-4 min-w-0 ${columnSpanClass(layout.spans[i])}`}>
          {lane.map((panel) => (
            <div
              key={panel}
              ref={panelRef ? (el) => panelRef(panel, el) : undefined}
              tabIndex={panelRef ? -1 : undefined}
              className={`rounded-2xl outline-none transition-shadow ${
                panel === flashedPanel ? 'ring-2 ring-rp-alert ring-offset-2 ring-offset-[--surface-0]' : ''
              }`}
            >
              {render(panel)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── The one panel chrome (change: run-console-clarity) ───────────────────────
//
// Every panel used to invent its own header: an ad hoc inline string, sometimes
// with an emoji baked into the TRANSLATED value, and seven panels had no
// explanation at all. The structure (icon, has an explanation, has an empty
// state) is decided by `runConsolePanelMeta` and the words live in one nested
// dictionary block, so a panel cannot ship unnamed, unexplained, or with an
// empty state that looks exactly like a failure.
function usePanelCopy(panel: PanelId) {
  const t = useT();
  return {
    meta: panelCopy(panel),
    copy: t.runConsole.panel[panel] as { title: string; help: string; empty?: string },
  };
}

function PanelShell({ panel, badge, actions, tone, children }: {
  panel: PanelId;
  badge?: ReactNode;
  actions?: ReactNode;
  tone?: 'alert';
  children?: ReactNode;
}) {
  const { meta, copy } = usePanelCopy(panel);
  return (
    <Card className={`p-4 ${tone === 'alert' ? 'border-rp-alert/40' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium flex flex-wrap items-center gap-1.5 ${tone === 'alert' ? 'text-rp-alert' : 'text-[--ink-1]'}`}>
            <span aria-hidden="true">{meta.icon}</span>
            <span>{copy.title}</span>
            {badge}
          </div>
          <p className="text-[11px] text-[--ink-3] leading-relaxed mt-1">{copy.help}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children != null && <div className="mt-3">{children}</div>}
    </Card>
  );
}

/** The one empty state. "Nothing here" must never look like "this broke". */
function PanelEmpty({ panel }: { panel: PanelId }) {
  const { meta, copy } = usePanelCopy(panel);
  return <EmptyState icon={meta.icon} title={copy.title} body={copy.empty} />;
}

// Access code + shareable join link + QR — participants scan to land in the app
// with the code pre-filled (JoinScreen reads ?code= and auto-looks-up).
// Only the two first-five-minutes artifacts live here now: the code a host reads
// out and the join link/QR players scan. The public board, ceremony, TV, recap
// and staff links moved to the one consolidated "Share and screens" surface
// (change: run-console-progressive-disclosure).
function JoinShare({ accessCode }: { accessCode: string }) {
  const t = useT();
  const link = `${PLAY_URL}/?code=${accessCode}`;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(''));
  }, [link]);
  async function copy() {
    await copyToClipboard(link, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, t.runConsole.copyFailed);
  }
  return (
    <PanelShell panel="joinShare">
      <div className="text-center">
      <div className="text-2xl font-mono font-bold text-rp-fire tracking-[0.3em] mb-2">{accessCode}</div>
      {qr && <img src={qr} alt={t.runConsole.joinQrCode} className="mx-auto rounded-lg bg-white p-1.5 w-36 h-36" />}
      <div className="mt-2 flex flex-col gap-1">
        <button className="text-xs text-rp-fire hover:underline" onClick={copy}>
          {copied ? t.runConsole.linkCopied : t.runConsole.copyJoinLink}
        </button>
      </div>
      {/* Temporary per-run phone ceiling (run-device-cap). Reads the SAME shared
          constant the server enforces, so the number is always correct; hides
          itself automatically once the cap is raised to Infinity (removed). */}
      {isRunDeviceCapActive() && (
        <p dir="auto" className="mt-3 pt-3 border-t border-[--rp-border] text-[11px] leading-relaxed text-rp-amber flex items-start gap-1.5">
          <span aria-hidden="true">⚠️</span>
          <span>{t.runConsole.deviceCapNote({ max: MAX_RUN_DEVICES })}</span>
        </p>
      )}
      </div>
    </PanelShell>
  );
}

// Staff onboarding card — instead of hand-typing three Firebase IDs + the PIN,
// the organizer shares a link/QR that lands staff in the play app's staff sign-in
// with the run context pre-filled (StaffSignIn reads it from the single ?staff param). The PIN is
// deliberately NOT in the link (it's a secret + play-web doesn't read it from the
// URL) — staff read it off this card and type it once.
function StaffInviteCard({ ctx, pin }: { ctx: { ownerUid: string; gameId: string; runId: string }; pin: string }) {
  const t = useT();
  // ONE param, and deliberately no `game=` key: the public promo route reads `game`
  // too, so the old multi-param shape re-resolved to GamePromoScreen (which offers
  // instant play) and turned staff into participants. A valueless `?staff` key was
  // also droppable by QR scanners / link previewers, which misrouted the FIRST scan.
  // Shape must stay in sync with parseStaffParam() in apps/play-web/src/lib/playRoute.ts;
  // that parser still accepts the legacy shape, so links already in the wild keep working.
  const link = `${PLAY_URL}/?staff=${encodeURIComponent(`${ctx.ownerUid}.${ctx.gameId}.${ctx.runId}`)}`;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 160 }).then(setQr).catch(() => setQr(''));
  }, [link]);
  async function copy() {
    await copyToClipboard(link, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, t.runConsole.copyFailed);
  }
  return (
    <PanelShell panel="staffInvite">
      <div className="text-sm flex flex-wrap items-center gap-4">
        {qr && <img src={qr} alt={t.runConsole.staffLinkQrAlt} className="rounded-lg bg-white p-1.5 w-28 h-28 shrink-0" />}
        <div className="flex-1 min-w-[12rem] space-y-1.5">
          <div>
            {t.runConsole.staffPinLabel} <span className="font-mono text-rp-fire text-lg tracking-widest">{pin}</span>
          </div>
          <button className="text-xs text-rp-fire hover:underline" onClick={copy}>
            {copied ? t.runConsole.linkCopied : t.runConsole.staffLinkCopy}
          </button>
          <div className="text-[--ink-3] text-xs leading-relaxed">{t.runConsole.staffLinkNote}</div>
        </div>
      </div>
    </PanelShell>
  );
}

// Printable station QR sheet (change: qr-station-scan). One-shot owner-scoped
// getGame (the owner already legally holds the secret codes), then a printable
// window listing every smart_station: title + QR (RP1: payload the play-web
// scanner decodes) + the human-readable code beneath as a manual fallback. No
// new callable, no sanitizer change — the QR only carries the existing code.
function StationQrPrint({ gameId }: { gameId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
  }

  async function print() {
    if (busy) return;
    setBusy(true);
    try {
      const { game } = await getGame({ gameId });
      const stations = (game.stages ?? [])
        .flatMap((s) => s.tasks ?? [])
        .filter((task) => task.type === 'smart_station' && !!task.smart?.secretCode);
      if (stations.length === 0) {
        await dialog.alert(t.runConsole.printQrEmpty);
        return;
      }
      const cards = await Promise.all(stations.map(async (task) => {
        const code = task.smart!.secretCode!;
        const img = await QRCode.toDataURL(buildStationQrPayload(code), { margin: 1, width: 256 });
        return `
          <section class="station">
            <h2 dir="auto">${escapeHtml(task.title)}</h2>
            <img src="${img}" alt="" />
            <p class="fallback">${escapeHtml(t.runConsole.printQrCodeFallback)}</p>
            <p class="code">${escapeHtml(code)}</p>
          </section>`;
      }));
      const win = window.open('', '_blank');
      if (!win) {
        await dialog.alert(t.runConsole.printQrBlocked);
        return;
      }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
        <title>${escapeHtml(t.runConsole.printQrHeading)}</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
          h1 { font-size: 20px; text-align: center; margin-bottom: 24px; }
          .station { text-align: center; page-break-inside: avoid; margin-bottom: 40px; }
          .station h2 { font-size: 18px; margin: 0 0 12px; }
          .station img { width: 256px; height: 256px; }
          .fallback { font-size: 11px; color: #666; margin: 8px 0 2px; text-transform: uppercase; letter-spacing: 0.1em; }
          .code { font-family: monospace; font-size: 18px; font-weight: bold; margin: 0; }
        </style></head><body>
        <h1>${escapeHtml(t.runConsole.printQrHeading)}</h1>
        ${cards.join('')}
      </body></html>`);
      win.document.close();
      // Print after the images have loaded.
      win.focus();
      win.onload = () => win.print();
      // onload may already have fired for a fast data: URL sheet.
      if (win.document.readyState === 'complete') win.print();
    } catch {
      await dialog.alert(t.runConsole.printQrBlocked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelShell panel="stationQr">
      <Button variant={runActionVariant('printStationQr')} onClick={print} loading={busy}>
        {t.runConsole.printQr}
      </Button>
    </PanelShell>
  );
}

// The announcement is a first-five-minutes control, so it lives in the primary
// zone. Its label used to read "Announcement (persists)", leaking an
// implementation detail where an explanation belongs: the persistence is now
// explained by a tooltip (change: run-console-progressive-disclosure).
function AnnouncementCard({ ctx, teams }: { ctx: { ownerUid: string; gameId: string; runId: string }; teams: RunTeamRow[] }) {
  const t = useT();
  const [msg, setMsg] = useState('');
  const [teamTarget, setTeamTarget] = useState('');   // '' ⇒ all teams (global)
  const [busyMsg, setBusyMsg] = useState(false);

  async function sendAnnouncement() {
    setBusyMsg(true);
    try {
      await pushAnnouncement({ ...ctx, message: msg, ...(teamTarget ? { teamId: teamTarget } : {}) });
      setMsg('');
      toast.success(t.runConsole.announcementSent);
    }
    catch { await dialog.alert(t.runConsole.broadcastFailed); }
    finally { setBusyMsg(false); }
  }

  return (
    <PanelShell panel="broadcast" actions={<RichTooltip concept="announcementPersistence" />}>
      <div className="space-y-2">
      <select
        aria-label={t.runConsole.announceTargetLabel}
        className="w-full rounded-md border border-[--rp-border] bg-zinc-900 px-3 py-2 text-sm text-[--ink-1]"
        value={teamTarget}
        onChange={(e) => setTeamTarget(e.target.value)}
      >
        <option value="">{t.runConsole.announceAllTeams}</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>{t.runConsole.announceToTeam({ name: team.displayName })}</option>
        ))}
      </select>
      <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t.runConsole.announcementPlaceholder} dir="auto" />
      <Button variant={runActionVariant('broadcastAnnouncement')} className="w-full" disabled={!msg || busyMsg} onClick={sendAnnouncement}>
        {t.runConsole.broadcast}
      </Button>
      </div>
    </PanelShell>
  );
}

// A flash mission is an optional game system, not a first-five-minutes control,
// so it sits in the "game systems" group. Its lifetime used to be a bare
// `ttlSeconds: 600` at the call site, knowable only by reading the source: the
// payload and the copy now read the same exported constant.
function FlashMissionCard({ ctx }: { ctx: { ownerUid: string; gameId: string; runId: string } }) {
  const t = useT();
  const [flash, setFlash] = useState('');
  const [pts, setPts] = useState(50);
  const [busyFlash, setBusyFlash] = useState(false);

  async function sendFlash() {
    setBusyFlash(true);
    try {
      await pushFlashMission({ ...ctx, title: flash, bonusPoints: Math.max(0, pts), ttlSeconds: FLASH_MISSION_TTL_SECONDS });
      setFlash('');
      toast.success(t.runConsole.flashSent);
    }
    catch { await dialog.alert(t.runConsole.broadcastFailed); }
    finally { setBusyFlash(false); }
  }

  return (
    <PanelShell panel="flashMission" actions={<RichTooltip concept="flashMission" />}>
      <div className="space-y-2">
        <p className="text-[11px] text-[--ink-3]">{t.runConsole.flashMissionTtlNote({ minutes: FLASH_MISSION_TTL_MINUTES })}</p>
        <Input value={flash} onChange={(e) => setFlash(e.target.value)} placeholder={t.runConsole.flashMissionPlaceholder} dir="auto" />
        <div className="flex gap-2">
          <Input type="number" min="0" value={pts} onChange={(e) => setPts(Math.max(0, parseInt(e.target.value) || 0))} />
          <Button variant={runActionVariant('pushFlashMission')} disabled={!flash || busyFlash} onClick={sendFlash}>
            {t.runConsole.push}
          </Button>
        </div>
      </div>
    </PanelShell>
  );
}


// ── Hot Zone activate panel (hot-zone-bonus) ──────────────────────────────────
function HotZonePanel({ ctx, hotZone }: { ctx: { ownerUid: string; gameId: string; runId: string }; hotZone: HotZone | null }) {
  const t = useT();
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [radius, setRadius] = useState(200);
  const [mult, setMult] = useState(2);
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const reportFailure = useCallFailureToast();

  const active = !!hotZone && hotZoneMultiplier(hotZone, hotZone.center, Date.now()) > 1;

  async function activate() {
    // A hot zone is inherently geographic — require a real point (0,0 = unset).
    if (!isValidCoord(lat, lng) || (lat === 0 && lng === 0)) { void dialog.alert(t.runConsole.hotZoneNeedsCenter); return; }
    setBusy(true);
    // Both of these were a `finally` with no `catch`: a hot zone that failed to
    // start (or to stop) said nothing, and the panel just kept its old state.
    try {
      await activateHotZone({ gameId: ctx.gameId, runId: ctx.runId, center: { lat, lng }, radiusMeters: radius, multiplier: mult, durationMinutes: minutes });
    }
    catch (e) { reportFailure(e, 'activateHotZone'); }
    finally { setBusy(false); }
  }
  async function deactivate() {
    setBusy(true);
    try { await deactivateHotZone({ gameId: ctx.gameId, runId: ctx.runId }); }
    catch (e) { reportFailure(e, 'deactivateHotZone'); }
    finally { setBusy(false); }
  }

  return (
    <PanelShell
      panel="hotZone"
      actions={<RichTooltip concept="hotZone" />}
      badge={active ? <Badge color="red">{t.runConsole.chip.hotZone()}</Badge> : undefined}
    >
      <div className="space-y-3">
      {active && hotZone ? (
        <div className="space-y-2 text-sm">
          <div className="text-rp-fire font-medium">{t.runConsole.hotZoneActive({ mult: hotZone.multiplier })}</div>
          <div className="text-[--ink-3]">{t.runConsole.hotZoneExpires({ time: new Date(hotZone.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</div>
          {/* Switching the zone off is CAUTIONARY, not destructive: it was
              rendered `danger` while classified `cautionary`, so the console's
              colour stopped predicting consequence (change: run-console-clarity). */}
          <Button variant={runActionVariant('deactivateHotZone')} disabled={busy} onClick={deactivate}>{t.runConsole.deactivate}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>{t.runConsole.hotZoneCenter}</Label>
          <LocationStep coordinates={{ lat, lng }} onChange={(la, ln) => { setLat(la); setLng(ln); }} mapClassName="h-52" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div><Label>{t.runConsole.hotZoneRadius}</Label><Input type="number" value={radius} onChange={(e) => setRadius(Math.max(1, Number(e.target.value)))} /></div>
            <div><Label>{t.runConsole.hotZoneMultiplier}</Label><Input type="number" value={mult} min={2} max={5} onChange={(e) => setMult(Math.min(5, Math.max(2, Number(e.target.value))))} /></div>
            <div><Label>{t.runConsole.hotZoneDuration}</Label><Input type="number" value={minutes} min={1} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value)))} /></div>
          </div>
          <Button variant={runActionVariant('activateHotZone')} disabled={busy} onClick={activate}>{t.runConsole.activate}</Button>
        </div>
      )}
      </div>
    </PanelShell>
  );
}

// ── One share surface (change: run-console-progressive-disclosure) ────────────
// A run has SEVEN shareable artifacts, and they used to be spread across three
// cards, two of them labelled with nothing but the emoji '🔗'. Now every one has
// a name, a line saying who it is for, and a named copy action; the URLs come
// from buildShareArtifacts so they are identical to the ones hosts already have.
function ShareScreens({ accessCode, ctx, status, published, hasStaffPin, onShareBoard }: {
  accessCode: string;
  ctx: { ownerUid: string; gameId: string; runId: string };
  status: RunStatus;
  published: boolean;
  hasStaffPin: boolean;
  onShareBoard?: () => Promise<void>;
}) {
  const rc = useT().runConsole;
  const [copied, setCopied] = useState<ShareArtifactId | ''>('');
  const artifacts = buildShareArtifacts({
    playUrl: PLAY_URL, accessCode, ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId,
    hasStaffPin, status, published,
  });

  const NAME: Record<ShareArtifactId, string> = {
    accessCode: rc.shareAccessCodeName, joinLink: rc.shareJoinName, boardLink: rc.shareBoardName,
    ceremonyLink: rc.shareCeremonyName, tvScreen: rc.shareTvName, recap: rc.shareRecapName,
    staffLink: rc.shareStaffName,
  };
  const DESC: Record<ShareArtifactId, string> = {
    accessCode: rc.shareAccessCodeDesc, joinLink: rc.shareJoinDesc, boardLink: rc.shareBoardDesc,
    ceremonyLink: rc.shareCeremonyDesc, tvScreen: rc.shareTvDesc, recap: rc.shareRecapDesc,
    staffLink: rc.shareStaffDesc,
  };

  async function copy(entry: ReturnType<typeof buildShareArtifacts>[number]) {
    // Copy synchronously with the click (the clipboard needs the user gesture),
    // THEN publish the board for the audience facing links. A failed copy now
    // surfaces (item 3) instead of a dead "Copied!"; the publish still runs.
    await copyToClipboard(entry.copyValue, () => { setCopied(entry.id); setTimeout(() => setCopied(''), 2000); }, rc.copyFailed);
    if (entry.requiresPublish) await onShareBoard?.();
  }

  return (
    <PanelShell panel="shareScreens">
      <div className="space-y-2">
        {artifacts.map((entry) => (
          <div key={entry.id} className="rounded-lg bg-[--surface-2] p-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[12rem]">
              <div className="text-sm text-[--ink-2]">{NAME[entry.id]}</div>
              <div className="text-[11px] text-[--ink-3] leading-relaxed">{DESC[entry.id]}</div>
              {/* Copying the TV link to preview it used to publish the standings
                  to every player, silently. Say so BEFORE the click
                  (change: run-console-clarity). */}
              {entry.publishesOnShare && (
                <div className="text-[11px] text-rp-amber/90 mt-0.5">{rc.sharePublishesNote}</div>
              )}
              {!entry.available && (
                <div className="text-[11px] text-rp-amber/90 mt-0.5">
                  {entry.unavailableUntilFinished ? rc.shareAfterRunOnly
                    : entry.unavailableAfterFinish ? rc.shareWhileOpenOnly
                    : rc.shareStaffLocked}
                </div>
              )}
            </div>
            {entry.id === 'accessCode' && (
              <span className="font-mono text-rp-fire tracking-[0.2em] text-sm">{accessCode}</span>
            )}
            <Button
              variant={runActionVariant('copyShareLink')}
              className="min-h-0 px-3 py-1.5 text-xs rounded-lg"
              disabled={!entry.available}
              aria-label={rc.shareCopyAria({ name: NAME[entry.id] })}
              onClick={() => void copy(entry)}
            >
              {copied === entry.id ? rc.linkCopied : rc.shareCopyAction}
            </Button>
            {entry.url && (
              <Button
                variant={runActionVariant('copyShareLink')}
                className="min-h-0 px-3 py-1.5 text-xs rounded-lg"
                disabled={!entry.available}
                aria-label={rc.shareOpenAria({ name: NAME[entry.id] })}
                onClick={async () => { window.open(entry.url!, '_blank'); if (entry.requiresPublish) await onShareBoard?.(); }}
              >
                {rc.shareOpenAction}
              </Button>
            )}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}


// ── Post-run per-task analytics (run-analytics-heatmap) ───────────────────────
const TYPE_EMOJI: Record<string, string> = {
  smart_station: '🔑', photo: '📸', quiz: '❓', numeric: '🔢',
  field: '✅', self_report: '🙋', geofence: '📡', sequence: '📋', survey: '🗳️',
};
function fmtMs(ms: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
// Trackable collectibles console (change: trackable-collectibles): author items and
// see which team is carrying each. Coordinates/holders aren't secret.
function TrackablesConsole({ ownerUid, gameId, runId, teams }: { ownerUid: string; gameId: string; runId: string; teams: RunTeamRow[] }) {
  const rc = useT().runConsole;
  const [items, setItems] = useState<Trackable[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const reportFailure = useCallFailureToast();
  // This used to print a raw Firestore uid where a team's name belongs, because
  // it hand rolled the lookup instead of asking the resolver every other surface
  // uses (change: run-console-clarity).
  const nameOf = (id?: string | null) =>
    resolveTeamLabel(id ?? '', teams, (short) => rc.unknownTeam({ id: short }));

  useEffect(() => {
    let alive = true;
    getRunTrackables({ ownerUid, gameId, runId })
      .then((r) => { if (alive) setItems(r.trackables); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [ownerUid, gameId, runId, tick]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    // The input is cleared only on success, so a failed create never looks like
    // one — and now it also says so out loud.
    try { await createTrackable({ gameId, runId, name: name.trim() }); setName(''); setTick((x) => x + 1); }
    catch (e) { reportFailure(e, 'createTrackable'); }
    finally { setBusy(false); }
  }

  return (
    <PanelShell panel="trackables">
      <div className="flex gap-2 mb-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={rc.trackablesPlaceholder} dir="auto" className="flex-1" />
        <Button variant={runActionVariant('createTrackable')} disabled={busy || !name.trim()} onClick={create}>{rc.trackablesAdd}</Button>
      </div>
      {items.length === 0 ? (
        <PanelEmpty panel="trackables" />
      ) : (
        <div className="space-y-1.5">
          {items.map((tr) => (
            <div key={tr.id} className="flex items-center justify-between text-sm">
              <span className="text-[--ink-2]" dir="auto">{tr.name}</span>
              <span className="text-[--ink-3] text-xs">
                {tr.currentHolderTeamId ? rc.trackablesHeldBy({ name: nameOf(tr.currentHolderTeamId) }) : rc.trackablesUnheld}
              </span>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

// Territory zones console (change: territory-capture): author capturable zones and
// see which team currently holds each. Center is picked on the map; leaving it
// unset (0,0) makes a locationless zone. Capturing is validated server-side
// against the player's GPS.
function ZonesConsole({ ownerUid, gameId, runId }: { ownerUid: string; gameId: string; runId: string }) {
  const rc = useT().runConsole;
  const [zones, setZones] = useState<CaptureZone[]>([]);
  const [title, setTitle] = useState('');
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const reportFailure = useCallFailureToast();

  useEffect(() => {
    let alive = true;
    getRunZones({ ownerUid, gameId, runId })
      .then((r) => { if (alive) setZones(r.zones); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [ownerUid, gameId, runId, tick]);

  async function create() {
    // No map pick (0,0) is allowed on purpose — it authors a locationless zone.
    if (!title.trim() || !isValidCoord(lat, lng)) return;
    setBusy(true);
    try { await createZone({ gameId, runId, title: title.trim(), lat, lng }); setTitle(''); setLat(0); setLng(0); setTick((x) => x + 1); }
    catch (e) { reportFailure(e, 'createZone'); }
    finally { setBusy(false); }
  }
  async function remove(zoneId: string) {
    if (!(await dialog.confirm(rc.zonesDeleteConfirm, undefined, true))) return;
    // The refetch below made a failed delete look like an unexplained
    // reappearance. Now the reappearance has a reason attached.
    try { await deleteZone({ gameId, runId, zoneId }); }
    catch (e) { reportFailure(e, 'deleteZone'); }
    setTick((x) => x + 1);
  }

  return (
    <PanelShell panel="zones">
      <div className="flex flex-wrap gap-2 mb-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={rc.zonesTitlePlaceholder} dir="auto" className="flex-1 min-w-[8rem]" />
        <Button variant={runActionVariant('createZone')} disabled={busy || !title.trim()} onClick={create}>{rc.zonesAdd}</Button>
      </div>
      <div className="mb-3">
        <LocationStep coordinates={{ lat, lng }} onChange={(la, ln) => { setLat(la); setLng(ln); }} mapClassName="h-52" />
      </div>
      {zones.length === 0 ? (
        <PanelEmpty panel="zones" />
      ) : (
        <div className="space-y-1.5">
          {zones.map((z) => (
            <div key={z.id} className="flex items-center justify-between text-sm gap-2">
              <span className="text-[--ink-2] flex-1" dir="auto">{z.title}</span>
              {/* A holder with no denormalized name used to render "held by "
                  with nothing after it (change: run-console-clarity). */}
              <span className="text-[--ink-3] text-xs">
                {z.ownerTeamId
                  ? rc.zonesHeldBy({
                    name: (z.ownerTeamName ?? '').trim() || rc.unknownTeam({ id: shortId(z.ownerTeamId) }),
                  })
                  : rc.zonesOpen}
              </span>
              <Button
                variant={runActionVariant('deleteZone')}
                className="min-h-0 px-2.5 py-1 text-[11px] rounded-lg"
                aria-label={rc.zonesDeleteAria({ name: z.title })}
                onClick={() => remove(z.id)}
              >
                {rc.zonesDelete}
              </Button>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

// Live task availability (change: live-task-pause). `Task.status` was enforced by
// routing in three places and written by NOTHING, so when a stop died mid event the
// organizer could only keep routing teams to it or end the run. This is the control.
//
// Run scoped: the server writes `run.taskStatusOverrides`, never the game template,
// so a stop closed today is not closed for tomorrow's run. The current availability
// is read from the run document THIS PAGE ALREADY SUBSCRIBES TO, so a pause pushed
// by staff in the field appears here without a reload. A team already holding the
// task keeps it; the server reports how many that is.
function TaskAvailabilityConsole({ ctx, overrides }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  overrides: Record<string, StationStatus> | undefined;
}) {
  const rc = useT().runConsole;
  const [stages, setStages] = useState<{ id: string; title: string; tasks: { id: string; title: string; status?: StationStatus }[] }[] | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const reportFailure = useCallFailureToast();

  useEffect(() => {
    let alive = true;
    getGame({ gameId: ctx.gameId })
      .then(({ game }) => {
        if (!alive) return;
        setStages((game.stages ?? []).map((st) => ({
          id: st.id,
          title: st.title ?? '',
          tasks: (st.tasks ?? []).map((tk) => ({ id: tk.id, title: tk.title, status: tk.status })),
        })));
      })
      .catch(() => { if (alive) setStages([]); });
    return () => { alive = false; };
  }, [ctx.gameId]);

  async function apply(taskId: string, status: StationStatus, force = false) {
    setBusyTaskId(taskId);
    try {
      const res = await setRunTaskStatus({ ...ctx, taskId, status, ...(force ? { force: true } : {}) });
      toast.success(
        res.teamsHolding > 0 && status !== 'active'
          ? `${rc.taskAvailUpdated}. ${rc.taskAvailHolding({ n: res.teamsHolding })}`
          : rc.taskAvailUpdated,
      );
    } catch (e) {
      // The server refuses a change that would leave the stage unable to yield the
      // tasks it requires. Show the numbers it returned and let the organizer decide,
      // rather than letting them find out through stuck teams.
      const details = (e as { details?: { code?: string; availableCount?: number; requiredCount?: number; stageTitle?: string } }).details;
      if (details?.code === 'stageUnwinnable' && !force) {
        const ok = await dialog.confirm(
          rc.taskAvailUnwinnable({
            stage: details.stageTitle ?? '',
            available: details.availableCount ?? 0,
            required: details.requiredCount ?? 0,
          }),
          rc.taskAvailForce,
          true,
        );
        setBusyTaskId(null);
        if (ok) await apply(taskId, status, true);
        return;
      }
      reportFailure(e, 'setRunTaskStatus');
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <PanelShell panel="taskAvailability">
      {stages === null ? (
        <div className="text-sm text-[--ink-3]">{rc.taskAvailLoading}</div>
      ) : stages.every((st) => st.tasks.length === 0) ? (
        <PanelEmpty panel="taskAvailability" />
      ) : (
        <div className="space-y-3">
          {stages.filter((st) => st.tasks.length > 0).map((st) => (
            <div key={st.id} className="space-y-1.5">
              <div dir="auto" className="text-[11px] uppercase tracking-widest text-[--ink-3]">{st.title}</div>
              {st.tasks.map((tk) => {
                const status = effectiveTaskStatus(tk, overrides);
                const label = status === 'paused' ? rc.taskAvailStatusPaused
                  : status === 'closed' ? rc.taskAvailStatusClosed
                    : rc.taskAvailStatusActive;
                const busy = busyTaskId === tk.id;
                return (
                  <div key={tk.id} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-[--surface-2]">
                    <span dir="auto" className="flex-1 min-w-[8rem] text-sm text-[--ink-2]">{tk.title}</span>
                    <Badge color={status === 'active' ? 'zinc' : 'gold'}>{label}</Badge>
                    {status === 'active' ? (
                      <>
                        <Button variant={runActionVariant('pauseTask')} disabled={busy} onClick={() => apply(tk.id, 'paused')}>
                          {rc.taskAvailPause}
                        </Button>
                        <Button variant={runActionVariant('closeTask')} disabled={busy} onClick={() => apply(tk.id, 'closed')}>
                          {rc.taskAvailClose}
                        </Button>
                      </>
                    ) : (
                      <Button variant={runActionVariant('resumeTask')} disabled={busy} onClick={() => apply(tk.id, 'active')}>
                        {rc.taskAvailResume}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

// Photo approval queue (wave-e task 13): the manager's live review panel.
//
// Why a `teams` collection listener and not a query: `submitStationPhoto` stores a
// submission as a MAP FIELD on the team doc (`taskSubmissions[taskId]`), so there
// is nothing to index or filter on — a queue must read the team docs and flatten
// them. One listener covers the whole run; team docs already change constantly, so
// this is cheaper than the 5s listRunTeams poll this page already runs, and it is
// bounded by the per-run device cap. The flattening/ordering/status rules live in
// @rushpoint/shared (photoQueue) so this panel and the play-web StaffConsole can
// never disagree about what is pending or which actions are legal.
//
// The owner already has rules-level read on every team doc of its own run
// (firestore.rules, match /teams/{teamId}), so no rules or index change is needed.
//
// The queue itself is now computed by the page (the disclosure plan needs the
// pending count for a FOLDED group's badge, and a collapsed group renders no
// children), so this panel is presentational.
function PhotoReviewConsole({ ctx, pending, reviewed, pendingCount, loadError, taskTitles, finishedTeamIds }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  pending: SubmissionRow[];
  reviewed: SubmissionRow[];
  pendingCount: number;
  loadError: boolean;
  taskTitles: ReadonlyMap<string, string>;
  /** Teams past the finish line: their submissions still score, but block nobody. */
  finishedTeamIds: string[];
}) {
  const rc = useT().runConsole;

  // A per-row failure that OUTLIVES the toast. The row already stayed in the
  // queue on failure (there is no optimistic removal), but it looked exactly
  // like a row nobody had touched, so the organizer believed they had handled it
  // while the team was still standing still.
  const [failures, setFailures] = useState<ReviewFailures>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // The wait clock. A minute tick is enough resolution for a queue measured in
  // minutes, and it keeps the panel from re-rendering the whole grid every second.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () => buildReviewQueueView(pending, { nowMs, finishedTeamIds, failures }),
    [pending, nowMs, finishedTeamIds, failures],
  );

  async function review(row: SubmissionRow, approved: boolean) {
    const key = submissionKey(row);
    // Legality first: an approved row has no server-side score clawback, so a
    // "reject" would flip a status string while the points silently stayed.
    const decision = decideReview(row.status, approved ? 'approve' : 'reject');
    if (!decision.send) {
      toast.error(decision.reason === 'alreadyApproved' ? rc.photoReviewRejectDisabled : rc.photoReviewAlreadyRejected);
      return;
    }
    let note = '';
    if (!approved) {
      const answer = await dialog.prompt(rc.photoReviewRejectPrompt);
      if (answer === null) return; // cancelled
      note = answer;
    }
    try {
      await reviewStationSubmission({
        ...ctx, teamId: row.teamId, taskId: row.taskId, approved, ...(note ? { note } : {}),
      });
      setFailures((prev) => clearFailure(prev, key));
      toast.success(approved ? rc.photoReviewApproved : rc.photoReviewRejected);
    } catch {
      toast.error(rc.photoReviewFailed);
      setFailures((prev) => recordFailure(prev, key, rc.photoReviewRowFailed({ team: row.displayName })));
    }
    // No optimistic removal: the row disappears because the snapshot says the
    // status left 'pending'. Optimism here would hide a failed review.
  }

  // Per-row in-flight guard — a double-tapped Approve must fire ONE callable.
  // Keyed exactly like the StaffConsole so another row can still act meanwhile.
  const reviewAction = useAsyncAction<[SubmissionRow, boolean], void>(review, (row) => submissionKey(row));

  function clock(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
  }

  function Media({ row }: { row: SubmissionRow }) {
    if (!isRenderableMedia(row.photoUrl)) {
      return <div className="text-[11px] text-[--ink-3]">{rc.photoReviewNoPhoto}</div>;
    }
    if (row.mediaKind === 'audio') {
      return <audio controls preload="none" src={row.photoUrl} className="w-full" aria-label={rc.photoReviewAudio} />;
    }
    // A video submission fed to <img> renders as nothing at all — the reviewer saw
    // a bare link and had to leave the console to judge it. `preload="metadata"`
    // gives the poster frame without pulling every clip in the queue.
    if (row.mediaKind === 'video') {
      return (
        <video
          controls
          playsInline
          preload="metadata"
          src={row.photoUrl}
          aria-label={rc.photoReviewVideo}
          className="w-full h-32 object-cover rounded-md bg-black"
        />
      );
    }
    return (
      <a href={row.photoUrl} target="_blank" rel="noreferrer">
        <img src={row.photoUrl} alt={rc.photoReviewAlt} loading="lazy" className="w-full h-32 object-cover rounded-md" />
      </a>
    );
  }

  // The task's NAME, not the raw Firestore id the queue used to print where a
  // task's name belongs (change: run-console-progressive-disclosure).
  const taskLabel = (taskId: string) => resolveTaskLabel(taskId, taskTitles, (id) => rc.unknownTask({ id }));

  // How long this team has been standing still, in words. The panel used to
  // print a wall-clock time and leave the organizer to subtract, per row, on a
  // phone, while walking — so in practice nobody knew who had waited longest.
  function waitLabel(waitMinutes: number | null): string {
    if (waitMinutes === null) return rc.photoReviewWaitingUnknown;
    if (waitMinutes < 1) return rc.photoReviewWaitingJustNow;
    return rc.photoReviewWaiting({ minutes: waitMinutes });
  }
  const WAIT_TONE = {
    fresh: 'text-[--ink-3]',
    waiting: 'text-rp-amber',
    overdue: 'text-rp-alert font-medium',
  } as const;

  // Keyboard, scoped to the queue container and NEVER to `document`: a creator
  // typing an announcement elsewhere on this page must not be able to approve a
  // photograph by typing the letter "a".
  function onQueueKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') {
      const next = moveFocus(items, focusKey, k === 'j' ? 1 : -1);
      if (next) { e.preventDefault(); setFocusKey(next); }
      return;
    }
    if (k !== 'a' && k !== 'r') return;
    const item = items.find((i) => i.key === focusKey);
    if (!item || reviewAction.isBusy(item.key)) return;
    e.preventDefault();
    void reviewAction.run(item.row, k === 'a').catch(() => undefined);
  }

  return (
    <PanelShell
      panel="photoReview"
      badge={pendingCount > 0 ? <Badge color="gold">{rc.photoReviewCount({ n: pendingCount })}</Badge> : undefined}
    >
      {/* A failed load must NOT look like an empty queue: at a live event that is
          a manager silently missing submissions (change: run-console-clarity). */}
      {loadError && (
        <p className="text-[11px] text-rp-alert mb-3" role="status">{rc.photoReviewLoadError}</p>
      )}

      {items.length === 0
        ? (loadError ? null : <PanelEmpty panel="photoReview" />)
        : (
          <>
            <p className="text-[11px] text-[--ink-3] mb-2">{rc.photoReviewKeyboardHint}</p>
            <div
              role="list"
              aria-label={rc.photoReviewQueueLabel}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              onKeyDown={onQueueKeyDown}
            >
              {items.map((item) => {
                const row = item.row;
                const key = item.key;
                const focused = key === focusKey;
                return (
                  <div
                    key={key}
                    role="listitem"
                    tabIndex={focused || (focusKey === null && item === items[0]) ? 0 : -1}
                    onFocus={() => setFocusKey(key)}
                    className={`rounded-lg bg-[--surface-2] p-2 outline-none ${focused ? 'ring-2 ring-rp-amber' : ''}`}
                  >
                    <Media row={row} />
                    <div dir="auto" className="text-xs text-[--ink-2] truncate mt-2">{row.displayName}</div>
                    {/* One formatter, not a bare prefix glued to a name: the old
                        concatenation rendered "task Old Market". */}
                    <div dir="auto" className="text-[11px] text-[--ink-3] truncate">
                      {rc.photoReviewTaskLine({ name: taskLabel(row.taskId) })}
                    </div>
                    <div className={`text-[11px] ${WAIT_TONE[item.tier]}`}>
                      {waitLabel(item.waitMinutes)}
                    </div>
                    {item.tier === 'overdue' && !item.teamFinished && (
                      <div className="text-[11px] text-rp-alert">{rc.photoReviewOverdue}</div>
                    )}
                    {item.teamFinished && (
                      <div className="text-[11px] text-[--ink-3]">{rc.photoReviewTeamFinished}</div>
                    )}
                    {row.submittedAt && (
                      <div className="text-[11px] text-[--ink-3]">
                        {rc.photoReviewSubmittedAt({ time: clock(row.submittedAt) })}
                      </div>
                    )}
                    {item.failure && (
                      <p dir="auto" className="text-[11px] text-rp-alert mt-1" role="alert">{item.failure}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        variant={runActionVariant('approvePhoto')}
                        className="flex-1"
                        disabled={reviewAction.isBusy(key)}
                        onClick={() => { void reviewAction.run(row, true).catch(() => undefined); }}
                      >
                        {item.failure ? rc.photoReviewRetry : rc.photoReviewApprove}
                      </Button>
                      <Button
                        variant={runActionVariant('rejectPhoto')}
                        className="flex-1"
                        disabled={reviewAction.isBusy(key)}
                        onClick={() => { void reviewAction.run(row, false).catch(() => undefined); }}
                      >
                        {rc.photoReviewReject}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

      {reviewed.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-[--ink-3] mb-2">{rc.photoReviewRecent}</div>
          <div className="space-y-1">
            {reviewed.map((row) => {
              const key = submissionKey(row);
              // Reviewed rows are terminal, so a further reject is never useful:
              // an APPROVED row has no server-side score clawback, and RE-rejecting
              // an already-REJECTED row is a no-op that only re-opens the note
              // prompt and fires a pointless callable. Either way the affordance is
              // DISABLED with a status-specific reason rather than inviting the act.
              const rejectReason = row.status === 'approved'
                ? rc.photoReviewRejectDisabled
                : rc.photoReviewAlreadyRejected;
              return (
                <div key={key} className="flex items-center gap-2 text-[11px]">
                  <span className={row.status === 'approved' ? 'text-rp-fire' : 'text-rp-alert'}>
                    {row.status === 'approved' ? rc.photoReviewTagApproved : rc.photoReviewTagRejected}
                  </span>
                  <span dir="auto" className="text-[--ink-2] truncate flex-1">{row.displayName}</span>
                  <span dir="auto" className="text-[--ink-3] truncate">{taskLabel(row.taskId)}</span>
                  <button
                    className="text-[--ink-3] disabled:text-[--ink-4] disabled:cursor-not-allowed"
                    disabled
                    title={rejectReason}
                  >
                    {rejectReason}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

// Live photo feed console (change: live-photo-feed): the run's active feed items
// (owner reads the collection directly; server writes only) with a hide action.
// The feed listener moved to the page so a FOLDED moderation group can report
// its contents; this panel renders what it is given.
type FeedItemRow = {
  id: string; taskTitle: string; teamName: string; photoUrl: string;
  mediaKind?: 'photo' | 'audio' | 'video';
  reactions?: Record<string, number>; createdAt?: string;
};

function FeedConsole({ ownerUid, gameId, runId, items }: { ownerUid: string; gameId: string; runId: string; items: FeedItemRow[] }) {
  const rc = useT().runConsole;
  const reportFailure = useCallFailureToast();

  async function hide(itemId: string) {
    if (!(await dialog.confirm(rc.feedHideConfirm, undefined, true))) return;
    // A creator hiding a photo from a PROJECTED feed and being told nothing when
    // it fails is the worst shape this bug takes: they walk away believing the
    // picture is gone while it is still on the wall.
    try { await hideFeedItem({ ownerUid, gameId, runId, itemId }); }
    catch (e) { reportFailure(e, 'hideFeedItem'); }
  }

  return (
    <PanelShell
      panel="feed"
      badge={items.length > 0 ? <Badge>{rc.feedCount({ n: items.length })}</Badge> : undefined}
    >
      {items.length === 0 && <PanelEmpty panel="feed" />}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg bg-[--surface-2] overflow-hidden">
            {item.mediaKind === 'video' ? (
              <video
                controls
                playsInline
                preload="metadata"
                src={item.photoUrl}
                className="w-full h-28 object-cover bg-black"
              />
            ) : (
              <img src={item.photoUrl} alt="" loading="lazy" className="w-full h-28 object-cover" />
            )}
            <div className="p-2">
              <div dir="auto" className="text-xs text-[--ink-2] truncate">{item.teamName}</div>
              <div dir="auto" className="text-[11px] text-[--ink-3] truncate">{item.taskTitle}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-[--ink-3] font-mono">
                  {Object.values(item.reactions ?? {}).reduce((a, n) => a + n, 0) || ''}
                  {Object.values(item.reactions ?? {}).reduce((a, n) => a + n, 0) > 0 ? ' ❤' : ''}
                </span>
                {/* Hiding a player's photo is cautionary, so it is classified
                    like every other console control rather than styled ad hoc. */}
                <Button
                  variant={runActionVariant('hideFeedPhoto')}
                  className="min-h-0 px-2 py-0.5 text-[11px] rounded-lg"
                  onClick={() => void hide(item.id)}
                >
                  {rc.feedHideAction}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// Run media gallery (change: run-media-gallery-and-video-feed): every renderable
// photo/video submission for the run, ANY review status — the thing the photo
// review queue's pending/reviewed split structurally cannot show (an
// autoApproved item never enters `pending`; `reviewed` is capped and text-only).
// A manager tool, not a work queue: no approve/reject here, that stays in
// PhotoReviewConsole. This panel only shows what exists and lets it be
// downloaded.
const MEDIA_DOWNLOAD_DELAY_MS = 250;

function RunMediaGalleryConsole({ rows, taskTitles }: { rows: SubmissionRow[]; taskTitles: ReadonlyMap<string, string> }) {
  const rc = useT().runConsole;
  const [downloading, setDownloading] = useState(false);
  const taskLabel = (taskId: string) => resolveTaskLabel(taskId, taskTitles, (id) => rc.unknownTask({ id }));

  const STATUS_LABEL: Record<SubmissionRow['status'], string> = {
    pending: rc.mediaGalleryStatusPending,
    approved: rc.mediaGalleryStatusApproved,
    rejected: rc.mediaGalleryStatusRejected,
  };
  const STATUS_TONE: Record<SubmissionRow['status'], string> = {
    pending: 'text-rp-amber',
    approved: 'text-rp-fire',
    rejected: 'text-rp-alert',
  };

  // One file at a time, spaced out: a burst of same-tick downloads reads to some
  // browsers as a popup flood and gets throttled to fewer files than were asked
  // for. This is a manager power tool run occasionally, not a hot path, so a
  // small delay per file costs nothing anyone will notice.
  async function downloadAll() {
    if (downloading || rows.length === 0) return;
    setDownloading(true);
    try {
      for (const row of rows) {
        const link = document.createElement('a');
        link.href = row.photoUrl;
        link.download = `${row.teamId}-${row.taskId}`;
        link.rel = 'noreferrer';
        document.body.appendChild(link);
        link.click();
        link.remove();
        await new Promise((resolve) => setTimeout(resolve, MEDIA_DOWNLOAD_DELAY_MS));
      }
    } finally {
      setDownloading(false);
    }
  }

  function Media({ row }: { row: SubmissionRow }) {
    if (!isRenderableMedia(row.photoUrl)) {
      return <div className="text-[11px] text-[--ink-3]">{rc.mediaGalleryNoMedia}</div>;
    }
    if (row.mediaKind === 'audio') {
      return <audio controls preload="none" src={row.photoUrl} className="w-full" />;
    }
    if (row.mediaKind === 'video') {
      return (
        <video
          controls
          playsInline
          preload="metadata"
          src={row.photoUrl}
          aria-label={rc.mediaGalleryVideoAria}
          className="w-full h-32 object-cover rounded-md bg-black"
        />
      );
    }
    return <img src={row.photoUrl} alt={rc.mediaGalleryAlt} loading="lazy" className="w-full h-32 object-cover rounded-md" />;
  }

  return (
    <PanelShell
      panel="mediaGallery"
      badge={rows.length > 0 ? <Badge>{rc.mediaGalleryCount({ n: rows.length })}</Badge> : undefined}
      actions={rows.length > 0 ? (
        <Button
          variant="subtle"
          className="min-h-0 px-3 py-1.5 text-xs rounded-lg"
          disabled={downloading}
          onClick={() => void downloadAll()}
        >
          {rc.mediaGalleryDownloadAll({ n: rows.length })}
        </Button>
      ) : undefined}
    >
      {rows.length === 0
        ? <PanelEmpty panel="mediaGallery" />
        : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((row) => {
              const key = submissionKey(row);
              return (
                <div key={key} className="rounded-lg bg-[--surface-2] p-2">
                  <Media row={row} />
                  <div dir="auto" className="text-xs text-[--ink-2] truncate mt-2">{row.displayName}</div>
                  <div dir="auto" className="text-[11px] text-[--ink-3] truncate">
                    {rc.mediaGalleryTaskLine({ name: taskLabel(row.taskId) })}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[11px] ${STATUS_TONE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                    {isRenderableMedia(row.photoUrl) && (
                      <a
                        href={row.photoUrl}
                        download={`${row.teamId}-${row.taskId}`}
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-ink-fire hover:underline"
                      >
                        {rc.mediaGalleryDownloadOne}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </PanelShell>
  );
}

// Team ↔ HQ chat (change: team-hq-chat): per-team threads. The owner reads the
// whole chat collection (rules grant it) via one snapshot and replies as HQ. A
// thread with new messages since it was last opened shows an unread badge (local).
interface ChatThreadRow { teamId: string; messages: ChatMessage[]; updatedAt: string }

// The thread listener and the read/unread bookkeeping moved to the page, which
// needs the unread count for the folded moderation badge.
function ChatConsole({ ctx, teams, threads, selfUid, markerFor, onRead }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: RunTeamRow[];
  threads: ChatThreadRow[];
  selfUid: string;
  markerFor: (teamId: string) => ChatSeenMarker;
  onRead: (teamId: string, messages: ChatMessage[]) => void;
}) {
  const rc = useT().runConsole;
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const reportFailure = useCallFailureToast();

  // Keep the currently-open thread marked read as its message count grows — an HQ
  // reply (or a message that arrives while HQ is watching) must not re-badge the
  // very thread being read. Without this, sending a reply flags it "unread".
  useEffect(() => {
    if (!openTeam) return;
    const th = threads.find((x) => x.teamId === openTeam);
    if (!th) return;
    onRead(openTeam, th.messages);
  }, [openTeam, threads, onRead]);

  // A team's NAME, never a truncated document id.
  const nameFor = (teamId: string) => resolveTeamLabel(teamId, teams, (id) => rc.unknownTeam({ id }));

  function expand(teamId: string, messages: ChatMessage[]) {
    setOpenTeam((cur) => {
      const next = cur === teamId ? null : teamId;
      if (next) onRead(teamId, messages);
      return next;
    });
    setDraft('');
  }

  async function reply(teamId: string) {
    const clean = draft.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await sendTeamChatMessage({ ...ctx, teamId, text: clean });
      setDraft('');
    }
    // Keeping the draft for a retry was right; saying nothing about why it is
    // still sitting there was not.
    catch (e) { reportFailure(e, 'sendTeamChatMessage'); }
    finally { setBusy(false); }
  }

  const totalUnread = threads.reduce(
    (n, th) => n + (countUnreadChatMessages(th.messages, markerFor(th.teamId), selfUid) > 0 ? 1 : 0), 0);

  return (
    <PanelShell
      panel="chat"
      badge={totalUnread > 0 ? <Badge color="cyan">{rc.chip.unreadChats({ n: totalUnread })}</Badge> : undefined}
    >
      {/* The chat destination is present for the whole live run now, so it has to
          say "nobody has written" rather than vanish (change: run-console-clarity). */}
      {threads.length === 0 && <PanelEmpty panel="chat" />}
      <div className="space-y-2">
        {threads.map((th) => {
          const last = th.messages[th.messages.length - 1];
          const unread = countUnreadChatMessages(th.messages, markerFor(th.teamId), selfUid) > 0;
          const expanded = openTeam === th.teamId;
          return (
            <div key={th.teamId} className="rounded-lg bg-[--surface-2] p-3">
              <button className="w-full text-start" onClick={() => expand(th.teamId, th.messages)}>
                <div className="flex items-center justify-between gap-2">
                  <span dir="auto" className="text-sm font-medium text-[--ink-2] truncate">{nameFor(th.teamId)}</span>
                  {unread && <span className="shrink-0 inline-flex items-center rounded-full bg-neon-blue/20 text-neon-blue px-2 py-0.5 text-[11px] font-semibold">{rc.chatUnread}</span>}
                </div>
                {last && <div dir="auto" className="text-[11px] text-[--ink-3] truncate mt-0.5">{last.from === 'hq' ? `${rc.chatHq}: ` : ''}{last.text}</div>}
              </button>
              {expanded && (
                <div className="mt-2 space-y-2">
                  <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5">
                    {th.messages.map((m) => (
                      <div key={m.id} className={`flex flex-col ${m.from === 'hq' ? 'items-end' : 'items-start'}`}>
                        <span className="text-[11px] text-[--ink-3]">{m.from === 'hq' ? rc.chatHq : m.senderName}</span>
                        <div dir="auto" className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm text-start ${m.from === 'hq' ? 'bg-neon-blue/15 border border-neon-blue/40 text-[--ink-1]' : 'bg-app-card border border-[--rp-border] text-[--ink-2]'}`}>{m.text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void reply(th.teamId); } }}
                      maxLength={CHAT_TEXT_MAX_LEN}
                      dir="auto"
                      disabled={busy}
                      placeholder={rc.chatReplyPlaceholder}
                      className="flex-1"
                    />
                    <Button variant={runActionVariant('sendChatReply')} onClick={() => void reply(th.teamId)} disabled={busy || !draft.trim()}>
                      {rc.chatSend}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}

// ─── Staff ↔ admin channel, organizer side (staff-console-field-ops) ─────────
//
// The counterpart to the section in play-web's StaffConsole. ONE shared thread per
// run, so unlike ChatConsole above there is no per-team list and no thread picker —
// the whole panel is the conversation.
//
// Kept separate from the team chat on purpose: this is where marshals report field
// problems and ask for exceptions, and firestore.rules deliberately excludes
// participants from it. Merging the two surfaces would make that boundary a
// rendering detail rather than a rule.
function StaffChannelConsole({ ctx, selfUid }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  selfUid: string;
}) {
  const rc = useT().runConsole;
  const [messages, setMessages] = useState<StaffChannelMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const reportFailure = useCallFailureToast();

  useEffect(() => {
    const ref = doc(db, FIRESTORE_PATHS.runStaffChannel(ctx.ownerUid, ctx.gameId, ctx.runId));
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as { messages?: StaffChannelMessage[] } | undefined;
      setMessages(data?.messages ?? []);
    }, () => setMessages([]));
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);

  async function send() {
    const clean = draft.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await sendStaffChannelMessage({ ...ctx, text: clean });
      setDraft('');
    }
    // Same rule as the team chat: keep the draft, but say why it is still there.
    catch (e) { reportFailure(e, 'sendStaffChannelMessage'); }
    finally { setBusy(false); }
  }

  return (
    <PanelShell panel="staffChannel">
      {messages.length === 0 && <PanelEmpty panel="staffChannel" />}
      <div className="space-y-2">
        {messages.length > 0 && (
          <div className="max-h-64 overflow-y-auto flex flex-col gap-1.5">
            {messages.map((m) => {
              // The organizer reading this panel IS the admin, so their own lines
              // sit right and everything else (every marshal) sits left.
              const mine = staffChannelMessageSide(m, selfUid) === 'me';
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <span className="text-[11px] text-[--ink-3]">{mine ? rc.chatHq : m.senderName}</span>
                  <div
                    dir="auto"
                    className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm text-start ${
                      mine
                        ? 'bg-neon-blue/15 border border-neon-blue/40 text-[--ink-1]'
                        : 'bg-app-card border border-[--rp-border] text-[--ink-2]'
                    }`}
                  >{m.text}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
            maxLength={CHAT_TEXT_MAX_LEN}
            dir="auto"
            disabled={busy}
            placeholder={rc.chatReplyPlaceholder}
            className="flex-1"
          />
          <Button variant={runActionVariant('sendChatReply')} onClick={() => void send()} disabled={busy || !draft.trim()}>
            {rc.chatSend}
          </Button>
        </div>
      </div>
    </PanelShell>
  );
}

// Movement heatmap panel (change: movement-heatmap): on demand, loads the run's
// foot-traffic density and renders it as a MapLibre heat layer over the play area.
function HeatmapPanel({ accessCode }: { accessCode: string }) {
  const t = useT();
  const [data, setData] = useState<RunHeatmapResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Surface a failed load instead of a silent blank (change: fix-post-run-analytics-visibility).
  // Kept opt-in (the GPS track can be heavy) — no auto-load.
  const [err, setErr] = useState('');

  async function load() {
    setBusy(true);
    setErr('');
    try { setData(await getRunHeatmap({ code: accessCode })); }
    catch { setErr(t.runConsole.analyticsError); }
    finally { setBusy(false); }
  }

  return (
    <PanelShell
      panel="heatmap"
      actions={!data
        ? <Button variant={runActionVariant('loadHeatmap')} disabled={busy} onClick={load}>{t.runConsole.heatmapLoad}</Button>
        : undefined}
    >
      {err && !data && <div className="text-sm text-danger" role="status">{err}</div>}
      {data && (
        data.pointCount === 0
          ? <PanelEmpty panel="heatmap" />
          : (
            <div className="space-y-2">
              <div className="text-sm text-[--ink-3]">{t.runConsole.heatmapPoints({ n: data.pointCount })}</div>
              <HeatmapMap cells={data.cells} className="h-80" />
            </div>
          )
      )}
    </PanelShell>
  );
}

// ─── Post-run summary panel (run-summary-report) ──────────────────────────────
// Auto-loads once the run is finished: a one-glance organizer report folding
// standings + completion + feedback digest, plus a note that the same summary is
// emailed to the organizer. Mirrors AnalyticsPanel's load pattern.
function RunSummaryPanel({ accessCode, reportHref }: { accessCode: string; reportHref: string }) {
  const t = useT();
  const [data, setData] = useState<RunSummary | null>(null);
  const [err, setErr] = useState('');
  // Localized issue labels (same mapping as FeedbackPanel) so a Hebrew UI never
  // shows the raw English issue enum.
  const issueLabel: Record<string, string> = {
    gps: t.runConsole.feedbackIssueGps, photo: t.runConsole.feedbackIssuePhoto,
    station_code: t.runConsole.feedbackIssueStationCode, task_unclear: t.runConsole.feedbackIssueTaskUnclear,
    slow: t.runConsole.feedbackIssueSlow, other: t.runConsole.feedbackIssueOther,
  };

  useEffect(() => {
    let alive = true;
    getRunSummary({ code: accessCode })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(t.runConsole.analyticsError); });
    return () => { alive = false; };
  }, [accessCode, t]);

  return (
    <PanelShell panel="runSummary">
      {/* The way through to the per-player report and its spreadsheet export
          (change: post-run-player-report). Rendered ABOVE the aggregate and
          regardless of whether the aggregate loaded: this link is the only route
          into the report from inside the console, and a failed summary fetch must
          not take it down with it. */}
      <a
        href={reportHref}
        className="inline-flex items-center gap-1.5 mb-3 text-sm font-medium text-rp-fire hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
      >
        📊 {t.runConsole.summaryOpenReport}
      </a>
      {/* A failed load and an empty report are different things and used to be
          the same grey line (change: run-console-clarity). */}
      {err && !data && <div className="text-sm text-danger" role="status">{err}</div>}
      {!data && !err && <PanelEmpty panel="runSummary" />}
      {data && (
        <div className="space-y-3">
          {/* Standings */}
          <div>
            <div className="text-xs text-[--ink-3] mb-1">{t.runConsole.summaryStandings}</div>
            {data.standings.length === 0 ? (
              <div className="text-sm text-[--ink-3]">{t.runConsole.summaryNoData}</div>
            ) : (
              <ol className="space-y-0.5">
                {data.standings.slice(0, 5).map((s) => (
                  <li key={s.teamId} className="flex items-center justify-between text-sm">
                    <span dir="auto">{s.rank}. {s.teamName}</span>
                    <span className="font-mono text-[--ink-3]">{s.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {/* Completion headline */}
          <div>
            <div className="text-xs text-[--ink-3] mb-1">{t.runConsole.summaryCompletion}</div>
            <div className="text-sm text-[--ink-3]">
              {t.runConsole.summaryTeams({ n: data.completion.teamCount })}
              {' · '}
              {t.runConsole.summaryCompletionRate({ pct: Math.round(data.completion.overallCompletionRate * 100) })}
              {' · '}
              {t.runConsole.summaryPhotos({ n: data.completion.photoCount })}
            </div>
          </div>
          {/* Feedback digest */}
          <div>
            <div className="text-xs text-[--ink-3] mb-1">{t.runConsole.summaryFeedback}</div>
            <div className="text-sm text-[--ink-3] space-y-1">
              <div>
                {t.runConsole.feedbackResponseRate({ n: data.feedback.responseCount, total: data.feedback.participantCount })}
                {' · '}
                {t.runConsole.feedbackRecommend({ pct: Math.round(data.feedback.recommendScore * 100) })}
              </div>
              {data.feedback.topIssues.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {data.feedback.topIssues.map((it) => (
                    <Badge key={it.issue}>
                      {resolveEnumLabel(it.issue, issueLabel, (id) => t.runConsole.unknownIssue({ id }))} · {it.count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-[--ink-3]">{t.runConsole.summaryEmailNote}</div>
        </div>
      )}
    </PanelShell>
  );
}


function AnalyticsPanel({ accessCode }: { accessCode: string }) {
  const t = useT();
  const b = t.builder;
  // Localized task-type labels — never show raw English enum values in a Hebrew UI.
  const TYPE_LABEL: Record<string, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation,
    photo: b.typePhoto, quiz: b.typeQuiz, numeric: b.typeNumeric,
    geofence: b.typeGeofence, sequence: b.typeSequence, survey: b.typeSurvey,
  };
  const [data, setData] = useState<RunAnalyticsResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Post-run visibility (change: fix-post-run-analytics-visibility): surface load
  // failures instead of leaving a silently-blank card, and auto-load on mount so
  // the creator sees the numbers without hunting for a button.
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try { setData(await getRunAnalytics({ code: accessCode })); }
    catch { setErr(t.runConsole.analyticsError); }
    finally { setBusy(false); }
  }, [accessCode, t]);

  useEffect(() => { void load(); }, [load]);

  // Export the loaded per-task analytics as a CSV file (pure client-side; no
  // callable). One row per task, header row included; downloaded via a blob URL.
  function exportCsv() {
    if (!data) return;
    // Deliberately NOT translated: these are machine readable column names that
    // a spreadsheet or a script keys on, not UI copy. Translating them would
    // silently break every saved analysis. // i18n-ignore machine-columns
    const header = ['task_id', 'type', 'attempts', 'completions', 'completion_rate', 'median_ms', 'p90_ms', 'hints', 'skips'];
    const esc = (v: string | number) => {
      let s = String(v);
      // Neutralize spreadsheet formula injection: a leading =,+,-,@ makes Excel treat a
      // (creator-authored) task id as a formula. Prefix a quote to force literal text.
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = data.tasks.map((task) => [
      task.taskId, task.type, task.attempts, task.completions,
      task.completionRate.toFixed(4), task.medianMs, task.p90Ms, task.hintCount, task.skips,
    ]);
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    // Prepend a UTF-8 BOM so Excel opens Hebrew/Unicode correctly.
    const bom = String.fromCharCode(0xfeff);
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-analytics-${accessCode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PanelShell
      panel="analytics"
      actions={(
        <>
          {data && data.tasks.length > 0 && (
            <Button variant={runActionVariant('exportAnalyticsCsv')} onClick={exportCsv}>{t.runConsole.analyticsExport}</Button>
          )}
          {!data && <Button variant={runActionVariant('loadAnalytics')} disabled={busy} onClick={load}>{t.runConsole.analyticsLoad}</Button>}
        </>
      )}
    >
      {err && !data && <div className="text-sm text-danger" role="status">{err}</div>}
      {data && (
        data.tasks.length === 0 ? (
          <PanelEmpty panel="analytics" />
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-[--ink-3]">{t.runConsole.analyticsOverall({ pct: Math.round(data.overallCompletionRate * 100) })}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[--ink-3] text-xs text-start">
                  <tr>
                    <th className="text-start font-medium py-1">{t.runConsole.colTask}</th>
                    <th className="text-start font-medium py-1">{t.runConsole.colDone}</th>
                    <th className="text-start font-medium py-1">{t.runConsole.colRate}</th>
                    <th className="text-start font-medium py-1">{t.runConsole.colMedian}</th>
                    <th className="text-start font-medium py-1">{t.runConsole.colHints}</th>
                    <th className="text-start font-medium py-1">{t.runConsole.colSkips}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tasks.map((task) => (
                    <tr key={task.taskId} className="border-t border-[--rp-border]">
                      <td className="py-1.5">
                        {TYPE_EMOJI[task.type] ?? '•'}{' '}
                        {resolveEnumLabel(task.type, TYPE_LABEL, (id) => t.runConsole.unknownTaskType({ id }))}
                      </td>
                      <td className="py-1.5">{task.completions}/{task.attempts}</td>
                      <td className="py-1.5">{Math.round(task.completionRate * 100)}%</td>
                      <td className="py-1.5 font-mono">{fmtMs(task.medianMs)}</td>
                      <td className="py-1.5">{task.hintCount}</td>
                      <td className="py-1.5">{task.skips}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </PanelShell>
  );
}


// ─── Post-game feedback panel (post-game-feedback) ────────────────────────────
// Auto-loads once the run is finished: response rate, per-dimension averages,
// difficulty/smoothness breakdowns, reported issues, and every free comment,
// with per-respondent drill-down to the full individual response.
const FIVE_DIMS: FeedbackRatingKey[] = ['overall', 'content', 'bonding', 'recommend'];

function FeedbackPanel({ gameId, runId }: { gameId?: string; runId?: string }) {
  const t = useT();
  const [data, setData] = useState<{ summary: RunFeedbackSummary; responses: RunFeedback[] } | null>(null);
  const [open, setOpen] = useState<RunFeedback | null>(null);
  // Escape closes the drill-down. `active` is the open flag: this component keeps
  // rendering the panel behind the modal, so an always-on listener would fire
  // with nothing open.
  useModalDismiss(() => setOpen(null), undefined, open !== null);
  // Surface a failed load instead of a silent blank (change: fix-post-run-analytics-visibility).
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!gameId || !runId) return;
    let alive = true;
    setErr('');
    getRunFeedbackSummary({ gameId, runId })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(t.runConsole.analyticsError); });
    return () => { alive = false; };
  }, [gameId, runId, t]);

  const dimLabel: Record<FeedbackRatingKey, string> = {
    overall: t.runConsole.feedbackDimOverall, content: t.runConsole.feedbackDimContent,
    bonding: t.runConsole.feedbackDimBonding, recommend: t.runConsole.feedbackDimRecommend,
    difficulty: t.runConsole.feedbackDifficulty, smoothness: t.runConsole.feedbackSmoothness,
  };
  const issueLabel: Record<FeedbackIssue, string> = {
    gps: t.runConsole.feedbackIssueGps, photo: t.runConsole.feedbackIssuePhoto,
    station_code: t.runConsole.feedbackIssueStationCode, task_unclear: t.runConsole.feedbackIssueTaskUnclear,
    slow: t.runConsole.feedbackIssueSlow, other: t.runConsole.feedbackIssueOther,
  };

  const s = data?.summary;
  const responses = data?.responses ?? [];
  const comments = responses.filter((r) => r.comment && r.comment.trim());

  return (
    <PanelShell
      panel="feedback"
      actions={s ? <span className="text-xs text-[--ink-3]">{t.runConsole.feedbackResponseRate({ n: s.responseCount, total: s.participantCount })}</span> : undefined}
    >
      {err && !s && <div className="text-sm text-danger" role="status">{err}</div>}
      {!s ? null : s.responseCount === 0 ? (
        <PanelEmpty panel="feedback" />
      ) : (
        <div className="space-y-4">
          {s.ratings.recommend && (
            <div className="text-sm text-rp-fire">{t.runConsole.feedbackRecommend({ pct: Math.round(s.recommendScore * 100) })}</div>
          )}

          {/* 1–5 dimension tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FIVE_DIMS.filter((k) => s.ratings[k]).map((k) => (
              <div key={k} className="bg-[--rp-raised] rounded-xl px-3 py-2.5">
                <div className="text-[11px] text-[--ink-3] mb-0.5">{dimLabel[k]}</div>
                <div className="text-lg font-bold text-rp-fire">
                  {s.ratings[k]!.avg.toFixed(1)}
                  <span className="text-xs font-normal text-[--ink-3]"> / 5 · {s.ratings[k]!.count}</span>
                </div>
              </div>
            ))}
          </div>

          {/* difficulty + smoothness distributions */}
          <div className="grid sm:grid-cols-2 gap-3">
            {s.ratings.difficulty && (
              <Distribution
                title={t.runConsole.feedbackDifficulty}
                bars={[
                  [t.runConsole.feedbackDiffEasy, s.ratings.difficulty.distribution[0] ?? 0],
                  [t.runConsole.feedbackDiffRight, s.ratings.difficulty.distribution[1] ?? 0],
                  [t.runConsole.feedbackDiffHard, s.ratings.difficulty.distribution[2] ?? 0],
                ]}
              />
            )}
            {s.ratings.smoothness && (
              <Distribution
                title={t.runConsole.feedbackSmoothness}
                bars={[
                  [t.runConsole.feedbackSmoothGood, s.ratings.smoothness.distribution[2] ?? 0],
                  [t.runConsole.feedbackSmoothSome, s.ratings.smoothness.distribution[1] ?? 0],
                  [t.runConsole.feedbackSmoothBad, s.ratings.smoothness.distribution[0] ?? 0],
                ]}
              />
            )}
          </div>

          {/* reported issues */}
          {FEEDBACK_ISSUES.some((i) => (s.issueCounts[i] ?? 0) > 0) && (
            <div>
              <div className="text-xs text-[--ink-3] mb-1.5">{t.runConsole.feedbackIssuesTitle}</div>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_ISSUES.filter((i) => (s.issueCounts[i] ?? 0) > 0).map((i) => (
                  <span key={i} className="rounded-full bg-rp-alert/10 border border-rp-alert/30 text-rp-alert text-xs px-2.5 py-1">
                    {issueLabel[i]} · {s.issueCounts[i]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* comments + drill-down list */}
          <div>
            <div className="text-xs text-[--ink-3] mb-1.5">{t.runConsole.feedbackCommentsTitle({ n: comments.length })}</div>
            {responses.length === 0 ? (
              <div className="text-sm text-[--ink-3]">{t.runConsole.feedbackNoComments}</div>
            ) : (
              <div className="space-y-1.5">
                {responses.map((r) => (
                  <button key={r.uid} onClick={() => setOpen(r)}
                    className="w-full text-start rounded-lg bg-[--rp-raised] hover:bg-[--rp-card] px-3 py-2 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span dir="auto" className="text-sm font-medium truncate">
                        {r.teamName}{r.memberName ? ` · ${r.memberName}` : ''}
                      </span>
                      <span className="text-xs text-[--ink-3] shrink-0">{t.runConsole.feedbackViewResponse}</span>
                    </div>
                    {r.comment && <div dir="auto" className="text-sm text-[--ink-3] truncate mt-0.5">“{r.comment}”</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(null)}>
          <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div dir="auto" className="font-semibold">{open.teamName}{open.memberName ? ` · ${open.memberName}` : ''}</div>
              <button onClick={() => setOpen(null)} className="text-[--ink-3] text-sm">{t.runConsole.feedbackClose}</button>
            </div>
            <div className="text-xs text-[--ink-3]">{t.runConsole.feedbackResponseTitle}</div>
            <div className="space-y-1.5">
              {(['overall', 'content', 'bonding', 'difficulty', 'smoothness', 'recommend'] as FeedbackRatingKey[]).map((k) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-[--ink-3]">{dimLabel[k]}</span>
                  <span className="font-medium">{open.ratings[k] ?? <span className="text-[--ink-3]">{t.runConsole.feedbackNoAnswer}</span>}</span>
                </div>
              ))}
            </div>
            {open.issues && open.issues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {open.issues.map((i) => (
                  <span key={i} className="rounded-full bg-rp-alert/10 border border-rp-alert/30 text-rp-alert text-xs px-2 py-0.5">{issueLabel[i]}</span>
                ))}
              </div>
            )}
            {open.comment && <p dir="auto" className="text-sm bg-[--rp-raised] rounded-lg px-3 py-2">{open.comment}</p>}
          </Card>
          </div>
        </div>
      )}
    </PanelShell>
  );
}

function Distribution({ title, bars }: { title: string; bars: [string, number][] }) {
  const max = Math.max(1, ...bars.map(([, n]) => (Number.isFinite(n) ? n : 0)));
  return (
    <div className="bg-[--rp-raised] rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-[--ink-3] mb-2">{title}</div>
      <div className="space-y-1.5">
        {bars.map(([label, rawN]) => {
          const n = Number.isFinite(rawN) ? rawN : 0;
          return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-[--ink-3] truncate">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-black/20 overflow-hidden">
              <div className="h-full rounded-full bg-rp-fire/60" style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className="w-5 text-end text-[--ink-3]">{n}</span>
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Survey results (change: survey-tasks) — owner/staff read-only aggregation ──
// Per-choice bar counts for choice surveys; a {teamName, response} list for
// free-text. Fetched on mount + a manual refresh (live poll results during a run).
// Loading moved to the page: a collapsed group's panel cannot load the results
// and then report how many there are, which is what the plan needs to decide
// whether the group renders at all. Rendering is unchanged.
function SurveyResultsPanel({ results, loading, loadError, onRefresh }: {
  results: SurveyResultRow[] | null;
  loading: boolean;
  loadError: boolean;
  onRefresh: () => void;
}) {
  const t = useT();

  return (
    <PanelShell
      panel="survey"
      actions={(
        <Button variant={runActionVariant('refreshSurvey')} className="text-xs" disabled={loading} onClick={onRefresh}>
          {loading ? t.runConsole.surveyRefreshing : t.runConsole.surveyRefresh}
        </Button>
      )}
    >
      {loadError ? (
        // Its own copy: this card used to report the ANALYTICS panel's failure,
        // which teaches an operator to distrust the error text on every card
        // (change: post-review-fixes D).
        <div className="text-sm text-danger" role="status">{t.runConsole.surveyError}</div>
      ) : results === null ? (
        <div className="text-sm text-[--ink-3]">{t.runConsole.surveyLoading}</div>
      ) : results.length === 0 ? (
        // This card could sit permanently blank: the loader swallowed its errors
        // and the panel had no zero results branch at all
        // (change: run-console-clarity).
        <PanelEmpty panel="survey" />
      ) : (
        <div className="space-y-5">
          {results.map((r) => (
            <div key={r.taskId} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div dir="auto" className="text-sm font-medium truncate">{r.title}</div>
                <div className="text-xs text-[--ink-3] shrink-0">{t.runConsole.surveyResponseCount({ n: r.responseCount })}</div>
              </div>
              {r.counts && r.surveyChoices ? (
                <Distribution
                  title={t.runConsole.surveyChoiceCounts}
                  bars={r.surveyChoices.map((c) => [c, r.counts![c] ?? 0])}
                />
              ) : r.responseCount === 0 ? (
                <div className="text-sm text-[--ink-3]">{t.runConsole.surveyNoResponses}</div>
              ) : (
                <div className="space-y-1.5">
                  {(r.responses ?? []).map((row, i) => (
                    <div key={i} className="rounded-lg bg-[--rp-raised] px-3 py-2">
                      <div dir="auto" className="text-xs text-[--ink-3] mb-0.5 truncate">{row.teamName}</div>
                      <div dir="auto" className="text-sm">{row.response}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}
