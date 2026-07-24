import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, signInStaff, uid } from '../services/firebase';
import { lazyWithRetry } from '../lib/lazyWithRetry';
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
} from '../services/calls';
import {
  FIRESTORE_PATHS, CHAT_TEXT_MAX_LEN, chatMessageSide, chatSeenMarker, countUnreadChatMessages,
  type ChatMessage, type ChatSeenMarker,
} from '@rushpoint/shared';
import type { StaffCtx } from '../lib/playRoute';
import {
  loadStaffSession,
  saveStaffSession,
  clearStaffSession,
  loadChatSeen,
  saveChatSeen,
  type StaffSession,
} from '../store';
import { Button, Card, Collapsible, Input, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { feedback } from '../lib/sound';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { classifyStaffError, announcementPayload, type StaffFailure } from '../lib/failureCopy';
import { dialog } from '../components/dialog';

// ── A flattened pending photo submission row (one per team×task) ──
interface PendingSubmission {
  teamId: string;
  displayName: string;
  taskId: string;
  photoUrl: string;
  submittedAt: string;
  // audio-tasks: how to render the submission (absent ⇒ 'photo' for legacy rows).
  mediaKind?: 'photo' | 'audio';
}

interface Alert {
  id: string;
  teamId: string;
  type: string;
  message: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

// ── A team row for the manual bonus/deduction panel ──
interface TeamRow {
  id: string;
  displayName: string;
  score: number;
}

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
  const [ownerUid, setOwnerUid] = useState(ctx?.ownerUid ?? '');
  const [gameId, setGameId] = useState(ctx?.gameId ?? '');
  const [runId, setRunId] = useState(ctx?.runId ?? '');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  // Full context from the link ⇒ the short form (name + PIN).
  const fromLink = !!ctx;

  async function submit() {
    setErr('');
    try {
      // Send the typed name so it reaches the `staffName` token claim: audit rows
      // (approvals, score adjustments) are written server-side from the claim, so a
      // client-only name would leave the trail saying "Staff 1" instead of who acted.
      const res = await staffSignIn({
        ownerUid: ownerUid.trim(), gameId: gameId.trim(), runId: runId.trim(),
        pin: pin.trim(), name: name.trim() || undefined,
      });
      await signInStaff(res.customToken);
      const session: StaffSession = {
        ownerUid: ownerUid.trim(), gameId: gameId.trim(), runId: runId.trim(),
        // The marshal's own name wins over the placeholder the organizer typed
        // when minting the PIN. NOTE: attribution in the audit trail still comes
        // from the `staffName` token claim — carrying this to the server needs a
        // staffSignIn payload field (see docs/wave-e/staff-qr-onboarding-plan.md).
        name: name.trim() || res.name,
        permissions: res.permissions,
      };
      saveStaffSession(session);
      onSignedIn(session);
    } catch (e) {
      // Localize the server's English rejections by code instead of leaking them.
      const code = (e && typeof e === 'object' && 'code' in e
        ? String((e as { code?: unknown }).code ?? '') : '').replace(/^functions\//, '');
      setErr(
        code === 'not-found' ? t.staff.signInInvalidPin
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
          {/* Only shown when the link did NOT carry the run address. */}
          {!fromLink && (
            <>
              <Input value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} placeholder={t.staff.ownerUid} />
              <Input value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder={t.staff.gameId} />
              <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder={t.staff.runId} />
            </>
          )}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.join.yourName}
            autoFocus={fromLink}
            dir="auto"
            onKeyDown={(e) => { if (e.key === 'Enter') void submitAction.run(); }}
          />
          <Input
            value={pin}
            dir="ltr"
            onChange={(e) => setPin(e.target.value)}
            placeholder={t.staff.pin}
            inputMode="numeric"
            className="text-center text-xl font-mono tracking-[0.3em]"
            onKeyDown={(e) => { if (e.key === 'Enter') void submitAction.run(); }}
          />
        </div>
        {err && <p className="text-danger text-sm text-center mt-3">{err}</p>}
        <Button disabled={busy || !ownerUid || !gameId || !runId || !name.trim() || !pin} loading={busy} onClick={() => void submitAction.run()} className="mt-5">
          {t.staff.signIn}
        </Button>
        <button className="text-zinc-500 text-sm mt-4 mx-auto" onClick={onExit}>{t.staff.backToJoin}</button>
      </div>
    </Screen>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function StaffDashboard({ staff, onSignOut }: { staff: StaffSession; onSignOut: () => void }) {
  const { t } = useT();
  const { ownerUid, gameId, runId } = staff;
  const ctx = useMemo(() => ({ ownerUid, gameId, runId }), [ownerUid, gameId, runId]);

  const [pending, setPending] = useState<PendingSubmission[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // Volunteers read this, so it is a CLASSIFICATION, never the server's English
  // text (change: play-no-silent-failures). `sessionExpired` also unlocks the way
  // back to the PIN screen, which an expired token otherwise had no path to.
  const [readErr, setReadErr] = useState<StaffFailure | null>(null);
  // A score adjustment used to land with NO feedback at all: the buttons sat ~4px
  // apart with no confirm and no undo, so a mis-tapped -5 was indistinguishable
  // from nothing happening. Confirm AFTER the callable resolves (never before —
  // a volunteer awards points dozens of times a run and a modal per tap is
  // unusable), so a wrong one is visible and correctable with its opposite.
  const [adjustAck, setAdjustAck] = useState<Record<string, string>>({});
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
          taskSubmissions?: Record<string, { photoUrl?: string; submittedAt?: string; status?: string; mediaKind?: 'photo' | 'audio' }>;
        };
        teamRows.push({ id: doc.id, displayName: td.displayName ?? doc.id, score: td.score ?? 0 });
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
            });
          }
        }
      });
      rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
      // Stable order: score desc, then id — so tied teams don't flicker rows between
      // snapshots (which could make a busy +/- button appear on the wrong team).
      teamRows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      setPending(rows);
      setTeams(teamRows);
    }, (e) => setReadErr(classifyStaffError(e)));
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
    }, (e) => setReadErr(classifyStaffError(e)));
  }, [ownerUid, gameId, runId]);

  async function review(s: PendingSubmission, approved: boolean) {
    try {
      await reviewStationSubmission({ ...ctx, teamId: s.teamId, taskId: s.taskId, approved });
    } catch (e) {
      setReadErr(classifyStaffError(e));
    }
  }

  async function ack(a: Alert) {
    try {
      await acknowledgeAlert({ ...ctx, alertId: a.id });
    } catch (e) {
      setReadErr(classifyStaffError(e));
    }
  }

  // Manual bonus / deduction. Positive delta = bonus, negative = fine. The team
  // score updates live via the open snapshot; no manual refresh needed.
  async function adjust(team: TeamRow, delta: number) {
    try {
      await adjustTeamScore({ ...ctx, teamId: team.id, delta, reason: 'staff' });
      const label = t.staff.adjustApplied({ delta: delta > 0 ? `+${delta}` : String(delta) });
      setAdjustAck((a) => ({ ...a, [team.id]: label }));
      clearTimeout(ackTimers.current[team.id]);
      ackTimers.current[team.id] = setTimeout(() => {
        setAdjustAck((a) => { const next = { ...a }; delete next[team.id]; return next; });
      }, 3000);
    } catch (e) {
      setReadErr(classifyStaffError(e));
    }
  }

  // In-flight guards (change: wave-b/async-action-guard). These replace the single
  // `busyKey` useState — which could not stop a second tap in the same React batch,
  // so a double-tapped +10 really did award 20, and a double-tapped approve fired
  // reviewStationSubmission twice. Keyed exactly like busyKey was, so a different
  // row can still act while this one is in flight.
  const reviewAction = useAsyncAction<[PendingSubmission, boolean], void>(review, (s) => `${s.teamId}:${s.taskId}`);
  const ackAction = useAsyncAction<[Alert], void>(ack, (a) => a.id);
  const adjustAction = useAsyncAction<[TeamRow, number], void>(adjust, (team) => team.id);

  const nameFor = (teamId: string) => teams.find((tm) => tm.id === teamId)?.displayName ?? teamId.slice(0, 8);

  return (
    <div className="min-h-screen max-w-md mx-auto w-full px-5 py-6 flex flex-col">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-brand text-xl font-extrabold text-ink-fire">{t.staff.title}</h1>
          <p className="text-zinc-500 text-xs">{staff.name}</p>
        </div>
        <button
          className="inline-flex items-center min-h-[44px] px-3 py-2 -me-3 rounded-lg text-zinc-500 text-sm"
          onClick={() => { void dialog.confirm(t.staff.signOutConfirm, { danger: true }).then((ok) => { if (ok) onSignOut(); }); }}
        >{t.staff.signOut}</button>
      </header>

      {readErr && (
        <div role="status" aria-live="polite" className="mb-3">
          <p className="text-danger text-xs">⚠ {t.staff[readErr.key]}</p>
          {readErr.sessionExpired && (
            <button className="mt-1 text-xs font-semibold text-ink-fire underline" onClick={onSignOut}>
              {t.staff.backToSignIn}
            </button>
          )}
        </div>
      )}

      {/* ── SOS alerts ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">
          🆘 {t.staff.alerts} {alerts.length > 0 && <span className="text-danger">({alerts.length})</span>}
        </h2>
        {alerts.length === 0
          ? <p className="text-zinc-500 text-sm">{t.staff.noAlerts}</p>
          : alerts.map((a) => (
            <Card key={a.id} className="p-3 mb-2 border-danger/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 uppercase">{a.type}</div>
                  <div className="text-xs text-zinc-500 truncate">{t.staff.teamLabel} {nameFor(a.teamId)}</div>
                  {a.message && <div dir="auto" className="text-sm text-zinc-300 mt-1">{a.message}</div>}
                  {a.lat != null && a.lng != null && (
                    <a
                      className="text-ink-fire text-xs underline"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}&travelmode=walking`}
                      target="_blank" rel="noreferrer"
                    >
                      {t.staff.openLocation}
                    </a>
                  )}
                </div>
                <button
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-app-raised text-zinc-100 text-sm border border-glass-border disabled:opacity-40"
                  disabled={ackAction.isBusy(a.id)}
                  onClick={() => void ackAction.run(a)}
                >
                  {t.staff.ack}
                </button>
              </div>
            </Card>
          ))}
      </section>

      {/* ── Photo review ── */}
      <section className="mb-6 flex-1">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">
          📷 {t.staff.photoReview} {pending.length > 0 && <span className="text-ink-fire">({pending.length})</span>}
        </h2>
        {pending.length === 0
          ? <p className="text-zinc-500 text-sm">{t.staff.noSubmissions}</p>
          : pending.map((s) => {
            const key = `${s.teamId}:${s.taskId}`;
            const hasUrl = /^https?:\/\//.test(s.photoUrl);
            // audio-tasks: an audio submission plays inline; everything else falls
            // back to the existing photo <img> (or a plain link for non-URLs).
            const isAudio = s.mediaKind === 'audio';
            return (
              <Card key={key} className="p-3 mb-2">
                <div dir="auto" className="text-sm font-medium text-zinc-100">{s.displayName}</div>
                <div className="text-xs text-zinc-500 mb-2">{t.staff.taskLabel} {s.taskId.slice(0, 10)}</div>
                {hasUrl && isAudio
                  ? <audio controls src={s.photoUrl} className="w-full mb-2" aria-label={t.staff.audioSubmission} />
                  : hasUrl
                  ? <img src={s.photoUrl} alt={t.staff.submissionAlt} className="w-full rounded-lg mb-2 max-h-64 object-cover" />
                  : <div className="text-xs text-zinc-500 italic mb-2 break-all">📎 {s.photoUrl || t.staff.noPhoto}</div>}
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
          })}
      </section>

      {/* ── Manual bonus / deduction ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">
          ⚖️ {t.staff.teamsScores} {teams.length > 0 && <span className="text-zinc-500">({teams.length})</span>}
        </h2>
        {teams.length === 0
          ? <p className="text-zinc-500 text-sm">{t.staff.noTeams}</p>
          : teams.map((tm) => (
            <Card key={tm.id} className="p-3 mb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div dir="auto" className="text-sm font-medium text-zinc-100 truncate">{tm.displayName}</div>
                  <div className="text-xs text-zinc-500">{t.staff.scoreLabel} {tm.score}</div>
                  {adjustAck[tm.id] && (
                    <div role="status" aria-live="polite" className="text-xs font-semibold text-ink-fire">
                      ✓ {adjustAck[tm.id]}
                    </div>
                  )}
                </div>
                {/* Two groups with a wide separator: -5 and +5 used to sit ~4px
                    apart, so the deduct and the award were one thumb-width from
                    each other on a control with no undo. */}
                <div className="flex items-center gap-4 shrink-0">
                  {[[-10, -5], [5, 10]].map((group) => (
                    <div key={group[0]} className="flex items-center gap-2">
                      {group.map((d) => (
                        <button
                          key={d}
                          className={`w-11 h-11 rounded-lg text-sm font-bold border disabled:opacity-40 ${
                            d > 0 ? 'bg-accent/15 text-ink-fire border-accent/30' : 'bg-app-raised text-zinc-200 border-glass-border'
                          }`}
                          disabled={adjustAction.isBusy(tm.id)}
                          aria-label={`${d > 0 ? t.staff.bonus : t.staff.deduct} ${Math.abs(d)}`}
                          onClick={() => void adjustAction.run(tm, d)}
                        >{d > 0 ? `+${d}` : d}</button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ))}
      </section>

      {/* ── Team ↔ HQ chat threads ── */}
      <StaffChatSection ctx={ctx} teams={teams} senderName={staff.name} />

      {/* ── Live photo feed moderation ── */}
      <StaffFeedSection ctx={ctx} />

      {/* ── Announcement composer ── */}
      <AnnouncementComposer ctx={ctx} />
    </div>
  );
}

// Team ↔ HQ chat (change: team-hq-chat): staff see every team's thread (the rules
// grant staff the whole chat collection) and reply as HQ. Threads with new activity
// since this device last opened them show an unread badge (a local per-thread map).
interface ChatThread { teamId: string; messages: ChatMessage[]; updatedAt: string }

function StaffChatSection({
  ctx, teams, senderName,
}: {
  ctx: { ownerUid: string; gameId: string; runId: string };
  teams: TeamRow[];
  senderName: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
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

  function expand(teamId: string, messages: ChatMessage[]) {
    setOpenTeam((cur) => {
      const next = cur === teamId ? null : teamId;
      if (next) markRead(teamId, messages);
      return next;
    });
    setDraft('');
  }

  async function reply(teamId: string) {
    const clean = draft.trim();
    if (!clean) return;
    try {
      await sendTeamChatMessage({ ...ctx, teamId, text: clean, senderName });
      setDraft('');
    } catch { /* the listener reconciles; keep the draft for a retry */ }
  }
  // Guarded so a double-tapped send (or Enter held down) can't post the same reply
  // twice (change: wave-b/async-action-guard).
  const replyAction = useAsyncAction(reply);
  const busy = replyAction.busy;

  const totalUnread = threads.reduce(
    (n, th) => n + (countUnreadChatMessages(th.messages, markerFor(th.teamId), myUid) > 0 ? 1 : 0), 0);

  return (
    <section className="mb-6">
      <Collapsible
        open={open}
        onToggle={() => setOpen((o) => !o)}
        header={(
          <>
            💬 {t.chat.chatTitle}
            {totalUnread > 0 && (
              <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-black">{totalUnread}</span>
            )}
          </>
        )}
      >
        {(
        threads.length === 0
          ? <p className="text-zinc-500 text-sm">{t.chat.chatEmpty}</p>
          : threads.map((th) => {
            const last = th.messages[th.messages.length - 1];
            const unread = countUnreadChatMessages(th.messages, markerFor(th.teamId), myUid) > 0;
            const expanded = openTeam === th.teamId;
            return (
              <Card key={th.teamId} className="p-3 mb-2">
                <button className="w-full text-start" onClick={() => expand(th.teamId, th.messages)}>
                  <div className="flex items-center justify-between gap-2">
                    <div dir="auto" className="text-sm font-medium text-zinc-100 truncate">{nameFor(th.teamId)}</div>
                    {unread && <span className="shrink-0 inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-black">{t.chat.chatUnread}</span>}
                  </div>
                  {last && <div dir="auto" className="text-xs text-zinc-500 truncate mt-0.5">{last.from === 'hq' ? `${t.chat.chatHq}: ` : ''}{last.text}</div>}
                </button>
                {expanded && (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5">
                      {th.messages.map((m) => {
                        // Attribute from THIS staffer's angle: their own replies read
                        // as them (right), another HQ member's as "המטה", the team's
                        // lines as the team name (left). (fix-chat-sender-attribution)
                        const side = chatMessageSide(m, myUid);
                        const hqSide = side !== 'other'; // 'me' or another HQ member
                        const label = side === 'me' ? t.devices.youTag
                          : side === 'hq' ? t.chat.chatHq
                          : m.senderName;
                        return (
                          <div key={m.id} className={`flex flex-col ${hqSide ? 'items-end' : 'items-start'}`}>
                            <span className="text-[11px] text-zinc-500">{label}</span>
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
                        className="flex-1 min-w-0 rounded-full bg-app-raised border border-glass-border px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-accent/50 disabled:opacity-50"
                      />
                      <button
                        onClick={() => void replyAction.run(th.teamId)}
                        disabled={busy || !draft.trim()}
                        className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                      >
                        {t.chat.chatSend}
                      </button>
                    </div>
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
        header={<span>📸 {t.feed.feedTitle}</span>}
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

function AnnouncementComposer({ ctx }: { ctx: { ownerUid: string; gameId: string; runId: string } }) {
  const { t } = useT();
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
      await pushAnnouncement({ ...ctx, ...payload });
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
    <section className="pt-2 border-t border-glass-border">
      <h2 className="text-sm font-semibold text-zinc-300 mb-2">📢 {t.staff.announcement}</h2>
      {/* Hebrew is the primary field (this is a Hebrew-first product and the
          volunteers are Hebrew speakers); English is explicitly optional. */}
      <div className="space-y-2">
        <Input value={msgHe} onChange={(e) => setMsgHe(e.target.value)} placeholder={t.staff.msgHePrimary} dir="rtl" />
        <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t.staff.msgEnOptional} dir="ltr" />
      </div>
      {err && <p role="status" aria-live="polite" className="text-danger text-xs mt-2">⚠ {err}</p>}
      <Button disabled={busy || (!msg.trim() && !msgHe.trim())} loading={busy} onClick={() => void sendAction.run()} className="mt-3">
        {sent ? t.staff.sent : t.staff.broadcast}
      </Button>
    </section>
  );
}
