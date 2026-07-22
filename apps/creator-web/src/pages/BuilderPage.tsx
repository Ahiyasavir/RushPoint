import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Game, Stage, Task, ScoringPreset, RegistrationField, GameMode, GameInstructions,
} from '@rushpoint/shared';
import { PRESET_LABELS, PAYMENTS_ENABLED, isAllowedWebhookUrl, validateUnlockGraph, partialStageStarvationWarning, maxAttainableCompletions, effectiveExclusiveGroups } from '@rushpoint/shared';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, MeasuringStrategy,
  useSensor, useSensors,
} from '@dnd-kit/core';
import type {
  Announcements, DragEndEvent, DragStartEvent, KeyboardCoordinateGetter, ScreenReaderInstructions,
} from '@dnd-kit/core';
import { getGame, updateGame, launchRun } from '../services/calls';
import { Advanced, Badge, Button, Card, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { dialog } from '../components/dialog';
import { useT } from '../components/LanguageContext';
import TaskLibrary from '../components/TaskLibrary';
import StageRail, { STAGE_DROP_PREFIX, railAwareCollisionDetection } from '../components/StageRail';
import TaskCanvas from '../components/TaskCanvas';
import TaskCard, { GROUP_STYLES, type TaskGroupBadge } from '../components/TaskCard';
import ExclusiveGroupsModal from '../components/ExclusiveGroupsModal';
import TaskWizard from '../components/TaskWizard';
import {
  moveItem, moveTaskBetweenStages, clampRequiredTaskCount,
  normalizeGroups, setTaskGroup, removeTaskFromGroups, groupIndexOfTask,
} from '../lib/reorder';
import { useHistory } from '../lib/useHistory';
import { initDraft, editDraft, isDirty, commit, type DraftState } from '../lib/taskDraft';
import { blankTask, isTaskInteractionValid, isTaskLocationValid } from '../lib/wizardLogic';
import { storyFieldCount } from '../lib/wizardSections';

// MapLibre is heavy (~500KB). The located-task map lives in lazy LocationStep
// (fetched only when a located task editor opens); the preview route map is split
// the same way here so it stays out of the main builder bundle.
const RoutePreviewMap = lazy(() => import('../components/RoutePreviewMap'));

// Lightweight placeholder while a map chunk + engine load.
function MapSkeleton({ className = 'h-44' }: { className?: string }) {
  const b = useT().builder;
  return (
    <div className={`${className} rounded-lg border border-[--rp-border] bg-[--surface-2] animate-pulse flex items-center justify-center gap-2 text-xs text-[--ink-3]`}>
      <span>🗺</span> {b.loadingMapShort}
    </div>
  );
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/**
 * Keyboard arrow navigation for the Builder's drags (change: builder-dnd-groups).
 *
 * dnd-kit ships `sortableKeyboardCoordinates`, which navigates GEOMETRICALLY. That
 * breaks down on the task canvas, which is a 2-column grid rendered right-to-left:
 * "down" from the first card lands between rows and reads as a dead key, and after
 * one horizontal step the walk gets stuck. Since what the creator is editing is an
 * ORDERED LIST, this getter walks the sortable order instead: Down/Up are always
 * next/previous, and Left/Right follow the document's writing direction. Predictable
 * in either language, in either branch of the canvas, and unaffected by the column
 * count. Cross-STAGE moves stay on the card's ⋯ menu, which is a real listbox.
 */
const arrowKeyCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
  const forward = event.code === 'ArrowDown' || event.code === (rtl ? 'ArrowLeft' : 'ArrowRight');
  const back = event.code === 'ArrowUp' || event.code === (rtl ? 'ArrowRight' : 'ArrowLeft');
  if (!forward && !back) return undefined;
  event.preventDefault();

  const activeId = context.active?.id;
  if (activeId == null) return undefined;
  const self = context.droppableContainers.get(activeId);
  const containerId = self?.data.current?.sortable?.containerId;
  if (containerId == null) return undefined;

  // Siblings of the SAME sortable context, in their current sort order.
  const siblings = Array.from(context.droppableContainers.values())
    .filter((c) => c.data.current?.sortable?.containerId === containerId)
    .sort((a, b) => (a.data.current?.sortable?.index ?? 0) - (b.data.current?.sortable?.index ?? 0));
  const at = siblings.findIndex((c) => c.id === activeId);
  const target = siblings[at + (forward ? 1 : -1)];
  // Fall back to the containers' own rects: immediately after the lift the
  // measuring pass may not have produced a collisionRect / droppableRects yet, and
  // returning undefined there would silently SWALLOW the creator's first arrow key.
  const targetRect = target && (context.droppableRects.get(target.id) ?? target.rect.current);
  const from = context.collisionRect
    ?? context.active?.rect.current.translated
    ?? context.active?.rect.current.initial;
  if (!targetRect || !from) return undefined;

  // Translate the pointer by the gap between the dragged rect and the target rect;
  // dnd-kit derives the collision rect from that delta.
  return { x: currentCoordinates.x + (targetRect.left - from.left), y: currentCoordinates.y + (targetRect.top - from.top) };
};

function blankStage(order: number, title: string): Stage {
  return { id: uuid(), order, title, tasks: [blankTask()] };
}

// The exact fields persisted by updateGame — kept in one place so the auto-save
// payload and the dirty-check serialization can never drift apart.
function buildSavePayload(g: Game) {
  return {
    gameId: g.id,
    title: g.title,
    description: g.description,
    mode: g.mode,
    stages: g.stages,
    scoringPreset: g.scoringPreset,
    registrationFields: g.registrationFields,
    tags: g.tags,
    // Chat integration (change: chat-integrations). Undefined when unset (skipped
    // server-side); '' clears it. Only ever patched with an empty or valid URL.
    integrationWebhookUrl: g.integrationWebhookUrl,
    // Marketplace instant play (change: marketplace-instant-play).
    allowInstantPlay: g.allowInstantPlay,
    // Live photo feed (change: live-photo-feed). Undefined means on (default).
    photoFeedEnabled: g.photoFeedEnabled,
    // Power-ups (change: power-ups). Undefined means off (default).
    powerUpsEnabled: g.powerUpsEnabled,
    // Staged leaderboard reveal (change: manual-leaderboard-reveal). Undefined
    // means off (default) = finalizeRun auto publishes, the prior behaviour.
    manualLeaderboardReveal: g.manualLeaderboardReveal,
    // Game intro primer (change: game-intro-instructions). Undefined when unset
    // (skipped server-side); an empty/whitespace-only primer clears it on save.
    instructions: g.instructions,
  };
}
const serializeGame = (g: Game) => JSON.stringify(buildSavePayload(g));

type SaveStatus = 'saved' | 'saving' | 'unsaved';
const AUTOSAVE_DELAY = 1500;

// The persistent shell's top-level views (change: v2.1-builder-shell-redesign).
type BuilderTab = 'build' | 'preview' | 'analytics' | 'settings';
const BUILDER_TAB_IDS: BuilderTab[] = ['build', 'preview', 'analytics', 'settings'];

// Inline-editable game title promoted into the shell header. Enter blurs (which
// autosaves via the debounced patch); an empty value reverts to the prior title.
function EditableTitle({ title, onCommit }: { title: string; onCommit: (t: string) => void }) {
  const fallback = useT().builder.untitledGame;
  return (
    <h2
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      dir="auto"
      onKeyDown={(e) => {
        // Enter commits (blur flushes), Escape reverts. Both explicitly blur so
        // the title never stays in edit mode or inserts a stray line break.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.textContent = title || fallback;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const v = e.currentTarget.textContent?.trim() ?? '';
        if (v && v !== title) onCommit(v);
        else e.currentTarget.textContent = title || fallback;
      }}
      className="text-lg font-bold text-[--ink-1] outline-none rounded px-1 -mx-1 border-b border-transparent focus:border-rp-fire min-w-[6ch] max-w-[40ch] whitespace-nowrap overflow-hidden text-ellipsis"
    >
      {title || fallback}
    </h2>
  );
}

export default function BuilderPage() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const b = useT().builder;
  const TAB_LABEL: Record<BuilderTab, string> = {
    build: b.tabBuild, preview: b.tabPreview, analytics: b.tabAnalytics, settings: b.tabSettings,
  };
  // `game` flows through an undo/redo history so every edit (typing, reorder,
  // delete) can be reverted. `setGame` is the history-aware setter handed to the
  // sub-steps; undo/redo restore prior snapshots and the autosave effect then
  // persists them just like any other change.
  const history = useHistory<Game | null>(null);
  const game = history.state;
  const setGame = history.set as (g: Game) => void;
  const { undo, redo, canUndo, canRedo } = history;
  const [tab, setTab] = useState<BuilderTab>('build');
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  // Refs let the debounced auto-save and the beforeunload guard read the latest
  // game/saved-snapshot without re-subscribing on every keystroke.
  const gameRef = useRef<Game | null>(null);
  const savedSnapshot = useRef<string>('');
  const saveTimer = useRef<number>();
  useEffect(() => { gameRef.current = game; }, [game]);

  useEffect(() => {
    if (!gameId) return;
    setError(null);
    void getGame({ gameId })
      .then(({ game }) => {
        history.reset(game);
        savedSnapshot.current = serializeGame(game);
        setStatus('saved');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message.replace('Firebase: ', '') : b.cannotLoad);
      });
  }, [gameId, loadKey]);

  function patch(p: Partial<Game>) { history.set((g) => (g ? { ...g, ...p } : g)); }

  // Persist only when there are real changes; safe to call eagerly (no-op when
  // the current state already matches what was last saved).
  const save = useCallback(async (): Promise<boolean> => {
    const g = gameRef.current;
    if (!g) return true;
    const snap = serializeGame(g);
    if (snap === savedSnapshot.current) return true;
    setStatus('saving');
    try {
      await updateGame(buildSavePayload(g));
      savedSnapshot.current = snap;
      // If the user kept editing during the round-trip, stay 'unsaved'.
      const latest = gameRef.current;
      setStatus(latest && serializeGame(latest) !== snap ? 'unsaved' : 'saved');
      return true;
    } catch {
      setStatus('unsaved');
      return false;
    }
  }, []);

  // Debounced auto-save: mark dirty immediately, persist after a short pause.
  useEffect(() => {
    if (!game) return;
    if (serializeGame(game) === savedSnapshot.current) return;
    setStatus('unsaved');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void save(); }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(saveTimer.current);
  }, [game, save]);

  // Warn before leaving/closing the tab with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const g = gameRef.current;
      if (g && serializeGame(g) !== savedSnapshot.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Keyboard undo/redo: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y). When focus
  // is in a text field we defer to the browser's native field-level undo so we
  // don't yank away game state the user can't see being edited.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n) return false;
      const tag = n.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  async function saveAndLaunch(testDrive = false) {
    if (!game) return;
    window.clearTimeout(saveTimer.current);
    // Don't launch on top of a failed save — the run would use stale/unsaved data.
    if (!(await save())) { await dialog.alert(b.saveFailed); return; }
    if (game.stages.length === 0 || game.stages.some((s) => s.tasks.length === 0)) {
      await dialog.alert(b.everyStageNeedsTask); return;
    }
    // Block launching an unplayable game: a quiz/numeric/station/sequence task with
    // no answer key can never be completed by a participant. The wizard's Done gate
    // only covers closing via Done — a task closed with ✕/Esc, or edited then left
    // incomplete, would otherwise ship. updateGame doesn't reject these server-side.
    const badTask = game.stages.flatMap((s) => s.tasks).find((tk) => !isTaskInteractionValid(tk));
    if (badTask) {
      await dialog.alert(b.taskNotCompletable(badTask.title || b.untitledTask)); return;
    }
    // Block a located task left at the null island (0,0): a radius/exact task with
    // no real pin would route every team to the Gulf of Guinea and can never be
    // completed. The wizard's step-1 gate only blocks its own Next — a task closed
    // via ✕/Esc or reached by jumping tabs can still ship with (0,0) coordinates.
    const noPinTask = game.stages.flatMap((s) => s.tasks).find((tk) => !isTaskLocationValid(tk));
    if (noPinTask) {
      await dialog.alert(b.taskNeedsLocation(noPinTask.title || b.untitledTask)); return;
    }
    // Block an unwinnable stage: requiredTaskCount higher than the tasks teams can
    // actually complete (a stale count left after deleting tasks, or a broken
    // unlock graph). The Builder shows a soft warning, but nothing stops launch.
    const brokenStage = game.stages.find((s) => {
      const r = validateUnlockGraph(s);
      return r.warnings.length > 0 || r.errors.length > 0;
    });
    if (brokenStage) {
      await dialog.alert(b.stageUnwinnable(brokenStage.title || b.stageTitlePlaceholder)); return;
    }
    try {
      const { runId } = await launchRun({ gameId: game.id, testDrive });
      nav(`/run/${game.id}/${runId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : b.launchFailed;
      // Out of free runs + credits → offer to open the wallet. In free mode
      // launches never fail for billing, so just surface any other error.
      if (PAYMENTS_ENABLED && /credit|pro/i.test(msg) && await dialog.confirm(msg, b.goToWallet)) {
        nav('/wallet');
      } else if (!PAYMENTS_ENABLED || !/credit|pro/i.test(msg)) {
        await dialog.alert(msg);
      }
    }
  }

  if (error && !game) return (
    <Card className="p-8 text-center space-y-4">
      <div className="text-3xl">⚠️</div>
      <p className="font-semibold text-[--ink-1]">{b.cannotLoad}</p>
      <p className="text-sm text-[--ink-3]">{error}</p>
      <Button onClick={() => { setError(null); setLoadKey((k) => k + 1); }}>{b.tryAgain}</Button>
    </Card>
  );
  if (!game) return <Spinner label={b.loadingBuilder} />;

  return (
    // Fills the fixed-height main (App sets it for /build/*): header is fixed, the
    // body flexes to the remaining height. The page itself never scrolls.
    <div className="h-full flex flex-col rounded-2xl border border-[--rp-border] bg-[--surface-1]/60 overflow-hidden shadow-soft">
      {/* ── Persistent shell header bar: logo · back · title · save · tabs · launch.
          This is the only header in the Builder (the global app nav is hidden),
          so the workspace gets the full viewport height. ── */}
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-[--rp-border] bg-[--surface-1]">
        <button onClick={() => nav('/')} className="font-brand text-lg font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent tracking-tight shrink-0" title="RushPoint">
          RushPoint
        </button>
        <button onClick={() => nav('/')} className="flex items-center gap-1 text-xs text-[--ink-3] hover:text-[--ink-1] shrink-0 rounded-lg border border-[--rp-border] px-2 py-1 hover:bg-[--surface-2] transition-colors">
          <span className="text-sm leading-none">←</span> {b.backToGames}
        </button>
        <span className="text-[--ink-4] shrink-0">/</span>
        <EditableTitle title={game.title} onCommit={(t) => patch({ title: t })} />
        <span className="text-xs flex items-center gap-1.5 text-[--ink-3] shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${
            status === 'saving' ? 'bg-rp-amber animate-pulse'
              : status === 'unsaved' ? 'bg-rp-amber'
              : 'bg-rp-go'}`} />
          {status === 'saving' ? b.saving : status === 'unsaved' ? b.unsaved : b.saved}
        </span>

        {/* Undo / redo — also bound to Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={undo}
            disabled={!canUndo}
            title={`${b.undo} (Ctrl+Z)`} // i18n-ignore keyboard shortcut
            aria-label={b.undo}
            className="w-7 h-7 rounded-lg border border-[--rp-border] text-[--ink-3] flex items-center justify-center hover:bg-[--surface-2] hover:text-[--ink-1] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title={`${b.redo} (Ctrl+Shift+Z)`} // i18n-ignore keyboard shortcut
            aria-label={b.redo}
            className="w-7 h-7 rounded-lg border border-[--rp-border] text-[--ink-3] flex items-center justify-center hover:bg-[--surface-2] hover:text-[--ink-1] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            ↷
          </button>
        </div>

        {/* Centered tab strip */}
        <nav role="tablist" className="flex-1 flex items-center justify-center gap-1">
          {BUILDER_TAB_IDS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => { void save(); setTab(id); }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-rp-fire/10 text-rp-fire'
                  : 'text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2]'}`}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </nav>

        <Button variant="ghost" onClick={() => saveAndLaunch(true)} className="shrink-0" title={b.launchTestRunHint}>{b.launchTestRun}</Button>
        <Button onClick={() => saveAndLaunch(false)} className="shrink-0">{b.launchRun}</Button>
      </header>

      <div className="flex-1 min-h-0 p-2 overflow-hidden">
        {/* Build tab manages its own 3-pane overflow; the other tabs scroll
            inside their own pane so the page never gains a scrollbar. */}
        {tab === 'build' && <StepStages game={game} setGame={setGame} activeStageId={activeStageId} setActiveStageId={setActiveStageId} />}
        {tab === 'preview' && <div className="h-full overflow-y-auto"><StepPreview game={game} /></div>}
        {tab === 'settings' && <div className="h-full overflow-y-auto"><div className="max-w-2xl"><StepDetails game={game} patch={patch} /></div></div>}
        {tab === 'analytics' && (
          <Card className="p-10 text-center space-y-2">
            <div className="text-3xl">📊</div>
            <p className="font-semibold text-[--ink-1]">{b.analyticsTitle}</p>
            <p className="text-sm text-[--ink-3]">{b.analyticsBody}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Step 1: Details ──
function StepDetails({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [advReg, setAdvReg] = useState(false);
  const [advScore, setAdvScore] = useState(false);
  const modeLabel: Record<GameMode, string> = { individual: b.modeIndividual, team: b.modeTeam };
  return (
    <Card className="p-5 space-y-4">
      <div>
        <Label>{b.mode}</Label>
        <div className="flex gap-2">
          {(['individual', 'team'] as GameMode[]).map((m) => (
            <button key={m} onClick={() => patch({ mode: m })}
              className={`flex-1 py-2 rounded-lg text-sm border ${
                game.mode === m ? 'border-neon-green/50 bg-neon-green/10 text-neon-green' : 'border-glass-border text-zinc-400'}`}>
              {modeLabel[m]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>{b.shortDescription}</Label>
        <Input value={game.description ?? ''} onChange={(e) => patch({ description: e.target.value })} placeholder={b.shortDescriptionPlaceholder} dir="auto" />
      </div>
      <div>
        <Label>{b.tagsLabel}</Label>
        <Input value={game.tags.join(', ')} onChange={(e) => patch({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
          placeholder={b.tagsPlaceholder} dir="auto" />
      </div>

      <InstructionsField game={game} patch={patch} />

      <WebhookField game={game} patch={patch} />

      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={!!game.allowInstantPlay}
          onChange={(e) => patch({ allowInstantPlay: e.target.checked })} />
        {b.instantPlayLabel}
      </label>
      <p className="text-xs text-zinc-500 -mt-2">{b.instantPlayHelp}</p>

      {/* Live photo feed (change: live-photo-feed): default ON; absent = enabled. */}
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={game.photoFeedEnabled !== false}
          onChange={(e) => patch({ photoFeedEnabled: e.target.checked })} />
        {b.photoFeedLabel}
      </label>
      <p className="text-xs text-zinc-500 -mt-2">{b.photoFeedHint}</p>

      {/* Power-ups (change: power-ups): default OFF; absent = disabled. */}
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={!!game.powerUpsEnabled}
          onChange={(e) => patch({ powerUpsEnabled: e.target.checked })} />
        {b.powerUpsLabel}
      </label>
      <p className="text-xs text-zinc-500 -mt-2">{b.powerUpsHint}</p>

      {/* Staged leaderboard reveal (change: manual-leaderboard-reveal): default OFF
          (absent = auto publish on finalize, the pre-existing behaviour). When ON,
          finalizeRun leaves the board unpublished and the creator reveals it from
          the run console. */}
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={!!game.manualLeaderboardReveal}
          onChange={(e) => patch({ manualLeaderboardReveal: e.target.checked })} />
        {b.manualRevealLabel}
      </label>
      <p className="text-xs text-zinc-500 -mt-2">{b.manualRevealHint}</p>

      <Advanced title={b.advScoring} open={advScore} onToggle={() => setAdvScore(!advScore)}>
        <Label>{b.scoringPreset}</Label>
        <div className="space-y-2">
          {(Object.keys(PRESET_LABELS) as ScoringPreset[]).map((p) => (
            <button key={p} onClick={() => patch({ scoringPreset: p })}
              className={`w-full text-start p-3 rounded-lg border ${
                game.scoringPreset === p ? 'border-neon-green/50 bg-neon-green/10' : 'border-glass-border'}`}>
              <div className="text-sm font-medium text-zinc-200">{b.presetLabels[p].name}</div>
              <div className="text-xs text-zinc-500">{b.presetLabels[p].desc}</div>
            </button>
          ))}
        </div>
      </Advanced>

      <Advanced title={b.advRegistration} open={advReg} onToggle={() => setAdvReg(!advReg)}>
        <RegFields game={game} patch={patch} />
      </Advanced>
    </Card>
  );
}

// Game intro primer (change: game-intro-instructions): an optional collapsible
// "How to play" section (title + bilingual body + optional https image). Shown to
// players before the run starts and behind a "How to play" button in-game. Rides
// the existing updateGame wrapper; the server cleans/https-guards on save.
function InstructionsField({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [open, setOpen] = useState(false);
  const ins = game.instructions ?? {};
  function set(p: Partial<GameInstructions>) {
    patch({ instructions: { ...ins, ...p } });
  }
  return (
    <Advanced title={b.instructionsSectionTitle} open={open} onToggle={() => setOpen(!open)}>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">{b.instructionsHint}</p>
        <div>
          <Label>{b.instructionsTitleLabel}</Label>
          <Input value={ins.title ?? ''} onChange={(e) => set({ title: e.target.value })} dir="auto" />
        </div>
        <div>
          <Label>{b.instructionsBodyLabel}</Label>
          <Textarea rows={3} value={ins.body ?? ''} onChange={(e) => set({ body: e.target.value })} dir="auto" />
        </div>
        <div>
          <Label>{b.instructionsBodyHeLabel}</Label>
          <Textarea rows={3} value={ins.bodyHe ?? ''} onChange={(e) => set({ bodyHe: e.target.value })} dir="auto" />
        </div>
        <div>
          <Label>{b.instructionsImageLabel}</Label>
          <Input
            type="url"
            value={ins.imageUrl ?? ''}
            onChange={(e) => set({ imageUrl: e.target.value })}
            placeholder="https://…" // i18n-ignore — canonical sample https URL, not translatable copy
            dir="ltr"
          />
        </div>
      </div>
    </Advanced>
  );
}

// Chat integration (change: chat-integrations): an owner pastes a Slack/Teams
// incoming-webhook URL. Validated client-side (same shared allow-list the server
// enforces) on blur — only an empty or valid URL is committed, so autosave never
// POSTs an invalid URL the server would reject.
function WebhookField({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [val, setVal] = useState(game.integrationWebhookUrl ?? '');
  const [err, setErr] = useState('');
  // Keep the field in sync when the game loads async or an undo/redo restores a prior
  // value — otherwise the box would show a stale URL that no longer matches what saves.
  useEffect(() => { setVal(game.integrationWebhookUrl ?? ''); }, [game.integrationWebhookUrl]);
  function commit() {
    const raw = val.trim();
    if (raw === '') { setErr(''); patch({ integrationWebhookUrl: '' }); return; }
    if (!isAllowedWebhookUrl(raw)) { setErr(b.webhookInvalid); return; }
    setErr('');
    patch({ integrationWebhookUrl: raw });
  }
  return (
    <div>
      <Label>{b.webhookLabel}</Label>
      <Input
        type="url"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        placeholder="https://hooks.slack.com/services/…" // i18n-ignore — canonical sample webhook URL, not translatable copy
        dir="ltr"
      />
      {err
        ? <p className="text-neon-red text-xs mt-1">{err}</p>
        : <p className="text-xs text-zinc-500 mt-1">{b.webhookHelp}</p>}
    </div>
  );
}

// Narrative chapters (change: narrative-chapters): author an optional intro beat
// (shown when the chapter opens) and outro beat (shown when it closes) for a stage.
// Bilingual body (EN + HE) so the participant sees copy in their language.
function StageStory({ stage, onChange }: { stage: Stage; onChange: (n: Stage['narrative']) => void }) {
  const b = useT().builder;
  const [open, setOpen] = useState(false);
  const n = stage.narrative ?? {};
  function setIntro(p: Partial<NonNullable<Stage['narrative']>['intro']>) {
    onChange({ ...n, intro: { ...n.intro, ...p } });
  }
  function setOutro(p: Partial<NonNullable<Stage['narrative']>['outro']>) {
    onChange({ ...n, outro: { ...n.outro, ...p } });
  }
  // Compact inline editor (change: task-builder-ui). The five story fields used
  // to be a full-width stack of roomy textareas that swallowed the whole stage
  // column when opened; they now live in a dense two-column grid (one column on
  // narrow screens) with the long explanation demoted to the header tooltip, so
  // the task canvas keeps its room. Every field is still here.
  const filledCount = storyFieldCount(stage.narrative);
  return (
    <Advanced
      dense
      title={b.storyTitle}
      open={open}
      onToggle={() => setOpen(!open)}
      meta={filledCount > 0
        ? <span className="rounded-full bg-rp-fire/10 text-rp-fire px-1.5 py-px text-[10px]">{b.sectionSetCount(filledCount)}</span>
        : undefined}
    >
      <div className="space-y-2" title={b.storyHint}>
        <div>
          <Label dense>{b.storyIntroTitle}</Label>
          <Input dense value={n.intro?.title ?? ''} onChange={(e) => setIntro({ title: e.target.value })}
            placeholder={b.storyIntroTitlePlaceholder} dir="auto" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label dense>{b.storyIntroBodyEn}</Label>
            <Textarea dense rows={2} value={n.intro?.body ?? ''} onChange={(e) => setIntro({ body: e.target.value })} dir="auto" />
          </div>
          <div>
            <Label dense>{b.storyIntroBodyHe}</Label>
            <Textarea dense rows={2} value={n.intro?.bodyHe ?? ''} onChange={(e) => setIntro({ bodyHe: e.target.value })} dir="auto" />
          </div>
          <div>
            <Label dense>{b.storyOutroBodyEn}</Label>
            <Textarea dense rows={2} value={n.outro?.body ?? ''} onChange={(e) => setOutro({ body: e.target.value })} dir="auto" />
          </div>
          <div>
            <Label dense>{b.storyOutroBodyHe}</Label>
            <Textarea dense rows={2} value={n.outro?.bodyHe ?? ''} onChange={(e) => setOutro({ bodyHe: e.target.value })} dir="auto" />
          </div>
        </div>
      </div>
    </Advanced>
  );
}

function RegFields({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  function add() {
    const f: RegistrationField = { id: uuid(), label: b.newFieldLabel, type: 'text', required: false, level: 'member' };
    patch({ registrationFields: [...game.registrationFields, f] });
  }
  function update(id: string, p: Partial<RegistrationField>) {
    patch({ registrationFields: game.registrationFields.map((f) => (f.id === id ? { ...f, ...p } : f)) });
  }
  function remove(id: string) {
    patch({ registrationFields: game.registrationFields.filter((f) => f.id !== id) });
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">{b.regNameNote}</p>
      {game.registrationFields.map((f) => (
        <div key={f.id} className="flex gap-2 items-center">
          <Input value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} disabled={f.id === 'name'} />
          <Select value={f.type} onChange={(e) => update(f.id, { type: e.target.value as RegistrationField['type'] })}>
            <option value="text">{b.regTypeText}</option><option value="number">{b.regTypeNumber}</option>
            <option value="phone">{b.regTypePhone}</option><option value="checkbox">{b.regTypeCheckbox}</option><option value="select">{b.regTypeSelect}</option>
          </Select>
          <Select value={f.level} onChange={(e) => update(f.id, { level: e.target.value as RegistrationField['level'] })}>
            <option value="member">{b.regLevelMember}</option><option value="team">{b.regLevelTeam}</option>
          </Select>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            <input type="checkbox" checked={f.required} onChange={(e) => update(f.id, { required: e.target.checked })} />{b.regRequired}
          </label>
          {f.id !== 'name' && <button className="text-neon-red text-xs" onClick={() => remove(f.id)}>✕</button>}
        </div>
      ))}
      <Button variant="subtle" onClick={add}>+ {b.regAddField}</Button>
    </div>
  );
}

// ── Step 2: Stages & Tasks ──
function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 h-11 rounded-xl border border-dashed border-glass-border text-zinc-500
                 flex items-center justify-center gap-1.5 text-sm
                 hover:border-neon-green/60 hover:text-neon-green transition"
    >
      <span className="text-lg leading-none">＋</span>{label}
    </button>
  );
}

function StepStages({ game, setGame, activeStageId, setActiveStageId }: {
  game: Game; setGame: (g: Game) => void;
  activeStageId: string | null; setActiveStageId: (id: string) => void;
}) {
  const b = useT().builder;
  const [libraryFor, setLibraryFor] = useState<string | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [editing, setEditing] = useState<{ stageId: string; taskId: string } | null>(null);
  // Enforce the invariant the Builder UI implies — `isFinal` is only offered on
  // the LAST stage. The server treats ANY isFinal stage as the finale (finishing
  // the team on completion, runs/helpers.ts), so an isFinal flag left on a
  // non-last stage after an add/reorder/delete would end the run early and make
  // every later stage unreachable. Stripping it here (the single chokepoint all
  // stage mutations flow through) keeps the flag pinned to the last stage; the
  // real last stage still ends the run via the server's positional fallback.
  function setStages(next: Stage[]) {
    const last = next.length - 1;
    const stages = next.map((s, i) => (i !== last && s.isFinal ? { ...s, isFinal: undefined } : s));
    setGame({ ...game, stages });
  }
  // Native HTML5 drag reorder: move a stage then re-sequence `order`.
  function moveStage(from: number, to: number) {
    setStages(moveItem(game.stages, from, to).map((s, i) => ({ ...s, order: i })));
  }
  function addStage() {
    const s = blankStage(game.stages.length, b.stageDefaultTitle(game.stages.length + 1));
    setStages([...game.stages, s]);
    setActiveStageId(s.id);
  }
  function updateStage(id: string, p: Partial<Stage>) {
    setStages(game.stages.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }
  // ── Mutually exclusive task groups (wave-b task 5) ──
  // A group = task ids of this stage of which a team may complete at most ONE; the
  // rest lock (skip) once one is done. All the semantics (inert groups, first group
  // wins a contested id, the completion ceiling vs requiredTaskCount) live in the
  // pure @rushpoint/shared `mutualExclusion` module — the UI only edits the array.
  // Every write funnels through `normalizeGroups`, so the array that reaches the
  // server already obeys the rules `effectiveExclusiveGroups` reads it by (ids of
  // this stage only, deduped, first group wins a contested id, no empty groups).
  function setExclusiveGroups(stage: Stage, groups: { id: string; taskIds: string[] }[] | undefined) {
    updateStage(stage.id, { exclusiveGroups: normalizeGroups(groups, stage.tasks.map((t) => t.id)) });
  }
  function removeExclusiveGroup(stage: Stage, groupId: string) {
    setExclusiveGroups(stage, (stage.exclusiveGroups ?? []).filter((g) => g.id !== groupId));
  }
  /** Put one task in exactly one group (or none). `create` makes the group in the
   *  same update, so "new group + first member" is a single undo step. */
  function assignTaskGroup(stage: Stage, taskId: string, groupId: string | null, create = false) {
    const next = setTaskGroup(stage.exclusiveGroups, taskId, groupId, create);
    if (next === stage.exclusiveGroups) return;
    setExclusiveGroups(stage, next);
  }
  function removeStage(id: string) {
    const remaining = game.stages.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i }));
    setStages(remaining);
    if (activeStageId === id) setActiveStageId(remaining[0]?.id ?? '');
  }
  // The stage shown in the centre canvas (default to the first).
  const activeStage = game.stages.find((s) => s.id === activeStageId) ?? game.stages[0];
  function insertFromLibrary(stageId: string, task: Task) {
    const stage = game.stages.find((s) => s.id === stageId);
    if (!stage) return;
    // A blank, untouched first task is replaced rather than appended.
    const blankOnly = stage.tasks.length === 1 && !stage.tasks[0].title && stage.tasks[0].coordinates.lat === 0;
    updateStage(stageId, { tasks: blankOnly ? [task] : [...stage.tasks, task] });
  }
  // ── Task drag & drop (wave-a task 7) ──
  // Reorder inside one stage: pure `moveItem`, task count unchanged so
  // requiredTaskCount stays valid by construction.
  function reorderTasks(stageId: string, from: number, to: number) {
    const stage = game.stages.find((s) => s.id === stageId);
    if (!stage) return;
    const tasks = moveItem(stage.tasks, from, to);
    if (tasks === stage.tasks) return;
    updateStage(stageId, { tasks });
  }
  // Move a task to another stage (rail drop, or the card's non-drag fallback).
  // `moveTaskBetweenStages` re-clamps BOTH stages' requiredTaskCount — skipping
  // either side leaves an unwinnable stage (required > tasks). It also refuses to
  // empty the source stage and returns the same array reference on a no-op.
  // `moveTaskBetweenStages` also strips the task from the SOURCE stage's exclusive
  // groups — they are stage scoped, so a left-behind id is inert and would
  // silently shrink a real group to one member with no trace in the UI.
  function moveTaskToStage(fromStageId: string, taskId: string, toStageId: string, toIndex?: number) {
    const next = moveTaskBetweenStages(game.stages, fromStageId, taskId, toStageId, toIndex);
    if (next === game.stages) return;
    setStages(next);
    // The moved task lives in a different stage now; the open panel would point
    // at a stale (stageId, taskId) pair, so close it.
    if (editing?.taskId === taskId) setEditing(null);
  }

  // ── One DndContext for the whole Builder body (change: builder-dnd-groups) ──
  // A cross-container drag (canvas card → stage rail) needs the rail and the
  // canvas inside the SAME context, so the context lives here and both children
  // only declare items. State is committed ONLY in onDragEnd, never in onDragOver,
  // so one drag is exactly one `useHistory` undo step.
  const [activeDrag, setActiveDrag] = useState<{ type: 'task' | 'stage'; id: string } | null>(null);
  const sensors = useSensors(
    // A short press + movement tolerance: without it a tap on a card (which opens
    // the panel) and a scroll swipe on a tablet both register as drags.
    useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: arrowKeyCoordinates }),
  );
  const dragName = (id: string): string => {
    for (const s of game.stages) {
      if (s.id === id) return s.title || b.untitledStage;
      const t = s.tasks.find((x) => x.id === id);
      if (t) return t.title || b.untitledTask;
    }
    return id;
  };
  // dnd-kit's default announcements are English-only strings baked into the
  // library, so they are replaced wholesale — this is the whole justification for
  // the drag being a first-class (rather than the only) way to move a task.
  const screenReaderInstructions: ScreenReaderInstructions = { draggable: b.dndInstructions };
  const announcements: Announcements = {
    onDragStart: ({ active }) => b.dndPickedUp(dragName(String(active.id))),
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const overId = String(over.id);
      const name = dragName(String(active.id));
      return overId.startsWith(STAGE_DROP_PREFIX)
        ? b.dndOverStage(name, dragName(overId.slice(STAGE_DROP_PREFIX.length)))
        : b.dndOverTask(name, dragName(overId));
    },
    onDragEnd: ({ active }) => b.dndDropped(dragName(String(active.id))),
    onDragCancel: ({ active }) => b.dndCancelled(dragName(String(active.id))),
  };
  function onDragStart(e: DragStartEvent) {
    const type = e.active.data.current?.type;
    setActiveDrag(type === 'stage' || type === 'task' ? { type, id: String(e.active.id) } : null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over) return;
    const aData = active.data.current as { type?: string; stageId?: string } | undefined;
    const overId = String(over.id);

    // ── A stage was dragged onto another stage: reorder the rail. ──
    if (aData?.type === 'stage') {
      const from = game.stages.findIndex((s) => s.id === active.id);
      const to = game.stages.findIndex((s) => s.id === overId);
      if (from >= 0 && to >= 0 && from !== to) moveStage(from, to);
      return;
    }
    if (aData?.type !== 'task' || !aData.stageId) return;
    const taskId = String(active.id);

    // ── A task was dropped on a stage rail entry: append it to that stage. ──
    if (overId.startsWith(STAGE_DROP_PREFIX)) {
      const toStageId = overId.slice(STAGE_DROP_PREFIX.length);
      if (toStageId !== aData.stageId) moveTaskToStage(aData.stageId, taskId, toStageId);
      return;
    }
    // ── A task was dropped on another task. ──
    const overStage = game.stages.find((s) => s.tasks.some((t) => t.id === overId));
    if (!overStage) return;
    const toIndex = overStage.tasks.findIndex((t) => t.id === overId);
    if (overStage.id === aData.stageId) {
      const from = overStage.tasks.findIndex((t) => t.id === taskId);
      if (from >= 0 && from !== toIndex) reorderTasks(overStage.id, from, toIndex);
    } else {
      moveTaskToStage(aData.stageId, taskId, overStage.id, toIndex);
    }
  }
  const draggedTask = activeDrag?.type === 'task'
    ? game.stages.flatMap((s) => s.tasks).find((t) => t.id === activeDrag.id)
    : undefined;

  function addTask(stageId: string) {
    const stage = game.stages.find((s) => s.id === stageId);
    if (!stage) return;
    const t = blankTask();
    updateStage(stageId, { tasks: [...stage.tasks, t] });
    setEditing({ stageId, taskId: t.id });
  }

  const editingStage = editing && game.stages.find((s) => s.id === editing.stageId);
  const editingTask = editingStage?.tasks.find((t) => t.id === editing?.taskId);

  const m = activeStage ? activeStage.tasks.length : 0;
  const req = activeStage ? (activeStage.requiredTaskCount ?? m) : 0;
  const isLastStage = !!activeStage && game.stages[game.stages.length - 1]?.id === activeStage.id;
  // Scheduled-release: the first stage opens at run start, so timed release only
  // applies to later stages (a timed "drop" of a chapter mid-game / on day N).
  const isFirstStage = !!activeStage && game.stages[0]?.id === activeStage.id;

  // Group membership for the badges, derived from the SHARED `effectiveExclusiveGroups`
  // so a badge can never claim something the server would not enforce (a 1-member
  // group is inert there and therefore badge-less here).
  const activeEffectiveGroups = activeStage ? effectiveExclusiveGroups(activeStage) : [];
  const groupOf = (taskId: string): TaskGroupBadge | undefined => {
    const i = groupIndexOfTask(activeEffectiveGroups, taskId);
    if (i < 0) return undefined;
    return { index: i, letter: b.exclusiveGroupLetter(i), size: activeEffectiveGroups[i].length };
  };

  return (
    // Fills the shell body; each pane manages its own overflow so the task panel
    // gets the full height and never clips, and the page never scrolls.
    <DndContext
      sensors={sensors}
      // Type-aware (R1): the rail's two co-located droppables would otherwise
      // tie under plain closestCenter and silently no-op one of the gestures.
      collisionDetection={railAwareCollisionDetection}
      accessibility={{ announcements, screenReaderInstructions }}
      // Always-remeasure is what lets a droppable that MOUNTS mid-drag (a row the
      // virtualizer reveals while auto-scrolling) still be a valid target.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
    <div className="flex gap-3 h-full min-h-0">
      {/* ── Left rail: stage navigator (also the cross-stage drop target) ── */}
      <StageRail
        stages={game.stages}
        activeStageId={activeStage?.id ?? null}
        onSelect={setActiveStageId}
        onAdd={addStage}
        taskDragging={activeDrag?.type === 'task'}
      />

      {/* ── Centre canvas: the active stage. No wrapping Card — the shell already
          contains it; the task cards provide the structure. A flex column: the
          stage header is fixed, the task canvas flexes and owns the ONLY scroll
          (no more nested double-scrollbar), the add-tiles stay pinned below. ── */}
      <div className="flex-1 min-w-0 h-full flex flex-col gap-3 pe-1 pt-0.5">
        {activeStage && (
          <>
            <div className="shrink-0 space-y-3">
            <div className="flex items-center gap-2">
              <Input value={activeStage.title} onChange={(e) => updateStage(activeStage.id, { title: e.target.value })} className="flex-1" placeholder={b.stageTitlePlaceholder} dir="auto" />
              {isLastStage && (
                <label className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
                  <input type="checkbox" checked={!!activeStage.isFinal}
                    onChange={(e) => updateStage(activeStage.id, { isFinal: e.target.checked })} />{b.finalLabel}
                </label>
              )}
              {game.stages.length > 1 && (
                <button className="text-neon-red text-sm shrink-0" onClick={() => removeStage(activeStage.id)}>✕</button>
              )}
            </div>

            {/* Stage rules strip — the completion rule and the scheduled release
                folded into ONE compact, wrap-friendly row so the header stops
                eating three full-width lines of the shell (wave-a task 6).
                Logical spacing only (gap-x/gap-y/px/py) so it stays RTL-correct. */}
            {(m > 1 || !isFirstStage) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[--rp-border] bg-[--surface-2]/40 px-3 py-2 text-xs text-zinc-400">
                {/* Completion rule — only meaningful with a pool of tasks */}
                {m > 1 && (
                  <div className="flex items-center flex-wrap gap-1.5 min-w-0 text-start">
                    <span>{b.completionLead}</span>
                    <Select
                      className="w-auto py-1"
                      value={String(req)}
                      onChange={(e) => {
                        const n = parseInt(e.target.value);
                        updateStage(activeStage.id, { requiredTaskCount: n >= m ? undefined : n });
                      }}
                    >
                      {Array.from({ length: m }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </Select>
                    <span>{b.completionOf(m)}{req < m ? b.completionRouted : b.completionAll}</span>
                  </div>
                )}

                {m > 1 && !isFirstStage && (
                  <span aria-hidden className="h-4 w-px bg-[--rp-border]" />
                )}

                {/* Scheduled release — a timed drop of this stage (change:
                    scheduled-release). The long unit sentence is kept as the
                    tooltip; the row shows only the short unit. */}
                {!isFirstStage && (
                  <div className="flex items-center flex-wrap gap-1.5 min-w-0 text-start" title={b.releaseAfterUnit}>
                    <span>{b.releaseLead}</span>
                    <Input
                      type="number"
                      min={0}
                      className="w-16 py-1"
                      value={activeStage.releaseAfterMinutes ?? ''}
                      placeholder="0"
                      aria-label={b.releaseAfterUnit}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        updateStage(activeStage.id, {
                          releaseAfterMinutes: Number.isFinite(n) && n > 0 ? n : undefined,
                        });
                      }}
                    />
                    <span>{b.releaseUnitShort}</span>
                  </div>
                )}
              </div>
            )}

            {/* Mutually exclusive task groups — SUMMARY strip (change:
                builder-dnd-groups). One line whose height is constant in the
                number of TASKS (it only wraps with the number of groups, which is
                realistically 2 or 3), replacing the old chip table that drew one
                chip per task per group. Editing happens in the modal; the badges
                on the task cards are where the membership is actually read. */}
            {m > 1 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[--rp-border] bg-[--surface-2]/40 px-3 py-2 text-xs text-zinc-400 text-start">
                <span title={b.exclusiveHint}>{b.exclusiveLead}</span>
                {activeEffectiveGroups.map((members, gi) => {
                  const letter = b.exclusiveGroupLetter(gi);
                  const st = GROUP_STYLES[gi % GROUP_STYLES.length];
                  return (
                    <button
                      key={letter}
                      type="button"
                      aria-label={b.exclusiveChipAria(letter, members.length)}
                      title={b.exclusiveChipAria(letter, members.length)}
                      onClick={() => setGroupsOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[--rp-border] ps-1 pe-2 py-0.5 hover:text-zinc-200"
                    >
                      <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded border text-[10px] font-bold leading-none ${st.badge}`}>{letter}</span>
                      <span className="tabular-nums">{b.taskCount(members.length)}</span>
                    </button>
                  );
                })}
                {activeEffectiveGroups.length === 0 && <span className="text-[--ink-4]">{b.exclusiveNoGroups}</span>}
                <button
                  type="button"
                  className="ms-auto rounded-full border border-[--rp-border] px-2 py-0.5 hover:text-zinc-200"
                  onClick={() => setGroupsOpen(true)}
                >{b.exclusiveOpenEditor}</button>
              </div>
            )}

            {/* Exclusion ceiling vs requiredTaskCount: an explicit count above what
                the groups leave attainable ends the stage early (see
                docs/wave-b/mutually-exclusive-tasks.md §2.2). Non-blocking. */}
            {typeof activeStage.requiredTaskCount === 'number'
              && activeStage.requiredTaskCount > maxAttainableCompletions(activeStage) && (
              <p className="text-xs text-amber-400">⚠ {b.exclusiveUnwinnableWarn}</p>
            )}

            {/* Unlockable tasks (change: unlockable-tasks): warn when the required
                completion count exceeds the tasks that can actually complete. */}
            {validateUnlockGraph(activeStage).warnings.length > 0 && (
              <p className="text-xs text-amber-400">⚠ {b.unlockRequiredCountWarn}</p>
            )}

            {/* Partial-stage starvation (WO-6): a partial stage that mixes
                locationless + located tasks routes locationless first, so a
                physical station may never be visited. Non-blocking warning. */}
            {partialStageStarvationWarning(activeStage) && (
              <p className="text-xs text-amber-400">⚠ {b.partialStarvationWarn}</p>
            )}

            <StageStory stage={activeStage} onChange={(n) => updateStage(activeStage.id, { narrative: n })} />
            </div>

            <div className="flex-1 min-h-0">
              <TaskCanvas
                tasks={activeStage.tasks}
                activeTaskId={editing?.stageId === activeStage.id ? editing?.taskId : undefined}
                onSelect={(taskId) => setEditing({ stageId: activeStage.id, taskId })}
                stageId={activeStage.id}
                groupOf={groupOf}
                moveTargets={game.stages
                  .map((s, i) => ({ id: s.id, label: s.title || b.stageLabel(i + 1) }))
                  .filter((s) => s.id !== activeStage.id)}
                onMoveToStage={(taskId, toStageId) => moveTaskToStage(activeStage.id, taskId, toStageId)}
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <AddTile label={b.addTask} onClick={() => addTask(activeStage.id)} />
              <AddTile label={b.fromLibrary} onClick={() => setLibraryFor(activeStage.id)} />
            </div>
          </>
        )}
      </div>

      {libraryFor && (
        <TaskLibrary
          onInsert={(task) => insertFromLibrary(libraryFor, task)}
          onClose={() => setLibraryFor(null)}
        />
      )}

      {editing && editingStage && editingTask && (
        <ContextPanel
          key={editingTask.id}
          task={editingTask}
          gameId={game.id}
          siblings={editingStage.tasks}
          onFlush={(t) => updateStage(editingStage.id, { tasks: editingStage.tasks.map((x) => (x.id === t.id ? t : x)) })}
          onRemove={editingStage.tasks.length > 1
            ? () => {
                // Also strip the removed task's id from any sibling's prerequisite
                // gate (unlockable-tasks) — a dangling id would fail save-time
                // validation and wedge the autosave.
                const nextTasks = editingStage.tasks
                  .filter((x) => x.id !== editingTask.id)
                  .map((x) => {
                    if (!x.unlockAfterTaskIds?.includes(editingTask.id)) return x;
                    const rest = x.unlockAfterTaskIds.filter((id) => id !== editingTask.id);
                    return { ...x, unlockAfterTaskIds: rest.length > 0 ? rest : undefined };
                  });
                // Clamp a now-oversized requiredTaskCount: dropping a task below the
                // required count would leave the stage unwinnable (and the count
                // select would show a value not in its options). `undefined` = all.
                // Drop the removed id from any exclusive group too (wave-b task 5).
                // A dangling id is inert by contract, but leaving it would silently
                // shrink a group to one member (= no exclusivity) with no UI trace.
                const patch: Partial<Stage> = {
                  tasks: nextTasks,
                  requiredTaskCount: clampRequiredTaskCount(editingStage.requiredTaskCount, nextTasks.length),
                  ...(editingStage.exclusiveGroups
                    ? { exclusiveGroups: removeTaskFromGroups(editingStage.exclusiveGroups, editingTask.id) }
                    : {}),
                };
                updateStage(editingStage.id, patch);
                setEditing(null);
              }
            : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Grouping editor. One radio group per task ⇒ a task can be in at most one
          group by construction, and the whole editor is keyboard native with no
          drag involved (deliberate: grouping must never depend on a gesture). */}
      {groupsOpen && activeStage && (
        <ExclusiveGroupsModal
          stage={activeStage}
          onAssign={(taskId, groupId, create) => assignTaskGroup(activeStage, taskId, groupId, create)}
          onRemoveGroup={(groupId) => removeExclusiveGroup(activeStage, groupId)}
          onClose={() => setGroupsOpen(false)}
        />
      )}

      {/* The dragged card is rendered OUTSIDE the scroll container, so a windowed
          row that unmounts as the canvas auto-scrolls cannot kill the drag. */}
      <DragOverlay dropAnimation={null}>
        {draggedTask
          ? <div className="w-72 opacity-90 pointer-events-none"><TaskCard task={draggedTask} onClick={() => {}} group={groupOf(draggedTask.id)} /></div>
          : null}
      </DragOverlay>
    </div>
    </DndContext>
  );
}

