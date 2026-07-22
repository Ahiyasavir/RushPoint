import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import type { Query, DocumentData, QuerySnapshot } from 'firebase/firestore';
import QRCode from 'qrcode';
import type { Run, HotZone, RunFeedback, RunFeedbackSummary, RunSummary, FeedbackRatingKey, FeedbackIssue, Trackable, CaptureZone } from '@rushpoint/shared';
import { hotZoneMultiplier, FEEDBACK_ISSUES, buildStationQrPayload, FIRESTORE_PATHS, CHAT_TEXT_MAX_LEN, resolvePlayOrigin, MAX_RUN_DEVICES, isRunDeviceCapActive, type ChatMessage } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useAuth } from '../components/AuthGate';
import {
  listRunTeams, startTeams, finalizeRun, refreshLeaderboard, pushAnnouncement, pushFlashMission,
  inviteStaff, skipStage, adjustTeamScore, acknowledgeAlert, activateHotZone, deactivateHotZone,
  getRunAnalytics, getRunSummary, getRunHeatmap, getRunFeedbackSummary, createTrackable, getRunTrackables,
  createZone, deleteZone, getRunZones, hideFeedItem, getRunSurveyResults, getGame,
  sendTeamChatMessage, reviewStationSubmission,
  type RunTeamRow, type RunAnalyticsResult, type RunHeatmapResult, type SurveyResultRow,
} from '../services/calls';
// Photo approval queue (wave-e task 13) — pure queue logic shared with the
// play-web StaffConsole so the two review surfaces can never disagree.
import {
  buildSubmissionQueues, submissionKey, isRenderableMedia,
  type SubmissionRow, type SubmissionTeamDoc, type RawSubmission,
} from '@rushpoint/shared';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { Advanced, Badge, Button, Card, EmptyState, Input, Label, Spinner } from '../components/ui';
import RichTooltip from '../components/RichTooltip';
// Progressive disclosure (change: run-console-progressive-disclosure): the
// console's layout, action severity, share links and human labels are pure
// decisions that live in lib/ with tests, so the chrome and the summary badges
// cannot drift apart.
import {
  buildRunConsolePlan, planHasPanel, readGroupState, writeGroupState, groupStateKey,
  DEFAULT_GROUP_OPEN,
  type PanelId, type RunStatus, type RunConsoleGroup, type GroupOpenState, type CollapsibleGroupId,
} from '../lib/runConsoleLayout';
import {
  runActionVariant, parseScoreDelta, FLASH_MISSION_TTL_SECONDS, FLASH_MISSION_TTL_MINUTES,
} from '../lib/runConsoleActions';
import { buildShareArtifacts, type ShareArtifactId } from '../lib/runShareArtifacts';
import { resolveTeamLabel, resolveTaskLabel } from '../lib/runConsoleLabels';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import { playAlert, unlockAudio } from '../lib/sound';
import { useT } from '../components/LanguageContext';
import LiveTeamMap from '../components/LiveTeamMap';
import HeatmapMap from '../components/HeatmapMap';
import LocationStep from '../components/LocationStep';
import { isValidCoord } from '@rushpoint/shared';

// Where the participant app lives (for the shareable join link/QR).
const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? 'https://rushpoint-play.web.app');

