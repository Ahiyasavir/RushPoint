import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Game, Stage, Task, ScoringPreset, RegistrationField, GameMode, TaskType,
} from '@rushpoint/shared';
import { PRESET_LABELS } from '@rushpoint/shared';
import { getGame, updateGame, launchRun } from '../services/calls';
import { Advanced, Badge, Button, Card, Input, Label, Select, Spinner } from '../components/ui';
import { dialog } from '../components/dialog';
import LocationPicker from '../components/LocationPicker';
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

export default function BuilderPage() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const [game, setGame] = useState<Game | null>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    getGame({ gameId }).then(({ game }) => setGame(game));
  }, [gameId]);

  function patch(p: Partial<Game>) { setGame((g) => (g ? { ...g, ...p } : g)); }

  async function save() {
    if (!game) return;
    setSaving(true);
    try {
      await updateGame({
        gameId: game.id,
        title: game.title,
        description: game.description,
        mode: game.mode,
        stages: game.stages,
        scoringPreset: game.scoringPreset,
        registrationFields: game.registrationFields,
        tags: game.tags,
      });
    } finally { setSaving(false); }
  }

  async function saveAndLaunch() {
    if (!game) return;
    await save();
    if (game.stages.length === 0 || game.stages.some((s) => s.tasks.length === 0)) {
      await dialog.alert('Every stage needs at least one task.'); return;
    }
    try {
      const { runId } = await launchRun({ gameId: game.id });
      nav(`/run/${game.id}/${runId}`);
    } catch (e) { await dialog.alert(e instanceof Error ? e.message : 'Launch failed'); }
  }

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
            onClick={() => { save(); setStep(i + 1); }}
            className={`flex-1 px-3 py-2 rounded-lg text-sm border ${
              step === i + 1 ? 'border-neon-green/50 bg-neon-green/10 text-neon-green'
                             : 'border-glass-border text-zinc-500 hover:text-zinc-300'}`}
          >
            <span className="font-mono mr-2">{i + 1}</span>{label}
          </button>
        ))}
      </div>

      {step === 1 && <StepDetails game={game} patch={patch} />}
      {step === 2 && <StepStages game={game} setGame={setGame} />}
      {step === 3 && <StepPreview game={game} />}

      <div className="flex justify-between mt-6">
        <Button variant="ghost" disabled={step === 1} onClick={() => { save(); setStep(step - 1); }}>Back</Button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">{saving ? 'Saving…' : 'Saved'}</span>
          {step < 3
            ? <Button onClick={() => { save(); setStep(step + 1); }}>Next</Button>
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
function StepStages({ game, setGame }: { game: Game; setGame: (g: Game) => void }) {
  const [libraryFor, setLibraryFor] = useState<string | null>(null);
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

  return (
    <div className="space-y-4">
      {game.stages.map((stage, idx) => (
        <Card key={stage.id} className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Badge color="green">Stage {idx + 1}</Badge>
            <Input value={stage.title} onChange={(e) => updateStage(stage.id, { title: e.target.value })} className="flex-1" />
            {stage.tasks.length > 1 && <Badge color="cyan">routed pool</Badge>}
            {idx === game.stages.length - 1 && (
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                <input type="checkbox" checked={!!stage.isFinal}
                  onChange={(e) => updateStage(stage.id, { isFinal: e.target.checked })} />final
              </label>
            )}
            <button className="text-neon-red text-sm" onClick={() => removeStage(stage.id)}>✕</button>
          </div>

          <div className="space-y-2">
            {stage.tasks.map((task) => (
              <TaskEditor key={task.id} task={task}
                onChange={(t) => updateStage(stage.id, { tasks: stage.tasks.map((x) => (x.id === t.id ? t : x)) })}
                onRemove={stage.tasks.length > 1 ? () => updateStage(stage.id, { tasks: stage.tasks.filter((x) => x.id !== task.id) }) : undefined}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <Button variant="ghost" className="text-xs"
              onClick={() => updateStage(stage.id, { tasks: [...stage.tasks, blankTask()] })}>
              + Add another task (enables smart routing)
            </Button>
            <Button variant="ghost" className="text-xs" onClick={() => setLibraryFor(stage.id)}>
              ⌕ Insert from library
            </Button>
          </div>
        </Card>
      ))}
      <Button variant="subtle" onClick={addStage}>+ Add stage</Button>

      {libraryFor && (
        <TaskLibrary
          onInsert={(task) => insertFromLibrary(libraryFor, task)}
          onClose={() => setLibraryFor(null)}
        />
      )}
    </div>
  );
}

function TaskEditor({ task, onChange, onRemove }: { task: Task; onChange: (t: Task) => void; onRemove?: () => void }) {
  const [adv, setAdv] = useState(false);
  const set = (p: Partial<Task>) => onChange({ ...task, ...p });
  const setSmart = (p: Record<string, unknown>) =>
    onChange({ ...task, smart: { enabled: true, verificationType: task.smart?.verificationType ?? 'code_verification', ...task.smart, ...p } });

  return (
    <div className="border border-glass-border rounded-lg p-3 space-y-2">
      <div className="flex gap-2 items-center">
        <Input value={task.title} onChange={(e) => set({ title: e.target.value })} placeholder="Task title" className="flex-1" />
        {onRemove && <button className="text-neon-red text-sm" onClick={onRemove}>✕</button>}
      </div>

      <div>
        <Label>Location</Label>
        <LocationPicker
          lat={task.coordinates.lat}
          lng={task.coordinates.lng}
          onChange={(lat, lng) => set({ coordinates: { lat, lng } })}
          className="h-44"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Lat</Label>
          <Input type="number" value={task.coordinates.lat || ''} onChange={(e) => set({ coordinates: { ...task.coordinates, lat: parseFloat(e.target.value) || 0 } })} />
        </div>
        <div>
          <Label>Lng</Label>
          <Input type="number" value={task.coordinates.lng || ''} onChange={(e) => set({ coordinates: { ...task.coordinates, lng: parseFloat(e.target.value) || 0 } })} />
        </div>
        <div>
          <Label>Difficulty 1–10</Label>
          <Input type="number" min={1} max={10} value={task.difficulty} onChange={(e) => set({ difficulty: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })} />
        </div>
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
      </Advanced>
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
      <p className="text-xs text-zinc-500">Launching creates an access code your friends use to join. First 2 participants are free.</p>
    </Card>
  );
}