// Slide-in context panel (Component 4, change: v2.1-builder-shell-redesign).
// Keeps a LOCAL draft (lib/taskDraft) as the input source so the panel's fields
// stay responsive, but flushes each edit to global state *immediately* so the
// canvas and the undo/redo buttons reflect it in real time. `useHistory` coalesces
// a typing burst into one undo step, and the server save stays debounced via its
// own effect — so live flushing here doesn't spam the backend.
// Hardware-accelerated transform slide-in.
function ContextPanel({ task, onFlush, onClose, onRemove, gameId, siblings }: {
  task: Task; onFlush: (t: Task) => void; onClose: () => void; onRemove?: () => void; gameId?: string;
  siblings?: Task[];
}) {
  const b = useT().builder;
  const [state, setState] = useState<DraftState>(() => initDraft(task));
  const [shown, setShown] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Slide in on mount.
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // Safety flush on unmount — normally a no-op since every edit flushes live, but
  // guards against any edit that hasn't reached global state yet (close or switch).
  useEffect(() => () => {
    if (isDirty(stateRef.current)) onFlush(stateRef.current.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(t: Task) {
    // Update the local draft (keeps inputs responsive) and push to global state
    // immediately so the canvas + undo/redo update live. commit() keeps the draft
    // and committed in sync so the unmount safety flush stays a no-op.
    setState((d) => commit(editDraft(d, t)));
    onFlush(t);
  }

  function close() { onClose(); }

  // Esc closes the panel (flush-on-unmount preserves the draft).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inline third pane: a width-clipping wrapper (no sibling reflow) holds a
  // fixed-width panel that slides in via transform. The centre canvas (flex-1
  // min-w-0) naturally yields the space, matching the redesign mockup.
  return (
    <aside
      // From lg up this is the inline third pane the redesign describes. Below lg
      // the three panes no longer fit side by side, so the editor becomes a
      // full-height sheet pinned to the inline end instead — a hard 500px pane
      // used to be pushed off the edge of a phone screen entirely, taking the
      // whole task editor with it (change: task-builder-ui). The `!` width wins
      // over the inline style, which only drives the lg open/close animation.
      className="shrink-0 self-stretch h-full overflow-hidden transition-[width] duration-200 ease-out
        max-lg:fixed max-lg:inset-y-0 max-lg:end-0 max-lg:z-40 max-lg:!w-[min(100vw,32rem)] max-lg:p-2 max-lg:shadow-soft"
      style={{ width: shown ? 'min(500px, calc(100vw - 1.5rem))' : 0 }}
    >
      {/* Full-height panel: it matches the fixed-height workspace row, so the
          wizard's footer + all content stay visible (never clipped). It is wide
          (460px) so the wizard has room to lay out without vertical scrolling. */}
      {/* No separate title bar — the close control lives in the wizard's tab row,
          reclaiming ~45px of chrome for the actual content. */}
      <div
        style={{ willChange: 'transform', width: 'min(500px, calc(100vw - 1.5rem))' }}
        className={`h-full flex flex-col rounded-xl border border-[--rp-border] bg-[--surface-1] overflow-hidden max-lg:!w-full
          transition-transform duration-200 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex-1 min-h-0 p-2.5">
          <TaskWizard task={state.draft} onChange={handleChange} onRemove={onRemove} onDone={close} onClose={close} closeLabel={b.closePanel} gameId={gameId} siblings={siblings} />
          {/* gameId flows Builder → ContextPanel → TaskWizard for the media upload path */}
        </div>
      </div>
    </aside>
  );
}

// ── Step 3: Preview ──
function StepPreview({ game }: { game: Game }) {
  const b = useT().builder;
  const taskCount = game.stages.reduce((s, st) => s + st.tasks.length, 0);
  const estMin = game.stages.flatMap((s) => s.tasks).reduce((s, t) => s + t.estimatedMinutes, 0);
  const modeLabel: Record<GameMode, string> = { individual: b.modeIndividual, team: b.modeTeam };
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-xl font-bold" dir="auto">{game.title || b.untitledGame}</h2>
        <p className="text-zinc-500 text-sm" dir="auto">{game.description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>{modeLabel[game.mode]}</Badge>
        <Badge color="green">{b.presetLabels[game.scoringPreset].name}</Badge>
        <Badge>{b.badgeStages(game.stages.length)}</Badge>
        <Badge>{b.badgeTasks(taskCount)}</Badge>
        <Badge>{b.badgeMinutes(estMin)}</Badge>
      </div>
      <ol className="space-y-2">
        {game.stages.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-neon-green/15 text-neon-green text-xs flex items-center justify-center">{i + 1}</span>
            <span className="text-sm text-zinc-200" dir="auto">{s.title}</span>
            <span className="text-xs text-zinc-500">
              {b.taskCount(s.tasks.length)}{s.tasks.length > 1 ? b.routedSuffix : ''}
              {s.isFinal ? ` · 🏁 ${b.finalTag}` : ''}
            </span>
          </li>
        ))}
      </ol>

      <div>
        <Label>{b.routePreview}</Label>
        <Suspense fallback={<MapSkeleton className="h-64" />}>
          <RoutePreviewMap stages={game.stages} className="h-64" />
        </Suspense>
      </div>

      <p className="text-xs text-zinc-500">{b.previewLaunchNote}</p>
    </Card>
  );
}