export default function RunConsolePage() {
  const { gameId, runId } = useParams();
  const { user } = useAuth();
  const t = useT();
  const ownerUid = user!.uid;
  const [run, setRun] = useState<Run | null>(null);
  const [teams, setTeams] = useState<RunTeamRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [staffPin, setStaffPin] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; teamId: string; type: string; message: string; lat: number | null; lng: number | null; createdAt: string }[]>([]);

  // Live run doc (owner can read directly)
  useEffect(() => {
    if (!gameId || !runId) return;
    const ref = doc(db, `users/${ownerUid}/games/${gameId}/runs/${runId}`);
    return onSnapshot(ref, (snap) => snap.exists() && setRun(snap.data() as Run));
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
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`),
      where('acknowledged', '==', false),
    );
    return onSnapshot(ref, (snap) => {
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
    }, () => undefined);
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

  const loadTeams = useCallback(async () => {
    if (!gameId || !runId) return;
    const { teams } = await listRunTeams({ gameId, runId });
    setTeams(teams);
  }, [gameId, runId]);

  useEffect(() => {
    void loadTeams();
    const id = setInterval(() => void loadTeams(), 5000);
    return () => clearInterval(id);
  }, [loadTeams]);

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

  const [feedItems, setFeedItems] = useState<FeedItemRow[]>([]);
  useEffect(() => {
    if (!gameId || !runId) return;
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems`),
      where('active', '==', true),
    );
    return watchOrRead(ref, runLive, (snap) => {
      const rows = snap.docs.map((d) => ({ ...(d.data() as Omit<FeedItemRow, 'id'>), id: d.id }));
      rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setFeedItems(rows);
    }, () => undefined);
  }, [gameId, runId, ownerUid, runLive]);

  const [chatThreads, setChatThreads] = useState<ChatThreadRow[]>([]);
  const [chatSeen, setChatSeen] = useState<Record<string, number>>({});
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
  const unreadChatThreads = chatThreads.reduce(
    (n, th) => n + (th.messages.length > (chatSeen[th.teamId] ?? 0) ? 1 : 0), 0);

  // Survey results, loaded here for the same reason (a folded group's panel
  // cannot load them and then say how many there are).
  const [surveyResults, setSurveyResults] = useState<SurveyResultRow[] | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const loadSurvey = useCallback(() => {
    if (!gameId || !runId) return;
    setSurveyLoading(true);
    getRunSurveyResults({ gameId, runId })
      .then((d) => setSurveyResults(d.results))
      .catch(() => undefined)
      .finally(() => setSurveyLoading(false));
  }, [gameId, runId]);
  useEffect(() => { loadSurvey(); }, [loadSurvey]);

  // Task titles, so the review queue shows a task's NAME where it used to print
  // a raw Firestore id. One owner scoped read of a game the owner already holds.
  const [taskTitles, setTaskTitles] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    getGame({ gameId })
      .then(({ game }) => {
        if (!alive) return;
        const map = new Map<string, string>();
        for (const stage of game.stages ?? []) {
          for (const task of stage.tasks ?? []) map.set(task.id, task.title);
        }
        setTaskTitles(map);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [gameId]);

  // Which groups this creator left open on this run. A display preference only
  // (run docs are server write only); malformed or stale storage degrades to the
  // defaults instead of throwing on a live console.
  const [openGroups, setOpenGroups] = useState<GroupOpenState>(DEFAULT_GROUP_OPEN);
  useEffect(() => {
    if (!runId) return;
    try { setOpenGroups(readGroupState(localStorage.getItem(groupStateKey(runId)), DEFAULT_GROUP_OPEN)); }
    catch { setOpenGroups(DEFAULT_GROUP_OPEN); }
  }, [runId]);
  const persistGroups = useCallback((next: GroupOpenState) => {
    try { localStorage.setItem(groupStateKey(runId ?? ''), writeGroupState(next)); } catch { /* storage off */ }
    return next;
  }, [runId]);
  const toggleGroup = useCallback((id: CollapsibleGroupId) => {
    setOpenGroups((cur) => persistGroups({ ...cur, [id]: !cur[id] }));
  }, [persistGroups]);
  const openGroupNow = useCallback((id: CollapsibleGroupId) => {
    setOpenGroups((cur) => (cur[id] ? cur : persistGroups({ ...cur, [id]: true })));
  }, [persistGroups]);


  const ctx = { ownerUid, gameId: gameId!, runId: runId! };

  async function startAll() {
    // Unlock audio on this user gesture so the SOS cue can play later (autoplay).
    unlockAudio();
    setBusy(true);
    try { await startTeams({ gameId: gameId!, runId: runId! }); await loadTeams(); toast.success(t.runConsole.startedAllTeams); }
    catch { await dialog.alert(t.runConsole.startFailed); }
    finally { setBusy(false); }
  }
  async function finalize() {
    if (!(await dialog.confirm(t.runConsole.finalizeConfirmMessage, t.runConsole.finalizeConfirmTitle, true))) return;
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
      // The PIN + staff link render inside the (collapsed by default) share
      // group, so open it: a host must never have to hunt for what they just
      // created.
      openGroupNow('shareAndScreens');
    } catch { await dialog.alert(t.runConsole.staffInviteFailed); }
  }
  async function refreshStandings(publish?: boolean) {
    setBusy(true);
    try { await refreshLeaderboard({ ...ctx, ...(publish === undefined ? {} : { publish }) }); }
    finally { setBusy(false); }
  }
  async function ack(alertId: string) {
    try { await acknowledgeAlert({ ...ctx, alertId }); } catch { /* listener will reflect state */ }
  }
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
    try { await refreshLeaderboard({ ...ctx, publish: true }); } catch { /* board stays hidden; toggle still works */ }
  }
  async function revealStandings() {
    setBusy(true);
    try { await refreshLeaderboard({ ...ctx, publish: true }); toast.success(t.runConsole.standingsRevealed); }
    catch { await dialog.alert(t.runConsole.revealFailed); }
    finally { setBusy(false); }
  }

  if (!run) return <Spinner label={t.runConsole.loadingRun} />;

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

  // ONE pass decides which panels render, which group each sits in, and what a
  // folded group reports on its header, so a badge and its panel can never
  // disagree (change: run-console-progressive-disclosure). Panel visibility is
  // decided ONLY here: no `{!finished && …}` conditions in the body.
  const plan = buildRunConsolePlan({
    status: run.status === 'finished' ? 'finished' : run.status === 'draft' ? 'draft' : 'live',
    teamCount: teams.length,
    alertCount: alerts.length,
    pendingPhotoCount: photoQueues.pendingCount,
    photoQueueCount: photoQueues.pending.length + photoQueues.reviewed.length + (photoLoadError ? 1 : 0),
    feedItemCount: feedItems.length,
    chatThreadCount: chatThreads.length,
    unreadChatThreads,
    hotZoneActive: !!run.hotZone && hotZoneMultiplier(run.hotZone, run.hotZone.center, Date.now()) > 1,
    hasLeaderboard: (run.leaderboard?.rankings.length ?? 0) > 0,
    hasStaffPin: !!staffPin,
    surveyResultCount: surveyResults === null ? null : surveyResults.length,
  });
  const has = (panel: PanelId) => planHasPanel(plan, panel);

  const groupTitles: Record<CollapsibleGroupId, string> = {
    teamsAndScores: rc.groupTeams,
    moderation: rc.groupModeration,
    gameMechanics: rc.groupMechanics,
    shareAndScreens: rc.groupShare,
    afterTheRun: rc.groupAfter,
  };

  // What a FOLDED group still says about itself. Built from the plan's summary,
  // which is the same value the expanded panel renders.
  function groupMeta(group: RunConsoleGroup) {
    const chips: { text: string; color: 'zinc' | 'gold' | 'cyan' | 'red' }[] = [];
    const s = group.summary;
    if (s.teamCount) chips.push({ text: rc.summaryTeams({ n: s.teamCount }), color: 'zinc' });
    if (s.pendingPhotos) chips.push({ text: rc.photoReviewCount({ n: s.pendingPhotos }), color: 'gold' });
    if (s.unreadChats) chips.push({ text: rc.groupUnreadChats({ n: s.unreadChats }), color: 'cyan' });
    if (s.hotZoneActive) chips.push({ text: rc.groupHotZoneOn, color: 'red' });
    if (chips.length === 0) return undefined;
    return (
      <span className="flex flex-wrap items-center gap-1">
        {chips.map((chip) => <Badge key={chip.text} color={chip.color}>{chip.text}</Badge>)}
      </span>
    );
  }

  async function adjustScore(team: RunTeamRow) {
    const raw = await dialog.prompt(rc.scoreAdjustmentPrompt);
    const delta = parseScoreDelta(raw);
    // `parseInt(v) || 0` used to send a zero delta for any garbage input,
    // writing a permanent audit entry for a change that never happened.
    if (delta === null) { if (raw != null && raw.trim() !== '') await dialog.alert(rc.scoreAdjustmentInvalid); return; }
    const signed = delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
    if (!(await dialog.confirm(
      rc.adjustScoreConfirm({ team: team.displayName, delta: signed }),
      rc.adjustScoreConfirmTitle, true,
    ))) return;
    await adjustTeamScore({ ...ctx, teamId: team.id, delta, reason: 'manual' });
    await loadTeams();
  }

  async function skipTeamStage(team: RunTeamRow) {
    if (!(await dialog.confirm(rc.skipConfirm, undefined, true))) return;
    try { await skipStage({ gameId: gameId!, runId: runId!, teamId: team.id }); await loadTeams(); }
    catch { await dialog.alert(rc.skipFailed); }
  }

  function renderPanel(panel: PanelId) {
    switch (panel) {
      case 'teams':
        return (
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">{rc.teamsTitle}</div>
            {teams.length === 0 ? (
              <EmptyState icon="👥" title={rc.noOneJoinedTitle} body={rc.noOneJoinedYet} />
            ) : (
              <div className="space-y-2">
                {teams.map((team) => (
                  <div key={team.id} className="flex flex-wrap items-center gap-3 p-2 rounded-lg bg-app-bg">
                    <div className="flex-1 min-w-[10rem]">
                      <div dir="auto" className="text-sm text-zinc-200">{team.displayName}</div>
                      <div className="text-[11px] text-zinc-500">
                        {team.finished
                          ? rc.teamStatusFinished
                          : !team.launched
                            ? rc.teamStatusWaiting
                            : team.activeStageOrder != null
                              ? rc.teamStageLabel({ n: team.activeStageOrder + 1 })
                              : rc.teamStatusBetween}
                        {' · '}{rc.stageDone({ n: team.completedStages })}
                      </div>
                    </div>
                    {/* Ranked score from the leaderboard snapshot — identical to
                        the live-standings panel + TV. Falls back to the raw earned
                        tally only until the first snapshot exists for this activeRun. */}
                    <div className="text-neon-green font-mono font-semibold">
                      {rankedScoreById.get(team.id) ?? team.score}
                    </div>
                    <Button
                      variant={runActionVariant('skipStage')}
                      className="min-h-0 px-2.5 py-1 text-[11px] rounded-lg"
                      aria-label={rc.skipAria({ team: team.displayName })}
                      onClick={() => void skipTeamStage(team)}
                    >
                      {rc.skip}
                    </Button>
                    {/* Rewriting a team's score is destructive, so it is labelled,
                        named for assistive tech, separated from the routine skip
                        control, and confirmed with the team and the signed delta.
                        It used to be a bare '±' glyph with no accessible name. */}
                    <Button
                      variant={runActionVariant('adjustTeamScore')}
                      className="min-h-0 px-2.5 py-1 text-[11px] rounded-lg ms-1"
                      aria-label={rc.adjustScoreAria({ team: team.displayName })}
                      onClick={() => void adjustScore(team)}
                    >
                      {rc.adjustScore}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );

      case 'liveStandings':
        return (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">{rc.liveStandings}</div>
              <button
                className={`text-[11px] px-2 py-1 rounded-md ${activeRun.leaderboard!.published ? 'bg-neon-green/15 text-neon-green' : 'bg-app-raised text-zinc-400'}`}
                disabled={busy}
                onClick={() => refreshStandings(!activeRun.leaderboard!.published)}
              >
                {activeRun.leaderboard!.published ? rc.standingsVisibleToTeams : rc.standingsHiddenFromTeams}
              </button>
            </div>
            {/* Show ALL teams — at 20 teams a slice(0,12) hid ranks 13-20 mid-activeRun. */}
            <div className="space-y-1">
              {activeRun.leaderboard!.rankings.map((r) => (
                <div key={r.teamId} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-zinc-500">{r.rank}</span>
                  <span dir="auto" className="flex-1 text-zinc-200">{r.teamName}</span>
                  <span className="text-[11px] text-zinc-500">{rc.stageDone({ n: r.completedStages })}</span>
                  <span className="text-neon-green font-mono">{r.score}</span>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-zinc-600 mt-2">
              {rc.organizerOnlyUpdated({ time: new Date(activeRun.leaderboard!.updatedAt).toLocaleTimeString() })}
            </div>
          </Card>
        );

      // The organizer ALWAYS sees the final standings (this reads the run doc
      // directly); `published` only controls the participant surfaces — with
      // manual reveal on, finalizeRun leaves the board unpublished and this
      // button is how the host reveals it.
      case 'finalStandings':
        return (
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-medium">{rc.finalLeaderboard}</div>
              {activeRun.leaderboard!.published ? (
                <span className="text-[11px] px-2 py-1 rounded-md bg-neon-green/15 text-neon-green">
                  {rc.standingsVisibleToTeams}
                </span>
              ) : (
                <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => void revealStandings()}>
                  {rc.revealStandings}
                </Button>
              )}
            </div>
            {!activeRun.leaderboard!.published && (
              <div className="text-[11px] text-amber-400/90 mb-3">{rc.standingsHiddenUntilReveal}</div>
            )}
            <div className="space-y-1">
              {activeRun.leaderboard!.rankings.map((r) => (
                <div key={r.teamId} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-zinc-500">{r.rank}</span>
                  <span dir="auto" className="flex-1 text-zinc-200">{r.teamName}</span>
                  <span className="text-neon-green font-mono">{r.score}</span>
                </div>
              ))}
            </div>
          </Card>
        );

      case 'hotZone': return <HotZonePanel ctx={ctx} hotZone={activeRun.hotZone ?? null} />;
      case 'flashMission': return <FlashMissionCard ctx={ctx} />;
      case 'trackables': return <TrackablesConsole ownerUid={ownerUid} gameId={gameId!} runId={runId!} teams={teams} />;
      case 'zones': return <ZonesConsole ownerUid={ownerUid} gameId={gameId!} runId={runId!} />;

      case 'photoReview':
        return (
          <PhotoReviewConsole
            ctx={ctx}
            pending={photoQueues.pending}
            reviewed={photoQueues.reviewed}
            pendingCount={photoQueues.pendingCount}
            loadError={photoLoadError}
            taskTitles={taskTitles}
          />
        );
      case 'feed': return <FeedConsole ownerUid={ownerUid} gameId={gameId!} runId={runId!} items={feedItems} />;
      case 'chat':
        return (
          <ChatConsole
            ctx={ctx}
            teams={teams}
            threads={chatThreads}
            seen={chatSeen}
            onSeen={(teamId, count) => setChatSeen((s) => (s[teamId] === count ? s : { ...s, [teamId]: count }))}
          />
        );

      case 'shareScreens':
        return (
          <ShareScreens
            accessCode={activeRun.accessCode}
            ctx={ctx}
            status={finished ? 'finished' : 'live'}
            hasStaffPin={!!staffPin}
            onShareBoard={ensureBoardPublished}
          />
        );
      case 'staffInvite': return <StaffInviteCard ctx={ctx} pin={staffPin!} />;

      case 'runSummary': return <RunSummaryPanel accessCode={activeRun.accessCode} />;
      case 'analytics': return <AnalyticsPanel accessCode={activeRun.accessCode} />;
      case 'heatmap': return <HeatmapPanel accessCode={activeRun.accessCode} />;
      case 'feedback': return <FeedbackPanel gameId={gameId} runId={runId} />;
      case 'survey': return <SurveyResultsPanel results={surveyResults} loading={surveyLoading} onRefresh={loadSurvey} />;

      // The primary zone is rendered inline below, never through this switch.
      default: return null;
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-brand text-2xl font-extrabold tracking-tight text-[--ink-1]">{rc.liveRun}</h1>
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
            <span className="text-zinc-500 text-sm">
              {rc.participants({ n: run.participantCount ?? teams.length, max: String(run.maxParticipants ?? '∞') })}
            </span>
          </div>
        </div>
      </div>

      {/* ── PRIMARY ZONE ────────────────────────────────────────────────────────
          Only what the next five minutes need: the code + QR, the join link, the
          station QR sheet, Start all teams, live alerts, the broadcast and the
          live team map. Never collapsible, and nothing else lives here. */}
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-4">
          {/* Live SOS / alerts — the organizer sees these the moment a team raises one */}
          {has('alerts') && (
            <Card className="p-4 border-neon-red/40">
              <div className="text-sm font-medium mb-2 text-neon-red">{rc.activeAlerts({ n: alerts.length })}</div>
              <div className="space-y-2">
                {alerts.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="uppercase text-neon-red font-medium">{rc.alertType(a.type)}</span>
                    {/* A host cannot act on a truncated document id: show the team's name. */}
                    <span dir="auto" className="text-zinc-400 text-xs">
                      {resolveTeamLabel(a.teamId, teams, (id) => rc.unknownTeam({ id }))}
                    </span>
                    {a.message && <span dir="auto" className="text-zinc-300 flex-1 truncate">{a.message}</span>}
                    {a.lat != null && a.lng != null && (
                      <a className="text-neon-green text-xs underline" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">{rc.map}</a>
                    )}
                    <Button variant="subtle" className="min-h-0 px-2.5 py-1 text-xs rounded-lg ms-auto" onClick={() => ack(a.id)}>{rc.acknowledge}</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Routine live-ops actions. Ending the run is NOT here: it sits in its
              own separated end-of-run row at the bottom of the console. */}
          {has('startTeams') && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[--rp-border] bg-[--surface-0]/70 dark:bg-white/[0.03] p-3">
              <Button variant={runActionVariant('startTeams')} disabled={busy} onClick={startAll}>{rc.startAllTeams}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => refreshStandings()}>{rc.refreshStandings}</Button>
              <Button variant="ghost" onClick={invite}>{rc.inviteStaffPin}</Button>
            </div>
          )}

          {/* Live team map — where every team is right now, fed by GPS pings. */}
          {has('liveMap') && (
            <Card className="p-4">
              <div className="text-sm font-medium mb-3">{rc.liveTeamMap}</div>
              <LiveTeamMap ownerUid={ownerUid} gameId={gameId!} runId={runId!} teams={teams} className="h-80" />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {has('joinShare') && <JoinShare accessCode={run.accessCode} />}
          {has('stationQr') && <StationQrPrint gameId={gameId!} />}
          {has('broadcast') && <AnnouncementCard ctx={ctx} teams={teams} />}
        </div>
      </div>

      {/* ── Everything else: named groups, collapsed by default, each reporting
          its live contents while folded. Nothing is more than one labelled click
          away and nothing was removed. */}
      {plan.groups.filter((group) => group.collapsible).map((group) => {
        const id = group.id as CollapsibleGroupId;
        return (
          <Advanced
            key={id}
            title={groupTitles[id]}
            meta={groupMeta(group)}
            open={!!openGroups[id]}
            onToggle={() => toggleGroup(id)}
          >
            {group.panels.map((panel) => <div key={panel}>{renderPanel(panel)}</div>)}
          </Advanced>
        );
      })}

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
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ }
  }
  return (
    <Card className="px-5 py-4 text-center">
      <div className="text-[11px] text-zinc-500 uppercase tracking-widest">{t.runConsole.accessCode}</div>
      <div className="text-2xl font-mono font-bold text-neon-green tracking-[0.3em] mb-2">{accessCode}</div>
      {qr && <img src={qr} alt={t.runConsole.joinQrCode} className="mx-auto rounded-lg bg-white p-1.5 w-36 h-36" />}
      <div className="mt-2 flex flex-col gap-1">
        <button className="text-xs text-neon-green hover:underline" onClick={copy}>
          {copied ? t.runConsole.linkCopied : t.runConsole.copyJoinLink}
        </button>
      </div>
      {/* Temporary per-run phone ceiling (run-device-cap). Reads the SAME shared
          constant the server enforces, so the number is always correct; hides
          itself automatically once the cap is raised to Infinity (removed). */}
      {isRunDeviceCapActive() && (
        <p dir="auto" className="mt-3 pt-3 border-t border-zinc-800 text-[11px] leading-relaxed text-amber-300/80 flex items-start gap-1.5">
          <span aria-hidden="true">⚠️</span>
          <span>{t.runConsole.deviceCapNote({ max: MAX_RUN_DEVICES })}</span>
        </p>
      )}
    </Card>
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
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ }
  }
  return (
    <Card className="p-4 text-sm flex flex-wrap items-center gap-4">
      {qr && <img src={qr} alt={t.runConsole.staffLinkQrAlt} className="rounded-lg bg-white p-1.5 w-28 h-28 shrink-0" />}
      <div className="flex-1 min-w-[12rem] space-y-1.5">
        <div>
          {t.runConsole.staffPinLabel} <span className="font-mono text-neon-green text-lg tracking-widest">{pin}</span>
        </div>
        <button className="text-xs text-neon-green hover:underline" onClick={copy}>
          {copied ? t.runConsole.linkCopied : t.runConsole.staffLinkCopy}
        </button>
        <div className="text-zinc-500 text-xs leading-relaxed">{t.runConsole.staffLinkNote}</div>
      </div>
    </Card>
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
    <Button variant="subtle" onClick={print} loading={busy}>{t.runConsole.printQr}</Button>
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
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>{t.runConsole.announcementPersists}</Label>
        <RichTooltip concept="announcementPersistence" />
      </div>
      <select
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
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
    </Card>
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
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>{t.runConsole.flashMissionTitle}</Label>
        <RichTooltip concept="flashMission" />
      </div>
      <p className="text-[11px] text-zinc-500">{t.runConsole.flashMissionTtlNote({ minutes: FLASH_MISSION_TTL_MINUTES })}</p>
      <Input value={flash} onChange={(e) => setFlash(e.target.value)} placeholder={t.runConsole.flashMissionPlaceholder} dir="auto" />
      <div className="flex gap-2">
        <Input type="number" min="0" value={pts} onChange={(e) => setPts(Math.max(0, parseInt(e.target.value) || 0))} />
        <Button variant={runActionVariant('pushFlashMission')} disabled={!flash || busyFlash} onClick={sendFlash}>
          {t.runConsole.push}
        </Button>
      </div>
    </Card>
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

  const active = !!hotZone && hotZoneMultiplier(hotZone, hotZone.center, Date.now()) > 1;

  async function activate() {
    // A hot zone is inherently geographic — require a real point (0,0 = unset).
    if (!isValidCoord(lat, lng) || (lat === 0 && lng === 0)) { void dialog.alert(t.runConsole.hotZoneNeedsCenter); return; }
    setBusy(true);
    try {
      await activateHotZone({ gameId: ctx.gameId, runId: ctx.runId, center: { lat, lng }, radiusMeters: radius, multiplier: mult, durationMinutes: minutes });
    } finally { setBusy(false); }
  }
  async function deactivate() {
    setBusy(true);
    try { await deactivateHotZone({ gameId: ctx.gameId, runId: ctx.runId }); } finally { setBusy(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <div className="text-sm font-semibold">{t.runConsole.hotZoneTitle}</div>
        <RichTooltip concept="hotZone" />
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">{t.runConsole.hotZoneHelp}</p>
      {active && hotZone ? (
        <div className="space-y-2 text-sm">
          <div className="text-neon-green font-medium">{t.runConsole.hotZoneActive({ mult: hotZone.multiplier })}</div>
          <div className="text-zinc-500">{t.runConsole.hotZoneExpires({ time: new Date(hotZone.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</div>
          <Button variant="danger" disabled={busy} onClick={deactivate}>{t.runConsole.deactivate}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>{t.runConsole.hotZoneCenter}</Label>
          <LocationStep coordinates={{ lat, lng }} onChange={(la, ln) => { setLat(la); setLng(ln); }} mapClassName="h-52" />
          <div className="grid grid-cols-3 gap-2">
            <div><Label>{t.runConsole.hotZoneRadius}</Label><Input type="number" value={radius} onChange={(e) => setRadius(Math.max(1, Number(e.target.value)))} /></div>
            <div><Label>{t.runConsole.hotZoneMultiplier}</Label><Input type="number" value={mult} min={2} max={5} onChange={(e) => setMult(Math.min(5, Math.max(2, Number(e.target.value))))} /></div>
            <div><Label>{t.runConsole.hotZoneDuration}</Label><Input type="number" value={minutes} min={1} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value)))} /></div>
          </div>
          <Button disabled={busy} onClick={activate}>{t.runConsole.activate}</Button>
        </div>
      )}
    </Card>
  );
}

// ── One share surface (change: run-console-progressive-disclosure) ────────────
// A run has SEVEN shareable artifacts, and they used to be spread across three
// cards, two of them labelled with nothing but the emoji '🔗'. Now every one has
// a name, a line saying who it is for, and a named copy action; the URLs come
// from buildShareArtifacts so they are identical to the ones hosts already have.
function ShareScreens({ accessCode, ctx, status, hasStaffPin, onShareBoard }: {
  accessCode: string;
  ctx: { ownerUid: string; gameId: string; runId: string };
  status: RunStatus;
  hasStaffPin: boolean;
  onShareBoard?: () => Promise<void>;
}) {
  const rc = useT().runConsole;
  const [copied, setCopied] = useState<ShareArtifactId | ''>('');
  const artifacts = buildShareArtifacts({
    playUrl: PLAY_URL, accessCode, ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId,
    hasStaffPin, status,
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
    // THEN publish the board for the audience facing links.
    try {
      await navigator.clipboard.writeText(entry.copyValue);
      setCopied(entry.id);
      setTimeout(() => setCopied(''), 2000);
    } catch { /* no clipboard */ }
    if (entry.requiresPublish) await onShareBoard?.();
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm font-semibold">{rc.shareTitle}</div>
      <p className="text-xs text-zinc-500 leading-relaxed">{rc.shareIntro}</p>
      <div className="space-y-2">
        {artifacts.map((entry) => (
          <div key={entry.id} className="rounded-lg bg-app-bg p-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[12rem]">
              <div className="text-sm text-zinc-200">{NAME[entry.id]}</div>
              <div className="text-[11px] text-zinc-500 leading-relaxed">{DESC[entry.id]}</div>
              {!entry.available && (
                <div className="text-[11px] text-amber-400/90 mt-0.5">
                  {entry.unavailableUntilFinished ? rc.shareAfterRunOnly
                    : entry.unavailableAfterFinish ? rc.shareWhileOpenOnly
                    : rc.shareStaffLocked}
                </div>
              )}
            </div>
            {entry.id === 'accessCode' && (
              <span className="font-mono text-neon-green tracking-[0.2em] text-sm">{accessCode}</span>
            )}
            <Button
              variant="ghost"
              className="min-h-0 px-3 py-1.5 text-xs rounded-lg"
              disabled={!entry.available}
              aria-label={rc.shareCopyAria({ name: NAME[entry.id] })}
              onClick={() => void copy(entry)}
            >
              {copied === entry.id ? rc.linkCopied : rc.shareCopyAction}
            </Button>
            {entry.url && (
              <Button
                variant="ghost"
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
    </Card>
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
  const nameOf = (id?: string | null) => teams.find((x) => x.id === id)?.displayName ?? id ?? '';

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
    try { await createTrackable({ gameId, runId, name: name.trim() }); setName(''); setTick((x) => x + 1); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-1">🎒 {rc.trackablesTitle}</div>
      <p className="text-xs text-zinc-500 leading-relaxed mb-3">{rc.trackablesHelp}</p>
      <div className="flex gap-2 mb-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={rc.trackablesPlaceholder} dir="auto" className="flex-1" />
        <Button variant="ghost" disabled={busy || !name.trim()} onClick={create}>{rc.trackablesAdd}</Button>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-zinc-500">{rc.trackablesEmpty}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((tr) => (
            <div key={tr.id} className="flex items-center justify-between text-sm">
              <span className="text-zinc-200" dir="auto">{tr.name}</span>
              <span className="text-zinc-500 text-xs">
                {tr.currentHolderTeamId ? rc.trackablesHeldBy({ name: nameOf(tr.currentHolderTeamId) }) : rc.trackablesUnheld}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
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
    finally { setBusy(false); }
  }
  async function remove(zoneId: string) {
    if (!(await dialog.confirm(rc.zonesDeleteConfirm, undefined, true))) return;
    await deleteZone({ gameId, runId, zoneId }).catch(() => undefined);
    setTick((x) => x + 1);
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-1">🚩 {rc.zonesTitle}</div>
      <p className="text-xs text-zinc-500 leading-relaxed mb-3">{rc.zonesHelp}</p>
      <div className="flex flex-wrap gap-2 mb-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={rc.zonesTitlePlaceholder} dir="auto" className="flex-1 min-w-[8rem]" />
        <Button variant="ghost" disabled={busy || !title.trim()} onClick={create}>{rc.zonesAdd}</Button>
      </div>
      <div className="mb-3">
        <LocationStep coordinates={{ lat, lng }} onChange={(la, ln) => { setLat(la); setLng(ln); }} mapClassName="h-52" />
      </div>
      {zones.length === 0 ? (
        <div className="text-sm text-zinc-500">{rc.zonesEmpty}</div>
      ) : (
        <div className="space-y-1.5">
          {zones.map((z) => (
            <div key={z.id} className="flex items-center justify-between text-sm gap-2">
              <span className="text-zinc-200 flex-1" dir="auto">{z.title}</span>
              <span className="text-zinc-500 text-xs">{z.ownerTeamId ? rc.zonesHeldBy({ name: z.ownerTeamName ?? '' }) : rc.zonesOpen}</span>
              <button className="text-neon-red text-xs" onClick={() => remove(z.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </Card>
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
function PhotoReviewConsole({ ctx, pending, reviewed, pendingCount, loadError, taskTitles }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  pending: SubmissionRow[];
  reviewed: SubmissionRow[];
  pendingCount: number;
  loadError: boolean;
  taskTitles: ReadonlyMap<string, string>;
}) {
  const rc = useT().runConsole;

  async function review(row: SubmissionRow, approved: boolean) {
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
      toast.success(approved ? rc.photoReviewApproved : rc.photoReviewRejected);
    } catch {
      toast.error(rc.photoReviewFailed);
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
      return <div className="text-[11px] text-zinc-500">{rc.photoReviewNoPhoto}</div>;
    }
    if (row.mediaKind === 'audio') {
      return <audio controls preload="none" src={row.photoUrl} className="w-full" aria-label={rc.photoReviewAudio} />;
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

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium">📷 {rc.photoReview}</div>
        {pendingCount > 0 && (
          <Badge color="gold">{rc.photoReviewCount({ n: pendingCount })}</Badge>
        )}
      </div>
      <p className="text-[11px] text-zinc-500 mb-3">{rc.photoReviewHelp}</p>

      {loadError && (
        <p className="text-[11px] text-neon-red mb-3" role="status">{rc.photoReviewLoadError}</p>
      )}

      {pending.length === 0
        ? <p className="text-zinc-500 text-sm">{rc.photoReviewNone}</p>
        : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pending.map((row) => {
              const key = submissionKey(row);
              return (
                <div key={key} className="rounded-lg bg-app-bg p-2">
                  <Media row={row} />
                  <div dir="auto" className="text-xs text-zinc-200 truncate mt-2">{row.displayName}</div>
                  <div dir="auto" className="text-[11px] text-zinc-500 truncate">
                    {rc.photoReviewTaskLabel} {taskLabel(row.taskId)}
                  </div>
                  {row.submittedAt && (
                    <div className="text-[11px] text-zinc-600">
                      {rc.photoReviewSubmittedAt({ time: clock(row.submittedAt) })}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      className="flex-1"
                      disabled={reviewAction.isBusy(key)}
                      onClick={() => { void reviewAction.run(row, true).catch(() => undefined); }}
                    >
                      {rc.photoReviewApprove}
                    </Button>
                    <Button
                      variant="ghost"
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
        )}

      {reviewed.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-zinc-500 mb-2">{rc.photoReviewRecent}</div>
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
                  <span className={row.status === 'approved' ? 'text-neon-green' : 'text-neon-red'}>
                    {row.status === 'approved' ? rc.photoReviewTagApproved : rc.photoReviewTagRejected}
                  </span>
                  <span dir="auto" className="text-zinc-300 truncate flex-1">{row.displayName}</span>
                  <span dir="auto" className="text-zinc-600 truncate">{taskLabel(row.taskId)}</span>
                  <button
                    className="text-zinc-500 disabled:text-zinc-700 disabled:cursor-not-allowed"
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
    </Card>
  );
}

// Live photo feed console (change: live-photo-feed): the run's active feed items
// (owner reads the collection directly; server writes only) with a hide action.
// The feed listener moved to the page so a FOLDED moderation group can report
// its contents; this panel renders what it is given.
type FeedItemRow = { id: string; taskTitle: string; teamName: string; photoUrl: string; reactions?: Record<string, number>; createdAt?: string };

function FeedConsole({ ownerUid, gameId, runId, items }: { ownerUid: string; gameId: string; runId: string; items: FeedItemRow[] }) {
  const rc = useT().runConsole;

  async function hide(itemId: string) {
    if (!(await dialog.confirm(rc.feedHideConfirm, undefined, true))) return;
    await hideFeedItem({ ownerUid, gameId, runId, itemId }).catch(() => undefined);
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-3">📸 {rc.feedTitle({ n: items.length })}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg bg-app-bg overflow-hidden">
            <img src={item.photoUrl} alt="" loading="lazy" className="w-full h-28 object-cover" />
            <div className="p-2">
              <div dir="auto" className="text-xs text-zinc-200 truncate">{item.teamName}</div>
              <div dir="auto" className="text-[11px] text-zinc-500 truncate">{item.taskTitle}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-zinc-500 font-mono">
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
    </Card>
  );
}

// Team ↔ HQ chat (change: team-hq-chat): per-team threads. The owner reads the
// whole chat collection (rules grant it) via one snapshot and replies as HQ. A
// thread with new messages since it was last opened shows an unread badge (local).
interface ChatThreadRow { teamId: string; messages: ChatMessage[]; updatedAt: string }

// The thread listener and the read/unread bookkeeping moved to the page, which
// needs the unread count for the folded moderation badge.
function ChatConsole({ ctx, teams, threads, seen, onSeen }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: RunTeamRow[];
  threads: ChatThreadRow[];
  seen: Record<string, number>;
  onSeen: (teamId: string, count: number) => void;
}) {
  const rc = useT().runConsole;
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // Keep the currently-open thread marked read as its message count grows — an HQ
  // reply (or a message that arrives while HQ is watching) must not re-badge the
  // very thread being read. Without this, sending a reply flags it "unread".
  useEffect(() => {
    if (!openTeam) return;
    const th = threads.find((x) => x.teamId === openTeam);
    if (!th) return;
    onSeen(openTeam, th.messages.length);
  }, [openTeam, threads, onSeen]);

  // A team's NAME, never a truncated document id.
  const nameFor = (teamId: string) => resolveTeamLabel(teamId, teams, (id) => rc.unknownTeam({ id }));

  function expand(teamId: string, count: number) {
    setOpenTeam((cur) => {
      const next = cur === teamId ? null : teamId;
      if (next) onSeen(teamId, count);
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
    } catch { /* the listener reconciles; keep the draft for a retry */ }
    finally { setBusy(false); }
  }

  const totalUnread = threads.reduce((n, th) => n + (th.messages.length > (seen[th.teamId] ?? 0) ? 1 : 0), 0);

  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-3">
        💬 {rc.chatTitle}
        {totalUnread > 0 && (
          <span className="ms-2 inline-flex items-center rounded-full bg-neon-blue/20 text-neon-blue px-2 py-0.5 text-[11px] font-semibold">{totalUnread}</span>
        )}
      </div>
      <div className="space-y-2">
        {threads.map((th) => {
          const last = th.messages[th.messages.length - 1];
          const unread = th.messages.length > (seen[th.teamId] ?? 0);
          const expanded = openTeam === th.teamId;
          return (
            <div key={th.teamId} className="rounded-lg bg-app-bg p-3">
              <button className="w-full text-start" onClick={() => expand(th.teamId, th.messages.length)}>
                <div className="flex items-center justify-between gap-2">
                  <span dir="auto" className="text-sm font-medium text-zinc-200 truncate">{nameFor(th.teamId)}</span>
                  {unread && <span className="shrink-0 inline-flex items-center rounded-full bg-neon-blue/20 text-neon-blue px-2 py-0.5 text-[11px] font-semibold">{rc.chatUnread}</span>}
                </div>
                {last && <div dir="auto" className="text-[11px] text-zinc-500 truncate mt-0.5">{last.from === 'hq' ? `${rc.chatHq}: ` : ''}{last.text}</div>}
              </button>
              {expanded && (
                <div className="mt-2 space-y-2">
                  <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5">
                    {th.messages.map((m) => (
                      <div key={m.id} className={`flex flex-col ${m.from === 'hq' ? 'items-end' : 'items-start'}`}>
                        <span className="text-[11px] text-zinc-500">{m.from === 'hq' ? rc.chatHq : m.senderName}</span>
                        <div dir="auto" className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm text-start ${m.from === 'hq' ? 'bg-neon-blue/15 border border-neon-blue/40 text-zinc-100' : 'bg-app-card border border-zinc-700 text-zinc-200'}`}>{m.text}</div>
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
                    <Button onClick={() => void reply(th.teamId)} disabled={busy || !draft.trim()}>
                      {rc.chatSend}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
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
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{t.runConsole.heatmapTitle}</div>
        {!data && <Button variant="ghost" disabled={busy} onClick={load}>{t.runConsole.heatmapLoad}</Button>}
      </div>
      {err && !data && <div className="text-sm text-danger">{err}</div>}
      {data && (
        data.pointCount === 0
          ? <div className="text-sm text-zinc-500">{t.runConsole.heatmapEmpty}</div>
          : (
            <div className="space-y-2">
              <div className="text-sm text-zinc-400">{t.runConsole.heatmapPoints({ n: data.pointCount })}</div>
              <HeatmapMap cells={data.cells} className="h-80" />
            </div>
          )
      )}
    </Card>
  );
}

// ─── Post-run summary panel (run-summary-report) ──────────────────────────────
// Auto-loads once the run is finished: a one-glance organizer report folding
// standings + completion + feedback digest, plus a note that the same summary is
// emailed to the organizer. Mirrors AnalyticsPanel's load pattern.
function RunSummaryPanel({ accessCode }: { accessCode: string }) {
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
    <Card className="p-4 space-y-3">
      <div className="text-sm font-semibold">{t.runConsole.summaryTitle}</div>
      {err && !data && <div className="text-sm text-danger">{err}</div>}
      {!data && !err && <div className="text-sm text-zinc-500">{t.runConsole.summaryNoData}</div>}
      {data && (
        <div className="space-y-3">
          {/* Standings */}
          <div>
            <div className="text-xs text-zinc-500 mb-1">{t.runConsole.summaryStandings}</div>
            {data.standings.length === 0 ? (
              <div className="text-sm text-zinc-500">{t.runConsole.summaryNoData}</div>
            ) : (
              <ol className="space-y-0.5">
                {data.standings.slice(0, 5).map((s) => (
                  <li key={s.teamId} className="flex items-center justify-between text-sm">
                    <span>{s.rank}. {s.teamName}</span>
                    <span className="font-mono text-zinc-400">{s.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {/* Completion headline */}
          <div>
            <div className="text-xs text-zinc-500 mb-1">{t.runConsole.summaryCompletion}</div>
            <div className="text-sm text-zinc-400">
              {t.runConsole.summaryTeams({ n: data.completion.teamCount })}
              {' · '}
              {t.runConsole.summaryCompletionRate({ pct: Math.round(data.completion.overallCompletionRate * 100) })}
              {' · '}
              {t.runConsole.summaryPhotos({ n: data.completion.photoCount })}
            </div>
          </div>
          {/* Feedback digest */}
          <div>
            <div className="text-xs text-zinc-500 mb-1">{t.runConsole.summaryFeedback}</div>
            <div className="text-sm text-zinc-400 space-y-1">
              <div>
                {t.runConsole.feedbackResponseRate({ n: data.feedback.responseCount, total: data.feedback.participantCount })}
                {' · '}
                {t.runConsole.feedbackRecommend({ pct: Math.round(data.feedback.recommendScore * 100) })}
              </div>
              {data.feedback.topIssues.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {data.feedback.topIssues.map((it) => (
                    <Badge key={it.issue}>{issueLabel[it.issue] ?? it.issue} · {it.count}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-zinc-500">{t.runConsole.summaryEmailNote}</div>
        </div>
      )}
    </Card>
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
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{t.runConsole.analyticsTitle}</div>
        <div className="flex items-center gap-2">
          {data && data.tasks.length > 0 && (
            <Button variant="ghost" onClick={exportCsv}>{t.runConsole.analyticsExport}</Button>
          )}
          {!data && <Button variant="ghost" disabled={busy} onClick={load}>{t.runConsole.analyticsLoad}</Button>}
        </div>
      </div>
      {err && !data && <div className="text-sm text-danger">{err}</div>}
      {data && (
        data.tasks.length === 0 ? (
          <div className="text-sm text-zinc-500">{t.runConsole.analyticsEmpty}</div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-zinc-400">{t.runConsole.analyticsOverall({ pct: Math.round(data.overallCompletionRate * 100) })}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-zinc-500 text-xs text-start">
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
                      <td className="py-1.5">{TYPE_EMOJI[task.type] ?? '•'} {TYPE_LABEL[task.type] ?? task.type}</td>
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
    </Card>
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
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{t.runConsole.feedbackTitle}</div>
        {s && <div className="text-xs text-zinc-500">{t.runConsole.feedbackResponseRate({ n: s.responseCount, total: s.participantCount })}</div>}
      </div>

      {err && !s && <div className="text-sm text-danger">{err}</div>}
      {!s ? null : s.responseCount === 0 ? (
        <div className="text-sm text-zinc-500">{t.runConsole.feedbackEmpty}</div>
      ) : (
        <div className="space-y-4">
          {s.ratings.recommend && (
            <div className="text-sm text-neon-green">{t.runConsole.feedbackRecommend({ pct: Math.round(s.recommendScore * 100) })}</div>
          )}

          {/* 1–5 dimension tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FIVE_DIMS.filter((k) => s.ratings[k]).map((k) => (
              <div key={k} className="bg-[--rp-raised] rounded-xl px-3 py-2.5">
                <div className="text-[11px] text-zinc-500 mb-0.5">{dimLabel[k]}</div>
                <div className="text-lg font-bold text-neon-green">
                  {s.ratings[k]!.avg.toFixed(1)}
                  <span className="text-xs font-normal text-zinc-500"> / 5 · {s.ratings[k]!.count}</span>
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
              <div className="text-xs text-zinc-500 mb-1.5">{t.runConsole.feedbackIssuesTitle}</div>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_ISSUES.filter((i) => (s.issueCounts[i] ?? 0) > 0).map((i) => (
                  <span key={i} className="rounded-full bg-neon-red/10 border border-neon-red/30 text-neon-red text-xs px-2.5 py-1">
                    {issueLabel[i]} · {s.issueCounts[i]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* comments + drill-down list */}
          <div>
            <div className="text-xs text-zinc-500 mb-1.5">{t.runConsole.feedbackCommentsTitle({ n: comments.length })}</div>
            {responses.length === 0 ? (
              <div className="text-sm text-zinc-500">{t.runConsole.feedbackNoComments}</div>
            ) : (
              <div className="space-y-1.5">
                {responses.map((r) => (
                  <button key={r.uid} onClick={() => setOpen(r)}
                    className="w-full text-start rounded-lg bg-[--rp-raised] hover:bg-[--rp-card] px-3 py-2 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span dir="auto" className="text-sm font-medium truncate">
                        {r.teamName}{r.memberName ? ` · ${r.memberName}` : ''}
                      </span>
                      <span className="text-xs text-zinc-500 shrink-0">{t.runConsole.feedbackViewResponse}</span>
                    </div>
                    {r.comment && <div dir="auto" className="text-sm text-zinc-400 truncate mt-0.5">“{r.comment}”</div>}
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
              <button onClick={() => setOpen(null)} className="text-zinc-500 text-sm">{t.runConsole.feedbackClose}</button>
            </div>
            <div className="text-xs text-zinc-500">{t.runConsole.feedbackResponseTitle}</div>
            <div className="space-y-1.5">
              {(['overall', 'content', 'bonding', 'difficulty', 'smoothness', 'recommend'] as FeedbackRatingKey[]).map((k) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-zinc-400">{dimLabel[k]}</span>
                  <span className="font-medium">{open.ratings[k] ?? <span className="text-zinc-600">{t.runConsole.feedbackNoAnswer}</span>}</span>
                </div>
              ))}
            </div>
            {open.issues && open.issues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {open.issues.map((i) => (
                  <span key={i} className="rounded-full bg-neon-red/10 border border-neon-red/30 text-neon-red text-xs px-2 py-0.5">{issueLabel[i]}</span>
                ))}
              </div>
            )}
            {open.comment && <p dir="auto" className="text-sm bg-[--rp-raised] rounded-lg px-3 py-2">{open.comment}</p>}
          </Card>
          </div>
        </div>
      )}
    </Card>
  );
}

function Distribution({ title, bars }: { title: string; bars: [string, number][] }) {
  const max = Math.max(1, ...bars.map(([, n]) => (Number.isFinite(n) ? n : 0)));
  return (
    <div className="bg-[--rp-raised] rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1.5">
        {bars.map(([label, rawN]) => {
          const n = Number.isFinite(rawN) ? rawN : 0;
          return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-zinc-400 truncate">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-black/20 overflow-hidden">
              <div className="h-full rounded-full bg-neon-green/60" style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className="w-5 text-end text-zinc-400">{n}</span>
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
function SurveyResultsPanel({ results, loading, onRefresh }: {
  results: SurveyResultRow[] | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const t = useT();

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{t.runConsole.surveyTitle}</div>
        <Button variant="ghost" className="text-xs" disabled={loading} onClick={onRefresh}>
          {loading ? t.runConsole.surveyRefreshing : t.runConsole.surveyRefresh}
        </Button>
      </div>

      {results === null ? (
        <div className="text-sm text-zinc-500">{t.runConsole.surveyLoading}</div>
      ) : (
        <div className="space-y-5">
          {results.map((r) => (
            <div key={r.taskId} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div dir="auto" className="text-sm font-medium truncate">{r.title}</div>
                <div className="text-xs text-zinc-500 shrink-0">{t.runConsole.surveyResponseCount({ n: r.responseCount })}</div>
              </div>
              {r.counts && r.surveyChoices ? (
                <Distribution
                  title={t.runConsole.surveyChoiceCounts}
                  bars={r.surveyChoices.map((c) => [c, r.counts![c] ?? 0])}
                />
              ) : r.responseCount === 0 ? (
                <div className="text-sm text-zinc-500">{t.runConsole.surveyNoResponses}</div>
              ) : (
                <div className="space-y-1.5">
                  {(r.responses ?? []).map((row, i) => (
                    <div key={i} className="rounded-lg bg-[--rp-raised] px-3 py-2">
                      <div dir="auto" className="text-xs text-zinc-500 mb-0.5 truncate">{row.teamName}</div>
                      <div dir="auto" className="text-sm">{row.response}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
