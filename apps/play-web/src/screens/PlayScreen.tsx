import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { FIRESTORE_PATHS, computeStreak, beatHasContent, localizedBeatBody, type Trackable, type CaptureZone } from '@rushpoint/shared';
import { getMyTeamState, triggerSOS, updateLocation, getRunTrackables, pickUpTrackable, dropTrackable, getRunZones, captureZone, type MyTeamState, type StageNarrative } from '../services/calls';
import { db, ensureAuth, uid } from '../services/firebase';
import { clearSession, type Session } from '../store';
import { useWakeLock } from '../hooks/useWakeLock';
import { Button, Progress, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { dialog } from '../components/dialog';
import TaskRunner from '../components/TaskRunner';
import TeamDevicesPanel from '../components/TeamDevicesPanel';
import InRunAlerts from '../components/InRunAlerts';
import type { NavTarget } from '../components/NavMap';
// Lazy-loaded so the heavy MapLibre bundle isn't in the initial download — the
// join screen doesn't need it; it loads when the participant starts racing.
const NavMap = lazy(() => import('../components/NavMap'));
import LiveOps from '../components/LiveOps';
import FinalScreen from './FinalScreen';
import { shareStoryCard } from '../lib/storyCard';

// Creator app — viral CTA baked into every shared progress card.
const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

export default function PlayScreen({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const { t, lang } = useT();
  const [state, setState] = useState<MyTeamState | null>(null);
  const [err, setErr] = useState('');
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const timer = useRef<number>();
  const [sharing, setSharing] = useState(false);
  // Whether the team is currently launched/active — read by the geolocation
  // watcher (which mounts once) to decide if it should ping the live map.
  const activeRef = useRef(false);
  // Shared team devices: only the CONTROLLING phone pings the live map, so the
  // team's pin follows whoever is actually playing instead of flickering.
  const controllerRef = useRef(true);
  // Last time we pinged updateLocation, for ~20s client-side throttling.
  const lastPing = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const s = await getMyTeamState({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId });
      setState(s); setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.play.syncFailed);
    }
  }, [session, t]);

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
    });

    // Slow fallback poll keeps the leaderboard fresh (it arrives via the
    // callable, not our team doc) and recovers if the listener can't attach.
    timer.current = window.setInterval(() => { void refresh(); }, 12_000);

    return () => {
      alive = false;
      unsubDoc?.();
      window.clearInterval(timer.current);
    };
  }, [refresh, session]);

  // Track the participant's live position for the navigation map, and report it
  // to the host's live team map (throttled to once per ~20s, only while active).
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        setMe({ lat, lng });
        const now = Date.now();
        if (activeRef.current && controllerRef.current && now - lastPing.current >= 20_000) {
          lastPing.current = now;
          updateLocation({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId, lat, lng })
            .catch(() => undefined);
        }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [session]);

  // Keep the screen awake while actively racing (map open, navigating).
  useWakeLock(!!state && state.team.launched && state.team.status !== 'finished');

  async function leave() {
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
      await dialog.alert(t.play.sosSent);
    } catch {
      await dialog.alert(t.play.sosFailed);
    }
  }

  // Mid-race brag card — same branded story image as the finish screen, but with
  // a "we're racing / we're #N" headline. Every share carries the build-your-own
  // CTA, so an in-progress flex doubles as marketing for the creator app.
  async function shareProgress() {
    if (!state || sharing) return;
    setSharing(true);
    try {
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
      await shareStoryCard({
        gameName: name,
        teamName: team.displayName,
        score: team.score,
        rank,
        stagesDone: `${done}/${game.stageCount}`,
        ctaUrl: CREATOR_URL,
        headline,
        scoreLabel: t.play.pointsSoFar,
      }, text);
    } finally { setSharing(false); }
  }

  if (!state) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          {err ? (
            // A persistent failure (e.g. the run was deleted, or the team pruned
            // → "Team not found") must not trap the participant on a dead screen:
            // offer a retry and a way to leave + clear the stale session.
            <>
              <div className="text-4xl">⚠️</div>
              <p className="text-danger text-sm">{err}</p>
              <div className="flex gap-2 mt-1">
                <Button variant="ghost" onClick={() => void refresh()}>{t.common.tryAgain}</Button>
                <Button variant="ghost" onClick={() => { clearSession(); onLeave(); }}>{t.play.leave}</Button>
              </div>
            </>
          ) : (
            <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          )}
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
  const controllerName = team.devices?.find((d) => d.uid === (team.controllerUid ?? team.id))?.name
    ?? t.devices.deviceFallbackName;
  const hasTeammateDevices = (team.deviceUids?.length ?? 1) > 1 || game.mode === 'team';
  const accent = game.branding?.primaryColor ?? '#F97316';
  const completedStages = team.stages.filter((s) => s.status === 'completed').length;

  if (team.status === 'finished') {
    return <FinalScreen state={state} session={session} onLeave={leave} />;
  }

  if (!team.launched) {
    return (
      <Screen>
        <Header game={game} score={team.score} accent={accent} onLeave={leave} />
        <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id} lang={lang} />
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <div className="text-5xl">⏳</div>
          <h2 dir="auto" className="text-xl font-bold">{t.play.youreIn({ name: team.displayName })}</h2>
          <p className="text-zinc-500">{t.play.waitingStart}</p>
        </div>
        {hasTeammateDevices && myUid && (
          <TeamDevicesPanel team={team} myUid={myUid} ctx={session} onChanged={refresh} />
        )}
        <Button variant="danger" onClick={sos}>SOS</Button>
      </Screen>
    );
  }

  const activeStage = team.stages.find((s) => s.status === 'active');

  // Streak/momentum: consecutive completions across the run, in play order. A
  // skip or a long idle gap resets it (computeStreak). Chip hidden below 2.
  const { streak, milestone } = computeStreak(
    team.stages
      .flatMap((s) => s.tasks)
      .filter((rec) => rec.status === 'completed' || rec.status === 'skipped')
      .map((rec) => ({ status: rec.status, completedAt: rec.completedAt })),
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
          if (content?.locationHidden) return null; // hidden spot — found by clue, no pin
          const coords = content?.smart?.stationCoords ?? content?.coordinates;
          return coords && (coords.lat !== 0 || coords.lng !== 0)
            ? { id: rec.taskId, lat: coords.lat, lng: coords.lng, title: content?.title ?? 'Task', active: rec.status === 'assigned' }
            : null;
        })
        .filter((t): t is NavTarget => t !== null)
    : [];

  return (
    <Screen>
      <StoryInterstitial narratives={state.stageNarratives ?? []} runId={session.runId} lang={lang} />
      <Header game={game} score={team.score} accent={accent} onLeave={leave} />
      <div className="mt-4 mb-2"><Progress done={completedStages} total={game.stageCount} /></div>
      <InRunAlerts hotZone={state.run.hotZone} outOfBounds={team.outOfBounds} />
      {streak >= 2 && (
        <div
          key={milestone ?? streak}
          className={`self-start mb-2 inline-flex items-center rounded-full bg-rp-fire/15 border border-rp-fire/30 px-3 py-1 text-sm font-bold text-rp-fire ${milestone ? 'animate-score-pop motion-reduce:animate-none' : ''}`}
        >
          {t.play.streak({ n: streak })}
        </div>
      )}
      <button onClick={shareProgress} disabled={sharing}
        className="self-end text-xs text-accent/90 hover:text-accent disabled:opacity-50 mb-2">
        {sharing ? t.play.creating : t.play.shareProgress}
      </button>

      <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id} lang={lang} />

      <TrackablesPanel ctx={session} myTeamId={team.id} isController={isController} />

      <ZonesPanel ctx={session} myTeamId={team.id} isController={isController} me={me} />

      {hasTeammateDevices && myUid && (
        <TeamDevicesPanel team={team} myUid={myUid} ctx={session} onChanged={refresh} />
      )}
      {!isController && (
        <div dir="auto" className="mb-3 rounded-lg bg-app-raised border border-glass-border px-3 py-2 text-sm text-zinc-400 flex items-center gap-2">
          👀 {t.devices.viewingBanner({ name: controllerName })}
        </div>
      )}

      {activeStage && (
        <Suspense fallback={<div className="h-52 mb-4 rounded-xl bg-app-card border border-glass-border animate-pulse" />}>
          <NavMap targets={targets} me={me} accent={accent} className="h-52 mb-4" />
        </Suspense>
      )}

      <div className="flex-1">
        {activeStage ? (
          <TaskRunner session={session} state={state} stage={activeStage} onChanged={refresh} readOnly={!isController} />
        ) : state.nextStageReleaseAt && state.nextStageReleaseAt > Date.now() ? (
          <StageDropCountdown releaseAt={state.nextStageReleaseAt} onOpen={refresh} />
        ) : (
          <p className="text-center text-zinc-500 mt-10">{t.play.noActiveStage}</p>
        )}
      </div>

      <Button variant="danger" className="mt-4" onClick={sos}>SOS</Button>
    </Screen>
  );
}

