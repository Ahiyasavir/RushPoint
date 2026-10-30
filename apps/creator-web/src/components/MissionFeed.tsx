// The first look at a composed game (change: first-visit-instant-build). A short building moment, then
// every mission fills the screen, one at a time. Ahiya, 30.10: people must want to keep going.
//
// Why a feed: the thumb is already there, every card is a small surprise (a list spoils them all at
// once), and "swipe to keep, dice to swap" turns reading into choosing, so the game ends up theirs. It is
// not endless: the last card names the game and sends it to a friend, which is the only "more" that is
// real. Scrolling is the browser's own scroll snap, so it behaves like every feed they know, and the
// feed works from the keyboard and with reduced motion without a line of gesture code.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import type { Game } from '@rushpoint/shared';
import { rollNames } from '../lib/missionNames';
import { shareWithFriends } from '../lib/friendShare';
import { buildMsLeft, pickHighlights } from '../lib/quickStart';
import BuildingMoment from './BuildingMoment';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { TAP_TARGET } from '../lib/interaction';
import { track, trackLeaving } from '../lib/track';
import { playSetupSound, soundEnabled, type SetupSound } from '../lib/setupSounds';
import { unlockAudio } from '../lib/sound';
import { hasSwiped, markSwiped } from '../lib/setupSwipe';

export interface MissionFeedProps {
  game: Game;
  /** When the building moment began, on the dashboard. It goes on from there instead of starting over. */
  buildStartedAt?: unknown;
  /** Swap one mission from the bank, in place. False when none is left. */
  onSwap: (stageId: string, taskId: string) => boolean;
  onTitle: (title: string) => void;
  /** Saves now, so a link sent to a friend shows what the creator sees. */
  onFlush: () => Promise<unknown>;
  onDone: () => void;
}

