import { useEffect, useState } from 'react';
import { haversineKm } from '@rushpoint/shared';
import type { RunStageRecord } from '@rushpoint/shared';
import {
  completeTask, requestNextTask, verifyStationCode, submitStationPhoto,
  type MyTeamState, type SafeTask,
} from '../services/calls';
import { uploadTaskPhoto } from '../services/firebase';
import type { Session } from '../store';
import { Button, Card, Input } from '../components/ui';

export default function TaskRunner({ session, state, stage, onChanged }: {
  session: Session; state: MyTeamState; stage: RunStageRecord; onChanged: () => void;
}) {
  const ctx = { ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

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

  return (
    <Card className="p-5">
      <div className="text-xs text-accent uppercase tracking-widest mb-1">{stage.tasks.length > 1 ? 'Routed task' : 'Your task'}</div>
      <h2 className="text-xl font-bold mb-2">{task.title}</h2>
      {task.description && <p className="text-zinc-400 text-sm mb-3">{task.description}</p>}
      {task.smart?.longInstructions && <p className="text-zinc-400 text-sm mb-3">{task.smart.longInstructions}</p>}

      <DistanceBadge task={task} />

      <div className="mt-5">
        {task.type === 'field' || task.type === 'self_report' ? (
          <Button disabled={busy} onClick={field}>
            {task.type === 'self_report' ? 'Mark complete' : "I'm here"}
          </Button>
        ) : task.type === 'smart_station' ? (
          <CodeEntry busy={busy} label={task.smart?.codeInputLabel ?? 'Enter station code'} onSubmit={verify} />
        ) : (
          <PhotoEntry busy={busy} onSubmit={photo} />
        )}
      </div>

      {msg && <p className="text-center text-sm mt-3 text-zinc-300">{msg}</p>}
    </Card>
  );
}

function DistanceBadge({ task }: { task: SafeTask }) {
  const [dist, setDist] = useState<number | null>(null);
  const coords = task.smart?.stationCoords ?? task.coordinates;
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
