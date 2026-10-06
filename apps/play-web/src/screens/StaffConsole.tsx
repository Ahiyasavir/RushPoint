import { Fragment, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWideLayout } from '../lib/useWideLayout';
import { STAFF_PHONE_ORDER, staffDesktopLayout, staffDeskCounts, type StaffSection } from '../lib/staffLayout';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, signInStaff, uid } from '../services/firebase';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { useStaffAccess } from '../hooks/useStaffAccess';
// Live photo feed moderation (live-photo-feed): lazy, loads on first open.
// lazyWithRetry so a stale-shell chunk 404 self-heals after a redeploy (wave-g #2).
const FeedPanel = lazyWithRetry('feed', () => import('../components/FeedPanel'));
import {
  staffSignIn,
  reviewStationSubmission,
  acknowledgeAlert,
  pushAnnouncement,
  adjustTeamScore,
  sendTeamChatMessage,
  setTeamHold,
  routeTeam,
  markTeamArrived,
  clearTeamOutOfBounds,
  skipTaskForTeam,
  // send-team-back
  returnTeamTo, getRunOutline, refreshStaffSession, type SendBackTarget,
  sendStaffChannelMessage,
  reviewFlashMission, deactivateFlashMission,
} from '../services/calls';
import {
  FIRESTORE_PATHS, CHAT_TEXT_MAX_LEN, chatMessageSide, chatSeenMarker, countUnreadChatMessages,
  staffChannelMessageSide, staffChannelSeenStorageKey,
  type ChatMessage, type ChatSeenMarker, type StaffChannelMessage,
} from '@rushpoint/shared';
import {
  OTHER_REASON, reasonsForDelta, resolveReason, parseAdjustAmount, type ScoreReasonId,
  newPendingKeys, submissionKey, submissionSenderName,
  // skip-keeps-the-stage: the confirm states the server's own dry run.
  skipPreviewLines, type SkipPreviewLine,
  // send-team-back: the same targets the organizer's console offers.
  sendBackTargets,
  // quick-dial-and-actions 2.5: the same call targets the organizer's team page offers.
  teamCallTargets, toTelHref, toWhatsAppHref, type PublicContact,
  // review-wait-alarm: the same pure verdict the organizer's console reads.
  reviewWaitAlarm, reviewRowTone, REVIEW_ALARM_MS,
  // Overnight 2026-09-29: counts on the quick-bar chips.
  staffQuickBadges,
  type WaivableKind,
} from '@rushpoint/shared';
import { filterTeamsByName } from '../lib/staffTeamFilter';
import { staffFlashLists } from '../lib/staffFlash';
import { TAP_TARGET } from '../lib/interaction';
import StaffQuickBar from '../components/StaffQuickBar';
import StaffFollowedStrip, { type StaffFollowedCard } from '../components/StaffFollowedStrip';
import { useFollowedTeams } from '../lib/useFollowedTeams';
import { followedTeamStatus, followedTeamAction, sortFollowedFirst } from '@rushpoint/shared';
import { hqSenderLabel } from '@rushpoint/shared';
import { mergeOpenedThreads, isMyThread, pickableTeams } from '../lib/staffChatThreads';
import StaffRoutePanel from '../components/StaffRoutePanel';
import { staffLetInTarget } from '../lib/staffRouteList';
import type { StaffCtx } from '../lib/playRoute';
import {
  loadStaffSession,
  saveStaffSession,
  clearStaffSession,
  loadChatSeen,
  saveChatSeen,
  readSeenMarker,
  writeSeenMarker,
  type StaffSession,
} from '../store';
import { Button, Card, Collapsible, CollapsibleEmbedded, Input, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { feedback } from '../lib/sound';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { classifyStaffError, announcementPayload, type StaffFailure } from '../lib/failureCopy';

// Issue #16: an anonymous user here means a player joined in another tab of this browser and
// replaced the staff identity (the console's custom-token user is never anonymous).
function staffIdentityHint() {
  return { signedInAsPlayer: auth.currentUser?.isAnonymous === true };
}
import { missionSpots, type MissionSpot } from '../lib/staffMap';
import { hasMoreActions, staffTeamActions } from '../lib/staffTeamActions';
import { dialog } from '../components/dialog';
import { Icon } from '../components/Icon';

// ── A flattened pending photo submission row (one per team×task) ──
interface PendingSubmission {
  teamId: string;
  displayName: string;
  taskId: string;
  photoUrl: string;
  submittedAt: string;
  // audio-tasks: how to render the submission (absent ⇒ 'photo' for legacy rows).
  mediaKind?: 'photo' | 'audio' | 'video';
  /** team-phones-simple D2: which phone sent it ('' = the team's own phone / unknown). */
  senderName: string;
}

interface Alert {
  id: string;
  teamId: string;
  type: string;
  message: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  /** sos-callback-and-authorities: '' when the team left none. */
  callbackPhone: string;
}

// ── A team row for the manual bonus/deduction panel ──
// The field-ops fields (staff-console-field-ops) ride the SAME live snapshot that
// already feeds this panel, so search, the hold toggle, the out-of-bounds release
// and force-assign all cost zero extra reads.
interface TeamRow {
  id: string;
  displayName: string;
  score: number;
  held?: boolean;
  heldReason?: string;
  outOfBounds?: boolean;
  activeTaskId?: string | null;
  /** Task ids still open in this team's ACTIVE stage — the force-assign menu. */
  assignableTaskIds?: string[];
  /** The team's stage records, for the send-back panel (change: send-team-back). */
  stages?: unknown;
  /** Registration answers, for the call buttons (quick-dial-and-actions 2.5). */
  registrationData?: unknown;
  /** This team's flash-mission claims (flash-missions-v2 design D6: they live on the team). */
  flashClaims?: Record<string, { status?: unknown; at?: unknown; submittedAt?: unknown; mediaUrl?: unknown } | null | undefined> | null;
  /** followed-teams: started / finished / removed, for the one status a followed card shows. */
  launched?: boolean;
  status?: string;
  removed?: boolean;
}

/** Stage and mission names for the run (getRunOutline), since staff cannot read the game. */
type RunOutline = {
  // staff-event-map: `spot` is where a located mission is (absent when it has none).
  stages: { id: string; title: string; tasks: { id: string; title: string; spot?: { lat: number; lng: number; hidden?: boolean } }[] }[];
  /** quick-dial-and-actions 2.5: the game's phone-type registration fields (ids + labels). */
  phoneFields?: { id: string; label: string }[];
  /** located-mission-arrival: this run opens located missions only on arrival. */
  arrivalGate?: boolean;
};

export default function StaffConsole({ ctx, onExit }: { ctx: StaffCtx | null; onExit: () => void }) {
  const [staff, setStaff] = useState<StaffSession | null>(() => loadStaffSession());

  if (!staff) return <StaffSignIn ctx={ctx} onSignedIn={setStaff} onExit={onExit} />;
  return <StaffDashboard staff={staff} onSignOut={() => { clearStaffSession(); onExit(); }} />;
}

// ─── Sign-in ────────────────────────────────────────────────────────────────
// Onboarding used to demand FOUR fields: ownerUid, gameId, runId and the PIN.
// The first three are addressing, not secrets — they are already in the invite
// link, so typing them is pure friction. When the link carries them (any staff
// link shape, see lib/playRoute.ts) the marshal now types their own name and the
// PIN, nothing else. The three ids stay editable ONLY as the fallback for someone
// who opened /?staff with no context.
//
// The PIN is deliberately still typed and is NOT in the link: the QR is printed,
// photographed and forwarded, and it must grant nothing on its own. Server-side
// auth is untouched — staffSignIn still verifies the PIN against this run's
// staffInvites and mints the ownerUid/gameId/runId-scoped custom token.
// The staff confirm's wording for a skip preview (change: skip-keeps-the-stage). One line per fact,
// in the order skipPreviewLines decided, so this console and the organizer's cannot drift.
function staffSkipPreviewText(lines: SkipPreviewLine[], t: ReturnType<typeof useT>['t']): string {
  const p = t.staff.skipPreview;
  return lines.map((l) => {
    switch (l.key) {
      case 'skips': return p.skips({ title: l.title });
      case 'opens': return p.opens({ titles: l.titles.join(', ') });
      case 'endsStage': return p.endsStage;
      case 'staysInStage': return p.staysInStage;
      case 'requirementLowered': return p.requirementLowered({ n: l.required });
      case 'consolation': return p.consolation({ n: l.points });
    }
  }).join(NEWLINE);
}
const NEWLINE = String.fromCharCode(10);

function StaffSignIn({
  ctx,
  onSignedIn,
  onExit,
}: {
  ctx: StaffCtx | null;
  onSignedIn: (s: StaffSession) => void;
  onExit: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  // Which field the last press found empty, so the answering button can point at it.
  const [missing, setMissing] = useState<'name' | 'pin' | null>(null);

  async function submit() {
    setErr('');
    // An answering button, not a disabled one (CLAUDE.md): say what is missing.
    if (!name.trim()) { setMissing('name'); setErr(t.staff.signInNeedName); return; }
    if (!pin.trim()) { setMissing('pin'); setErr(t.staff.signInNeedCode); return; }
    setMissing(null);
    try {
      // Send the typed name so it reaches the `staffName` token claim: audit rows
      // (approvals, score adjustments) are written server-side from the claim, so a
      // client-only name would leave the trail saying "Staff 1" instead of who acted.
      // A link still sends the run address it carries; without one the code finds its own run
      // (staff-code-from-join-code) and the address comes back in the result.
      const res = await staffSignIn({
        ...(ctx ? { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId } : {}),
        pin: pin.trim(), name: name.trim(),
      });
      await signInStaff(res.customToken);
      const session: StaffSession = {
        ownerUid: res.ownerUid, gameId: res.gameId, runId: res.runId,
        // The marshal's own name wins over the placeholder the organizer typed
        // when minting the PIN. NOTE: attribution in the audit trail still comes
        // from the `staffName` token claim — carrying this to the server needs a
        // staffSignIn payload field (see docs/wave-e/staff-qr-onboarding-plan.md).
        name: name.trim() || res.name,
        capabilities: res.capabilities,
        codeId: res.codeId,
      };
      saveStaffSession(session);
      onSignedIn(session);
    } catch (e) {
      // Localize the server's English rejections by code instead of leaking them.
      const code = (e && typeof e === 'object' && 'code' in e
        ? String((e as { code?: unknown }).code ?? '') : '').replace(/^functions\//, '');
      setErr(
        code === 'failed-precondition' ? t.staff.signInCodeClosed
        : code === 'permission-denied' ? t.staff.signInRemoved
        : code === 'not-found' ? t.staff.signInInvalidPin
        : code === 'resource-exhausted' ? t.staff.signInLocked
        : code === 'invalid-argument' ? t.staff.signInBadDetails
        : t.staff.signInFailed,
      );
    }
  }
  // In-flight guard (change: wave-b/async-action-guard) — a double-tapped sign-in
  // burned two PIN attempts against the server's lockout counter.
  const submitAction = useAsyncAction(submit);
  const busy = submitAction.busy;

  return (
    <Screen>
      <div className="flex-1 flex flex-col justify-center">
        <h1 className="font-brand text-2xl font-extrabold text-ink-fire text-center mb-1">{t.staff.consoleTitle}</h1>
        <p className="text-zinc-500 text-center mb-8 text-sm">{t.staff.signInSub}</p>
        <div className="space-y-3">
          {/* Two fields, with or without a link (staff-code-from-join-code). The three run ids
              this screen used to ask for are inside the code now. */}
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); if (missing === 'name') setMissing(null); }}
            placeholder={t.join.yourName}
            autoFocus
            dir="auto"
            aria-invalid={missing === 'name' || undefined}
            onKeyDown={(e) => { if (e.key === 'Enter') void submitAction.run(); }}
          />
          <Input
            value={pin}
            dir="ltr"
            onChange={(e) => { setPin(e.target.value.toUpperCase()); if (missing === 'pin') setMissing(null); }}
            placeholder={t.staff.pin}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            aria-invalid={missing === 'pin' || undefined}
            className="text-center text-xl font-mono tracking-[0.3em]"
            onKeyDown={(e) => { if (e.key === 'Enter') void submitAction.run(); }}
          />
        </div>
        {err && <p className="text-danger text-sm text-center mt-3" role="alert">{err}</p>}
        <Button disabled={busy} loading={busy} onClick={() => void submitAction.run()} className="mt-5">
          {t.staff.signIn}
        </Button>
        <button className="inline-flex items-center justify-center min-h-[44px] px-3 text-zinc-500 text-sm mt-2 mx-auto" onClick={onExit}>{t.staff.backToJoin}</button>
      </div>
    </Screen>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function StaffDashboard({ staff, onSignOut }: { staff: StaffSession; onSignOut: () => void }) {
  const { t } = useT();
  // desktop-layouts-play-staff: three columns on a computer, the phone layout below 1024px.
  const wide = useWideLayout();
  const { ownerUid, gameId, runId } = staff;
  const ctx = useMemo(() => ({ ownerUid, gameId, runId }), [ownerUid, gameId, runId]);
  // What this person's code allows RIGHT NOW (staff-capabilities): listens to their own grant and
  // code, refreshes the session when the organizer edits the code, and notices a removal.
  const access = useStaffAccess(staff);
  const can = access.can;
  // send-team-back: mission NAMES for this run, fetched once. Without them the force-assign and
  // send-back menus could only show raw mission ids. A failure keeps the ids as the fallback.
  const [outline, setOutline] = useState<RunOutline | null>(null);
  // quick-dial-and-actions 2.5: tonight's numbers marked for staff. Staff cannot read the run
  // document, so they come from the session refresh; the token it also returns is not needed here.
  const [contacts, setContacts] = useState<PublicContact[]>([]);
  useEffect(() => {
    let alive = true;
    refreshStaffSession(ctx).then((r) => { if (alive) setContacts(Array.isArray(r.contacts) ? r.contacts : []); }).catch(() => undefined);
    return () => { alive = false; };
  }, [ctx]);
  useEffect(() => {
    let alive = true;
    getRunOutline(ctx).then((o) => { if (alive) setOutline(o); }).catch(() => undefined);
    return () => { alive = false; };
  }, [ctx]);
  const titleOf = useCallback((taskId: string): string => {
    for (const s of outline?.stages ?? []) {
      const tk = s.tasks.find((x) => x.id === taskId);
      if (tk?.title) return tk.title;
    }
    return taskId.slice(0, 18);
  }, [outline]);

  const [pending, setPending] = useState<PendingSubmission[]>([]);
  // Baselined to null so the FIRST snapshot never cues, however many items are
  // already waiting (change: live-ops-feedback-loop). Same shape as seenAlertIds.
  const seenPendingKeys = useRef<Set<string> | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // Issue 25: the SOS card's chat button opens that team's thread in the chat section.
  const [chatFocus, setChatFocus] = useState<{ teamId: string; nonce: number } | null>(null);
  // followed-teams: "הקבוצות שלי", per run and per person on this phone (Ahiya, 2026-09-30).
  const follow = useFollowedTeams(runId, uid() ?? undefined, teamsLoaded ? teams.map((tm) => tm.id) : null);
  // Volunteers read this, so it is a CLASSIFICATION, never the server's English
  // text (change: play-no-silent-failures). `sessionExpired` also unlocks the way
  // back to the PIN screen, which an expired token otherwise had no path to.
  const [readErr, setReadErr] = useState<StaffFailure | null>(null);
  // Issue #16: the identity can change AFTER the error arrived (switching a browser to a player signs
  // out first, so the listeners fail while nobody is signed in). Decide the wording when it is shown.
  const [playerHere, setPlayerHere] = useState(false);
  useEffect(() => onAuthStateChanged(auth, (u) => setPlayerHere(u?.isAnonymous === true)), []);
  // A score adjustment used to land with NO feedback at all: the buttons sat ~4px
  // apart with no confirm and no undo, so a mis-tapped -5 was indistinguishable
  // from nothing happening. Confirm AFTER the callable resolves (never before —
  // a volunteer awards points dozens of times a run and a modal per tap is
  // unusable), so a wrong one is visible and correctable with its opposite.
  const [adjustAck, setAdjustAck] = useState<Record<string, string>>({});
  // Team search (staff-console-field-ops). Purely local: the whole roster is already
  // in this snapshot and is bounded by Run.maxParticipants, so no query is needed.
  const [teamQuery, setTeamQuery] = useState('');
  // Issue 39, computer only: which tool the side panel shows, and which team's window is open.
  const [sideTab, setSideTab] = useState<StaffSection>('map');
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [openReviewKey, setOpenReviewKey] = useState<string | null>(null);
  const ackTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = ackTimers.current;
    return () => { for (const id of Object.values(timers)) clearTimeout(id); };
  }, []);

  // Live pending photo submissions + team scores across all teams in the run.
  // One snapshot feeds both the photo-review queue and the manual bonus panel.
  useEffect(() => {
    const ref = collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/teams`);
    return onSnapshot(ref, (snap) => {
      setReadErr(null); // a successful snapshot clears a stale error
      const rows: PendingSubmission[] = [];
      const teamRows: TeamRow[] = [];
      snap.forEach((doc) => {
        const td = doc.data() as {
          displayName?: string;
          score?: number;
          held?: boolean;
          heldReason?: string;
          outOfBounds?: boolean;
          activeTaskId?: string | null;
          stages?: { status?: string; tasks?: { taskId?: string; status?: string }[] }[];
          registrationData?: unknown;
          flashClaims?: TeamRow['flashClaims'];
          launched?: boolean;
          status?: string;
          removed?: boolean;
          taskSubmissions?: Record<string, { photoUrl?: string; submittedAt?: string; status?: string; mediaKind?: 'photo' | 'audio' | 'video'; submittedBy?: { uid?: unknown; name?: unknown } | null }>;
        };
        // Which missions force-assign may offer: the still-unassigned ones in the
        // team's ACTIVE stage. Derived here (not in the row component) because the
        // server refuses anything outside that stage anyway — offering more would
        // just be a menu of guaranteed rejections. Defensive at every hop: a team
        // mid-transition can have no active stage, and the console must still render.
        const activeStage = Array.isArray(td.stages)
          ? td.stages.find((s) => s?.status === 'active')
          : undefined;
        const assignableTaskIds = (activeStage?.tasks ?? [])
          .filter((t) => t?.status === 'unassigned' && typeof t?.taskId === 'string')
          .map((t) => t.taskId as string);
        teamRows.push({
          id: doc.id,
          displayName: td.displayName ?? doc.id,
          score: td.score ?? 0,
          held: td.held === true,
          heldReason: td.heldReason,
          outOfBounds: td.outOfBounds === true,
          activeTaskId: td.activeTaskId ?? null,
          assignableTaskIds,
          stages: td.stages,
          registrationData: td.registrationData,
          flashClaims: td.flashClaims ?? null,
          launched: td.launched === true,
          status: typeof td.status === 'string' ? td.status : undefined,
          removed: td.removed === true,
        });
        const subs = td.taskSubmissions ?? {};
        for (const [taskId, sub] of Object.entries(subs)) {
          if (sub?.status === 'pending') {
            rows.push({
              teamId: doc.id,
              displayName: td.displayName ?? doc.id,
              taskId,
              photoUrl: sub.photoUrl ?? '',
              submittedAt: sub.submittedAt ?? '',
              mediaKind: sub.mediaKind,
              senderName: submissionSenderName(td, sub),
            });
          }
        }
      });
      rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
      // A submission arriving is the one event a marshal is blocked on and cannot
      // see (change: live-ops-feedback-loop). The SOS listener below has cued since
      // it was written; this one never did. Same baseline discipline: `null` until
      // the first snapshot, so opening the console over a queue is silent and so is
      // a reconnect. `newPendingKeys` is total — its failure mode is silence, never
      // an exception inside the listener that also renders the queue.
      {
        const keys = rows.map(submissionKey);
        const verdict = newPendingKeys(seenPendingKeys.current, keys);
        seenPendingKeys.current = new Set(keys);
        if (verdict.shouldCue) feedback('alert');
      }
      // Stable order: score desc, then id — so tied teams don't flicker rows between
      // snapshots (which could make a busy +/- button appear on the wrong team).
      teamRows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      setPending(rows);
      setTeams(teamRows);
      setTeamsLoaded(true);
    }, (e) => setReadErr(classifyStaffError(e, staffIdentityHint())));
  }, [ownerUid, gameId, runId]);

  // Live unacknowledged SOS / alerts.
  // audio-haptic-feedback: play the urgent cue when a NEW alert arrives so staff
  // are notified without watching the screen. Ref-baseline the seen ids (null on
  // first snapshot) so a fresh mount / re-attach doesn't replay existing alerts.
  const seenAlertIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`),
      where('acknowledged', '==', false),
    );
    return onSnapshot(ref, (snap) => {
      setReadErr(null); // a successful snapshot clears a stale error
      const rows: Alert[] = snap.docs.map((d) => {
        const a = d.data() as Partial<Alert>;
        return {
          id: d.id,
          teamId: a.teamId ?? '',
          type: a.type ?? 'sos',
          message: a.message ?? '',
          lat: a.lat ?? null,
          lng: a.lng ?? null,
          createdAt: a.createdAt ?? '',
          callbackPhone: a.callbackPhone ?? '',
        };
      });
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const ids = new Set(rows.map((r) => r.id));
      if (seenAlertIds.current === null) {
        seenAlertIds.current = ids; // baseline: don't cue on first paint
      } else {
        const isNew = rows.some((r) => !seenAlertIds.current!.has(r.id));
        seenAlertIds.current = ids;
        if (isNew) feedback('alert');
      }
      setAlerts(rows);
    }, (e) => setReadErr(classifyStaffError(e, staffIdentityHint())));
  }, [ownerUid, gameId, runId]);

  // ── The review-wait alarm (change: review-wait-alarm) ─────────────────────────
  // Same rule as the organizer's console: a submission waiting 20 s raises a pinned banner and
  // repeats the urgent cue every 20 s until it is judged or muted. The 1 s clock runs only while
  // something is waiting; the verdict itself is pure (reviewWaitAlarm).
  const hasPendingReview = pending.length > 0;
  const [reviewNow, setReviewNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasPendingReview) return;
    const id = window.setInterval(() => setReviewNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasPendingReview]);
  const [alarmMutedUntil, setAlarmMutedUntil] = useState<number | null>(null);
  const reviewAlarm = reviewWaitAlarm(can('review') ? pending : [], reviewNow, { mutedUntilMs: alarmMutedUntil });
  const lastUrgentAt = useRef(0);
  useEffect(() => {
    if (reviewAlarm.level === 'none') { lastUrgentAt.current = 0; return; }
    if (!reviewAlarm.playSound) return;
    if (reviewNow - lastUrgentAt.current >= REVIEW_ALARM_MS) {
      lastUrgentAt.current = reviewNow;
      feedback('alert');
    }
  }, [reviewAlarm.level, reviewAlarm.playSound, reviewNow]);

  async function review(s: PendingSubmission, approved: boolean) {
    try {
      await reviewStationSubmission({ ...ctx, teamId: s.teamId, taskId: s.taskId, approved });
    } catch (e) {
      setReadErr(classifyStaffError(e, staffIdentityHint()));
    }
  }

  async function ack(a: Alert) {
    try {
      await acknowledgeAlert({ ...ctx, alertId: a.id });
    } catch (e) {
      setReadErr(classifyStaffError(e, staffIdentityHint()));
    }
  }

  // Manual bonus / deduction. Positive delta = bonus, negative = fine. The team
  // score updates live via the open snapshot; no manual refresh needed.
  //
  // `reason` (staff-console-field-ops) replaces the hardcoded 'staff' this used to
  // send: adjustTeamScore has always written the reason into auditLogs, so the trail
  // existed but said nothing. Still OPTIONAL — a marshal fixing a score mid-event
  // must never be blocked by an empty text box.
  async function adjust(team: TeamRow, delta: number, reason?: string) {
    try {
      await adjustTeamScore({ ...ctx, teamId: team.id, delta, reason: reason || undefined });
      const label = t.staff.adjustApplied({ delta: delta > 0 ? `+${delta}` : String(delta) });
      setAdjustAck((a) => ({ ...a, [team.id]: label }));
      clearTimeout(ackTimers.current[team.id]);
      ackTimers.current[team.id] = setTimeout(() => {
        setAdjustAck((a) => { const next = { ...a }; delete next[team.id]; return next; });
      }, 3000);
    } catch (e) {
      setReadErr(classifyStaffError(e, staffIdentityHint()));
    }
  }

  // Every non-scoring per-team action, behind ONE in-flight key per team
  // (staff-console-field-ops). Routed through a single function so a team row can
  // never have two field actions in flight at once — holding a team while
  // force-assigning it is exactly the kind of race a live event produces.
  type TeamOp =
    | { kind: 'hold'; held: boolean; reason?: string }
    | { kind: 'clearOob' }
    | { kind: 'skipTask' }
    | { kind: 'route'; taskId: string; title: string; accept: WaivableKind[]; when: 'now' | 'after' }
    | { kind: 'letIn'; taskId: string }
    | { kind: 'sendBack'; target: SendBackTarget; title: string; scope?: 'only' | 'fromHere' };

  async function runTeamOp(team: TeamRow, op: TeamOp) {
    try {
      if (op.kind === 'hold') {
        await setTeamHold({ ...ctx, teamId: team.id, held: op.held, reason: op.reason });
      } else if (op.kind === 'clearOob') {
        await clearTeamOutOfBounds({ ...ctx, teamId: team.id });
      } else if (op.kind === 'skipTask') {
        // skip-keeps-the-stage: say what THIS skip does (server dry run, nothing written), and fall
        // back to the plain question if the preview cannot be had.
        let lines: SkipPreviewLine[] | null = null;
        try { lines = skipPreviewLines(await skipTaskForTeam({ ...ctx, teamId: team.id, dryRun: true })); }
        catch (e) {
          // Between missions there is nothing to skip: say so instead of confirming a failure.
          if (/not on a mission right now/i.test(String((e as Error)?.message ?? ''))) {
            await dialog.alert(t.staff.skipNoMission);
            return;
          }
          lines = null;
        }
        const message = lines ? staffSkipPreviewText(lines, t) : t.staff.skipTaskConfirm;
        if (!(await dialog.confirm(message, { confirmLabel: t.staff.skipTask }))) return;
        await skipTaskForTeam({ ...ctx, teamId: team.id });
      } else if (op.kind === 'sendBack') {
        // send-team-back: the server's own preview, then the plain confirm, then the real call.
        let message = op.target.kind === 'task' ? t.staff.sendBackToTask({ title: op.title }) : t.staff.sendBackToStage({ stage: op.title });
        try {
          // The handoff's open gap (2026-10-06): the staff app offered only "this mission"; the console
          // also had "from this mission on". Same callable, same preview, same scope.
          const fromHere = op.target.kind === 'task' && op.scope === 'fromHere';
          const dry = await returnTeamTo({ ...ctx, teamId: team.id, target: op.target, dryRun: true, ...(fromHere ? { scope: 'fromHere' as const } : {}) });
          const lines = [message];
          const also = fromHere ? (dry.reopened ?? []).filter((r) => r.id !== (op.target.kind === 'task' ? op.target.taskId : '')).map((r) => r.title).filter(Boolean) : [];
          if (also.length > 0) lines.push(t.staff.sendBackReopens(also.join(', ')));
          if ((dry.pointsRemoved ?? 0) > 0) lines.push(t.staff.sendBackPoints({ n: dry.pointsRemoved }));
          if ((dry.relockedStages ?? []).length > 0) lines.push(t.staff.sendBackRelocks({ stages: dry.relockedStages.join(', ') }));
          message = lines.join(String.fromCharCode(10));
        } catch { /* keep the plain sentence */ }
        // The button names the action (the confirm-button-says-what-it-does rule), never a bare "OK".
        if (!(await dialog.confirm(message, { confirmLabel: t.staff.sendBack }))) return;
        await returnTeamTo({ ...ctx, teamId: team.id, target: op.target, reason: 'staff send back',
          ...(op.target.kind === 'task' && op.scope === 'fromHere' ? { scope: 'fromHere' as const } : {}) });
        setAdjustAck((a) => ({ ...a, [team.id]: t.staff.sendBackDone }));
      } else if (op.kind === 'letIn') {
        // located-mission-arrival: the team is at the door and GPS will not say so.
        await markTeamArrived({ ...ctx, teamId: team.id, taskId: op.taskId, reason: 'staff let in' });
        setAdjustAck((a) => ({ ...a, [team.id]: t.staff.letInDone }));
      } else {
        // route-team-to-mission: exactly the blockers the marshal confirmed; the server recomputes
        // them and refuses if the list changed in between.
        const res = await routeTeam({ ...ctx, teamId: team.id, taskId: op.taskId, accept: op.accept, when: op.when, reason: 'staff route' });
        setAdjustAck((a) => ({ ...a, [team.id]: res.queued ? t.staff.route.queued({ title: op.title }) : t.staff.route.sent({ title: op.title }) }));
      }
      // No optimistic local mutation anywhere above: the open snapshot is the single
      // source of truth for these flags, so the row re-renders from the server's
      // verdict rather than from what we hoped happened.
    } catch (e) {
      setReadErr(classifyStaffError(e, staffIdentityHint()));
    }
  }

  // In-flight guards (change: wave-b/async-action-guard). These replace the single
  // `busyKey` useState — which could not stop a second tap in the same React batch,
  // so a double-tapped +10 really did award 20, and a double-tapped approve fired
  // reviewStationSubmission twice. Keyed exactly like busyKey was, so a different
  // row can still act while this one is in flight.
  const reviewAction = useAsyncAction<[PendingSubmission, boolean], void>(review, (s) => `${s.teamId}:${s.taskId}`);
  const ackAction = useAsyncAction<[Alert], void>(ack, (a) => a.id);
  const adjustAction = useAsyncAction<[TeamRow, number, string?], void>(adjust, (team) => team.id);
  const opsAction = useAsyncAction<[TeamRow, TeamOp], void>(runTeamOp, (team) => team.id);

  const nameFor = (teamId: string) => teams.find((tm) => tm.id === teamId)?.displayName ?? teamId.slice(0, 8);
  // Filtered in one place so the empty-search and no-match states stay distinct:
  // "no teams yet" and "no team by that name" are different problems for a marshal.
  const visibleTeams = useMemo(() => filterTeamsByName(teams, teamQuery), [teams, teamQuery]);
  // followed-teams: my teams first; "mine only" shows just them.
  const listedTeams = sortFollowedFirst(follow.mineOnly ? visibleTeams.filter((tm) => follow.isFollowed(tm.id)) : visibleTeams, follow.list);

  async function approveFlash(teamId: string, flashId: string) {
    try {
      await reviewFlashMission({ ...ctx, flashId, teamId, action: 'approve' });
      setAdjustAck((a) => ({ ...a, [teamId]: t.flash.staffApproved }));
    } catch (e) { setReadErr(classifyStaffError(e, staffIdentityHint())); }
  }
  const followFlashAction = useAsyncAction<[string, string], void>(approveFlash, (teamId) => teamId);

  function toggleFollow(teamId: string) {
    if (follow.toggle(teamId) === 'full') void dialog.alert(t.staff.follow.full);
  }
  /** Bring a followed team's row into view (clearing a search that hides it). */
  function openFollowed(teamId: string) {
    setTeamQuery('');
    window.setTimeout(() => document.getElementById(`staff-team-${teamId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }
  const followedCards: StaffFollowedCard[] = follow.list.flatMap((id) => {
    const tm = teams.find((x) => x.id === id);
    if (!tm) return [];
    const f = t.staff.follow;
    const taskSubmissions = Object.fromEntries(pending.filter((p) => p.teamId === id)
      .map((p) => [p.taskId, { status: 'pending', submittedAt: p.submittedAt }]));
    const status = followedTeamStatus({
      team: { id, held: tm.held, outOfBounds: tm.outOfBounds, flashClaims: tm.flashClaims, taskSubmissions, launched: tm.launched, status: tm.status, removed: tm.removed },
      nowMs: reviewNow,
      sosTeamIds: alerts.filter((a) => !/bounds/i.test(a.type)).map((a) => a.teamId),
    });
    const act = followedTeamAction(status,
      { review: can('review'), route: can('route'), hold: can('hold'), safety: can('safety'), start: false },
      { sealedTaskId: can('route') ? staffLetInTarget(outline, tm) : null });
    let action: StaffFollowedCard['action'] = null;
    if (act?.kind === 'approve') {
      const item = act.item;
      const sub = item.kind === 'task' ? pending.find((p) => p.teamId === id && p.taskId === item.id) : undefined;
      if (sub) action = { label: f.action.approve, run: () => void reviewAction.run(sub, true), busy: reviewAction.isBusy(`${id}:${item.id}`) };
      else if (item.kind === 'flash') action = { label: f.action.approve, run: () => void followFlashAction.run(id, item.id), busy: followFlashAction.isBusy(id) };
    } else if (act?.kind === 'openAlert') {
      action = { label: f.action.openAlert, run: () => document.getElementById('staff-alerts')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) };
    } else if (act?.kind === 'resume') {
      action = { label: f.action.resume, run: () => void opsAction.run(tm, { kind: 'hold', held: false }), busy: opsAction.isBusy(id) };
    } else if (act?.kind === 'letIn') {
      const taskId = act.taskId;
      action = { label: f.action.letIn, run: () => void opsAction.run(tm, { kind: 'letIn', taskId }), busy: opsAction.isBusy(id) };
    }
    const fmt = (ms: number) => { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
    const line = status.kind === 'waitingReview' && status.waiting
      ? `${f.status.waitingReview} · ${fmt(status.waiting.ageMs)}`
      : status.kind === 'playing' && tm.activeTaskId ? titleOf(tm.activeTaskId) : f.status[status.kind];
    return [{ id, name: tm.displayName, status, line, action }];
  });

  // desktop-layouts-play-staff: every section once, placed by lib/staffLayout.ts. On a phone the
  // order the staff app always had; on a computer three columns. The quick bar is phone only.
  // One submission to approve or reject. The phone lists these inline; on a computer one opens in a
  // window from the short list (issue 39), so both use the SAME card and buttons.
  function reviewCardFor(s: PendingSubmission) {
                const key = `${s.teamId}:${s.taskId}`;
                const hasUrl = /^https?:\/\//.test(s.photoUrl);
                // audio-tasks: an audio submission plays inline. Render the <img> ONLY
                // when the submission is positively an image — a declared 'photo', or a
                // legacy row (no mediaKind) whose URL carries an image extension. A
                // missing/malformed mediaKind on an AUDIO doc then routes to <audio> (by
                // kind) or, failing that, to the 📎 fallback below — never a broken <img>.
                const isAudio = s.mediaKind === 'audio';
                const isVideo = s.mediaKind === 'video';
                const looksLikeImage = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)(\b|\?|%|$)/i.test(s.photoUrl);
                const isImage = s.mediaKind === 'photo' || (s.mediaKind === undefined && looksLikeImage);
                // The row carries its own age as colour (fresh / amber 20 s / red 60 s), kitchen-display style.
                const tone = reviewRowTone(reviewNow - Date.parse(s.submittedAt || ''));
                const toneClass = tone === 'red' ? 'border-2 border-danger' : tone === 'amber' ? 'border-2 border-amber-500' : '';
                return (
                  <Card key={key} className={`p-3 mb-2 ${toneClass}`}>
                    <div dir="auto" className="text-sm font-medium text-zinc-100">{s.displayName}</div>
                    {s.senderName && <div dir="auto" className="text-xs text-zinc-500">{t.staff.mediaSentBy({ name: s.senderName })}</div>}
                    <div className="text-xs text-zinc-500 mb-2">{t.staff.taskLabel} <span dir="auto">{titleOf(s.taskId)}</span></div>
                    {hasUrl && isAudio
                      ? <audio controls src={s.photoUrl} className="w-full mb-2" aria-label={t.staff.audioSubmission} />
                      : hasUrl && isVideo
                      ? <video controls src={s.photoUrl} className="w-full rounded-lg mb-2 max-h-64" aria-label={t.staff.videoSubmission} />
                      : hasUrl && isImage
                      ? <img src={s.photoUrl} alt={t.staff.submissionAlt} className="w-full rounded-lg mb-2 max-h-64 object-contain" />
                      : <div className="text-xs text-zinc-500 italic mb-2 break-all"><Icon name="paperclip" className="w-3.5 h-3.5 inline-block align-text-bottom" /> {s.photoUrl || t.staff.noPhoto}</div>}
                    <div className="flex gap-2">
                      <button
                        className="flex-1 min-h-[44px] py-2 rounded-lg bg-accent text-black font-semibold text-sm disabled:opacity-40"
                        disabled={reviewAction.isBusy(key)}
                        onClick={() => void reviewAction.run(s, true)}
                      >
                        {t.staff.approve}
                      </button>
                      <button
                        className="flex-1 min-h-[44px] py-2 rounded-lg bg-transparent border border-danger/50 text-danger font-semibold text-sm disabled:opacity-40"
                        disabled={reviewAction.isBusy(key)}
                        onClick={() => void reviewAction.run(s, false)}
                      >
                        {t.staff.reject}
                      </button>
                    </div>
                  </Card>
                );
  }
  // A code the organizer removed: said where the person will look first, on both layouts.
  const removedCard = access.removed ? (
            <Card className="p-4 mb-4 border border-danger/40" data-testid="staff-removed">
              <p className="text-sm text-danger font-semibold">{t.staff.removedTitle}</p>
              <p className="text-xs text-zinc-400 mt-1">{t.staff.removedBody}</p>
              <button className="mt-3 min-h-[44px] px-4 rounded-lg bg-app-raised border border-glass-border text-sm font-semibold text-zinc-200" onClick={onSignOut}>
                {t.staff.removedExit}
              </button>
            </Card>
  ) : null;
  const sectionEls: Record<StaffSection, ReactNode> = {
    quickBar: (
      <>
          {/* ── Quick bar: a phone's jump list to the sections below (not shown on a computer) ── */}
          <StaffQuickBar runId={runId} can={(c) => can(c as never)}
            badges={staffQuickBadges({
              alerts: can('safety') ? alerts.length : 0,
              pendingReviews: can('review') ? pending.length : 0,
              overdueReviews: reviewAlarm.overCount,
            })} />
      </>
    ),
    followed: (
      <>
          <StaffFollowedStrip cards={followedCards} mineOnly={follow.mineOnly} onMineOnly={follow.setMineOnly} onOpen={openFollowed} />
      </>
    ),
    contacts: (
      <>
          {contacts.length > 0 && (
            <section className="mb-6" data-testid="staff-contacts" aria-label={t.staff.contactsTitle}>
              <h2 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1.5"><Icon name="phone" className="w-4 h-4 shrink-0" />{t.staff.contactsTitle}</h2>
              <div className="space-y-1.5">
                {contacts.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2">
                    <span dir="auto" className="text-sm text-zinc-200 flex-1 min-w-0 truncate">{c.label}</span>
                    <a href={toTelHref(c.phone) ?? undefined} className={`${TAP_TARGET} inline-flex items-center gap-1 px-2 rounded-lg border border-glass-border text-sm font-semibold text-ink-fire`}>
                      <Icon name="phone" className="w-4 h-4" /> <span dir="ltr">{c.phone}</span>
                    </a>
                    <a href={toWhatsAppHref(c.phone) ?? undefined} target="_blank" rel="noreferrer" aria-label={t.staff.whatsappContact({ label: c.label })}
                      className={`${TAP_TARGET} inline-flex items-center justify-center rounded-lg border border-glass-border text-sm text-ink-fire`}><Icon name="chat" className="w-5 h-5" /></a>
                  </div>
                ))}
              </div>
            </section>
          )}
      </>
    ),
    alerts: (
      <>
          {can('safety') && <section className="mb-6 scroll-mt-4" id="staff-alerts">
            <h2 className="text-sm font-semibold text-zinc-300 mb-2">
              <Icon name="sos" className="w-4 h-4 inline-block align-text-bottom" /> {t.staff.alerts} {alerts.length > 0 && <span className="text-danger">({alerts.length})</span>}
            </h2>
            {alerts.length === 0
              ? <p className="text-zinc-500 text-sm">{t.staff.noAlerts}</p>
              : alerts.map((a) => (
                <Card key={a.id} className="p-3 mb-2 border-danger/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-100">{(t.staff.alertType as Record<string, string>)[a.type] ?? a.type}</div>
                      <div className="text-xs text-zinc-500 truncate">{t.staff.teamLabel} {nameFor(a.teamId)}</div>
                      {a.message && <div dir="auto" className="text-sm text-zinc-300 mt-1">{a.message}</div>}
                      {/* sos-callback-and-authorities: the number the team left to call back. */}
                      {a.callbackPhone && toTelHref(a.callbackPhone) && (
                        <a href={toTelHref(a.callbackPhone)!} data-testid="sos-callback"
                          className="mt-1 inline-flex items-center gap-1 min-h-[44px] rounded-lg bg-ink-alert px-3 text-sm font-bold text-white">
                          <Icon name="phone" className="w-4 h-4" /> {t.staff.sosCallback({ phone: a.callbackPhone })}
                        </a>
                      )}
                      {/* Issue 25 (Ahiya, 2026-10-06): write to the team straight from its SOS. */}
                      {can('chat') && (
                        <button type="button" data-testid="sos-chat"
                          // On a computer the chat is a side tab: open it too, or nothing visible happens.
                          onClick={() => { setChatFocus({ teamId: a.teamId, nonce: Date.now() }); setSideTab('chat'); }}
                          className="mt-1 ms-2 inline-flex items-center gap-1 min-h-[44px] rounded-lg border border-danger px-3 text-sm font-bold text-ink-alert">
                          <Icon name="chat" className="w-4 h-4" /> {t.staff.sosChat}
                        </button>
                      )}
                      {a.lat != null && a.lng != null && (
                        <a
                          className="inline-flex items-center min-h-[44px] px-2 -ms-2 text-ink-fire text-xs underline"
                          href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}&travelmode=walking`}
                          target="_blank" rel="noreferrer"
                        >
                          {t.staff.openLocation}
                        </a>
                      )}
                    </div>
                    <button
                      className="shrink-0 inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg bg-app-raised text-zinc-100 text-sm border border-glass-border disabled:opacity-40"
                      disabled={ackAction.isBusy(a.id)}
                      onClick={() => void ackAction.run(a)}
                    >
                      {t.staff.ack}
                    </button>
                  </div>
                </Card>
              ))}
          </section>}

          {!wide && removedCard}
      </>
    ),
    review: (
      <>
          {/* ── Photo review ── */}
          {can('review') && <section className="mb-6 flex-1 scroll-mt-4" id="staff-review">
            <h2 className="text-sm font-semibold text-zinc-300 mb-2">
              <Icon name="camera" className="w-4 h-4 inline-block align-text-bottom" /> {t.staff.photoReview} {pending.length > 0 && <span className="text-ink-fire">({pending.length})</span>}
            </h2>
            {reviewAlarm.level === 'alarm' && reviewAlarm.oldest && (
              <div role="alert" data-testid="staff-review-alarm"
                className="sticky top-2 z-20 mb-2 rounded-xl bg-ink-alert text-white p-3 shadow-lg motion-safe:animate-pulse">
                <p className="text-sm font-bold">
                  {t.staff.reviewAlarm({ n: reviewAlarm.overCount, seconds: Math.floor(reviewAlarm.oldest.waitedMs / 1000) })}
                </p>
                <button type="button"
                  className="mt-2 min-h-[44px] px-3 rounded-lg bg-white/20 text-sm font-semibold disabled:opacity-60"
                  disabled={!reviewAlarm.playSound}
                  onClick={() => setAlarmMutedUntil(Date.now() + 5 * 60_000)}>
                  {reviewAlarm.playSound ? t.staff.reviewAlarmMute : t.staff.reviewAlarmMuted}
                </button>
              </div>
            )}
            {pending.length === 0
              ? <p className="text-zinc-500 text-sm">{t.staff.noSubmissions}</p>
              : wide ? (
                // Issue 39, computer: a short list; the photo and the verdict open in a window.
                <ul className="space-y-1.5" data-testid="staff-review-list">
                  {pending.map((s) => {
                    const key = `${s.teamId}:${s.taskId}`;
                    const tone = reviewRowTone(reviewNow - Date.parse(s.submittedAt || ''));
                    return (
                      <li key={key}>
                        <button type="button" onClick={() => setOpenReviewKey(key)} data-testid="staff-review-row"
                          className={`w-full rounded-xl border bg-app-card px-3 py-2 text-start hover:bg-app-raised ${tone === 'red' ? 'border-2 border-danger' : tone === 'amber' ? 'border-2 border-amber-500' : 'border-glass-border'}`}>
                          <span dir="auto" className="block truncate text-sm font-semibold text-zinc-100">{s.displayName}</span>
                          <span dir="auto" className="block truncate text-xs text-zinc-500">{titleOf(s.taskId)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : pending.map((s) => reviewCardFor(s))}
          </section>}
      </>
    ),
    teams: (
      <>
          {/* ── Teams: scores + every per-team field action ──────────────────────
              One row per team carrying everything a marshal can do to that team, so
              they never have to find a laptop mid-event (change: staff-console-field-ops).
              The search box exists because this list is a flat scroll — at 20+ teams,
              finding one by thumb is the slowest part of the job. */}
          <section className="mb-6 scroll-mt-4" id="staff-teams">
            <h2 className="text-sm font-semibold text-zinc-300 mb-2">
              <Icon name="scale" className="w-4 h-4 inline-block align-text-bottom" /> {t.staff.teamsScores} {teams.length > 0 && <span className="text-zinc-500">({teams.length})</span>}
            </h2>
            {teams.length > 0 && (
              <Input
                value={teamQuery}
                onChange={(e) => setTeamQuery(e.target.value)}
                placeholder={t.staff.searchTeams}
                dir="auto"
                className="mb-2"
                aria-label={t.staff.searchTeams}
              />
            )}
            {teams.length === 0
              ? <p className="text-zinc-500 text-sm">{t.staff.noTeams}</p>
              : visibleTeams.length === 0
              ? <p className="text-zinc-500 text-sm">{t.staff.noTeamsMatch}</p>
              : wide ? (
                // Issue 39: on a computer a team is a small tile and its actions open in a window, so
                // the list stays one screen instead of a long scroll of tall cards.
                <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-2" data-testid="staff-team-grid">
                  {listedTeams.map((tm) => {
                    const state = tm.status === 'finished' ? { text: t.staff.follow.status.finished, cls: 'bg-app-raised text-zinc-300' }
                      : tm.held ? { text: t.staff.heldBadge, cls: 'bg-accent text-black' }
                      : tm.outOfBounds ? { text: t.staff.outOfBoundsBadge, cls: 'bg-danger/15 text-danger' }
                      : !tm.launched ? { text: t.staff.desk.notStarted, cls: 'bg-app-raised text-zinc-500' } : null;
                    // Only once the outline (mission names) has loaded: never a raw mission id on a tile.
                    const mission = tm.activeTaskId && outline ? titleOf(tm.activeTaskId) : '';
                    return (
                      <div key={tm.id} id={`staff-team-${tm.id}`}
                        className={`group relative rounded-xl border bg-app-card transition-colors hover:border-accent/60 hover:bg-app-raised ${tm.held ? 'border-accent/60' : tm.outOfBounds ? 'border-danger/50' : 'border-glass-border'}`}>
                        <button type="button" onClick={() => setOpenTeamId(tm.id)} aria-label={t.staff.desk.openTeam(tm.displayName)}
                          data-testid="staff-team-tile" className="block w-full rounded-xl px-3 py-2 pe-10 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                          <div className="flex items-baseline justify-between gap-2">
                            <span dir="auto" className="truncate text-sm font-semibold text-zinc-100">{tm.displayName}</span>
                            <span className="shrink-0 font-mono text-sm font-bold text-ink-fire">{tm.score}</span>
                          </div>
                          <div className="mt-1 flex min-h-[22px] items-center gap-1.5 text-[12px] text-zinc-500">
                            {state && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.cls}`}>{state.text}</span>}
                            {mission && <span dir="auto" className="truncate">{t.staff.desk.onMission}: {mission}</span>}
                          </div>
                          {adjustAck[tm.id] && <div role="status" className="mt-0.5 truncate text-[11px] font-semibold text-ink-fire">✓ {adjustAck[tm.id]}</div>}
                        </button>
                        <button type="button" onClick={() => toggleFollow(tm.id)} aria-pressed={follow.isFollowed(tm.id)}
                          aria-label={follow.isFollowed(tm.id) ? t.staff.follow.unfollowAria({ team: tm.displayName }) : t.staff.follow.followAria({ team: tm.displayName })}
                          className={`absolute top-1.5 end-1 inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-app-raised ${follow.isFollowed(tm.id) ? 'text-indigo-600' : 'text-zinc-500'}`}>
                          <Icon name="star" className={follow.isFollowed(tm.id) ? 'w-5 h-5 fill-current' : 'w-5 h-5'} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : listedTeams.map((tm) => (
                <div key={tm.id} id={`staff-team-${tm.id}`} className="scroll-mt-4">
                {opsCardFor(tm)}
                </div>
              ))}
          </section>
      </>
    ),
    flash: (
      <>
          {/* ── Flash missions: approve what teams sent, end one early (overnight 2026-09-29) ── */}
          {(can('review') || can('broadcast')) && (
            <StaffFlashSection ctx={ctx} teams={teams} canReview={can('review')} canEnd={can('broadcast')} />
          )}
      </>
    ),
    map: (
      <>
          {/* ── Live map of every team's last known position ── */}
          {can('locations') && <StaffTeamMapSection ctx={ctx} teams={teams} spots={missionSpots(outline)} followed={follow.list} mineOnly={follow.mineOnly} openByDefault={wide} />}
      </>
    ),
    staffChannel: (
      <>
          {/* ── Staff ↔ admin channel ── */}
          {can('staffChannel') && <StaffAdminChannelSection ctx={ctx} senderName={staff.name} />}
      </>
    ),
    chat: (
      <>
          {/* ── Team ↔ HQ chat threads ── */}
          {can('chat') && <StaffChatSection ctx={ctx} teams={teams} senderName={staff.name} focus={chatFocus} followed={follow.list} />}
      </>
    ),
    feed: (
      <>
          {/* ── Live photo feed moderation ── */}
          {can('feed') && <StaffFeedSection ctx={ctx} />}
      </>
    ),
    broadcast: (
      <>
          {/* ── Announcement composer ── */}
          {can('broadcast') && <AnnouncementComposer ctx={ctx} teams={teams} />}
      </>
    ),
  };
  // One team's full action card. The phone list shows it inline; on a computer it opens in a
  // window from the team's tile (issue 39), so both render the SAME controls.
  function opsCardFor(tm: TeamRow, inWindow = false) {
    return (
      <TeamOpsCard
        startOpen={inWindow}
        team={tm}
        followed={follow.isFollowed(tm.id)}
        onToggleFollow={() => toggleFollow(tm.id)}
        ack={adjustAck[tm.id]}
        busy={adjustAction.isBusy(tm.id) || opsAction.isBusy(tm.id)}
        can={{ score: can('score'), hold: can('hold'), route: can('route') }}
        callTargets={can('contactTeams') ? teamCallTargets(tm.registrationData, outline?.phoneFields) : []}
        onAdjust={(delta, reason) => void adjustAction.run(tm, delta, reason)}
        onHold={(held, reason) => void opsAction.run(tm, { kind: 'hold', held, reason })}
        onClearOob={() => void opsAction.run(tm, { kind: 'clearOob' })}
        onSkipTask={() => void opsAction.run(tm, { kind: 'skipTask' })}
        ctx={ctx}
        letInTaskId={can('route') ? staffLetInTarget(outline, tm) : null}
        onLetIn={(taskId) => void opsAction.run(tm, { kind: 'letIn', taskId })}
        onRoute={(taskId, title, accept, when) =>
          void opsAction.run(tm, { kind: 'route', taskId, title, accept, when })}
        onSendBack={(target, title, scope) => void opsAction.run(tm, { kind: 'sendBack', target, title, scope })}
        titleOf={titleOf}
        outlineStages={outline?.stages ?? []}
      />
    );
  }
  const desk = staffDesktopLayout();
  const counts = staffDeskCounts(teams, alerts.length, pending.length);
  const sideTabs = desk.sideTabs.filter((sec) => (
    sec === 'map' ? can('locations') : sec === 'chat' ? can('chat') : sec === 'staffChannel' ? can('staffChannel')
      : sec === 'feed' ? can('feed') : sec === 'broadcast' ? can('broadcast') : false));
  const activeSide: StaffSection | null = sideTabs.includes(sideTab) ? sideTab : (sideTabs[0] ?? null);
  const tabLabel: Partial<Record<StaffSection, string>> = {
    map: t.staff.desk.tabMap, chat: t.staff.desk.tabChat, staffChannel: t.staff.desk.tabChannel,
    feed: t.staff.desk.tabFeed, broadcast: t.staff.desk.tabBroadcast,
  };
  const quiet = alerts.length === 0 && pending.length === 0;
  const openTeam = openTeamId ? teams.find((tm) => tm.id === openTeamId) ?? null : null;
  const openReview = openReviewKey ? pending.find((x) => `${x.teamId}:${x.taskId}` === openReviewKey) ?? null : null;
  const signOut = () => { void dialog.confirm(t.staff.signOutConfirm, { confirmLabel: t.staff.signOut, danger: true }).then((ok) => { if (ok) onSignOut(); }); };
  const errLine = readErr && (
    <div role="status" aria-live="polite" className="mb-3">
      <p className="text-danger text-xs">{t.staff[readErr.sessionExpired && playerHere ? 'signedInAsPlayer' : readErr.key]}</p>
      {readErr.sessionExpired && (
        <button className="inline-flex items-center justify-center min-h-[44px] px-2 -ms-2 text-xs font-semibold text-ink-fire underline" onClick={onSignOut}>
          {t.staff.backToSignIn}
        </button>
      )}
    </div>
  );

  // ── Computer (issue 39): ONE screen that never scrolls as a page (Ahiya: "שלא יהיה גלילה
  // בממשקים במחשב" / "תעשה שיפתחו חלונות"). A fixed top bar with the live counts; three panels that
  // share the height: what needs you, the teams as tiles, and one tool at a time on the side. A
  // team's actions open in a window. A panel scrolls inside itself only if its content truly
  // outgrows the screen; the page never does.
  if (wide) {
    return (
      <div className="h-[100dvh] overflow-hidden flex flex-col">
        <header className="shrink-0 border-b border-glass-border bg-app-card/95 backdrop-blur" data-testid="staff-topbar">
          <div className="mx-auto flex w-full max-w-[1680px] items-center gap-4 px-5 py-2.5">
            <div className="min-w-0">
              <h1 className="font-brand text-lg font-extrabold leading-tight text-ink-fire">{t.staff.title}</h1>
              <p className="truncate text-xs text-zinc-500">{staff.name}</p>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-center gap-1.5 text-[13px]" aria-live="polite">
              <span className="rounded-full bg-app-raised px-3 py-1 font-semibold text-zinc-200">{t.staff.desk.teams(counts.teams)}</span>
              {counts.playing > 0 && <span className="rounded-full bg-accent/15 px-3 py-1 font-semibold text-ink-fire">{t.staff.desk.playing(counts.playing)}</span>}
              {counts.held > 0 && <span className="rounded-full bg-accent px-3 py-1 font-semibold text-black">{t.staff.desk.held(counts.held)}</span>}
              {counts.waiting > 0 && <span className="rounded-full bg-app-raised px-3 py-1 text-zinc-400">{t.staff.desk.waiting(counts.waiting)}</span>}
              {counts.finished > 0 && <span className="rounded-full bg-app-raised px-3 py-1 text-zinc-400">{t.staff.desk.finished(counts.finished)}</span>}
              {counts.sos > 0 && <span className="rounded-full bg-ink-alert px-3 py-1 font-bold text-white motion-safe:animate-pulse">{t.staff.desk.sos(counts.sos)}</span>}
              {counts.photos > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">{t.staff.desk.photos(counts.photos)}</span>}
            </div>
            <button className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm text-zinc-500 hover:bg-app-raised hover:text-zinc-200" onClick={signOut}>
              {t.staff.signOut}
            </button>
          </div>
        </header>

        <div className="mx-auto grid min-h-0 w-full max-w-[1680px] flex-1 grid-cols-[minmax(260px,310px)_minmax(0,1fr)_minmax(320px,390px)] gap-4 px-5 py-4" data-testid="staff-columns">
          {/* What needs a person now. Quiet ⇒ one line, not three empty headings. */}
          <aside className="min-h-0 overflow-y-auto overscroll-contain rounded-2xl border border-glass-border bg-app-card/70 p-3" aria-label={t.staff.desk.needsYou}>
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-zinc-500">{t.staff.desk.needsYou}</h2>
            {errLine}
            {removedCard}
            {quiet
              ? <p className="mb-4 rounded-xl bg-app-raised px-3 py-3 text-sm text-zinc-400" data-testid="staff-all-quiet">{t.staff.desk.allQuiet}</p>
              : <>{alerts.length > 0 && sectionEls.alerts}{pending.length > 0 && sectionEls.review}</>}
            {desk.needsYou.filter((sec) => sec !== 'alerts' && sec !== 'review').map((sec) => <Fragment key={sec}>{sectionEls[sec]}</Fragment>)}
          </aside>

          {/* The teams: the list a marshal works from. */}
          <main className="min-h-0 overflow-y-auto overscroll-contain rounded-2xl border border-glass-border bg-app-card/70 p-3">
            {desk.main.map((sec) => <Fragment key={sec}>{sectionEls[sec]}</Fragment>)}
          </main>

          {/* One tool at a time, tabbed, instead of five collapsed boxes stacked up. */}
          <aside className="flex min-h-0 flex-col rounded-2xl border border-glass-border bg-app-card/70">
            {desk.sideTop.map((sec) => <div key={sec} className="shrink-0 border-b border-glass-border px-3 pt-3 [&_section]:mb-3">{sectionEls[sec]}</div>)}
            {activeSide && (
              <>
                <div role="tablist" aria-label={t.staff.desk.toolsLabel} data-testid="staff-side-tabs" className="flex shrink-0 flex-wrap gap-1 border-b border-glass-border p-2">
                  {sideTabs.map((sec) => (
                    <button key={sec} type="button" role="tab" aria-selected={activeSide === sec} onClick={() => setSideTab(sec)}
                      className={`min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ${activeSide === sec ? 'bg-accent/15 text-ink-fire' : 'text-zinc-500 hover:bg-app-raised hover:text-zinc-200'}`}>
                      {tabLabel[sec]}
                    </button>
                  ))}
                </div>
                {/* Every tool stays MOUNTED and only the chosen one shows: remounting on each switch
                    re-opened the chat listener (a Firestore read per thread, every time) and rebuilt
                    the map from nothing. */}
                <CollapsibleEmbedded.Provider value>
                  {sideTabs.map((sec) => (
                    <div key={sec} role="tabpanel" hidden={activeSide !== sec}
                      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [&_section]:mb-0">
                      {sectionEls[sec]}
                    </div>
                  ))}
                </CollapsibleEmbedded.Provider>
              </>
            )}
          </aside>
        </div>

        {/* A photo to check, in a window; it closes itself once the verdict is in (the row leaves). */}
        {openReview && (
          <StaffWindow title={t.staff.photoReview} onClose={() => setOpenReviewKey(null)}>
            {reviewCardFor(openReview)}
          </StaffWindow>
        )}
        {/* A team's actions, in a window over the board. */}
        {openTeam && (
          <StaffWindow title={openTeam.displayName} onClose={() => setOpenTeamId(null)}>
            {opsCardFor(openTeam, true)}
            {can('chat') && (
              <button type="button" data-testid="staff-window-chat"
                onClick={() => { setChatFocus({ teamId: openTeam.id, nonce: Date.now() }); setSideTab('chat'); setOpenTeamId(null); }}
                className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-glass-border px-4 text-sm font-semibold text-ink-fire hover:bg-app-raised">
                <Icon name="chat" className="w-4 h-4" /> {t.staff.sosChat}
              </button>
            )}
          </StaffWindow>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-md mx-auto w-full px-5 pb-6 rp-safe-t flex flex-col">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-brand text-xl font-extrabold text-ink-fire">{t.staff.title}</h1>
          <p className="text-zinc-500 text-xs">{staff.name}</p>
        </div>
        <button
          className="inline-flex items-center min-h-[44px] px-3 py-2 -me-3 rounded-lg text-zinc-500 text-sm"
          onClick={() => { void dialog.confirm(t.staff.signOutConfirm, { confirmLabel: t.staff.signOut, danger: true }).then((ok) => { if (ok) onSignOut(); }); }}
        >{t.staff.signOut}</button>
      </header>

      {readErr && (
        <div role="status" aria-live="polite" className="mb-3">
          <p className="text-danger text-xs">{t.staff[readErr.sessionExpired && playerHere ? 'signedInAsPlayer' : readErr.key]}</p>
          {readErr.sessionExpired && (
            <button className="inline-flex items-center justify-center min-h-[44px] px-2 -ms-2 text-xs font-semibold text-ink-fire underline" onClick={onSignOut}>
              {t.staff.backToSignIn}
            </button>
          )}
        </div>
      )}

      {STAFF_PHONE_ORDER.map((s) => <Fragment key={s}>{sectionEls[s]}</Fragment>)}
    </div>
  );
}

// ─── One team's row: score + every field action (staff-console-field-ops) ─────
//
// Extracted from StaffDashboard's inline map because it owns real local state (the
// custom-amount draft, the reason picker, which sub-panel is open) and inlining
// that would re-create it for every team on every snapshot — mid-typing, at an
// event, on a phone.
//
// Layout rule throughout: the row shows the SAFE, frequent actions (±5/±10) at
// rest, and everything that is rarer or harder to undo (custom amount, hold,
// force-assign, skip) only after a deliberate tap on "more". A marshal awards
// points dozens of times a run and holds a team maybe twice.
function TeamOpsCard({
  team, ack, busy, can, onAdjust, onHold, onClearOob, onSkipTask, onRoute, onSendBack, titleOf, outlineStages, callTargets = [], ctx, letInTaskId = null, onLetIn,
  followed = false, onToggleFollow, startOpen = false,
}: {
  team: TeamRow;
  /** followed-teams: is this one of my teams, and the star that changes it. */
  followed?: boolean;
  onToggleFollow?: () => void;
  /** In the computer's team window the actions are the point of opening it: shown at once. */
  startOpen?: boolean;
  ack?: string;
  busy: boolean;
  /** What this staff member's code allows (staff-capabilities). A control that is not allowed is
   *  not rendered at all: a disabled button explains nothing. */
  can: { score: boolean; hold: boolean; route: boolean };
  onAdjust: (delta: number, reason?: string) => void;
  onHold: (held: boolean, reason?: string) => void;
  onClearOob: () => void;
  onSkipTask: () => void;
  onRoute: (taskId: string, title: string, accept: WaivableKind[], when: 'now' | 'after') => void;
  ctx: StaffCtx;
  /** located-mission-arrival: the mission this team may be let into without GPS, or null. */
  letInTaskId?: string | null;
  onLetIn?: (taskId: string) => void;
  // send-team-back
  onSendBack: (target: SendBackTarget, title: string, scope?: 'only' | 'fromHere') => void;
  titleOf: (taskId: string) => string;
  outlineStages: { id: string; title: string; tasks: { id: string; title: string }[] }[];
  /** Numbers to call this team on; empty when the code lacks contactTeams or the team gave none. */
  callTargets?: { label: string; phone: string }[];
}) {
  const { t } = useT();
  const [openPanel, setOpenPanel] = useState<null | 'amount' | 'assign' | 'hold' | 'sendBack'>(null);
  // A mission picked to send the team back to, waiting for "only it" or "from it on".
  const [backPick, setBackPick] = useState<{ taskId: string; title: string } | null>(null);
  const backTargets = sendBackTargets(team.stages as never, outlineStages);
  const [amountDraft, setAmountDraft] = useState('');
  const [reasonId, setReasonId] = useState<ScoreReasonId | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [holdReason, setHoldReason] = useState('');

  // What can still WORK on this team, on top of what this code may do (a finished
  // team is not held or routed). lib/staffTeamActions.ts.
  const acts = staffTeamActions(team, can);
  // change: staff-team-card-actions. Score steps, a custom amount and routing wait behind one
  // "פעולות" button; hold and the state-driven safety actions stay on the card. A panel that
  // is open keeps them shown, so nothing half-typed can disappear.
  const [actionsOpen, setActionsOpen] = useState(startOpen);
  const showMore = actionsOpen || openPanel !== null;
  const parsedAmount = parseAdjustAmount(amountDraft);
  // The reason vocabulary follows the SIGN of the amount being entered, so a
  // marshal typing -20 is never offered "creativity bonus".
  const presets = reasonsForDelta(parsedAmount ?? 1);

  function closeAmount() {
    setOpenPanel(null);
    setAmountDraft('');
    setReasonId(null);
    setReasonText('');
  }

  function submitAmount() {
    if (parsedAmount === null) return;
    onAdjust(parsedAmount, resolveReason(reasonId, reasonText));
    closeAmount();
  }

  // The preset ids ARE i18n keys (see shared/scoreReasons — an id is language-neutral
  // for the audit log, the label is localized for the marshal). Resolved through an
  // unknown cast because t.staff also holds function-valued entries.
  const label = (id: ScoreReasonId) =>
    (t.staff as unknown as Record<string, string>)[id] ?? id;

  return (
    <Card className={`p-3 mb-2 ${team.held ? 'border-accent/50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        {onToggleFollow && (
          <button type="button" onClick={onToggleFollow} aria-pressed={followed} data-testid="staff-follow-star"
            aria-label={followed ? t.staff.follow.unfollowAria({ team: team.displayName }) : t.staff.follow.followAria({ team: team.displayName })}
            className={`${TAP_TARGET} -ms-2 shrink-0 inline-flex items-center justify-center text-2xl ${followed ? 'text-indigo-600' : 'text-zinc-500'}`}>
            <Icon name="star" className={followed ? 'w-6 h-6 fill-current' : 'w-6 h-6'} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div dir="auto" className="text-sm font-medium text-zinc-100 truncate">{team.displayName}</div>
          <div className="text-xs text-zinc-500">{t.staff.scoreLabel} {team.score}</div>
          {/* State badges. Both mean "someone must act", so they sit next to the
              name rather than inside the collapsed actions. */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {team.held && (
              <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[13px] font-semibold text-black">
                <Icon name="pause" className="w-3.5 h-3.5 inline-block align-text-bottom" /> {t.staff.heldBadge}
              </span>
            )}
            {team.outOfBounds && (
              <span className="inline-flex items-center rounded-full bg-danger/20 border border-danger/50 px-2 py-0.5 text-[13px] font-semibold text-danger">
                {t.staff.outOfBoundsBadge}
              </span>
            )}
            {/* Says why a finished team offers fewer actions (lib/staffTeamActions.ts). */}
            {team.status === 'finished' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-app-raised border border-glass-border px-2 py-0.5 text-[13px] font-semibold text-zinc-300" data-testid="staff-finished-badge">
                <Icon name="flag" className="w-3.5 h-3.5" /> {t.staff.follow.status.finished}
              </span>
            )}
          </div>
          {team.held && team.heldReason && (
            <div dir="auto" className="text-xs text-zinc-500 mt-0.5">{team.heldReason}</div>
          )}
          {/* quick-dial-and-actions 2.5: call the team, only with the contactTeams capability and
              only on a number the game's registration asked for. */}
          {callTargets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-1.5" data-testid="staff-team-call">
              {callTargets.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <a href={toTelHref(c.phone) ?? undefined} className={`${TAP_TARGET} inline-flex items-center gap-1 px-1 text-xs font-semibold text-ink-fire`}
                    aria-label={t.staff.callTeam({ label: c.label })}><Icon name="phone" className="w-3.5 h-3.5" /> <span dir="ltr">{c.phone}</span></a>
                  <a href={toWhatsAppHref(c.phone) ?? undefined} target="_blank" rel="noreferrer"
                    className={`${TAP_TARGET} inline-flex items-center justify-center text-xs font-semibold text-ink-fire`}
                    aria-label={t.staff.whatsappTeam({ label: c.label })}><Icon name="chat" className="w-4 h-4" /></a>
                </span>
              ))}
            </div>
          )}
          {ack && (
            <div role="status" aria-live="polite" className="text-xs font-semibold text-ink-fire">
              ✓ {ack}
            </div>
          )}
        </div>
        {/* Two groups with a wide separator: -5 and +5 used to sit ~4px
            apart, so the deduct and the award were one thumb-width from
            each other on a control with no undo. */}
        {showMore && acts.score && <div className="flex items-center gap-4 shrink-0">
          {[[-10, -5], [5, 10]].map((group) => (
            <div key={group[0]} className="flex items-center gap-2">
              {group.map((d) => (
                <button
                  key={d}
                  className={`w-11 h-11 rounded-lg text-sm font-bold border disabled:opacity-40 ${
                    d > 0 ? 'bg-accent/15 text-ink-fire border-accent/30' : 'bg-app-raised text-zinc-200 border-glass-border'
                  }`}
                  disabled={busy}
                  aria-label={`${d > 0 ? t.staff.bonus : t.staff.deduct} ${Math.abs(d)}`}
                  onClick={() => onAdjust(d)}
                >{d > 0 ? `+${d}` : d}</button>
              ))}
            </div>
          ))}
        </div>}
      </div>

      {/* ── Secondary actions ── */}
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        {showMore && acts.score && <button
          className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-glass-border text-zinc-200 disabled:opacity-40"
          disabled={busy}
          onClick={() => setOpenPanel((p) => (p === 'amount' ? null : 'amount'))}
        >
          {t.staff.customAmount}
        </button>}
        {/* Hold is the one action that changes whether the team can play at all,
            so it is styled as the standout and never hidden behind another tap. */}
        {acts.hold && <button
          className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold border disabled:opacity-40 ${
            team.held
              ? 'bg-accent text-black border-accent'
              : 'bg-app-raised text-zinc-200 border-glass-border'
          }`}
          disabled={busy}
          onClick={() => {
            // Releasing is immediate — a marshal standing with a team that is ready
            // to go must not be made to fill anything in.
            if (team.held) { onHold(false); return; }
            // Holding opens an inline reason panel (not a modal, not window.prompt:
            // same reasoning as the custom-amount control — a phone keyboard reflows
            // the page and a viewport-anchored modal jumps away from its own row).
            setOpenPanel((p) => (p === 'hold' ? null : 'hold'));
          }}
        >
          {team.held ? t.staff.resumeTeam : t.staff.holdTeam}
        </button>}
        {team.outOfBounds && (
          <button
            className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-danger/50 text-danger disabled:opacity-40"
            disabled={busy}
            onClick={onClearOob}
          >
            {t.staff.clearOutOfBounds}
          </button>
        )}
        {letInTaskId && onLetIn && (
          <button
            className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-accent text-black disabled:opacity-40"
            disabled={busy}
            onClick={() => onLetIn(letInTaskId)}
            data-testid="staff-let-in"
          >
            {t.staff.letIn({ title: titleOf(letInTaskId) })}
          </button>
        )}
        {showMore && acts.assign && (
          <button
            className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-glass-border text-zinc-200 disabled:opacity-40"
            disabled={busy}
            onClick={() => setOpenPanel((p) => (p === 'assign' ? null : 'assign'))}
          >
            {t.staff.forceAssign}
          </button>
        )}
        {showMore && acts.skip && (
          <button
            className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-glass-border text-zinc-400 disabled:opacity-40"
            disabled={busy}
            onClick={onSkipTask}
          >
            {t.staff.skipTask}
          </button>
        )}
        {/* send-team-back: always offered; the panel says so when there is nowhere to go yet. */}
        {showMore && acts.sendBack && <button
          className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-glass-border text-zinc-200 disabled:opacity-40"
          disabled={busy}
          onClick={() => setOpenPanel((p) => (p === 'sendBack' ? null : 'sendBack'))}
          data-testid="staff-send-back"
        >
          {t.staff.sendBack}
        </button>}
        {/* Hidden while a panel is open: that panel closes with its own cancel, so the toggle
            can neither drop half-typed input nor look like it did nothing. */}
        {hasMoreActions(acts) && openPanel === null && (
          <button
            type="button"
            data-testid="staff-team-actions-toggle"
            aria-expanded={showMore}
            onClick={() => setActionsOpen((o) => !o)}
            className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-glass-border text-zinc-200 inline-flex items-center gap-1"
          >
            {showMore ? t.staff.fewerActions : t.staff.moreActions}
            <span aria-hidden>{showMore ? '▴' : '▾'}</span>
          </button>
        )}
      </div>

      {/* ── Custom amount + reason ──────────────────────────────────────────
          An inline expand, NOT a modal and NOT window.prompt(): a phone keyboard
          opening reflows the page, and a modal anchored to the viewport jumps out
          from under the row it belongs to. Confirm stays disabled until the amount
          parses, so the "is this submittable?" question has exactly one answer
          (parseAdjustAmount) rather than one per control. */}
      {openPanel === 'amount' && (
        <div className="mt-2.5 pt-2.5 border-t border-glass-border">
          <Input
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            placeholder={t.staff.customAmountPlaceholder}
            inputMode="numeric"
            dir="ltr"
            autoFocus
            aria-label={t.staff.customAmount}
            className="text-center text-lg"
          />
          <div className="text-[13px] text-zinc-500 mt-2 mb-1">{t.staff.reasonLabel}</div>
          <div className="flex flex-wrap gap-1.5">
            {[...presets, OTHER_REASON].map((id) => (
              <button
                key={id}
                onClick={() => setReasonId((cur) => (cur === id ? null : id))}
                className={`min-h-[44px] px-3 rounded-lg text-xs font-medium border ${
                  reasonId === id
                    ? 'bg-accent/20 text-ink-fire border-accent/50'
                    : 'bg-app-raised text-zinc-300 border-glass-border'
                }`}
              >
                {label(id)}
              </button>
            ))}
          </div>
          {reasonId === OTHER_REASON && (
            <Input
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder={t.staff.reasonOtherPlaceholder}
              dir="auto"
              maxLength={200}
              className="mt-2"
              aria-label={t.staff.reasonOther}
            />
          )}
          <div className="flex gap-2 mt-2.5">
            <button
              className="flex-1 min-h-[44px] rounded-lg bg-accent text-black font-semibold text-sm disabled:opacity-40"
              disabled={busy || parsedAmount === null}
              onClick={submitAmount}
            >
              {t.staff.customAmountApply}
            </button>
            <button
              className="flex-1 min-h-[44px] rounded-lg bg-app-raised border border-glass-border text-zinc-300 font-semibold text-sm"
              onClick={closeAmount}
            >
              {t.staff.customAmountCancel}
            </button>
          </div>
        </div>
      )}

      {/* ── Hold reason ─────────────────────────────────────────────────────
          Optional by design: the reason is shown to the TEAM on their own screen,
          which is the whole point (a player stopped with no explanation assumes the
          app broke), but a marshal dealing with an actual incident must be able to
          stop a team in one tap without composing a sentence first. */}
      {openPanel === 'hold' && (
        <div className="mt-2.5 pt-2.5 border-t border-glass-border">
          <div className="text-[13px] text-zinc-500 mb-1.5">{t.staff.holdReasonPrompt}</div>
          <Input
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder={t.staff.reasonOtherPlaceholder}
            dir="auto"
            maxLength={200}
            autoFocus
            aria-label={t.staff.holdReasonPrompt}
          />
          <div className="flex gap-2 mt-2.5">
            <button
              className="flex-1 min-h-[44px] rounded-lg bg-accent text-black font-semibold text-sm disabled:opacity-40"
              disabled={busy}
              onClick={() => {
                onHold(true, holdReason.trim());
                setHoldReason('');
                setOpenPanel(null);
              }}
            >
              {t.staff.holdTeam}
            </button>
            <button
              className="flex-1 min-h-[44px] rounded-lg bg-app-raised border border-glass-border text-zinc-300 font-semibold text-sm"
              onClick={() => { setHoldReason(''); setOpenPanel(null); }}
            >
              {t.staff.customAmountCancel}
            </button>
          </div>
        </div>
      )}

      {/* ── Send to a mission (route-team-to-mission) ─────────────────────────
          Any mission in the game; the server's dry run names exactly what is in the
          way and only that list is waived. Replaced the old all-or-nothing "override
          lock" button, which could hand out a mission completion then refused. */}
      {/* send-team-back: the same targets the organizer's console offers (sendBackTargets), inline
          like every other panel here (a phone keyboard reflows the page under a modal). */}
      {openPanel === 'sendBack' && (
        <div className="mt-2.5 pt-2.5 border-t border-glass-border">
          <div className="text-[13px] text-zinc-500 mb-1.5">{t.staff.sendBackPick}</div>
          {backPick && (
            <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-accent/40 bg-accent/5 p-2" data-testid="staff-sendback-scope">
              <p dir="auto" className="text-xs font-semibold text-zinc-100">{t.staff.sendBackHow(backPick.title)}</p>
              {(['only', 'fromHere'] as const).map((scope) => (
                <button key={scope} type="button" disabled={busy}
                  onClick={() => { onSendBack({ kind: 'task', taskId: backPick.taskId }, backPick.title, scope); setBackPick(null); setOpenPanel(null); }}
                  className="min-h-[44px] px-3 rounded-lg text-start bg-app-raised border border-glass-border hover:border-accent/50 disabled:opacity-40">
                  <span className="block text-xs font-semibold text-zinc-100">{scope === 'only' ? t.staff.sendBackOnly : t.staff.sendBackFromHere}</span>
                  <span className="block text-[12px] text-zinc-500">{scope === 'only' ? t.staff.sendBackOnlyHelp : t.staff.sendBackFromHereHelp}</span>
                </button>
              ))}
            </div>
          )}
          {backTargets.every((s) => !s.stageSelectable && s.missions.every((m) => !m.selectable)) ? (
            <p className="text-zinc-500 text-xs">{t.staff.sendBackNothing}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {backTargets.map((s) => (
                <div key={s.stageId} className="flex flex-col gap-1.5">
                  {s.stageSelectable && (
                    <button
                      className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-glass-border text-zinc-100 text-start disabled:opacity-40"
                      disabled={busy}
                      onClick={() => { onSendBack({ kind: 'stage', stageId: s.stageId }, s.title); setOpenPanel(null); }}
                    >
                      <span dir="auto">{t.staff.sendBackWholeStage({ stage: s.title })}</span>
                    </button>
                  )}
                  {s.missions.filter((m) => m.selectable).map((m) => (
                    <button
                      key={m.taskId}
                      className="min-h-[44px] ms-3 px-3 rounded-lg text-xs font-medium bg-app-raised border border-glass-border text-zinc-200 flex items-center justify-between gap-2 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => setBackPick({ taskId: m.taskId, title: m.title === m.taskId ? titleOf(m.taskId) : m.title })}
                    >
                      <span dir="auto" className="truncate">{m.title === m.taskId ? titleOf(m.taskId) : m.title}</span>
                      <span className="shrink-0 text-[13px] text-zinc-500">
                        {m.status === 'done' ? t.staff.sendBackStatusDone : t.staff.sendBackStatusSkipped}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {openPanel === 'assign' && (
        <StaffRoutePanel ctx={ctx} team={team} outlineStages={outlineStages} busy={busy}
          onRoute={onRoute} onDone={() => setOpenPanel(null)} />
      )}
    </Card>
  );
}

// Team ↔ HQ chat (change: team-hq-chat): staff see every team's thread (the rules
// grant staff the whole chat collection) and reply as HQ. Threads with new activity
// since this device last opened them show an unread badge (a local per-thread map).
interface ChatThread { teamId: string; messages: ChatMessage[]; updatedAt: string }

function StaffChatSection({
  ctx, teams, senderName, focus, followed = [],
}: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: TeamRow[];
  senderName: string;
  /** Open this team's thread now (issue 25: the chat button on an SOS card). */
  focus?: { teamId: string; nonce: number } | null;
  /** The teams this staff member follows: part of "my chats" (issue 45). */
  followed?: string[];
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [storedThreads, setThreads] = useState<ChatThread[]>([]);
  // Issue 45: a staff member starts a conversation with ANY team they pick ("הודעה חדשה"), not only
  // answer one that wrote. A team that never wrote has no thread document; a picked one (or the one an
  // SOS card sent them to) gets an empty thread to write in (sendTeamChatMessage creates the document).
  const [opened, setOpened] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const openedIds = focus ? [focus.teamId, ...opened] : opened;
  const threads = mergeOpenedThreads(storedThreads, openedIds) as ChatThread[];
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  // Seen markers, PERSISTED per run+team (change: team-chat-unread-accuracy).
  // They used to be React state only, so a console reload re-flagged every
  // non-empty thread — including threads whose only messages were HQ's own
  // replies. Seeded lazily per thread as the collection snapshot arrives.
  const [seen, setSeen] = useState<Record<string, ChatSeenMarker>>({});
  const [draft, setDraft] = useState('');
  const myUid = uid(); // this staffer's uid — drives own-vs-other-HQ attribution
  const markerFor = useCallback(
    (teamId: string): ChatSeenMarker => seen[teamId] ?? loadChatSeen(ctx.runId, teamId),
    [seen, ctx.runId],
  );
  const markRead = useCallback((teamId: string, messages: ChatMessage[]) => {
    const marker = chatSeenMarker(messages);
    saveChatSeen(ctx.runId, teamId, marker);
    setSeen((s) => ({ ...s, [teamId]: marker }));
  }, [ctx.runId]);

  useEffect(() => {
    const ref = collection(db, FIRESTORE_PATHS.runChatCol(ctx.ownerUid, ctx.gameId, ctx.runId));
    return onSnapshot(ref, (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as { messages?: ChatMessage[]; updatedAt?: string };
        return { teamId: d.id, messages: data.messages ?? [], updatedAt: data.updatedAt ?? '' };
      });
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setThreads(rows);
    }, () => setThreads([]));
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);

  // While a thread is expanded, new arrivals (incl. this staffer's own replies)
  // are being read — keep its seen-count in step with the live message count so it
  // doesn't resurface as "unread" the moment it's collapsed (mirrors the
  // participant ChatSection). Without this, sending a reply re-flags the open thread.
  useEffect(() => {
    if (!openTeam) return;
    const th = threads.find((x) => x.teamId === openTeam);
    if (th && countUnreadChatMessages(th.messages, markerFor(openTeam), myUid) > 0) {
      markRead(openTeam, th.messages);
    }
  }, [openTeam, threads, markerFor, markRead, myUid]);

  const nameFor = (teamId: string) => teams.find((tm) => tm.id === teamId)?.displayName ?? teamId.slice(0, 8);

  // Visible outcome for a failed reply (see below). Cleared on every new attempt
  // and whenever the staff member switches threads, so it can never outlive the
  // message it describes.
  const [replyErr, setReplyErr] = useState('');
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setOpenTeam(focus.teamId);
    setDraft('');
    setReplyErr('');
    window.setTimeout(() => document.getElementById('staff-chat')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }, [focus]);

  function startWith(teamId: string) {
    setOpened((ids) => [teamId, ...ids.filter((id) => id !== teamId)]);
    setOpenTeam(teamId);
    setPicking(false);
    setQuery('');
    setMineOnly(false);
    setDraft('');
    setReplyErr('');
  }
  const myUidForFilter = uid();
  const visibleThreads = mineOnly ? threads.filter((th) => isMyThread(th, myUidForFilter, followed, openedIds)) : threads;

  function expand(teamId: string, messages: ChatMessage[]) {
    setOpenTeam((cur) => {
      const next = cur === teamId ? null : teamId;
      if (next) markRead(teamId, messages);
      return next;
    });
    setDraft('');
    setReplyErr('');
  }

  async function reply(teamId: string) {
    const clean = draft.trim();
    if (!clean) return;
    setReplyErr('');
    try {
      await sendTeamChatMessage({ ...ctx, teamId, text: clean, senderName });
      setDraft('');
    } catch {
      // Keeping the draft for a retry is right; staying SILENT about it was not.
      // "The listener reconciles" only holds for a message that was actually
      // sent — a failed send produces nothing to reconcile, so the only signal
      // was that the box did not clear. During a live event that is ambiguous
      // with a slow network, and a staff member cannot tell whether the team
      // they are answering got the reply.
      setReplyErr(t.staff.replyFailed);
    }
  }
  // Guarded so a double-tapped send (or Enter held down) can't post the same reply
  // twice (change: wave-b/async-action-guard).
  const replyAction = useAsyncAction(reply);
  const busy = replyAction.busy;

  const totalUnread = threads.reduce(
    (n, th) => n + (countUnreadChatMessages(th.messages, markerFor(th.teamId), myUid) > 0 ? 1 : 0), 0);

  return (
    <section className="mb-6 scroll-mt-4" id="staff-chat">
      <Collapsible
        open={open}
        onToggle={() => setOpen((o) => !o)}
        header={(
          <>
            <Icon name="chat" className="w-4 h-4 inline-block align-text-bottom" /> {t.staff.teamChatTitle}
            {totalUnread > 0 && (
              <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[13px] font-semibold text-black">{totalUnread}</span>
            )}
          </>
        )}
      >
        {/* Issue 45: start a chat with any team, and narrow the list to mine. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" data-testid="staff-chat-new" onClick={() => setPicking((p) => !p)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-black hover:brightness-105">
            <Icon name="plus" className="w-4 h-4" aria-hidden />{t.staff.chatNew}
          </button>
          <div role="group" className="ms-auto inline-flex rounded-full border border-glass-border p-0.5 text-[13px]">
            {([[false, t.staff.chatFilterAll], [true, t.staff.chatFilterMine]] as const).map(([mine, label]) => (
              <button key={String(mine)} type="button" aria-pressed={mineOnly === mine} onClick={() => setMineOnly(mine)}
                className={`min-h-[36px] rounded-full px-3 font-medium ${mineOnly === mine ? 'bg-app-raised text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {picking && (
          <Card className="p-3 mb-3">
            <p className="text-sm font-semibold text-zinc-100 mb-2">{t.staff.chatPickTeam}</p>
            <input value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" autoFocus
              placeholder={t.staff.chatSearchTeam} aria-label={t.staff.chatSearchTeam}
              className="w-full min-h-[44px] rounded-lg bg-app-raised border border-glass-border px-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-accent/50" />
            <ul className="mt-2 max-h-56 overflow-y-auto">
              {pickableTeams(teams, query).map((tm) => (
                <li key={tm.id}>
                  <button type="button" onClick={() => startWith(tm.id)} dir="auto"
                    className="w-full min-h-[44px] rounded-lg px-2 text-start text-sm text-zinc-100 hover:bg-app-raised">
                    {tm.displayName}
                  </button>
                </li>
              ))}
              {pickableTeams(teams, query).length === 0 && <li className="px-2 py-2 text-sm text-zinc-500">{t.staff.chatNoTeamMatch}</li>}
            </ul>
            <button type="button" onClick={() => { setPicking(false); setQuery(''); }}
              className="mt-1 min-h-[44px] px-2 text-sm text-zinc-500 hover:text-zinc-200">{t.staff.chatCancel}</button>
          </Card>
        )}
        {(
        visibleThreads.length === 0
          ? <p className="text-zinc-500 text-sm">{mineOnly ? t.staff.chatMineEmpty : t.staff.chatAllEmpty}</p>
          : visibleThreads.map((th) => {
            const last = th.messages[th.messages.length - 1];
            const unread = countUnreadChatMessages(th.messages, markerFor(th.teamId), myUid) > 0;
            const expanded = openTeam === th.teamId;
            return (
              <Card key={th.teamId} className="p-3 mb-2">
                <button className="w-full min-h-[44px] text-start" onClick={() => expand(th.teamId, th.messages)}>
                  <div className="flex items-center justify-between gap-2">
                    <div dir="auto" className="text-sm font-medium text-zinc-100 truncate">{nameFor(th.teamId)}</div>
                    {unread && <span className="shrink-0 inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[13px] font-semibold text-black">{t.chat.chatUnread}</span>}
                  </div>
                  {last && <div dir="auto" className="text-xs text-zinc-500 truncate mt-0.5">{last.from === 'hq' ? `${hqSenderLabel(last.senderName, t.chat.chatHq)}: ` : ''}{last.text}</div>}
                </button>
                {expanded && (
                  <div className="mt-2 flex flex-col gap-2">
                    {th.messages.length === 0 && <p className="text-xs text-zinc-500">{t.staff.chatNewThread}</p>}
                    <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5">
                      {th.messages.map((m) => {
                        // Attribute from THIS staffer's angle: their own replies read
                        // as them (right), another HQ member's as "המטה", the team's
                        // lines as the team name (left). (fix-chat-sender-attribution)
                        const side = chatMessageSide(m, myUid);
                        const hqSide = side !== 'other'; // 'me' or another HQ member
                        const label = side === 'me' ? t.devices.youTag
                          : side === 'hq' ? hqSenderLabel(m.senderName, t.chat.chatHq)
                          : m.senderName;
                        return (
                          <div key={m.id} className={`flex flex-col ${hqSide ? 'items-end' : 'items-start'}`}>
                            <span className="text-[13px] text-zinc-500">{label}</span>
                            <div dir="auto" className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm text-start ${hqSide ? 'bg-accent/15 border border-accent/40 text-zinc-100' : 'bg-app-raised border border-glass-border text-zinc-200'}`}>{m.text}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void replyAction.run(th.teamId); } }}
                        maxLength={CHAT_TEXT_MAX_LEN}
                        dir="auto"
                        disabled={busy}
                        placeholder={t.chat.chatReplyPlaceholder}
                        className="flex-1 min-w-0 min-h-[44px] rounded-full bg-app-raised border border-glass-border px-4 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-accent/50 disabled:opacity-50"
                      />
                      <button
                        onClick={() => void replyAction.run(th.teamId)}
                        disabled={busy || !draft.trim()}
                        className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                      >
                        {t.chat.chatSend}
                      </button>
                    </div>
                    {replyErr && (
                      <p role="status" aria-live="polite" className="mt-1.5 text-xs font-semibold text-ink-alert">
                        {replyErr}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </Collapsible>
    </section>
  );
}

// ─── Staff ↔ admin channel (staff-console-field-ops) ─────────────────────────
//
// ONE shared thread per run: any marshal ↔ the organizer. Distinct from the team
// chat above (which is per team, and which participants can read) — this is where
// staff report problems and ask for exceptions, so it must not be readable by the
// teams it concerns. firestore.rules enforces that independently of this UI.
function StaffAdminChannelSection({
  ctx, senderName,
}: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  senderName: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<StaffChannelMessage[]>([]);
  const [seen, setSeen] = useState<ChatSeenMarker | null>(null);
  const [draft, setDraft] = useState('');
  const myUid = uid();

  // Seen marker persists per RUN (no team component — there is one thread), so a
  // console reload does not re-flag messages this device already read.
  const storageKey = staffChannelSeenStorageKey(ctx.runId);
  const marker = seen ?? readSeenMarker(storageKey);

  useEffect(() => {
    const ref = doc(db, FIRESTORE_PATHS.runStaffChannel(ctx.ownerUid, ctx.gameId, ctx.runId));
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as { messages?: StaffChannelMessage[] } | undefined;
      setMessages(data?.messages ?? []);
      // A read failure here is NOT surfaced as a console-wide error: a staff token
      // minted before this feature shipped may legitimately fail the new rule, and
      // that must degrade to an empty channel, never to a red banner over a
      // working console mid-event.
    }, () => setMessages([]));
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);

  const unread = countUnreadChatMessages(messages, marker, myUid);

  // While the section is open, arrivals are being read — keep the marker in step so
  // sending a message doesn't immediately re-flag the thread as unread.
  useEffect(() => {
    if (!open || messages.length === 0) return;
    if (countUnreadChatMessages(messages, marker, myUid) === 0) return;
    const next = chatSeenMarker(messages);
    writeSeenMarker(storageKey, next);
    setSeen(next);
  }, [open, messages, marker, myUid, storageKey]);

  async function send() {
    const clean = draft.trim();
    if (!clean) return;
    try {
      await sendStaffChannelMessage({ ...ctx, text: clean, senderName });
      setDraft('');
    } catch {
      // Keep the draft: retyping a field report on a phone, in the field, is the
      // worst possible failure recovery.
    }
  }
  const sendAction = useAsyncAction(send);

  return (
    <section className="mb-6 scroll-mt-4" id="staff-channel">
      <Collapsible
        open={open}
        onToggle={() => setOpen((o) => !o)}
        header={(
          <>
            <Icon name="radio" className="w-4 h-4 inline-block align-text-bottom" /> {t.staff.channelTitle}
            {unread > 0 && (
              <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[13px] font-semibold text-black">{unread}</span>
            )}
          </>
        )}
      >
        <div className="flex flex-col gap-2">
          {messages.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t.staff.channelEmpty}</p>
          ) : (
            <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5">
              {messages.map((m) => {
                const side = staffChannelMessageSide(m, myUid);
                const mine = side === 'me';
                return (
                  <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <span className="text-[13px] text-zinc-500">
                      {mine ? t.devices.youTag : side === 'admin' ? t.staff.channelAdmin : m.senderName}
                    </span>
                    <div
                      dir="auto"
                      className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm text-start ${
                        mine
                          ? 'bg-accent/15 border border-accent/40 text-zinc-100'
                          : side === 'admin'
                          ? 'bg-ink-fire/10 border border-ink-fire/40 text-zinc-100'
                          : 'bg-app-raised border border-glass-border text-zinc-200'
                      }`}
                    >{m.text}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendAction.run(); } }}
              maxLength={CHAT_TEXT_MAX_LEN}
              dir="auto"
              disabled={sendAction.busy}
              placeholder={t.staff.channelPlaceholder}
              className="flex-1 min-w-0 min-h-[44px] rounded-full bg-app-raised border border-glass-border px-4 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-accent/50 disabled:opacity-50"
            />
            <button
              onClick={() => void sendAction.run()}
              disabled={sendAction.busy || !draft.trim()}
              className="shrink-0 min-h-[44px] rounded-full bg-accent px-4 text-sm font-semibold text-black disabled:opacity-50"
            >
              {t.staff.channelSend}
            </button>
          </div>
        </div>
      </Collapsible>
    </section>
  );
}

// ─── Live team map (staff-console-field-ops) ─────────────────────────────────
//
// Collapsed by default and mounted through lazyWithRetry, so MapLibre is never in
// play-web's entry chunk (npm run bundle:budget asserts exactly this) and a stale
// shell after a redeploy self-heals instead of crashing the console.
const StaffTeamMap = lazyWithRetry('staff-team-map', () => import('../components/StaffTeamMap'));

function StaffTeamMapSection({
  ctx, teams, spots, followed, mineOnly, openByDefault = false,
}: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: TeamRow[];
  spots: MissionSpot[];
  followed: readonly string[];
  mineOnly: boolean;
  /** desktop-layouts-play-staff: on a computer there is room, so the map starts open unless the
   *  marshal closed it on this device before. */
  openByDefault?: boolean;
}) {
  const { t } = useT();
  // staff-event-map: once opened it stays open on this phone for this run, so a marshal who uses
  // the map does not have to unfold it after every reload.
  const openKey = `rp-staff-map-open:${ctx.runId}`;
  const [open, setOpenState] = useState(() => {
    try { const v = localStorage.getItem(openKey); return v === null ? openByDefault : v === '1'; } catch { return openByDefault; }
  });
  const setOpen = (fn: (o: boolean) => boolean) => setOpenState((o) => {
    const next = fn(o);
    try { localStorage.setItem(openKey, next ? '1' : '0'); } catch { /* memory only */ }
    return next;
  });
  return (
    <section className="mb-6 scroll-mt-4" id="staff-map">
      <Collapsible
        open={open}
        onToggle={() => setOpen((o) => !o)}
        header={<span className="inline-flex items-center gap-1.5"><Icon name="map" className="w-4 h-4 shrink-0" />{t.staff.teamMap}</span>}
      >
        <Suspense fallback={<div className="h-56 rounded-xl bg-app-card border border-glass-border animate-pulse" />}>
          <StaffTeamMap ctx={ctx} teams={teams} spots={spots} followed={followed} mineOnly={mineOnly} />
        </Suspense>
      </Collapsible>
    </section>
  );
}

// Live photo feed (change: live-photo-feed): the run's feed with a hide button on
// each card, so staff can pull an inappropriate photo the moment it appears.
function StaffFeedSection({ ctx }: { ctx: { ownerUid: string; gameId: string; runId: string } }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const myUid = uid();
  return (
    <section className="mb-6">
      <Collapsible
        open={open}
        onToggle={() => setOpen((o) => !o)}
        header={<span className="inline-flex items-center gap-1.5"><Icon name="image" className="w-4 h-4 shrink-0" />{t.feed.feedTitle}</span>}
      >
        {myUid && (
          <Suspense fallback={<div className="h-24 rounded-xl bg-app-card border border-glass-border animate-pulse" />}>
            <FeedPanel ctx={ctx} myUid={myUid} moderate />
          </Suspense>
        )}
      </Collapsible>
    </section>
  );
}

// ─── Flash missions in the field (change: flash-missions-v2, overnight 2026-09-29) ─────────────
//
// The marshal who watched a team do the flash mission can approve it on the spot, and end a flash
// mission early, with the same callables and the same capabilities as the console (`review`,
// `broadcast`). Lists come from the pure `staffFlashLists`. Renders nothing when there is nothing to
// act on, so an ordinary run's staff screen does not grow.
function StaffFlashSection({ ctx, teams, canReview, canEnd }: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: TeamRow[];
  canReview: boolean;
  canEnd: boolean;
}) {
  const { t, lang } = useT();
  const f = t.flash;
  const [docs, setDocs] = useState<unknown[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const q = query(collection(db, `users/${ctx.ownerUid}/games/${ctx.gameId}/runs/${ctx.runId}/flashMissions`), orderBy('createdAt', 'desc'), limit(8));
    return onSnapshot(q, (snap) => setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setDocs([]));
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const lists = staffFlashLists(docs, teams, now, lang);
  const waiting = canReview ? lists.waiting : [];
  const running = canEnd ? lists.running : [];
  if (waiting.length === 0 && running.length === 0) return null;

  async function act(key: string, run: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(key); setMsg('');
    try { await run(); setMsg(done); } catch { setMsg(f.staffFailed); } finally { setBusy(null); }
  }
  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  return (
    <section className="mb-6 scroll-mt-4" id="staff-flash" data-testid="staff-flash">
      <h2 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1.5"><Icon name="bolt" className="w-4 h-4 shrink-0" />{f.staffTitle}</h2>
      {waiting.length > 0 && (
        <>
          <p className="text-[13px] text-zinc-400 mb-1">{f.staffWaiting}</p>
          <ul className="space-y-2 mb-3">
            {waiting.map((w) => {
              const key = `${w.flashId}:${w.teamId}`;
              const late = w.ageMs >= REVIEW_ALARM_MS;
              return (
                <li key={key} className={`rounded-xl border p-3 ${late ? 'border-ink-alert' : 'border-glass-border'} bg-app-card`}>
                  <p dir="auto" className="text-sm"><span className="font-semibold">{w.teamName}</span> · {w.title}</p>
                  <p className={`text-[13px] font-mono ${late ? 'text-ink-alert font-bold' : 'text-zinc-400'}`}>{f.staffWaited({ s: fmt(w.ageMs) })}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {w.mediaUrl && (
                      <a href={w.mediaUrl} target="_blank" rel="noreferrer" className={`${TAP_TARGET} inline-flex items-center px-3 underline text-ink-fire text-sm`}>{f.staffOpenMedia}</a>
                    )}
                    <Button className="w-auto px-4" loading={busy === `${key}:a`} disabled={!!busy}
                      onClick={() => void act(`${key}:a`, () => reviewFlashMission({ ...ctx, flashId: w.flashId, teamId: w.teamId, action: 'approve' }), f.staffApproved)}>
                      {f.staffApprove}
                    </Button>
                    {/* Issue 26: another try, or no more tries for this team. */}
                    <Button variant="ghost" className="w-auto px-4" loading={busy === `${key}:rr`} disabled={!!busy} data-testid="flash-reject-retry"
                      onClick={() => void act(`${key}:rr`, () => reviewFlashMission({ ...ctx, flashId: w.flashId, teamId: w.teamId, action: 'reject', retry: true }), f.staffRejectedRetry)}>
                      {f.staffRejectRetry}
                    </Button>
                    <Button variant="ghost" className="w-auto px-4" loading={busy === `${key}:r`} disabled={!!busy} data-testid="flash-reject-close"
                      onClick={() => void act(`${key}:r`, () => reviewFlashMission({ ...ctx, flashId: w.flashId, teamId: w.teamId, action: 'reject' }), f.staffRejected)}>
                      {f.staffRejectClose}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {running.length > 0 && (
        <>
          <p className="text-[13px] text-zinc-400 mb-1">{f.staffRunning}</p>
          <ul className="space-y-2">
            {running.map((r) => (
              <li key={r.flashId} className="flex flex-wrap items-center gap-2 rounded-xl border border-glass-border bg-app-card p-3">
                <span dir="auto" className="flex-1 min-w-[8rem] text-sm font-semibold">{r.title}</span>
                <span className="text-[13px] text-zinc-400">{f.staffMinutesLeft({ n: r.minutesLeft })}</span>
                <Button variant="ghost" className="w-auto px-4" loading={busy === `${r.flashId}:end`} disabled={!!busy}
                  onClick={() => void act(`${r.flashId}:end`, () => deactivateFlashMission({ ...ctx, flashId: r.flashId }), f.staffEnded)}>
                  {f.staffEnd}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {msg && <p role="status" aria-live="polite" className="text-[13px] text-zinc-300 mt-2">{msg}</p>}
    </section>
  );
}

function AnnouncementComposer({ ctx, teams }: { ctx: { ownerUid: string; gameId: string; runId: string }; teams: TeamRow[] }) {
  const { t } = useT();
  // Issue 33 (Ahiya, 2026-10-06): a marshal allowed to broadcast can also write to ONE team.
  // pushAnnouncement has taken a teamId since targeted-announcements; only this screen lacked it.
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [msgHe, setMsgHe] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  // change: play-no-silent-failures. Two defects lived here:
  //   1. the button was gated on the ENGLISH field in a Hebrew-first product, so
  //      a Hebrew volunteer filled the Hebrew box and the button stayed greyed
  //      out with nothing to read;
  //   2. send() had no try/catch and useAsyncAction.run RE-THROWS, so a failed
  //      broadcast to every team showed nothing at all — and the drafts were
  //      cleared before the call could reject.
  // Both drafts are now cleared only on success.
  async function send() {
    const payload = announcementPayload(msg, msgHe);
    if (!payload) return;
    setSent(false); setErr('');
    try {
      await pushAnnouncement({ ...ctx, ...payload, ...(target ? { teamId: target } : {}) });
    } catch {
      setErr(t.staff.broadcastFailed);
      return;
    }
    setMsg(''); setMsgHe(''); setSent(true);
    setTimeout(() => setSent(false), 2500);
  }
  // Guarded: a double-tapped broadcast pushed the same announcement to every team
  // twice (change: wave-b/async-action-guard).
  const sendAction = useAsyncAction(send);
  const busy = sendAction.busy;

  return (
    <section className="pt-2 border-t border-glass-border scroll-mt-4" id="staff-broadcast">
      <h2 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1.5"><Icon name="megaphone" className="w-4 h-4 shrink-0" />{t.staff.announcement}</h2>
      {/* Hebrew is the primary field (this is a Hebrew-first product and the
          volunteers are Hebrew speakers); English is explicitly optional. */}
      <div className="space-y-2">
        <label className="block">
          <span className="block text-[13px] text-zinc-400 mb-1">{t.staff.broadcastTo}</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="broadcast-target"
            className="w-full min-h-[44px] px-4 rounded-2xl text-base bg-white border border-glass-border text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rp-fire/30">
            <option value="">{t.staff.broadcastAllTeams}</option>
            {teams.filter((tm) => tm.removed !== true).map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.displayName}</option>
            ))}
          </select>
        </label>
        <Input value={msgHe} onChange={(e) => setMsgHe(e.target.value)} placeholder={t.staff.msgHePrimary} dir="rtl" />
        <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t.staff.msgEnOptional} dir="ltr" />
      </div>
      {err && <p role="status" aria-live="polite" className="text-danger text-xs mt-2">{err}</p>}
      <Button disabled={busy || (!msg.trim() && !msgHe.trim())} loading={busy} onClick={() => void sendAction.run()} className="mt-3">
        {sent ? t.staff.sent : target ? t.staff.sendToTeam({ name: teams.find((tm) => tm.id === target)?.displayName ?? '' }) : t.staff.broadcast}
      </Button>
    </section>
  );
}

// A window over the staff board (issue 39, computer only; Ahiya: "תעשה שיפתחו חלונות או משהו, הגלילה
// ממש הורסת"). Escape, the close button and a click on the dimmed board close it; focus goes into it
// on open and back to what opened it on close.
function StaffWindow({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useT();
  const titleId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="staff-window"
        className="flex max-h-[calc(100dvh-3rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-glass-border bg-app-card shadow-2xl outline-none">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-glass-border px-4 py-2.5">
          <h2 id={titleId} dir="auto" className="truncate text-base font-bold text-zinc-100">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t.staff.desk.close}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-app-raised hover:text-zinc-100">
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3 [&>div]:mb-0 [&>div]:border-0 [&>div]:shadow-none">{children}</div>
      </div>
    </div>
  );
}
