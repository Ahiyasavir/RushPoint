import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import QRCode from 'qrcode';
import type { Run } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useAuth } from '../components/AuthGate';
import {
  listRunTeams, startTeams, finalizeRun, refreshLeaderboard, pushAnnouncement, pushFlashMission,
  inviteStaff, skipStage, adjustTeamScore, acknowledgeAlert, type RunTeamRow,
} from '../services/calls';
import { Badge, Button, Card, Input, Label, Spinner } from '../components/ui';
import { dialog } from '../components/dialog';
import LiveTeamMap from '../components/LiveTeamMap';

// Where the participant app lives (for the shareable join link/QR).
const PLAY_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5181`
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? 'https://rushpoint-play.web.app');

export default function RunConsolePage() {
  const { gameId, runId } = useParams();
  const { user } = useAuth();
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
      setAlerts(rows);
    }, () => undefined);
  }, [gameId, runId, ownerUid]);

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

  const ctx = { ownerUid, gameId: gameId!, runId: runId! };

  async function startAll() {
    setBusy(true);
    try { await startTeams({ gameId: gameId!, runId: runId! }); await loadTeams(); }
    finally { setBusy(false); }
  }
  async function finalize() {
    if (!(await dialog.confirm('Finalize the run? This computes the final leaderboard.', 'Finalize'))) return;
    setBusy(true);
    try { await finalizeRun({ gameId: gameId!, runId: runId! }); }
    finally { setBusy(false); }
  }
  async function invite() {
    const name = await dialog.prompt('Staff member name?');
    if (!name) return;
    const { pin } = await inviteStaff({ ...ctx, name, permissions: ['announce', 'review_photos', 'track_locations'] });
    setStaffPin(pin);
  }
  async function refreshStandings(publish?: boolean) {
    setBusy(true);
    try { await refreshLeaderboard({ ...ctx, ...(publish === undefined ? {} : { publish }) }); }
    finally { setBusy(false); }
  }
  async function ack(alertId: string) {
    try { await acknowledgeAlert({ ...ctx, alertId }); } catch { /* listener will reflect state */ }
  }

  if (!run) return <Spinner label="Loading run…" />;

  const finished = run.status === 'finished';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Live Run</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge color={finished ? 'zinc' : 'green'}>{run.status}</Badge>
            {run.billingType && (
              <Badge color={run.billingType === 'pro' ? 'green' : run.billingType === 'credit' ? 'cyan' : 'zinc'}>
                {run.billingType === 'free' ? 'Free run' : run.billingType === 'pro' ? 'Pro' : 'Credit'}
              </Badge>
            )}
            <span className="text-zinc-500 text-sm">
              {run.participantCount ?? teams.length} / {run.maxParticipants ?? '∞'} participants
            </span>
          </div>
        </div>
        <JoinShare accessCode={run.accessCode} />
      </div>

      {/* Live SOS / alerts — the organizer sees these the moment a team raises one */}
      {alerts.length > 0 && (
        <Card className="p-4 border-neon-red/40">
          <div className="text-sm font-medium mb-2 text-neon-red">🆘 Active alerts ({alerts.length})</div>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <span className="uppercase text-neon-red font-medium">{a.type}</span>
                <span className="text-zinc-500 text-xs">team {a.teamId.slice(0, 8)}</span>
                {a.message && <span className="text-zinc-300 flex-1 truncate">{a.message}</span>}
                {a.lat != null && a.lng != null && (
                  <a className="text-neon-green text-xs underline" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">map</a>
                )}
                <Button variant="subtle" className="text-xs ms-auto" onClick={() => ack(a.id)}>Acknowledge</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || finished} onClick={startAll}>Start all teams</Button>
        <Button variant="ghost" disabled={busy || finished} onClick={() => refreshStandings()}>Refresh standings</Button>
        <Button variant="ghost" onClick={invite}>Invite staff (PIN)</Button>
        <Button variant="danger" disabled={busy || finished} onClick={finalize}>Finalize run</Button>
      </div>
      {staffPin && (
        <Card className="p-3 text-sm">
          Staff PIN: <span className="font-mono text-neon-green text-lg tracking-widest">{staffPin}</span>
          <span className="text-zinc-500"> · share with your staff to sign in on the play app.</span>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Teams */}
        <div className="lg:col-span-2">
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">Teams</div>
            {teams.length === 0 ? (
              <p className="text-zinc-500 text-sm">No one has joined yet. Share the access code.</p>
            ) : (
              <div className="space-y-2">
                {teams.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-app-bg">
                    <div className="flex-1">
                      <div className="text-sm text-zinc-200">{t.displayName}</div>
                      <div className="text-[11px] text-zinc-500">
                        {t.finished ? 'finished' : t.launched ? `stage ${(t.activeStageOrder ?? 0) + 1}` : 'waiting'}
                        {' · '}{t.completedStages} done
                      </div>
                    </div>
                    <div className="text-neon-green font-mono font-semibold">{t.score}</div>
                    <button className="text-[11px] text-zinc-400 hover:text-zinc-200"
                      onClick={async () => { await skipStage({ gameId: gameId!, runId: runId!, teamId: t.id }); await loadTeams(); }}>
                      skip
                    </button>
                    <button className="text-[11px] text-zinc-400 hover:text-neon-red"
                      onClick={async () => {
                        const v = await dialog.prompt('Score adjustment (+bonus / -fine):'); if (!v) return;
                        await adjustTeamScore({ ...ctx, teamId: t.id, delta: parseInt(v) || 0, reason: 'manual' }); await loadTeams();
                      }}>
                      ±
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Live team map — where every team is right now, fed by GPS pings. */}
          {!finished && teams.length > 0 && (
            <Card className="p-4 mt-4">
              <div className="text-sm font-medium mb-3">📍 Live team map</div>
              <LiveTeamMap ownerUid={ownerUid} gameId={gameId!} runId={runId!} teams={teams} className="h-80" />
            </Card>
          )}

          {/* Live standings — computed on demand mid-run without ending it. */}
          {!finished && run.leaderboard && run.leaderboard.rankings.length > 0 && (
            <Card className="p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">📊 Live standings</div>
                <button
                  className={`text-[11px] px-2 py-1 rounded-md ${run.leaderboard.published ? 'bg-neon-green/15 text-neon-green' : 'bg-app-raised text-zinc-400'}`}
                  disabled={busy}
                  onClick={() => refreshStandings(!run.leaderboard!.published)}
                >
                  {run.leaderboard.published ? 'Visible to teams ✓' : 'Hidden from teams'}
                </button>
              </div>
              <div className="space-y-1">
                {run.leaderboard.rankings.slice(0, 12).map((r) => (
                  <div key={r.teamId} className="flex items-center gap-3 text-sm">
                    <span className="w-6 text-zinc-500">{r.rank}</span>
                    <span className="flex-1 text-zinc-200">{r.teamName}</span>
                    <span className="text-[11px] text-zinc-500">{r.completedStages} done</span>
                    <span className="text-neon-green font-mono">{r.score}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-zinc-600 mt-2">
                Organizer-only until published. Updated {new Date(run.leaderboard.updatedAt).toLocaleTimeString()}.
              </div>
            </Card>
          )}

          {finished && run.leaderboard && (
            <Card className="p-4 mt-4">
              <div className="text-sm font-medium mb-3">🏁 Final leaderboard</div>
              <div className="space-y-1">
                {run.leaderboard.rankings.map((r) => (
                  <div key={r.teamId} className="flex items-center gap-3 text-sm">
                    <span className="w-6 text-zinc-500">{r.rank}</span>
                    <span className="flex-1 text-zinc-200">{r.teamName}</span>
                    <span className="text-neon-green font-mono">{r.score}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Live-ops */}
        <div className="space-y-4">
          <Broadcast ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

// Access code + shareable join link + QR — participants scan to land in the app
// with the code pre-filled (JoinScreen reads ?code= and auto-looks-up).
function JoinShare({ accessCode }: { accessCode: string }) {
  const link = `${PLAY_URL}/?code=${accessCode}`;
  const boardLink = `${PLAY_URL}/?board=${accessCode}`;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(''));
  }, [link]);
  async function copy(url: string, which: string) {
    try { await navigator.clipboard.writeText(url); setCopied(which); setTimeout(() => setCopied(''), 2000); } catch { /* no clipboard */ }
  }
  return (
    <Card className="px-5 py-4 text-center">
      <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Access code</div>
      <div className="text-2xl font-mono font-bold text-neon-green tracking-[0.3em] mb-2">{accessCode}</div>
      {qr && <img src={qr} alt="Join QR code" className="mx-auto rounded-lg bg-white p-1.5 w-36 h-36" />}
      <div className="mt-2 flex flex-col gap-1">
        <button className="text-xs text-neon-green hover:underline" onClick={() => copy(link, 'join')}>
          {copied === 'join' ? 'Link copied ✓' : 'Copy join link'}
        </button>
        <button className="text-xs text-zinc-400 hover:text-zinc-200 hover:underline" onClick={() => copy(boardLink, 'board')}>
          {copied === 'board' ? 'Link copied ✓' : '🏆 Copy public leaderboard link'}
        </button>
      </div>
    </Card>
  );
}

function Broadcast({ ctx }: { ctx: { ownerUid: string; gameId: string; runId: string } }) {
  const [msg, setMsg] = useState('');
  const [flash, setFlash] = useState('');
  const [pts, setPts] = useState(50);

  return (
    <>
      <Card className="p-4 space-y-2">
        <Label>Announcement (persists)</Label>
        <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Heads up to all teams…" />
        <Button className="w-full" disabled={!msg} onClick={async () => { await pushAnnouncement({ ...ctx, message: msg }); setMsg(''); }}>
          Broadcast
        </Button>
      </Card>
      <Card className="p-4 space-y-2">
        <Label>Flash mission (timed bonus)</Label>
        <Input value={flash} onChange={(e) => setFlash(e.target.value)} placeholder="Bonus mission title" />
        <div className="flex gap-2">
          <Input type="number" value={pts} onChange={(e) => setPts(parseInt(e.target.value) || 0)} />
          <Button disabled={!flash} onClick={async () => { await pushFlashMission({ ...ctx, title: flash, bonusPoints: pts, ttlSeconds: 600 }); setFlash(''); }}>
            Push
          </Button>
        </div>
      </Card>
    </>
  );
}
