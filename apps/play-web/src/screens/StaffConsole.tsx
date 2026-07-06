import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, signInStaff } from '../services/firebase';
import {
  staffSignIn,
  reviewStationSubmission,
  acknowledgeAlert,
  pushAnnouncement,
  adjustTeamScore,
} from '../services/calls';
import {
  loadStaffSession,
  saveStaffSession,
  clearStaffSession,
  type StaffSession,
} from '../store';
import { Button, Card, Input, Screen } from '../components/ui';
import { useT } from '../i18nContext';

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

// ── A team row for the manual bonus/deduction panel ──
interface TeamRow {
  id: string;
  displayName: string;
  score: number;
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
  const { t } = useT();
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
      setErr(e instanceof Error ? e.message.replace('Firebase: ', '') : t.staff.signInFailed);
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <div className="flex-1 flex flex-col justify-center">
        <h1 className="font-brand text-2xl font-extrabold text-accent text-center mb-1">{t.staff.consoleTitle}</h1>
        <p className="text-zinc-500 text-center mb-8 text-sm">{t.staff.signInSub}</p>
        <div className="space-y-3">
          <Input value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} placeholder={t.staff.ownerUid} />
          <Input value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder={t.staff.gameId} />
          <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder={t.staff.runId} />
          <Input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={t.staff.pin}
            className="text-center text-xl font-mono tracking-[0.3em]"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {err && <p className="text-danger text-sm text-center mt-3">{err}</p>}
        <Button disabled={busy || !ownerUid || !gameId || !runId || !pin} onClick={submit} className="mt-5">
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
  const [readErr, setReadErr] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Live pending photo submissions + team scores across all teams in the run.
  // One snapshot feeds both the photo-review queue and the manual bonus panel.
  useEffect(() => {
    const ref = collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/teams`);
    return onSnapshot(ref, (snap) => {
      const rows: PendingSubmission[] = [];
      const teamRows: TeamRow[] = [];
      snap.forEach((doc) => {
        const td = doc.data() as {
          displayName?: string;
          score?: number;
          taskSubmissions?: Record<string, { photoUrl?: string; submittedAt?: string; status?: string }>;
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
      setReadErr(e instanceof Error ? e.message : t.staff.reviewFailed);
    } finally { setBusyKey(null); }
  }

  async function ack(a: Alert) {
    setBusyKey(a.id);
    try {
      await acknowledgeAlert({ ...ctx, alertId: a.id });
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : t.staff.ackFailed);
    } finally { setBusyKey(null); }
  }

  // Manual bonus / deduction. Positive delta = bonus, negative = fine. The team
  // score updates live via the open snapshot; no manual refresh needed.
  async function adjust(team: TeamRow, delta: number) {
    setBusyKey(team.id);
    try {
      await adjustTeamScore({ ...ctx, teamId: team.id, delta, reason: 'staff' });
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : t.staff.adjustFailed);
    } finally { setBusyKey(null); }
  }


  return (
    <div className="min-h-screen max-w-md mx-auto w-full px-5 py-6 flex flex-col">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-brand text-xl font-extrabold text-accent">{t.staff.title}</h1>
          <p className="text-zinc-500 text-xs">{staff.name}</p>
        </div>
        <button className="text-zinc-500 text-sm" onClick={onSignOut}>{t.staff.signOut}</button>
      </header>

      {readErr && <p className="text-danger text-xs mb-3">{readErr}</p>}

      {/* ── SOS alerts ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">
          🆘 {t.staff.alerts} {alerts.length > 0 && <span className="text-danger">({alerts.length})</span>}
        </h2>
        {alerts.length === 0
          ? <p className="text-zinc-600 text-sm">{t.staff.noAlerts}</p>
          : alerts.map((a) => (
            <Card key={a.id} className="p-3 mb-2 border-danger/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 uppercase">{a.type}</div>
                  <div className="text-xs text-zinc-500 truncate">{t.staff.teamLabel} {a.teamId.slice(0, 8)}</div>
                  {a.message && <div dir="auto" className="text-sm text-zinc-300 mt-1">{a.message}</div>}
                  {a.lat != null && a.lng != null && (
                    <a
                      className="text-accent text-xs underline"
                      href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
                      target="_blank" rel="noreferrer"
                    >
                      {t.staff.openLocation}
                    </a>
                  )}
                </div>
                <button
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-app-raised text-zinc-100 text-sm border border-glass-border disabled:opacity-40"
                  disabled={busyKey === a.id}
                  onClick={() => ack(a)}
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
          📷 {t.staff.photoReview} {pending.length > 0 && <span className="text-accent">({pending.length})</span>}
        </h2>
        {pending.length === 0
          ? <p className="text-zinc-600 text-sm">{t.staff.noSubmissions}</p>
          : pending.map((s) => {
            const key = `${s.teamId}:${s.taskId}`;
            const isImage = /^https?:\/\//.test(s.photoUrl);
            return (
              <Card key={key} className="p-3 mb-2">
                <div dir="auto" className="text-sm font-medium text-zinc-100">{s.displayName}</div>
                <div className="text-xs text-zinc-500 mb-2">{t.staff.taskLabel} {s.taskId.slice(0, 10)}</div>
                {isImage
                  ? <img src={s.photoUrl} alt={t.staff.submissionAlt} className="w-full rounded-lg mb-2 max-h-64 object-cover" />
                  : <div className="text-xs text-zinc-600 italic mb-2 break-all">📎 {s.photoUrl || t.staff.noPhoto}</div>}
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 rounded-lg bg-accent text-black font-semibold text-sm disabled:opacity-40"
                    disabled={busyKey === key}
                    onClick={() => review(s, true)}
                  >
                    {t.staff.approve}
                  </button>
                  <button
                    className="flex-1 py-2 rounded-lg bg-danger text-white font-semibold text-sm disabled:opacity-40"
                    disabled={busyKey === key}
                    onClick={() => review(s, false)}
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
          ? <p className="text-zinc-600 text-sm">{t.staff.noTeams}</p>
          : teams.map((tm) => (
            <Card key={tm.id} className="p-3 mb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div dir="auto" className="text-sm font-medium text-zinc-100 truncate">{tm.displayName}</div>
                  <div className="text-xs text-zinc-500">{t.staff.scoreLabel} {tm.score}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {[-10, -5, 5, 10].map((d) => (
                    <button
                      key={d}
                      className={`w-9 h-9 rounded-lg text-sm font-bold border disabled:opacity-40 ${
                        d > 0 ? 'bg-accent/15 text-accent border-accent/30' : 'bg-app-raised text-zinc-200 border-glass-border'
                      }`}
                      disabled={busyKey === tm.id}
                      aria-label={`${d > 0 ? t.staff.bonus : t.staff.deduct} ${Math.abs(d)}`}
                      onClick={() => adjust(tm, d)}
                    >{d > 0 ? `+${d}` : d}</button>
                  ))}
                </div>
              </div>
            </Card>
          ))}
      </section>

      {/* ── Announcement composer ── */}
      <AnnouncementComposer ctx={ctx} />
    </div>
  );
}

function AnnouncementComposer({ ctx }: { ctx: { ownerUid: string; gameId: string; runId: string } }) {
  const { t } = useT();
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
      <h2 className="text-sm font-semibold text-zinc-300 mb-2">📢 {t.staff.announcement}</h2>
      <div className="space-y-2">
        <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t.staff.msgEn} />
        <Input value={msgHe} onChange={(e) => setMsgHe(e.target.value)} placeholder={t.staff.msgHe} dir="rtl" />
      </div>
      <Button disabled={busy || !msg.trim()} onClick={send} className="mt-3">
        {sent ? t.staff.sent : t.staff.broadcast}
      </Button>
    </section>
  );
}
