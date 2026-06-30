import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import QRCode from 'qrcode';
import type { Run, HotZone } from '@rushpoint/shared';
import { TV_ROUTE_PARAM, RECAP_ROUTE_PARAM, hotZoneMultiplier } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useAuth } from '../components/AuthGate';
import {
  listRunTeams, startTeams, finalizeRun, refreshLeaderboard, pushAnnouncement, pushFlashMission,
  inviteStaff, skipStage, adjustTeamScore, acknowledgeAlert, activateHotZone, deactivateHotZone,
  getRunAnalytics, type RunTeamRow, type RunAnalyticsResult,
} from '../services/calls';
import { Badge, Button, Card, Input, Label, Spinner } from '../components/ui';
import { dialog } from '../components/dialog';
import { useT } from '../components/LanguageContext';
import LiveTeamMap from '../components/LiveTeamMap';

// Where the participant app lives (for the shareable join link/QR).
const PLAY_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5181`
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
    if (!(await dialog.confirm(t.runConsole.finalizeConfirmMessage, t.runConsole.finalizeConfirmTitle))) return;
    setBusy(true);
    try { await finalizeRun({ gameId: gameId!, runId: runId! }); }
    finally { setBusy(false); }
  }
  async function invite() {
    const name = await dialog.prompt(t.runConsole.staffNamePrompt);
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

  if (!run) return <Spinner label={t.runConsole.loadingRun} />;

  const finished = run.status === 'finished';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.runConsole.liveRun}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge color={finished ? 'zinc' : 'green'}>{run.status}</Badge>
            {run.billingType && (
              <Badge color={run.billingType === 'pro' ? 'green' : run.billingType === 'credit' ? 'cyan' : 'zinc'}>
                {run.billingType === 'free' ? t.runConsole.freeRun : run.billingType === 'pro' ? t.runConsole.proRun : t.runConsole.creditRun}
              </Badge>
            )}
            <span className="text-zinc-500 text-sm">
              {t.runConsole.participants({ n: run.participantCount ?? teams.length, max: String(run.maxParticipants ?? '∞') })}
            </span>
          </div>
        </div>
        <JoinShare accessCode={run.accessCode} />
      </div>

      {/* Live SOS / alerts — the organizer sees these the moment a team raises one */}
      {alerts.length > 0 && (
        <Card className="p-4 border-neon-red/40">
          <div className="text-sm font-medium mb-2 text-neon-red">{t.runConsole.activeAlerts({ n: alerts.length })}</div>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <span className="uppercase text-neon-red font-medium">{a.type}</span>
                <span className="text-zinc-500 text-xs">{t.runConsole.team({ id: a.teamId.slice(0, 8) })}</span>
                {a.message && <span className="text-zinc-300 flex-1 truncate">{a.message}</span>}
                {a.lat != null && a.lng != null && (
                  <a className="text-neon-green text-xs underline" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">{t.runConsole.map}</a>
                )}
                <Button variant="subtle" className="text-xs ms-auto" onClick={() => ack(a.id)}>{t.runConsole.acknowledge}</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || finished} onClick={startAll}>{t.runConsole.startAllTeams}</Button>
        <Button variant="ghost" disabled={busy || finished} onClick={() => refreshStandings()}>{t.runConsole.refreshStandings}</Button>
        <Button variant="ghost" onClick={invite}>{t.runConsole.inviteStaffPin}</Button>
        <Button variant="danger" disabled={busy || finished} onClick={finalize}>{t.runConsole.finalizeRun}</Button>
      </div>
      {staffPin && (
        <Card className="p-3 text-sm">
          {t.runConsole.staffPinLabel} <span className="font-mono text-neon-green text-lg tracking-widest">{staffPin}</span>
          <span className="text-zinc-500"> {t.runConsole.staffPinShareNote}</span>
        </Card>
      )}

      {/* Live-ops + post-run organizer tools (deferred-UI wiring) */}
      <div className="grid md:grid-cols-2 gap-5">
        {!finished && <HotZonePanel ctx={ctx} hotZone={run.hotZone ?? null} />}
        <PostRunLinks accessCode={run.accessCode} finished={finished} />
      </div>
      {finished && <AnalyticsPanel accessCode={run.accessCode} />}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Teams */}
        <div className="lg:col-span-2">
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">{t.runConsole.teamsTitle}</div>
            {teams.length === 0 ? (
              <p className="text-zinc-500 text-sm">{t.runConsole.noOneJoinedYet}</p>
            ) : (
              <div className="space-y-2">
                {teams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3 p-2 rounded-lg bg-app-bg">
                    <div className="flex-1">
                      <div className="text-sm text-zinc-200">{team.displayName}</div>
                      <div className="text-[11px] text-zinc-500">
                        {team.finished ? 'finished' : team.launched ? `stage ${(team.activeStageOrder ?? 0) + 1}` : 'waiting'}
                        {' · '}{t.runConsole.stageDone({ n: team.completedStages })}
                      </div>
                    </div>
                    <div className="text-neon-green font-mono font-semibold">{team.score}</div>
                    <button className="text-[11px] text-zinc-400 hover:text-zinc-200"
                      onClick={async () => { await skipStage({ gameId: gameId!, runId: runId!, teamId: team.id }); await loadTeams(); }}>
                      {t.runConsole.skip}
                    </button>
                    <button className="text-[11px] text-zinc-400 hover:text-neon-red"
                      onClick={async () => {
                        const v = await dialog.prompt(t.runConsole.scoreAdjustmentPrompt); if (!v) return;
                        await adjustTeamScore({ ...ctx, teamId: team.id, delta: parseInt(v) || 0, reason: 'manual' }); await loadTeams();
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
              <div className="text-sm font-medium mb-3">{t.runConsole.liveTeamMap}</div>
              <LiveTeamMap ownerUid={ownerUid} gameId={gameId!} runId={runId!} teams={teams} className="h-80" />
            </Card>
          )}

          {/* Live standings — computed on demand mid-run without ending it. */}
          {!finished && run.leaderboard && run.leaderboard.rankings.length > 0 && (
            <Card className="p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">{t.runConsole.liveStandings}</div>
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
                    <span className="text-[11px] text-zinc-500">{t.runConsole.stageDone({ n: r.completedStages })}</span>
                    <span className="text-neon-green font-mono">{r.score}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-zinc-600 mt-2">
                {t.runConsole.organizerOnlyUpdated({ time: new Date(run.leaderboard.updatedAt).toLocaleTimeString() })}
              </div>
            </Card>
          )}

          {finished && run.leaderboard && (
            <Card className="p-4 mt-4">
              <div className="text-sm font-medium mb-3">{t.runConsole.finalLeaderboard}</div>
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
  const t = useT();
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
      <div className="text-[11px] text-zinc-500 uppercase tracking-widest">{t.runConsole.accessCode}</div>
      <div className="text-2xl font-mono font-bold text-neon-green tracking-[0.3em] mb-2">{accessCode}</div>
      {qr && <img src={qr} alt={t.runConsole.joinQrCode} className="mx-auto rounded-lg bg-white p-1.5 w-36 h-36" />}
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
  const t = useT();
  const [msg, setMsg] = useState('');
  const [flash, setFlash] = useState('');
  const [pts, setPts] = useState(50);

  return (
    <>
      <Card className="p-4 space-y-2">
        <Label>{t.runConsole.announcementPersists}</Label>
        <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t.runConsole.announcementPlaceholder} />
        <Button className="w-full" disabled={!msg} onClick={async () => { await pushAnnouncement({ ...ctx, message: msg }); setMsg(''); }}>
          {t.runConsole.broadcast}
        </Button>
      </Card>
      <Card className="p-4 space-y-2">
        <Label>{t.runConsole.flashMissionTitle}</Label>
        <Input value={flash} onChange={(e) => setFlash(e.target.value)} placeholder={t.runConsole.flashMissionPlaceholder} />
        <div className="flex gap-2">
          <Input type="number" value={pts} onChange={(e) => setPts(parseInt(e.target.value) || 0)} />
          <Button disabled={!flash} onClick={async () => { await pushFlashMission({ ...ctx, title: flash, bonusPoints: pts, ttlSeconds: 600 }); setFlash(''); }}>
            {t.runConsole.push}
          </Button>
        </div>
      </Card>
    </>
  );
}


// ── Hot Zone activate panel (hot-zone-bonus) ──────────────────────────────────
function HotZonePanel({ ctx, hotZone }: { ctx: { ownerUid: string; gameId: string; runId: string }; hotZone: HotZone | null }) {
  const t = useT();
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState(200);
  const [mult, setMult] = useState(2);
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);

  const active = !!hotZone && hotZoneMultiplier(hotZone, hotZone.center, Date.now()) > 1;

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(5)); setLng(p.coords.longitude.toFixed(5)); },
      () => dialog.alert(t.runConsole.hotZoneNeedsCenter),
    );
  }

  async function activate() {
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) { void dialog.alert(t.runConsole.hotZoneNeedsCenter); return; }
    setBusy(true);
    try {
      await activateHotZone({ gameId: ctx.gameId, runId: ctx.runId, center: { lat: la, lng: ln }, radiusMeters: radius, multiplier: mult, durationMinutes: minutes });
    } finally { setBusy(false); }
  }
  async function deactivate() {
    setBusy(true);
    try { await deactivateHotZone({ gameId: ctx.gameId, runId: ctx.runId }); } finally { setBusy(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm font-semibold">{t.runConsole.hotZoneTitle}</div>
      {active && hotZone ? (
        <div className="space-y-2 text-sm">
          <div className="text-neon-green font-medium">{t.runConsole.hotZoneActive({ mult: hotZone.multiplier })}</div>
          <div className="text-zinc-500">{t.runConsole.hotZoneExpires({ time: new Date(hotZone.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</div>
          <Button variant="danger" disabled={busy} onClick={deactivate}>{t.runConsole.deactivate}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>{t.runConsole.hotZoneCenter}</Label>
          <div className="flex gap-2">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="31.79" inputMode="decimal" />
            <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="35.16" inputMode="decimal" />
            <Button variant="ghost" type="button" onClick={useMyLocation}>{t.runConsole.hotZoneUseLocation}</Button>
          </div>
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

// ── Post-run shareable links (tv-leaderboard / run-recap) ─────────────────────
function PostRunLinks({ accessCode, finished }: { accessCode: string; finished: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState('');
  const tvUrl = `${PLAY_URL}/?${TV_ROUTE_PARAM}=${accessCode}`;
  const recapUrl = `${PLAY_URL}/?${RECAP_ROUTE_PARAM}=${accessCode}`;

  async function copy(url: string, which: string) {
    try { await navigator.clipboard.writeText(url); setCopied(which); setTimeout(() => setCopied(''), 2000); } catch { window.open(url, '_blank'); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm font-semibold">{t.runConsole.postRunTitle}</div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => window.open(tvUrl, '_blank')}>{t.runConsole.tvScreen}</Button>
        <Button variant="ghost" onClick={() => copy(tvUrl, 'tv')}>{copied === 'tv' ? t.runConsole.linkCopied : '🔗'}</Button>
        {finished && (
          <>
            <Button variant="ghost" onClick={() => window.open(recapUrl, '_blank')}>{t.runConsole.shareRecap}</Button>
            <Button variant="ghost" onClick={() => copy(recapUrl, 'recap')}>{copied === 'recap' ? t.runConsole.linkCopied : '🔗'}</Button>
          </>
        )}
      </div>
    </Card>
  );
}


// ── Post-run per-task analytics (run-analytics-heatmap) ───────────────────────
const TYPE_EMOJI: Record<string, string> = {
  smart_station: '🔑', photo: '📸', quiz: '❓', numeric: '🔢',
  field: '✅', self_report: '🙋', geofence: '📡', sequence: '📋',
};
function fmtMs(ms: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
function AnalyticsPanel({ accessCode }: { accessCode: string }) {
  const t = useT();
  const [data, setData] = useState<RunAnalyticsResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try { setData(await getRunAnalytics({ code: accessCode })); } finally { setBusy(false); }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{t.runConsole.analyticsTitle}</div>
        {!data && <Button variant="ghost" disabled={busy} onClick={load}>{t.runConsole.analyticsLoad}</Button>}
      </div>
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
                      <td className="py-1.5">{TYPE_EMOJI[task.type] ?? '•'} {task.type}</td>
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
