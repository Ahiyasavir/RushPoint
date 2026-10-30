// The full-screen setup walk (change: setup-flow-full-screen).
//
// Ahiya, 22.10: "take him step by step through every mission, the whole screen dedicated to it, no
// distractions; a screen made for this, not the mission editor; where I put _____ make a box you can
// type into; an 'I'll edit it myself' button on the side; at the end show him the route and
// everything; light animations that never make him wait; a clear progress bar with stages; phone,
// tablet and desktop; on a phone nothing scrolls where it can be avoided, everything in the frame".
//
// LAYOUT RULE: the shell is exactly the viewport (header, body, footer), and every screen is a column
// of that body's height. Text takes what it needs and the one big control on a screen (the map, the
// route) takes the rest (`flex-1`), so the screen fills the frame instead of growing past it. The body
// keeps `overflow-y-auto` only as the safety net for a very small phone or a very long text.
//
// What to show is decided in lib/setupFlow.ts (pure, tested). Every edit goes straight to the live game
// through the Builder's own setters, so the Builder's autosave is the only save path.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { isSampleStep, type Game, type Task, type TaskMedia, type TemplateWizardStep } from '@rushpoint/shared';
import { useT, useLanguage } from './LanguageContext';
import { Button } from './ui';
import { Icon, type IconName } from './Icon';
import { track, trackLeaving } from '../lib/track';
import { walkEnding, calendarUrl } from '../lib/walkEnding';
import { friendLink, shareWithFriends } from '../lib/friendShare';
import { daysUntilEvent } from '@rushpoint/shared';
import LocationStep from './LocationStep';
import RoutePreviewMap from './RoutePreviewMap';
import ConfettiBurst from './ConfettiBurst';
import TaskWizard from './TaskWizard';
import { uploadTaskMedia } from '../services/firebase';
import { SENTENCE_FIELDS, setupReadinessPct } from '../lib/quickSetup';
import NumberFlow from '@number-flow/react';
import { playSetupSound, soundEnabled, setSoundEnabled, type SetupSound } from '../lib/setupSounds';
import { TAP_CLUSTER, TAP_TARGET } from '../lib/interaction';
import { swipeVerdict, swipePull, NO_SWIPE_SELECTOR, typingNow, WALK_WIDE_QUERY, hasSwiped, markSwiped } from '../lib/setupSwipe';
import { firstImageFile } from '../lib/imageInput';
import { parseSentence, hasOpenSlots, extractSlotValues, fillTemplate, generateCode, plainBlanks, asCreatorBlanks } from '../lib/sentenceForm';
import { isAcceptedTaskMedia } from '../lib/mediaAccept';
import { toast } from './toast';
import { rollNames } from '../lib/missionNames';
import {
  buildSetupScreens, buildSetupBeats, firstBeat, hasRouteToShow, praiseIndex, stageProgress, planStages,
  beforeGameList, codeNeedsSign, gameFieldValue, withGameField, prepShareText, whatsappShareUrl,
  type SetupItem, type SetupScreen, type SetupBeat,
} from '../lib/setupFlow';

/** What the teams will read, with each blank the creator still owes shown as a line, not as the note to the creator. */
function blanked(text: string): string {
  return parseSentence(text).map((p) => (p.kind === 'text' ? p.text : '_____')).join('');
}

/** Brand confetti from the top of the screen; loaded on demand, silent under reduced motion. */
async function burst(power: number): Promise<void> {
  try {
    const confetti = (await import('canvas-confetti')).default;
    const base = { disableForReducedMotion: true, zIndex: 90, colors: ['#FF5722', '#FFB300', '#10B981', '#7C3AED', '#FFFFFF'] };
    void confetti({ ...base, particleCount: Math.round(60 * power), spread: 70, startVelocity: 38, origin: { x: 0.5, y: 0.15 } });
    if (power >= 1) {
      setTimeout(() => void confetti({ ...base, particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.6 } }), 180);
      setTimeout(() => void confetti({ ...base, particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.6 } }), 180);
    }
  } catch { /* decoration only */ }
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export interface SetupFlowProps {
  game: Game;
  steps: readonly TemplateWizardStep[];
  /** Arriving from the composer starts at the plan; resumed later it opens on the first open item. */
  resume: boolean;
  /** Coming back to a finished game that waits for its date: open on the ready screen. */
  startReady?: boolean;
  onTaskChange: (stageId: string, task: Task) => void;
  onGameChange: (game: Game) => void;
  /** "I'll edit it myself": leave the walk for the full editor, on this mission when there is one. */
  onEditMyself: (stageId: string | null, taskId: string | null) => void;
  /** "Another mission": swap this mission for another from the bank, in place. False when none is left. */
  onRegenerate?: (stageId: string, taskId: string) => boolean;
  onLaunch: () => void;
  /** Saves now, so a link sent to a friend shows what the creator sees. */
  onFlush: () => Promise<unknown>;
  /** The ready screen's way out: back to the creator's games. */
  onHome: () => void;
  /** A guest only. */
  onSaveAccount?: () => void;
  /** "Play it myself": a test run of this game, opened from the walk (the moment it is seen working). */
  onTestDrive?: () => void;
  onDone: () => void;
  gameAnchors?: readonly { lat: number; lng: number }[];
}

type SF = ReturnType<typeof useT>['setupFlow'];


function taskIn(game: Game, stageId: string, taskId: string): Task | null {
  const st = (game.stages ?? []).find((s) => s.id === stageId);
  return (st?.tasks ?? []).find((t) => t.id === taskId) ?? null;
}

