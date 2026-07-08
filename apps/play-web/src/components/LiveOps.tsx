import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { announcementVisibleTo, formatScoreNotice, type RunLeaderboard } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { translations } from '../i18n';
import { haptic } from '../lib/haptics';

interface Ctx { ownerUid: string; gameId: string; runId: string }

// Score notices (kind:'score') auto-hide once older than this so a stale bonus
// doesn't pile up on late joiners; global announcements persist until dismissed.
const SCORE_NOTICE_TTL_MS = 10 * 60 * 1000;

interface AnnouncementDoc {
  id: string; message: string; messageHe?: string; active: boolean; createdAt?: string;
  // Targeted announcements (change: targeted-announcements).
  teamId?: string; kind?: 'announcement' | 'score'; delta?: number; reason?: string;
}
interface FlashDoc { id: string; title: string; titleHe?: string; description?: string; descriptionHe?: string; bonusPoints?: number; expiresAt: string; isActive: boolean }

// Non-blocking live-ops banners + a collapsible leaderboard peek. Rendered above
// the map/task card so it never covers the active mission UI.
export default function LiveOps({
  ctx, leaderboard, myTeamId, lang = 'en',
}: {
  ctx: Ctx;
  leaderboard: RunLeaderboard | null;
  myTeamId: string;
  lang?: 'en' | 'he';
}) {
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);
  const [flashes, setFlashes] = useState<FlashDoc[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());

  const { ownerUid, gameId, runId } = ctx;

  useEffect(() => {
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/announcements`),
      where('active', '==', true),
    );
    return onSnapshot(ref, (snap) => {
      setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AnnouncementDoc, 'id'>) })));
    }, () => undefined);
  }, [ownerUid, gameId, runId]);

  useEffect(() => {
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/flashMissions`),
      where('isActive', '==', true),
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
    setDismissed((prev) => new Set(prev).add(id));
  }

  // Haptic buzz when a NEW score notice arrives — success for a gain, warn for a
  // penalty. The backlog present on first mount is seeded silently (no buzz), so
  // late joiners aren't spammed; only genuinely-new notices vibrate, once each.
  const seenScore = useRef<Set<string>>(new Set());
  const scoreMounted = useRef(false);
  useEffect(() => {
    const scores = liveAnnouncements.filter((a) => a.kind === 'score');
    if (!scoreMounted.current) {
      scores.forEach((a) => seenScore.current.add(a.id));
      scoreMounted.current = true;
      return;
    }
    for (const a of scores) {
      if (seenScore.current.has(a.id)) continue;
      seenScore.current.add(a.id);
      haptic((a.delta ?? 0) >= 0 ? 'success' : 'warn');
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
                <p dir="auto" className="text-sm font-mono text-accent">{notice}</p>
              </div>
              <button className="text-zinc-500 text-xs shrink-0" onClick={() => dismiss(a.id)}>✕</button>
            </div>
          );
        }
        return (
          <div key={a.id} className="flex items-start gap-2 rounded-xl bg-accent/10 border border-accent/30 px-3 py-2">
            <span className="text-sm">📢</span>
            <p dir="auto" className="flex-1 text-sm text-zinc-200">{lang === 'he' && a.messageHe ? a.messageHe : a.message}</p>
            <button className="text-zinc-500 text-xs shrink-0" onClick={() => dismiss(a.id)}>✕</button>
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
                  {f.bonusPoints ? <span className="ml-2 text-accent font-mono">+{f.bonusPoints}</span> : null}
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

      {hasBoard && leaderboard && <LeaderboardPeek leaderboard={leaderboard} myTeamId={myTeamId} lang={lang} />}
    </div>
  );
}

function LeaderboardPeek({
  leaderboard, myTeamId, lang,
}: {
  leaderboard: RunLeaderboard; myTeamId: string; lang: 'en' | 'he';
}) {
  const [open, setOpen] = useState(false);
  const top = leaderboard.rankings.slice(0, 5);
  const mine = leaderboard.rankings.find((r) => r.teamId === myTeamId);

  return (
    <div className="rounded-xl bg-app-card border border-glass-border">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-zinc-300"
        onClick={() => setOpen((o) => !o)}
      >
        <span>🏆 {lang === 'he' ? 'טבלת מובילים' : 'Leaderboard'}
          {leaderboard.frozen && <span className="ml-2 text-xs text-zinc-500">{lang === 'he' ? '(קפואה)' : '(frozen)'}</span>}
          {mine && <span className="ml-2 text-accent font-mono">#{mine.rank}</span>}
        </span>
        <span className="text-zinc-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1">
          {top.map((r) => (
            <div
              key={r.teamId}
              className={`flex items-center justify-between text-sm ${r.teamId === myTeamId ? 'text-accent font-semibold' : 'text-zinc-400'}`}
            >
              <span dir="auto" className="truncate min-w-0"><span className="font-mono me-2">{r.rank}</span>{r.teamName}</span>
              <span className="font-mono shrink-0">{r.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
