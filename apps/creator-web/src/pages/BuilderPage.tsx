import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Game, Stage, Task, ScoringPreset, RegistrationField, GameMode, GameInstructions, GameBranding,
} from '@rushpoint/shared';
import { gameHasOperatorNotes, extractQuickSetupSteps } from '@rushpoint/shared';
import { PRESET_LABELS, WRONG_ANSWER_LEVEL_ORDER, PAYMENTS_ENABLED, isAllowedWebhookUrl, validateUnlockGraph, partialStageStarvationWarning, maxCompletableTasks, effectiveExclusiveGroups, exclusiveUnlockRisks, normalizeTags } from '@rushpoint/shared';
// Safe-zone authoring (change: expose-enforced-settings) — the SAME validator the
// server applies, plus the pure derivation that seeds the boundary from the stops.
import { suggestSafeZone, validateSafeZone, SAFE_ZONE_MAX_RADIUS_M } from '@rushpoint/shared';
import { resolvePlayOrigin, CANONICAL_PLAY_URL } from '@rushpoint/shared';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, MeasuringStrategy,
  useSensor, useSensors,
} from '@dnd-kit/core';
import type {
  Announcements, DragEndEvent, DragStartEvent, KeyboardCoordinateGetter, ScreenReaderInstructions,
} from '@dnd-kit/core';
import { getGame, updateGame, launchRun, exportGameFile, importGameFile, loadPopularTags } from '../services/calls';
// Creator-owned portability (change: game-file-export-import): the SAME pure
// parser the server runs, so the Builder can refuse a bad file instantly.
import { parseGameFile, gameFileFilename, type GameFile } from '@rushpoint/shared';
import { resolveWizardTarget, type TemplateWizardStep } from '@rushpoint/shared';
import { Advanced, Badge, Button, Card, EmptyState, Input, Label, Select, TagChips, Textarea } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { OverflowMenu } from '../components/OverflowMenu';
import { LaunchLiftoff } from '../components/LaunchLiftoff';
import { enabledGameFeatureCount } from '../lib/gameFeatureToggles';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import { useT } from '../components/LanguageContext';
import { useAuth } from '../components/AuthGate';
// First-open explainer (change: guided-new-game-wizard). Yields to Quick Setup and
// to the full tour, so in practice it reaches the creator who started from scratch
// — the one person the product guides nowhere else.
import BuilderSpotlight from '../components/BuilderSpotlight';
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
  QuickSetupBar, QuickSetupPill, QuickSetupBlocked, QuickSetupWelcome, QuickSetupIntro,
  QuickSetupCelebration, useQuickSetupFocus,
} from '../components/QuickSetup';
import {
  INITIAL_QUICK_SETUP_STATE, quickSetupReducer, quickSetupSteps, outstandingQuickSetupIds,
  quickSetupLaunchBlockers, currentQuickSetupStep, quickSetupIntroStep, quickSetupProgress,
  quickSetupFocusPlan, shouldAutoOpenQuickSetup, missionSummaryLine,
  quickSetupStorageKey, readQuickSetupRecord, writeQuickSetupRecord,
  type QuickSetupState, type QuickSetupAction, type TaskEditorTab, type TaskOptInGroup,
  type QuickSetupCopyKey,
} from '../lib/quickSetup';
import {
  moveItem, moveTaskBetweenStages, clampRequiredTaskCount,
  normalizeGroups, setTaskGroup, removeTaskFromGroups, groupIndexOfTask,
} from '../lib/reorder';
import { useHistory } from '../lib/useHistory';
import { initDraft, editDraft, isDirty, commit, type DraftState } from '../lib/taskDraft';
import { blankTask, shouldAutoOpenFirstTask } from '../lib/wizardLogic';
// ONE readiness computation, shared by the persistent panel and the launch guard
// (change: builder-first-task-flow), so the two can never drift.
import { computeGameReadiness, canLaunchGame, shouldAutoOpenReadiness, type ReadinessCode, type ReadinessIssue } from '../lib/gameReadiness';
import { storyFieldCount } from '../lib/wizardSections';
import { stageSettingsState, stageChips } from '../lib/stageSettings';
import type { StageSettingsState } from '../lib/stageSettings';
import { parseTagsInput } from '../lib/tags';
import { buildSavePayload } from '../lib/savePayload';
import { normalizeBrandColor, normalizeHttpsUrl, hasBrandingValue } from '../lib/gamePresentation';
import { PREVIEWED_STORAGE_KEY, readPreviewedGames, writePreviewedGames } from '../lib/creatorOnboarding';
// Builder header stage/mission breadcrumb (change: builder-clarity-mission-hierarchy).
import { builderBreadcrumbState } from '../lib/builderBreadcrumb';
// Responsive Builder header (change: builder-simplification-round-3): below the
// Tailwind `sm` boundary the header's secondary controls collapse into ONE
// OverflowMenu. Branching on the hook (rather than rendering both rows and hiding
// one with CSS) keeps a single menu instance, so the two copies cannot drift.
import { useIsMobile } from '../hooks/useMediaQuery';

// MapLibre is heavy (~500KB). The located-task map lives in lazy LocationStep
// (fetched only when a located task editor opens); the preview route map is split
// the same way here so it stays out of the main builder bundle.
const RoutePreviewMap = lazyWithRetry('routePreviewMap', () => import('../components/RoutePreviewMap'));

// One styling for every header menu item, so the File menu and the phone-width
// overflow menu can never drift apart (change: builder-simplification-round-3).
// Where the participant app lives, resolved exactly as the Dashboard/RunConsole
// resolve it (dev derives it from this origin; production reads VITE_PLAY_URL).
const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? CANONICAL_PLAY_URL);

const HEADER_MENU_ITEM_CLASS =
  'w-full justify-start text-start min-h-[44px] px-2.5 py-2 rounded-lg text-xs font-medium text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50';

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

