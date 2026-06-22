import { useEffect, useRef, useState } from 'react';
import { haversineKm } from '@rushpoint/shared';
import type { RunStageRecord } from '@rushpoint/shared';
import {
  completeTask, requestNextTask, verifyStationCode, submitStationPhoto, requestTaskHint,
  submitTaskAnswer, submitSequenceStep,
  type MyTeamState, type SafeTask,
} from '../services/calls';
import { uploadTaskPhoto } from '../services/firebase';
import type { Session } from '../store';
import { Button, Card, Input, Progress } from '../components/ui';
import { dialog } from '../components/dialog';

export default function TaskRunner({ session, state, stage, onChanged }: {
  session: Session; state: MyTeamState; stage: RunStageRecord; onChanged: () => void;
}) {
  const ctx = { ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  // The task currently assigned to this team within the active stage.
  const assignedRec = stage.tasks.find((t) => t.status === 'assigned');
  const unassigned  = stage.tasks.filter((t) => t.status === 'unassigned');

  // If multi-task stage and nothing assigned yet, request a routing decision once.
  useEffect(() => {
    if (!assignedRec && unassigned.length > 0) {
      withLocation((lat, lng) => requestNextTask({ ...ctx, lat, lng }).then(onChanged));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedRec, unassigned.length]);

  const task: SafeTask | undefined = assignedRec
    ? state.activeStageTasks.find((t) => t.id === assignedRec.taskId)
    : undefined;

  // Clear a revealed hint / message when the assigned task changes.
  useEffect(() => { setHint(null); setMsg(''); }, [assignedRec?.taskId]);

  if (!task) {
    return <Card className="p-6 text-center text-zinc-500">Finding your next task…</Card>;
  }

  async function field() {
    setBusy(true); setMsg('');
    withLocation(async (lat, lng) => {
      try { await completeTask({ ...ctx, taskId: task!.id, lat, lng }); onChanged(); }
      catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
      finally { setBusy(false); }
    });
  }

  async function verify(code: string) {
    setBusy(true); setMsg('');
    try {
      await verifyStationCode({ ...ctx, teamId: state.team.id, taskId: task!.id, code });
      onChanged();
    } catch {
      setMsg('Wrong code — try again.');
    } finally { setBusy(false); }
  }

  // Accepts a picked File (uploaded to Storage) or a pasted URL.
  async function photo(input: File | string) {
    setBusy(true); setMsg('');
    try {
      let url: string;
      if (typeof input === 'string') {
        url = input;
      } else {
        setMsg('Uploading photo…');
        url = await uploadTaskPhoto(input, { runId: session.runId, teamId: state.team.id, taskId: task!.id });
      }
      const res = await submitStationPhoto({ ...ctx, teamId: state.team.id, taskId: task!.id, photoUrl: url });
      setMsg(res.autoApproved ? 'Approved!' : 'Submitted — waiting for review.');
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally { setBusy(false); }
  }

  // quiz / numeric — submit a typed or chosen answer
  async function answer(text: string) {
    setBusy(true); setMsg('');
    try {
      const res = await submitTaskAnswer({ ...ctx, taskId: task!.id, answer: text });
      if (res.correct) onChanged();
      else setMsg('Not quite — try again.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  // sequence — submit the current ordered step
  async function sequenceStep(stepIndex: number, ans: string) {
    setBusy(true); setMsg('');
    try {
      const res = await submitSequenceStep({ ...ctx, taskId: task!.id, stepIndex, answer: ans || undefined });
      if (res.stepCorrect) { onChanged(); if (!res.taskComplete) setMsg(`Step ${res.stepsDone} of ${res.totalSteps} ✓`); }
      else setMsg('Not quite — try again.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  // geofence — auto check-in once the watcher reports we're inside the radius
  function geofenceArrive(la: number, ln: number) {
    setBusy(true); setMsg('');
    completeTask({ ...ctx, taskId: task!.id, lat: la, lng: ln })
      .then(() => onChanged())
      .catch((e) => setMsg(e instanceof Error ? e.message : 'Check-in failed'))
      .finally(() => setBusy(false));
  }

  async function revealHint() {
    if (hint) return;
    const cost = task!.hintPenalty ?? 25;
    if (!(await dialog.confirm(`Reveal a hint for this task? It costs ${cost} points.`, { confirmLabel: 'Reveal hint' }))) return;
    setBusy(true);
    try {
      const res = await requestTaskHint({ ...ctx, taskId: task!.id });
      setHint(res.hint);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No hint available');
    } finally { setBusy(false); }
  }

  // Partial stages ("complete N of M") show progress so the team knows how many
  // stops remain; full multi-task stages just say "routed task".
  const requiredHere = stage.requiredTaskCount ?? stage.tasks.length;
  const completedHere = stage.tasks.filter((t) => t.status === 'completed').length;
  const headerLabel = stage.tasks.length > 1
    ? (requiredHere < stage.tasks.length ? `Stop ${completedHere + 1} of ${requiredHere}` : 'Routed task')
    : 'Your task';

  return (
    <Card className="p-5">
      <div className="text-xs text-accent uppercase tracking-widest mb-1">{headerLabel}</div>
      <h2 dir="auto" className="text-xl font-bold mb-2">{task.title}</h2>
      {task.description && <p dir="auto" className="text-zinc-400 text-sm mb-3">{task.description}</p>}
      {task.smart?.longInstructions && <p dir="auto" className="text-zinc-400 text-sm mb-3">{task.smart.longInstructions}</p>}

      <DistanceBadge task={task} />

      <div className="mt-5">
        {task.type === 'field' || task.type === 'self_report' ? (
          <Button disabled={busy} onClick={field}>
            {task.type === 'self_report' ? 'Mark complete' : "I'm here"}
          </Button>
        ) : task.type === 'smart_station' ? (
          <CodeEntry busy={busy} label={task.smart?.codeInputLabel ?? 'Enter station code'} onSubmit={verify} />
        ) : task.type === 'quiz' ? (
          <QuizEntry task={task} busy={busy} onSubmit={answer} />
        ) : task.type === 'numeric' ? (
          <NumericEntry busy={busy} onSubmit={answer} />
        ) : task.type === 'geofence' ? (
          <GeofenceAuto task={task} onArrive={geofenceArrive} />
        ) : task.type === 'sequence' ? (
          <SequenceRunner task={task} stepsDone={state.team.taskStepProgress?.[task.id] ?? 0} busy={busy} onSubmit={sequenceStep} />
        ) : (
          <PhotoEntry busy={busy} onSubmit={photo} />
        )}
      </div>

      {task.hasHint && (
        <div className="mt-3">
          {hint
            ? <p dir="auto" className="text-sm text-zinc-700 bg-app-raised rounded-lg px-3 py-2">💡 {hint}</p>
            : <button onClick={revealHint} disabled={busy} className="text-xs text-accent-warm hover:underline disabled:opacity-40">
                💡 Stuck? Reveal a hint (−{task.hintPenalty ?? 25} pts)
              </button>}
        </div>
      )}

      {msg && <p className="text-center text-sm mt-3 text-zinc-300">{msg}</p>}
    </Card>
  );
}

function DistanceBadge({ task }: { task: SafeTask }) {
  const [dist, setDist] = useState<number | null>(null);
  const coords = task.locationless ? undefined : (task.smart?.stationCoords ?? task.coordinates);
  useEffect(() => {
    if (!coords || (!coords.lat && !coords.lng)) return;
    navigator.geolocation?.getCurrentPosition((p) => {
      setDist(haversineKm({ lat: p.coords.latitude, lng: p.coords.longitude }, coords));
    });
  }, [coords]);
  if (dist == null) return null;
  return (
    <div className="text-xs text-zinc-500">
      📍 {dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`}
    </div>
  );
}

function CodeEntry({ busy, label, onSubmit }: { busy: boolean; label: string; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <div className="space-y-3">
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={label}
        className="text-center font-mono tracking-widest" />
      <Button disabled={busy || !code} onClick={() => onSubmit(code)}>Verify</Button>
    </div>
  );
}

// Quiz — tap a choice, or type a free-text answer.
function QuizEntry({ task, busy, onSubmit }: { task: SafeTask; busy: boolean; onSubmit: (a: string) => void }) {
  const [val, setVal] = useState('');
  if (task.choices && task.choices.length > 0) {
    return (
      <div className="space-y-2">
        {task.choices.map((c) => (
          <Button key={c} variant="ghost" disabled={busy} onClick={() => onSubmit(c)} className="w-full">
            <span dir="auto">{c}</span>
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Input value={val} dir="auto" onChange={(e) => setVal(e.target.value)} placeholder="Your answer"
        onKeyDown={(e) => e.key === 'Enter' && val && onSubmit(val)} />
      <Button disabled={busy || !val} onClick={() => onSubmit(val)}>Submit answer</Button>
    </div>
  );
}

// Numeric — enter a number (server checks within tolerance).
function NumericEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (a: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div className="space-y-3">
      <Input type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Enter a number"
        className="text-center text-xl font-mono"
        onKeyDown={(e) => e.key === 'Enter' && val !== '' && onSubmit(val)} />
      <Button disabled={busy || val === ''} onClick={() => onSubmit(val)}>Submit</Button>
    </div>
  );
}

// Geofence — watch position, auto-check-in once inside the radius.
function GeofenceAuto({ task, onArrive }: { task: SafeTask; onArrive: (lat: number, lng: number) => void }) {
  const [dist, setDist] = useState<number | null>(null);
  const fired = useRef(false);
  const radius = task.geofenceRadiusMeters ?? 50;
  const coords = task.coordinates;
  useEffect(() => {
    if (!navigator.geolocation || !coords) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const d = haversineKm({ lat: p.coords.latitude, lng: p.coords.longitude }, coords) * 1000;
        setDist(d);
        if (d <= radius && !fired.current) { fired.current = true; onArrive(p.coords.latitude, p.coords.longitude); }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="text-center py-2">
      <div className="text-3xl mb-2">📡</div>
      {dist == null
        ? <p className="text-sm text-zinc-500">Finding your location…</p>
        : dist <= radius
          ? <p className="text-sm text-accent font-medium">You&apos;re here — checking in…</p>
          : <p className="text-sm text-zinc-500">{Math.round(dist)} m away — walk closer to auto-check-in (within {radius} m).</p>}
    </div>
  );
}

// Sequence — one ordered step at a time, with progress.
function SequenceRunner({ task, stepsDone, busy, onSubmit }: {
  task: SafeTask; stepsDone: number; busy: boolean; onSubmit: (stepIndex: number, ans: string) => void;
}) {
  const steps = task.steps ?? [];
  const [val, setVal] = useState('');
  const idx = Math.min(stepsDone, steps.length - 1);
  const step = steps[idx];
  if (!step) return null;
  return (
    <div className="space-y-3">
      <Progress done={stepsDone} total={steps.length} />
      <div className="text-xs text-zinc-500">Step {idx + 1} of {steps.length}</div>
      <p dir="auto" className="text-sm text-zinc-700">{step.prompt}</p>
      <Input value={val} dir="auto" onChange={(e) => setVal(e.target.value)} placeholder="Answer (or leave blank to confirm)"
        onKeyDown={(e) => e.key === 'Enter' && onSubmit(idx, val)} />
      <Button disabled={busy} onClick={() => { onSubmit(idx, val); setVal(''); }}>Submit step</Button>
    </div>
  );
}

function PhotoEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (input: File | string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
    if (f) setUrl(''); // a picked file takes precedence over a pasted URL
  }

  const canSubmit = !busy && (!!file || !!url.trim());
  return (
    <div className="space-y-3">
      <input type="file" accept="image/*" capture="environment" onChange={pickFile}
        className="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-app-raised file:text-zinc-200" />
      {preview && <img src={preview} alt="preview" className="w-full rounded-lg max-h-56 object-cover" />}
      <Input value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) { setFile(null); setPreview(null); } }}
        placeholder="…or paste a photo URL" />
      <Button disabled={!canSubmit} onClick={() => onSubmit(file ?? url.trim())}>
        {busy ? 'Working…' : 'Submit photo'}
      </Button>
    </div>
  );
}

// Helper: get location then call cb (falls back to 0,0 if denied).
function withLocation(cb: (lat: number, lng: number) => void) {
  if (!navigator.geolocation) { cb(0, 0); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => cb(p.coords.latitude, p.coords.longitude),
    () => cb(0, 0),
    { enableHighAccuracy: true, timeout: 5000 },
  );
}