export default function SetupFlow({
  game, steps, resume, startReady, onTaskChange, onGameChange, onEditMyself, onRegenerate, onLaunch, onFlush, onHome, onSaveAccount, onTestDrive, onDone, gameAnchors,
}: SetupFlowProps) {
  const sf = useT().setupFlow;
  const { lang } = useLanguage();
  const reduce = useReducedMotion();
  const rtl = lang === 'he';

  // Live: an item turns "configured" the moment its field is filled. The LIST is stable (the steps
  // are), so the walk never renumbers itself under the creator.
  const screens = useMemo(() => buildSetupScreens(game, steps, lang), [game, steps, lang]);
  const beats = useMemo(() => buildSetupBeats(screens), [screens]);
  const [at, setAt] = useState(() => firstBeat(beats, screens, resume));
  const [dir, setDir] = useState(1);
  const [prevDone, setPrevDone] = useState(false);
  // A swapped mission keeps its id, so the beat index alone would not replay the entrance.
  const [swapTick, setSwapTick] = useState(0);
  const [swapped, setSwapped] = useState<string | null>(null);
  // "Let's finish it" from the almost screen: Next walks only the open items, then back to the route.
  const [fixing, setFixing] = useState(false);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const play = (k: SetupSound) => playSetupSound(k, soundOn);
  // A whole stage just finished: a short cheer that never blocks a press.
  const [cheer, setCheer] = useState<number | null>(null);
  useEffect(() => { if (cheer === null) return; const id = setTimeout(() => setCheer(null), 1700); return () => clearTimeout(id); }, [cheer]);
  const beat = beats[Math.min(at, beats.length - 1)];
  const progress = useMemo(() => stageProgress(game, screens, beats, at), [game, screens, beats, at]);
  const missionScreens = screens.filter((s) => s.scope === 'task');
  const sortedStages = useMemo(() => (game.stages ?? []).slice().sort((a, b) => a.order - b.order), [game.stages]);

  const itemAt = (i: number): { screen: SetupScreen; item: SetupItem } | null => {
    const b = beats[i];
    return b && b.kind === 'item' ? { screen: screens[b.screen], item: screens[b.screen].items[b.item] } : null;
  };
  // A page turned by a swipe slides up or down like a feed; one turned by a button slides sideways.
  const [vertical, setVertical] = useState(false);
  // Finishing a stage is a moment of its own (goal gradient: the next stage starts with a win).
  const stageClosedBy = (to: number) => {
    const cur = itemAt(at);
    if (to <= at || !cur || cur.screen.scope !== 'task' || beats[to]?.kind !== 'item') return false;
    const next = itemAt(to);
    return next?.screen.stageId !== cur.screen.stageId
      && screens.filter((x) => x.stageId === cur.screen.stageId).every((x) => x.done);
  };
  const soundOfMove = (to: number): SetupSound => {
    if (stageClosedBy(to)) return 'stage';
    return to > at && itemAt(at)?.item.configured ? 'step' : 'tap';
  };
  // A click arrives when the finger lifts, which is late for a sound: the button plays on the press
  // and the move itself stays on the click, so it can still be cancelled by sliding off.
  const pressedAt = useRef(0);
  const pressMove = (to: number) => {
    pressedAt.current = Date.now();
    play(soundOfMove(to));
  };
  const [swiped, setSwiped] = useState(hasSwiped);
  const go = (to: number, opts?: { swipe?: boolean }) => {
    setVertical(!!opts?.swipe);
    if (opts?.swipe && !swiped) { setSwiped(true); markSwiped(); }
    const clamped = Math.max(0, Math.min(beats.length - 1, to));
    const cur = itemAt(at);
    const forward = clamped > at;
    setPrevDone(!!cur && cur.item.configured && forward);
    const sounded = Date.now() - pressedAt.current < 1000;
    pressedAt.current = 0;
    if (!sounded) play(soundOfMove(clamped));
    if (stageClosedBy(clamped) && cur) {
      const n = sortedStages.findIndex((x) => x.id === cur.screen.stageId) + 1;
      if (n > 0) { setCheer(n); void burst(0.35); }
    }
    setDir(clamped >= at ? 1 : -1);
    setAt(clamped);
  };

  const [ready, setReady] = useState(false);
  const ending = walkEnding(game.eventAt, new Date().toISOString());
  const stepNow = useRef('');
  stepNow.current = beat.kind === 'item' ? `item:${at}` : beat.kind;
  useEffect(() => { track('walk_started'); return trackLeaving(() => ({ where: 'walk', step: stepNow.current })); }, []);
  useEffect(() => {
    track('walk_step', { step: stepNow.current });
    if (beat.kind === 'finish') track('walk_finished');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, beat.kind]);
  const openReady = () => { setReady(true); track('walk_ready'); play('finish'); void burst(1); };

  const isOpen = (i: number) => { const x = itemAt(i); return !!x && x.item.required && !x.item.configured; };
  const finishAt = beats.findIndex((b) => b.kind === 'finish');
  const nextFrom = (i: number) => {
    if (!fixing) return i + 1;
    for (let j = i + 1; j < beats.length; j++) if (isOpen(j)) return j;
    return finishAt >= 0 ? finishAt : i + 1;
  };
  const startFixing = () => {
    const first = beats.findIndex((_, i) => isOpen(i));
    if (first < 0) return;
    setFixing(true);
    go(first);
  };
  useEffect(() => { if (beat.kind === 'finish' || beat.kind === 'prep') setFixing(false); }, [beat.kind]);

  // After a swap the new mission's items replace the old ones: land on its first item.
  useEffect(() => {
    if (!swapped) return;
    const i = beats.findIndex((b) => b.kind === 'item' && screens[b.screen].taskId === swapped);
    if (i >= 0) setAt(i);
    setSwapped(null);
  }, [beats, screens, swapped]);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [at]);

  const current = itemAt(at);
  // A map screen and the finish fill exactly the window, so the map takes what is left. Every other
  // screen grows with its content and the window scrolls as one page: capping those at the window
  // height pushed their top out of reach and cut their cards at the frame (29.10, 1000x457).
  const fillsScreen = beat.kind === 'finish' || (beat.kind === 'item' && !!current && FILLS.has(current.item.fieldPath));
  // "אערוך לבד" asks first while anything is still open (Ahiya 27.10). Escape and the backdrop keep
  // the creator in the walk: leaving has to be the deliberate choice, never the accidental one.
  const [leaveAsk, setLeaveAsk] = useState(false);
  useEffect(() => {
    if (!leaveAsk) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setLeaveAsk(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [leaveAsk]);
  const editMyself = (stageId: string | null, taskId: string | null, force = false) => {
    if (!force && openLeft > 0) { setLeaveAsk(true); return; }
    onEditMyself(stageId, taskId);
  };
  const land = (stageId: string, taskId: string) => {
    if (!onRegenerate) return;
    if (onRegenerate(stageId, taskId)) {
      setSwapped(taskId);
      setDir(1);
      setSwapTick((n) => n + 1);
    }
  };
  // The roll (change: creator-engagement-loop, variable reward): for a moment the dice spins through
  // real mission names from the bank before the new one lands. The anticipation is the point (the
  // dopamine studies put the response on the cue, strongest while the outcome is unknown), so it is
  // short (about 400ms), every name in it is a real mission, and a second press lands at once.
  // No quality label: the ratings stay hidden from creators (his decision, 22.10).
  const [rolling, setRolling] = useState<string | null>(null);
  const roll = useRef<{ timer: number; stageId: string; taskId: string } | null>(null);
  useEffect(() => () => { if (roll.current) window.clearInterval(roll.current.timer); }, []);
  const regenerate = () => {
    if (!current || current.screen.scope !== 'task' || !onRegenerate) return;
    if (roll.current) {
      const r = roll.current; window.clearInterval(r.timer); roll.current = null; setRolling(null); land(r.stageId, r.taskId); return;
    }
    // On the press, with the roll: the sound is the dice, and it was landing 400ms after the finger.
    play('swap');
    const { stageId, taskId } = current.screen;
    const names = reduce ? [] : rollNames(4);
    if (names.length === 0) { land(stageId, taskId); return; }
    let i = 0;
    setRolling(names[0]);
    const timer = window.setInterval(() => {
      i++;
      if (i < names.length) { setRolling(names[i]); return; }
      window.clearInterval(timer); roll.current = null; setRolling(null); land(stageId, taskId);
    }, 95);
    roll.current = { timer, stageId, taskId };
  };
  // The moment a field becomes filled: a bright drop, a "saved" mark, and Next lights up.
  const filledKey = current ? `${current.screen.key}|${current.item.stepId}` : '';
  const wasFilled = useRef<{ key: string; on: boolean }>({ key: '', on: false });
  const touched = useRef(new Set<string>());
  const changeTask = (stageId: string, task: Task) => { touched.current.add(filledKey); onTaskChange(stageId, task); };
  const [justFilled, setJustFilled] = useState(0);
  useEffect(() => {
    const on = !!current?.item.configured;
    const prev = wasFilled.current;
    if (prev.key === filledKey && !prev.on && on) { play('check'); setJustFilled((n) => n + 1); }
    wasFilled.current = { key: filledKey, on };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filledKey, current?.item.configured]);

  // The end is what is remembered (peak-end): the finished game gets the biggest moment of the walk.
  const finishOpen = beats.some((b, i) => b.kind === 'item' && (() => { const x = itemAt(i); return !!x && x.item.required && !x.item.configured; })());
  useEffect(() => {
    if (beat.kind !== 'finish') return;
    if (!finishOpen) { play('finish'); void burst(1); } else play('stage');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat.kind]);

  // Overall readiness, with every mission already built counted as a step done (endowed progress: the
  // creator starts ahead, because they are ahead; setupReadinessPct says why the build counts in full).
  const items = beats.map((_, i) => itemAt(i)).filter((x): x is NonNullable<ReturnType<typeof itemAt>> => !!x);
  // Counted over what is REQUIRED, the same set "N more and you're done" counts: optional items in
  // the denominator made the % crawl while the creator was nearly done (research 27.10).
  const counted = items.some((x) => x.item.required) ? items.filter((x) => x.item.required) : items;
  const doneItems = counted.filter((x) => x.item.configured).length;
  const missionCount = sortedStages.reduce((n, s) => n + (s.tasks?.length ?? 0), 0);
  const pctRaw = setupReadinessPct({ missions: missionCount, done: doneItems, required: counted.length });
  const pct = (beat.kind === 'finish' || beat.kind === 'prep') && !finishOpen ? 100 : pctRaw;
  // A game with nothing open reads 100 from its first screen, above a bar that has barely moved.
  const showPct = items.length > 0 && (pct < 100 || beat.kind === 'finish');
  const openLeft = items.filter((x) => x.item.required && !x.item.configured).length;
  useLayoutEffect(() => { if (startReady && openLeft === 0 && (ending === 'later' || ending === 'today')) setReady(true); }, [startReady]);

  const stageIndex = current ? sortedStages.findIndex((s) => s.id === current.screen.stageId) : -1;
  const missionNumber = current && current.screen.scope === 'task' ? missionScreens.findIndex((s) => s.key === current.screen.key) + 1 : 0;
  const placeLine = [
    stageIndex >= 0 ? sf.stageOf({ n: stageIndex + 1, title: sortedStages[stageIndex].title ?? '' }) : '',
    missionNumber > 0 ? sf.missionOf({ n: missionNumber, total: missionScreens.length }) : '',
  ].filter(Boolean).join(' · ');

  // Motion: short and directional, never a wait (Ahiya: "light, simple, and they must not take the
  // user's time"). Forward slides the way the reading direction moves.
  const offset = reduce ? 0 : (rtl ? -1 : 1) * 24 * dir;
  const rise = reduce ? 0 : 56 * dir;
  const variants = vertical ? {
    enter: { opacity: 0, y: rise, x: 0 },
    center: { opacity: 1, y: 0, x: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { opacity: 0, y: -rise, x: 0, transition: { duration: 0.08, ease: 'easeIn' as const } },
  } : {
    enter: { opacity: 0, x: offset, y: 0 },
    center: { opacity: 1, x: 0, y: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { opacity: 0, x: -offset, y: 0, transition: { duration: 0.1, ease: 'easeIn' as const } },
  };

  // Phone swipe (28.10), beside the buttons: up at the bottom of a screen goes on, down at its top
  // goes back (lib/setupSwipe.ts decides). It never launches: only an item or the plan goes on.
  const touch = useRef<{ x: number; y: number; t: number; top: boolean; bottom: boolean } | null>(null);
  // The screen follows the finger past its end (28.10: "the scroll looks stuck"): before this, a swipe
  // at the end moved nothing until the finger lifted, then the page jumped. `pull` is that offset.
  const pull = useMotionValue(0);
  const onTouchMove = (e: ReactTouchEvent) => {
    const start = touch.current;
    const t1 = e.touches[0];
    if (!start || !t1 || reduce) return;
    pull.set(swipePull({ dx: t1.clientX - start.x, dy: start.y - t1.clientY,
      atTopAtStart: start.top, atBottomAtStart: start.bottom, canGoBack: at > 0, canGoOn: beat.kind === 'item' || beat.kind === 'plan' }));
  };
  const onTouchStart = (e: ReactTouchEvent) => {
    const el = bodyRef.current;
    const target = e.target as Element | null;
    if (!el || e.touches.length !== 1 || window.matchMedia(WALK_WIDE_QUERY).matches || target?.closest(NO_SWIPE_SELECTOR) || typingNow(document.activeElement)) { touch.current = null; return; }
    const t0 = e.touches[0];
    touch.current = { x: t0.clientX, y: t0.clientY, t: performance.now(),
      top: el.scrollTop <= 2, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 4 };
  };
  const swipeNext = () => {
    if (beat.kind === 'item' || beat.kind === 'plan') go(beat.kind === 'plan' ? at + 1 : nextFrom(at), { swipe: true });
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const t1 = e.changedTouches[0];
    if (!start || !t1) return;
    const verdict = swipeVerdict({ dx: t1.clientX - start.x, dy: start.y - t1.clientY, ms: performance.now() - start.t,
      atTopAtStart: start.top, atBottomAtStart: start.bottom });
    if (verdict === 'next' && (beat.kind === 'item' || beat.kind === 'plan')) swipeNext();
    else if (verdict === 'back' && at > 0) go(at - 1, { swipe: true });
    // Not a page turn: the screen springs back under the finger. A turn leaves it where it is, so the
    // old screen leaves from where the finger let go; `onExitComplete` zeroes it for the new one.
    else void animate(pull, 0, { type: 'spring', stiffness: 520, damping: 38 });
  };

  const prefilledUntouched = !!current && current.item.configured && !touched.current.has(filledKey)
    && ['smart.secretCode', 'answers', 'numericAnswer'].includes(current.item.fieldPath);
  const primary = (() => {
    if (beat.kind === 'plan') return { label: sf.planCta, to: at + 1, onClick: () => go(at + 1), arrow: true };
    // Launch never bounces the creator out of the walk to a list of problems: while something required is
    // open, it brings them to the first one, inside the walk (research 29.10).
    if (beat.kind === 'prep') return { label: openLeft > 0 ? sf.launch : ending === 'later' ? sf.readyCta : ending === 'today' ? sf.launchToday : sf.launch, to: undefined, onClick: () => {
      const first = beats.findIndex((b, i) => b.kind === 'item' && (() => { const x = itemAt(i); return !!x && x.item.required && !x.item.configured; })());
      if (first < 0) { if (ending === 'later') openReady(); else onLaunch(); return; }
      toast.info(sf.launchFirstLeft({ n: openLeft }));
      go(first);
    }, arrow: false };
    if (beat.kind === 'finish' && !finishOpen) return { label: sf.finishCta, to: at + 1, onClick: () => go(at + 1), arrow: true };
    if (current?.item.kind === 'prep' && current.item.configured) return { label: sf.prepCta, to: nextFrom(at), onClick: () => go(nextFrom(at)), arrow: true };
    if (prefilledUntouched) return { label: sf.keepIt, to: nextFrom(at), onClick: () => go(nextFrom(at)), arrow: true };
    return { label: sf.next, to: nextFrom(at), onClick: () => go(nextFrom(at)), arrow: true };
  })();
  const skipping = !!current && current.item.required && !current.item.configured;

  // `overflow-clip`, not hidden: the decorative orbs reach ~200px past the edge, and a hidden box can
  // still be SCROLLED, so focusing the map search slid the whole screen sideways (27.10).
  // Portalled to the body: rendered inside the Builder it sat in the Builder's stacking context, and
  // the live-run bar (z-30, on the body) drew over it.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={sf.aria}
      className="fixed inset-0 z-[70] flex flex-col h-[100dvh] rp-setup-bg text-[--ink-1] overflow-clip">
      {ready && <LaterEnding game={game} onFlush={onFlush} onHome={onHome} onEdit={onDone} onSaveAccount={onSaveAccount} onLaunch={onLaunch} />}
      <span aria-hidden className="rp-setup-orb rp-setup-orb-1" />
      <span aria-hidden className="rp-setup-orb rp-setup-orb-2" />
      <AnimatePresence>
        {cheer !== null && (
          <motion.div key={cheer} role="status"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }}
            transition={reduce ? { duration: 0.1 } : { type: 'spring', stiffness: 420, damping: 24 }}
            // On a short window it rides over the header instead of the step's own heading (29.10).
            className="pointer-events-none fixed inset-x-0 top-28 [@media(max-height:560px)]:top-1.5 z-[80] mx-auto w-fit max-w-[90vw] rounded-3xl bg-gradient-to-l from-rp-fire to-rp-amber px-6 py-3.5 [@media(max-height:560px)]:py-2 text-center text-white shadow-2xl shadow-rp-fire/40">
            <div className="flex items-center justify-center gap-2 text-[20px] sm:text-2xl [@media(max-height:560px)]:text-[18px] font-extrabold"><Icon name="trophy" className="w-6 h-6" />{sf.stageDone({ n: cheer })}</div>
            <div className="text-[14px] sm:text-[15px] font-semibold opacity-95 [@media(max-height:560px)]:hidden">{sf.stageDoneSub}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {leaveAsk && (
          <motion.div key="leave" role="alertdialog" aria-modal="true" aria-labelledby="rp-leave-title"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
            onClick={() => setLeaveAsk(false)}
            className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-sm p-3 sm:p-6">
            <motion.div onClick={(e) => e.stopPropagation()}
              initial={reduce ? false : { y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 32 }}
              className="w-full max-w-md rounded-3xl bg-[--surface-0] p-5 sm:p-6 shadow-2xl">
              <div className="flex items-center gap-3">
                <span className="relative inline-flex w-14 h-14 shrink-0 items-center justify-center rounded-full bg-rp-fire/10 text-ink-fire text-[17px] font-extrabold">
                  <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={`${(pct / 100) * 97.4} 97.4`} />
                  </svg>
                  {pct}%
                </span>
                <h2 id="rp-leave-title" className="text-[22px] sm:text-2xl font-extrabold leading-tight">{sf.leaveTitle}</h2>
              </div>
              <p className="mt-3 text-[17px] leading-snug text-[--ink-1]">{sf.leaveBody({ pct, n: openLeft, min: Math.max(1, Math.round((openLeft * 20) / 60)) })}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[14px] text-[--ink-2]"><Icon name="checkCircle" className="w-4 h-4 text-ink-go shrink-0" />{sf.leaveSaved}</p>
              <div className="mt-5 flex flex-col gap-2">
                <Button autoFocus onClick={() => setLeaveAsk(false)} className="w-full min-h-[52px] text-[17px] font-bold">{sf.leaveStay}</Button>
                <button type="button" onClick={() => { setLeaveAsk(false); editMyself(current?.screen.stageId || null, current?.screen.taskId || null, true); }}
                  className="min-h-[44px] text-[15px] font-semibold text-[--ink-2] hover:text-[--ink-1]">{sf.leaveGo}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ── Header: the progress by stage, and the side door out ───────────────────────────── */}
      <header className="relative z-10 shrink-0 border-b border-[--rp-border]/60 bg-[--surface-0]/70 backdrop-blur-xl pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div className="mx-auto w-full max-w-5xl walk:max-w-[min(92vw,1400px)] px-4 pb-2.5 [@media(max-height:560px)]:pb-1.5">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-[15px] font-bold min-w-0">
              <span className="inline-flex w-8 h-8 shrink-0 items-center justify-center rounded-full bg-rp-fire/10 text-ink-fire"><Icon name="sparkle" className="w-4 h-4" /></span>
              <span className={`truncate ${onRegenerate && current?.screen.scope === 'task' ? 'hidden sm:inline' : ''}`}>{sf.aria}</span>
            </span>
            {/* A short window (a laptop zoomed in, 28.10: 457 px tall) has no row to spare: the readiness
                moves up beside the title, and the row under the bar is not drawn. */}
            {showPct && (
              <span className="hidden [@media(max-height:560px)]:inline-flex items-baseline gap-1 text-[13px] font-extrabold text-ink-fire shrink-0">
                <NumberFlow value={pct} suffix="%" />
                <span className="font-semibold">{sf.readyWord}</span>
              </span>
            )}
            <div className="ms-auto shrink-0 flex items-center gap-2">
              {onRegenerate && current?.screen.scope === 'task' && (
                <button type="button" onClick={regenerate} aria-label={sf.newMissionAria} title={sf.newMissionAria}
                  className="min-h-[44px] px-3.5 rounded-xl bg-gradient-to-l from-rp-fire to-rp-amber text-white text-[14px] sm:text-[15px] font-bold shadow-md shadow-rp-fire/30 hover:brightness-110 active:scale-[0.97] transition inline-flex items-center gap-1.5">
                  <Icon name="dice" className={`w-[18px] h-[18px] shrink-0 ${rolling ? 'animate-spin' : ''}`} />
                  <span className="inline-block max-w-[9rem] truncate" aria-live="off" dir="auto">{rolling ?? sf.newMission}</span>
                </button>
              )}
              <button type="button" onClick={() => editMyself(current?.screen.stageId || null, current?.screen.taskId || null)}
                className="min-h-[44px] px-3 rounded-xl border border-[--rp-border] text-[14px] text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors inline-flex items-center gap-1.5">
                <Icon name="pencil" className="w-4 h-4" />{sf.editMyself}
              </button>
              <button type="button" onClick={() => { const on = !soundOn; setSoundOn(on); setSoundEnabled(on); if (on) playSetupSound('check', true); }}
                aria-label={soundOn ? sf.soundMute : sf.soundUnmute} title={soundOn ? sf.soundMute : sf.soundUnmute} aria-pressed={!soundOn}
                className={`${TAP_TARGET} rounded-xl border border-[--rp-border] text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors`}>
                <Icon name={soundOn ? 'speaker' : 'speakerOff'} className="w-4 h-4" />
              </button>
            </div>
          </div>
          {progress.length > 0 && (
            <div className="mt-2.5 [@media(max-height:560px)]:mt-1.5" aria-hidden>
              <div className="flex gap-1.5">
                {progress.map((p) => (
                  <div key={p.stageId} className="h-2 rounded-full bg-[--surface-2] overflow-hidden" style={{ flexGrow: p.total, flexBasis: 0 }}>
                    <div className="h-full rounded-full bg-rp-fire transition-[width] duration-300 ease-out"
                      style={{ width: `${beat.kind === 'finish' || beat.kind === 'prep' ? 100 : Math.round((p.done / p.total) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5 text-[11px] sm:text-[12px] text-[--ink-3] [@media(max-height:720px)]:hidden">
                {progress.map((p, i) => (
                  <span key={p.stageId} className={`truncate text-center ${p.current ? 'text-ink-fire font-bold' : ''}`} style={{ flexGrow: p.total, flexBasis: 0 }}>
                    {sf.planStage({ n: i + 1 })}
                  </span>
                ))}
              </div>
            </div>
          )}
          {showPct && (
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[13px] sm:text-[14px] [@media(max-height:560px)]:hidden">
              <span className="inline-flex items-baseline gap-1 font-extrabold text-ink-fire">
                <NumberFlow value={pct} suffix="%" />
                <span className="font-semibold">{sf.readyWord}</span>
              </span>
              {openLeft > 0 && openLeft <= 3 && beat.kind === 'item' && (
                <motion.span key={openLeft} initial={reduce ? false : { scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  className="rounded-full bg-rp-fire/10 px-2.5 py-0.5 font-bold text-ink-fire">{sf.leftToGo({ n: openLeft })}</motion.span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Body: exactly the space between header and footer ──────────────────────────────── */}
      <div ref={bodyRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <motion.div style={{ y: pull }} className={`min-h-full flex flex-col ${fillsScreen ? 'walk:h-full' : ''}`}>
        <AnimatePresence mode="wait" initial={false} onExitComplete={() => pull.set(0)}>
          <motion.div key={`${at}-${swapTick}`} variants={variants} initial="enter" animate="center" exit="exit"
            data-audit="content" className={`mx-auto w-full max-w-5xl walk:max-w-[min(92vw,1400px)] flex-1 ${fillsScreen ? 'walk:min-h-0' : ''} px-4 py-3 sm:py-5 flex flex-col walk:my-3 walk:[@media(max-height:720px)]:my-1.5 walk:[@media(max-height:720px)]:py-4 walk:[@media(max-height:560px)]:my-1 walk:[@media(max-height:560px)]:py-2.5 walk:[@media(max-height:560px)]:rounded-[20px] walk:rounded-[28px] walk:border walk:border-white/70 walk:bg-[--surface-0]/85 walk:backdrop-blur-xl walk:px-8 walk:py-6 walk:shadow-[0_30px_80px_-40px_rgba(255,87,34,0.45)]`}>
            {beat.kind === 'plan' && <PlanBeat game={game} itemCount={beats.filter((b) => b.kind === 'item').length} onTestDrive={onTestDrive} onGameChange={onGameChange} />}
            {beat.kind === 'item' && current && (
              <ItemBeat
                game={game} screen={current.screen} item={current.item} first={beat.firstOfMission}
                praise={(() => { const p = praiseIndex(at, prevDone); return p === null ? '' : sf.praise[p % sf.praise.length]; })()}
                placeLine={placeLine}
                onTaskChange={changeTask} onGameChange={onGameChange} gameAnchors={gameAnchors}
                onOpenFull={() => editMyself(current.screen.stageId || null, current.screen.taskId || null)}
                onSwap={onRegenerate && current.screen.scope === 'task' ? regenerate : undefined}
              />
            )}
            {(beat.kind === 'item' || beat.kind === 'plan') && !swiped && (
              <p className="walk:hidden mt-auto pt-4 flex justify-center">
                <Icon name="chevronUp" role="img" aria-hidden={false} aria-label={sf.swipeHint} className="w-7 h-7 text-ink-fire rp-swipe-hint" />
              </p>
            )}
            {beat.kind === 'finish' && <RouteBeat game={game} screens={screens} beats={beats} onJump={go} onFix={startFixing} />}
            {beat.kind === 'prep' && <PrepBeat game={game} screens={screens} onTestDrive={onTestDrive} onGameChange={onGameChange} />}
          </motion.div>
        </AnimatePresence>
        </motion.div>
      </div>

      {/* ── Footer: one primary, always live (an answering button, never a disabled one) ──────── */}
      <footer className="relative z-10 shrink-0 border-t border-[--rp-border]/60 bg-[--surface-0]/75 backdrop-blur-xl pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="mx-auto w-full max-w-5xl walk:max-w-[min(92vw,1400px)] px-4 pt-2.5 [@media(max-height:560px)]:pt-1.5 flex items-center gap-2">
          {at > 0 && (
            <Button variant="ghost" onPointerDown={() => pressMove(at - 1)} onClick={() => go(at - 1)} className="shrink-0 px-3 [@media(pointer:coarse)]:sr-only">{rtl ? '→' : '←'} {sf.back}</Button>
          )}
          {beat.kind === 'prep' && <Button variant="ghost" onClick={onDone} className="shrink-0 px-3">{sf.toBuilder}</Button>}
          <div className="ms-auto flex items-center gap-2 sm:gap-3 min-w-0">
            {skipping && <span className="hidden sm:inline text-[13px] text-[--ink-3] truncate">{sf.later}</span>}
            <AnimatePresence>
              {current?.item.configured && current.item.kind !== 'prep' && (
                <motion.span key={`saved-${justFilled}`} initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 20 }}
                  className="inline-flex items-center gap-1 text-[14px] font-bold text-ink-go">
                  <Icon name="checkCircle" className="w-5 h-5" />{sf.saved}
                </motion.span>
              )}
            </AnimatePresence>
            <Button key={`cta-${justFilled}`} onClick={primary.onClick} onPointerDown={() => { if (primary.to !== undefined) pressMove(primary.to); }}
              className={`min-w-0 px-4 sm:min-w-[11rem] text-[16px] font-bold ${justFilled > 0 && current?.item.configured ? 'rp-cta-ready' : ''}`}>
              {primary.label}{primary.arrow ? ` ${rtl ? '←' : '→'}` : ''}
            </Button>
          </div>
        </div>
      </footer>
    </div>,
    document.body,
  );
}

// ─── The plan ─────────────────────────────────────────────────────────────────────────────────

function PlanBeat({ game, itemCount, onTestDrive, onGameChange }: { game: Game; itemCount: number; onTestDrive?: () => void; onGameChange: (g: Game) => void }) {
  const sf = useT().setupFlow;
  const reduce = useReducedMotion();
  const stages = planStages(game);
  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col min-h-full sm:justify-center">
      {!reduce && <ConfettiBurst />}
      <div className="flex items-center gap-3">
        <motion.span initial={reduce ? false : { scale: 0.5, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 18 }}
          className="inline-flex w-12 h-12 shrink-0 items-center justify-center rounded-2xl bg-rp-fire text-white shadow-lg shadow-rp-fire/30">
          <Icon name="sparkle" className="w-6 h-6" />
        </motion.span>
        <div className="min-w-0">
          <h1 className="text-[28px] sm:text-4xl font-extrabold leading-tight">{sf.planTitle}</h1>
          {game.title && <p className="text-[17px] sm:text-xl font-bold text-ink-fire truncate" dir="auto">{game.title}</p>}
        </div>
      </div>
      <p className="mt-1.5 text-[15px] sm:text-lg text-[--ink-2] leading-snug">{sf.planLead}</p>
      <ol className="mt-2.5 shrink-0 flex flex-col gap-1.5 sm:gap-3">
        {stages.map((s, i) => (
          <motion.li key={s.stageId}
            initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, delay: reduce ? 0 : 0.035 * i }}
            className="flex items-start gap-3 rounded-2xl border border-[--rp-border]/70 bg-[--surface-0] px-3 py-2 sm:p-4 shadow-[0_10px_28px_-22px_rgba(255,87,34,0.6)]">
            <span className="inline-flex w-8 h-8 shrink-0 items-center justify-center rounded-full bg-rp-fire text-white text-[15px] font-bold">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[18px] sm:text-xl font-bold" dir="auto">{s.title || sf.planStage({ n: i + 1 })}</span>
                <span className="text-[14px] text-[--ink-3]">{sf.planPerTeam({ perTeam: s.perTeam, total: s.total })}</span>
              </div>
              {s.missions.length > 0 && <p className="mt-0.5 text-[15px] sm:text-base text-[--ink-2] leading-snug" dir="auto">{s.missions.join(' · ')}</p>}
            </div>
          </motion.li>
        ))}
      </ol>
      {stages.some((s) => s.perTeam < s.total) && (
        <p className="mt-2 shrink-0 flex items-start gap-1.5 text-[13px] sm:text-[15px] font-semibold leading-snug text-[--ink-2]">
          <Icon name="shuffle" className="w-4 h-4 mt-0.5 shrink-0 text-ink-fire" />{sf.planChoiceNote}
        </p>
      )}
      {itemCount > 0 && (
        <p className="mt-2 shrink-0 rounded-2xl bg-rp-fire/10 px-4 py-2 sm:py-2.5 text-[15px] sm:text-lg font-semibold leading-snug text-ink-fire">
          {sf.planNext({ n: itemCount })}
          <span className="mt-0.5 flex items-center gap-1.5 text-[14px] sm:text-[15px] font-semibold text-[--ink-2]">
            <Icon name="stopwatch" className="w-4 h-4 shrink-0" />{sf.planTime({ min: Math.max(1, Math.round((itemCount * 20) / 60)) })}
          </span>
        </p>
      )}
      <EventDateRow game={game} onGameChange={onGameChange} />
      {onTestDrive && <TryItCard onTestDrive={onTestDrive} />}
    </div>
  );
}

/** When the game is (change: creator-engagement-loop): a real date is a real reason to come back, and it
 *  drives the dashboard countdown and the day-before reminder. Asked once, in the plan, never required. */
function EventDateRow({ game, onGameChange }: { game: Game; onGameChange: (g: Game) => void }) {
  const sf = useT().setupFlow;
  const toDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  };
  // A cleared date is sent as null (an explicit clear), never undefined, which the save would not send.
  const when = walkEnding(game.eventAt, new Date().toISOString());
  const days = daysUntilEvent(game.eventAt ?? null, new Date().toISOString());
  const hint = when === 'today' ? sf.eventHintToday : when === 'now' ? sf.eventHintPast : when === 'later' && days !== null ? sf.readyDays({ n: days }) : sf.eventHint;
  const set = (v: string) => onGameChange({ ...game, eventAt: v ? new Date(`${v}T10:00:00`).toISOString() : (null as unknown as undefined) });
  return (
    <label className="mt-3 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[--rp-border] bg-[--surface-0] px-3.5 py-2.5 [@media(max-height:560px)]:py-1.5">
      <span className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-rp-fire/10 text-ink-fire"><Icon name="calendar" className="w-5 h-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold leading-tight">{sf.eventQ}</span>
        <span className="block text-[13px] sm:text-[14px] text-[--ink-2] leading-snug [@media(max-height:560px)]:hidden">{hint}</span>
      </span>
      <input type="date" value={toDate(game.eventAt)} onChange={(e) => set(e.target.value)}
        className="shrink-0 min-h-[44px] rounded-xl border border-[--rp-border] bg-[--surface-1] px-3 text-[16px] text-[--ink-1]" />
    </label>
  );
}

/** The "I saw it work" moment, offered where the plan is seen and again before launch (research 29.10). */
function TryItCard({ onTestDrive }: { onTestDrive: () => void }) {
  const sf = useT().setupFlow;
  return (
    <div className="mt-3 shrink-0 flex items-center gap-3 rounded-2xl border border-[--rp-border] bg-[--surface-0] px-3.5 py-2.5 [@media(max-height:560px)]:py-1.5">
      <span className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-rp-plasma/15 text-ink-plasma"><Icon name="phone" className="w-5 h-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-bold leading-tight">{sf.tryItTitle}</p>
        <p className="text-[13px] sm:text-[14px] text-[--ink-2] leading-snug [@media(max-height:560px)]:hidden">{sf.tryItBody}</p>
      </div>
      <Button variant="subtle" onClick={onTestDrive} className="shrink-0 px-3"><Icon name="play" className="w-4 h-4 me-1.5" />{sf.tryItCta}</Button>
    </div>
  );
}

// ─── One item ─────────────────────────────────────────────────────────────────────────────────

/** The mission's kind, drawn: what the creator sees first on its ticket. */
const TYPE_ICON: Record<string, IconName> = {
  field: 'pin', geofence: 'target', smart_station: 'key', photo: 'camera', self_report: 'checkCircle',
  quiz: 'puzzle', numeric: 'hundred', sequence: 'run', survey: 'ballot',
};

/** Fields whose control is one big surface: it takes the rest of the screen. */
const FILLS = new Set(['coordinates']);
/** How many missions the finish screen lists before "and N more" (the fix button walks all of them). */
const FINISH_LIST_MAX = 5;

function ItemBeat({
  game, screen, item, first, praise, placeLine, onTaskChange, onGameChange, gameAnchors, onOpenFull, onSwap,
}: {
  game: Game; screen: SetupScreen; item: SetupItem; first: boolean; praise: string; placeLine: string;
  onTaskChange: (stageId: string, task: Task) => void; onGameChange: (g: Game) => void;
  gameAnchors?: SetupFlowProps['gameAnchors']; onOpenFull: () => void; onSwap?: () => void;
}) {
  const sf = useT().setupFlow;
  const reduce = useReducedMotion();
  const rtl = useLanguage().lang === 'he';
  const task = screen.scope === 'task' ? taskIn(game, screen.stageId, screen.taskId) : null;
  const ask = askFor(item, sf, task);
  // An ordering quiz is finished by sorting, not by answering (found in the 23.10 checks).
  const doneKey = task?.type === 'quiz' && (task.orderItems?.length ?? 0) > 0 ? 'order' : screen.taskType;
  const fills = FILLS.has(item.fieldPath);
  // A field that was open when this screen came up STAYS on it once filled (28.10, found live: on a
  // "before the game" screen the field hid itself the moment it counted as done, so picking an
  // address made the whole map vanish, and typing the last letter of a blank removed the boxes).
  // A prep step that arrived already done still shows only its instruction. The screen remounts on
  // every step, so this is decided once per visit.
  const [fieldOpenAtStart] = useState(!item.configured);
  // The mission's own words, editable right on its card (Ahiya, 28.10): a pencil turns the title and
  // the text into boxes. Leaving edit mode remounts the field below (`editRound`), so a sentence of
  // blanks re-reads the text the creator just wrote instead of writing its old template back over it.
  const [editing, setEditing] = useState(false);
  const [editRound, setEditRound] = useState(0);
  // On a phone a long text is folded to four lines, so the thing to fill is not a scroll away.
  const [openText, setOpenText] = useState(false);
  const longText = screen.playerText.length > 150;
  const finishEdit = () => { setEditing(false); setEditRound((n) => n + 1); };
  const putText = (patch: Partial<Task>) => { if (task) onTaskChange(screen.stageId, { ...task, ...patch }); };
  // The edit box is as tall as its text (28.10: a fixed height scrolled inside the card and hid half
  // the mission). The card grows; the page scrolls, never the box.
  const growToFit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 4}px`;
  };
  const field = (
    <FieldInput key={editRound} game={game} screen={screen} item={item} task={task} onTaskChange={onTaskChange}
      onGameChange={onGameChange} gameAnchors={gameAnchors} onOpenFull={onOpenFull} />
  );

  return (
    // Desktop: the mission on one side, the action on the other, both the body's full height.
    // Phone and tablet: one column, the mission first (you need to know what happens there before you
    // place or fill it), the action taking the rest.
    <div className={`flex-1 flex flex-col gap-3 walk:grid ${fills ? 'walk:min-h-0 walk:grid-rows-[minmax(0,1fr)] walk:items-stretch walk:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]' : 'walk:items-start walk:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:justify-center walk:content-center'} walk:gap-8`}>
      {screen.scope === 'task' && (
        <motion.section
          initial={reduce ? false : { opacity: 0, y: 10, rotate: rtl ? 1 : -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 28 }}
          className="shrink-0 walk:self-start walk:sticky walk:top-0 rounded-3xl bg-[--surface-0] border border-[--rp-border]/70 shadow-[0_18px_40px_-28px_rgba(255,87,34,0.55)] overflow-hidden">
          <div aria-hidden className="h-1.5 bg-gradient-to-l from-rp-fire to-rp-amber" />
          <div className="px-4 py-3.5 sm:p-5 walk:[@media(max-height:720px)]:p-4">
            <div className="flex items-start gap-3">
              <span aria-hidden className="inline-flex w-11 h-11 sm:w-12 sm:h-12 walk:[@media(max-height:560px)]:w-9 walk:[@media(max-height:560px)]:h-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rp-fire to-rp-amber text-white shadow-md shadow-rp-fire/30">
                <Icon name={TYPE_ICON[screen.taskType ?? ''] ?? 'flag'} className="w-5 h-5 sm:w-6 sm:h-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] sm:text-[15px] font-semibold text-ink-fire truncate">{placeLine}</div>
                {editing && task ? (
                  <input value={task.title ?? ''} onChange={(e) => putText({ title: e.target.value })} dir="auto" aria-label={sf.editTitleLabel}
                    className="mt-1 w-full min-h-[44px] rounded-xl border-2 border-rp-fire/60 bg-[--surface-0] px-3 text-[20px] font-extrabold text-[--ink-1] focus:outline-none focus:border-rp-fire focus:ring-4 focus:ring-rp-fire/15" />
                ) : (
                  <h2 className={`font-extrabold leading-tight ${first ? 'text-[26px] sm:text-4xl' : 'text-[24px] sm:text-3xl'} walk:[@media(max-height:720px)]:text-[26px] walk:[@media(max-height:560px)]:text-[20px]`} dir="auto">{screen.title}</h2>
                )}
              </div>
              {task && (
                // The word shows where the card has room (a tablet, a wide desktop); on a phone and in the
                // narrow desktop column it is the pencil alone, so the mission's name keeps its line.
                <button type="button" onClick={() => (editing ? finishEdit() : setEditing(true))} aria-pressed={editing}
                  aria-label={editing ? sf.editTextDone : sf.editText}
                  className={`min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 text-[14px] font-bold whitespace-nowrap transition-colors ${editing ? 'bg-rp-fire text-white' : 'text-ink-fire hover:bg-rp-fire/10'}`}>
                  <Icon name={editing ? 'check' : 'pencil'} className="w-4 h-4" />
                  <span aria-hidden className="hidden sm:inline walk:hidden 2xl:inline">{editing ? sf.editTextDone : sf.editText}</span>
                </button>
              )}
            </div>
            {editing && task ? (
              <div className="mt-3">
                <div className="text-[13px] sm:text-[14px] font-semibold text-[--ink-3]">{sf.teamsWill}</div>
                <textarea value={plainBlanks(task.description)} onChange={(e) => putText({ description: asCreatorBlanks(e.target.value) })} dir="auto" aria-label={sf.editTextLabel}
                  ref={growToFit} onInput={(e) => growToFit(e.currentTarget)} rows={3}
                  className="mt-1 w-full resize-none overflow-hidden rounded-xl border-2 border-rp-fire/60 bg-[--surface-0] px-3 py-2 text-[16px] sm:text-lg leading-snug text-[--ink-1] focus:outline-none focus:border-rp-fire focus:ring-4 focus:ring-rp-fire/15" />
                <p className="mt-1 text-[13px] text-[--ink-3]">{hasOpenSlots(task.description) ? `${sf.editTextNote} ${sf.editTextBlanks}` : sf.editTextNote}</p>
              </div>
            ) : screen.playerText !== '' && (
              <div className="mt-3 walk:[@media(max-height:560px)]:mt-2">
                <div className="text-[13px] sm:text-[14px] font-semibold text-[--ink-3] walk:[@media(max-height:560px)]:hidden">{sf.teamsWill}</div>
                <p className={`mt-0.5 text-[16px] sm:text-lg leading-snug sm:leading-relaxed walk:[@media(max-height:720px)]:leading-snug text-[--ink-1] whitespace-pre-line ${longText && !openText ? 'line-clamp-4 walk:line-clamp-none walk:[@media(max-height:560px)]:line-clamp-4' : ''}`} dir="auto">{blanked(screen.playerText)}</p>
                {longText && (
                  <button type="button" onClick={() => setOpenText((o) => !o)} className="walk:hidden walk:[@media(max-height:560px)]:block min-h-[36px] text-[14px] font-bold text-ink-fire">
                    {openText ? sf.textLess : sf.textMore}
                  </button>
                )}
              </div>
            )}
            {doneKey && (sf.howDone[doneKey] ?? '') !== '' && (
              <p className="mt-3 walk:[@media(max-height:560px)]:mt-2 inline-flex items-center gap-1.5 rounded-full bg-rp-fire/10 px-3 py-1.5 walk:[@media(max-height:560px)]:py-1 text-[14px] sm:text-[15px] walk:[@media(max-height:560px)]:text-[13px] font-semibold text-ink-fire">
                <Icon name="flag" className="w-4 h-4 shrink-0" />{sf.howDone[doneKey]}
              </p>
            )}
            {task?.hideLocation === true && (
              <p className="mt-2 flex items-start gap-1.5 rounded-2xl bg-violet-600/10 px-3 py-2 walk:[@media(max-height:560px)]:py-1.5 text-[14px] sm:text-[15px] walk:[@media(max-height:560px)]:text-[13px] font-semibold text-violet-800 dark:text-violet-300">
                <Icon name="eyeOff" className="w-4 h-4 mt-0.5 shrink-0" />{sf.hiddenNote}
              </p>
            )}
            {onSwap && first && (
              <button type="button" onClick={onSwap}
                className="mt-3 w-full min-h-[44px] [@media(max-height:720px)]:hidden rounded-xl border-2 border-dashed border-rp-fire/50 px-3 text-[15px] font-bold text-ink-fire hover:bg-rp-fire/5 inline-flex items-center justify-center gap-2 transition-colors">
                <Icon name="dice" className="w-[18px] h-[18px]" />{sf.swapInCard}
              </button>
            )}
          </div>
        </motion.section>
      )}

      <section className={`flex flex-col ${fills ? 'walk:min-h-0' : ''} ${screen.scope === 'task' ? '' : 'walk:col-span-2 w-full max-w-2xl mx-auto'}`}>
        {praise !== '' && (
          <motion.div initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}
            className={`shrink-0 text-[19px] sm:text-xl font-extrabold text-ink-fire ${fills ? 'walk:[@media(max-height:720px)]:hidden' : ''}`}>{praise}</motion.div>
        )}
        {item.kind === 'prep' ? (
          <>
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 32, mass: 0.7 }}
            className="mt-1 shrink-0 rounded-2xl border-2 border-rp-amber/70 bg-rp-amber/10 p-3 sm:p-5 rp-prep-glow flex flex-col">
            <div className="flex items-start gap-3 shrink-0">
              <motion.span
                initial={reduce ? false : { rotate: -12 }} animate={{ rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }}
                className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-rp-amber text-white">
                <Icon name="backpack" className="w-5 h-5" />
              </motion.span>
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-rp-amber/20 px-2.5 py-0.5 text-[13px] font-bold text-ink-amber">{sf.prepLabel}</div>
                <p className="mt-1.5 text-[17px] sm:text-xl walk:[@media(max-height:720px)]:text-[17px] font-semibold leading-snug" dir="auto">{item.instruction}</p>
                <p className="mt-1.5 text-[12px] sm:text-[13px] text-[--ink-2] flex items-center gap-1.5 walk:[@media(max-height:720px)]:hidden"><Icon name="checkCircle" className="w-4 h-4 text-ink-go shrink-0" />{sf.prepNote}</p>
              </div>
            </div>
            {fieldOpenAtStart && !fills && (
              <div className="mt-3 rounded-xl bg-[--surface-0] p-2.5 sm:p-3 flex flex-col">
                {ask.title !== item.instruction && <p className="mb-2 shrink-0 text-[17px] font-bold walk:[@media(max-height:720px)]:hidden">{ask.title}</p>}
                {field}
              </div>
            )}
          </motion.div>
          {fieldOpenAtStart && fills && (
            <>
              {ask.title !== item.instruction && <p className="mt-3 shrink-0 text-[19px] sm:text-2xl walk:[@media(max-height:560px)]:text-xl font-extrabold">{ask.title}</p>}
              <div className="mt-2 flex flex-col walk:flex-1 walk:min-h-0">{field}</div>
            </>
          )}
          </>
        ) : (
          <>
            <h3 className="shrink-0 text-[22px] sm:text-3xl walk:[@media(max-height:560px)]:text-2xl font-extrabold leading-snug">{ask.title}</h3>
            {ask.hint !== '' && <p className="mt-1 shrink-0 text-[16px] sm:text-lg text-[--ink-2] leading-snug" dir="auto">{ask.hint}</p>}
            <div className={`mt-3 flex flex-col ${fills ? 'walk:flex-1 walk:min-h-0' : 'shrink-0'}`}>{field}</div>
          </>
        )}
      </section>
    </div>
  );
}

/** The words of the question: the flow's own ask for the field, the step's instruction under it. */
function askFor(item: SetupItem, sf: SF, task: Task | null): { title: string; hint: string } {
  const own = (() => {
    switch (item.fieldPath) {
      case 'coordinates': return sf.askPlace;
      case 'description': case 'hint': case 'locationClue':
        return task && hasOpenSlots(task[item.fieldPath]) ? sf.askSentence : item.fieldPath === 'locationClue' ? sf.askClue : '';
      case 'smart.secretCode': return sf.askCode;
      case 'answers': return sf.askAnswer;
      case 'numericAnswer': return sf.askNumber;
      case 'media': return sf.askPhoto;
      case 'orderItems': return sf.askOrder;
      case 'choices': return sf.askList;
      case 'title': return item.anchor?.startsWith('game.') ? sf.askGameTitle : task && hasOpenSlots(task.title) ? sf.askSentence : '';
      default: return '';
    }
  })();
  if (item.kind === 'prep') return { title: own || item.instruction, hint: '' };
  if (own !== '') {
    const fallbackHint = ({
      coordinates: sf.placeHint, description: sf.sentenceHint, hint: sf.sentenceHint, locationClue: sf.sentenceHint, title: sf.sentenceHint,
      'smart.secretCode': sf.codeHint, answers: sf.answerHint, numericAnswer: sf.numberHint,
      orderItems: sf.orderHint, choices: sf.choicesHint,
    } as Record<string, string>)[item.fieldPath] ?? '';
    return { title: own, hint: item.instruction !== '' ? item.instruction : fallbackHint };
  }
  return { title: item.instruction || sf.askGameText, hint: '' };
}

// ─── The field itself: made for this screen, not the mission editor ───────────────────────────

const BOX = 'w-full min-h-[50px] rounded-xl border-2 border-[--rp-border] bg-[--surface-0] px-4 py-2.5 text-[17px] sm:text-lg text-[--ink-1] placeholder:text-[--ink-3] focus:outline-none focus:border-rp-fire focus:ring-4 focus:ring-rp-fire/15 transition-colors';

function FieldInput({ game, screen, item, task, onTaskChange, onGameChange, gameAnchors, onOpenFull }: {
  game: Game; screen: SetupScreen; item: SetupItem; task: Task | null;
  onTaskChange: (stageId: string, task: Task) => void; onGameChange: (g: Game) => void;
  gameAnchors?: SetupFlowProps['gameAnchors']; onOpenFull: () => void;
}) {
  const sf = useT().setupFlow;
  // The sentence's template is captured when the item first shows: filling it removes the brackets,
  // and the boxes must stay where they were.
  const template = useRef<string | null>(null);
  const sentenceField = (SENTENCE_FIELDS as readonly string[]).includes(item.fieldPath) && screen.scope === 'task'
    ? item.fieldPath as typeof SENTENCE_FIELDS[number] : null;
  if (template.current === null && task && sentenceField && hasOpenSlots(task[sentenceField])) template.current = task[sentenceField] ?? '';

  if (screen.scope === 'game') {
    const value = gameFieldValue(game, item.fieldPath);
    const set = (v: string) => onGameChange(withGameField(game, item.fieldPath, v));
    return item.fieldPath === 'title'
      ? <input className={`${BOX} text-lg`} value={value} onChange={(e) => set(e.target.value)} dir="auto" />
      : <textarea className={`${BOX} min-h-[110px]`} value={value} onChange={(e) => set(e.target.value)} dir="auto" />;
  }
  if (!task) return null;
  const put = (patch: Partial<Task>) => onTaskChange(screen.stageId, { ...task, ...patch });
  if (sentenceField && template.current) {
    const tpl = template.current;
    const values = extractSlotValues(tpl, task[sentenceField]) ?? [];
    return <SentenceBoxes template={tpl} values={values} onChange={(v) => put({ [sentenceField]: fillTemplate(tpl, v) } as Partial<Task>)} />;
  }

  switch (item.fieldPath) {
    case 'coordinates':
      return (
        <div className="h-[min(60dvh,560px)] min-h-[320px] walk:h-auto walk:flex-1 walk:min-h-[260px] walk:[@media(max-height:560px)]:min-h-[170px] flex flex-col">
          <LocationStep coordinates={task.coordinates ?? { lat: 0, lng: 0 }} onChange={(lat, lng) => put({ coordinates: { lat, lng } })}
            fill anchors={gameAnchors} cooperativeGestures />
        </div>
      );
    case 'description': {
      return <textarea className={`${BOX} min-h-[110px]`} value={task.description ?? ''} onChange={(e) => put({ description: e.target.value })} dir="auto" />;
    }
    case 'smart.secretCode': {
      const code = task.smart?.secretCode ?? '';
      const setCode = (secretCode: string) => put({ smart: { ...(task.smart ?? {}), secretCode } as Task['smart'] });
      return (
        <div className="flex flex-col sm:flex-row gap-2">
          <input className={`${BOX} font-mono tracking-[0.25em] text-center text-xl`} value={code} dir="ltr"
            autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <Button variant="subtle" className="shrink-0 min-h-[50px]" onClick={() => setCode(generateCode())}>
            <Icon name="dice" className="w-4 h-4 me-1.5" />{sf.makeCode}
          </Button>
        </div>
      );
    }
    case 'answers': {
      // A bank sample is not the answer: the box starts empty, the sample is only a placeholder.
      const sample = isSampleStep({ id: item.stepId });
      const choices = (task.choices ?? []).filter((c) => c.trim() !== '');
      const answer = sample ? '' : task.answers?.[0] ?? '';
      if (choices.length > 0) {
        return (
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <button key={c} type="button" onClick={() => put({ answers: [c] })} aria-pressed={answer === c} dir="auto"
                className={`min-h-[48px] px-4 rounded-xl border-2 text-[17px] transition-colors ${answer === c ? 'border-rp-fire bg-rp-fire/10 font-semibold' : 'border-[--rp-border] hover:bg-[--surface-2]'}`}>
                {c}
              </button>
            ))}
          </div>
        );
      }
      return <input className={BOX} value={answer} dir="auto" placeholder={sample ? sf.samplePlaceholder({ v: task.answers?.[0] ?? '' }) : undefined}
        onChange={(e) => put({ answers: [e.target.value, ...(sample ? [] : (task.answers ?? []).slice(1))] })} />;
    }
    case 'numericAnswer': {
      const sample = isSampleStep({ id: item.stepId });
      return <input className={`${BOX} text-center text-xl`} type="number" inputMode="decimal" dir="ltr"
        placeholder={sample && Number.isFinite(task.numericAnswer) ? sf.samplePlaceholder({ v: String(task.numericAnswer) }) : undefined}
        value={!sample && Number.isFinite(task.numericAnswer) ? String(task.numericAnswer) : ''}
        onChange={(e) => { const n = e.target.value === '' ? undefined : Number(e.target.value); put({ numericAnswer: Number.isFinite(n) ? n : undefined }); }} />;
    }
    case 'hint':
      return <textarea className={`${BOX} min-h-[100px]`} value={task.hint ?? ''} dir="auto" onChange={(e) => put({ hint: e.target.value })} />;
    case 'locationClue':
      return <textarea className={`${BOX} min-h-[100px]`} value={task.locationClue ?? ''} dir="auto" onChange={(e) => put({ locationClue: e.target.value })} />;
    case 'orderItems': case 'choices': {
      const key = item.fieldPath as 'orderItems' | 'choices';
      const sample = isSampleStep({ id: item.stepId });
      return <ListRows rows={sample ? [] : task[key] ?? []} placeholders={sample ? task[key] ?? [] : []} ordered={key === 'orderItems'}
        onChange={(rows) => put({ [key]: rows } as Partial<Task>)} />;
    }
    case 'media':
      return <PhotoPick task={task} gameId={game.id} onChange={(media) => put({ media })} />;
    case 'title':
      return <input className={`${BOX} text-lg`} value={task.title ?? ''} dir="auto" onChange={(e) => put({ title: e.target.value })} />;
    default:
      // A field this screen has no box for: the mission editor, isolated to that one control. Never
      // a dead end, and never a field silently left out of the walk.
      return (
        <div className="rounded-2xl border border-[--rp-border] p-3">
          <TaskWizard task={task} onChange={(next) => onTaskChange(screen.stageId, next)} onDone={() => undefined} onClose={onOpenFull}
            closeLabel={sf.openFull} gameId={game.id} guided bare guidedAnchor={item.anchor}
            focusTab={item.wizardStep} focusGroup={item.optInGroup as never} focusNonce={1} gameAnchors={gameAnchors} />
        </div>
      );
  }
}

/** The mission's own sentence, every blank a box you type into (Ahiya: "a rectangle to fill"). */
function SentenceBoxes({ template, values, onChange }: { template: string; values: readonly string[]; onChange: (v: string[]) => void }) {
  const parts = parseSentence(template);
  const box = (p: { index: number; hint: string }, i: number, className: string) => (
    <input key={i} value={values[p.index] ?? ''} placeholder={p.hint} aria-label={p.hint} dir="auto"
      onChange={(e) => { const next = [...values]; next[p.index] = e.target.value; onChange(next); }}
      className={`${className} min-h-[44px] rounded-xl border-2 border-dashed border-rp-fire/60 bg-rp-fire/5 px-3 text-[17px] sm:text-lg text-[--ink-1] placeholder:text-[--ink-3] focus:outline-none focus:border-solid focus:border-rp-fire focus:bg-[--surface-0] focus:ring-4 focus:ring-rp-fire/15 transition-colors`} />
  );
  // A text written one line per thing (a row per place, per digit) is shown as those rows: the
  // line's words beside its box, so four places fit one screen (Ahiya, 28.10). A line with no box
  // only repeats the card beside it, so it is left out here.
  const lines: (typeof parts)[] = [[]];
  for (const p of parts) {
    if (p.kind !== 'text') { lines[lines.length - 1].push(p); continue; }
    p.text.split('\n').forEach((chunk, k) => {
      if (k > 0) lines.push([]);
      if (chunk.trim() !== '') lines[lines.length - 1].push({ ...p, text: chunk });
    });
  }
  if (lines.length > 1) {
    return (
      <div className="rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3 sm:p-4 space-y-2 text-[17px] sm:text-lg leading-snug text-[--ink-1]" dir="auto">
        {/* Only the rows that ask for something: the mission's full text is on its card beside this. */}
        {lines.filter((l) => l.some((p) => p.kind !== 'text')).map((line, li) => (
          <div key={li} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {line.map((p, i) => (p.kind === 'text'
              ? <span key={i} className="max-w-full">{p.text}</span>
              : box(p, i, 'flex-1 min-w-[12rem]')))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <p className="whitespace-pre-line rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3.5 sm:p-5 text-[18px] sm:text-xl leading-[2.5] text-[--ink-1]" dir="auto">
      {parts.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>;
        const value = values[p.index] ?? '';
        return (
          <input key={i} value={value} placeholder={p.hint} aria-label={p.hint} dir="auto"
            size={Math.max(10, Math.ceil((value || p.hint).length * 1.25) + 2)}
            onChange={(e) => { const next = [...values]; next[p.index] = e.target.value; onChange(next); }}
            // A long hint gets its own line, so it is never cut off mid-word.
            className={`${(value || p.hint).length > 22 ? 'block w-full my-1' : 'inline-block mx-1'} align-middle max-w-full min-h-[44px] rounded-xl border-2 border-dashed border-rp-fire/60 bg-rp-fire/5 px-3 text-[17px] sm:text-lg text-[--ink-1] placeholder:text-[--ink-3] focus:outline-none focus:border-solid focus:border-rp-fire focus:bg-[--surface-0] focus:ring-4 focus:ring-rp-fire/15 transition-colors`} />
        );
      })}
    </p>
  );
}

/**
 * A list of lines. `ordered`: the lines ARE the answer, top to bottom (an ordering mission), so each
 * row carries its place number and can be moved up or down; the teams get them shuffled.
 */
function ListRows({ rows, onChange, ordered = false, placeholders = [] }: { rows: readonly string[]; onChange: (rows: string[]) => void; ordered?: boolean; placeholders?: readonly string[] }) {
  const sf = useT().setupFlow;
  const reduce = useReducedMotion();
  const min = Math.max(ordered ? 3 : 2, placeholders.length);
  const shown = rows.length >= min ? [...rows] : [...rows, ...Array(min - rows.length).fill('')];
  const set = (next: string[]) => onChange(next);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= shown.length) return;
    const next = [...shown];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const glyph = `${TAP_CLUSTER} shrink-0 rounded-lg border border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2] disabled:opacity-30`;
  return (
    <div className="space-y-2">
      {shown.map((r, i) => (
        <motion.div key={i} layout={!reduce} className="flex items-center gap-2">
          <span className={`w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full text-[15px] font-bold ${ordered ? 'bg-rp-fire text-white' : 'text-[--ink-3]'}`}>{i + 1}</span>
          <input className={BOX} value={r} dir="auto" placeholder={placeholders[i] ? sf.samplePlaceholder({ v: placeholders[i] }) : undefined} onChange={(e) => { const next = [...shown]; next[i] = e.target.value; set(next); }} />
          {ordered && (
            <span className="flex gap-1">
              <button type="button" className={glyph} disabled={i === 0} onClick={() => move(i, -1)} aria-label={sf.moveUp}>↑</button>
              <button type="button" className={glyph} disabled={i === shown.length - 1} onClick={() => move(i, 1)} aria-label={sf.moveDown}>↓</button>
            </span>
          )}
          {shown.length > min && (
            <button type="button" className={glyph} onClick={() => set(shown.filter((_, k) => k !== i))} aria-label={sf.removeRow}>
              <Icon name="close" className="w-4 h-4" />
            </button>
          )}
        </motion.div>
      ))}
      <button type="button" onClick={() => set([...shown, ''])} className="min-h-[44px] px-3 text-[16px] font-semibold text-ink-fire">+ {sf.addRow}</button>
    </div>
  );
}

function PhotoPick({ task, gameId, onChange }: { task: Task; gameId: string; onChange: (m: TaskMedia[]) => void }) {
  const sf = useT().setupFlow;
  const [pct, setPct] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // The upload takes seconds; commit against the task as it is THEN, not as it was at the click.
  const latest = useRef(task);
  latest.current = task;
  const images = (task.media ?? []).filter((m) => m.kind === 'image');
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFailed(false); setPct(0);
    try {
      const { url, kind } = await uploadTaskMedia(file, { gameId, taskId: task.id }, setPct);
      if (!isAcceptedTaskMedia({ kind, url })) { setFailed(true); return; }
      onChange([...(latest.current.media ?? []), { id: uuid(), kind, url }]);
    } catch { setFailed(true); } finally { setPct(null); }
  };
  // Drag a picture onto the box, or paste one (Ctrl+V) anywhere on this screen (Ahiya, 28.10). Only an
  // image file is taken; pasting text into a box elsewhere is left alone.
  const [over, setOver] = useState(false);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = firstImageFile(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      void pickRef.current(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  return (
    <div className="flex items-stretch gap-2">
      {images.map((m) => <img key={m.id} src={m.url} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover border border-[--rp-border]" />)}
      <label
        onDragOver={(e) => { if (Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === 'file')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = firstImageFile(e.dataTransfer.files); if (f) void pick(f); else setFailed(true); }}
        className={`flex-1 flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed text-ink-fire transition-colors ${over ? 'border-rp-fire bg-rp-fire/15' : 'border-rp-fire/50 bg-rp-fire/5 hover:bg-rp-fire/10'}`}>
        <Icon name="camera" className="w-7 h-7" />
        <span className="text-[15px] font-semibold">{pct !== null ? sf.uploading({ pct: Math.round(pct) }) : over ? sf.photoDropNow : images.length > 0 ? sf.photoAdded : sf.pickPhoto}</span>
        {pct === null && !over && <span className="hidden walk:block text-[13px] text-[--ink-3]">{sf.photoDropHint}</span>}
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} />
      </label>
      {failed && <p role="alert" className="text-[13px] text-ink-fire">{sf.uploadFailed}</p>}
    </div>
  );
}

// ─── The finish, part 1: the route, and what is still open ─────────────────────────────────────

function RouteBeat({ game, screens, beats, onJump, onFix }: {
  game: Game; screens: SetupScreen[]; beats: readonly SetupBeat[]; onJump: (i: number) => void; onFix: () => void;
}) {
  const sf = useT().setupFlow;
  const reduce = useReducedMotion();
  const left = beats
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === 'item' && screens[b.screen].items[b.item].required && !screens[b.screen].items[b.item].configured)
    .map(({ b, i }) => ({ i, title: b.kind === 'item' ? screens[b.screen].title : '' }));
  const ready = left.length === 0;
  if (ready) return <ReadyBeat game={game} screens={screens} />;
  // One row per mission, not per missing field: three blanks of "מפת פיראטים" read as three
  // identical rows (29.10). The list is capped so it fits beside the map on a short window.
  const groups: { i: number; title: string; n: number }[] = [];
  for (const l of left) {
    const g = groups.find((x) => x.title === l.title);
    if (g) g.n += 1; else groups.push({ ...l, n: 1 });
  }
  const shown = groups.slice(0, FINISH_LIST_MAX);
  const more = groups.length - shown.length;
  return (
    <div className="flex-1 flex flex-col gap-3 walk:min-h-0 walk:grid walk:grid-rows-[minmax(0,1fr)] walk:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] walk:items-stretch walk:gap-8">
      {ready && !reduce && <ConfettiBurst />}
      <section className="flex flex-col walk:min-h-0">
        <div className="shrink-0 flex items-center gap-3">
          <motion.span initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 22 }}
            className={`inline-flex w-11 h-11 shrink-0 items-center justify-center rounded-full text-white ${ready ? 'bg-rp-go' : 'bg-rp-amber'}`}>
            <Icon name={ready ? 'check' : 'flag'} className="w-6 h-6" />
          </motion.span>
          <div className="min-w-0">
            <h1 className="text-[26px] sm:text-4xl walk:[@media(max-height:560px)]:text-3xl font-extrabold leading-tight">{ready ? sf.finishTitle : sf.finishTitleGaps({ n: left.length })}</h1>
            {ready && <FinishStats game={game} />}
            <p className="text-[16px] sm:text-lg text-[--ink-2]">{sf.finishLead}</p>
          </div>
        </div>
        {hasRouteToShow(game.stages) && <div className="mt-3 h-[min(60dvh,560px)] min-h-[300px] walk:h-auto walk:flex-1 walk:min-h-[240px] walk:[@media(max-height:560px)]:min-h-[160px] rounded-2xl overflow-hidden border border-[--rp-border]">
          <RoutePreviewMap stages={game.stages ?? []} className="h-full" fill />
        </div>}
      </section>
      {left.length > 0 && (
        <section className="shrink-0 walk:self-start walk:sticky walk:top-0">
          <Button onClick={onFix} className="w-full min-h-[50px] text-[16px] font-bold mb-3">
            <Icon name="sparkle" className="w-5 h-5 me-1.5" />{sf.finishFix}
          </Button>
          <h2 className="text-[17px] font-bold">{sf.finishLeft}</h2>
          <ul className="mt-1.5 flex flex-wrap gap-2 walk:flex-col">
            {shown.map((l) => (
              <li key={l.i}>
                <button type="button" onClick={() => onJump(l.i)}
                  className="min-h-[44px] flex items-center gap-2 rounded-xl border border-[--rp-border] px-3 text-start hover:bg-[--surface-2] walk:w-full">
                  <Icon name="alert" className="w-4 h-4 text-ink-amber shrink-0" />
                  <span className="truncate text-[16px]" dir="auto">{l.title}</span>
                  {l.n > 1 && <span className="shrink-0 text-[13px] text-[--ink-3]">{sf.finishLeftCount({ n: l.n })}</span>}
                  <span className="ms-auto shrink-0 text-[13px] font-semibold text-ink-fire">{sf.finishGo}</span>
                </button>
              </li>
            ))}
          </ul>
          {more > 0 && <p className="mt-2 text-[14px] text-[--ink-3]">{sf.finishLeftMore({ n: more })}</p>}
        </section>
      )}
    </div>
  );
}

/**
 * The finish when nothing is left (28.10, "the last screen does not look nice"): it was the gaps
 * layout with its list column empty, a third of the screen of nothing. Now the summary stands in a
 * column of its own (what was built, and the two steps that remain: prepare, then launch) and the
 * route map takes the rest of the screen.
 */
function ReadyBeat({ game, screens }: { game: Game; screens: SetupScreen[] }) {
  const sf = useT().setupFlow;
  const reduce = useReducedMotion();
  const prepCount = beforeGameList(screens).length;
  const route = hasRouteToShow(game.stages);
  const next: [IconName, string][] = [
    ['flag', prepCount > 0 ? sf.finishNextPrep({ n: prepCount }) : sf.finishNextPrepNone],
    ['sparkle', sf.finishNextLaunch],
  ];
  return (
    <div className={route
      ? 'flex-1 flex flex-col gap-4 walk:min-h-0 walk:grid walk:grid-rows-[minmax(0,1fr)] walk:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] walk:items-stretch walk:gap-8'
      : 'flex-1 flex flex-col gap-4 justify-center w-full max-w-xl mx-auto'}>
      {!reduce && <ConfettiBurst />}
      <section className="flex flex-col walk:justify-center">
        <motion.span initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 22 }}
          className="inline-flex w-12 h-12 shrink-0 items-center justify-center rounded-full bg-rp-go text-white shadow-md shadow-rp-go/30 walk:[@media(max-height:560px)]:hidden">
          <Icon name="check" className="w-7 h-7" />
        </motion.span>
        <h1 className="mt-3 walk:[@media(max-height:560px)]:mt-0 text-[28px] sm:text-4xl walk:[@media(max-height:620px)]:text-3xl walk:[@media(max-height:560px)]:text-[26px] font-extrabold leading-tight">{sf.finishTitle}</h1>
        <FinishStats game={game} />
        <div className="mt-4 walk:[@media(max-height:560px)]:mt-2 rounded-2xl bg-[--surface-0] border border-[--rp-border]/70 p-4 walk:[@media(max-height:560px)]:p-3 shadow-sm">
          <h2 className="text-[15px] font-bold text-[--ink-3] walk:[@media(max-height:560px)]:text-[14px]">{sf.finishNextTitle}</h2>
          <ol className="mt-2 walk:[@media(max-height:560px)]:mt-1 space-y-2.5 walk:[@media(max-height:560px)]:space-y-1.5">
            {next.map(([icon, text], i) => (
              <li key={i} className="flex items-start gap-3 text-[16px] sm:text-lg walk:[@media(max-height:560px)]:text-[15px] leading-snug">
                <span className="inline-flex w-8 h-8 walk:[@media(max-height:560px)]:w-7 walk:[@media(max-height:560px)]:h-7 shrink-0 items-center justify-center rounded-full bg-rp-fire/10 text-ink-fire">
                  <Icon name={icon} className="w-4 h-4" />
                </span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      {route && <section className="h-[min(48dvh,440px)] min-h-[240px] walk:h-auto walk:min-h-0 rounded-2xl overflow-hidden border border-[--rp-border] shadow-sm">
        <RoutePreviewMap stages={game.stages ?? []} className="h-full" fill />
      </section>}
    </div>
  );
}

/** What the creator built, counted up in front of them: ownership is what makes the end memorable. */
function FinishStats({ game }: { game: Game }) {
  const sf = useT().setupFlow;
  const tasks = (game.stages ?? []).flatMap((s) => s.tasks ?? []);
  const placed = tasks.filter((t) => t.coordinates && (t.coordinates.lat !== 0 || t.coordinates.lng !== 0)).length;
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = setTimeout(() => setShown(true), 120); return () => clearTimeout(id); }, []);
  const stats: [number, string][] = [[tasks.length, sf.statMissions], [(game.stages ?? []).length, sf.statStages], [placed, sf.statPlaces]];
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {stats.map(([n, label]) => (
        <span key={label} className="inline-flex items-baseline gap-1.5 rounded-2xl bg-[--surface-0] border border-[--rp-border]/70 px-3 py-1.5 walk:[@media(max-height:560px)]:px-2.5 walk:[@media(max-height:560px)]:py-1 shadow-sm">
          <NumberFlow value={shown ? n : 0} className="text-[20px] sm:text-2xl walk:[@media(max-height:560px)]:text-[18px] font-extrabold text-ink-fire" />
          <span className="text-[14px] sm:text-[15px] walk:[@media(max-height:560px)]:text-[13px] font-semibold text-[--ink-2]">{label}</span>
        </span>
      ))}
    </div>
  );
}

// ─── The finish, part 2: what to prepare, as points to copy and share ──────────────────────────

/** The end of a game that is played later (change: creator-stays-to-the-end): done, and nothing is lost. */
function LaterEnding({ game, onFlush, onHome, onEdit, onSaveAccount, onLaunch }: {
  game: Game; onFlush: () => Promise<unknown>; onHome: () => void; onEdit: () => void; onSaveAccount?: () => void; onLaunch: () => void;
}) {
  const t = useT();
  const sf = t.setupFlow;
  const token = useRef<string | null>(null);
  const [note, setNote] = useState('');
  const days = daysUntilEvent(game.eventAt ?? null, new Date().toISOString());
  const today = days === 0;
  const share = async () => {
    setNote('');
    try {
      await onFlush();
      const result = await shareWithFriends(game, t.missionFeed.shareText({ title: game.title }), token);
      if (result === 'shared' || result === 'copied') track('feed_shared', { from: 'ready' });
      if (result === 'copied') setNote(t.missionFeed.shareCopied);
      if (result === 'failed') setNote(t.missionFeed.shareFailed);
    } catch { setNote(t.missionFeed.shareFailed); }
  };
  // Opened by hand so the entry can carry the game's link, which has to be minted first. Named before the
  // await, or a phone's popup blocker takes the new window.
  const addToCalendar = async () => {
    const win = window.open('', '_blank');
    let link = '';
    try { await onFlush(); link = await friendLink(game, token); } catch { /* the entry still has its date */ }
    const url = calendarUrl({ title: game.title, eventAt: game.eventAt ?? '', details: link ? `${sf.readyCalendarDetails} ${link}` : '' });
    if (!url) { win?.close(); return; }
    track('calendar_added');
    if (win) win.location.href = url; else window.location.href = url;
  };
  return (
    <div className="absolute inset-0 z-20 rp-setup-bg overflow-y-auto">
      <div className="min-h-full w-full max-w-md mx-auto flex flex-col justify-center gap-3 px-6 py-10">
        <span className="self-center inline-flex w-16 h-16 items-center justify-center rounded-full bg-rp-go/15 text-ink-go"><Icon name="checkCircle" className="w-8 h-8" /></span>
        <h1 className="text-center font-brand text-[34px] font-extrabold leading-tight">{today ? sf.todayTitle : sf.readyTitle}</h1>
        <p className="text-center text-[18px] font-bold text-ink-fire" dir="auto">{game.title}</p>
        {days !== null && days > 0 && <p className="text-center text-[22px] font-extrabold">{sf.readyDays({ n: days })}</p>}
        <p className="text-center text-[16px] leading-snug text-[--ink-2]">{today ? sf.todaySub : sf.readySub}</p>
        {today && <Button onClick={onLaunch} className="mt-3 min-h-[56px] text-[17px]">{sf.launchToday}</Button>}
        <Button variant={today ? 'subtle' : undefined} onClick={() => void share()} className={today ? 'min-h-[48px]' : 'mt-3 min-h-[56px] text-[17px]'}>{sf.readyShare}</Button>
        <p role="status" className="min-h-[20px] text-center text-[15px] font-semibold text-ink-fire">{note}</p>
        {!today && <Button variant="subtle" onClick={() => void addToCalendar()} className="min-h-[48px]"><Icon name="calendar" className="w-4 h-4 me-1.5" />{sf.readyCalendar}</Button>}
        {onSaveAccount && <Button variant="subtle" onClick={onSaveAccount} className="min-h-[48px]">{sf.readySave}</Button>}
        <Button variant="ghost" onClick={onEdit} className="min-h-[48px]">{sf.readyEdit}</Button>
        <Button variant="ghost" onClick={onHome} className="min-h-[48px]">{sf.readyHome}</Button>
        {!today && <button type="button" onClick={onLaunch} className="min-h-[44px] text-[14px] font-semibold text-[--ink-2] underline underline-offset-2">{sf.readyLaunchNow}</button>}
      </div>
    </div>
  );
}

function PrepBeat({ game, screens, onTestDrive, onGameChange }: { game: Game; screens: SetupScreen[]; onTestDrive?: () => void; onGameChange: (g: Game) => void }) {
  const sf = useT().setupFlow;
  // The preparations, plus a sign for every station code, in route order.
  const listed = beforeGameList(screens);
  // A mission's code sign joins that mission's entry: listed apart, one mission read as two (29.10).
  const prep = screens.flatMap((s) => {
    const own = listed.filter((p) => p.taskId === s.taskId && s.scope === 'task').map((p) => ({ ...p }));
    for (const i of s.items.filter((it) => it.fieldPath === 'smart.secretCode' && codeNeedsSign(it.instruction))) {
      const sign = sf.prepCodeLine({ code: taskIn(game, s.stageId, s.taskId)?.smart?.secretCode ?? '' });
      if (own.length > 0) own[own.length - 1].text = `${own[own.length - 1].text} ${sign}`;
      else own.push({ stepId: `${i.stepId}:sign`, taskId: s.taskId, title: s.title, text: sign });
    }
    return own;
  }).concat(listed.filter((p) => !screens.some((s) => s.scope === 'task' && s.taskId === p.taskId)));
  const shareText = prepShareText(game.title ?? '', prep, { heading: sf.shareHeading, empty: sf.prepListEmpty });
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareText); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { /* a browser that refuses the clipboard still has WhatsApp and share */ }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => { try { await navigator.share({ text: shareText }); } catch { /* dismissed: nothing to say */ } };
  return (
    <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col sm:justify-center">
      <h1 className="shrink-0 text-[26px] sm:text-4xl walk:[@media(max-height:560px)]:text-3xl font-extrabold leading-tight">{sf.prepListTitle}</h1>
      <p className="shrink-0 mt-1 text-[16px] sm:text-lg text-[--ink-2]">{sf.shareLead}</p>
      {prep.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <span className="inline-flex w-16 h-16 items-center justify-center rounded-full bg-rp-go/15 text-ink-go"><Icon name="checkCircle" className="w-8 h-8" /></span>
          <p className="text-[17px] font-semibold">{sf.prepListEmpty}</p>
        </div>
      ) : (
        // Never its own scroll: a long list makes the SCREEN scroll, once (Ahiya 27.10).
        <ul className="mt-3 space-y-2.5 rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3.5 sm:p-5">
          {prep.map((p) => (
            <li key={p.stepId} className="flex gap-3">
              <span aria-hidden className="mt-[0.55rem] h-2 w-2 shrink-0 rounded-full bg-rp-fire" />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-[--ink-3]" dir="auto">{p.title}</span>
                <span className="block text-[16px] sm:text-lg leading-snug" dir="auto">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {prep.length > 0 && <div className="shrink-0 mt-3 grid grid-cols-2 sm:flex gap-2">
        <Button variant="subtle" onClick={copy}><Icon name={copied ? 'check' : 'clipboard'} className="w-4 h-4 me-1.5" />{copied ? sf.copied : sf.copy}</Button>
        <a href={whatsappShareUrl(shareText)} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#0E7A6D] text-white hover:brightness-110 transition">
          <Icon name="chat" className="w-4 h-4 me-1.5" />{sf.whatsapp}
        </a>
        {canShare && <Button variant="ghost" onClick={share} className="col-span-2 sm:col-span-1"><Icon name="link" className="w-4 h-4 me-1.5" />{sf.share}</Button>}
      </div>}
      <EventDateRow game={game} onGameChange={onGameChange} />
      {onTestDrive && <TryItCard onTestDrive={onTestDrive} />}
    </div>
  );
}