// One time "you are going live" confirmation (change: creator-first-launch-confirm).
// A novice cannot tell the free Test run rehearsal from the real launch, so the
// FIRST real launch a creator ever runs asks once, gated by a per uid localStorage
// flag mirroring the guided tour's `rp-tour-seen`. After that first confirmed
// launch, launches proceed with no dialog so experienced creators are never nagged.
// The same key is shared with the Dashboard game card so confirming in either place
// counts. Fails safe: a blocked / throwing localStorage reads as "not yet confirmed"
// so the emotional check still shows once rather than being swallowed.
const FIRST_LAUNCH_CONFIRMED_PREFIX = 'rp-first-launch-confirmed';
function firstLaunchConfirmedKey(uid: string | null | undefined): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${FIRST_LAUNCH_CONFIRMED_PREFIX}:${clean || 'anon'}`;
}
function hasConfirmedFirstLaunch(uid: string | null | undefined): boolean {
  try { return localStorage.getItem(firstLaunchConfirmedKey(uid)) === '1'; }
  catch { return false; }
}
function markFirstLaunchConfirmed(uid: string | null | undefined): void {
  try { localStorage.setItem(firstLaunchConfirmedKey(uid), '1'); }
  catch { /* storage blocked: the confirm simply shows again next time */ }
}

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
      data-qs-field="game.title"
      className="text-lg font-bold text-[--ink-1] outline-none rounded px-1 -mx-1 border-b border-transparent focus:border-rp-fire min-w-[6ch] max-w-[12ch] sm:max-w-[14ch] lg:max-w-[18ch] xl:max-w-[26ch] 2xl:max-w-[34ch] whitespace-nowrap overflow-hidden text-ellipsis"
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
  const { user } = useAuth();
  const t = useT();
  const b = t.builder;
  const q = t.quickSetup;
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
  // "Your game is ready" nudge (change: creator-ready-nudge). When nothing blocks
  // the launch and the game has never been run, the green ready state is otherwise
  // buried in the collapsed readiness pill; this surfaces a one line, dismissible
  // banner near the launch controls so a first time creator knows they are done.
  const [readyNudgeDismissed, setReadyNudgeDismissed] = useState(false);
  // ── הקמה מהירה / Quick Setup (change: quick-setup-wizard) ──
  // A template's setup instructions, as pointers at the fields they are about. The
  // step list and everything derived from it live in lib/quickSetup; what is held
  // here is only the flow's own position, the one pending navigation, and the
  // launch refusal.
  const [qsState, setQsState] = useState<QuickSetupState>(INITIAL_QUICK_SETUP_STATE);
  const [qsLoadedFor, setQsLoadedFor] = useState<string | null>(null);
  const [quickSetupFocus, setQuickSetupFocus] = useState<
    { stageId: string; taskId: string; tab: TaskEditorTab | null; group: TaskOptInGroup | null; nonce: number } | null
  >(null);
  const [qsFocusAnchor, setQsFocusAnchor] = useState<{ anchor: string | null; nonce: number }>({ anchor: null, nonce: 0 });
  const [qsBlockers, setQsBlockers] = useState<TemplateWizardStep[]>([]);
  // The finish-line moment fires on the flow's OWN transition into `done`, never on
  // a load that happens to find an already-finished game — congratulating someone
  // for something they did last week is worse than saying nothing.
  const [qsCelebrating, setQsCelebrating] = useState(false);
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
  // Auto-open-first-task guard (change: builder-first-task-flow). Lives HERE, not
  // in StepStages, because StepStages unmounts on a tab switch — a per-mount ref
  // reset and re-opened the editor each time the creator returned to Build on a
  // still-blank task. Keyed on game id so a genuinely new game still auto-opens once.
  const autoOpenedGameRef = useRef<string | null>(null);
  const saveTimer = useRef<number>();
  // Monotonic id of the newest save started. A save only stamps `savedSnapshot`
  // (or the failure status) if it is still the latest in flight, so an
  // out-of-order resolution of a superseded save can't roll the dirty-check back
  // to a stale snapshot (data-safety: stale-snapshot stamp).
  const saveSeq = useRef(0);
  // Hidden file picker behind the Builder's "load a copy" action.
  const importInput = useRef<HTMLInputElement>(null);
  // Phone-class viewport ⇒ the header's secondary controls live in one menu.
  const isMobile = useIsMobile();
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
    const seq = ++saveSeq.current;
    setStatus('saving');
    try {
      await updateGame(buildSavePayload(g));
      // Ignore a superseded (out-of-order) resolution: a newer save has already
      // taken ownership of `savedSnapshot`, so stamping this older snap would
      // wrongly mark the game dirty (or persist a stale snapshot).
      if (seq === saveSeq.current) {
        savedSnapshot.current = snap;
        setSaveError(null);
        // If the user kept editing during the round-trip, stay 'unsaved'.
        const latest = gameRef.current;
        setStatus(latest && serializeGame(latest) !== snap ? 'unsaved' : 'saved');
      }
      return true;
    } catch (e) {
      // This used to be `catch { setStatus('unsaved') }` — indistinguishable
      // from a save that simply had not fired yet. Say it failed, say why, and
      // keep saying it until a save succeeds.
      console.error('[builder] updateGame failed:', e);
      if (seq === saveSeq.current) {
        const failure = describeCallFailure(e, { online: navigator.onLine });
        setSaveError(failure);
        setStatus('failed');
        // A validation rejection points at a specific stage/task. Open the
        // readiness panel so the creator sees WHICH one, instead of just a
        // generic "save failed" (no new copy — reuses the readiness surface).
        // The decision is one testable predicate rather than an inline condition
        // (change: builder-readiness-autoopen). It now fires only on a GENUINE
        // structural refusal: the save door no longer rejects an unfinished answer
        // key at all (change: builder-draft-save-tolerance), which is what used to
        // make this reopen on every autosave the moment a quiz was picked.
        if (failure.key === 'rejected' && shouldAutoOpenReadiness('saveRejected')) setReadinessOpen(true);
      }
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

  // `beforeunload` only fires on real browser unloads, NOT on SPA route changes,
  // so an in-app navigation (back button, browser back/forward) used to abandon
  // both a still-pending debounced edit AND a prior FAILED save. Flush any
  // pending debounced save when the Builder unmounts: save() is a no-op when the
  // game already matches what was last saved, so a clean game unmounts silently.
  // `save` is stable ([] deps), so this cleanup runs only on unmount.
  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
    const g = gameRef.current;
    if (g && serializeGame(g) !== savedSnapshot.current) void save();
  }, [save]);

  // In-app "back to games" guard: the back button is the Builder's main exit (the
  // global app nav is hidden here). Flush + persist before leaving; only if that
  // save fails do we surface it and let the creator decide, rather than silently
  // dropping the divergence the failure banner is warning about. A clean game
  // navigates straight through with no prompt.
  const leaveToGames = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const g = gameRef.current;
    const dirty = !!g && serializeGame(g) !== savedSnapshot.current;
    if (dirty && !(await save())) {
      if (!(await dialog.confirm(b.saveFailed))) return;
    }
    nav('/');
  }, [save, nav, b.saveFailed]);

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

  // Importing INSIDE the Builder loads the file over the game you have open — it
  // does not spawn a copy. A fresh-document import can never carry the admin
  // template metadata (the file format deliberately excludes it, so a hand-edited
  // file cannot forge a template), which is why importing a template's own file
  // used to hand back an ordinary game in "my games" and leave the template
  // untouched. Replacing in place keeps the document — and therefore its template
  // flag, its id, its join codes and its run history — exactly where it was.
  // The Dashboard's import still creates a new game; that is the "I have a file
  // and no game yet" door.
  /**
   * Lift the creator's own notes out of the player-facing text of a game that is
   * ALREADY here.
   *
   * The import door does this for every new file, but a game imported before that
   * existed is stranded: participants keep reading "[הערת מפעיל - למחוק]…" and no
   * screen ever mentions it. Same pure extraction, same single updateGame write,
   * and it CONFIRMS first because it rewrites authored prose.
   */
  async function cleanUpOperatorNotes() {
    if (!game) return;
    const result = extractQuickSetupSteps(game);
    if (result.wizardSteps.length === 0) { toast.info(q.extractNone); return; }
    const cleaned = result.stages.reduce((n, stage, i) => n + stage.tasks.filter(
      (task, j) => task.description !== game.stages[i]?.tasks[j]?.description
        || task.title !== game.stages[i]?.tasks[j]?.title,
    ).length, 0);
    if (!(await dialog.confirm(
      q.extractSummary({ steps: result.wizardSteps.length, cleaned }), q.cleanupCta,
    ))) return;
    // A pending autosave would otherwise land after this and write the notes back.
    window.clearTimeout(saveTimer.current);
    try {
      await updateGame({
        gameId: game.id,
        stages: result.stages,
        ...(result.instructions ? { instructions: result.instructions } : {}),
        wizardSteps: result.wizardSteps,
      });
      // Re-read for the same reason the file import does: the server normalizes
      // what it stored, and re-stamping savedSnapshot stops the fresh content
      // from reading as an unsaved edit and being written back over.
      setLoadKey((k) => k + 1);
      toast.success(q.extractDone(result.wizardSteps.length));
    } catch (e) {
      await dialog.alert(e instanceof Error ? e.message : q.extractFailed);
    }
  }

  async function importFromFile(file: File) {
    if (!game) return;
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
    // Overwriting authored work is a destructive action — ask, and name the game
    // being overwritten so the answer is about the right one.
    if (!(await dialog.confirm(b.importReplaceConfirm(game.title), b.importReplaceCta, true))) return;
    // Any pending autosave would land AFTER the import and write the old content
    // straight back over it.
    window.clearTimeout(saveTimer.current);
    try {
      await importGameFile({ file: doc as GameFile, targetGameId: game.id });
      // Re-read rather than patch local state: the server normalizes media,
      // strips display chars and fills defaults, so the document it stored is the
      // only trustworthy version of what was just imported. Bumping loadKey re-runs
      // the same getGame effect the page loads with, which also re-stamps
      // savedSnapshot — so the freshly imported content is not immediately seen as
      // an unsaved edit and written back over.
      setLoadKey((k) => k + 1);
      toast.success(b.importDone);
    } catch (e) {
      await dialog.alert(e instanceof Error ? e.message : b.importFailed);
    }
  }

  async function saveAndLaunch(testDrive = false) {
    if (!game) return;
    // A TEST DRIVE opens the participant app, not the organizer console
    // (change: test-drive-straight-to-play). "בדיקה" means "show me my game the
    // way a player sees it"; the console — a QR code and the live-ops panel — is
    // the thing you use to RUN an event, and landing there made the button
    // indistinguishable from a real launch. The Builder tab is left exactly where
    // it was so the creator can keep editing after looking.
    //
    // The tab is opened HERE, before any await, because a popup opened after an
    // async gap is blocked by Safari and Firefox. It is parked on about:blank and
    // pointed at the run once the code exists; every failure path below closes it
    // rather than leaving a blank tab behind.
    // NOT `noopener`: with that feature the browser returns null by design, and
    // we need the handle to point the tab at the run once the code exists. The
    // opener link is severed immediately after navigating instead.
    const playTab = testDrive ? window.open('about:blank', '_blank') : null;
    // True once the tab has been sent somewhere real. Every path that ends
    // WITHOUT handing off closes it, so a refused save/readiness check can't
    // strand the creator on a blank tab.
    let handedOff = false;
    // The one time "am I sure" gate before a creator's FIRST real launch ever
    // (change: creator-first-launch-confirm). Only the real launch is gated, never
    // Test run, and only when the game is actually launchable (a broken game gets
    // the readiness alert below instead, so the confirm never nags on top of it).
    // A cancel just aborts before any liftoff overlay shows.
    // Ask, but do NOT burn the one-time flag yet — a save/readiness/launch failure
    // below must leave the gate intact for the creator's next attempt. Marked only
    // after launchRun actually succeeds.
    const needFirstLaunchConfirm = !testDrive && canLaunchGame(game) && !hasConfirmedFirstLaunch(user?.uid);
    if (needFirstLaunchConfirm) {
      const ok = await dialog.confirm(b.firstLaunchConfirmBody, b.firstLaunchConfirmCta);
      if (!ok) return;
    }
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
        if (shouldAutoOpenReadiness('launchBlocked')) setReadinessOpen(true);
        await dialog.alert(b.launchBlockedSeeReadiness); return;
      }
      // הקמה מהירה (change: quick-setup-wizard). SECOND, deliberately: a structural
      // readiness blocker still reports first, so the two refusals never interleave
      // and the creator is never handed two different lists for one press. This one
      // catches what readiness structurally cannot — a template placeholder is a
      // perfectly VALID answer key, and a mission whose media was never replaced is
      // perfectly complete.
      const missing = quickSetupLaunchBlockers(game);
      if (missing.length > 0) { setQsBlockers(missing); return; }
      try {
        const { runId, accessCode } = await launchRun({ gameId: game.id, testDrive });
        // Launch succeeded — now it's safe to burn the one-time first-launch gate.
        if (needFirstLaunchConfirm) markFirstLaunchConfirmed(user?.uid);
        if (testDrive) {
          // `testdrive` asks play-web to join without the registration form. It is
          // a hint only — the server's run.isTestDrive is what actually authorizes
          // it (see lib/testDriveAutoJoin.ts).
          const url = `${PLAY_URL}/?code=${encodeURIComponent(accessCode)}&testdrive=1`;
          if (playTab) {
            playTab.location.replace(url);
            try { playTab.opener = null; } catch { /* cross-origin once navigated */ }
            handedOff = true;
          }
          // Popup blocked: send this tab instead, so the button still does what it
          // says rather than silently doing nothing.
          else { handedOff = true; window.location.assign(url); }
          return;
        }
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
      if (!handedOff) { try { playTab?.close(); } catch { /* already gone */ } }
      setLaunching(false);
    }
  }

  // Readiness, computed ONCE per game change (change: builder-readiness-autoopen).
  // It used to be recomputed twice per render — once for the ready nudge below and
  // again inside ReadinessPanel — walking every stage and task both times, which is
  // what made the blocker count visibly flicker while typing. The panel now receives
  // this array as a prop instead of re-deriving it, so the nudge and the panel are
  // literally the same value and cannot disagree mid-render.
  //
  // MUST stay above the early returns below: a hook after a conditional return runs
  // a different number of times between renders (React #300 — see CLAUDE.md).
  // `game` is null until the load resolves, so the null case yields no issues rather
  // than pretending an unloaded game is broken.
  const readiness = useMemo(() => (game ? computeGameReadiness(game) : []), [game]);

  // Quick Setup, all DERIVED from the live game on every change: what the pill
  // counts and what the launch guard refuses can therefore never disagree with what
  // the creator actually filled in, and no stored flag can outlive an emptied field.
  // A game IMPORTED before extraction ran on the import path still carries the
  // creator's own to-do notes inside the text PARTICIPANTS read, and nothing in
  // the product would ever have said so. Offer the same cleanup the import door
  // now performs — but only when there is something to clean AND no setup steps
  // exist yet, so a game that has already been through it is never nagged.
  const needsNoteCleanup = useMemo(
    () => (game?.wizardSteps ?? []).length === 0 && gameHasOperatorNotes(game),
    [game],
  );
  const [cleanupDismissed, setCleanupDismissed] = useState(false);
  const qsSteps = useMemo(() => quickSetupSteps(game), [game]);
  const qsOutstanding = useMemo(() => outstandingQuickSetupIds(game), [game]);
  const qsCtx = useMemo(() => ({ steps: qsSteps, outstanding: qsOutstanding }), [qsSteps, qsOutstanding]);
  // Mutually exclusive by status: the bar shows on `running`, the context card on
  // `intro`, so the two can never be on screen together.
  const qsStep = currentQuickSetupStep(qsState, qsSteps);
  const qsIntro = quickSetupIntroStep(qsState, qsSteps);
  // On a phone the mission editor is a fixed, near-full-width sheet — without this,
  // its own top edge sits directly under the floating הקמה מהירה bar/card, and a
  // creator had to close the mission editor just to read the instruction they were
  // supposed to be following inside it. Reserving space only while a bar/card is
  // actually up keeps every OTHER open of the editor exactly as tall as before.
  const qsOverlayActive = Boolean(qsStep) || Boolean(qsIntro);
  // Quick Setup FOCUS MODE (change: quick-setup-wizard). While any Quick Setup
  // surface is up — welcome, a chapter's intro card, or the running bar — the
  // canvas is a distraction, not help: the creator's whole job right now is one
  // field, and the stage rail plus the rest of the mission grid competed for
  // attention against it. `StepStages` hides the rail and scrims the canvas
  // behind these three statuses; `closed`/`done`/`idle` restore the ordinary view.
  const qsFocusMode = qsState.status === 'welcome' || qsState.status === 'intro' || qsState.status === 'running';

  // Restore this creator's postponements for THIS game. Per uid and per game, so
  // two accounts on one browser, or two games of one account, never share them.
  useEffect(() => {
    if (!game || qsLoadedFor === game.id) return;
    setQsLoadedFor(game.id);
    try {
      const rec = readQuickSetupRecord(localStorage.getItem(quickSetupStorageKey(user?.uid, game.id)));
      // AUTO-INVITE. A creator who just cloned a template does not know this flow
      // exists, and the fields it is about are exactly the ones a template cannot
      // fill for them — waiting to be discovered is waiting for a half-configured
      // launch. The invitation is an OVERLAY, never a jump: nothing on the canvas
      // moves until they say yes, and `shouldAutoOpenQuickSetup` offers it only
      // once (a stored record of any status is a decision we must not override).
      if (shouldAutoOpenQuickSetup({
        hasRecord: rec !== null,
        outstanding: outstandingQuickSetupIds(game).length,
        total: quickSetupSteps(game).length,
      })) {
        setQsState((prev) => quickSetupReducer(prev, { type: 'invite' }, {
          steps: quickSetupSteps(game), outstanding: outstandingQuickSetupIds(game),
        }));
        return;
      }
      setQsState(rec
        // Never restore INTO the running flow: a bar that reappears on load would
        // interrupt a creator who came back to do something else entirely.
        ? { status: rec.status === 'running' || rec.status === 'intro' || rec.status === 'welcome' ? 'closed' : rec.status, index: rec.index, deferred: rec.deferred }
        : INITIAL_QUICK_SETUP_STATE);
    } catch { setQsState(INITIAL_QUICK_SETUP_STATE); }
  }, [game?.id, qsLoadedFor, user?.uid]);

  // Persist. Best-effort: a blocked storage just means postponements are forgotten
  // between sessions, which is a smaller failure than a Builder that throws.
  useEffect(() => {
    if (!game || qsLoadedFor !== game.id) return;
    try {
      localStorage.setItem(quickSetupStorageKey(user?.uid, game.id), writeQuickSetupRecord(qsState));
    } catch { /* storage unavailable */ }
  }, [qsState, game?.id, qsLoadedFor, user?.uid]);

  // The scroll + focus + ring, against the `data-qs-field` anchors. It retries for a
  // few frames, which is what lets it wait for the drawer's slide-in and the editor's
  // tab switch without either of those having to call back.
  useQuickSetupFocus(qsFocusAnchor.anchor, qsFocusAnchor.nonce);

  /**
   * Take the creator to a step's field.
   *
   * Every hop is decided by data (lib/quickSetup's table), never by a branch per
   * field: which tab of the console, which stage, which mission, which editor tab,
   * which collapsed group, which control. A step whose field the Builder has no
   * anchor for still lands them on the right mission with the instruction on screen
   * — it degrades, it does not fail.
   */
  const goToQuickSetupStep = useCallback((step: TemplateWizardStep) => {
    if (!game) return;
    const target = resolveWizardTarget(game, step);
    if (!target) return;
    const plan = quickSetupFocusPlan(target);
    const nonce = Date.now();
    if (target.scope === 'game') {
      // The game primer lives on the Settings tab; the title is in the shell header,
      // which is on screen whatever tab is open.
      setTab(plan.anchor === 'game.instructions' ? 'settings' : 'build');
      setQuickSetupFocus(null);
    } else {
      setTab('build');
      setActiveStageId(target.stageId);
      setQuickSetupFocus({
        stageId: target.stageId, taskId: target.taskId,
        tab: plan.wizardStep, group: plan.optInGroup, nonce,
      });
    }
    setQsFocusAnchor({ anchor: plan.anchor, nonce });
  }, [game]);

  // Navigate whenever the ACTIVE step changes — including when the flow re-enters a
  // postponed step, so "come back to this later" really does come back to it.
  //
  // Gated on `running` alone, which is what makes the flow context-first: while the
  // welcome or a chapter's intro card is up, NOTHING on the canvas moves. The
  // creator reads where they are about to be taken, and the drawer, the tab switch
  // and the scroll all happen after they say go.
  useEffect(() => {
    if (!qsStep) return;
    goToQuickSetupStep(qsStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qsStep?.id, qsState.status]);

  // The finish line. Fires on the TRANSITION into `done`, so a creator who reopens
  // a finished game is not congratulated again for work they did last week.
  const qsWasDone = useRef(qsState.status === 'done');
  useEffect(() => {
    const done = qsState.status === 'done';
    if (done && !qsWasDone.current) setQsCelebrating(true);
    qsWasDone.current = done;
  }, [qsState.status]);

  const dispatchQs = useCallback((action: QuickSetupAction) => {
    setQsState((prev) => quickSetupReducer(prev, action, qsCtx));
  }, [qsCtx]);

  /**
   * What the flow needs to SAY about a step: which copy slot to speak from, and —
   * for the context card — which mission it is, in the creator's own words.
   *
   * Derived rather than stored, exactly like everything else here, so renaming a
   * mission changes what the card says on the very next render.
   */
  const quickSetupPresentation = useCallback((step: TemplateWizardStep | null): {
    copyKey: QuickSetupCopyKey;
    taskTitle: string | null;
    summary: string;
    scope: 'game' | 'stage' | 'task';
  } => {
    if (!game || !step) return { copyKey: 'fallback', taskTitle: null, summary: '', scope: 'game' };
    const target = resolveWizardTarget(game, step);
    if (!target) return { copyKey: 'fallback', taskTitle: null, summary: '', scope: 'game' };
    const { copy } = quickSetupFocusPlan(target);
    if (target.scope !== 'task') return { copyKey: copy, taskTitle: null, summary: '', scope: target.scope };
    const task = game.stages.find((s) => s.id === target.stageId)?.tasks.find((x) => x.id === target.taskId);
    return {
      copyKey: copy,
      taskTitle: task?.title?.trim() || b.untitledTask,
      summary: missionSummaryLine(task?.description),
      scope: 'task',
    };
  }, [game, b]);

  /** Where a step lives, for the launch modal's rows. Never a raw id. */
  const quickSetupLabel = useCallback((step: TemplateWizardStep): string => {
    if (!game) return '';
    const target = resolveWizardTarget(game, step);
    if (!target || target.scope === 'game') return t.quickSetup.inGame;
    const stage = game.stages.find((s) => s.id === target.stageId);
    const task = stage?.tasks.find((x) => x.id === target.taskId);
    const parts = [stage ? t.quickSetup.inStage(stage.title || b.untitledStage) : '',
      task ? t.quickSetup.inTask(task.title || b.untitledTask) : ''];
    return parts.filter(Boolean).join(' · ');
  }, [game, t, b]);

  if (error && !game) return (
    <Card className="p-8 text-center space-y-4">
      <div className="text-3xl">⚠️</div>
      <p className="font-semibold text-[--ink-1]">{b.cannotLoad}</p>
      <p className="text-sm text-[--ink-3]">{error}</p>
      <Button onClick={() => { setError(null); setLoadKey((k) => k + 1); }}>{b.tryAgain}</Button>
    </Card>
  );
  if (!game) return <LoadingState messages={b.loadingGame} />;

  // Hide the Analytics tab until the game has actually been run: pre-launch it can
  // only render an empty "no analytics yet" message, which reads as broken to a
  // first-time creator. Once playCount > 0 the tab returns exactly as before.
  const hasBeenRun = (game.playCount ?? 0) > 0;
  const visibleTabIds = BUILDER_TAB_IDS.filter((id) => id !== 'analytics' || hasBeenRun);
  // Guard the active-tab-hidden edge: if the current tab is no longer in the
  // visible list (e.g. analytics was selected then hidden), fall back to 'build'.
  const activeTab: BuilderTab = visibleTabIds.includes(tab) ? tab : 'build';

  return (
    // Fills the fixed-height main (App sets it for /build/*): header is fixed, the
    // body flexes to the remaining height. The page itself never scrolls.
    <div className="h-full flex flex-col rounded-2xl border border-[--rp-border] bg-[--surface-1]/60 overflow-hidden shadow-soft">
      <LaunchLiftoff
        open={launching}
        title={t.launch.title}
        messages={[t.launch.step1, t.launch.step2, t.launch.step3]}
      />
      {/* First-open explainer (change: guided-new-game-wizard). Mounted BEFORE the
          Quick Setup surfaces below and handed their live status, because it must
          yield to them: a templated game auto-invites Quick Setup on this same
          mount, and stacking two guided overlays is worse than showing neither. In
          practice that makes this the SCRATCH creator's explainer. */}
      <BuilderSpotlight quickSetupActive={qsFocusMode || qsState.status === 'welcome'} />
      {/* הקמה מהירה: the floating step bar and the launch refusal
          (change: quick-setup-wizard). Both are fixed-position, so they stay legible
          over the mission drawer — which is exactly where the creator is while they
          follow a step. */}
      {/* The one-time invitation. Offered on a freshly cloned template rather than
          waiting to be discovered — and it moves nothing on the canvas until the
          creator accepts, so declining costs exactly one click. */}
      {qsState.status === 'welcome' && (
        <QuickSetupWelcome
          remaining={qsOutstanding.length}
          onBegin={() => dispatchQs({ type: 'begin' })}
          onSkip={() => dispatchQs({ type: 'close' })}
        />
      )}
      {/* Context before controls: the card naming the mission we are about to set
          up. Only when the flow CROSSES into a new mission — two fields of the same
          one run straight on, because the creator is already looking at it. */}
      {qsIntro && (
        <QuickSetupIntro
          step={qsIntro}
          index={quickSetupProgress(qsState, qsSteps).step - 1}
          total={qsSteps.length}
          taskTitle={quickSetupPresentation(qsIntro).taskTitle}
          summary={quickSetupPresentation(qsIntro).summary}
          scope={quickSetupPresentation(qsIntro).scope}
          onBegin={() => dispatchQs({ type: 'begin' })}
          onDefer={() => dispatchQs({ type: 'defer' })}
          onClose={() => dispatchQs({ type: 'close' })}
        />
      )}
      {qsStep && (
        <QuickSetupBar
          step={qsStep}
          index={quickSetupProgress(qsState, qsSteps).step - 1}
          total={qsSteps.length}
          copyKey={quickSetupPresentation(qsStep).copyKey}
          onNext={() => dispatchQs({ type: 'next' })}
          onDefer={() => dispatchQs({ type: 'defer' })}
          onClose={() => dispatchQs({ type: 'close' })}
        />
      )}
      {qsCelebrating && <QuickSetupCelebration onClose={() => setQsCelebrating(false)} />}
      <QuickSetupBlocked
        blockers={qsBlockers}
        labelFor={quickSetupLabel}
        onClose={() => setQsBlockers([])}
        onGo={(step) => {
          setQsBlockers([]);
          const idx = qsSteps.findIndex((x) => x.id === step.id);
          // Enter the FLOW at that step rather than merely scrolling to it, so the
          // instruction travels with the creator and "next" keeps working from there.
          if (idx >= 0) dispatchQs({ type: 'jump', index: idx });
          else goToQuickSetupStep(step);
        }}
      />
      {/* ── Persistent shell header bar: logo · back · title · save · tabs · launch.
          This is the only header in the Builder (the global app nav is hidden),
          so the workspace gets the full viewport height. ── */}
      {/* Below `sm` the bar wraps: the controls stay on the first line and the tab
          strip drops to its own full-width line (`order-last basis-full`) instead
          of being squeezed to zero. At `sm` and up every class below restores
          today's exact single-row geometry. */}
      <header className="shrink-0 flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 px-2 py-1.5 sm:gap-x-3 sm:px-4 sm:py-0 min-h-14 sm:h-14 border-b border-[--rp-border] bg-[--surface-1]">
        <button onClick={() => { void leaveToGames(); }} aria-label={b.backToGames} className="flex items-center gap-1 text-xs text-[--ink-3] hover:text-[--ink-1] shrink-0 rounded-lg border border-[--rp-border] px-2 py-1 hover:bg-[--surface-2] transition-colors">
          <span className="text-sm leading-none">←</span> <span className="hidden sm:inline">{b.backToGames}</span>
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
          {/* Below `xl` the WORD is dropped and the coloured dot carries the state —
              it frees the pixels the tab strip needs on a small laptop, and the
              explicit save button sits right beside it. A FAILED save is the one
              state that must never be reduced to a dot, so it keeps its word at
              every width. The accessible name is unaffected either way. */}
          <span className={status === 'failed' ? undefined : 'hidden xl:inline'}>
            {status === 'failed' ? b.saveFailedShort
              : status === 'saving' ? b.saving
              : status === 'unsaved' ? b.unsaved
              : b.saved}
          </span>
        </span>

        {/* A manual, always-clickable save — independent of the autosave debounce
            and of whatever the current tab/focus state is. `save()` itself is a
            safe no-op when nothing changed, so this can never do harm; it exists
            purely so a creator who is unsure whether autosave "caught up" has one
            button that unconditionally tries again right now. */}
        <button
          onClick={() => { void save(); }}
          disabled={status === 'saving'}
          title={b.saveNowHint}
          className="shrink-0 min-h-[28px] px-2.5 py-1 rounded-lg text-xs font-medium border border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2] hover:text-[--ink-1] disabled:opacity-50 disabled:pointer-events-none transition-colors"
        >
          {b.saveNow}
        </button>

        {/* Undo / redo — also bound to Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
            Desktop only: at phone width these live in the header overflow menu
            below (change: builder-simplification-round-3). */}
        {!isMobile && (
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
        )}

        {/* Creator-owned portability: save this game to a file you keep, or build
            a new game from one. Import always creates a NEW game. One clearly
            labelled "File" menu (change: builder-file-menu). The actions used to
            be two bare arrow glyphs whose meaning only a hover revealed. Same
            handlers, same hidden file input. Desktop only — at phone width the
            same two actions are items in the header overflow menu. */}
        {!isMobile && (
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
              className={HEADER_MENU_ITEM_CLASS}
            >
              {b.exportFile}
            </button>
            <button
              role="menuitem"
              onClick={() => importInput.current?.click()}
              title={b.importFileHint}
              className={HEADER_MENU_ITEM_CLASS}
            >
              {b.importFile}
            </button>
          </OverflowMenu>
        </div>
        )}

        {/* The hidden picker backing "load a copy" stays mounted at EVERY width —
            only its trigger moves into the overflow menu on a phone. */}
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

        {/* Centered tab strip */}
        <nav role="tablist" data-tour="builder-tabs" className="flex-1 basis-full sm:basis-0 order-last sm:order-none min-w-0 flex items-center justify-center gap-1 overflow-x-auto">
          {visibleTabIds.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => { void save(); setTab(id); if (id === 'preview' && gameId) markGamePreviewed(gameId); }}
              className={`shrink-0 whitespace-nowrap px-2.5 xl:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === id
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
          issues={readiness}
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

        {/* הקמה מהירה (change: quick-setup-wizard). Sits beside readiness on
            purpose: the two answer different questions — "is this game structurally
            launchable?" and "have I filled in what this template asked for?" — and a
            creator working through a template needs both in one place. Renders
            nothing at all for a game with no setup steps. */}
        <QuickSetupPill
          remaining={qsOutstanding.length}
          total={qsSteps.length}
          onResume={() => dispatchQs({ type: 'resume' })}
        />

        {/* The SECONDARY launch (a rehearsal run) collapses into the menu on a
            phone; the PRIMARY launch always stays on the bar. */}
        {!isMobile && (
          <Button variant="ghost" loading={launching} onClick={() => saveAndLaunch(true)} className="shrink-0" title={b.launchTestRunHint}>{b.launchTestRun}</Button>
        )}
        <Button onClick={() => saveAndLaunch(false)} loading={launching} data-tour="builder-launch" className="shrink-0">{b.launchRun}</Button>

        {/* Phone width: ONE menu holding every secondary header control. Back,
            title, save status, tabs, readiness and the primary launch stay on the
            bar — save status is a safety signal and readiness gates launching, so
            neither may hide behind a tap. */}
        {isMobile && (
          <div className="shrink-0">
            <OverflowMenu
              label={b.headerMoreMenu}
              ariaLabel={b.headerMoreMenuAria}
              triggerClassName="min-h-[44px] px-3 rounded-lg text-sm gap-1"
            >
              <button
                role="menuitem"
                onClick={() => { void save(); }}
                disabled={status === 'saving'}
                title={b.saveNowHint}
                className={`${HEADER_MENU_ITEM_CLASS} disabled:opacity-50 disabled:pointer-events-none`}
              >
                {b.saveNow}
              </button>
              <button
                role="menuitem"
                onClick={undo}
                disabled={!canUndo}
                className={`${HEADER_MENU_ITEM_CLASS} disabled:opacity-30 disabled:pointer-events-none`}
              >
                ↶ {b.undo}
              </button>
              <button
                role="menuitem"
                onClick={redo}
                disabled={!canRedo}
                className={`${HEADER_MENU_ITEM_CLASS} disabled:opacity-30 disabled:pointer-events-none`}
              >
                ↷ {b.redo}
              </button>
              <button
                role="menuitem"
                onClick={() => { void exportToFile(); }}
                title={b.exportFileHint}
                className={HEADER_MENU_ITEM_CLASS}
              >
                {b.exportFile}
              </button>
              <button
                role="menuitem"
                onClick={() => importInput.current?.click()}
                title={b.importFileHint}
                className={HEADER_MENU_ITEM_CLASS}
              >
                {b.importFile}
              </button>
              <button
                role="menuitem"
                onClick={() => { void saveAndLaunch(true); }}
                title={b.launchTestRunHint}
                className={HEADER_MENU_ITEM_CLASS}
              >
                {b.launchTestRun}
              </button>
            </OverflowMenu>
          </div>
        )}
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

      {/* ── "Your game is ready" nudge (change: creator-ready-nudge) ──────────
          Nothing blocks the launch AND the game has never been run, so the
          creator can go live but has no obvious signal they are done. One line,
          dismissible, right under the launch controls. It reuses the readiness
          ready title and never shows once the game has a run or the creator
          dismisses it. */}
      {!readyNudgeDismissed && readiness.length === 0 && (game.playCount ?? 0) === 0 && (
        <div
          role="status"
          className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rp-go/40 bg-rp-go/10 px-4 py-2 text-xs text-[--ink-1]"
        >
          <span aria-hidden>✓</span>
          <span className="font-semibold text-rp-go">{b.readinessReadyTitle}</span>
          <span className="text-[--ink-2] text-start">{b.readyNudge}</span>
          <button
            type="button"
            onClick={() => setReadyNudgeDismissed(true)}
            aria-label={t.common.dismiss}
            className="ms-auto shrink-0 rounded-lg border border-[--rp-border] px-2 py-1 text-[11px] text-[--ink-3] hover:bg-[--surface-2] hover:text-[--ink-1] transition-colors"
          >
            {t.common.dismiss}
          </button>
        </div>
      )}

      {/* Leftover creator notes in player-facing text. Shown only on the build
          tab, only while there is something to clean, and dismissible — it is an
          offer, not a blocker, and a creator who likes their text as it is must
          be able to say so and never see it again this session. */}
      {needsNoteCleanup && !cleanupDismissed && activeTab === 'build' && !qsFocusMode && (
        <div className="shrink-0 mx-2 mt-2 rounded-xl border border-rp-amber/50 bg-rp-amber/5 px-3 py-2 flex items-start gap-3">
          <span aria-hidden className="text-base leading-6">🧹</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[--ink-1]">{q.cleanupTitle}</p>
            <p className="text-xs text-[--ink-3] leading-snug mt-0.5">{q.cleanupBody}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button onClick={() => { void cleanUpOperatorNotes(); }}>{q.cleanupCta}</Button>
            <button
              type="button"
              onClick={() => setCleanupDismissed(true)}
              className="px-2.5 py-1.5 rounded-lg text-xs text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors"
            >
              {q.cleanupDismiss}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 p-2 overflow-hidden">
        {/* Build tab manages its own 3-pane overflow; the other tabs scroll
            inside their own pane so the page never gains a scrollbar. */}
        {activeTab === 'build' && <StepStages game={game} setGame={setGame} activeStageId={activeStageId} setActiveStageId={setActiveStageId} focusIssue={focusIssue} quickSetupFocus={quickSetupFocus} quickSetupFocusMode={qsFocusMode} autoOpenedGameRef={autoOpenedGameRef} qsOverlayActive={qsOverlayActive} />}
        {activeTab === 'preview' && <div className="h-full overflow-y-auto"><StepPreview game={game} /></div>}
        {activeTab === 'settings' && <div className="h-full overflow-y-auto"><div className="max-w-2xl"><StepDetails game={game} patch={patch} qsAnchor={qsFocusAnchor} /></div></div>}
        {activeTab === 'analytics' && (
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
// `issues` is a PROP, not re-derived here (change: builder-readiness-autoopen):
// the parent already computed it under a useMemo, and computing it again made the
// same walk run twice per render for no gain.
function ReadinessPanel({ issues, open, onToggle, onActivate }: {
  issues: ReadinessIssue[]; open: boolean; onToggle: () => void; onActivate: (issue: ReadinessIssue) => void;
}) {
  const b = useT().builder;
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
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
          issues.length === 0
            ? 'border-rp-go/40 text-rp-go hover:bg-[--surface-2]'
            : 'border-rp-amber/50 text-rp-amber hover:bg-[--surface-2]'}`}
      >
        <span aria-hidden>{issues.length === 0 ? '✓' : '⚠'}</span>
        <span className="hidden 2xl:inline">{b.readinessTitle}</span>
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
function StepDetails({ game, patch, qsAnchor }: {
  game: Game; patch: (p: Partial<Game>) => void;
  // Passed straight through to the primer editor, which is the one settings control
  // a הקמה מהירה step can point at (change: quick-setup-wizard).
  qsAnchor?: { anchor: string | null; nonce: number };
}) {
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
        <p className="text-xs text-[--ink-3] -mt-2 mb-2">{b.wrongAnswerCostHint}</p>
        {(() => {
          const current = game.scoringOptions?.wrongAnswerPenalty ?? 'off';
          return (
            <>
              <Select aria-label={b.wrongAnswerCost} value={current}
                onChange={(e) => patch({ scoringOptions: { ...(game.scoringOptions ?? {}), wrongAnswerPenalty: e.target.value as typeof current } })}>
                {WRONG_ANSWER_LEVEL_ORDER.map((lv) => (
                  <option key={lv} value={lv}>{b.wrongAnswerLevels[lv].name}</option>
                ))}
              </Select>
              <p className="text-xs text-[--ink-3] mt-1">{b.wrongAnswerLevels[current].desc}</p>
            </>
          );
        })()}
      </Advanced>

      <PresentationField game={game} patch={patch} />

      <InstructionsField game={game} patch={patch} qsAnchor={qsAnchor} />

      {/* Feature toggles grouped into one collapsed section (change: builder-settings-grouping).
          Presentation-only: each checkbox's checked/onChange is copied verbatim, so what
          saves and how it saves is byte-for-byte unchanged. The badge count honors the
          per-field defaults (photo feed defaults ON) via the pure enabledGameFeatureCount. */}
      <Advanced title={b.featuresSection} open={advFeatures} onToggle={() => setAdvFeatures(!advFeatures)}
        meta={<Badge>{b.featuresOnBadge(enabledGameFeatureCount(game))}</Badge>}>
        <label title={b.instantPlayHelp} className="flex items-center gap-2 text-sm text-[--ink-2] cursor-pointer">
          <input type="checkbox" checked={!!game.allowInstantPlay}
            onChange={(e) => patch({ allowInstantPlay: e.target.checked })} />
          {b.instantPlayLabel}
        </label>

        {/* Live photo feed (change: live-photo-feed): default ON; absent = enabled. */}
        <label title={b.photoFeedHint} className="flex items-center gap-2 text-sm text-[--ink-2] cursor-pointer">
          <input type="checkbox" checked={game.photoFeedEnabled !== false}
            onChange={(e) => patch({ photoFeedEnabled: e.target.checked })} />
          {b.photoFeedLabel}
        </label>
        {/* UGC disclosure (change: feed-ugc-safety, D7): run-wide visibility + organizer responsibility. */}
        <p className="text-xs text-[--ink-3] -mt-2">{b.photoFeedResponsibility}</p>

        {/* Power-ups (change: power-ups): default OFF; absent = disabled. */}
        <label title={b.powerUpsHint} className="flex items-center gap-2 text-sm text-[--ink-2] cursor-pointer">
          <input type="checkbox" checked={!!game.powerUpsEnabled}
            onChange={(e) => patch({ powerUpsEnabled: e.target.checked })} />
          {b.powerUpsLabel}
        </label>

        {/* Staged leaderboard reveal (change: manual-leaderboard-reveal): default OFF
            (absent = auto publish on finalize, the pre-existing behaviour). When ON,
            finalizeRun leaves the board unpublished and the creator reveals it from
            the run console. */}
        <label title={b.manualRevealHint} className="flex items-center gap-2 text-sm text-[--ink-2] cursor-pointer">
          <input type="checkbox" checked={!!game.manualLeaderboardReveal}
            onChange={(e) => patch({ manualLeaderboardReveal: e.target.checked })} />
          {b.manualRevealLabel}
        </label>

        {/* Task-library priority (change: task-library-priority-boost): default OFF
            (absent = normal popularity ranking). When ON, every task published from
            this game sorts to the top of every creator's task library search. */}
        <label title={b.pinnedFirstHint} className="flex items-center gap-2 text-sm text-[--ink-2] cursor-pointer">
          <input type="checkbox" checked={!!game.pinnedFirst}
            onChange={(e) => patch({ pinnedFirst: e.target.checked })} />
          {b.pinnedFirstLabel}
        </label>
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
        <p className="text-xs text-[--ink-3]">{b.presentationHint}</p>
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
          <p className="text-xs text-[--ink-3] mt-1">{b.coverImageHint}</p>
        </div>
        <div>
          <Label>{b.brandNameLabel}</Label>
          <Input
            value={brand.name ?? ''}
            onChange={(e) => setBrand({ name: e.target.value })}
            placeholder={game.title}
            dir="auto"
          />
          <p className="text-xs text-[--ink-3] mt-1">{b.brandNameHint}</p>
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
                <span className="text-xs text-[--ink-3]" dir="ltr">{color}</span>
                <button
                  type="button"
                  onClick={() => setBrand({ primaryColor: undefined })}
                  className="ms-auto text-xs text-[--ink-3] underline"
                >
                  {b.brandColorClear}
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-[--ink-3] mt-1">{b.brandColorHint}</p>
        </div>
      </div>
    </Advanced>
  );
}

// "How to play" section (title + bilingual body + optional https image). Shown to
// players before the run starts and behind a "How to play" button in-game. Rides
// the existing updateGame wrapper; the server cleans/https-guards on save.
function InstructionsField({ game, patch, qsAnchor }: {
  game: Game; patch: (p: Partial<Game>) => void;
  // הקמה מהירה (change: quick-setup-wizard): the primer lives behind a collapsed
  // disclosure, and a step that points at it must not scroll to a control that is
  // not mounted. The nonce (not a boolean) is what makes a SECOND activation open
  // it again after the creator collapsed it.
  qsAnchor?: { anchor: string | null; nonce: number };
}) {
  const b = useT().builder;
  const [open, setOpen] = useState(false);
  const ins = game.instructions ?? {};
  useEffect(() => {
    if (qsAnchor?.anchor === 'game.instructions') setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qsAnchor?.nonce]);
  function set(p: Partial<GameInstructions>) {
    patch({ instructions: { ...ins, ...p } });
  }
  return (
    <Advanced title={b.instructionsSectionTitle} open={open} onToggle={() => setOpen(!open)}>
      <div className="space-y-3" data-qs-field="game.instructions">
        <p className="text-xs text-[--ink-3]">{b.instructionsHint}</p>
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
  // Popular gallery tags offered as one-tap "quick add" chips. Loaded once, shared
  // with the task-tags field; a failed fetch resolves to [] so the row just hides.
  const [popular, setPopular] = useState<string[]>([]);
  useEffect(() => { let live = true; void loadPopularTags().then((t) => { if (live) setPopular(t); }); return () => { live = false; }; }, []);
  // Resync the raw string only when the persisted tags diverge from what the raw
  // string would produce — i.e. an async load or undo/redo, NOT the creator's own
  // keystrokes (which must keep their in-progress separators intact).
  useEffect(() => {
    const derived = parseTagsInput(raw);
    if (JSON.stringify(derived) !== JSON.stringify(game.tags)) setRaw(game.tags.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.tags]);
  // Only suggest tags the game does not already carry (case-insensitive). normalizeTags
  // on add makes the tap idempotent regardless, so this is purely to keep the row tidy.
  const have = new Set(game.tags.map((t) => t.toLowerCase()));
  const suggestions = popular.filter((t) => !have.has(t.toLowerCase())).slice(0, 12);
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
      {suggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] text-[--ink-3] mb-1">{b.popularTags}</p>
          <div className="flex flex-wrap items-center gap-1">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                dir="auto"
                onClick={() => patch({ tags: normalizeTags([...game.tags, tag]) })}
                className="inline-flex items-center max-w-full truncate px-2 py-0.5 rounded-full text-[11px] font-medium border border-dashed border-rp-fire/40 bg-rp-fire/5 text-rp-fire hover:bg-rp-fire/10"
              >
                + {tag}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-[--ink-3] mt-1">{b.tagsHelp}</p>
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
        <p className="text-xs text-[--ink-3]">{b.safeZoneHint}</p>
        {!zone ? (
          <>
            <Button variant="ghost" onClick={enable} disabled={!suggestion}>
              {b.safeZoneEnable}
            </Button>
            <p className="text-xs text-[--ink-3]">
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
                ? <p className="text-rp-alert text-xs mt-1">{err}</p>
                : <p className="text-xs text-[--ink-3] mt-1">{b.safeZoneRadiusHint}</p>}
            </div>
            <p className="text-xs text-[--ink-3]" dir="ltr">
              {zone.center.lat.toFixed(5)}, {zone.center.lng.toFixed(5)}
            </p>
            {suggestion && suggestion.coversAllTasks === false && (
              <p className="text-xs text-rp-amber">{b.safeZoneTooSpread}</p>
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

function StepStages({ game, setGame, activeStageId, setActiveStageId, focusIssue, quickSetupFocus, quickSetupFocusMode, autoOpenedGameRef, qsOverlayActive }: {
  game: Game; setGame: (g: Game) => void;
  activeStageId: string | null; setActiveStageId: (id: string) => void;
  // An activated readiness entry (change: builder-first-task-flow). The `nonce`
  // makes re-activating the SAME entry a new request.
  focusIssue?: { stageId: string; taskId: string; nonce: number } | null;
  // An activated הקמה מהירה step (change: quick-setup-wizard). Same nonce trick,
  // plus WHERE inside the mission editor the target field lives.
  quickSetupFocus?: { stageId: string; taskId: string; tab: TaskEditorTab | null; group: TaskOptInGroup | null; nonce: number } | null;
  // Quick Setup FOCUS MODE: hide the stage rail and scrim the canvas so only the
  // active mission's editor (rendered as a sibling, never dimmed) and the
  // floating Quick Setup card compete for attention.
  quickSetupFocusMode?: boolean;
  // Parent-owned auto-open guard (survives this component's tab-switch remounts).
  autoOpenedGameRef: { current: string | null };
  // A הקמה מהירה bar/card is currently floating (change: quick-setup-mobile-visibility)
  // — forwarded to the mission editor's mobile sheet so it can reserve room at its
  // own top edge instead of being hidden underneath it.
  qsOverlayActive?: boolean;
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
  /** Deleting a stage destroys every task inside it and there is no undo once the
   *  Builder's autosave lands, so it ASKS FIRST and names what it will take
   *  (change: builder-nondestructive-disclosure). The control used to be labelled
   *  "close" and fired straight into removeStage — one misread click from losing a
   *  whole stage. Matches the confirmation posture of deleteGame / skipTaskForTeam. */
  async function confirmRemoveStage(stage: Stage) {
    const taskCount = stage.tasks?.length ?? 0;
    const ok = await dialog.confirm(
      b.deleteStageConfirm(stage.title?.trim() || b.stageTitlePlaceholder, taskCount),
      b.deleteStageCta,
      true,
    );
    if (ok) removeStage(stage.id);
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

  // Builder header breadcrumb (change: builder-clarity-mission-hierarchy): the
  // wizard's open task only counts toward the breadcrumb while it belongs to the
  // currently active stage, so a stale (stageId, taskId) pair from a just-completed
  // cross-stage move never shows a mission from the wrong stage.
  const breadcrumbState = builderBreadcrumbState(
    game.stages,
    activeStage?.id,
    editing?.stageId === activeStage?.id ? editing?.taskId : undefined,
    { untitledStage: b.untitledStage, untitledMission: b.untitledTask },
  );
  const breadcrumbText = breadcrumbState && (
    breadcrumbState.mission
      ? `${b.breadcrumbStage(breadcrumbState.stageNumber, breadcrumbState.stageName)} → ${b.breadcrumbMission(breadcrumbState.mission.number, breadcrumbState.mission.name)}`
      : b.breadcrumbStage(breadcrumbState.stageNumber, breadcrumbState.stageName)
  );

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

  // First-task auto-open (change: builder-first-task-flow). A brand-new blank
  // game drops the creator straight into naming their first task instead of
  // leaving them to find and click the seeded "Untitled task" card. The ref
  // guard fires this AT MOST ONCE per mount, so it never re-opens the editor
  // after the creator closes it, and `shouldAutoOpenFirstTask` refuses any game
  // that is not a single untouched blank task (see wizardLogic).
  useEffect(() => {
    if (autoOpenedGameRef.current === game.id) return;
    autoOpenedGameRef.current = game.id;
    const target = shouldAutoOpenFirstTask(game);
    if (target) setEditing({ stageId: target.stageId, taskId: target.taskId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Land on the offending task when a readiness entry is activated, with its
  // message already visible.
  useEffect(() => {
    if (!focusIssue) return;
    setSettingsOpen(false);
    setEditing({ stageId: focusIssue.stageId, taskId: focusIssue.taskId, revealAll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIssue?.nonce]);

  // Same landing for a הקמה מהירה step, minus `revealAll`: the creator arrived to
  // FILL a field, not because something is broken, so the editor must not greet
  // them with every validation message the mission could ever show.
  useEffect(() => {
    if (!quickSetupFocus?.taskId) return;
    setSettingsOpen(false);
    setEditing({ stageId: quickSetupFocus.stageId, taskId: quickSetupFocus.taskId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSetupFocus?.nonce]);

  return (
    // Fills the shell body; each pane manages its own overflow so the task panel
    // gets the full height and never clips, and the page never scrolls.
    <div className="h-full min-h-0 flex flex-col gap-1.5">
      {/* ── Stage/mission breadcrumb (change: builder-clarity-mission-hierarchy) ──
          The hierarchy was never labelled on screen — a creator inferred which
          stage was open and which mission they were editing purely from
          rail-vs-canvas layout position. Live-derived off state the Builder
          already holds; no new Firestore read. */}
      {breadcrumbText && (
        <div
          className="shrink-0 px-1 text-xs font-medium text-[--ink-3] truncate"
          data-tour="builder-breadcrumb"
          title={breadcrumbText}
        >
          {breadcrumbText}
        </div>
      )}
      <div className="flex-1 min-h-0">
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
          so the canvas below gets the full width.
          Hidden entirely in Quick Setup FOCUS MODE (change: quick-setup-wizard):
          the flow already drives which stage is active, so the rail is one more
          thing competing for attention with nothing left for it to do. ── */}
      {!quickSetupFocusMode && (
        <StageRail
          stages={game.stages}
          activeStageId={activeStage?.id ?? null}
          onSelect={setActiveStageId}
          onAdd={addStage}
          taskDragging={activeDrag?.type === 'task'}
        />
      )}

      {/* ── Centre canvas: the active stage. No wrapping Card — the shell already
          contains it; the task cards provide the structure. A flex column: the
          stage header is fixed, the task canvas flexes and owns the ONLY scroll
          (no more nested double-scrollbar), the add-tiles stay pinned below.
          `relative` so the focus-mode scrim (below) can cover exactly this
          region and nothing outside it — the mission editor (`ContextPanel`)
          renders as this div's OWN sibling in the row below, never inside it,
          so it is never scrimmed. ── */}
      <div data-tour="builder-canvas" className="relative flex-1 min-w-0 min-h-0 sm:h-full flex flex-col gap-3 pe-1 pt-0.5">
        {activeStage && (
          <>
            <div className="shrink-0 space-y-2">
            {/* Title row — the calm centre of the stage at rest: just the name,
                the finale toggle on the last stage, and delete. */}
            <div className="flex items-center gap-2">
              <Input value={activeStage.title} onChange={(e) => updateStage(activeStage.id, { title: e.target.value })} className="flex-1" placeholder={b.stageTitlePlaceholder} dir="auto" />
              {isLastStage && (
                <label className="flex items-center gap-1 text-xs text-[--ink-2] shrink-0">
                  <input type="checkbox" checked={!!activeStage.isFinal}
                    onChange={(e) => updateStage(activeStage.id, { isFinal: e.target.checked })} />{b.finalLabel}
                </label>
              )}
              {game.stages.length > 1 && (
                <button className="text-neon-red text-sm shrink-0" aria-label={b.deleteStage} title={b.deleteStage}
                  onClick={() => void confirmRemoveStage(activeStage)}>✕</button>
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
              <button
                type="button"
                onClick={() => { setEditing(null); setSettingsOpen(true); }}
                className="text-xs text-amber-400 underline decoration-dotted cursor-pointer hover:text-amber-300 text-start"
              >
                ⚠ {b.exclusiveUnwinnableWarn}
              </button>
            )}

            {/* Unlockable tasks (change: unlockable-tasks): warn when the required
                completion count exceeds the tasks that can actually complete. */}
            {validateUnlockGraph(activeStage).warnings.length > 0 && (
              <button
                type="button"
                onClick={() => { setEditing(null); setSettingsOpen(true); }}
                className="text-xs text-amber-400 underline decoration-dotted cursor-pointer hover:text-amber-300 text-start"
              >
                ⚠ {b.unlockRequiredCountWarn}
              </button>
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
              <button
                type="button"
                onClick={() => { setEditing(null); setSettingsOpen(true); }}
                className="text-xs text-amber-400 underline decoration-dotted cursor-pointer hover:text-amber-300 text-start"
              >
                ⚠ {b.partialStarvationWarn}
              </button>
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
        {/* Quick Setup FOCUS MODE scrim (change: quick-setup-wizard). A translucent,
            blurred layer over the canvas ONLY — never over the mission editor,
            which is this div's sibling. `pointer-events-auto` deliberately blocks
            interaction with the dimmed grid: the creator's attention belongs on
            the floating card, not on a task card they can half-see behind it. */}
        {quickSetupFocusMode && (
          <div
            aria-hidden
            // `.rp-qs-scrim` (index.css), not `bg-[--surface-1]/75`: Tailwind
            // cannot apply an opacity modifier to an arbitrary CSS custom
            // property, so that class compiled to no rule and the "scrim" was
            // actually fully transparent (blur only, no tint).
            className="rp-qs-scrim absolute inset-0 z-20 rounded-xl pointer-events-auto transition-opacity duration-300"
          />
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
          focus={quickSetupFocus && quickSetupFocus.taskId === editingTask.id ? quickSetupFocus : null}
          siblings={editingStage.tasks}
          reserveTop={!!qsOverlayActive}
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
      </div>
    </div>
  );
}

// Slide-in context panel (Component 4, change: v2.1-builder-shell-redesign).
// Keeps a LOCAL draft (lib/taskDraft) as the input source so the panel's fields
// stay responsive, but flushes each edit to global state *immediately* so the
// canvas and the undo/redo buttons reflect it in real time. `useHistory` coalesces
// a typing burst into one undo step, and the server save stays debounced via its
// own effect — so live flushing here doesn't spam the backend.
// Hardware-accelerated transform slide-in.
function ContextPanel({ task, onFlush, onClose, onRemove, gameId, siblings, revealAll, focus, reserveTop }: {
  task: Task; onFlush: (t: Task) => void; onClose: () => void; onRemove?: () => void; gameId?: string;
  siblings?: Task[];
  // Opened from a readiness entry: show that task's validation messages at once.
  revealAll?: boolean;
  // Opened by a הקמה מהירה step (change: quick-setup-wizard): which editor tab owns
  // the target field and which collapsed group it hides in.
  focus?: { tab: TaskEditorTab | null; group: TaskOptInGroup | null; nonce: number } | null;
  // A הקמה מהירה bar/card is currently floating over the phone-width sheet
  // (change: quick-setup-mobile-visibility) — reserve room at its top edge instead
  // of letting the two overlap.
  reserveTop?: boolean;
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
    <SlidePanel shown={shown} reserveTop={reserveTop}>
      <div className="flex-1 min-h-0 p-2.5">
        <TaskWizard task={state.draft} onChange={handleChange} onRemove={onRemove} onDone={close} onClose={close} closeLabel={b.closePanel} gameId={gameId} siblings={siblings} revealAll={revealAll}
          focusTab={focus?.tab ?? null} focusGroup={focus?.group ?? null} focusNonce={focus?.nonce} />
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
//
// `reserveTop` (change: quick-setup-mobile-visibility): the floating הקמה מהירה
// bar/card is a fixed z-50 element pinned near the phone's top edge — same corner
// as this sheet's own z-40. Rather than fight over who paints on top (either
// answer disturbs the other: over it hides the mission editor's own tab row,
// under it hides the very instruction the creator opened the editor to read),
// the sheet steps its OWN top edge down by the overlay's rough height only while
// one is actually up, so both stay fully visible and fully usable at once.
function SlidePanel({ shown, children, reserveTop }: { shown: boolean; children: ReactNode; reserveTop?: boolean }) {
  return (
    <aside
      className={`shrink-0 self-stretch h-full max-lg:h-auto overflow-hidden transition-[width] duration-200 ease-out
        max-lg:fixed max-lg:bottom-0 max-lg:end-0 max-lg:z-40 max-lg:!w-[min(100vw,32rem)] max-lg:p-2 max-lg:shadow-soft
        ${reserveTop ? 'max-lg:top-32' : 'max-lg:top-0'}`}
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
  const estMin = game.stages.flatMap((s) => s.tasks).reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const modeLabel: Record<GameMode, string> = { individual: b.modeIndividual, team: b.modeTeam };
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-xl font-bold" dir="auto">{game.title || b.untitledGame}</h2>
        <p className="text-[--ink-2] text-sm" dir="auto">{game.description}</p>
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

      <p className="text-xs text-[--ink-3]">{b.previewLaunchNote}</p>
    </Card>
  );
}
