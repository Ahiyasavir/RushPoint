import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, signInStaff } from '../services/firebase';
import {
  staffSignIn,
  reviewStationSubmission,
  acknowledgeAlert,
  pushAnnouncement,
} from '../services/calls';
import {
  loadStaffSession,
  saveStaffSession,
  clearStaffSession,
  type StaffSession,
} from '../store';
import { Button, Card, Input, Screen } from '../components/ui';

// ── A flattened pending photo submission row (one per team×task) ──
interface PendingSubmission {
  teamId: string;
  displayName: string;
  taskId: string;
  photoUrl: string;
  submittedAt: string;
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

export default function StaffConsole({ onExit }: { onExit: () => void }) {
  const [staff, setStaff] = useState<StaffSession | null>(() => loadStaffSession());

  if (!staff) return <StaffSignIn onSignedIn={setStaff} onExit={onExit} />;
  return <StaffDashboard staff={staff} onSignOut={() => { clearStaffSession(); onExit(); }} />;
}

// ─── Sign-in ────────────────────────────────────────────────────────────────
function StaffSignIn({
  onSignedIn,
  onExit,
}: {
  onSignedIn: (s: StaffSession) => void;
  onExit: () => void;
}) {
  const params = new URLSearchParams(window.location.search);
  const [ownerUid, setOwnerUid] = useState(params.get('owner') ?? '');
  const [gameId, setGameId] = useState(params.get('game') ?? '');
  const [runId, setRunId] = useState(params.get('run') ?? '');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const res = await staffSignIn({ ownerUid: ownerUid.trim(), gameId: gameId.trim(), runId: runId.trim(), pin: pin.trim() });
      await signInStaff(res.customToken);
      const session: StaffSession = {
        ownerUid: ownerUid.trim(), gameId: gameId.trim(), runId: runId.trim(),
        name: res.name, permissions: res.permissions,
      };
      saveStaffSession(session);
      onSignedIn(session);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Sign-in failed');
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <div className="flex-1 flex flex-col justify-center">
        <h1 className="font-brand text-2xl font-extrabold text-accent text-center mb-1">Staff console</h1>
        <p className="text-zinc-500 text-center mb-8 text-sm">Sign in with the PIN from your host</p>
        <div className="space-y-3">
          <Input value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} placeholder="Owner UID" />
          <Input value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="Game ID" />
          <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="Run ID" />
          <Input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="text-center text-xl font-mono tracking-[0.3em]"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {err && <p className="text-danger text-sm text-center mt-3">{err}</p>}
        <Button disabled={busy || !ownerUid || !gameId || !runId || !pin} onClick={submit} className="mt-5">
          Sign in
        </Button>
        <button className="text-zinc-500 text-sm mt-4 mx-auto" onClick={onExit}>← Back to player join</button>
      </div>
    </Screen>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function StaffDashboard({ staff, onSignOut }: { staff: StaffSession; onSignOut: () => void }) {
  const { ownerUid, gameId, runId } = staff;
  const ctx = useMemo(() => ({ ownerUid, gameId, runId }), [ownerUid, gameId, runId]);

  const [pending, setPending] = useState<PendingSubmission[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [readErr, setReadErr] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Live pending photo submissions across all teams in the run.
  useEffect(() => {
    const ref = collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/teams`);
    return onSnapshot(ref, (snap) => {
      const rows: PendingSubmission[] = [];
      snap.forEach((doc) => {
        const t = doc.data() as {
          displayName?: string;
          taskSubmissions?: Record<string, { photoUrl?: string; submittedAt?: string; status?: string }>;
        };
        const subs = t.taskSubmissions ?? {};
        for (const [taskId, sub] of Object.entries(subs)) {
          if (sub?.status === 'pending') {
            rows.push({
              teamId: doc.id,
              displayName: t.displayName ?? doc.id,
              taskId,
              photoUrl: sub.photoUrl ?? '',
              submittedAt: sub.submittedAt ?? '',
            });
          }
        }
      });
      rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
      setPending(rows);
    }, (e) => setReadErr(e.message));
  }, [ownerUid, gameId, runId]);

  // Live unacknowledged SOS / alerts.
  useEffect(() => {
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/alerts`),
      where('acknowledged', '==', false),
    );
    return onSnapshot(ref, (snap) => {
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
      setAlerts(rows);
    }, (e) => setReadErr(e.message));
  }, [ownerUid, gameId, runId]);

