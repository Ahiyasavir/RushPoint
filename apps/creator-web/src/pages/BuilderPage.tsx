import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Game, Stage, Task, TaskStep, ScoringPreset, RegistrationField, GameMode, TaskType,
} from '@rushpoint/shared';
import { PRESET_LABELS, PAYMENTS_ENABLED } from '@rushpoint/shared';
import { getGame, updateGame, launchRun } from '../services/calls';
import { Advanced, Badge, Button, Card, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { dialog } from '../components/dialog';
import LocationPicker from '../components/LocationPicker';
import RoutePreviewMap from '../components/RoutePreviewMap';
import TaskLibrary from '../components/TaskLibrary';

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

export default function BuilderPage() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const [game, setGame] = useState<Game | null>(null);
  const [step, setStep] = useState(1);
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
      {/* breadcrumb + wizard nav */}
      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
        <button onClick={() => nav('/')} className="hover:text-zinc-300">My Games</button>
        <span>/</span><span className="text-zinc-300">{game.title || 'Untitled'}</span>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {['Details', 'Stages & Tasks', 'Preview & Launch'].map((label, i) => (
          <button
            key={label}
            onClick={() => { void save(); setStep(i + 1); }}
            className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
              step === i + 1
                ? 'bg-gradient-to-r from-rp-fire to-rp-amber text-white shadow-[0_2px_12px_rgba(255,87,34,0.35)]'
                : 'border border-[--rp-border] text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2]'}`}
          >
            <span className={`font-mono mr-2 ${step === i + 1 ? 'opacity-80' : ''}`}>{i + 1}</span>{label}
          </button>
        ))}
      </div>

      {step === 1 && <StepDetails game={game} patch={patch} />}
      {step === 2 && <StepStages game={game} setGame={setGame} />}
      {step === 3 && <StepPreview game={game} />}

      <div className="flex justify-between mt-6">
        <Button variant="ghost" disabled={step === 1} onClick={() => { void save(); setStep(step - 1); }}>Back</Button>
        <div className="flex items-center gap-3">
          <span className="text-xs flex items-center gap-1.5 text-zinc-500">
            <span className={`w-1.5 h-1.5 rounded-full ${
              status === 'saving' ? 'bg-rp-amber animate-pulse'
                : status === 'unsaved' ? 'bg-rp-amber'
                : 'bg-rp-go'}`} />
            {status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved changes' : 'All changes saved'}
          </span>
          {step < 3
            ? <Button onClick={() => { void save(); setStep(step + 1); }}>Next</Button>
            : <Button onClick={saveAndLaunch}>Save &amp; Launch run</Button>}
        </div>
      </div>
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
        <Label>Game title</Label>
        <Input value={game.title} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Old City Treasure Hunt" />
      </div>
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
const TASK_ICON: Record<TaskType, string> = {
  field: '📍', self_report: '✅', smart_station: '🔢', photo: '📷',
  quiz: '❓', numeric: '#️⃣', geofence: '📡', sequence: '🧩',
};

function taskIcon(task: Task): string {
  if (task.locationless) return '🌐';
  return TASK_ICON[task.type] ?? '📍';
}

// Compact, clickable task chip — the core of the at-a-glance stage editor.
function TaskTile({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-32 h-24 shrink-0 rounded-xl border border-glass-border bg-app-bg p-2.5 text-start
                 flex flex-col gap-1 hover:border-neon-green/50 hover:bg-glass-hover transition"
    >
      <span className="text-lg leading-none">{taskIcon(task)}</span>
      <span className="text-xs font-medium text-zinc-100 line-clamp-2 flex-1">{task.title || 'Untitled task'}</span>
      <span className="text-[10px] text-zinc-500">{task.locationless ? 'anywhere' : `★ ${task.difficulty}`}</span>
    </button>
  );
}

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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-card border border-glass-border rounded-2xl w-full max-w-md max-h-[88vh] overflow-y-auto p-4 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StepStages({ game, setGame }: { game: Game; setGame: (g: Game) => void }) {
  const [libraryFor, setLibraryFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ stageId: string; taskId: string } | null>(null);
  function setStages(stages: Stage[]) { setGame({ ...game, stages }); }
  function addStage() { setStages([...game.stages, blankStage(game.stages.length)]); }
  function updateStage(id: string, p: Partial<Stage>) {
    setStages(game.stages.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }
  function removeStage(id: string) {
    setStages(game.stages.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })));
  }
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

  return (
    <div className="space-y-4">
      {game.stages.map((stage, idx) => {
        const m = stage.tasks.length;
        const req = stage.requiredTaskCount ?? m;
        return (
          <Card key={stage.id} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Badge color="green">Stage {idx + 1}</Badge>
              <Input value={stage.title} onChange={(e) => updateStage(stage.id, { title: e.target.value })} className="flex-1" />
              {idx === game.stages.length - 1 && (
                <label className="flex items-center gap-1 text-xs text-zinc-400 shrink-0">
                  <input type="checkbox" checked={!!stage.isFinal}
                    onChange={(e) => updateStage(stage.id, { isFinal: e.target.checked })} />final
                </label>
              )}
              {game.stages.length > 1 && (
                <button className="text-neon-red text-sm shrink-0" onClick={() => removeStage(stage.id)}>✕</button>
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
                    updateStage(stage.id, { requiredTaskCount: n >= m ? undefined : n });
                  }}
                >
                  {Array.from({ length: m }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
                <span>of {m} tasks{req < m ? ', routed to best-suited ones' : ' (all of them)'}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {stage.tasks.map((task) => (
                <TaskTile key={task.id} task={task} onClick={() => setEditing({ stageId: stage.id, taskId: task.id })} />
              ))}
              <AddTile label="Add task" onClick={() => addTask(stage.id)} />
              <AddTile label="From library" onClick={() => setLibraryFor(stage.id)} />
            </div>
          </Card>
        );
      })}
      <Button variant="subtle" onClick={addStage}>+ Add stage</Button>

      {libraryFor && (
        <TaskLibrary
          onInsert={(task) => insertFromLibrary(libraryFor, task)}
          onClose={() => setLibraryFor(null)}
        />
      )}

      {editing && editingStage && editingTask && (
        <Modal title="Edit task" onClose={() => setEditing(null)}>
          <TaskEditor
            task={editingTask}
            onChange={(t) => updateStage(editingStage.id, { tasks: editingStage.tasks.map((x) => (x.id === t.id ? t : x)) })}
            onRemove={editingStage.tasks.length > 1
              ? () => { updateStage(editingStage.id, { tasks: editingStage.tasks.filter((x) => x.id !== editingTask.id) }); setEditing(null); }
              : undefined}
          />
          <Button className="w-full mt-3" onClick={() => setEditing(null)}>Done</Button>
        </Modal>
      )}
    </div>
  );
}

function TaskEditor({ task, onChange, onRemove }: { task: Task; onChange: (t: Task) => void; onRemove?: () => void }) {
  const [adv, setAdv] = useState(false);
  const set = (p: Partial<Task>) => onChange({ ...task, ...p });
  const setSmart = (p: Record<string, unknown>) =>
    onChange({ ...task, smart: { enabled: true, verificationType: task.smart?.verificationType ?? 'code_verification', ...task.smart, ...p } });

  const located = !task.locationless;
  return (
    <div className="space-y-2">
      <Input value={task.title} onChange={(e) => set({ title: e.target.value })} placeholder="Task title" />

      <Textarea
        value={task.description ?? ''}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="What participants see: the clue or instructions for this task"
        rows={2}
      />

      <label className="flex items-center gap-2 text-sm text-zinc-300 py-1">
        <input type="checkbox" checked={located}
          onChange={(e) => set({ locationless: !e.target.checked })} />
        Has a specific map location
      </label>

      {located ? (
        <>
          <LocationPicker
            lat={task.coordinates.lat}
            lng={task.coordinates.lng}
            onChange={(lat, lng) => set({ coordinates: { lat, lng } })}
            className="h-44"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Lat</Label>
              <Input type="number" value={task.coordinates.lat || ''} onChange={(e) => set({ coordinates: { ...task.coordinates, lat: parseFloat(e.target.value) || 0 } })} />
            </div>
            <div>
              <Label>Lng</Label>
              <Input type="number" value={task.coordinates.lng || ''} onChange={(e) => set({ coordinates: { ...task.coordinates, lng: parseFloat(e.target.value) || 0 } })} />
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-zinc-500 bg-app-raised rounded-lg px-3 py-2">
          🌐 General task. Teams can do this from anywhere, no map pin or travel distance.
        </p>
      )}

      <div>
        <Label>Difficulty 1 to 10</Label>
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
            <Label>Max teams at once</Label>
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
          <>
            <div>
              <Label>Choices, one per line (leave empty for a typed answer)</Label>
              <Textarea
                value={(task.choices ?? []).join('\n')}
                onChange={(e) => set({ choices: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                placeholder={'Paris\nLondon\nRome'}
                rows={3}
              />
            </div>
            <div>
              <Label>Accepted answers, one per line, case-insensitive</Label>
              <Textarea
                value={(task.answers ?? []).join('\n')}
                onChange={(e) => set({ answers: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                placeholder={'Paris'}
                rows={2}
              />
            </div>
          </>
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

        {task.type === 'geofence' && (
          <div>
            <Label>Auto-check-in radius (meters)</Label>
            <Input type="number" min={5} value={task.geofenceRadiusMeters ?? 50} onChange={(e) => set({ geofenceRadiusMeters: Math.max(5, parseInt(e.target.value) || 50) })} />
            <p className="text-[11px] text-zinc-500 mt-1">Teams check in automatically within this distance of the pin above.</p>
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
            <Label>Hint cost (points)</Label>
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
        <RoutePreviewMap stages={game.stages} className="h-64" />
      </div>

      <p className="text-xs text-zinc-500">Launching creates an access code your friends use to join. First 2 participants are free.</p>
    </Card>
  );
}
