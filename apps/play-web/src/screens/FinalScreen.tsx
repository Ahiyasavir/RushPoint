import { useEffect, useRef, useState } from 'react';
import { PAYMENTS_ENABLED } from '@rushpoint/shared';
import type { MyTeamState } from '../services/calls';
import { getMyProfile } from '../services/calls';
import { uid } from '../services/firebase';
import type { Session } from '../store';
import { Button, Card, Screen } from '../components/ui';
import PostGameSurvey from '../components/PostGameSurvey';
import { useT } from '../i18nContext';
import { selectPodium } from '@rushpoint/shared';
import { fireConfetti } from '../lib/confetti';
import { creatorUrl } from '../lib/creatorUrl';

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

const MEDAL = ['🥇', '🥈', '🥉'];
const MEDAL_BG = [
  'bg-gradient-to-r from-yellow-400/20 to-amber-300/10 border-yellow-400/30',
  'bg-gradient-to-r from-gray-300/20 to-gray-200/10 border-gray-300/30',
  'bg-gradient-to-r from-orange-400/20 to-orange-300/10 border-orange-400/30',
];

export default function FinalScreen({ state, session, onLeave }: { state: MyTeamState; session: Session; onLeave: () => void }) {
  const { t, lang } = useT();
  const { team, run, game } = state;
  const accent = game.branding?.primaryColor ?? '#FF5722';
  // Staged reveal (change: manual-leaderboard-reveal): a game may ask for the
  // final standings to stay hidden from players until the creator reveals them.
  // EVERY ranking-derived surface here (rank badge, podium, board, share text)
  // reads this gated `board`, never run.leaderboard directly — before this gate
  // an unpublished board rendered in full. `run.leaderboard` still means "the run
  // was finalized" and keeps driving the badges + waiting state.
  const board = run.leaderboard?.published ? run.leaderboard : null;
  const boardWithheld = !!run.leaderboard && !run.leaderboard.published;
  const myEntry = board?.rankings.find((r) => r.teamId === team.id);
  const myRank = myEntry?.rank;
  const finalScore = myEntry?.score ?? team.score;
  const isTimeOnly = game.scoringPreset === 'time_only';

  // Prefer the server's ranked duration so this matches the TV / ceremony /
  // recap boards exactly (a frozen-before-finish board would otherwise show a
  // different completion time here than everywhere else). Fall back to the raw
  // timestamps only if the team isn't in the snapshot yet.
  const totalSec = myEntry?.durationSeconds
    ?? (team.startedAt && team.finishedAt
      ? (new Date(team.finishedAt).getTime() - new Date(team.startedAt).getTime()) / 1000
      : null);
  const completedStages = team.stages.filter((s) => s.status === 'completed');
  let fastest: { order: number; dur: number } | null = null;
  for (const s of completedStages) {
    if (s.startedAt && s.completedAt) {
      const dur = (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000;
      if (!fastest || dur < fastest.dur) fastest = { order: s.order, dur };
    }
  }
  const hintsUsed = team.taskHintsUsed?.length ?? 0;
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  // Celebrate the finish once — a brand-colored confetti burst timed to land with
  // the score-pop. Reduced-motion is honored inside fireConfetti(); the ref guard
  // stops any re-render (live leaderboard updates, survey steps) from re-firing it.
  const confettiFired = useRef(false);
  useEffect(() => {
    if (confettiFired.current) return;
    confettiFired.current = true;
    const id = window.setTimeout(() => fireConfetti(), 350);
    return () => window.clearTimeout(id);
  }, []);

  // A team photo to offer as a branded individual share (share-branding).
  const firstPhotoUrl = (() => {
    const subs = (team as { taskSubmissions?: Record<string, { photoUrl?: string }> }).taskSubmissions;
    if (!subs) return null;
    for (const s of Object.values(subs)) if (s?.photoUrl) return s.photoUrl;
    return null;
  })();

  // Top-3 podium for the reveal + the branded podium share (podium-share-moment).
  const { podium } = selectPodium(board?.rankings ?? [], team.id);

  async function sharePodiumFn() {
    if (podium.length === 0) return;
    setBusy(true);
    try {
      const { sharePodium } = await import('../lib/podiumCard');
      await sharePodium(podium, {
        gameName: game.branding?.name ?? game.title,
        ctaUrl: creatorUrl(),
        text: t.final.shareText({
          team: team.displayName, game: game.branding?.name ?? game.title,
          rankPart: '', timePart: '', url: creatorUrl().replace(/^https?:\/\//, ''),
        }),
      });
    } finally { setBusy(false); }
  }

  async function sharePhotoFn() {
    if (!firstPhotoUrl) return;
    setBusy(true);
    try {
      const playBase = window.location.origin;
      const { sharePhoto } = await import('../lib/sharePhoto');
      await sharePhoto(firstPhotoUrl, {
        playBaseUrl: playBase,
        gameId: (game as { id?: string }).id ?? null,
        urlText: creatorUrl().replace(/^https?:\/\//, ''),
        caption: t.final.shareText({
          team: team.displayName, game: game.branding?.name ?? game.title,
          rankPart: '', timePart: '', url: creatorUrl().replace(/^https?:\/\//, ''),
        }),
      });
    } finally { setBusy(false); }
  }

  async function share() {
    setBusy(true);
    try {
      const name = game.branding?.name ?? game.title;
      const rankPart = myRank ? t.final.shareRankPart({ rank: myRank }) : '';
      const timePart = totalSec != null ? t.final.shareTimePart({ time: fmtDuration(totalSec) }) : '';
      const text = t.final.shareText({
        team: team.displayName,
        game: name,
        rankPart,
        timePart,
        url: creatorUrl().replace(/^https?:\/\//, ''),
      });
      const { shareStoryCard } = await import('../lib/storyCard');
      const result = await shareStoryCard({
        gameName: name,
        teamName: team.displayName,
        score: finalScore,
        rank: myRank,
        totalTime: totalSec != null ? fmtDuration(totalSec) : undefined,
        stagesDone: `${completedStages.length}/${team.stages.length}`,
        ctaUrl: creatorUrl(),
      }, text);
      if (result === 'downloaded' || result === 'copied') { setShared(true); setTimeout(() => setShared(false), 2500); }
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <div data-testid="final-screen" className="flex-1 flex flex-col items-center justify-center text-center gap-5">

        {/* Trophy + title */}
        <div className="animate-score-pop">
          <div
            className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mx-auto mb-3"
            style={{ background: `radial-gradient(circle at 40% 35%, ${accent}30, ${accent}08)`, boxShadow: `0 0 40px ${accent}40` }}
          >
            🏆
          </div>
          <h1 className="font-brand text-4xl font-extrabold" style={{ color: accent }}>{t.final.title}</h1>
          <p dir="auto" className="text-zinc-400 mt-1">{t.final.subtitle({ name: team.displayName })}</p>
        </div>

        {/* Score card — a time_only run isn't ranked by points (the "score" is just
            a completion bonus and misreads as a leaderboard total), so the hero
            metric there is the finish time instead. */}
        <Card className="p-6 w-full" style={{ borderColor: `${accent}30` }}>
          <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">{isTimeOnly ? t.final.finishTimeLabel : t.final.scoreLabel}</div>
          <div
            className="text-6xl font-brand font-extrabold my-2 animate-score-pop bg-gradient-to-r bg-clip-text text-transparent"
            style={{ backgroundImage: `linear-gradient(135deg, ${accent}, ${accent}99)` }}
          >
            {isTimeOnly ? (totalSec != null ? fmtDuration(totalSec) : '—') : finalScore}
          </div>
          {myRank && (
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg">{MEDAL[myRank - 1] ?? '🏅'}</span>
              <span className="text-sm font-medium text-zinc-300">{t.final.rankLabel({ rank: myRank })}</span>
            </div>
          )}
        </Card>

        {/* Race recap */}
        <Card className="p-4 w-full">
          <div className="text-sm font-semibold text-zinc-300 mb-3 text-start">🗂️ {t.final.recapTitle}</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label={t.final.statTotalTime} value={totalSec != null ? fmtDuration(totalSec) : '?'} accent={accent} />
            <Stat label={t.final.statStages} value={`${completedStages.length}/${team.stages.length}`} accent={accent} />
            <Stat label={t.final.statFastest} value={fastest ? `#${fastest.order + 1} · ${fmtDuration(fastest.dur)}` : '?'} accent={accent} />
            <Stat label={t.final.statHints} value={String(hintsUsed)} accent={accent} />
          </div>
          <Button className="mt-4" disabled={busy} onClick={share}>
            {busy ? t.final.shareCreating : shared ? t.final.shareSaved : t.final.shareBtn}
          </Button>
          {firstPhotoUrl && (
            <button disabled={busy} onClick={sharePhotoFn}
              className="mt-2 w-full text-sm text-accent/90 hover:text-accent disabled:opacity-50">
              {t.final.sharePhoto}
            </button>
          )}
        </Card>

        {/* Post-game feedback survey (post-game-feedback): shown from the moment
            the team finishes — including the wait for the host to finalize.
            Self-guards against re-showing once answered/dismissed. */}
        <BadgesCard finalized={!!run.leaderboard} />

        <PostGameSurvey session={session} lang={lang} />

        {/* Podium reveal: top 3 rise onto a 1-2-3 podium (motion-reduce → instant) */}
        {podium.length > 0 && (
          <Card className="p-4 w-full">
            <div className="flex items-end justify-center gap-2 h-44">
              {([2, 1, 3] as const).map((place) => {
                const e = podium.find((p) => p.place === place);
                if (!e) return <div key={place} className="flex-1" />;
                const h = place === 1 ? 'h-40' : place === 2 ? 'h-32' : 'h-24';
                const isMe = e.teamId === team.id;
                return (
                  <div key={place}
                    className="flex-1 flex flex-col items-center justify-end animate-fade-up motion-reduce:animate-none"
                    style={{ animationDelay: `${place * 80}ms` }}>
                    <div className="text-2xl leading-none">{MEDAL[place - 1]}</div>
                    <div dir="auto" className={`text-xs font-semibold truncate max-w-full ${isMe ? 'text-accent' : 'text-zinc-200'}`}>{e.teamName}</div>
                    <div className="text-[11px] text-zinc-400 mb-1">
                      {isTimeOnly
                        ? (() => { const d = board?.rankings.find((x) => x.teamId === e.teamId)?.durationSeconds; return d != null ? fmtDuration(d) : '—'; })()
                        : e.score}
                    </div>
                    <div className={`w-full ${h} rounded-t-lg flex items-start justify-center pt-1 font-brand font-extrabold ${isMe ? 'bg-rp-fire/30 border border-rp-fire/40 text-accent' : 'bg-white/10 text-zinc-300'}`}>{place}</div>
                  </div>
                );
              })}
            </div>
            <Button variant="ghost" className="mt-3 w-full" disabled={busy} onClick={sharePodiumFn}>{t.final.sharePodium}</Button>
          </Card>
        )}

        {/* Leaderboard */}
        {board && board.rankings.length > 0 && (
          <Card className="p-4 w-full">
            <div className="text-sm font-semibold text-zinc-300 mb-3 text-start">🏅 {t.final.leaderboardTitle}</div>
            <div className="space-y-1.5">
              {board.rankings.slice(0, 10).map((r, i) => {
                const isMe = r.teamId === team.id;
                const medalBg = i < 3 ? MEDAL_BG[i] : '';
                return (
                  <div
                    key={r.teamId}
                    className={`
                      flex items-center gap-3 text-sm px-3 py-2 rounded-xl border
                      animate-fade-up
                      ${isMe ? 'border-rp-fire/30 bg-rp-fire/8 text-zinc-100' : `${medalBg || 'border-transparent'} text-zinc-400`}
                    `}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <span className="w-6 flex items-center justify-center">
                      {MEDAL[i] ?? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10 text-zinc-400 text-xs font-mono font-semibold">{r.rank}</span>
                      )}
                    </span>
                    <span dir="auto" className="flex-1 text-start font-medium">{r.teamName}</span>
                    <span className="font-mono text-xs font-semibold" style={{ color: isMe ? accent : undefined }}>
                      {isTimeOnly ? (r.durationSeconds != null ? fmtDuration(r.durationSeconds) : '—') : r.score}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Finalized, but the host is staging the reveal — say so plainly instead
            of showing a blank space where the board would be. */}
        {boardWithheld && (
          <Card className="p-6 w-full text-center">
            <div className="text-4xl mb-2">🤫</div>
            <div className="text-sm font-semibold text-zinc-300">{t.final.notRevealedTitle}</div>
            <p className="text-zinc-500 text-sm mt-1">{t.final.notRevealedBody}</p>
          </Card>
        )}

        {!run.leaderboard && (
          <div className="flex items-center justify-center gap-2.5 text-zinc-500 text-sm py-2">
            <span aria-hidden="true" className="w-4 h-4 rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin shrink-0" />
            <span>{t.final.waitingFinalize}</span>
          </div>
        )}
      </div>

      {/* Viral footer — hidden for Pro runs (white-label) and entirely in free
          mode (no payment/upsell surface). The ?ref tag credits the host with a
          free run if a participant signs up as a creator. */}
      {PAYMENTS_ENABLED && run.billingType !== 'pro' && (
        <a href={`${creatorUrl()}/?ref=${team.ownerUid}`} target="_blank" rel="noreferrer"
          className="block mt-2 rounded-2xl border border-glass-border bg-white/70 px-4 py-3 text-center hover:bg-white transition-colors">
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 mb-0.5">
            <span>⚡</span> {t.final.poweredBy}
          </div>
          <div className="text-sm font-semibold" style={{ color: accent }}>
            {t.final.buildOwn}
          </div>
        </a>
      )}
      <Button variant="ghost" onClick={onLeave} className="mt-2">{t.final.leave}</Button>
    </Screen>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-app-raised rounded-xl px-3 py-2.5 text-start">
      <div className="text-[11px] text-zinc-500 mb-0.5">{label}</div>
      <div className="text-base font-semibold font-brand" style={{ color: accent }}>{value}</div>
    </div>
  );
}

// Cross-run badges (change: player-profile-badges): the player's earned badges,
// with any newly-unlocked this game highlighted. Reads the server-written profile
// (recorded on finish); newness is tracked locally so it only celebrates once.
const BADGE_EMOJI: Record<string, string> = {
  first_finish: '🏁', explorer: '🧭', pathfinder: '🗺️', veteran: '🎖️', high_scorer: '💯', legend: '👑',
};

function BadgesCard({ finalized }: { finalized: boolean }) {
  const { t } = useT();
  const [badges, setBadges] = useState<string[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Profiles are recorded when the organizer finalizes the run, so (re)fetch on mount
  // and again once the run is finalized — that's when new badges actually appear.
  useEffect(() => {
    let alive = true;
    getMyProfile({})
      .then((res) => {
        if (!alive) return;
        const earned = res.profile.badges ?? [];
        // Per-player key: on a shared device, each player's "already seen" set is
        // separate so player B doesn't inherit player A's highlighted-badge state.
        const seenKey = `rp.badges.seen.${uid() ?? 'anon'}`;
        let seen: string[] = [];
        try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch { /* ignore */ }
        const seenSet = new Set(seen);
        setFresh(new Set(earned.filter((b) => !seenSet.has(b))));
        setBadges(earned);
        try { localStorage.setItem(seenKey, JSON.stringify(earned)); } catch { /* ignore */ }
      })
      .catch(() => { if (alive) setBadges((b) => b ?? []); });
    return () => { alive = false; };
  }, [finalized]);

  if (!badges || badges.length === 0) return null;
  const label = (id: string): string => {
    const map = t.badges as unknown as Record<string, string>;
    return map[id] ?? id;
  };
  return (
    <Card className="p-4 w-full">
      <div className="text-sm font-bold text-zinc-100 mb-3">{t.badges.title}</div>
      <div className="flex flex-wrap gap-2">
        {badges.map((b) => (
          <div
            key={b}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 border text-sm ${
              fresh.has(b)
                ? 'border-accent bg-accent/10 text-accent animate-score-pop motion-reduce:animate-none'
                : 'border-glass-border text-zinc-300'
            }`}
          >
            <span aria-hidden>{BADGE_EMOJI[b] ?? '🏅'}</span>
            <span dir="auto">{label(b)}</span>
            {fresh.has(b) && <span className="text-[10px] font-bold uppercase">{t.badges.new}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}