  async function review(s: PendingSubmission, approved: boolean) {
    const key = `${s.teamId}:${s.taskId}`;
    setBusyKey(key);
    try {
      await reviewStationSubmission({ ...ctx, teamId: s.teamId, taskId: s.taskId, approved });
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : 'Review failed');
    } finally { setBusyKey(null); }
  }

  async function ack(a: Alert) {
    setBusyKey(a.id);
    try {
      await acknowledgeAlert({ ...ctx, alertId: a.id });
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : 'Acknowledge failed');
    } finally { setBusyKey(null); }
  }

  return (
    <div className="min-h-screen max-w-md mx-auto w-full px-5 py-6 flex flex-col">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-brand text-xl font-extrabold text-accent">Staff</h1>
          <p className="text-zinc-500 text-xs">{staff.name}</p>
        </div>
        <button className="text-zinc-500 text-sm" onClick={onSignOut}>Sign out</button>
      </header>

      {readErr && <p className="text-danger text-xs mb-3">{readErr}</p>}

      {/* ── SOS alerts ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">
          🆘 Alerts {alerts.length > 0 && <span className="text-danger">({alerts.length})</span>}
        </h2>
        {alerts.length === 0
          ? <p className="text-zinc-600 text-sm">No active alerts.</p>
          : alerts.map((a) => (
            <Card key={a.id} className="p-3 mb-2 border-danger/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 uppercase">{a.type}</div>
                  <div className="text-xs text-zinc-500 truncate">team {a.teamId.slice(0, 8)}</div>
                  {a.message && <div className="text-sm text-zinc-300 mt-1">{a.message}</div>}
                  {a.lat != null && a.lng != null && (
                    <a
                      className="text-accent text-xs underline"
                      href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
                      target="_blank" rel="noreferrer"
                    >
                      open location
                    </a>
                  )}
                </div>
                <button
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-app-raised text-zinc-100 text-sm border border-glass-border disabled:opacity-40"
                  disabled={busyKey === a.id}
                  onClick={() => ack(a)}
                >
                  Ack
                </button>
              </div>
            </Card>
          ))}
      </section>

      {/* ── Photo review ── */}
      <section className="mb-6 flex-1">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">
          📷 Photo review {pending.length > 0 && <span className="text-accent">({pending.length})</span>}
        </h2>
        {pending.length === 0
          ? <p className="text-zinc-600 text-sm">No submissions waiting.</p>
          : pending.map((s) => {
            const key = `${s.teamId}:${s.taskId}`;
            const isImage = /^https?:\/\//.test(s.photoUrl);
            return (
              <Card key={key} className="p-3 mb-2">
                <div className="text-sm font-medium text-zinc-100">{s.displayName}</div>
                <div className="text-xs text-zinc-500 mb-2">task {s.taskId.slice(0, 10)}</div>
                {isImage
                  ? <img src={s.photoUrl} alt="submission" className="w-full rounded-lg mb-2 max-h-64 object-cover" />
                  : <div className="text-xs text-zinc-600 italic mb-2 break-all">📎 {s.photoUrl || 'no photo'}</div>}
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 rounded-lg bg-accent text-black font-semibold text-sm disabled:opacity-40"
                    disabled={busyKey === key}
                    onClick={() => review(s, true)}
                  >
                    Approve
                  </button>
                  <button
                    className="flex-1 py-2 rounded-lg bg-danger text-white font-semibold text-sm disabled:opacity-40"
                    disabled={busyKey === key}
                    onClick={() => review(s, false)}
                  >
                    Reject
                  </button>
                </div>
              </Card>
            );
          })}
      </section>

      {/* ── Announcement composer ── */}
      <AnnouncementComposer ctx={ctx} />
    </div>
  );
}

function AnnouncementComposer({ ctx }: { ctx: { ownerUid: string; gameId: string; runId: string } }) {
  const [msg, setMsg] = useState('');
  const [msgHe, setMsgHe] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!msg.trim()) return;
    setBusy(true); setSent(false);
    try {
      await pushAnnouncement({ ...ctx, message: msg.trim(), messageHe: msgHe.trim() || undefined });
      setMsg(''); setMsgHe(''); setSent(true);
      setTimeout(() => setSent(false), 2500);
    } finally { setBusy(false); }
  }

  return (
    <section className="pt-2 border-t border-glass-border">
      <h2 className="text-sm font-semibold text-zinc-300 mb-2">📢 Announcement</h2>
      <div className="space-y-2">
        <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (English)" />
        <Input value={msgHe} onChange={(e) => setMsgHe(e.target.value)} placeholder="הודעה (עברית, רשות)" dir="rtl" />
      </div>
      <Button disabled={busy || !msg.trim()} onClick={send} className="mt-3">
        {sent ? 'Sent ✓' : 'Broadcast to all teams'}
      </Button>
    </section>
  );
}
