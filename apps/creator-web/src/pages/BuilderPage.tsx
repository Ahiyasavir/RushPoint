import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Game, Stage, Task, ScoringPreset, RegistrationField, GameMode, GameInstructions, GameBranding,
} from '@rushpoint/shared';
import { PRESET_LABELS, WRONG_ANSWER_LEVEL_ORDER, PAYMENTS_ENABLED, isAllowedWebhookUrl, validateUnlockGraph, partialStageStarvationWarning, maxCompletableTasks, effectiveExclusiveGroups, exclusiveUnlockRisks } from '@rushpoint/shared';
// Safe-zone authoring (change: expose-enforced-settings) — the SAME validator the
// server applies, plus the pure derivation that seeds the boundary from the stops.
import { suggestSafeZone, validateSafeZone, SAFE_ZONE_MAX_RADIUS_M } from '@rushpoint/shared';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, MeasuringStrategy,
  useSensor, useSensors,
} from '@dnd-kit/core';
import type {
  Announcements, DragEndEvent, DragStartEvent, KeyboardCoordinateGetter, ScreenReaderInstructions,
} from '@dnd-kit/core';
import { getGame, updateGame, launchRun, exportGameFile, importGameFile } from '../services/calls';
// Creator-owned portability (change: game-file-export-import): the SAME pure
// parser the server runs, so the Builder can refuse a bad file instantly.
import { parseGameFile, gameFileFilename, type GameFile } from '@rushpoint/shared';
import { Advanced, Badge, Button, Card, EmptyState, Input, Label, Select, Spinner, TagChips, Textarea } from '../components/ui';
import { OverflowMenu } from '../components/OverflowMenu';
import { LaunchLiftoff } from '../components/LaunchLiftoff';
import { enabledGameFeatureCount } from '../lib/gameFeatureToggles';
import { dialog } from '../components/dialog';
import { useT } from '../components/LanguageContext';
// One mapping from a rejection to copy a creator can act on
// (change: creator-no-silent-failures).
import { describeCallFailure, type CallFailure } from '../lib/callFeedback';
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
import { blankTask } from '../lib/wizardLogic';
// ONE readiness computation, shared by the persistent panel and the launch guard
// (change: builder-first-task-flow), so the two can never drift.
import { computeGameReadiness, canLaunchGame, type ReadinessCode, type ReadinessIssue } from '../lib/gameReadiness';
import { storyFieldCount } from '../lib/wizardSections';
import { stageSettingsState, stageChips } from '../lib/stageSettings';
import type { StageSettingsState } from '../lib/stageSettings';
import { parseTagsInput } from '../lib/tags';
import { buildSavePayload } from '../lib/savePayload';
import { normalizeBrandColor, normalizeHttpsUrl, hasBrandingValue } from '../lib/gamePresentation';
import { PREVIEWED_STORAGE_KEY, readPreviewedGames, writePreviewedGames } from '../lib/creatorOnboarding';

// MapLibre is heavy (~500KB). The located-task map lives in lazy LocationStep
// (fetched only when a located task editor opens); the preview route map is split
// the same way here so it stays out of the main builder bundle.
const RoutePreviewMap = lazyWithRetry('routePreviewMap', () => import('../components/RoutePreviewMap'));

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
  // requiredTaskCount defaults to 1 (change: adaptive-difficulty-routing): a creator
  // who drops several tasks into one level almost always means "each team does ONE
  // of these" (a branching level routed per team), not "do them all". Undefined
  // still means "all tasks" for already-saved games — only NEW stages default to 1.
  // The "complete N of M" control (rendered once m > 1) is where it is raised.
  return { id: uuid(), order, title, tasks: [blankTask()], requiredTaskCount: 1 };
}

// The exact fields persisted by updateGame live in ../lib/savePayload, React-free, so
// a pure test can assert that every builder-editable field actually reaches the wire
// (change: surface-invisible-fields — the wrong-answer-cost selector patched local
// state and was never sent, because the literal that used to live here omitted
// `scoringOptions`). The dirty check stays defined in terms of that same payload, so
// the two can never drift apart.
const serializeGame = (g: Game) => JSON.stringify(buildSavePayload(g));

// 'unsaved' = a save is PENDING (the debounce has not fired yet). 'failed' = a
// save was attempted and rejected. Those two used to be the same value, which is
// how a lost evening looked exactly like a normal one-second pause
// (change: creator-no-silent-failures).
type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'failed';
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

// Records the dashboard checklist's one non-derivable step (design D2):
// previewing is a Builder tab, not a mutation, so it leaves no trace in
// Firestore. Local-only and best-effort — a blocked localStorage just means the
// step reads as not done.
function markGamePreviewed(gameId: string) {
  try {
    const prev = readPreviewedGames(localStorage.getItem(PREVIEWED_STORAGE_KEY));
    if (prev.includes(gameId)) return;
    localStorage.setItem(PREVIEWED_STORAGE_KEY, writePreviewedGames([...prev, gameId]));
  } catch { /* storage unavailable — the step simply stays unticked */ }
}