// Scheduled-release (change: scheduled-release): the team finished a chapter but
// the next one is a TIMED DROP. Show a live countdown; when it hits zero, poll so
// the server unlocks the stage and play resumes.
// Narrative chapters (change: narrative-chapters): a full-card story beat shown when a
// chapter opens (intro) or closes (outro). Outro of the most-recently-completed stage
// takes priority so it appears before the next chapter's intro. Dismissal is local
// (localStorage per run+stage+kind) so each beat shows once.
function StoryInterstitial({ narratives, runId, lang }: { narratives: StageNarrative[]; runId: string; lang: 'he' | 'en' }) {
  const { t } = useT();
  const [, bump] = useState(0);
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
  if (!pick) return null;

  const body = localizedBeatBody(pick.beat, lang);
  function dismiss() {
    try { localStorage.setItem(key(pick!.sid, pick!.kind), '1'); } catch { /* private mode */ }
    bump((x) => x + 1);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-5 animate-fade-up">
      <div className="w-full max-w-md rounded-2xl bg-app-card border border-glass-border shadow-task-card overflow-hidden">
        {pick.beat.imageUrl && (
          <img src={pick.beat.imageUrl} alt="" className="w-full max-h-48 object-cover" />
        )}
        <div className="p-5 space-y-3">
          <div className="text-xs font-bold text-accent uppercase tracking-wide">
            {t.play.chapterLabel({ n: pick.order + 1 })}
          </div>
          <h2 className="text-lg font-bold text-zinc-100" dir="auto">{pick.beat.title ?? pick.stageTitle}</h2>
          {body && <p className="text-sm text-zinc-300 whitespace-pre-line" dir="auto">{body}</p>}
          <Button onClick={dismiss} className="w-full">{t.play.storyContinue}</Button>
        </div>
      </div>
    </div>
  );
}

