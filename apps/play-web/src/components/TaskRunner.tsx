import { useEffect, useMemo, useRef, useState } from 'react';
import { haversineKm } from '@rushpoint/shared';
import type { RunStageRecord, TaskMedia } from '@rushpoint/shared';
import {
  completeTask, requestNextTask, verifyStationCode, submitStationPhoto, requestTaskHint,
  submitTaskAnswer, submitSequenceStep,
  type MyTeamState, type SafeTask,
} from '../services/calls';
import { uploadTaskPhoto } from '../services/firebase';
import { withLocation } from '../utils/withLocation';
import { useT } from '../i18nContext';
import type { Session } from '../store';
import { Button, Card, Input, Progress } from '../components/ui';
import { dialog } from '../components/dialog';

// Creator-authored task media (change: task-media-attachments): images render as
// <img>, uploaded videos as inline <video controls>, YouTube as a lazy iframe embed
// (the url is the canonical /embed/<id> form, validated server-side). Captions use
// dir="auto" so Hebrew/English both render correctly. Rendered only when non-empty.
function TaskMediaGallery({ media }: { media: TaskMedia[] }) {
  return (
    <div className="space-y-2 mb-3">
      {media.map((m) => (
        <figure key={m.id} className="m-0">
          {m.kind === 'image' ? (
            <img src={m.url} alt={m.caption ?? ''} loading="lazy"
              className="w-full rounded-lg border border-glass-border" />
          ) : m.kind === 'video' ? (
            <video src={m.url} controls preload="metadata"
              className="w-full rounded-lg border border-glass-border" />
          ) : (
            <div className="relative w-full rounded-lg overflow-hidden border border-glass-border" style={{ aspectRatio: '16 / 9' }}>
              <iframe src={m.url} title={m.caption ?? 'YouTube'} loading="lazy"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen className="absolute inset-0 w-full h-full" />
            </div>
          )}
          {m.caption && <figcaption dir="auto" className="text-xs text-zinc-500 mt-1">{m.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

export default function TaskRunner({ session, state, stage, onChanged, readOnly = false }: {
  session: Session; state: MyTeamState; stage: RunStageRecord; onChanged: () => void;
  // Shared team devices: viewer phones render the task read-only — inputs and
  // submits disabled (the server also rejects them; this is the friendly layer).
  readOnly?: boolean;
}) {
  const { t } = useT();
  const ctx = useMemo(
    () => ({ ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId }),
    [session.ownerUid, session.gameId, session.runId],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [routingError, setRoutingError] = useState(false);
  const [routingAttempt, setRoutingAttempt] = useState(0);

  // The task currently assigned to this team within the active stage.
  const assignedRec = stage.tasks.find((t) => t.status === 'assigned');
  const unassigned  = stage.tasks.filter((t) => t.status === 'unassigned');

  // If multi-task stage and nothing assigned yet, request a routing decision once.
  // A failed request surfaces a retryable error instead of an infinite spinner.
  // Viewer phones never request routing — the controller drives assignment and
  // the team-doc snapshot brings the result here.
  useEffect(() => {
    if (readOnly) return;
    if (!assignedRec && unassigned.length > 0) {
      setRoutingError(false);
      withLocation(
        (lat, lng) => requestNextTask({ ...ctx, lat, lng }).then(onChanged).catch(() => setRoutingError(true)),
        () => setRoutingError(true),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedRec, unassigned.length, routingAttempt, readOnly]);

  const task: SafeTask | undefined = assignedRec
    ? state.activeStageTasks.find((t) => t.id === assignedRec.taskId)
    : undefined;

  // Clear a revealed hint / message when the assigned task changes.
  useEffect(() => { setHint(null); setMsg(''); }, [assignedRec?.taskId]);

  // Every interactive element freezes for viewers; a submission that loses a
  // race with a mid-flight control transfer maps to a friendly localized message.
  const frozen = busy || readOnly;
  function submitError(e: unknown, fallback: string): string {
    if (e instanceof Error && e.message.includes('not-controller')) return t.devices.controlMoved;
    return e instanceof Error ? e.message : fallback;
  }

  if (!task) {
    if (routingError) {
      return (
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm text-rp-alert">{t.task.routingError}</p>
          <Button onClick={() => { setRoutingError(false); setRoutingAttempt((n) => n + 1); }}>
            {t.task.retryRouting}
          </Button>
        </Card>
      );
    }
    return <Card className="p-6 text-center text-zinc-500">{t.task.routing}</Card>;
  }

  async function field() {
    setBusy(true); setMsg('');
    withLocation(
      async (lat, lng) => {
        try { await completeTask({ ...ctx, taskId: task!.id, lat, lng }); onChanged(); }
        catch (e) { setMsg(submitError(e, t.task.failed)); }
        finally { setBusy(false); }
      },
      () => { setMsg(t.task.gpsWarning); setBusy(false); },
    );
  }

  async function verify(code: string) {
    setBusy(true); setMsg('');
    try {
      await verifyStationCode({ ...ctx, teamId: state.team.id, taskId: task!.id, code });
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error && e.message.includes('not-controller') ? t.devices.controlMoved : t.task.wrongCode);
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
        setMsg(t.task.uploadingPhoto);
        url = await uploadTaskPhoto(input, { runId: session.runId, teamId: state.team.id, taskId: task!.id });
      }
      const res = await submitStationPhoto({ ...ctx, teamId: state.team.id, taskId: task!.id, photoUrl: url });
      setMsg(res.autoApproved ? t.task.approved : t.task.pendingReview);
      onChanged();
    } catch (e) {
      setMsg(submitError(e, t.task.uploadFailed));
    } finally { setBusy(false); }
  }

  // quiz / numeric — submit a typed or chosen answer
  async function answer(text: string) {
    setBusy(true); setMsg('');
    try {
      const res = await submitTaskAnswer({ ...ctx, taskId: task!.id, answer: text });
      if (res.correct) onChanged();
      else setMsg(t.task.notQuite);
    } catch (e) {
      setMsg(submitError(e, t.task.failed));
    } finally { setBusy(false); }
  }

  // sequence — submit the current ordered step. Returns whether the step was
  // accepted so the input is cleared only on success (P3).
  async function sequenceStep(stepIndex: number, ans: string): Promise<boolean> {
    setBusy(true); setMsg('');
    try {
      const res = await submitSequenceStep({ ...ctx, taskId: task!.id, stepIndex, answer: ans || undefined });
      if (res.stepCorrect) { onChanged(); if (!res.taskComplete) setMsg(`${t.task.stepOf({ step: res.stepsDone, total: res.totalSteps })} ✓`); }
      else setMsg(t.task.notQuite);
      return res.stepCorrect;
    } catch (e) {
      setMsg(submitError(e, t.task.failed));
      return false;
    } finally { setBusy(false); }
  }

  // geofence — auto check-in once the watcher reports we're inside the radius.
  // Viewer phones never auto-fire: the controller's arrival completes the task.
  function geofenceArrive(la: number, ln: number) {
    if (readOnly) return;
    setBusy(true); setMsg('');
    completeTask({ ...ctx, taskId: task!.id, lat: la, lng: ln })
      .then(() => onChanged())
      .catch((e) => setMsg(submitError(e, t.task.checkinFailed)))
      .finally(() => setBusy(false));
  }

  async function revealHint() {
    if (hint) return;
    const cost = task!.hintPenalty ?? 25;
    if (!(await dialog.confirm(t.task.hintConfirm({ cost }), { confirmLabel: t.task.hintConfirmBtn }))) return;
    setBusy(true);
    try {
      const res = await requestTaskHint({ ...ctx, taskId: task!.id });
      setHint(res.hint);
    } catch (e) {
      setMsg(submitError(e, t.task.noHint));
    } finally { setBusy(false); }
  }

  // Partial stages ("complete N of M") show progress so the team knows how many
  // stops remain; full multi-task stages just say "routed task".
  const requiredHere = stage.requiredTaskCount ?? stage.tasks.length;
  const completedHere = stage.tasks.filter((t) => t.status === 'completed').length;
  const headerLabel = stage.tasks.length > 1
    ? (requiredHere < stage.tasks.length ? t.task.stopOf({ done: completedHere + 1, total: requiredHere }) : t.task.routedTask)
    : t.task.yourTask;

  return (
    <Card className="p-5">
      <div className="text-xs text-accent uppercase tracking-widest mb-1">{headerLabel}</div>
      <h2 dir="auto" className="text-xl font-bold mb-2">{task.title}</h2>
      {task.description && <p dir="auto" className="text-zinc-400 text-sm mb-3">{task.description}</p>}
      {task.media && task.media.length > 0 && <TaskMediaGallery media={task.media} />}
      {task.smart?.longInstructions && <p dir="auto" className="text-zinc-400 text-sm mb-3">{task.smart.longInstructions}</p>}

      {task.locationHidden ? (
        // Treasure-hunt task: no pin, no distance — only the clue guides the player.
        <div className="rounded-lg bg-app-raised border border-glass-border px-3 py-2.5 mb-1">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-warm mb-1">
            🧭 {t.task.hiddenBadge}
          </div>
          {(task.locationClueHe || task.locationClue) && (
            <p dir="auto" className="text-sm text-zinc-200">{task.locationClueHe || task.locationClue}</p>
          )}
          <p className="text-[11px] text-zinc-500 mt-1">{t.task.hiddenHelp}</p>
        </div>
      ) : (
        <DistanceBadge task={task} />
      )}

      <div className={readOnly ? 'mt-5 pointer-events-none opacity-60' : 'mt-5'} aria-disabled={readOnly}>
        {task.type === 'field' || task.type === 'self_report' ? (
          <Button disabled={frozen} onClick={field}>
            {task.type === 'self_report'
              ? t.task.markComplete
              : task.locationHidden ? t.task.hiddenCheckIn : t.task.imHere}
          </Button>
        ) : task.type === 'smart_station' ? (
          <CodeEntry busy={frozen} label={task.smart?.codeInputLabel ?? t.task.enterStationCode} onSubmit={verify} />
        ) : task.type === 'quiz' ? (
          <QuizEntry task={task} busy={frozen} onSubmit={answer} />
        ) : task.type === 'numeric' ? (
          <NumericEntry busy={frozen} onSubmit={answer} />
        ) : task.type === 'geofence' ? (
          <GeofenceAuto task={task} onArrive={geofenceArrive} />
        ) : task.type === 'sequence' ? (
          <SequenceRunner task={task} stepsDone={state.team.taskStepProgress?.[task.id] ?? 0} busy={frozen} onSubmit={sequenceStep} />
        ) : (
          <PhotoEntry busy={frozen} onSubmit={photo} />
        )}
      </div>

      {task.hasHint && (
        <div className="mt-3">
          {hint
            ? <p dir="auto" className="text-sm text-zinc-200 bg-app-raised rounded-lg px-3 py-2">💡 {hint}</p>
            : <button onClick={revealHint} disabled={frozen} aria-label={t.task.hintStuck({ cost: task.hintPenalty ?? 0 })} className="text-xs text-accent-warm hover:underline disabled:opacity-40">
                💡 {t.task.hintStuck({ cost: task.hintPenalty ?? 25 })}
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
    if (!navigator.geolocation || !coords
      || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)
      || (!coords.lat && !coords.lng)) return;
    // Live watch so the badge updates as the participant walks toward the task.
    const id = navigator.geolocation.watchPosition((p) => {
      setDist(haversineKm({ lat: p.coords.latitude, lng: p.coords.longitude }, coords));
    });
    return () => navigator.geolocation.clearWatch(id);
  }, [coords]);
  if (dist == null) return null;
  return (
    <div className="text-xs text-zinc-500">
      📍 {dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`}
    </div>
  );
}

function CodeEntry({ busy, label, onSubmit }: { busy: boolean; label: string; onSubmit: (code: string) => void }) {
  const { t } = useT();
  const [code, setCode] = useState('');
  return (
    <div className="space-y-3">
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={label}
        className="text-center font-mono tracking-widest" />
      <Button disabled={busy || !code} onClick={() => onSubmit(code)}>{t.task.verify}</Button>
    </div>
  );
}

// Quiz — tap a choice, or type a free-text answer.
function QuizEntry({ task, busy, onSubmit }: { task: SafeTask; busy: boolean; onSubmit: (a: string) => void }) {
  const { t } = useT();
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
      <Input value={val} dir="auto" onChange={(e) => setVal(e.target.value)} placeholder={t.task.yourAnswer}
        onKeyDown={(e) => e.key === 'Enter' && val.trim() && onSubmit(val.trim())} />
      <Button disabled={busy || !val.trim()} onClick={() => onSubmit(val.trim())}>{t.task.submitAnswer}</Button>
    </div>
  );
}

// Numeric — enter a number (server checks within tolerance).
function NumericEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (a: string) => void }) {
  const { t } = useT();
  const [val, setVal] = useState('');
  return (
    <div className="space-y-3">
      <Input type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder={t.task.enterNumber}
        className="text-center text-xl font-mono"
        onKeyDown={(e) => e.key === 'Enter' && val !== '' && onSubmit(val)} />
      <Button disabled={busy || val === ''} onClick={() => onSubmit(val)}>{t.task.submit}</Button>
    </div>
  );
}

// Geofence — watch position, auto-check-in once inside the radius.
function GeofenceAuto({ task, onArrive }: { task: SafeTask; onArrive: (lat: number, lng: number) => void }) {
  const { t } = useT();
  const [dist, setDist] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState(false);
  const fired = useRef(false);
  const radius = task.geofenceRadiusMeters ?? 50;
  const coords = task.coordinates;
  useEffect(() => {
    if (!navigator.geolocation || !coords) { setGpsError(true); return; }
    // Reset per task: if this component instance is reused for a different
    // geofence task, the previous task's "already fired" latch must not block
    // the new one (otherwise a transferred/next geofence never auto-checks-in).
    fired.current = false;
    setGpsError(false);
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const d = haversineKm({ lat: p.coords.latitude, lng: p.coords.longitude }, coords) * 1000;
        setDist(d);
        if (d <= radius && !fired.current) { fired.current = true; onArrive(p.coords.latitude, p.coords.longitude); }
      },
      () => { setGpsError(true); navigator.geolocation.clearWatch(id); },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng, radius]);
  if (gpsError) {
    return (
      <div className="text-center py-2 space-y-2">
        <div className="text-3xl">📡</div>
        <p className="text-sm text-rp-alert font-medium">{t.task.gpsUnavailable}</p>
        <p className="text-xs text-zinc-500">{t.task.gpsContactHost}</p>
      </div>
    );
  }
  return (
    <div className="text-center py-2">
      <div className="text-3xl mb-2">📡</div>
      {dist == null
        ? <p className="text-sm text-zinc-500">{t.task.findingLocation}</p>
        : dist <= radius
          ? <p className="text-sm text-accent font-medium">{t.task.youreHere}</p>
          : <p className="text-sm text-zinc-500">{t.task.walkCloser({ dist: Math.round(dist), radius })}</p>}
    </div>
  );
}

// Sequence — one ordered step at a time, with progress.
function SequenceRunner({ task, stepsDone, busy, onSubmit }: {
  task: SafeTask; stepsDone: number; busy: boolean; onSubmit: (stepIndex: number, ans: string) => Promise<boolean> | void;
}) {
  const { t } = useT();
  const steps = task.steps ?? [];
  const [val, setVal] = useState('');
  const idx = Math.min(stepsDone, steps.length - 1);
  const step = steps[idx];
  // Clear the input only when the step is accepted, so a wrong answer keeps what
  // the participant typed (P3).
  function submitStep() {
    void Promise.resolve(onSubmit(idx, val)).then((ok) => { if (ok) setVal(''); });
  }
  if (!step) return null;
  return (
    <div className="space-y-3">
      <Progress done={stepsDone} total={steps.length} />
      <div className="text-xs text-zinc-500">{t.task.stepOf({ step: idx + 1, total: steps.length })}</div>
      <p dir="auto" className="text-sm text-zinc-200">{step.prompt}</p>
      <Input value={val} dir="auto" onChange={(e) => setVal(e.target.value)} placeholder={t.task.stepAnswer}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submitStep(); }} />
      <Button disabled={busy} onClick={submitStep}>{t.task.submitStep}</Button>
    </div>
  );
}

const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB — generous for a phone photo

function PhotoEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (input: File | string) => void }) {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState('');
  // Track the live object URL so we can revoke the previous one (and clean up on
  // unmount) — otherwise each re-pick leaks a blob URL.
  const prevPreviewRef = useRef<string | null>(null);

  function setPreviewUrl(next: string | null) {
    if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current);
    prevPreviewRef.current = next;
    setPreview(next);
  }
  useEffect(() => () => { if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current); }, []);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileErr('');
    const f = e.target.files?.[0] ?? null;
    // Validate before we ever upload: type guard catches stray non-images, the
    // size cap protects the UI and Storage from multi-hundred-MB files.
    if (f && !f.type.startsWith('image/')) {
      setFileErr(t.task.chooseImage);
      e.target.value = ''; setFile(null); setPreviewUrl(null);
      return;
    }
    if (f && f.size > MAX_PHOTO_BYTES) {
      setFileErr(t.task.imageTooLarge({ mb: Math.round(MAX_PHOTO_BYTES / 1024 / 1024) }));
      e.target.value = ''; setFile(null); setPreviewUrl(null);
      return;
    }
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    if (f) setUrl(''); // a picked file takes precedence over a pasted URL
  }

  const canSubmit = !busy && !fileErr && (!!file || !!url.trim());
  return (
    <div className="space-y-3">
      <input type="file" accept="image/*" capture="environment" onChange={pickFile}
        className="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-app-raised file:text-zinc-200" />
      {fileErr && <p className="text-rp-alert text-sm">{fileErr}</p>}
      {preview && <img src={preview} alt={t.task.photoPreview} className="w-full rounded-lg max-h-56 object-cover" />}
      <Input value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) { setFile(null); setPreviewUrl(null); setFileErr(''); } }}
        placeholder={t.task.pastePhotoUrl} />
      <Button disabled={!canSubmit} onClick={() => onSubmit(file ?? url.trim())}>
        {busy ? t.task.working : t.task.submitPhoto}
      </Button>
    </div>
  );
}
