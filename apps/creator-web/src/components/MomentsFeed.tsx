// The run's moments, one at a time, full screen, swipe up for the next (change: creator-engagement-loop).
// Ahiya, 29.10: TikTok's design, so staying is the easiest thing to do. The end of a run is the peak of
// a creator's experience (peak-end), and until now it was a grid of thumbnails in a console panel.
//
// What it borrows from TikTok, and why each fits here: one item fills the screen (nothing competes);
// a vertical swipe moves on (the thumb is already there); video plays muted on its own when it is in
// view; a double tap hearts it; the actions sit on the side within thumb reach; the count is shown so
// "one more" is always a known, small step. What it does NOT borrow: an endless feed. It has an end,
// and the end asks for the next game, which is the only "more" that is real.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { isRenderableMedia, submissionKey, type SubmissionRow } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { TAP_TARGET } from '../lib/interaction';

const LIKED_KEY = (runId: string) => `rp-moments-liked:${runId}`;
function readLiked(runId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LIKED_KEY(runId)) ?? '[]') as string[]); } catch { return new Set(); }
}

export interface MomentsFeedProps {
  runId: string;
  gameTitle: string;
  rows: SubmissionRow[];
  taskLabel: (taskId: string) => string;
  onClose: () => void;
  onNextGame: () => void;
}

