// Ceremony mode (change: ceremony-mode). A client-driven awards finale on the
// public board route (`?board=<code>&ceremony`): photo slideshow (top-liked feed
// items) → podium reveal 3rd → 2nd → 1st (canvas confetti) → full standings.
// Lazy loaded from App.tsx so the animation code stays out of the main bundle.
// Zero new dependencies: CSS keyframes + a requestAnimationFrame canvas.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ceremonyStart, ceremonyNext, type CeremonyPhase } from '@rushpoint/shared';
import { getPublicLeaderboard, type PublicLeaderboard } from '../services/calls';
import { useT } from '../i18nContext';
import { Spinner } from '../components/Spinner';

const MEDALS = ['🥇', '🥈', '🥉'];
const POLL_MS = 12_000;     // re-poll while unpublished — comes alive on publish
const SLIDE_MS = 4_000;     // per slideshow photo
const PODIUM_MS = 5_000;    // per podium reveal step
const WINNER_MS = 8_000;    // champion moment (confetti runs ~8s)

// CSS keyframes for the slideshow Ken Burns pan + podium rise. A module-level
// constant (not JSX copy — the no-dashes/i18n gates scan UI text positions).
const CEREMONY_CSS = `
  @keyframes rp-kenburns { from { transform: scale(1) translateY(0); } to { transform: scale(1.08) translateY(-2%); } }
  @keyframes rp-podium-rise { from { opacity: 0; transform: translateY(48px) scale(0.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .rp-kenburns { animation: rp-kenburns ${SLIDE_MS + 600}ms ease-out forwards; }
  .rp-podium-rise { animation: rp-podium-rise 700ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
  @media (prefers-reduced-motion: reduce) { .rp-kenburns, .rp-podium-rise { animation: none; opacity: 1; } }
`;

