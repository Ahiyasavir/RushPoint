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
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { isTaskMediaValid, type Game, type Task, type TaskMedia, type TemplateWizardStep } from '@rushpoint/shared';
import { useT, useLanguage } from './LanguageContext';
import { Button } from './ui';
import { Icon, type IconName } from './Icon';
import LocationStep from './LocationStep';
import RoutePreviewMap from './RoutePreviewMap';
import ConfettiBurst from './ConfettiBurst';
import TaskWizard from './TaskWizard';
import { uploadTaskMedia } from '../services/firebase';
import { SENTENCE_FIELDS } from '../lib/quickSetup';
import NumberFlow from '@number-flow/react';
import { playSetupSound, soundEnabled, setSoundEnabled, type SetupSound } from '../lib/setupSounds';
import { TAP_CLUSTER, TAP_TARGET } from '../lib/interaction';
import { parseSentence, hasOpenSlots, extractSlotValues, fillTemplate, generateCode } from '../lib/sentenceForm';
import {
  buildSetupScreens, buildSetupBeats, firstBeat, praiseIndex, stageProgress, planStages,
  beforeGameList, gameFieldValue, withGameField, prepShareText, whatsappShareUrl,
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
  onTaskChange: (stageId: string, task: Task) => void;
  onGameChange: (game: Game) => void;
  /** "I'll edit it myself": leave the walk for the full editor, on this mission when there is one. */
  onEditMyself: (stageId: string | null, taskId: string | null) => void;
  /** "Another mission": swap this mission for another from the bank, in place. False when none is left. */
  onRegenerate?: (stageId: string, taskId: string) => boolean;
  onLaunch: () => void;
  onDone: () => void;
  gameAnchors?: readonly { lat: number; lng: number }[];
}

type SF = ReturnType<typeof useT>['setupFlow'];

function taskIn(game: Game, stageId: string, taskId: string): Task | null {
  const st = (game.stages ?? []).find((s) => s.id === stageId);
  return (st?.tasks ?? []).find((t) => t.id === taskId) ?? null;
}

