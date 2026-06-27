import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Game, Stage, Task, TaskStep, ScoringPreset, RegistrationField, GameMode, TaskType, TriggerMode,
} from '@rushpoint/shared';
import { PRESET_LABELS, PAYMENTS_ENABLED, normalizeTriggerMode, defaultRadiusFor } from '@rushpoint/shared';

// Trigger-mode selector metadata (change: task-trigger-modes). The 4 modes
// replace the old binary "has a location" toggle on the task editor.
const TRIGGER_MODE_META: { mode: TriggerMode; icon: string; label: string; desc: string }[] = [
  { mode: 'radius', icon: '📍', label: 'Within radius', desc: 'Fires when a player is within a set radius (default 40m).' },
  { mode: 'exact', icon: '🎯', label: 'Exact spot', desc: 'Fires only on precise arrival (default 4m).' },
  { mode: 'instant', icon: '⚡', label: 'Instant', desc: 'Fires immediately on arrival at this task. No GPS check.' },
  { mode: 'locationless', icon: '🌐', label: 'Anywhere', desc: 'Purely digital. No map pin, playable from anywhere.' },
];
import { getGame, updateGame, launchRun } from '../services/calls';
import { Advanced, Badge, Button, Card, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { dialog } from '../components/dialog';
import TaskLibrary from '../components/TaskLibrary';
import QuizChoicesEditor from '../components/QuizChoicesEditor';
import StageRail from '../components/StageRail';
import TaskCanvas from '../components/TaskCanvas';
import LocationStep from '../components/LocationStep';
import RichTooltip from '../components/RichTooltip';
import { TASK_SAMPLES, applySample } from '../lib/taskTemplates';
import { moveItem } from '../lib/reorder';
import { initDraft, editDraft, isDirty, commit, type DraftState } from '../lib/taskDraft';

// MapLibre is heavy (~500KB). The located-task map lives in lazy LocationStep
// (fetched only when a located task editor opens); the preview route map is split
// the same way here so it stays out of the main builder bundle.
const RoutePreviewMap = lazy(() => import('../components/RoutePreviewMap'));

// Lightweight placeholder while a map chunk + engine load.
function MapSkeleton({ className = 'h-44' }: { className?: string }) {
  return (
    <div className={`${className} rounded-lg border border-[--rp-border] bg-[--surface-2] animate-pulse flex items-center justify-center gap-2 text-xs text-[--ink-3]`}>
      <span>🗺</span> Loading map…
    </div>
  );
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function blankTask(): Task {
  return {
    id: uuid(),
    title: '',
    type: 'field',
    coordinates: { lat: 0, lng: 0 },
    difficulty: 5,
    estimatedMinutes: 15,
    pointValue: 100,
    maxConcurrentTeams: 3,
    tags: [],
  };
}
function blankStage(order: number): Stage {
  return { id: uuid(), order, title: `Stage ${order + 1}`, tasks: [blankTask()] };
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
  };
}
const serializeGame = (g: Game) => JSON.stringify(buildSavePayload(g));

type SaveStatus = 'saved' | 'saving' | 'unsaved';
const AUTOSAVE_DELAY = 1500;

// The persistent shell's top-level views (change: v2.1-builder-shell-redesign).
type BuilderTab = 'build' | 'preview' | 'analytics' | 'settings';
const BUILDER_TABS: { id: BuilderTab; label: string }[] = [
  { id: 'build', label: 'Build' },
  { id: 'preview', label: 'Preview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
];

// Inline-editable game title promoted into the shell header. Enter blurs (which
// autosaves via the debounced patch); an empty value reverts to the prior title.
function EditableTitle({ title, onCommit }: { title: string; onCommit: (t: string) => void }) {
  return (
    <h2
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
      onBlur={(e) => {
        const v = e.currentTarget.textContent?.trim() ?? '';
        if (v && v !== title) onCommit(v);
        else e.currentTarget.textContent = title || 'Untitled';
      }}
      className="text-lg font-bold text-[--ink-1] outline-none rounded px-1 -mx-1 border-b border-transparent focus:border-rp-fire min-w-[6ch]"
    >
      {title || 'Untitled'}
    </h2>
  );
}

export default function BuilderPage() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const [game, setGame] = useState<Game | null>(null);
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
        setGame(game);
        savedSnapshot.current = serializeGame(game);
        setStatus('saved');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Could not load game');
      });
  }, [gameId, loadKey]);

  function patch(p: Partial<Game>) { setGame((g) => (g ? { ...g, ...p } : g)); }

  // Persist only when there are real changes; safe to call eagerly (no-op when
  // the current state already matches what was last saved).
  const save = useCallback(async () => {
    const g = gameRef.current;
    if (!g) return;
    const snap = serializeGame(g);
    if (snap === savedSnapshot.current) return;
    setStatus('saving');
    try {
      await updateGame(buildSavePayload(g));
      savedSnapshot.current = snap;
      // If the user kept editing during the round-trip, stay 'unsaved'.
      const latest = gameRef.current;
      setStatus(latest && serializeGame(latest) !== snap ? 'unsaved' : 'saved');
    } catch {
      setStatus('unsaved');
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

  async function saveAndLaunch() {
    if (!game) return;
    window.clearTimeout(saveTimer.current);
    await save();
    if (game.stages.length === 0 || game.stages.some((s) => s.tasks.length === 0)) {
      await dialog.alert('Every stage needs at least one task.'); return;
    }
    try {
      const { runId } = await launchRun({ gameId: game.id });
      nav(`/run/${game.id}/${runId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Launch failed';
      // Out of free runs + credits → offer to open the wallet. In free mode
      // launches never fail for billing, so just surface any other error.
      if (PAYMENTS_ENABLED && /credit|pro/i.test(msg) && await dialog.confirm(msg, 'Go to wallet')) {
        nav('/wallet');
      } else if (!PAYMENTS_ENABLED || !/credit|pro/i.test(msg)) {
        await dialog.alert(msg);
      }
    }
  }

  if (error && !game) return (
    <Card className="p-8 text-center space-y-4">
      <div className="text-3xl">⚠️</div>
      <p className="font-semibold text-[--ink-1]">Could not load game</p>
      <p className="text-sm text-[--ink-3]">{error}</p>
      <Button onClick={() => { setError(null); setLoadKey((k) => k + 1); }}>Try again</Button>
    </Card>
  );
  if (!game) return <Spinner label="Loading builder…" />;

  return (
    <div className="max-w-3xl mx-auto">
      {/* ── Persistent shell header: breadcrumb · editable title · tabs · launch ── */}
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <button onClick={() => nav('/')} className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">← Games</button>
          <span className="text-zinc-600">/</span>
          <EditableTitle title={game.title} onCommit={(t) => patch({ title: t })} />
          <span className="text-xs flex items-center gap-1.5 text-zinc-500 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${
              status === 'saving' ? 'bg-rp-amber animate-pulse'
                : status === 'unsaved' ? 'bg-rp-amber'
                : 'bg-rp-go'}`} />
            {status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved' : 'Saved'}
          </span>
          <div className="ms-auto shrink-0">
            <Button onClick={saveAndLaunch}>Launch run</Button>
          </div>
        </div>

        <div role="tablist" className="flex items-center gap-1 border-b border-[--rp-border]">
          {BUILDER_TABS.map((tt) => (
            <button
              key={tt.id}
              role="tab"
              aria-selected={tab === tt.id}
              onClick={() => { void save(); setTab(tt.id); }}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === tt.id
                  ? 'border-rp-fire text-[--ink-1]'
                  : 'border-transparent text-[--ink-3] hover:text-[--ink-1]'}`}
            >
              {tt.label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'build' && <StepStages game={game} setGame={setGame} activeStageId={activeStageId} setActiveStageId={setActiveStageId} />}
      {tab === 'preview' && <StepPreview game={game} />}
      {tab === 'settings' && <StepDetails game={game} patch={patch} />}
      {tab === 'analytics' && (
        <Card className="p-10 text-center space-y-2">
          <div className="text-3xl">📊</div>
          <p className="font-semibold text-[--ink-1]">Analytics</p>
          <p className="text-sm text-[--ink-3]">Run analytics appear here after your first live run.</p>
        </Card>
      )}
    </div>
  );
}

// ── Step 1: Details ──
function StepDetails({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  const [advReg, setAdvReg] = useState(false);
  const [advScore, setAdvScore] = useState(false);
  return (
    <Card className="p-5 space-y-4">
      <div>
        <Label>Mode</Label>
        <div className="flex gap-2">
          {(['individual', 'team'] as GameMode[]).map((m) => (
            <button key={m} onClick={() => patch({ mode: m })}
              className={`flex-1 py-2 rounded-lg text-sm border capitalize ${
                game.mode === m ? 'border-neon-green/50 bg-neon-green/10 text-neon-green' : 'border-glass-border text-zinc-400'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Short description</Label>
        <Input value={game.description ?? ''} onChange={(e) => patch({ description: e.target.value })} placeholder="One line that sells the adventure" />
      </div>
      <div>
        <Label>Tags (comma-separated)</Label>
        <Input value={game.tags.join(', ')} onChange={(e) => patch({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
          placeholder="outdoor, puzzle, family" />
      </div>

      <Advanced title="Advanced scoring settings" open={advScore} onToggle={() => setAdvScore(!advScore)}>
        <Label>Scoring preset</Label>
        <div className="space-y-2">
          {(Object.keys(PRESET_LABELS) as ScoringPreset[]).map((p) => (
            <button key={p} onClick={() => patch({ scoringPreset: p })}
              className={`w-full text-left p-3 rounded-lg border ${
                game.scoringPreset === p ? 'border-neon-green/50 bg-neon-green/10' : 'border-glass-border'}`}>
              <div className="text-sm font-medium text-zinc-200">{PRESET_LABELS[p].en}</div>
              <div className="text-xs text-zinc-500">{PRESET_LABELS[p].description}</div>
            </button>
          ))}
        </div>
      </Advanced>

      <Advanced title="Advanced registration fields" open={advReg} onToggle={() => setAdvReg(!advReg)}>
        <RegFields game={game} patch={patch} />
      </Advanced>
    </Card>
  );
}

function RegFields({ game, patch }: { game: Game; patch: (p: Partial<Game>) => void }) {
  function add() {
    const f: RegistrationField = { id: uuid(), label: 'New field', type: 'text', required: false, level: 'member' };
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
      <p className="text-xs text-zinc-500">&quot;Name&quot; (per member) is always required.</p>
      {game.registrationFields.map((f) => (
        <div key={f.id} className="flex gap-2 items-center">
          <Input value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} disabled={f.id === 'name'} />
          <Select value={f.type} onChange={(e) => update(f.id, { type: e.target.value as RegistrationField['type'] })}>
            <option value="text">text</option><option value="number">number</option>
            <option value="phone">phone</option><option value="checkbox">checkbox</option><option value="select">select</option>
          </Select>
          <Select value={f.level} onChange={(e) => update(f.id, { level: e.target.value as RegistrationField['level'] })}>
            <option value="member">member</option><option value="team">team</option>
          </Select>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            <input type="checkbox" checked={f.required} onChange={(e) => update(f.id, { required: e.target.checked })} />req
          </label>
          {f.id !== 'name' && <button className="text-neon-red text-xs" onClick={() => remove(f.id)}>✕</button>}
        </div>
      ))}
      <Button variant="subtle" onClick={add}>+ Add field</Button>
    </div>
  );
}

// ── Step 2: Stages & Tasks ──
function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-32 h-24 shrink-0 rounded-xl border border-dashed border-glass-border text-zinc-500
                 flex flex-col items-center justify-center gap-1 text-xs
                 hover:border-neon-green/60 hover:text-neon-green transition"
    >
      <span className="text-xl leading-none">＋</span>{label}
    </button>
  );
}

function StepStages({ game, setGame, activeStageId, setActiveStageId }: {
  game: Game; setGame: (g: Game) => void;
  activeStageId: string | null; setActiveStageId: (id: string) => void;
}) {
  const [libraryFor, setLibraryFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ stageId: string; taskId: string } | null>(null);
  function setStages(stages: Stage[]) { setGame({ ...game, stages }); }
  // Native HTML5 drag reorder: move a stage then re-sequence `order`.
  function moveStage(from: number, to: number) {
    setStages(moveItem(game.stages, from, to).map((s, i) => ({ ...s, order: i })));
  }
  function addStage() {
    const s = blankStage(game.stages.length);
    setStages([...game.stages, s]);
    setActiveStageId(s.id);
  }
  function updateStage(id: string, p: Partial<Stage>) {
    setStages(game.stages.map((s) => (s.id === id ? { ...s, ...p } : s)));
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

  return (
    <div className="flex gap-4 items-start">
      {/* ── Left rail: stage navigator ── */}
      <StageRail
        stages={game.stages}
        activeStageId={activeStage?.id ?? null}
        onSelect={setActiveStageId}
        onMove={moveStage}
        onAdd={addStage}
      />

      {/* ── Centre canvas: the active stage ── */}
      <div className="flex-1 min-w-0">
        {activeStage && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Input value={activeStage.title} onChange={(e) => updateStage(activeStage.id, { title: e.target.value })} className="flex-1" />
              {isLastStage && (
                <label className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
                  <input type="checkbox" checked={!!activeStage.isFinal}
                    onChange={(e) => updateStage(activeStage.id, { isFinal: e.target.checked })} />final
                </label>
              )}
              {game.stages.length > 1 && (
                <button className="text-neon-red text-sm shrink-0" onClick={() => removeStage(activeStage.id)}>✕</button>
              )}
            </div>

            {/* Completion rule — only meaningful with a pool of tasks */}
            {m > 1 && (
              <div className="flex items-center flex-wrap gap-2 mb-3 text-xs text-zinc-400">
                <span>Each team completes</span>
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
                <span>of {m} tasks{req < m ? ', routed to best-suited ones' : ' (all of them)'}</span>
              </div>
            )}

            <TaskCanvas
              tasks={activeStage.tasks}
              activeTaskId={editing?.stageId === activeStage.id ? editing?.taskId : undefined}
              onSelect={(taskId) => setEditing({ stageId: activeStage.id, taskId })}
            />
            <div className="flex gap-2 pt-3">
              <AddTile label="Add task" onClick={() => addTask(activeStage.id)} />
              <AddTile label="From library" onClick={() => setLibraryFor(activeStage.id)} />
            </div>
          </Card>
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
          onFlush={(t) => updateStage(editingStage.id, { tasks: editingStage.tasks.map((x) => (x.id === t.id ? t : x)) })}
          onRemove={editingStage.tasks.length > 1
            ? () => { updateStage(editingStage.id, { tasks: editingStage.tasks.filter((x) => x.id !== editingTask.id) }); setEditing(null); }
            : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// Slide-in context panel (Component 4, change: v2.1-builder-shell-redesign).
// Edits a LOCAL draft (lib/taskDraft) so keystrokes never re-render the canvas or
// hit the server; the draft flushes to global state on a 1500ms debounce, and any
// pending edit flushes on close/unmount. Hardware-accelerated transform slide-in.
function ContextPanel({ task, onFlush, onClose, onRemove }: {
  task: Task; onFlush: (t: Task) => void; onClose: () => void; onRemove?: () => void;
}) {
  const [state, setState] = useState<DraftState>(() => initDraft(task));
  const [shown, setShown] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const flushTimer = useRef<number>();

  // Slide in on mount.
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // Flush any pending draft when the panel unmounts (close or task switch).
  useEffect(() => () => {
    window.clearTimeout(flushTimer.current);
    if (isDirty(stateRef.current)) onFlush(stateRef.current.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(t: Task) {
    setState((d) => editDraft(d, t));
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      const cur = stateRef.current;
      if (isDirty(cur)) { onFlush(cur.draft); setState(commit(cur)); }
    }, AUTOSAVE_DELAY);
  }

  function close() { window.clearTimeout(flushTimer.current); onClose(); }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={close}>
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{ willChange: 'transform' }}
        className={`h-full w-full max-w-md bg-app-card border-s border-glass-border shadow-soft overflow-y-auto p-4
          transition-transform duration-200 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Edit task</h3>
          <button onClick={close} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>
        <TaskEditor task={state.draft} onChange={handleChange} onRemove={onRemove} />
        <Button className="w-full mt-3" onClick={close}>Done</Button>
      </aside>
    </div>
  );
}

function TaskEditor({ task, onChange, onRemove }: { task: Task; onChange: (t: Task) => void; onRemove?: () => void }) {
  const [adv, setAdv] = useState(false);
  // Inspiration Mode: one-click sample fills the whole draft, with a brief green
  // flash so the change is felt (change: v2.1-builder-shell-redesign).
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const set = (p: Partial<Task>) => onChange({ ...task, ...p });
  const samples = TASK_SAMPLES[task.type] ?? [];
  function loadSample(sample: typeof samples[number]) {
    onChange(applySample(task, sample));
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 600);
  }
  const setSmart = (p: Record<string, unknown>) =>
    onChange({ ...task, smart: { enabled: true, verificationType: task.smart?.verificationType ?? 'code_verification', ...task.smart, ...p } });

  const mode = normalizeTriggerMode(task);
  const located = mode === 'radius' || mode === 'exact';
  // Select a trigger mode: keep the legacy `locationless` flag in sync and seed a
  // sensible default radius for radius/exact.
  const setMode = (m: TriggerMode) => set({
    triggerMode: m,
    locationless: m === 'locationless',
    geofenceRadiusMeters: (m === 'radius' || m === 'exact')
      ? (task.geofenceRadiusMeters ?? defaultRadiusFor(m))
      : task.geofenceRadiusMeters,
  });
  return (
    <div className={`space-y-2 rounded-xl transition-colors duration-500 ${flash ? 'bg-rp-go/15 ring-1 ring-rp-go/50' : ''}`}>
      {samples.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5 pb-1">
          <span className="text-[11px] text-[--ink-3] me-1">✨ Start from a sample:</span>
          {samples.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => loadSample(s)}
              className="text-xs px-2.5 py-1 rounded-full border border-[--rp-border] text-[--ink-2] hover:border-rp-fire hover:text-[--ink-1] transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <Input value={task.title} onChange={(e) => set({ title: e.target.value })} placeholder="Task title" />

      <Textarea
        value={task.description ?? ''}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="What participants see: the clue or instructions for this task"
        rows={2}
      />

      <div>
        <Label>How does this task fire?</Label>
        <div className="grid grid-cols-2 gap-2">
          {TRIGGER_MODE_META.map((tm) => (
            <button
              key={tm.mode}
              type="button"
              onClick={() => setMode(tm.mode)}
              className={`text-start rounded-lg border px-3 py-2 transition-colors ${
                mode === tm.mode ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'
              }`}
            >
              <div className="text-sm font-medium text-[--ink-1]">{tm.icon} {tm.label}</div>
              <div className="text-[11px] text-[--ink-3]">{tm.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {(mode === 'radius' || mode === 'exact') && (
        <div>
          <Label>Trigger radius (metres) <RichTooltip concept="geofence" /></Label>
          <Input type="number" min={1} value={task.geofenceRadiusMeters ?? defaultRadiusFor(mode)}
            onChange={(e) => set({ geofenceRadiusMeters: Math.max(1, parseInt(e.target.value) || defaultRadiusFor(mode)) })} />
        </div>
      )}

      {located ? (
        <LocationStep coordinates={task.coordinates} onChange={(lat, lng) => set({ coordinates: { lat, lng } })} />
      ) : (
        <p className="text-xs text-zinc-500 bg-app-raised rounded-lg px-3 py-2">
          {mode === 'instant'
            ? '⚡ Instant task. Completes the moment a player reaches it, with no GPS check.'
            : '🌐 General task. Teams can do this from anywhere, no map pin or travel distance.'}
        </p>
      )}

      <div>
        <Label>Difficulty 1 to 10 <RichTooltip concept="difficulty" /></Label>
        <Input type="number" min={1} max={10} value={task.difficulty} onChange={(e) => set({ difficulty: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })} />
      </div>

      <Advanced title="Advanced task settings" open={adv} onToggle={() => setAdv(!adv)}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Type</Label>
            <Select value={task.type} onChange={(e) => set({ type: e.target.value as TaskType })}>
              <option value="field">field check-in</option>
              <option value="self_report">self-report</option>
              <option value="smart_station">smart station (code)</option>
              <option value="photo">photo upload</option>
              <option value="quiz">quiz / answer</option>
              <option value="numeric">numeric answer</option>
              <option value="geofence">GPS auto-check-in</option>
              <option value="sequence">sequence (multi-step)</option>
            </Select>
          </div>
          <div>
            <Label>Points</Label>
            <Input type="number" value={task.pointValue} onChange={(e) => set({ pointValue: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>Est. minutes</Label>
            <Input type="number" value={task.estimatedMinutes} onChange={(e) => set({ estimatedMinutes: parseInt(e.target.value) || 1 })} />
          </div>
          <div>
            <Label>Max teams at once <RichTooltip concept="concurrent" /></Label>
            <Input type="number" value={task.maxConcurrentTeams} onChange={(e) => set({ maxConcurrentTeams: parseInt(e.target.value) || 1 })} />
          </div>
        </div>

        {task.type === 'smart_station' && (
          <div>
            <Label>Secret code (participants enter this)</Label>
            <Input value={task.smart?.secretCode ?? ''} onChange={(e) => setSmart({ verificationType: 'code_verification', secretCode: e.target.value, hasCode: true })}
              placeholder="e.g. FOX42" />
          </div>
        )}
        {task.type === 'photo' && (
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={task.smart?.autoApprove ?? false}
              onChange={(e) => setSmart({ verificationType: 'photo_upload', autoApprove: e.target.checked })} />
            Auto-approve (no staff review needed)
          </label>
        )}

        {task.type === 'quiz' && (
          <QuizChoicesEditor task={task} onChange={(p) => set(p)} />
        )}

        {task.type === 'numeric' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Correct number</Label>
              <Input type="number" value={task.numericAnswer ?? ''} onChange={(e) => set({ numericAnswer: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
            </div>
            <div>
              <Label>± tolerance</Label>
              <Input type="number" min={0} value={task.numericTolerance ?? 0} onChange={(e) => set({ numericTolerance: Math.max(0, parseFloat(e.target.value) || 0) })} />
            </div>
          </div>
        )}

        {task.type === 'sequence' && (
          <StepsEditor steps={task.steps ?? []} onChange={(steps) => set({ steps })} />
        )}
        {(task.type === 'smart_station' || task.type === 'photo') && (
          <div>
            <Label>Extended instructions (shown on the task screen)</Label>
            <Textarea
              value={task.smart?.longInstructions ?? ''}
              onChange={(e) => setSmart({ longInstructions: e.target.value })}
              placeholder="Optional step-by-step detail beyond the short description"
              rows={2}
            />
          </div>
        )}

        <div>
          <Label>Hint (optional, costs teams points to reveal)</Label>
          <Textarea
            value={task.hint ?? ''}
            onChange={(e) => set({ hint: e.target.value })}
            placeholder="A nudge stuck teams can unlock for a point cost"
            rows={2}
          />
        </div>
        {task.hint && (
          <div>
            <Label>Hint cost (points) <RichTooltip concept="hint" /></Label>
            <Input type="number" min={0} value={task.hintPenalty ?? 25}
              onChange={(e) => set({ hintPenalty: Math.max(0, parseInt(e.target.value) || 0) })} />
          </div>
        )}
      </Advanced>

      {onRemove && (
        <button onClick={onRemove} className="text-neon-red text-xs hover:underline pt-1">Delete task</button>
      )}
    </div>
  );
}

function StepsEditor({ steps, onChange }: { steps: TaskStep[]; onChange: (s: TaskStep[]) => void }) {
  const update = (i: number, p: Partial<TaskStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="space-y-2">
      <Label>Ordered steps: teams complete these in order at one stop</Label>
      {steps.map((s, i) => (
        <div key={s.id} className="flex gap-2 items-start">
          <span className="text-xs text-zinc-500 mt-2.5 w-3">{i + 1}</span>
          <div className="flex-1 space-y-1">
            <Input value={s.prompt} onChange={(e) => update(i, { prompt: e.target.value })} placeholder="Prompt / question" />
            <Input value={s.answer ?? ''} onChange={(e) => update(i, { answer: e.target.value })} placeholder="Answer (blank = tap to confirm)" />
          </div>
          <button className="text-neon-red text-sm mt-2.5" onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <Button variant="ghost" className="text-xs" onClick={() => onChange([...steps, { id: uuid(), prompt: '', answer: '' }])}>
        + Add step
      </Button>
    </div>
  );
}

// ── Step 3: Preview ──
function StepPreview({ game }: { game: Game }) {
  const taskCount = game.stages.reduce((s, st) => s + st.tasks.length, 0);
  const estMin = game.stages.flatMap((s) => s.tasks).reduce((s, t) => s + t.estimatedMinutes, 0);
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-xl font-bold">{game.title || 'Untitled'}</h2>
        <p className="text-zinc-500 text-sm">{game.description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>{game.mode}</Badge>
        <Badge color="green">{PRESET_LABELS[game.scoringPreset].en}</Badge>
        <Badge>{game.stages.length} stages</Badge>
        <Badge>{taskCount} tasks</Badge>
        <Badge>~{estMin} min</Badge>
      </div>
      <ol className="space-y-2">
        {game.stages.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-neon-green/15 text-neon-green text-xs flex items-center justify-center">{i + 1}</span>
            <span className="text-sm text-zinc-200">{s.title}</span>
            <span className="text-xs text-zinc-500">
              {s.tasks.length} task{s.tasks.length > 1 ? 's (routed)' : ''}
              {s.isFinal ? ' · 🏁 final' : ''}
            </span>
          </li>
        ))}
      </ol>

      <div>
        <Label>Route preview</Label>
        <Suspense fallback={<MapSkeleton className="h-64" />}>
          <RoutePreviewMap stages={game.stages} className="h-64" />
        </Suspense>
      </div>

      <p className="text-xs text-zinc-500">Launching creates an access code your friends use to join. First 2 participants are free.</p>
    </Card>
  );
}