export default function MissionFeed({ game, buildStartedAt, onSwap, onTitle, onFlush, onDone }: MissionFeedProps) {
  const t = useT();
  const f = t.missionFeed;
  const reduce = useReducedMotion();
  const [building, setBuilding] = useState(!reduce);
  const [at, setAt] = useState(0);
  const [swiped, setSwiped] = useState(hasSwiped);
  const [swapTick, setSwapTick] = useState(0);
  const [rolling, setRolling] = useState<{ taskId: string; name: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  // Said on the card itself: the app's toasts sit under this full screen layer.
  const [shareNote, setShareNote] = useState('');
  const shareToken = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const play = (k: SetupSound) => playSetupSound(k, soundEnabled());
  const lastAt = useRef(0);
  // With a mouse the dice sounds on the press. Not with a finger: a swipe often starts on this button.
  const pressedAt = useRef(0);

  const cards = useMemo(() => [...(game.stages ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((stage, i) => (stage.tasks ?? []).map((task) => ({ stage, stageNumber: i + 1, task }))), [game.stages]);

  // Whole missions get a screen only up to a handful; the rest are listed on one card, each with its dice.
  const shown = useMemo(() => {
    const picked = new Set(pickHighlights(cards.map((c) => c.task.id)));
    return cards.filter((c) => picked.has(c.task.id));
  }, [cards]);
  const rest = useMemo(() => cards.filter((c) => !shown.includes(c)), [cards, shown]);
  const atRest = rest.length > 0 ? shown.length : -1;
  const nameAt = shown.length + (rest.length > 0 ? 1 : 0);

  useEffect(() => {
    if (!building) return;
    const end = window.setTimeout(() => setBuilding(false), buildMsLeft(buildStartedAt, Date.now()));
    return () => window.clearTimeout(end);
  }, [building, buildStartedAt]);

  const atNow = useRef(0);
  atNow.current = at;
  useEffect(() => trackLeaving(() => ({ where: 'feed', step: atNow.current })), []);

  useEffect(() => {
    if (building) return;
    scroller.current?.focus({ preventScroll: true });
    play('step');
    track('feed_opened', { missions: cards.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  // Each card kept is a success: the drop climbs as they swipe on.
  const landOn = (i: number) => {
    if (i === at) return;
    setAt(i);
    if (i > 0 && !swiped) { setSwiped(true); markSwiped(); }
    if (i > lastAt.current) {
      play(i >= nameAt ? 'stage' : 'check');
      if (i === atRest) track('feed_rest'); else track('feed_card', { n: i + 1 });
    }
    lastAt.current = Math.max(lastAt.current, i);
  };

  const roll = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(roll.current), []);
  const swap = (stageId: string, taskId: string) => {
    if (rolling) return;
    const land = () => {
      setRolling(null);
      if (onSwap(stageId, taskId)) { setSwapTick((n) => n + 1); track('feed_swap'); }
    };
    if (Date.now() - pressedAt.current > 1000) play('swap');
    pressedAt.current = 0;
    const names = reduce ? [] : rollNames(4);
    if (names.length === 0) { land(); return; }
    let i = 0;
    setRolling({ taskId, name: names[0] });
    roll.current = window.setInterval(() => {
      i += 1;
      if (i < names.length) { setRolling({ taskId, name: names[i] }); return; }
      window.clearInterval(roll.current);
      land();
    }, 95);
  };

  async function share() {
    if (sharing) return;
    setSharing(true);
    setShareNote('');
    try {
      await onFlush();
      const result = await shareWithFriends(game, f.shareText({ title: game.title }), shareToken);
      if (result === 'shared' || result === 'copied') { track('feed_shared'); play('finish'); }
      if (result === 'copied') setShareNote(f.shareCopied);
      if (result === 'failed') setShareNote(f.shareFailed);
    } catch {
      setShareNote(f.shareFailed);
    } finally {
      setSharing(false);
    }
  }

  const finish = () => { track('feed_finished', { swaps: swapTick }); onDone(); };
  const total = shown.length;

  return createPortal(
    <div onPointerDown={unlockAudio} className="fixed inset-0 z-[70] rp-setup-bg text-[--ink-1]" role="dialog" aria-modal="true" aria-label={f.title}>
      {building && <BuildingMoment onSkip={() => setBuilding(false)} />}

      <div className="absolute inset-x-0 top-0 z-[5] px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="h-1.5 rounded-full bg-[--surface-2] overflow-hidden" aria-hidden="true">
          <div className="h-full bg-rp-fire transition-all duration-200 motion-reduce:transition-none"
            style={{ inlineSize: `${Math.round(((at + 1) / (nameAt + 1)) * 100)}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[14px] font-bold text-[--ink-2]">
            {at < total ? f.count({ n: at + 1, total }) : f.lastCount({ total: cards.length })}
          </span>
          <button type="button" onClick={finish} className={`${TAP_TARGET} -m-2 px-3 text-[14px] font-semibold text-[--ink-2] hover:text-[--ink-1]`}>{f.skip}</button>
        </div>
      </div>

      <div
        ref={scroller} tabIndex={0} aria-label={f.title}
        onScroll={(e) => { const el = e.currentTarget; landOn(Math.round(el.scrollTop / Math.max(1, el.clientHeight))); }}
        className="h-full overflow-y-scroll snap-y snap-mandatory overscroll-contain outline-none [scrollbar-width:none]"
      >
        {shown.map(({ stage, stageNumber, task }, i) => {
          const spin = rolling?.taskId === task.id;
          return (
            <section key={task.id} aria-hidden={i !== at} className="relative h-full snap-start snap-always flex flex-col justify-center px-4 pt-20 pb-36">
              <motion.div key={swapTick} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                className="mx-auto w-full max-w-xl rounded-3xl border border-[--rp-border] bg-[--surface-0] p-6 shadow-lg shadow-rp-fire/10">
                <p className="text-[15px] font-bold text-ink-fire" dir="auto">{f.stage({ n: stageNumber, title: stage.title ?? '' })}</p>
                <h2 className="mt-3 font-brand text-[34px] sm:text-5xl font-extrabold leading-[1.1]" dir="auto">{spin ? rolling?.name : task.title}</h2>
                <p className={`mt-4 text-[18px] leading-relaxed text-[--ink-2] transition-opacity motion-reduce:transition-none ${spin ? 'opacity-20' : ''}`} dir="auto">{task.description}</p>
              </motion.div>
              <div className="absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+28px)] flex flex-col items-center gap-3">
                <button type="button" onClick={() => swap(stage.id, task.id)} disabled={!!rolling}
                  onPointerDown={(e) => { if (e.pointerType === 'mouse' && !rolling) { pressedAt.current = Date.now(); play('swap'); } }}
                  className="inline-flex min-h-[52px] items-center gap-2 rounded-2xl border-2 border-dashed border-rp-fire/50 bg-[--surface-0] px-6 text-[17px] font-bold text-ink-fire active:scale-95 transition-transform motion-reduce:transform-none hover:bg-rp-fire/10">
                  <Icon name="dice" className="w-5 h-5" />{f.swap}
                </button>
                {i === 0 && !swiped && <Icon name="chevronUp" role="img" aria-hidden={false} aria-label={f.swipeHint} className="w-7 h-7 text-ink-fire rp-swipe-hint" />}
              </div>
            </section>
          );
        })}

        {rest.length > 0 && (
          <section aria-hidden={at !== atRest} className="relative h-full snap-start snap-always flex flex-col gap-3 px-4 pt-20 pb-10 max-w-xl mx-auto">
            <h2 className="shrink-0 font-brand text-[30px] font-extrabold leading-tight">{f.restTitle({ n: rest.length })}</h2>
            <p className="shrink-0 text-[16px] leading-snug text-[--ink-2]">{f.restSub}</p>
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-[--rp-border] rounded-2xl border border-[--rp-border] bg-[--surface-0]">
              {rest.map(({ stage, task }) => (
                <li key={task.id} className="flex items-center gap-2 ps-4 pe-1">
                  <span className="min-w-0 flex-1 truncate text-[16px] font-semibold" dir="auto">{rolling?.taskId === task.id ? rolling.name : task.title}</span>
                  <button type="button" onClick={() => swap(stage.id, task.id)} disabled={!!rolling} aria-label={f.restSwap({ title: task.title ?? '' })}
                    className={`${TAP_TARGET} shrink-0 text-ink-fire`}><Icon name="dice" className="w-5 h-5" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-hidden={at !== nameAt} className="relative h-full snap-start snap-always flex flex-col justify-center gap-4 px-6 pt-20 pb-10 max-w-xl mx-auto">
          <Icon name="sparkle" className="w-10 h-10 text-ink-fire" />
          <h2 className="font-brand text-[34px] font-extrabold leading-tight">{f.nameTitle}</h2>
          <p className="text-[17px] leading-snug text-[--ink-2]">{f.nameSub}</p>
          <input
            value={game.title} onChange={(e) => onTitle(e.target.value)} dir="auto" aria-label={f.nameTitle}
            className="min-h-[52px] rounded-2xl border-2 border-[--rp-border] bg-[--surface-0] px-4 text-[18px] font-semibold text-[--ink-1] outline-none focus:border-rp-fire"
          />
          <button type="button" onClick={() => void share()} disabled={sharing} onPointerDown={() => play('tap')}
            className="min-h-[56px] rounded-2xl bg-gradient-to-l from-rp-fire to-rp-amber px-5 text-[18px] font-extrabold text-white shadow-md shadow-rp-fire/30 active:scale-95 transition-transform motion-reduce:transform-none disabled:opacity-60">
            {f.shareCta}
          </button>
          <p role="status" className="min-h-[24px] text-center text-[15px] font-semibold text-ink-fire">{shareNote}</p>
          <button type="button" onClick={finish} className="min-h-[48px] rounded-2xl text-[16px] font-bold text-[--ink-1] hover:bg-rp-fire/10">{f.continue}</button>
        </section>
      </div>
    </div>,
    document.body,
  );
}