export default function SetupFlow({
  game, steps, resume, onTaskChange, onGameChange, onEditMyself, onRegenerate, onLaunch, onDone, gameAnchors,
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
  const go = (to: number) => {
    const clamped = Math.max(0, Math.min(beats.length - 1, to));
    const cur = itemAt(at);
    const forward = clamped > at;
    setPrevDone(!!cur && cur.item.configured && forward);
    // Finishing a stage is a moment of its own (goal gradient: the next stage starts with a win).
    const next = itemAt(clamped);
    const stageClosed = forward && !!cur && cur.screen.scope === 'task'
      && (!next || next.screen.stageId !== cur.screen.stageId)
      && screens.filter((x) => x.stageId === cur.screen.stageId).every((x) => x.done);
    if (stageClosed && beats[clamped]?.kind === 'item') {
      const n = sortedStages.findIndex((x) => x.id === cur.screen.stageId) + 1;
      if (n > 0) { setCheer(n); play('stage'); void burst(0.35); }
    } else play(forward && cur?.item.configured ? 'step' : 'tap');
    setDir(clamped >= at ? 1 : -1);
    setAt(clamped);
  };

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
  const regenerate = () => {
    if (!current || current.screen.scope !== 'task' || !onRegenerate) return;
    if (onRegenerate(current.screen.stageId, current.screen.taskId)) {
      play('swap');
      setSwapped(current.screen.taskId);
      setDir(1);
      setSwapTick((n) => n + 1);
    }
  };
  // The moment a field becomes filled: a bright drop, a "saved" mark, and Next lights up.
  const filledKey = current ? `${current.screen.key}|${current.item.stepId}` : '';
  const wasFilled = useRef<{ key: string; on: boolean }>({ key: '', on: false });
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

  // Overall readiness, with the build itself counted as the first step done (endowed progress: the
  // creator starts ahead, because they are ahead).
  const items = beats.map((_, i) => itemAt(i)).filter((x): x is NonNullable<ReturnType<typeof itemAt>> => !!x);
  const doneItems = items.filter((x) => x.item.configured).length;
  const pct = beat.kind === 'finish' || beat.kind === 'prep' ? (finishOpen ? Math.round((100 * (1 + doneItems)) / (1 + items.length)) : 100)
    : Math.round((100 * (1 + doneItems)) / (1 + items.length));
  const openLeft = items.filter((x) => x.item.required && !x.item.configured).length;

  const stageIndex = current ? sortedStages.findIndex((s) => s.id === current.screen.stageId) : -1;
  const missionNumber = current && current.screen.scope === 'task' ? missionScreens.findIndex((s) => s.key === current.screen.key) + 1 : 0;
  const placeLine = [
    stageIndex >= 0 ? sf.stageOf({ n: stageIndex + 1, title: sortedStages[stageIndex].title ?? '' }) : '',
    missionNumber > 0 ? sf.missionOf({ n: missionNumber, total: missionScreens.length }) : '',
  ].filter(Boolean).join(' · ');

  // Motion: short and directional, never a wait (Ahiya: "light, simple, and they must not take the
  // user's time"). Forward slides the way the reading direction moves.
  const offset = reduce ? 0 : (rtl ? -1 : 1) * 24 * dir;
  const variants = {
    enter: { opacity: 0, x: offset },
    center: { opacity: 1, x: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { opacity: 0, x: -offset, transition: { duration: 0.1, ease: 'easeIn' as const } },
  };

  const primary = (() => {
    if (beat.kind === 'plan') return { label: sf.planCta, onClick: () => go(at + 1), arrow: true };
    if (beat.kind === 'prep') return { label: sf.launch, onClick: onLaunch, arrow: false };
    if (current?.item.kind === 'prep' && current.item.configured) return { label: sf.prepCta, onClick: () => go(nextFrom(at)), arrow: true };
    return { label: sf.next, onClick: () => go(nextFrom(at)), arrow: true };
  })();
  const skipping = !!current && current.item.required && !current.item.configured;

  // Portalled to the body: rendered inside the Builder it sat in the Builder's stacking context, and
  // the live-run bar (z-30, on the body) drew over it.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={sf.aria}
      className="fixed inset-0 z-[70] flex flex-col h-[100dvh] rp-setup-bg text-[--ink-1] overflow-hidden">
      <span aria-hidden className="rp-setup-orb rp-setup-orb-1" />
      <span aria-hidden className="rp-setup-orb rp-setup-orb-2" />
      <AnimatePresence>
        {cheer !== null && (
          <motion.div key={cheer} role="status"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }}
            transition={reduce ? { duration: 0.1 } : { type: 'spring', stiffness: 420, damping: 24 }}
            className="pointer-events-none fixed inset-x-0 top-28 z-[80] mx-auto w-fit max-w-[90vw] rounded-3xl bg-gradient-to-l from-rp-fire to-rp-amber px-6 py-3.5 text-center text-white shadow-2xl shadow-rp-fire/40">
            <div className="flex items-center justify-center gap-2 text-[20px] sm:text-2xl font-extrabold"><Icon name="trophy" className="w-6 h-6" />{sf.stageDone({ n: cheer })}</div>
            <div className="text-[14px] sm:text-[15px] font-semibold opacity-95">{sf.stageDoneSub}</div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ── Header: the progress by stage, and the side door out ───────────────────────────── */}
      <header className="relative z-10 shrink-0 border-b border-[--rp-border]/60 bg-[--surface-0]/70 backdrop-blur-xl pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div className="mx-auto w-full max-w-5xl px-4 pb-2.5">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-[15px] font-bold min-w-0">
              <span className="inline-flex w-8 h-8 shrink-0 items-center justify-center rounded-full bg-rp-fire/10 text-ink-fire"><Icon name="sparkle" className="w-4 h-4" /></span>
              <span className={`truncate ${onRegenerate && current?.screen.scope === 'task' ? 'hidden sm:inline' : ''}`}>{sf.aria}</span>
            </span>
            <div className="ms-auto shrink-0 flex items-center gap-2">
              {onRegenerate && current?.screen.scope === 'task' && (
                <button type="button" onClick={regenerate} aria-label={sf.newMissionAria} title={sf.newMissionAria}
                  className="min-h-[44px] px-3 rounded-xl border border-rp-fire/40 bg-rp-fire/5 text-[14px] font-semibold text-ink-fire hover:bg-rp-fire/10 transition-colors inline-flex items-center gap-1.5">
                  <Icon name="dice" className="w-4 h-4" />{sf.newMission}
                </button>
              )}
              <button type="button" onClick={() => onEditMyself(current?.screen.stageId || null, current?.screen.taskId || null)}
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
            <div className="mt-2.5" aria-hidden>
              <div className="flex gap-1.5">
                {progress.map((p) => (
                  <div key={p.stageId} className="h-2 rounded-full bg-[--surface-2] overflow-hidden" style={{ flexGrow: p.total, flexBasis: 0 }}>
                    <div className="h-full rounded-full bg-rp-fire transition-[width] duration-300 ease-out"
                      style={{ width: `${beat.kind === 'finish' || beat.kind === 'prep' ? 100 : Math.round((p.done / p.total) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5 text-[11px] sm:text-[12px] text-[--ink-3]">
                {progress.map((p, i) => (
                  <span key={p.stageId} className={`truncate text-center ${p.current ? 'text-ink-fire font-bold' : ''}`} style={{ flexGrow: p.total, flexBasis: 0 }}>
                    {sf.planStage({ n: i + 1 })}
                  </span>
                ))}
              </div>
            </div>
          )}
          {items.length > 0 && (
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[13px] sm:text-[14px]">
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
      <div ref={bodyRef} className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`${at}-${swapTick}`} variants={variants} initial="enter" animate="center" exit="exit"
            className="mx-auto w-full max-w-5xl h-full px-4 py-3 sm:py-5 flex flex-col lg:my-5 lg:h-[calc(100%-2.5rem)] lg:rounded-[28px] lg:border lg:border-white/70 lg:bg-[--surface-0]/85 lg:backdrop-blur-xl lg:px-10 lg:py-8 lg:shadow-[0_30px_80px_-40px_rgba(255,87,34,0.45)]">
            {beat.kind === 'plan' && <PlanBeat game={game} itemCount={beats.filter((b) => b.kind === 'item').length} />}
            {beat.kind === 'item' && current && (
              <ItemBeat
                game={game} screen={current.screen} item={current.item} first={beat.firstOfMission}
                praise={(() => { const p = praiseIndex(at, prevDone); return p === null ? '' : sf.praise[p % sf.praise.length]; })()}
                placeLine={placeLine}
                onTaskChange={onTaskChange} onGameChange={onGameChange} gameAnchors={gameAnchors}
                onOpenFull={() => onEditMyself(current.screen.stageId || null, current.screen.taskId || null)}
              />
            )}
            {beat.kind === 'finish' && <RouteBeat game={game} screens={screens} beats={beats} onJump={go} onFix={startFixing} />}
            {beat.kind === 'prep' && <PrepBeat game={game} screens={screens} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Footer: one primary, always live (an answering button, never a disabled one) ──────── */}
      <footer className="relative z-10 shrink-0 border-t border-[--rp-border]/60 bg-[--surface-0]/75 backdrop-blur-xl pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="mx-auto w-full max-w-5xl px-4 pt-2.5 flex items-center gap-2">
          {at > 0 && (
            <Button variant="ghost" onClick={() => go(at - 1)} className="shrink-0 px-3">{rtl ? '→' : '←'} {sf.back}</Button>
          )}
          {beat.kind === 'prep' && <Button variant="ghost" onClick={onDone} className="shrink-0 px-3">{sf.toBuilder}</Button>}
          <div className="ms-auto flex items-center gap-3 min-w-0">
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
            <Button key={`cta-${justFilled}`} onClick={primary.onClick}
              className={`min-w-[8.5rem] sm:min-w-[11rem] text-[16px] font-bold ${justFilled > 0 && current?.item.configured ? 'rp-cta-ready' : ''}`}>
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

function PlanBeat({ game, itemCount }: { game: Game; itemCount: number }) {
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

function ItemBeat({
  game, screen, item, first, praise, placeLine, onTaskChange, onGameChange, gameAnchors, onOpenFull,
}: {
  game: Game; screen: SetupScreen; item: SetupItem; first: boolean; praise: string; placeLine: string;
  onTaskChange: (stageId: string, task: Task) => void; onGameChange: (g: Game) => void;
  gameAnchors?: SetupFlowProps['gameAnchors']; onOpenFull: () => void;
}) {
  const sf = useT().setupFlow;
  const reduce = useReducedMotion();
  const rtl = useLanguage().lang === 'he';
  const task = screen.scope === 'task' ? taskIn(game, screen.stageId, screen.taskId) : null;
  const ask = askFor(item, sf, task);
  const fills = FILLS.has(item.fieldPath);
  const field = (
    <FieldInput game={game} screen={screen} item={item} task={task} onTaskChange={onTaskChange}
      onGameChange={onGameChange} gameAnchors={gameAnchors} onOpenFull={onOpenFull} />
  );

  return (
    // Desktop: the mission on one side, the action on the other, both the body's full height.
    // Phone and tablet: one column, the mission first (you need to know what happens there before you
    // place or fill it), the action taking the rest.
    <div className={`flex-1 min-h-0 flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8 ${fills ? '' : 'sm:justify-center lg:content-center'}`}>
      {screen.scope === 'task' && (
        <motion.section
          initial={reduce ? false : { opacity: 0, y: 10, rotate: rtl ? 1 : -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 28 }}
          className="shrink-0 lg:shrink lg:min-h-0 lg:overflow-y-auto rounded-3xl bg-[--surface-0] border border-[--rp-border]/70 shadow-[0_18px_40px_-28px_rgba(255,87,34,0.55)] overflow-hidden">
          <div aria-hidden className="h-1.5 bg-gradient-to-l from-rp-fire to-rp-amber" />
          <div className="px-4 py-3.5 sm:p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="inline-flex w-11 h-11 sm:w-12 sm:h-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rp-fire to-rp-amber text-white shadow-md shadow-rp-fire/30">
                <Icon name={TYPE_ICON[screen.taskType ?? ''] ?? 'flag'} className="w-5 h-5 sm:w-6 sm:h-6" />
              </span>
              <div className="min-w-0">
                <div className="text-[14px] sm:text-[15px] font-semibold text-ink-fire truncate">{placeLine}</div>
                <h2 className={`font-extrabold leading-tight ${first ? 'text-[26px] sm:text-4xl' : 'text-[24px] sm:text-3xl'}`} dir="auto">{screen.title}</h2>
              </div>
            </div>
            {screen.playerText !== '' && (
              <div className="mt-3">
                <div className="text-[13px] sm:text-[14px] font-semibold text-[--ink-3]">{sf.teamsWill}</div>
                <p className="mt-0.5 text-[16px] sm:text-lg leading-snug sm:leading-relaxed text-[--ink-1] whitespace-pre-line" dir="auto">{blanked(screen.playerText)}</p>
              </div>
            )}
            {screen.taskType && (sf.howDone[screen.taskType] ?? '') !== '' && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rp-fire/10 px-3 py-1.5 text-[14px] sm:text-[15px] font-semibold text-ink-fire">
                <Icon name="flag" className="w-4 h-4 shrink-0" />{sf.howDone[screen.taskType]}
              </p>
            )}
            {task?.hideLocation === true && (
              <p className="mt-2 flex items-start gap-1.5 rounded-2xl bg-violet-600/10 px-3 py-2 text-[14px] sm:text-[15px] font-semibold text-violet-800 dark:text-violet-300">
                <Icon name="eyeOff" className="w-4 h-4 mt-0.5 shrink-0" />{sf.hiddenNote}
              </p>
            )}
          </div>
        </motion.section>
      )}

      <section className={`min-h-0 flex flex-col ${fills ? 'flex-1' : ''} ${screen.scope === 'task' ? '' : 'lg:col-span-2 w-full max-w-2xl mx-auto'}`}>
        {praise !== '' && (
          <motion.div initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}
            className="shrink-0 text-[19px] sm:text-xl font-extrabold text-ink-fire">{praise}</motion.div>
        )}
        {item.kind === 'prep' ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 32, mass: 0.7 }}
            className={`mt-1 rounded-2xl border-2 border-rp-amber/70 bg-rp-amber/10 p-3 sm:p-5 rp-prep-glow flex flex-col ${fills && !item.configured ? 'flex-1 min-h-0' : 'shrink-0'}`}>
            <div className="flex items-start gap-3 shrink-0">
              <motion.span
                initial={reduce ? false : { rotate: -12 }} animate={{ rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }}
                className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-rp-amber text-white">
                <Icon name="backpack" className="w-5 h-5" />
              </motion.span>
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-rp-amber/20 px-2.5 py-0.5 text-[13px] font-bold text-ink-amber">{sf.prepLabel}</div>
                <p className="mt-1.5 text-[17px] sm:text-xl font-semibold leading-snug" dir="auto">{item.instruction}</p>
                <p className="mt-1.5 text-[12px] sm:text-[13px] text-[--ink-2] flex items-center gap-1.5"><Icon name="checkCircle" className="w-4 h-4 text-ink-go shrink-0" />{sf.prepNote}</p>
              </div>
            </div>
            {!item.configured && (
              <div className={`mt-3 rounded-xl bg-[--surface-0] p-2.5 sm:p-3 flex flex-col ${fills ? 'flex-1 min-h-0' : ''}`}>
                {ask.title !== item.instruction && <p className="mb-2 shrink-0 text-[17px] font-bold">{ask.title}</p>}
                {field}
              </div>
            )}
          </motion.div>
        ) : (
          <>
            <h3 className="shrink-0 text-[22px] sm:text-3xl font-extrabold leading-snug">{ask.title}</h3>
            {ask.hint !== '' && <p className="mt-1 shrink-0 text-[16px] sm:text-lg text-[--ink-2] leading-snug" dir="auto">{ask.hint}</p>}
            <div className={`mt-3 flex flex-col ${fills ? 'flex-1 min-h-0' : 'shrink-0'}`}>{field}</div>
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
        <div className="flex-1 min-h-[220px] flex flex-col rounded-2xl overflow-hidden border border-[--rp-border]">
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
          <input className={`${BOX} font-mono tracking-[0.25em] text-center text-xl`} value={code} dir="ltr" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <Button variant="subtle" className="shrink-0 min-h-[50px]" onClick={() => setCode(generateCode())}>
            <Icon name="dice" className="w-4 h-4 me-1.5" />{sf.makeCode}
          </Button>
        </div>
      );
    }
    case 'answers': {
      const choices = (task.choices ?? []).filter((c) => c.trim() !== '');
      const answer = task.answers?.[0] ?? '';
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
      return <input className={BOX} value={answer} dir="auto" onChange={(e) => put({ answers: [e.target.value, ...(task.answers ?? []).slice(1)] })} />;
    }
    case 'numericAnswer':
      return <input className={`${BOX} text-center text-xl`} type="number" inputMode="decimal" dir="ltr"
        value={Number.isFinite(task.numericAnswer) ? String(task.numericAnswer) : ''}
        onChange={(e) => { const n = e.target.value === '' ? undefined : Number(e.target.value); put({ numericAnswer: Number.isFinite(n) ? n : undefined }); }} />;
    case 'hint':
      return <textarea className={`${BOX} min-h-[100px]`} value={task.hint ?? ''} dir="auto" onChange={(e) => put({ hint: e.target.value })} />;
    case 'locationClue':
      return <textarea className={`${BOX} min-h-[100px]`} value={task.locationClue ?? ''} dir="auto" onChange={(e) => put({ locationClue: e.target.value })} />;
    case 'orderItems': case 'choices': {
      const key = item.fieldPath as 'orderItems' | 'choices';
      return <ListRows rows={task[key] ?? []} ordered={key === 'orderItems'} onChange={(rows) => put({ [key]: rows } as Partial<Task>)} />;
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
  return (
    <p className="rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3.5 sm:p-5 text-[18px] sm:text-xl leading-[2.5] text-[--ink-1]" dir="auto">
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
function ListRows({ rows, onChange, ordered = false }: { rows: readonly string[]; onChange: (rows: string[]) => void; ordered?: boolean }) {
  const sf = useT().setupFlow;
  const reduce = useReducedMotion();
  const min = ordered ? 3 : 2;
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
          <input className={BOX} value={r} dir="auto" onChange={(e) => { const next = [...shown]; next[i] = e.target.value; set(next); }} />
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
      if (!isTaskMediaValid({ kind, url })) { setFailed(true); return; }
      onChange([...(latest.current.media ?? []), { id: uuid(), kind, url }]);
    } catch { setFailed(true); } finally { setPct(null); }
  };
  return (
    <div className="flex items-stretch gap-2">
      {images.map((m) => <img key={m.id} src={m.url} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover border border-[--rp-border]" />)}
      <label className="flex-1 flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-rp-fire/50 bg-rp-fire/5 text-ink-fire hover:bg-rp-fire/10 transition-colors">
        <Icon name="camera" className="w-7 h-7" />
        <span className="text-[15px] font-semibold">{pct !== null ? sf.uploading({ pct: Math.round(pct) }) : images.length > 0 ? sf.photoAdded : sf.pickPhoto}</span>
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
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-8">
      {ready && !reduce && <ConfettiBurst />}
      <section className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center gap-3">
          <motion.span initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 22 }}
            className={`inline-flex w-11 h-11 shrink-0 items-center justify-center rounded-full text-white ${ready ? 'bg-rp-go' : 'bg-rp-amber'}`}>
            <Icon name={ready ? 'check' : 'flag'} className="w-6 h-6" />
          </motion.span>
          <div className="min-w-0">
            <h1 className="text-[26px] sm:text-4xl font-extrabold leading-tight">{ready ? sf.finishTitle : sf.finishTitleGaps({ n: left.length })}</h1>
            {ready && <FinishStats game={game} />}
            <p className="text-[16px] sm:text-lg text-[--ink-2]">{sf.finishLead}</p>
          </div>
        </div>
        <div className="mt-3 flex-1 min-h-[200px] rounded-2xl overflow-hidden border border-[--rp-border]">
          <RoutePreviewMap stages={game.stages ?? []} className="h-full" fill />
        </div>
      </section>
      {left.length > 0 && (
        <section className="shrink-0 lg:min-h-0 lg:overflow-y-auto">
          <Button onClick={onFix} className="w-full min-h-[50px] text-[16px] font-bold mb-3">
            <Icon name="sparkle" className="w-5 h-5 me-1.5" />{sf.finishFix}
          </Button>
          <h2 className="text-[17px] font-bold">{sf.finishLeft}</h2>
          <ul className="mt-1.5 flex flex-wrap gap-2 lg:flex-col">
            {left.map((l) => (
              <li key={l.i}>
                <button type="button" onClick={() => onJump(l.i)}
                  className="min-h-[44px] flex items-center gap-2 rounded-xl border border-[--rp-border] px-3 text-start hover:bg-[--surface-2] lg:w-full">
                  <Icon name="alert" className="w-4 h-4 text-ink-amber shrink-0" />
                  <span className="truncate text-[16px]" dir="auto">{l.title}</span>
                  <span className="text-[13px] font-semibold text-ink-fire">{sf.finishGo}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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
        <span key={label} className="inline-flex items-baseline gap-1.5 rounded-2xl bg-[--surface-0] border border-[--rp-border]/70 px-3 py-1.5 shadow-sm">
          <NumberFlow value={shown ? n : 0} className="text-[20px] sm:text-2xl font-extrabold text-ink-fire" />
          <span className="text-[14px] sm:text-[15px] font-semibold text-[--ink-2]">{label}</span>
        </span>
      ))}
    </div>
  );
}

// ─── The finish, part 2: what to prepare, as points to copy and share ──────────────────────────

function PrepBeat({ game, screens }: { game: Game; screens: SetupScreen[] }) {
  const sf = useT().setupFlow;
  // The preparations, plus a sign for every station code, in route order.
  const listed = beforeGameList(screens);
  const prep = screens.flatMap((s) => [
    ...listed.filter((p) => p.taskId === s.taskId && s.scope === 'task'),
    ...s.items.filter((i) => i.fieldPath === 'smart.secretCode').map((i) => ({
      stepId: `${i.stepId}:sign`, taskId: s.taskId, title: s.title,
      text: sf.prepCodeLine({ code: taskIn(game, s.stageId, s.taskId)?.smart?.secretCode ?? '' }),
    })),
  ]).concat(listed.filter((p) => !screens.some((s) => s.scope === 'task' && s.taskId === p.taskId)));
  const shareText = prepShareText(game.title ?? '', prep, { heading: sf.shareHeading, empty: sf.prepListEmpty });
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareText); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { /* a browser that refuses the clipboard still has WhatsApp and share */ }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => { try { await navigator.share({ text: shareText }); } catch { /* dismissed: nothing to say */ } };
  return (
    <div className="w-full max-w-2xl mx-auto flex-1 min-h-0 flex flex-col sm:justify-center">
      <h1 className="shrink-0 text-[26px] sm:text-4xl font-extrabold leading-tight">{sf.prepListTitle}</h1>
      <p className="shrink-0 mt-1 text-[16px] sm:text-lg text-[--ink-2]">{sf.shareLead}</p>
      {prep.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <span className="inline-flex w-16 h-16 items-center justify-center rounded-full bg-rp-go/15 text-ink-go"><Icon name="checkCircle" className="w-8 h-8" /></span>
          <p className="text-[17px] font-semibold">{sf.prepListEmpty}</p>
        </div>
      ) : (
        // The one region that may scroll on a small phone, and only if the list is long: the share
        // buttons below it stay in the frame either way.
        <ul className="mt-3 min-h-0 overflow-y-auto overscroll-contain space-y-2.5 rounded-2xl border border-[--rp-border] bg-[--surface-1] p-3.5 sm:p-5">
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
    </div>
  );
}