export default function MomentsFeed({ runId, gameTitle, rows, taskLabel, onClose, onNextGame }: MomentsFeedProps) {
  const tm = useT().moments;
  const reduce = useReducedMotion();
  // The story of the run, in the order it happened.
  const items = rows.filter((r) => isRenderableMedia(r.photoUrl) && r.mediaKind !== 'audio')
    .slice().sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0));
  const teams = new Set(items.map((r) => r.teamId)).size;
  const [liked, setLiked] = useState<Set<string>>(() => readLiked(runId));
  const [burst, setBurst] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [muted, setMuted] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const lastTap = useRef<{ key: string; t: number } | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Which screen is in view: drives the counter and which video plays.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setAt(Math.round(el.scrollTop / Math.max(1, el.clientHeight)));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const toggleLike = (key: string, on?: boolean) => {
    setLiked((prev) => {
      const next = new Set(prev);
      const want = on ?? !next.has(key);
      if (want) next.add(key); else next.delete(key);
      try { localStorage.setItem(LIKED_KEY(runId), JSON.stringify([...next])); } catch { /* storage off */ }
      return next;
    });
  };
  const onTap = (key: string) => {
    const now = Date.now();
    if (lastTap.current && lastTap.current.key === key && now - lastTap.current.t < 320) {
      toggleLike(key, true);
      setBurst(key);
      window.setTimeout(() => setBurst((b) => (b === key ? null : b)), 700);
      lastTap.current = null;
    } else lastTap.current = { key, t: now };
  };
  const share = async (row: SubmissionRow) => {
    try {
      if (typeof navigator.share === 'function') await navigator.share({ title: gameTitle, url: row.photoUrl });
      else await navigator.clipboard.writeText(row.photoUrl);
    } catch { /* dismissed */ }
  };

  // Screen 0 is the intro, then one per moment, then the end.
  const total = items.length;
  // Portalled to the body: inside the console it sat in the page's stacking context, under the header.
  return createPortal((
    <div className="fixed inset-0 z-[70] bg-black text-white" role="dialog" aria-modal="true" aria-label={tm.title}>
      <div ref={scroller} className="h-full w-full overflow-y-scroll snap-y snap-mandatory overscroll-contain [scrollbar-width:none]">
        <section className="relative h-full w-full snap-start flex flex-col items-center justify-center text-center px-6 bg-gradient-to-b from-rp-fire/40 via-black to-black">
          <p className="text-[15px] font-semibold text-white/70">{tm.introKicker}</p>
          {gameTitle && <h2 className="mt-2 text-[30px] font-extrabold leading-tight" dir="auto">{gameTitle}</h2>}
          <p className="mt-3 text-[17px] text-white/85">{total > 0 ? tm.introLine({ moments: total, teams }) : tm.empty}</p>
          {total > 0 && <motion.span aria-hidden animate={reduce ? undefined : { y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.4 }}
            className="mt-10 inline-flex flex-col items-center gap-1 text-[14px] text-white/70">
            <Icon name="chevronUp" className="w-6 h-6" />{tm.swipe}
          </motion.span>}
        </section>

        {items.map((row, i) => {
          const key = submissionKey(row);
          const isLiked = liked.has(key);
          return (
            <section key={key} className="relative h-full w-full snap-start overflow-hidden">
              {row.mediaKind === 'video' ? (
                <FeedVideo src={row.photoUrl} poster={row.posterUrl} active={at === i + 1} muted={muted} />
              ) : (
                <>
                  <img src={row.photoUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50" />
                  <img src={row.photoUrl} alt={tm.alt({ team: row.displayName })} loading={i < 2 ? 'eager' : 'lazy'} className="relative w-full h-full object-contain" />
                </>
              )}
              {/* The whole picture is the double tap target: a real button, so it is reachable and named. */}
              <button type="button" onClick={() => onTap(key)} aria-label={tm.doubleTap} className="absolute inset-0 w-full h-full cursor-default focus-visible:outline-none" />
              <AnimatePresence>
                {burst === key && (
                  <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1.15, opacity: 1 }} exit={{ scale: 1.4, opacity: 0 }}
                    className="pointer-events-none absolute inset-0 flex items-center justify-center text-rp-badge">
                    <Icon name="heart" className="w-28 h-28 drop-shadow-2xl" fill="currentColor" />
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 inset-x-0 pe-20 ps-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
                <p className="text-[18px] font-extrabold leading-tight" dir="auto">{row.displayName}</p>
                <p className="mt-0.5 text-[15px] text-white/85 leading-snug" dir="auto">{taskLabel(row.taskId)}</p>
              </div>
              <div className="absolute end-2 bottom-[max(env(safe-area-inset-bottom),1.25rem)] flex flex-col items-center gap-3">
                <button type="button" onClick={() => toggleLike(key)} aria-pressed={isLiked} aria-label={tm.like}
                  className={`${TAP_TARGET} rounded-full bg-black/35 backdrop-blur ${isLiked ? 'text-rp-badge' : 'text-white'}`}>
                  <Icon name="heart" className="w-7 h-7" fill={isLiked ? 'currentColor' : 'none'} />
                </button>
                <button type="button" onClick={() => void share(row)} aria-label={tm.share} className={`${TAP_TARGET} rounded-full bg-black/35 backdrop-blur text-white`}>
                  <Icon name="link" className="w-6 h-6" />
                </button>
                {row.mediaKind === 'video' && (
                  <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? tm.unmute : tm.mute} className={`${TAP_TARGET} rounded-full bg-black/35 backdrop-blur text-white`}>
                    <Icon name={muted ? 'speakerOff' : 'speaker'} className="w-6 h-6" />
                  </button>
                )}
              </div>
            </section>
          );
        })}

        {total > 0 && <section className="relative h-full w-full snap-start flex flex-col items-center justify-center text-center px-6 bg-gradient-to-t from-rp-fire/40 via-black to-black">
          <Icon name="sparkle" className="w-12 h-12 text-rp-amber" />
          <h2 className="mt-3 text-[26px] font-extrabold leading-tight">{tm.endTitle}</h2>
          <p className="mt-2 text-[16px] text-white/80 max-w-sm">{tm.endBody({ liked: liked.size })}</p>
          <button type="button" onClick={onNextGame}
            className="mt-7 min-h-[48px] px-6 rounded-2xl bg-gradient-to-l from-rp-fire to-rp-amber text-white text-[17px] font-bold shadow-lg shadow-rp-fire/40">
            {tm.nextGame}
          </button>
        </section>}
      </div>

      <div className="pointer-events-none absolute top-0 inset-x-0 flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        {at >= 1 && at <= total ? (
          <span className="pointer-events-none rounded-full bg-black/40 px-3 py-1 text-[13px] font-semibold tabular-nums">{tm.count({ i: at, n: total })}</span>
        ) : <span />}
        <button type="button" onClick={onClose} aria-label={tm.close} className={`pointer-events-auto ${TAP_TARGET} rounded-full bg-black/40 text-white`}>
          <Icon name="close" className="w-6 h-6" />
        </button>
      </div>
    </div>
  ), document.body);
}

function FeedVideo({ src, poster, active, muted }: { src: string; poster: string; active: boolean; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) void v.play().catch(() => undefined); else v.pause();
  }, [active]);
  return (
    <video ref={ref} src={active ? src : undefined} poster={poster || undefined} muted={muted} loop playsInline preload="none"
      className="absolute inset-0 w-full h-full object-contain bg-black" />
  );
}
