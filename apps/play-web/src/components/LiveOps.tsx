import { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { announcementVisibleTo, routeNoticeStillCurrent, newestRouteNoticeId, formatScoreNotice, flashMissionState, flashMyClaimLine, type RunLeaderboard, type FlashClaimStatus } from '@rushpoint/shared';
import { listenWithRetry } from '../lib/liveListen';
import { claimFlashMission } from '../services/calls';
import { feedback } from '../lib/sound';
import { db } from '../services/firebase';
import { translations } from '../i18n';
import { haptic } from '../lib/haptics';
import { boardTimeSeconds, formatDuration } from '../lib/boardTime';
import { TAP_INLINE } from '../lib/interaction';
import { loadDismissed, saveDismissed } from '../lib/dismissedAnnouncements';
import { Collapsible } from './ui';
import { Icon } from './Icon';

interface Ctx { ownerUid: string; gameId: string; runId: string }

// Score notices (kind:'score') auto-hide once older than this so a stale bonus
// doesn't pile up on late joiners; global announcements persist until dismissed.
const SCORE_NOTICE_TTL_MS = 10 * 60 * 1000;

// COST BOUND (why, not what): Firestore reads cannot be hard-capped on Blaze, so
// an unbounded onSnapshot over a collection that grows all run long is the
// uncapped billing tail — and these two are on EVERY participant's screen, so the
// cost is per-phone. Both are already recency-only by construction: an
// announcement is a banner the player dismisses, a score notice self-expires
// after SCORE_NOTICE_TTL_MS (10 min), and a flash mission is filtered out the
// moment `expiresAt` passes. Nothing older than the newest few dozen docs can
// ever reach the screen, so the windows below cost nothing visible while making
// the read cost of a 4-hour run flat instead of linear.
//   30 announcements: a run pushes a handful of global banners plus per-team
//   score notices; 30 covers a burst of adjustments and still can't starve a
//   global broadcast, which is always among the newest.
//   20 flash missions: they are short-TTL by design, so more than a handful can
//   be live at once only if staff spam them — and only unexpired ones render.
// The orderBy is load-bearing, NOT cosmetic: these docs carry Firestore auto-IDs,
// so a bare limit() orders by __name__ and returns an ARBITRARY subset — it could
// silently drop the announcement pushed one second ago. `createdAt` is the ISO
// string stamped by pushAnnouncement / pushFlashMission / adjustTeamScore
// (functions/src/index.ts).
// ⚠ DEPLOY ORDER: equality + orderBy needs the composite indexes in
// firestore.indexes.json, and the EMULATOR AUTO-INDEXES so a missing one is
// invisible in dev and fails only in production. Indexes must ship BEFORE this
// code: `deploy:all` is safe (deploy:backend runs before deploy:hosting), a
// hosting-only deploy against a project without them is not.
const ANNOUNCEMENT_WINDOW = 30;
const FLASH_WINDOW = 20;

interface AnnouncementDoc {
  id: string; message: string; messageHe?: string; active: boolean; createdAt?: string;
  // Targeted announcements (change: targeted-announcements).
  teamId?: string; kind?: 'announcement' | 'score' | 'forceAssign'; delta?: number; reason?: string;
  /** A route notice's mission ("the staff sent you to X"). */
  taskId?: string;
}
interface FlashDoc { id: string; title: string; titleHe?: string; description?: string; descriptionHe?: string; bonusPoints?: number; expiresAt: string; isActive: boolean;
  // flash-missions-v2: a mission teams can take. Absent on an announcement (and every pre-v2 one).
  claimMode?: 'first' | 'many'; doneBy?: 'announce' | 'button' | 'photo' | 'video'; takenBy?: string | null }

// Non-blocking live-ops banners + a collapsible leaderboard peek. Rendered above
// the map/task card so it never covers the active mission UI.
export default function LiveOps({
  ctx, leaderboard, myTeamId, lang = 'en', timeOnly = false, showBoard = true, teamFlashId = null, myFlashClaims = null, onFlashClaimed,
  activeTaskId = null,
}: {
  /** The team's current mission: a "the staff sent you to X" notice shows only while X is current. */
  activeTaskId?: string | null;
  ctx: Ctx;
  leaderboard: RunLeaderboard | null;
  myTeamId: string;
  lang?: 'en' | 'he';
  /**
   * Render the leaderboard peek inline (change: play-card-simplification).
   * FALSE on the racing screen, where the board moved into the "more" drawer and
   * this component is kept at the TOP for one reason: announcements and flash
   * missions are the organizer talking to the team mid-race, and they used to sit
   * BELOW the mission card with the other secondary panels — i.e. below the fold
   * on a phone. Splitting the two means the urgent half can be promoted without
   * dragging a leaderboard up with it. Defaults to true so every other caller is
   * unchanged.
   */
  showBoard?: boolean;
  /** flash-missions-v2: the flash mission this team is out on, if any (team.flashSuspension). */
  teamFlashId?: string | null;
  /** flash-missions-v2: after a successful "לקחתי", so the screen refreshes into the flash card. */
  onFlashClaimed?: () => void;
  /** flash-missions-v2 D6: this team's own claims (team.flashClaims), keyed by flash mission. */
  myFlashClaims?: Record<string, { status: FlashClaimStatus; retryAllowed?: boolean; reviewedAt?: string } | null | undefined> | null;
  // time_only runs never award points, so the peek must show each team's time,
  // not a column of zeros (mirrors the finish/TV/public boards).
  timeOnly?: boolean;
}) {
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);
  const [flashes, setFlashes] = useState<FlashDoc[]>([]);
  // Dismissed banners persist to run-scoped localStorage so a persistent GLOBAL
  // announcement (server still `active`) stays dismissed across reloads/reconnects
  // — same pattern as FeedPanel's per-run mutes; fails open if storage is absent.
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(ctx.runId));
  const [now, setNow] = useState(() => Date.now());

  const { ownerUid, gameId, runId } = ctx;

  useEffect(() => {
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/announcements`),
      where('active', '==', true),
      // Newest-first (see the ANNOUNCEMENT_WINDOW note above). The render below
      // preserves this order, so the freshest banner sits at the top of the
      // stack where the player looks — previously the order was __name__, i.e.
      // effectively random, so this is a fix as well as a bound.
      orderBy('createdAt', 'desc'),
      limit(ANNOUNCEMENT_WINDOW),
    );
    // Through listenWithRetry (issue 27): Firestore drops a listener on its first error, and this
    // effect never re-runs mid-race, so a silent handler meant no broadcast for the rest of the run.
    return listenWithRetry('announcements', (h) => onSnapshot(ref, (snap) => {
      h.healthy();
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AnnouncementDoc, 'id'>) })));
    }, h.failed));
  }, [ownerUid, gameId, runId]);

  useEffect(() => {
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/flashMissions`),
      where('isActive', '==', true),
      // Newest-first, bounded (see FLASH_WINDOW above). Expiry is still decided
      // in the render filter against `expiresAt`, never by this ordering.
      orderBy('createdAt', 'desc'),
      limit(FLASH_WINDOW),
    );
    return listenWithRetry('flashMissions', (h) => onSnapshot(ref, (snap) => {
      h.healthy();
      setFlashes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FlashDoc, 'id'>) })));
    }, h.failed));
  }, [ownerUid, gameId, runId]);

  // Tick so flash-mission countdowns expire on their own.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const liveFlashes = flashes.filter((f) => new Date(f.expiresAt).getTime() > now && !dismissed.has(f.id));

  // flash-missions-v2: a NEW flash mission arrives as an event: a full-screen moment with a sound
  // and (on Android) a buzz, once per flash mission per phone, then the banner below.
  const [moment, setMoment] = useState<FlashDoc | null>(null);
  const seenFlashes = useRef<Set<string> | null>(null);
  useEffect(() => {
    const key = `rp.flashSeen.${runId}`;
    if (!seenFlashes.current) {
      try { seenFlashes.current = new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]); }
      catch { seenFlashes.current = new Set(); }
    }
    const fresh = liveFlashes.find((f) => !seenFlashes.current!.has(f.id));
    if (!fresh) return;
    seenFlashes.current.add(fresh.id);
    try { localStorage.setItem(key, JSON.stringify([...seenFlashes.current].slice(-50))); } catch { /* memory only */ }
    setMoment(fresh);
    feedback('alert');
    try { navigator.vibrate?.([80, 60, 80, 60, 160]); } catch { /* iOS has none */ }
    const id = window.setTimeout(() => setMoment(null), 3200);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFlashes.map((f) => f.id).join(','), runId]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  async function claim(f: FlashDoc) {
    if (claiming) return;
    setClaiming(f.id);
    setClaimMsg(null);
    try { await claimFlashMission({ ownerUid, gameId, runId, flashId: f.id }); setMoment(null); onFlashClaimed?.(); }
    catch (e) {
      const m = String((e as Error)?.message);
      setClaimMsg(/FLASH_TAKEN/.test(m) ? translations[lang].flash.takenByOther
        : /FLASH_REJECTED/.test(m) ? translations[lang].flash.myRejectedClosed
        : translations[lang].flash.claimFailed);
    }
    finally { setClaiming(null); }
  }

  // flash-reject-choice (issue 26, Ahiya 2026-10-06): a rejected sending used to change one small
  // line inside the banner, so the team was "told nothing". It is now an EVENT: once per rejection
  // per phone (keyed on reviewedAt), a notice says so and, when the organizers gave another try,
  // offers it right there.
  const [rejectNotice, setRejectNotice] = useState<{ flash: FlashDoc; retry: boolean } | null>(null);
  const rejectKey = Object.entries(myFlashClaims ?? {})
    .filter(([, c]) => c?.status === 'rejected')
    .map(([id, c]) => `${id}@${c?.reviewedAt ?? ''}`).sort().join(',');
  useEffect(() => {
    if (!rejectKey) return;
    const key = `rp.flashRejectSeen.${runId}`;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; } catch { /* memory only */ }
    const fresh = rejectKey.split(',').find((k) => !seen.includes(k));
    if (!fresh) return;
    try { localStorage.setItem(key, JSON.stringify([...seen, fresh].slice(-50))); } catch { /* memory only */ }
    const flashId = fresh.split('@')[0];
    const f = flashes.find((x) => x.id === flashId);
    if (!f) return;
    setRejectNotice({ flash: f, retry: myFlashClaims?.[flashId]?.retryAllowed === true });
    feedback('alert');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rejectKey, flashes.length, runId]);
  // Targeted announcements: only show a doc that is global or addressed to my team
  // (client-side courtesy filter — the field is not secret). Score notices also
  // auto-hide once older than SCORE_NOTICE_TTL_MS.
  // Only the newest route notice for this team (two routes to one mission left two identical ones).
  const newestRoute = newestRouteNoticeId(announcements.filter((a) => announcementVisibleTo(a, myTeamId)));
  const liveAnnouncements = announcements.filter((a) => {
    if (dismissed.has(a.id)) return false;
    if (!announcementVisibleTo(a, myTeamId)) return false;
    if (!routeNoticeStillCurrent(a, activeTaskId)) return false;
    if (a.kind === 'forceAssign' && a.id !== newestRoute) return false;
    if (a.kind === 'score' && a.createdAt && now - new Date(a.createdAt).getTime() > SCORE_NOTICE_TTL_MS) return false;
    return true;
  });

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      saveDismissed(runId, next);
      return next;
    });
  }

  // Haptic buzz when a NEW score notice arrives — success for a gain, warn for a
  // penalty. The backlog present on first mount is seeded silently (no buzz), so
  // late joiners aren't spammed; only genuinely-new notices vibrate, once each.
  // Announcements load ASYNC (Firestore snapshot), so a "first effect run" latch
  // would trip on the still-empty list and then buzz the whole backlog once it
  // arrives. Gate on the notice's own createdAt vs. our mount time instead: any
  // notice authored before we mounted is pre-existing and seeded silently.
  const seenScore = useRef<Set<string>>(new Set());
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    for (const a of liveAnnouncements) {
      if (a.kind !== 'score') continue;
      if (seenScore.current.has(a.id)) continue;
      seenScore.current.add(a.id);
      const createdMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      if (createdMs > mountedAt.current) haptic((a.delta ?? 0) >= 0 ? 'success' : 'warn');
    }
  }, [liveAnnouncements]);

  const hasBanners = liveAnnouncements.length > 0 || liveFlashes.length > 0;
  // Standings are only shown to participants once the organizer publishes them
  // (the reveal is staged); organizers see live standings on their own console.
  const hasBoard = !!leaderboard?.published && (leaderboard.rankings?.length ?? 0) > 0;
  // With the board delegated to the drawer, a run with no banners renders nothing
  // at all here rather than an empty bordered shell.
  if (!hasBanners && !(hasBoard && showBoard)) return null;

  return (
    <div className="space-y-2 mb-3">
      {liveAnnouncements.map((a) => {
        // Score notice (change: targeted-announcements): a distinct toast-style banner
        // with a sign-aware mono delta + reason. Falls back to the stored bilingual
        // message; recomputes locally if the delta is present but the message is not.
        if (a.kind === 'score') {
          const positive = (a.delta ?? 0) >= 0;
          const label = positive
            ? translations[lang].liveOps.scoreBonusToast
            : translations[lang].liveOps.scorePenaltyToast;
          const notice = (lang === 'he' && a.messageHe ? a.messageHe : a.message)
            || (a.delta != null ? formatScoreNotice(a.delta, a.reason, lang) : '');
          return (
            <div key={a.id} className="flex items-start gap-2 rounded-xl bg-accent/15 border-2 border-accent/40 px-3 py-2">
              <Icon name="star" className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-400">{label}</p>
                <p dir="auto" className="text-sm font-mono text-ink-fire">{notice}</p>
              </div>
              <button aria-label={translations[lang].liveOps.dismiss} className={`text-zinc-500 text-xs shrink-0 ${TAP_INLINE}`} onClick={() => dismiss(a.id)}>✕</button>
            </div>
          );
        }
        return (
          <div key={a.id} className="flex items-start gap-2 rounded-xl bg-accent/10 border border-accent/30 px-3 py-2">
            <Icon name="megaphone" className="w-4 h-4 shrink-0 mt-0.5" />
            <p dir="auto" className="flex-1 text-sm text-zinc-200">{lang === 'he' && a.messageHe ? a.messageHe : a.message}</p>
            <button aria-label={translations[lang].liveOps.dismiss} className={`text-zinc-500 text-xs shrink-0 ${TAP_INLINE}`} onClick={() => dismiss(a.id)}>✕</button>
          </div>
        );
      })}

      {/* The flash this team is ON is shown by FlashRunner, with its countdown: said once. */}
      {liveFlashes.filter((f) => f.id !== teamFlashId).map((f) => {
        const secsLeft = Math.max(0, Math.round((new Date(f.expiresAt).getTime() - now) / 1000));
        const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
        const ss = String(secsLeft % 60).padStart(2, '0');
        return (
          <div key={f.id} className="rounded-xl bg-purple-500/10 border border-purple-400/40 px-3 py-2">
            <div className="flex items-start gap-2">
              <Icon name="bolt" className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div dir="auto" className="text-sm font-semibold text-purple-900">
                  {lang === 'he' && f.titleHe ? f.titleHe : f.title}
                  {f.bonusPoints ? <span className="ms-2 text-ink-fire font-mono">+{f.bonusPoints}</span> : null}
                </div>
                {(f.description || f.descriptionHe) && (
                  <p dir="auto" className="text-xs text-zinc-300 mt-0.5">{lang === 'he' && f.descriptionHe ? f.descriptionHe : f.description}</p>
                )}
              </div>
              <span className="text-xs font-mono text-purple-700 shrink-0">{mm}:{ss}</span>
            </div>
            {/* flash-missions-v2: the action. First-team missions say who took them. */}
            {f.claimMode && f.doneBy && f.doneBy !== 'announce' && (() => {
              const fl = translations[lang].flash;
              const mine = myFlashClaims?.[f.id];
              const state = flashMissionState(f, now);
              // What happened to OUR claim: taken, sent and waiting, won, or not approved.
              const line = flashMyClaimLine(mine);
              if (line === 'retry' && state !== 'ended' && state !== 'expired') {
                return (
                  <>
                    <p role="status" className="mt-2 text-[13px] text-purple-800">{fl.myRejectedRetry}</p>
                    <button type="button" data-testid="flash-retry" disabled={!!claiming || !!teamFlashId}
                      onClick={() => void claim(f)}
                      className="mt-2 w-full min-h-[44px] rounded-xl bg-purple-500 text-white font-bold text-sm disabled:opacity-50">
                      {claiming === f.id ? fl.claiming : fl.retry}
                    </button>
                  </>
                );
              }
              if (line) {
                const text = line === 'waiting' ? fl.myWaiting : line === 'won' ? fl.myWon({ points: f.bonusPoints ?? 0 })
                  : line === 'rejected' ? fl.myRejectedClosed : line === 'retry' ? fl.myRejected : fl.alreadyYours;
                return <p role="status" className={`mt-2 text-[13px] ${line === 'won' ? 'font-bold text-purple-900' : 'text-purple-800'}`}>{text}</p>;
              }
              if (state === 'taken') return <p className="mt-2 text-[13px] text-zinc-400">{fl.takenByOther}</p>;
              return (
                <button type="button" data-testid="flash-claim" disabled={!!claiming || !!teamFlashId}
                  onClick={() => void claim(f)}
                  className="mt-2 w-full min-h-[44px] rounded-xl bg-purple-500 text-white font-bold text-sm disabled:opacity-50">
                  {claiming === f.id ? fl.claiming : fl.claim}
                </button>
              );
            })()}
          </div>
        );
      })}
      {claimMsg && <p role="status" className="text-[13px] text-zinc-400">{claimMsg}</p>}
      {moment && (
        <div role="alertdialog" aria-labelledby="rp-flash-moment" data-testid="flash-moment"
          className="fixed inset-0 z-50 flex items-center justify-center bg-purple-900/80 backdrop-blur-sm p-6 motion-safe:animate-fade-up">
          {/* The whole backdrop dismisses: a real button, so it is reachable and named. */}
          <button type="button" className="absolute inset-0 w-full h-full cursor-default"
            aria-label={translations[lang].flash.momentDismiss} onClick={() => setMoment(null)} />
          <div className="relative text-center text-white pointer-events-none">
            <div className="mb-3 flex justify-center motion-safe:animate-bounce" aria-hidden><Icon name="bolt" className="w-20 h-20" /></div>
            <p className="text-sm font-bold uppercase tracking-widest mb-2">{translations[lang].flash.momentLabel}</p>
            <h2 id="rp-flash-moment" dir="auto" className="text-3xl font-extrabold mb-2">{lang === 'he' && moment.titleHe ? moment.titleHe : moment.title}</h2>
            {moment.bonusPoints ? <p className="text-2xl font-bold text-amber-300">+{moment.bonusPoints}</p> : null}
          </div>
        </div>
      )}

      {rejectNotice && (
        <div role="alertdialog" aria-labelledby="rp-flash-rejected" data-testid="flash-rejected-notice"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-app-card border border-rp-alert/40 p-5 text-start space-y-3">
            <h2 id="rp-flash-rejected" className="text-lg font-bold text-ink-alert">{translations[lang].flash.rejectedTitle}</h2>
            <p dir="auto" className="text-sm font-semibold text-zinc-200">{lang === 'he' && rejectNotice.flash.titleHe ? rejectNotice.flash.titleHe : rejectNotice.flash.title}</p>
            <p className="text-sm text-zinc-300">{rejectNotice.retry ? translations[lang].flash.myRejectedRetry : translations[lang].flash.myRejectedClosed}</p>
            <div className="flex gap-2">
              {rejectNotice.retry && !teamFlashId && (
                <button type="button" data-testid="flash-retry-notice"
                  onClick={() => { const f = rejectNotice.flash; setRejectNotice(null); void claim(f); }}
                  className="flex-1 min-h-[44px] rounded-xl bg-purple-500 text-white font-bold text-sm">
                  {translations[lang].flash.retry}
                </button>
              )}
              <button type="button" onClick={() => setRejectNotice(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-glass-border text-sm font-semibold text-zinc-200">
                {translations[lang].flash.rejectedOk}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBoard && hasBoard && leaderboard && <LeaderboardPeek leaderboard={leaderboard} myTeamId={myTeamId} lang={lang} timeOnly={timeOnly} />}
    </div>
  );
}

export function LeaderboardPeek({
  leaderboard, myTeamId, lang, timeOnly,
}: {
  leaderboard: RunLeaderboard; myTeamId: string; lang: 'en' | 'he'; timeOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const top = leaderboard.rankings.slice(0, 5);
  const mine = leaderboard.rankings.find((r) => r.teamId === myTeamId);

  return (
    <Collapsible
      open={open}
      onToggle={() => setOpen((o) => !o)}
      bodyClassName="px-3 pb-2 space-y-1"
      header={
        <span className="truncate inline-flex items-center gap-1.5"><Icon name="trophy" className="w-4 h-4 shrink-0" />{translations[lang].liveOps.leaderboardHeading}
          {leaderboard.frozen && <span className="ms-2 text-xs text-zinc-500">{translations[lang].liveOps.frozenTag}</span>}
          {mine && <span className="ms-2 text-ink-fire font-mono">#{mine.rank}</span>}
        </span>
      }
    >
          {top.map((r) => (
            <div
              key={r.teamId}
              className={`flex items-center justify-between text-sm ${r.teamId === myTeamId ? 'text-ink-fire font-semibold' : 'text-zinc-400'}`}
            >
              <span dir="auto" className="truncate min-w-0"><span className="font-mono me-2">{r.rank}</span>{r.teamName}</span>
              <span className="font-mono shrink-0">
                {timeOnly ? (() => { const s = boardTimeSeconds(r); return s != null ? formatDuration(s) : '—'; })() : r.score}
              </span>
            </div>
          ))}
    </Collapsible>
  );
}