function fmtTime(e: { durationSeconds?: number; totalMinutes?: number }): string {
  const sec = e.durationSeconds ?? (e.totalMinutes != null ? e.totalMinutes * 60 : null);
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export default function CeremonyScreen({ code }: { code: string }) {
  const { t } = useT();
  const [data, setData] = useState<PublicLeaderboard | null | undefined>(undefined);
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const [slide, setSlide] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const started = useRef(false);

  // Load + re-poll until published, so the operator can open the screen BEFORE
  // publishing and it comes alive on publish (the natural stage cue).
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await getPublicLeaderboard({ code });
        if (!alive) return;
        setLoadError(false);
        setData(next);
        if (!next.published) timer = window.setTimeout(() => void load(), POLL_MS);
      } catch {
        if (!alive) return;
        setLoadError(true);
        setData(null);
        timer = window.setTimeout(() => void load(), POLL_MS);
      }
    };
    void load();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [code]);

  const published = !!data?.published;
  const feed = published ? (data!.ceremonyFeed ?? []) : [];
  const rankings = published ? data!.rankings : [];
  const teamCount = rankings.length;

  // Kick the sequence off exactly once, on first publish.
  useEffect(() => {
    if (published && !started.current) {
      started.current = true;
      setPhase(ceremonyStart(feed.length, teamCount));
    }
  }, [published, feed.length, teamCount]);

  const advance = useCallback(() => {
    setPhase((p) => (p == null ? p : ceremonyNext(p, teamCount)));
  }, [teamCount]);

  // Phase timers. The slideshow steps through photos before advancing; podium
  // steps are fixed beats; the winner phase lingers with the confetti.
  useEffect(() => {
    if (phase == null || phase === 'standings') return;
    let ms = PODIUM_MS;
    if (phase === 'slideshow') ms = SLIDE_MS;
    if (phase === 'podium1') ms = WINNER_MS;
    const id = window.setTimeout(() => {
      if (phase === 'slideshow' && slide + 1 < feed.length) setSlide((s) => s + 1);
      else advance();
    }, ms);
    return () => window.clearTimeout(id);
  }, [phase, slide, feed.length, advance]);

  const accent = data?.branding?.primaryColor ?? '#FF5722';

  if (data === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <Spinner size="lg" />
      </div>
    );
  }

  // Holding screen until the organizer publishes (same gate as the TV board).
  if (!published || phase == null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center gap-4 bg-app-bg p-8">
        <div className="text-7xl">🏆</div>
        <h1 dir="auto" className="font-brand text-4xl font-extrabold text-zinc-200">{data?.title ?? 'RushPoint'}</h1>
        <p className={`text-2xl ${loadError ? 'text-ink-fire font-semibold' : 'text-zinc-500'}`}>
          {loadError ? t.ceremony.loadError : t.ceremony.ceremonyWaiting}
        </p>
      </div>
    );
  }

  // time_only runs never award points — every team's `score` is a placeholder 0,
  // so the ceremony must reveal the TIME, not a column of zeros (mirrors the TV /
  // public / finish boards).
  const isTimeOnly = data!.scoringPreset === 'time_only';

  // Tap/click anywhere advances early (operator escape hatch). It is also a real
  // keyboard control (change: play-web-accessibility): a ceremony is usually
  // driven from a laptop wired to a projector, where Enter/Space is the natural
  // "next" and a mouse may not be within reach.
  return (
    <div
      className="min-h-screen bg-app-bg px-6 pb-6 sm:px-10 sm:pb-10 rp-safe-t flex flex-col cursor-pointer select-none"
      role="button"
      tabIndex={0}
      onClick={advance}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
      }}
    >
      <style>{CEREMONY_CSS}</style>

      <div className="text-center mb-6">
        <h1 dir="auto" className="font-brand text-4xl sm:text-5xl font-extrabold" style={{ color: accent }}>
          {data!.title}
        </h1>
      </div>

      {phase === 'slideshow' && feed[slide] && (
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-glass-border bg-app-card">
            <img
              key={slide}
              src={feed[slide].photoUrl}
              alt=""
              className="rp-kenburns w-full max-h-[70vh] object-cover"
            />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-6 py-4">
              <p dir="auto" className="text-2xl font-bold text-white">
                {feed[slide].teamName} · {feed[slide].taskTitle}
              </p>
              {feed[slide].totalReactions > 0 && (
                <p className="text-sm text-zinc-300">🔥 {feed[slide].totalReactions}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-1.5">
            {feed.map((_, i) => (
              <span key={i} className={`h-1.5 w-6 rounded-full ${i === slide ? 'bg-rp-fire' : 'bg-zinc-700'}`} />
            ))}
          </div>
        </div>
      )}

      {(phase === 'podium3' || phase === 'podium2' || phase === 'podium1') && (
        <Podium rankings={rankings} phase={phase} accent={accent} championLabel={t.ceremony.ceremonyChampion} timeOnly={isTimeOnly} />
      )}

      {phase === 'standings' && (
        <div className="flex-1 max-w-5xl w-full mx-auto">
          <div className="text-center text-sm uppercase tracking-[0.3em] text-zinc-500 mb-4">
            {t.ceremony.ceremonyStandings}
          </div>
          <div className="space-y-3">
            {rankings.slice(0, 12).map((r, i) => (
              <div key={r.teamId}
                className={`flex items-center gap-5 rounded-2xl border px-6 py-4 ${
                  i === 0
                    ? 'border-yellow-400/40 bg-gradient-to-r from-yellow-400/15 to-amber-300/5'
                    : 'border-glass-border bg-app-card'
                }`}>
                <span className="w-14 text-center text-3xl font-brand font-extrabold text-zinc-300">
                  {MEDALS[i] ?? r.rank}
                </span>
                <div dir="auto" className="flex-1 min-w-0 text-3xl font-bold text-zinc-100 truncate">{r.teamName}</div>
                <div className="text-end">
                  {isTimeOnly ? (
                    <div className="text-3xl font-brand font-extrabold font-mono tabular-nums" style={{ color: accent }}>{fmtTime(r) || '—'}</div>
                  ) : (
                    <>
                      <div className="text-3xl font-brand font-extrabold" style={{ color: accent }}>{r.score}</div>
                      <div className="text-sm text-zinc-500 font-mono">{fmtTime(r)}</div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'podium1' && <ConfettiCanvas accent={accent} />}
    </div>
  );
}

// ── Podium reveal ─────────────────────────────────────────────────────────────
// podium3 shows 3rd; podium2 adds 2nd; podium1 adds the champion. Each new row
// animates up via the rp-podium-rise keyframes.
function Podium({ rankings, phase, accent, championLabel, timeOnly }: {
  rankings: PublicLeaderboard['rankings'];
  phase: 'podium3' | 'podium2' | 'podium1';
  accent: string;
  championLabel: string;
  timeOnly: boolean;
}) {
  const shown = phase === 'podium3' ? [3] : phase === 'podium2' ? [3, 2] : [3, 2, 1];
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 max-w-3xl w-full mx-auto">
      {phase === 'podium1' && rankings[0] && (
        <div className="rp-podium-rise text-center mb-2">
          <div className="text-6xl mb-2">👑</div>
          <div className="text-sm uppercase tracking-[0.3em] text-zinc-500">{championLabel}</div>
        </div>
      )}
      {[1, 2, 3]
        .filter((place) => shown.includes(place) && rankings[place - 1])
        .map((place) => {
          const r = rankings[place - 1];
          const isChampion = place === 1;
          return (
            <div key={r.teamId}
              className={`rp-podium-rise w-full flex items-center gap-5 rounded-2xl border px-6 ${
                isChampion
                  ? 'py-6 border-yellow-400/50 bg-gradient-to-r from-yellow-400/20 to-amber-300/5'
                  : 'py-4 border-glass-border bg-app-card'
              }`}>
              <span className={`text-center font-brand font-extrabold ${isChampion ? 'w-16 text-5xl' : 'w-14 text-4xl'}`}>
                {MEDALS[place - 1]}
              </span>
              <div dir="auto" className={`flex-1 min-w-0 font-bold text-zinc-100 truncate ${isChampion ? 'text-4xl' : 'text-3xl'}`}>
                {r.teamName}
              </div>
              <div className={`font-brand font-extrabold ${isChampion ? 'text-4xl' : 'text-3xl'} ${timeOnly ? 'font-mono tabular-nums' : ''}`} style={{ color: accent }}>
                {timeOnly ? (fmtTime(r) || '—') : r.score}
              </div>
            </div>
          );
        })
        .reverse() /* 3rd on the bottom, champion on top */}
    </div>
  );
}

// ── Confetti ──────────────────────────────────────────────────────────────────
// ~150 requestAnimationFrame rectangles with gravity + drift, palette derived
// from the branding accent. Pure canvas, no deps; stops after ~8s and the RAF
// loop is cancelled on unmount (long-lived projection screens).
function ConfettiCanvas({ accent }: { accent: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Reduced motion: no particle storm at all (change: play-web-accessibility).
    // lib/confetti.ts already does this; this canvas was the one that did not.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const palette = [accent, '#FFD54F', '#4FC3F7', '#81C784', '#F06292', '#FFFFFF'];
    const particles = Array.from({ length: 150 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vx: (Math.random() - 0.5) * 2.2,
      vy: 2 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      color: palette[Math.floor(Math.random() * palette.length)],
    }));

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (now - t0 > WINNER_MS) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx + Math.sin((now / 900) + p.rot) * 0.6; // drift
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [accent]);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-40" aria-hidden />;
}