// Trackable collectibles (change: trackable-collectibles): the run's items with their
// holder status; the controller can pick up an unheld item or drop one it carries.
function TrackablesPanel({ ctx, myTeamId, isController }: { ctx: Session; myTeamId: string; isController: boolean }) {
  const { t } = useT();
  const [items, setItems] = useState<Trackable[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getRunTrackables({ ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId });
      setItems(r.trackables);
    } catch { setItems([]); }
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);
  useEffect(() => { void load(); }, [load]);

  async function act(tr: Trackable, action: 'pickup' | 'drop') {
    setBusy(tr.id);
    try {
      const args = { ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId, trackableId: tr.id };
      if (action === 'pickup') await pickUpTrackable(args); else await dropTrackable(args);
      await load();
    } catch { /* surfaced by a no-op; the list reloads */ } finally { setBusy(null); }
  }

  if (!items || items.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl bg-app-card border border-glass-border p-3">
      <div className="text-sm font-bold text-zinc-100 mb-2">🎒 {t.trackables.title}</div>
      <div className="space-y-2">
        {items.map((tr) => {
          const mine = tr.currentHolderTeamId === myTeamId;
          const held = !!tr.currentHolderTeamId;
          return (
            <div key={tr.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-zinc-200" dir="auto">
                {tr.name}
                {mine ? ` · ${t.trackables.carrying}` : held ? ` · ${t.trackables.held}` : ''}
              </span>
              {isController && (mine ? (
                <button disabled={busy === tr.id} onClick={() => act(tr, 'drop')}
                  className="text-xs font-bold px-3 py-1 rounded-full border border-glass-border text-zinc-200 disabled:opacity-40">
                  {t.trackables.drop}
                </button>
              ) : !held && (
                <button disabled={busy === tr.id} onClick={() => act(tr, 'pickup')}
                  className="text-xs font-bold px-3 py-1 rounded-full bg-accent/15 text-accent border border-accent/30 disabled:opacity-40">
                  {t.trackables.pickUp}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Territory capture (change: territory-capture): the run's zones with their current
// owner; a controller standing inside a zone can capture (or flip) it for bonus points.
function ZonesPanel({ ctx, myTeamId, isController, me }: { ctx: Session; myTeamId: string; isController: boolean; me: { lat: number; lng: number } | null }) {
  const { t } = useT();
  const [zones, setZones] = useState<CaptureZone[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getRunZones({ ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId });
      setZones(r.zones);
    } catch { setZones([]); }
  }, [ctx.ownerUid, ctx.gameId, ctx.runId]);
  useEffect(() => { void load(); }, [load]);

  async function capture(z: CaptureZone) {
    if (!me) return;
    setBusy(z.id);
    try {
      await captureZone({ ownerUid: ctx.ownerUid, gameId: ctx.gameId, runId: ctx.runId, zoneId: z.id, lat: me.lat, lng: me.lng });
      await load();
    } catch { /* out of range / already yours — list reloads */ } finally { setBusy(null); }
  }

  if (!zones || zones.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl bg-app-card border border-glass-border p-3">
      <div className="text-sm font-bold text-zinc-100 mb-2">🚩 {t.zones.title}</div>
      <div className="space-y-2">
        {zones.map((z) => {
          const mine = z.ownerTeamId === myTeamId;
          return (
            <div key={z.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-zinc-200" dir="auto">
                {z.title}
                <span className="text-zinc-500"> · {z.ownerTeamId ? (mine ? t.zones.yours : t.zones.heldBy({ name: z.ownerTeamName ?? '' })) : t.zones.open}</span>
              </span>
              {isController && !mine && (
                <button disabled={busy === z.id || !me} onClick={() => capture(z)}
                  className="text-xs font-bold px-3 py-1 rounded-full bg-rp-fire/15 text-rp-fire border border-rp-fire/30 disabled:opacity-40">
                  {t.zones.capture}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;

  return (
    <div dir="auto" className="mt-8 mx-auto max-w-xs text-center rounded-2xl bg-app-card border border-glass-border px-6 py-8 shadow-task-card">
      <div className="text-4xl mb-3">⏳</div>
      <p className="text-sm text-zinc-400 mb-2">{t.play.nextDropTitle}</p>
      <p className="text-3xl font-bold tabular-nums text-accent">{clock}</p>
      <p className="mt-3 text-xs text-zinc-500">{t.play.nextDropHint}</p>
    </div>
  );
}

function Header({ game, score, accent, onLeave }: {
  game: MyTeamState['game']; score: number; accent: string; onLeave: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between">
      <div>
        <div dir="auto" className="font-brand font-extrabold text-lg" style={{ color: accent }}>
          {game.branding?.name ?? game.title}
        </div>
        <div className="text-xs text-zinc-500">{t.play.score}: <span className="text-accent font-mono">{score}</span></div>
      </div>
      <button onClick={onLeave} className="text-xs text-zinc-500">{t.play.leave}</button>
    </div>
  );
}
