import { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { announcementVisibleTo, formatScoreNotice, type RunLeaderboard } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { translations } from '../i18n';
import { haptic } from '../lib/haptics';
import { boardTimeSeconds, formatDuration } from '../lib/boardTime';
import { TAP_INLINE } from '../lib/interaction';
import { loadDismissed, saveDismissed } from '../lib/dismissedAnnouncements';
import { Collapsible } from './ui';

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
  teamId?: string; kind?: 'announcement' | 'score'; delta?: number; reason?: string;
}
interface FlashDoc { id: string; title: string; titleHe?: string; description?: string; descriptionHe?: string; bonusPoints?: number; expiresAt: string; isActive: boolean }

// Non-blocking live-ops banners + a collapsible leaderboard peek. Rendered above
// the map/task card so it never covers the active mission UI.
export default function LiveOps({
  ctx, leaderboard, myTeamId, lang = 'en', timeOnly = false,
}: {
  ctx: Ctx;
  leaderboard: RunLeaderboard | null;
  myTeamId: string;
  lang?: 'en' | 'he';
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
    return onSnapshot(ref, (snap) => {
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AnnouncementDoc, 'id'>) })));
    }, () => undefined);
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
    return onSnapshot(ref, (snap) => {
      setFlashes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FlashDoc, 'id'>) })));
    }, () => undefined);
  }, [ownerUid, gameId, runId]);

  // Tick so flash-mission countdowns expire on their own.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const liveFlashes = flashes.filter((f) => new Date(f.expiresAt).getTime() > now && !dismissed.has(f.id));
  // Targeted announcements: only show a doc that is global or addressed to my team
  // (client-side courtesy filter — the field is not secret). Score notices also
  // auto-hide once older than SCORE_NOTICE_TTL_MS.
  const liveAnnouncements = announcements.filter((a) => {
    if (dismissed.has(a.id)) return false;
    if (!announcementVisibleTo(a, myTeamId)) return false;
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
  if (!hasBanners && !hasBoard) return null;

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
              <span className="text-sm">💯</span>
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
            <span className="text-sm">📢</span>
            <p dir="auto" className="flex-1 text-sm text-zinc-200">{lang === 'he' && a.messageHe ? a.messageHe : a.message}</p>
            <button aria-label={translations[lang].liveOps.dismiss} className={`text-zinc-500 text-xs shrink-0 ${TAP_INLINE}`} onClick={() => dismiss(a.id)}>✕</button>
          </div>
        );
      })}

      {liveFlashes.map((f) => {
        const secsLeft = Math.max(0, Math.round((new Date(f.expiresAt).getTime() - now) / 1000));
        const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
        const ss = String(secsLeft % 60).padStart(2, '0');
        return (
          <div key={f.id} className="rounded-xl bg-purple-500/10 border border-purple-400/40 px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="text-sm">⚡</span>
              <div className="flex-1 min-w-0">
                <div dir="auto" className="text-sm font-semibold text-purple-200">
                  {lang === 'he' && f.titleHe ? f.titleHe : f.title}
                  {f.bonusPoints ? <span className="ms-2 text-ink-fire font-mono">+{f.bonusPoints}</span> : null}
                </div>
                {(f.description || f.descriptionHe) && (
                  <p dir="auto" className="text-xs text-zinc-300 mt-0.5">{lang === 'he' && f.descriptionHe ? f.descriptionHe : f.description}</p>
                )}
              </div>
              <span className="text-xs font-mono text-purple-300 shrink-0">{mm}:{ss}</span>
            </div>
          </div>
        );
      })}

      {hasBoard && leaderboard && <LeaderboardPeek leaderboard={leaderboard} myTeamId={myTeamId} lang={lang} timeOnly={timeOnly} />}
    </div>
  );
}

function LeaderboardPeek({
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
        <span className="truncate">🏆 {translations[lang].liveOps.leaderboardHeading}
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