export default function BuilderPage() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const t = useT();
  const b = t.builder;
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
  // The readiness surface (change: builder-first-task-flow): a persistent list of
  // every launch blocker, openable without attempting a launch. `focusIssue`
  // carries an activated entry down to the build tab, which opens the offending
  // task with its message already visible.
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [focusIssue, setFocusIssue] = useState<{ stageId: string; taskId: string; nonce: number } | null>(null);
  // Launch is a save + a single opaque `launchRun` round-trip with no on-screen
  // feedback until now (change: creator-launch-liftoff). While it is in flight we
  // show the <LaunchLiftoff> overlay and disable the launch buttons.
  const [launching, setLaunching] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  // Why the last save failed. Persistent (never a toast): the whole failure mode
  // of this bug class is a creator who looks up ten minutes later.
  const [saveError, setSaveError] = useState<CallFailure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  // Refs let the debounced auto-save and the beforeunload guard read the latest
  // game/saved-snapshot without re-subscribing on every keystroke.
  const gameRef = useRef<Game | null>(null);
  const savedSnapshot = useRef<string>('');
  const saveTimer = useRef<number>();
  // Hidden file picker behind the Builder's "load a copy" action.
  const importInput = useRef<HTMLInputElement>(null);
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
      setSaveError(null);
      // If the user kept editing during the round-trip, stay 'unsaved'.
      const latest = gameRef.current;
      setStatus(latest && serializeGame(latest) !== snap ? 'unsaved' : 'saved');
      return true;
    } catch (e) {
      // This used to be `catch { setStatus('unsaved') }` — indistinguishable
      // from a save that simply had not fired yet. Say it failed, say why, and
      // keep saying it until a save succeeds.
      console.error('[builder] updateGame failed:', e);
      setSaveError(describeCallFailure(e, { online: navigator.onLine }));
      setStatus('failed');
      return false;
    }
  }, []);

  // Debounced auto-save: mark dirty immediately, persist after a short pause.
  useEffect(() => {
    if (!game) return;
    if (serializeGame(game) === savedSnapshot.current) return;
    // Editing on does NOT clear a failure: until a save actually succeeds the
    // work is still only in this tab. Downgrading 'failed' → 'unsaved' here
    // would quietly re-hide the very thing the creator needs to see.
    setStatus((s) => (s === 'failed' ? s : 'unsaved'));
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

  // ── Creator-owned portability (change: game-file-export-import) ──
  // A game the creator holds a file of is a game no infrastructure failure can
  // take away. Export saves the game after any pending edit so the file is never
  // one autosave behind what is on screen.
  async function exportToFile() {
    if (!game) return;
    window.clearTimeout(saveTimer.current);
    if (!(await save())) { await dialog.alert(b.saveFailed); return; }
    try {
      const { file } = await exportGameFile({ gameId: game.id });
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = gameFileFilename(game.title);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      await dialog.alert(e instanceof Error ? e.message : b.exportFailed);
    }
  }

  async function importFromFile(file: File) {
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      await dialog.alert(b.importNotAFile); return;
    }
    // Client-side pre-check with the SAME pure parser the server runs, so an
    // obviously bad file fails instantly with the real reason instead of a round trip.
    const pre = parseGameFile(doc);
    if (pre.errors.length > 0) { await dialog.alert(pre.errors.join(' · ')); return; }
    try {
      const { gameId } = await importGameFile({ file: doc as GameFile });
      nav(`/build/${gameId}`);
    } catch (e) {
      await dialog.alert(e instanceof Error ? e.message : b.importFailed);
    }
  }

  async function saveAndLaunch(testDrive = false) {
    if (!game) return;
    window.clearTimeout(saveTimer.current);
    // Show the liftoff overlay for the whole save+launch wait, and always clear it
    // in a `finally` so a save/readiness refusal or an error can never leave it
    // stuck open (change: creator-launch-liftoff). On success `nav(...)` unmounts
    // the Builder before the flag would matter.
    setLaunching(true);
    try {
      // Don't launch on top of a failed save — the run would use stale/unsaved data.
      if (!(await save())) { await dialog.alert(b.saveFailed); return; }
      // ONE launch rule (change: builder-first-task-flow). This used to be four
      // sequential guards, each naming a single offender in its own alert and
      // returning, so three broken tasks cost three failed launch attempts. The
      // rules now live in lib/gameReadiness, which also renders the persistent
      // readiness panel, so the guard and the panel cannot disagree. A refused
      // launch points at the panel instead of naming one offender.
      if (!canLaunchGame(game)) {
        setReadinessOpen(true);
        await dialog.alert(b.launchBlockedSeeReadiness); return;
      }
      try {
        const { runId } = await launchRun({ gameId: game.id, testDrive });
        nav(`/run/${game.id}/${runId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        // Out of free runs + credits → offer to open the wallet. In free mode
        // launches never fail for billing, so just surface any other error.
        if (PAYMENTS_ENABLED && /credit|pro/i.test(msg) && await dialog.confirm(msg, b.goToWallet)) {
          nav('/wallet');
        } else if (!PAYMENTS_ENABLED || !/credit|pro/i.test(msg)) {
          // Generic failure: the raw server string is English, so show the
          // localized copy and keep the raw error in the console.
          console.error('[RushPoint] launch failed:', e);
          await dialog.alert(b.launchFailed);
        }
      }
    } finally {
      setLaunching(false);
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
      <LaunchLiftoff
        open={launching}
        title={t.launch.title}
        messages={[t.launch.step1, t.launch.step2, t.launch.step3]}
      />
      {/* ── Persistent shell header bar: logo · back · title · save · tabs · launch.
          This is the only header in the Builder (the global app nav is hidden),
          so the workspace gets the full viewport height. ── */}
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-[--rp-border] bg-[--surface-1]">
        <button onClick={() => nav('/')} className="flex items-center gap-1 text-xs text-[--ink-3] hover:text-[--ink-1] shrink-0 rounded-lg border border-[--rp-border] px-2 py-1 hover:bg-[--surface-2] transition-colors">
          <span className="text-sm leading-none">←</span> {b.backToGames}
        </button>
        <EditableTitle title={game.title} onCommit={(t) => patch({ title: t })} />
        {/* A FAILED save gets its own colour and its own word — it can never be
            read as an ordinary pending save (change: creator-no-silent-failures). */}
        <span className={`text-xs flex items-center gap-1.5 shrink-0 ${status === 'failed' ? 'text-rp-alert font-semibold' : 'text-[--ink-3]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            status === 'failed' ? 'bg-rp-alert'
              : status === 'saving' ? 'bg-rp-amber animate-pulse'
              : status === 'unsaved' ? 'bg-rp-amber'
              : 'bg-rp-go'}`} />
          {status === 'failed' ? b.saveFailedShort
            : status === 'saving' ? b.saving
            : status === 'unsaved' ? b.unsaved
            : b.saved}
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

        {/* Creator-owned portability: save this game to a file you keep, or build
            a new game from one. Import always creates a NEW game. One clearly
            labelled "File" menu (change: builder-file-menu). The actions used to
            be two bare arrow glyphs whose meaning only a hover revealed. Same
            handlers, same hidden file input. */}
        <div className="shrink-0">
          <OverflowMenu
            label={b.fileMenu}
            ariaLabel={b.fileMenuAria}
            triggerClassName="min-h-[44px] px-3 rounded-lg text-sm gap-1"
          >
            <button
              role="menuitem"
              onClick={() => { void exportToFile(); }}
              title={b.exportFileHint}
              className="w-full justify-start text-start min-h-[44px] px-2.5 py-2 rounded-lg text-xs font-medium text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
            >
              {b.exportFile}
            </button>
            <button
              role="menuitem"
              onClick={() => importInput.current?.click()}
              title={b.importFileHint}
              className="w-full justify-start text-start min-h-[44px] px-2.5 py-2 rounded-lg text-xs font-medium text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
            >
              {b.importFile}
            </button>
          </OverflowMenu>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFromFile(f);
            }}
          />
        </div>

        {/* Centered tab strip */}
        <nav role="tablist" data-tour="builder-tabs" className="flex-1 flex items-center justify-center gap-1">
          {BUILDER_TAB_IDS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => { void save(); setTab(id); if (id === 'preview' && gameId) markGamePreviewed(gameId); }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-rp-fire/10 text-rp-fire'
                  : 'text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2]'}`}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </nav>

        {/* Readiness, beside the launch controls: everything that would refuse a
            launch, listed at once, before a launch is attempted. */}
        <ReadinessPanel
          game={game}
          open={readinessOpen}
          onToggle={() => setReadinessOpen((o) => !o)}
          onActivate={(issue) => {
            setReadinessOpen(false);
            if (!issue.stageId) return; // an empty game has nothing to navigate to
            setTab('build');
            setActiveStageId(issue.stageId);
            if (issue.taskId) setFocusIssue({ stageId: issue.stageId, taskId: issue.taskId, nonce: Date.now() });
          }}
        />

        <Button variant="ghost" loading={launching} onClick={() => saveAndLaunch(true)} className="shrink-0" title={b.launchTestRunHint}>{b.launchTestRun}</Button>
        <Button onClick={() => saveAndLaunch(false)} loading={launching} data-tour="builder-launch" className="shrink-0">{b.launchRun}</Button>
      </header>

      {/* ── Persistent failed-save banner ──────────────────────────────────
          Deliberately NOT a toast: a toast auto-dismisses in ~3 seconds, and
          the entire failure mode here is a creator who notices ten minutes
          later. It stays until a save succeeds. Retry is offered only when
          retrying could plausibly work — on a lost session it would just fail
          again and hide the real fix. */}
      {saveError && (
        <div
          role="status"
          className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rp-alert/40 bg-rp-alert/10 px-4 py-2 text-xs text-[--ink-1]"
        >
          <span className="font-semibold text-rp-alert">{b.saveFailedBanner}</span>
          <span className="text-[--ink-2] text-start">{t.callFailure[saveError.key]}</span>
          {saveError.retryable && (
            <Button
              variant="ghost"
              className="min-h-0 px-2.5 py-1 text-[11px] rounded-lg ms-auto"
              onClick={() => { void save(); }}
            >
              {b.saveFailedRetry}
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 p-2 overflow-hidden">
        {/* Build tab manages its own 3-pane overflow; the other tabs scroll
            inside their own pane so the page never gains a scrollbar. */}
        {tab === 'build' && <StepStages game={game} setGame={setGame} activeStageId={activeStageId} setActiveStageId={setActiveStageId} focusIssue={focusIssue} />}
        {tab === 'preview' && <div className="h-full overflow-y-auto"><StepPreview game={game} /></div>}
        {tab === 'settings' && <div className="h-full overflow-y-auto"><div className="max-w-2xl"><StepDetails game={game} patch={patch} /></div></div>}
        {tab === 'analytics' && (
          <Card className="p-10 text-center space-y-3">
            <div className="text-3xl">📊</div>
            <p className="font-semibold text-[--ink-1]">{b.analyticsTitle}</p>
            <p className="text-sm text-[--ink-3]">{b.analyticsBody}</p>
            <Button onClick={() => nav('/live')}>{b.analyticsOpenRuns}</Button>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Readiness surface (change: builder-first-task-flow) ──────────────────────
// The one place a creator learns why a launch would be refused. It lists EVERY
// blocking issue at once (`computeGameReadiness` is also the launch guard), it
// is reachable without attempting a launch, and each entry navigates to the
// thing to fix. An empty result is the ready-to-launch state.
function ReadinessPanel({ game, open, onToggle, onActivate }: {
  game: Game; open: boolean; onToggle: () => void; onActivate: (issue: ReadinessIssue) => void;
}) {
  const b = useT().builder;
  const issues = computeGameReadiness(game);
  const ISSUE_LABEL: Record<ReadinessCode, string> = {
    stageHasNoTask: b.issueStageHasNoTask,
    taskNotCompletable: b.issueTaskNotCompletable,
    taskNotPlaced: b.issueTaskNotPlaced,
    stageUnwinnable: b.issueStageUnwinnable,
  };
  const where = (issue: ReadinessIssue): string => {
    const stage = issue.stageTitle || b.untitledStage;
    return issue.taskId ? `${stage} · ${issue.taskTitle || b.untitledTask}` : stage;
  };
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={b.readinessAria(issues.length)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          issues.length === 0
            ? 'border-rp-go/40 text-rp-go hover:bg-[--surface-2]'
            : 'border-rp-amber/50 text-rp-amber hover:bg-[--surface-2]'}`}
      >
        <span aria-hidden>{issues.length === 0 ? '✓' : '⚠'}</span>
        <span className="hidden md:inline">{b.readinessTitle}</span>
        {issues.length > 0 && <Badge color="gold">{b.readinessCount(issues.length)}</Badge>}
      </button>

      {open && (
        <div className="absolute z-50 end-0 top-full mt-1 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-[--rp-border] bg-[--surface-1] shadow-soft">
          <Advanced dense title={b.readinessTitle} open onToggle={onToggle}>
            {issues.length === 0 ? (
              <EmptyState icon="🚀" title={b.readinessReadyTitle} body={b.readinessReadyBody} />
            ) : (
              <div className="space-y-1">
                <p className="text-[11px] text-[--ink-3] leading-snug">{b.readinessIntro}</p>
                <ul className="space-y-1 max-h-72 overflow-y-auto">
                  {issues.map((issue, i) => (
                    <li key={`${issue.code}-${issue.stageId}-${issue.taskId ?? ''}-${i}`}>
                      <button
                        type="button"
                        onClick={() => onActivate(issue)}
                        disabled={!issue.stageId}
                        className="w-full text-start rounded-lg border border-[--rp-border] px-2 py-1.5 hover:bg-[--surface-2] disabled:hover:bg-transparent disabled:opacity-70"
                      >
                        <span className="block text-[12px] text-[--ink-1]">{ISSUE_LABEL[issue.code]}</span>
                        {issue.stageId && (
                          <span dir="auto" className="block text-[11px] text-[--ink-3] truncate">{where(issue)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Advanced>
        </div>
      )}
    </div>
  );
}

// ── Step 1: Details ──
function StepDetails({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [advReg, setAdvReg] = useState(false);
  const [advScore, setAdvScore] = useState(false);
  const [advFeatures, setAdvFeatures] = useState(false);
  const modeLabel: Record<GameMode, string> = { individual: b.modeIndividual, team: b.modeTeam };
  return (
    <Card className="p-5 space-y-4">
      <div>
        <Label>{b.mode}</Label>
        <div className="flex gap-2">
          {(['individual', 'team'] as GameMode[]).map((m) => (
            <button key={m} onClick={() => patch({ mode: m })}
              className={`flex-1 py-2 rounded-lg text-sm border ${
                game.mode === m ? 'border-rp-fire/50 bg-rp-fire/10 text-rp-fire' : 'border-[--rp-border] text-[--ink-3]'}`}>
              {modeLabel[m]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>{b.shortDescription}</Label>
        <Input value={game.description ?? ''} onChange={(e) => patch({ description: e.target.value })} placeholder={b.shortDescriptionPlaceholder} dir="auto" />
      </div>
      <Advanced title={b.advScoring} open={advScore} onToggle={() => setAdvScore(!advScore)}>
        <Label>{b.scoringPreset}</Label>
        <div className="space-y-2">
          {(Object.keys(PRESET_LABELS) as ScoringPreset[]).map((p) => (
            <button key={p} onClick={() => patch({ scoringPreset: p })}
              className={`w-full text-start p-3 rounded-lg border ${
                game.scoringPreset === p ? 'border-rp-fire/50 bg-rp-fire/10' : 'border-[--rp-border]'}`}>
              <div className="text-sm font-medium text-[--ink-2]">{b.presetLabels[p].name}</div>
              <div className="text-xs text-[--ink-3]">{b.presetLabels[p].desc}</div>
            </button>
          ))}
        </div>

        {/* Wrong-answer cost (change: wrong-answer-cost). Absent = 'off', which is
            exactly how every game authored before this change behaves, so nothing
            in flight changes. New games are seeded at DEFAULT_WRONG_ANSWER_LEVEL. */}
        <Label>{b.wrongAnswerCost}</Label>
        <p className="text-xs text-zinc-500 -mt-2 mb-2">{b.wrongAnswerCostHint}</p>
        <div className="space-y-2">
          {WRONG_ANSWER_LEVEL_ORDER.map((lv) => {
            const current = game.scoringOptions?.wrongAnswerPenalty ?? 'off';
            return (
              <button key={lv}
                onClick={() => patch({ scoringOptions: { ...(game.scoringOptions ?? {}), wrongAnswerPenalty: lv } })}
                className={`w-full text-start p-3 rounded-lg border ${
                  current === lv ? 'border-rp-fire/50 bg-rp-fire/10' : 'border-[--rp-border]'}`}>
                <div className="text-sm font-medium text-[--ink-2]">{b.wrongAnswerLevels[lv].name}</div>
                <div className="text-xs text-[--ink-3]">{b.wrongAnswerLevels[lv].desc}</div>
              </button>
            );
          })}
        </div>
      </Advanced>

      <PresentationField game={game} patch={patch} />

      <InstructionsField game={game} patch={patch} />

      {/* Feature toggles grouped into one collapsed section (change: builder-settings-grouping).
          Presentation-only: each checkbox's checked/onChange is copied verbatim, so what
          saves and how it saves is byte-for-byte unchanged. The badge count honors the
          per-field defaults (photo feed defaults ON) via the pure enabledGameFeatureCount. */}
      <Advanced title={b.featuresSection} open={advFeatures} onToggle={() => setAdvFeatures(!advFeatures)}
        meta={<Badge>{b.featuresOnBadge(enabledGameFeatureCount(game))}</Badge>}>
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
        <p className="text-xs text-zinc-400 -mt-2">{b.photoFeedHint}</p>
        {/* UGC disclosure (change: feed-ugc-safety, D7): run-wide visibility + organizer responsibility. */}
        <p className="text-xs text-zinc-500 -mt-3">{b.photoFeedResponsibility}</p>

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
      </Advanced>

      <Advanced title={b.advRegistration} open={advReg} onToggle={() => setAdvReg(!advReg)}>
        <RegFields game={game} patch={patch} />
      </Advanced>

      <TagsField game={game} patch={patch} />

      <SafeZoneField game={game} patch={patch} />

      <WebhookField game={game} patch={patch} />
    </Card>
  );
}

// Game intro primer (change: game-intro-instructions): an optional collapsible
// Presentation (change: surface-invisible-fields): the cover image is the hero of the
// public game page and the brand name/colour drive the name and accent of five
// participant screens — all of it rendered, none of it authorable until now. The URL
// and the colour are normalized on commit by the same pure helpers the unit tests
// drive, so a half-typed value never reaches updateGame.
function PresentationField({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [open, setOpen] = useState(false);
  // The cover URL keeps the RAW typed string while the field has focus — normalizing
  // on every keystroke would delete the value the moment it stops parsing ("https:/").
  const [rawCover, setRawCover] = useState(game.coverImage ?? '');
  const brand = game.branding ?? {};
  const color = normalizeBrandColor(brand.primaryColor);

  // An emptied brand section must persist as undefined: the player screens resolve
  // `branding?.name ?? title`, so `{ name: '' }` would render an empty game name.
  function setBrand(p: Partial<GameBranding>) {
    const next = { ...brand, ...p };
    patch({ branding: hasBrandingValue(next) ? next : undefined });
  }

  return (
    <Advanced title={b.presentationSectionTitle} open={open} onToggle={() => setOpen(!open)}>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">{b.presentationHint}</p>
        <div>
          <Label>{b.coverImageLabel}</Label>
          <Input
            type="url"
            value={rawCover}
            onChange={(e) => setRawCover(e.target.value)}
            onBlur={() => {
              const clean = normalizeHttpsUrl(rawCover);
              setRawCover(clean ?? '');
              patch({ coverImage: clean });
            }}
            placeholder="https://…" // i18n-ignore — canonical sample https URL, not translatable copy
            dir="ltr"
          />
          <p className="text-xs text-zinc-500 mt-1">{b.coverImageHint}</p>
        </div>
        <div>
          <Label>{b.brandNameLabel}</Label>
          <Input
            value={brand.name ?? ''}
            onChange={(e) => setBrand({ name: e.target.value })}
            placeholder={game.title}
            dir="auto"
          />
          <p className="text-xs text-zinc-500 mt-1">{b.brandNameHint}</p>
        </div>
        <div>
          <Label>{b.brandColorLabel}</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color ?? '#ff5722'}
              onChange={(e) => setBrand({ primaryColor: normalizeBrandColor(e.target.value) })}
              className="h-9 w-14 rounded-lg border border-glass-border bg-transparent"
              aria-label={b.brandColorLabel}
            />
            {color && (
              <>
                <span className="text-xs text-zinc-400" dir="ltr">{color}</span>
                <button
                  type="button"
                  onClick={() => setBrand({ primaryColor: undefined })}
                  className="ms-auto text-xs text-zinc-400 underline"
                >
                  {b.brandColorClear}
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-1">{b.brandColorHint}</p>
        </div>
      </div>
    </Advanced>
  );
}

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
// The comma-separated tags input. The visible field keeps the RAW string the
// creator typed (so spaces and commas survive as they type "chutz, park"); the
// clean Game.tags array is derived via parseTagsInput on every change. Without
// this, binding value={tags.join(', ')} + split-on-change consumed the separator
// mid-typing and made the field unusable for more than one tag.
function TagsField({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [raw, setRaw] = useState(game.tags.join(', '));
  // Resync the raw string only when the persisted tags diverge from what the raw
  // string would produce — i.e. an async load or undo/redo, NOT the creator's own
  // keystrokes (which must keep their in-progress separators intact).
  useEffect(() => {
    const derived = parseTagsInput(raw);
    if (JSON.stringify(derived) !== JSON.stringify(game.tags)) setRaw(game.tags.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.tags]);
  return (
    <div>
      <Label>{b.tagsLabel}</Label>
      <Input
        value={raw}
        onChange={(e) => { setRaw(e.target.value); patch({ tags: parseTagsInput(e.target.value) }); }}
        placeholder={b.tagsPlaceholder}
        dir="auto"
      />
      {/* The comma rule was already stated in the label and the creator STILL
          reported that commas do nothing — the missing thing was feedback, not
          copy (change: game-task-tags). Typing a comma now visibly splits one
          chip into two. */}
      <TagChips tags={game.tags} className="mt-1.5" more={b.moreTags} max={20} />
      <p className="text-xs text-zinc-500 mt-1">{b.tagsHelp}</p>
    </div>
  );
}

function WebhookField({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [open, setOpen] = useState(false);
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
  const configured = (game.integrationWebhookUrl ?? '').trim() !== '';
  return (
    <Advanced
      title={b.webhookLabel}
      open={open}
      onToggle={() => setOpen(!open)}
      meta={configured
        ? <span className="rounded-full bg-rp-fire/10 text-rp-fire px-1.5 py-px text-[10px]">{b.sectionSetCount(1)}</span>
        : undefined}
    >
      <Input
        type="url"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        placeholder="https://hooks.slack.com/services/…" // i18n-ignore — canonical sample webhook URL, not translatable copy
        dir="ltr"
      />
      {err
        ? <p className="text-rp-alert text-xs mt-1">{err}</p>
        : <p className="text-xs text-[--ink-3] mt-1">{b.webhookHelp}</p>}
    </Advanced>
  );
}

// Safe-zone boundary (change: expose-enforced-settings). The server ENFORCED this
// field in two places — `updateLocation` flags a team outside it and routing stops
// assigning tasks — while nothing in either app could set it, so the whole chain was
// dead unless a creator hand-edited a game file. This is the missing author.
//
// The radius is the only number typed. The centre comes from `suggestSafeZone`, the
// pure derivation over the stops already placed, so the creator turns the boundary on
// rather than inventing coordinates. Clearing sends `null` (an explicit clear) and
// never `undefined`, which `updateGame` would read as "field not sent".
function SafeZoneField({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const b = useT().builder;
  const [open, setOpen] = useState(false);
  const zone = game.safeZone ?? null;
  const [radius, setRadius] = useState(String(zone?.radiusMeters ?? ''));
  const [err, setErr] = useState('');
  useEffect(() => { setRadius(String(game.safeZone?.radiusMeters ?? '')); }, [game.safeZone?.radiusMeters]);

  const suggestion = suggestSafeZone(game.stages);

  function enable() {
    if (!suggestion) return;
    setErr('');
    setRadius(String(suggestion.radiusMeters));
    patch({ safeZone: { center: suggestion.center, radiusMeters: suggestion.radiusMeters } });
  }

  function commitRadius() {
    if (!zone) return;
    const next = Number(radius);
    // The same rule the server applies, asked of the same validator, so the Builder
    // can never offer a boundary `updateGame` would refuse.
    const check = validateSafeZone({ center: zone.center, radiusMeters: next });
    if (!check.ok) {
      setErr(b.safeZoneRadiusInvalid(SAFE_ZONE_MAX_RADIUS_M));
      setRadius(String(zone.radiusMeters));
      return;
    }
    setErr('');
    patch({ safeZone: check.value });
  }

  return (
    <Advanced title={b.safeZoneSectionTitle} open={open} onToggle={() => setOpen(!open)}>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">{b.safeZoneHint}</p>
        {!zone ? (
          <>
            <Button variant="ghost" onClick={enable} disabled={!suggestion}>
              {b.safeZoneEnable}
            </Button>
            <p className="text-xs text-zinc-500">
              {suggestion ? b.safeZoneEnableHint : b.safeZoneNeedsTasks}
            </p>
          </>
        ) : (
          <>
            <div>
              <Label>{b.safeZoneRadiusLabel}</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={SAFE_ZONE_MAX_RADIUS_M}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                onBlur={commitRadius}
                dir="ltr"
              />
              {err
                ? <p className="text-neon-red text-xs mt-1">{err}</p>
                : <p className="text-xs text-zinc-500 mt-1">{b.safeZoneRadiusHint}</p>}
            </div>
            <p className="text-xs text-zinc-400" dir="ltr">
              {zone.center.lat.toFixed(5)}, {zone.center.lng.toFixed(5)}
            </p>
            {suggestion && suggestion.coversAllTasks === false && (
              <p className="text-xs text-amber-400">{b.safeZoneTooSpread}</p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={enable} disabled={!suggestion}>
                {b.safeZoneRecenter}
              </Button>
              <Button variant="subtle" onClick={() => { setErr(''); setRadius(''); patch({ safeZone: null }); }}>
                {b.safeZoneClear}
              </Button>
            </div>
          </>
        )}
      </div>
    </Advanced>
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
      <p className="text-xs text-[--ink-3]">{b.regNameNote}</p>
      {game.registrationFields.map((f) => (
        <div key={f.id} className="flex flex-wrap gap-2 items-center">
          <Input value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} disabled={f.id === 'name'} />
          <Select aria-label={b.regFieldTypeAria} value={f.type} onChange={(e) => update(f.id, { type: e.target.value as RegistrationField['type'] })}>
            <option value="text">{b.regTypeText}</option><option value="number">{b.regTypeNumber}</option>
            <option value="phone">{b.regTypePhone}</option><option value="checkbox">{b.regTypeCheckbox}</option><option value="select">{b.regTypeSelect}</option>
          </Select>
          <Select aria-label={b.regFieldLevelAria} value={f.level} onChange={(e) => update(f.id, { level: e.target.value as RegistrationField['level'] })}>
            <option value="member">{b.regLevelMember}</option><option value="team">{b.regLevelTeam}</option>
          </Select>
          <label className="flex items-center gap-1 text-xs text-[--ink-3]">
            <input type="checkbox" checked={f.required} onChange={(e) => update(f.id, { required: e.target.checked })} />{b.regRequired}
          </label>
          {f.id !== 'name' && <button className="text-rp-alert text-xs" aria-label={`${b.removeItem} ${f.label}`} onClick={() => remove(f.id)}>✕</button>}
        </div>
      ))}
      <Button variant="subtle" onClick={add}>+ {b.regAddField}</Button>
    </div>
  );
}

// ── Step 2: Stages & Tasks ──

// A calm, READ-ONLY at-rest status chip (change: wave-k stage-settings-sidepanel).
// It appears ONLY when a stage setting is non-default, so a default stage shows none
// of them. It advertises a folded setting so nothing is lost — it is NOT a button:
// the single door into the settings is the ⚙ pill (which opens the side panel), so
// the chips no longer duplicate that entry point ("two doors to one room").
function StatusChip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-[--rp-border] bg-[--surface-2]/40
        ps-2 pe-2.5 py-1 text-[11px] font-medium text-[--ink-2] tabular-nums"
    >
      {children}
    </span>
  );
}

// One labelled control inside the stage-settings drawer: a friendly icon + title
// over the actual control, generously spaced so the drawer reads as a short list
// of choices rather than a dense form.
function SettingRow({ icon, title, hint, children }: {
  icon: string; title: string; hint?: string; children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden className="text-base leading-6 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-xs font-semibold text-[--ink-2]" title={hint}>{title}</div>
        <div className="text-xs text-[--ink-3]">{children}</div>
      </div>
    </div>
  );
}

function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 h-11 rounded-xl border border-dashed border-[--rp-border] text-[--ink-3]
                 flex items-center justify-center gap-1.5 text-sm
                 hover:border-rp-fire/60 hover:text-rp-fire transition"
    >
      <span className="text-lg leading-none">＋</span>{label}
    </button>
  );
}

function StepStages({ game, setGame, activeStageId, setActiveStageId, focusIssue }: {
  game: Game; setGame: (g: Game) => void;
  activeStageId: string | null; setActiveStageId: (id: string) => void;
  // An activated readiness entry (change: builder-first-task-flow). The `nonce`
  // makes re-activating the SAME entry a new request.
  focusIssue?: { stageId: string; taskId: string; nonce: number } | null;
}) {
  const b = useT().builder;
  const [libraryFor, setLibraryFor] = useState<string | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  // The stage-settings drawer starts CLOSED (change: wave-k stage-editor-redesign)
  // so the stage reads calm at rest — just its name and task cards. It collapses
  // again whenever the creator switches stages, keeping every stage calm by default.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // `revealAll` is set only when the editor was opened from the readiness
  // surface, so the creator does not land on a silent form after clicking the
  // statement of the problem.
  const [editing, setEditing] = useState<{ stageId: string; taskId: string; revealAll?: boolean } | null>(null);
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
    // Touch devices: a longer press-and-hold starts a drag, so a plain finger
    // swipe scrolls the workspace instead of accidentally reordering. Without a
    // dedicated TouchSensor, drag-reorder is unreliable on a phone/tablet.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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
    setSettingsOpen(false);
    setEditing({ stageId, taskId: t.id });
  }

  const editingStage = editing && game.stages.find((s) => s.id === editing.stageId);
  const editingTask = editingStage?.tasks.find((t) => t.id === editing?.taskId);

  const m = activeStage ? activeStage.tasks.length : 0;
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

  // Which advanced settings apply / are non-default for the active stage — the
  // pure decision core that drives the calm-at-rest header (change: wave-k).
  const settings = activeStage ? stageSettingsState(activeStage, { isFirstStage }) : null;
  // Collapse the settings drawer whenever the shown stage changes, so every stage
  // opens calm regardless of the last stage's drawer state.
  useEffect(() => { setSettingsOpen(false); }, [activeStage?.id]);

  // Land on the offending task when a readiness entry is activated, with its
  // message already visible.
  useEffect(() => {
    if (!focusIssue) return;
    setSettingsOpen(false);
    setEditing({ stageId: focusIssue.stageId, taskId: focusIssue.taskId, revealAll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIssue?.nonce]);

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
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 h-full min-h-0">
      {/* ── Left rail: stage navigator (also the cross-stage drop target).
          On a phone it stacks on top as a horizontal, scrollable stage strip
          so the canvas below gets the full width. ── */}
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
      <div data-tour="builder-canvas" className="flex-1 min-w-0 min-h-0 sm:h-full flex flex-col gap-3 pe-1 pt-0.5">
        {activeStage && (
          <>
            <div className="shrink-0 space-y-2">
            {/* Title row — the calm centre of the stage at rest: just the name,
                the finale toggle on the last stage, and delete. */}
            <div className="flex items-center gap-2">
              <Input value={activeStage.title} onChange={(e) => updateStage(activeStage.id, { title: e.target.value })} className="flex-1" placeholder={b.stageTitlePlaceholder} dir="auto" />
              {isLastStage && (
                <label className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
                  <input type="checkbox" checked={!!activeStage.isFinal}
                    onChange={(e) => updateStage(activeStage.id, { isFinal: e.target.checked })} />{b.finalLabel}
                </label>
              )}
              {game.stages.length > 1 && (
                <button className="text-neon-red text-sm shrink-0" aria-label={b.exclusiveClose} onClick={() => removeStage(activeStage.id)}>✕</button>
              )}
            </div>

            {/* ── Settings bar (change: wave-k stage-editor-redesign) ──────────
                ONE thin row: a single "stage settings" affordance plus at-rest
                summary chips that appear ONLY for a non-default setting. A calm
                default stage shows just the settings toggle; a configured stage
                advertises what is set with a tappable chip, so a folded setting is
                never lost. The old three stacked setting boxes are gone from the
                surface — they live in the drawer below. */}
            {settings && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  // The single door into the settings: opening the side panel closes
                  // any open task editor so only one right-hand pane is ever mounted.
                  onClick={() => { setEditing(null); setSettingsOpen((o) => !o); }}
                  aria-expanded={settingsOpen}
                  aria-label={b.stageSettingsAria(settings.activeCount)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60
                    ${settingsOpen
                      ? 'border-rp-fire/50 bg-rp-fire/10 text-rp-fire'
                      : 'border-[--rp-border] bg-[--surface-2]/60 text-[--ink-2] hover:bg-[--surface-2] hover:text-[--ink-1]'}`}
                >
                  <span aria-hidden>⚙</span>
                  <span>{b.stageSettings}</span>
                  {settings.activeCount > 0 && (
                    <span aria-hidden className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-rp-fire text-white text-[10px] font-bold leading-none tabular-nums">{settings.activeCount}</span>
                  )}
                  <span aria-hidden className={`transition-transform duration-200 ${settingsOpen ? 'rotate-90' : ''}`}>›</span>
                </button>

                {/* Read-only status chips — one per non-default setting, derived by
                    the pure `stageChips`. They only advertise a folded setting; the
                    ⚙ pill above is the single way to open the settings to change it.
                    The completion chip reads in words ("3 מתוך 6 משימות") instead of
                    the old ambiguous 🎯 fraction. Exclusive groups also show their
                    colourblind-safe letter badge on each task card. */}
                {stageChips(settings).map((kind) => {
                  switch (kind) {
                    case 'completion':
                      return (
                        <StatusChip key={kind} title={b.completionChipAria(settings.requiredValue, m)}>
                          <span>{b.completionChipLabel(settings.requiredValue, m)}</span>
                        </StatusChip>
                      );
                    case 'release':
                      return (
                        <StatusChip key={kind} title={b.releaseChipAria(settings.releaseMinutes)}>
                          <span aria-hidden>⏰</span>
                          <span>{settings.releaseMinutes} {b.releaseUnitShort}</span>
                        </StatusChip>
                      );
                    case 'story':
                      return (
                        <StatusChip key={kind} title={b.storyTitle}>
                          <span aria-hidden>📖</span>
                          <span>{b.storyTitle}</span>
                        </StatusChip>
                      );
                    case 'groups':
                      return (
                        <StatusChip key={kind} title={b.exclusiveChipAria(b.exclusiveGroupLetter(0), settings.groupCount)}>
                          <span aria-hidden>🔀</span>
                          <span>{b.taskCount(settings.groupCount)}</span>
                        </StatusChip>
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            )}

            {/* The advanced controls now live in the StageSettingsPanel side pane
                (opened by the ⚙ pill), so they no longer sit on the calm surface. */}

            {/* Warnings stay ALWAYS visible — the unwinnable-stage guard must
                surface whether or not the panel is open (invariant). */}
            {/* Exclusion ceiling vs requiredTaskCount: an explicit count above what
                the groups leave attainable ends the stage early (see
                docs/wave-b/mutually-exclusive-tasks.md §2.2). Non-blocking. */}
            {typeof activeStage.requiredTaskCount === 'number'
              && activeStage.requiredTaskCount > maxCompletableTasks(activeStage) && (
              <p className="text-xs text-amber-400">⚠ {b.exclusiveUnwinnableWarn}</p>
            )}

            {/* Unlockable tasks (change: unlockable-tasks): warn when the required
                completion count exceeds the tasks that can actually complete. */}
            {validateUnlockGraph(activeStage).warnings.length > 0 && (
              <p className="text-xs text-amber-400">⚠ {b.unlockRequiredCountWarn}</p>
            )}

            {/* Unreachable branch (change: unreachable-task-strand): a task gated
                on a member of an exclusive group dies for every team that picks a
                different alternative. Advisory ONLY — the shape is legitimate
                branching content and the server now retires the dead branch, so
                this never blocks a save or a launch. */}
            {exclusiveUnlockRisks(activeStage).slice(0, 1).map((risk) => (
              <p key={risk.taskId} className="text-xs text-amber-400">
                ⚠ {b.exclusiveUnlockRiskWarn(
                  activeStage.tasks.find((t) => t.id === risk.taskId)?.title || risk.taskId,
                  activeStage.tasks.find((t) => t.id === risk.prerequisiteId)?.title || risk.prerequisiteId,
                )}
              </p>
            ))}

            {/* Partial-stage starvation (WO-6): a partial stage that mixes
                locationless + located tasks routes locationless first, so a
                physical station may never be visited. Non-blocking warning. */}
            {partialStageStarvationWarning(activeStage) && (
              <p className="text-xs text-amber-400">⚠ {b.partialStarvationWarn}</p>
            )}
            </div>

            <div className="flex-1 min-h-0">
              <TaskCanvas
                tasks={activeStage.tasks}
                activeTaskId={editing?.stageId === activeStage.id ? editing?.taskId : undefined}
                onSelect={(taskId) => { setSettingsOpen(false); setEditing({ stageId: activeStage.id, taskId }); }}
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

      {/* Stage settings as a slide-in side pane — the same shell as the task
          editor (change: wave-k stage-settings-sidepanel). It and the task editor
          are mutually exclusive (one right-hand pane), so opening it shrinks the
          centre canvas horizontally instead of pushing the task grid down. */}
      {settingsOpen && activeStage && settings && !editing && (
        <StageSettingsPanel
          key={activeStage.id}
          stage={activeStage}
          settings={settings}
          effectiveGroups={activeEffectiveGroups}
          onUpdateStage={(p) => updateStage(activeStage.id, p)}
          onOpenGroups={() => setGroupsOpen(true)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {editing && editingStage && editingTask && (
        <ContextPanel
          key={editingTask.id}
          task={editingTask}
          gameId={game.id}
          revealAll={editing.revealAll}
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
                const nextGroups = editingStage.exclusiveGroups
                  ? removeTaskFromGroups(editingStage.exclusiveGroups, editingTask.id)
                  : undefined;
                const patch: Partial<Stage> = {
                  tasks: nextTasks,
                  // Clamped against what the stage can YIELD, not its raw task count
                  // (change: stage-winnability) — and against the POST-delete groups.
                  requiredTaskCount: clampRequiredTaskCount(
                    editingStage.requiredTaskCount,
                    maxCompletableTasks({ tasks: nextTasks, exclusiveGroups: nextGroups }),
                  ),
                  ...(editingStage.exclusiveGroups ? { exclusiveGroups: nextGroups } : {}),
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
function ContextPanel({ task, onFlush, onClose, onRemove, gameId, siblings, revealAll }: {
  task: Task; onFlush: (t: Task) => void; onClose: () => void; onRemove?: () => void; gameId?: string;
  siblings?: Task[];
  // Opened from a readiness entry: show that task's validation messages at once.
  revealAll?: boolean;
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

  // Inline third pane, via the shared SlidePanel shell (change: wave-k
  // stage-settings-sidepanel) — the stage-settings pane reuses the exact same shell
  // so the two disclosures slide/size/collapse identically. The centre canvas
  // (flex-1 min-w-0) yields the space; no separate title bar here (the close control
  // lives in the wizard's tab row, reclaiming ~45px of chrome for the content).
  return (
    <SlidePanel shown={shown}>
      <div className="flex-1 min-h-0 p-2.5">
        <TaskWizard task={state.draft} onChange={handleChange} onRemove={onRemove} onDone={close} onClose={close} closeLabel={b.closePanel} gameId={gameId} siblings={siblings} revealAll={revealAll} />
        {/* gameId flows Builder → ContextPanel → TaskWizard for the media upload path */}
      </div>
    </SlidePanel>
  );
}

// Shared slide-in side-pane shell (change: wave-k stage-settings-sidepanel).
// Extracted from the task editor so the stage-settings pane presents identically:
// a width-clipping <aside> that grows from 0 (no sibling reflow, the centre canvas
// yields), holding a fixed-width panel that slides in via transform. From lg up it
// is an inline pane; below lg it becomes a full-height sheet pinned to the inline
// end (a hard 500px pane would otherwise be pushed off a phone screen). The caller
// owns `shown` so it can drive the mount slide-in. The `!` widths win over the
// inline style, which only drives the lg open/close animation.
function SlidePanel({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <aside
      className="shrink-0 self-stretch h-full overflow-hidden transition-[width] duration-200 ease-out
        max-lg:fixed max-lg:inset-y-0 max-lg:end-0 max-lg:z-40 max-lg:!w-[min(100vw,32rem)] max-lg:p-2 max-lg:shadow-soft"
      style={{ width: shown ? 'min(500px, calc(100vw - 1.5rem))' : 0 }}
    >
      <div
        style={{ willChange: 'transform', width: 'min(500px, calc(100vw - 1.5rem))' }}
        className={`h-full flex flex-col rounded-xl border border-[--rp-border] bg-[--surface-1] overflow-hidden max-lg:!w-full
          transition-transform duration-200 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {children}
      </div>
    </aside>
  );
}

// Stage settings, in the SAME slide-in shell as the task editor (change: wave-k
// stage-settings-sidepanel). Opened by the ⚙ pill; Esc closes it, mirroring the
// task editor. Holds every advanced control (completion count, timed release,
// exclusive groups entry, chapter story) — each offered only when it applies to
// this stage. Presentation only; all state still flows through `onUpdateStage`.
function StageSettingsPanel({ stage, settings, effectiveGroups, onUpdateStage, onOpenGroups, onClose }: {
  stage: Stage;
  settings: StageSettingsState;
  effectiveGroups: string[][];
  onUpdateStage: (p: Partial<Stage>) => void;
  onOpenGroups: () => void;
  onClose: () => void;
}) {
  const b = useT().builder;
  const m = stage.tasks.length;
  // What the stage can actually YIELD (change: stage-winnability). Exclusive groups
  // are alternatives, so three pairs yield three completions, never six — the
  // control must not offer a value the game can never satisfy.
  const ceiling = maxCompletableTasks(stage);
  const req = stage.requiredTaskCount ?? m;
  const [shown, setShown] = useState(false);

  // Slide in on mount (drives the shared shell's width + transform).
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // Esc closes the pane, matching the task editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <SlidePanel shown={shown}>
      <div className="flex-1 min-h-0 p-2.5 flex flex-col">
        {/* Header: ⚙ title + close ✕ — one compact row, like the wizard's tab row. */}
        <div className="flex items-center gap-1.5 pb-2 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span aria-hidden className="text-base leading-none">⚙</span>
            <span className="text-sm font-semibold text-[--ink-1] truncate">{b.stageSettings}</span>
          </div>
          <button onClick={onClose} aria-label={b.closePanel}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none">
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pe-0.5 space-y-3.5">
          <p className="text-xs text-[--ink-3]">{b.stageSettingsIntro}</p>

          {/* Task completion — how many of the pool a team must finish */}
          {settings.requiredApplies && (
            <SettingRow icon="☑️" title={b.settingCompletionTitle}>
              <div className="flex items-center flex-wrap gap-1.5 text-start">
                <span>{b.completionLead}</span>
                <Select
                  className="w-auto py-1"
                  value={String(req)}
                  aria-label={b.settingCompletionTitle}
                  onChange={(e) => {
                    const n = parseInt(e.target.value);
                    onUpdateStage({ requiredTaskCount: n >= ceiling ? undefined : n });
                  }}
                >
                  {Array.from({ length: ceiling }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  {/* A value saved BEFORE the cap existed stays visible rather than
                      the control silently jumping to a number nobody chose. It is
                      disabled, and the warning below offers the correction. */}
                  {req > ceiling && <option value={req} disabled>{req}</option>}
                </Select>
                <span>{b.completionOf(m)}{req < m ? b.completionRouted : b.completionAll}</span>
              </div>
              {/* Stage winnability (change: stage-winnability): say WHY the choices
                  stop below the task count, so the cap reads as a rule and not a bug. */}
              {ceiling < m && (
                <p className="mt-1 text-xs text-[--ink-3]">{b.completionCappedByGroups(ceiling, m)}</p>
              )}
              {req > ceiling && (
                <p className="mt-1 text-xs text-amber-400">
                  ⚠ {b.completionStoredUnreachable(req, ceiling)}{' '}
                  <button
                    type="button"
                    className="underline hover:text-[--ink-1]"
                    onClick={() => onUpdateStage({ requiredTaskCount: ceiling >= m ? undefined : ceiling })}
                  >{b.completionFixToCeiling(ceiling)}</button>
                </p>
              )}
            </SettingRow>
          )}

          {/* Timed release — when this later stage opens */}
          {settings.releaseApplies && (
            <SettingRow icon="⏰" title={b.settingReleaseTitle} hint={b.releaseAfterUnit}>
              <div className="flex items-center flex-wrap gap-1.5 text-start">
                <span>{b.releaseLead}</span>
                <Input
                  type="number"
                  min={0}
                  className="w-16 py-1"
                  value={stage.releaseAfterMinutes ?? ''}
                  placeholder="0"
                  aria-label={b.releaseAfterUnit}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    onUpdateStage({ releaseAfterMinutes: Number.isFinite(n) && n > 0 ? n : undefined });
                  }}
                />
                <span>{b.releaseUnitShort}</span>
              </div>
            </SettingRow>
          )}

          {/* Alternative tasks — the exclusive-group editor lives in its own focused
              modal; here we show the current groups and a clear way in. The task
              cards carry the colourblind-safe letter badges. */}
          {settings.groupsApply && (
            <SettingRow icon="🔀" title={b.settingGroupsTitle} hint={b.exclusiveHint}>
              <div className="flex flex-wrap items-center gap-2">
                {effectiveGroups.map((members, gi) => {
                  const letter = b.exclusiveGroupLetter(gi);
                  const st = GROUP_STYLES[gi % GROUP_STYLES.length];
                  return (
                    <span
                      key={letter}
                      title={b.exclusiveChipAria(letter, members.length)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[--rp-border] ps-1 pe-2 py-0.5"
                    >
                      <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded border text-[10px] font-bold leading-none ${st.badge}`}>{letter}</span>
                      <span className="tabular-nums">{b.taskCount(members.length)}</span>
                    </span>
                  );
                })}
                {effectiveGroups.length === 0 && <span className="text-[--ink-4]">{b.exclusiveNoGroups}</span>}
                <button
                  type="button"
                  className="rounded-full border border-rp-fire/40 bg-rp-fire/10 text-rp-fire px-2.5 py-0.5 hover:bg-rp-fire/15 transition-colors"
                  onClick={onOpenGroups}
                >{b.exclusiveOpenEditor}</button>
              </div>
            </SettingRow>
          )}

          {/* Chapter story — the existing sub-disclosure. */}
          <StageStory stage={stage} onChange={(n) => onUpdateStage({ narrative: n })} />
        </div>
      </div>
    </SlidePanel>
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
            <span className="w-6 h-6 rounded-full bg-rp-fire/15 text-rp-fire text-xs flex items-center justify-center">{i + 1}</span>
            <span className="text-sm text-[--ink-2]" dir="auto">{s.title}</span>
            <span className="text-xs text-[--ink-3]">
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
