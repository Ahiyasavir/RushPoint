import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { haversineKm, expiryInstantMs, defaultRadiusFor } from '@rushpoint/shared';
import type { RunStageRecord, TaskMedia } from '@rushpoint/shared';
import {
  completeTask, requestNextTask, verifyStationCode, submitStationPhoto, requestTaskHint, reportArrival,
  submitTaskAnswer, submitSequenceStep, triggerSOS,
  type MyTeamState, type SafeTask,
} from '../services/calls';
import { uploadTaskPhoto, uploadTaskAudio } from '../services/firebase';
import { compressImageWithReport } from '../lib/imageResize';
import {
  getUploadProgress, subscribeUploadProgress,
  getUploadRetrying, subscribeUploadRetrying,
} from '../lib/uploadResiliency';
import { withLocation } from '../utils/withLocation';
import { useT } from '../i18nContext';
import type { Session } from '../store';
import { Button, Card, Input, Progress } from '../components/ui';
import { dialog } from '../components/dialog';

// Lazy scanner — jsQR + camera code stay out of the main bundle (MapLibre rule).
const QrScanner = lazy(() => import('./QrScanner'));

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
  // Transient "every station is full" state — distinct from routingError so the
  // team sees a friendly waiting card + auto-retry instead of a dead-end.
  const [stationBusy, setStationBusy] = useState(false);
  const [helpSent, setHelpSent] = useState(false);
  // Single in-flight guard: a slow requestNextTask must not be re-fired on every
  // poll/re-render while the team is unassigned (thundering herd).
  const routingInFlight = useRef(false);

  // The task currently assigned to this team within the active stage.
  const assignedRec = stage.tasks.find((t) => t.status === 'assigned');
  const unassigned  = stage.tasks.filter((t) => t.status === 'unassigned');

  // M2 / wave-f (next-task-regression, Bug A): are ALL remaining (unassigned)
  // tasks GENUINELY gated (routing cannot hand any of them out yet)? wave D omits
  // non-assigned task content from the payload, so we can no longer look a task up
  // in `activeStageTasks` to answer this (that lookup is always undefined now and
  // made EVERY unassigned task look "locked" — a false dead-end even while routing
  // could assign one this instant). The authoritative signal is the server's
  // `lockedTaskIds` (release/unlock-gated ids), driven by game-rule + team-record
  // state, not by whether content happens to be on the wire.
  const lockedIds = state.lockedTaskIds ?? [];
  const allRemainingLocked = unassigned.length > 0
    && unassigned.every((rec) => lockedIds.includes(rec.taskId));

  // If multi-task stage and nothing assigned yet, request a routing decision once.
  // A failed request surfaces a retryable error instead of an infinite spinner.
  // Viewer phones never request routing — the controller drives assignment and
  // the team-doc snapshot brings the result here.
  useEffect(() => {
    if (readOnly) return;
    if (assignedRec || unassigned.length === 0) return;
    if (routingInFlight.current) return; // don't stampede a slow request
    routingInFlight.current = true;
    setRoutingError(false);
    // wave-f (next-task-regression, Bug B): routing does NOT require a GPS fix —
    // the server defaults an absent location to a constant and routes by load
    // (requestNextTask: `teamLoc = lat/lng ?? {0,0}`). So a GPS denial/timeout
    // must NOT map to the terminal "couldn't get your next task" dead-end (a 5 s
    // timeout indoors / on a permission prompt is common, and the retry just
    // re-timed-out). We try for a precise fix, but on failure route WITHOUT coords
    // (degraded transit, still assigns) instead of erroring. `routingError` now
    // fires ONLY on a genuine requestNextTask rejection — its honest meaning.
    const requestRouting = (coords?: { lat: number; lng: number }) =>
      requestNextTask({ ...ctx, ...(coords ?? {}) })
        .then((res) => {
          if (res.reason === 'stationsFull') {
            // Transient: every eligible station is at capacity. Show the waiting
            // card and auto-retry with backoff rather than dead-ending on an error
            // that retry could never clear.
            setStationBusy(true);
            window.setTimeout(() => {
              routingInFlight.current = false;
              setRoutingAttempt((n) => n + 1);
            }, 5000 + Math.random() * 3000);
            return;
          }
          setStationBusy(false);
          routingInFlight.current = false;
          onChanged();
        })
        .catch(() => { routingInFlight.current = false; setRoutingError(true); });
    withLocation(
      (lat, lng) => { void requestRouting({ lat, lng }); },
      () => { void requestRouting(undefined); },
    );
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
  // A residual storage-path rejection (change: fix-photo-camera-capture): normal
  // camera capture always uploads to the team folder, but map any leftover
  // storage-path error to plain "retake" copy rather than the developer message.
  function isStoragePathError(e: unknown): boolean {
    const raw = e instanceof Error ? e.message : '';
    return /team folder|could not be saved|לתיקיית הקבוצה|לשמור את התמונה/.test(raw);
  }

  function submitError(e: unknown, fallback: string): string {
    const raw = e instanceof Error ? e.message : '';
    if (raw.includes('not-controller')) return t.devices.controlMoved;
    // The common server rejections are stable English `failed-precondition`
    // messages — localize them (keeping the distance number) instead of leaking
    // untranslated text to the player.
    const tooFar = raw.match(/Too far from the spot \((\d+)\s*m away\)/i);
    if (tooFar) return t.task.tooFar({ m: Number(tooFar[1]) });
    if (raw.includes('Not within the POI radius')) return t.task.notWithinRadius;
    if (raw.includes('This task has expired')) return t.task.submitExpired;
    if (raw.includes('Location required to check in here')) return t.task.locationRequired;
    if (raw.includes('keep following the clue')) return t.task.notHereYet;
    if (raw.includes('This task is not available yet')) return t.task.notAvailableYet;
    if (raw.includes('No hint available')) return t.task.noHint;
    if (raw.includes('already finished')) return t.task.raceFinished;
    if (raw.includes('No active stage')) return t.task.noActiveStageSubmit;
    if (raw.includes('not found')) return t.task.stateGone;
    // Default: NEVER leak an un-whitelisted English server message into a
    // Hebrew-default participant app — fall back to the localized copy.
    return fallback;
  }

  // M4: don't fire a submit while offline — the callable would fail with a raw
  // network error on tap. Short-circuit with a localized nudge instead (the
  // ConnectionBanner already shows the offline state). Returns true when blocked.
  function blockedOffline(offlineMsg: string = t.task.offlineSubmit): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setMsg(offlineMsg);
      return true;
    }
    return false;
  }

  if (!task) {
    // Station-full waiting state (WO-1): a transient, auto-retrying card — never
    // the terminal routingError. Shown only while we're not already erroring out.
    if (stationBusy && !routingError) {
      return (
        <Card className="p-6 text-center space-y-2">
          <div className="text-3xl">⏳</div>
          <p className="text-sm font-semibold text-zinc-200">{t.task.stationBusyTitle}</p>
          <p className="text-xs text-zinc-500">{t.task.stationBusyBody}</p>
        </Card>
      );
    }
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
    // M1: the server soft-pauses routing while the team is outside the play area —
    // say so explicitly instead of spinning on a neutral "finding next task".
    if (state.team.outOfBounds) {
      return (
        <Card className="p-6 text-center space-y-2">
          <div className="text-3xl">⚠️</div>
          <p className="text-sm font-semibold text-amber-500">{t.task.outOfBoundsTitle}</p>
          <p className="text-xs text-zinc-500">{t.task.outOfBoundsBody}</p>
        </Card>
      );
    }
    // M2 / wave-f: EVERY remaining task is genuinely gated (server `lockedTaskIds`
    // covers all of them) so routing has nothing to hand out — explain the gate
    // instead of spinning forever. Per wave D privacy the gated task titles are NOT
    // shipped, so the copy no longer promises a visible list.
    if (allRemainingLocked) {
      return (
        <Card className="p-6 text-center space-y-2">
          <div className="text-3xl">🔒</div>
          <p className="text-sm font-semibold text-zinc-200">{t.task.lockedOnlyTitle}</p>
          <p className="text-xs text-zinc-500">{t.task.lockedOnlyBody}</p>
        </Card>
      );
    }
    return <Card className="p-6 text-center text-zinc-500">{t.task.routing}</Card>;
  }

  // H2: a stuck geofence player is never dead-ended — this raises an SOS/host
  // alert (same channel as the SOS button) so the host can step in. Best-effort
  // location, never blocks on it.
  async function requestHelp() {
    const coords = await new Promise<{ lat?: number; lng?: number }>((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({}),
        { timeout: 8000 },
      );
    });
    try {
      await triggerSOS({ ...ctx, ...coords });
      setHelpSent(true);
    } catch { /* let the player tap again; nothing persisted */ }
  }

  async function field() {
    if (blockedOffline()) return;
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

  // play-task-gating: manual "we got here" for a SEALED hidden-location task.
  // The background watcher already probes on every GPS tick; this covers a player
  // whose last fix is stale. It awards nothing — it only asks the server to
  // re-check proximity and unseal the task. `arrived:false` is a normal answer,
  // not an error, and never carries a distance.
  async function checkArrival() {
    if (blockedOffline(t.task.arrivalNeedsOnline)) return;
    setBusy(true); setMsg('');
    withLocation(
      async (lat, lng) => {
        try {
          const res = await reportArrival({ ...ctx, taskId: task!.id, lat, lng });
          if (res.arrived) { setMsg(t.task.arrivalUnlocked); onChanged(); }
          else setMsg(t.task.notThereYet);
        } catch (e) { setMsg(submitError(e, t.task.notThereYet)); }
        finally { setBusy(false); }
      },
      () => { setMsg(t.task.gpsWarning); setBusy(false); },
    );
  }

  async function verify(code: string) {
    if (blockedOffline()) return;
    setBusy(true); setMsg('');
    try {
      await verifyStationCode({ ...ctx, teamId: state.team.id, taskId: task!.id, code });
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error && e.message.includes('not-controller') ? t.devices.controlMoved : t.task.wrongCode);
    } finally { setBusy(false); }
  }

  // Camera capture → compressed upload → submit (change: fix-photo-camera-capture).
  // No pasted-URL path any more, so the "own team folder" storage-path rejection
  // can't be reached by a normal player; the guard maps any residual storage-path
  // error to plain "retake" copy instead of the developer-oriented message.
  async function photo(file: File) {
    if (blockedOffline()) return;
    setBusy(true); setMsg('');
    try {
      setMsg(t.task.uploadingPhoto);
      const url = await uploadTaskPhoto(file, { runId: session.runId, teamId: state.team.id, taskId: task!.id });
      const res = await submitStationPhoto({ ...ctx, teamId: state.team.id, taskId: task!.id, photoUrl: url });
      setMsg(res.autoApproved ? t.task.approved : t.task.pendingReview);
      onChanged();
    } catch (e) {
      setMsg(isStoragePathError(e) ? t.task.photoSaveRetry : submitError(e, t.task.uploadFailed));
    } finally { setBusy(false); }
  }

  // audio-tasks: a recorded clip rides the SAME photo pipeline — upload the blob
  // to Storage, then submitStationPhoto with the declared contentType so the
  // server validates it against the task's captureKind.
  async function audio(blob: Blob, contentType: string) {
    if (blockedOffline()) return;
    setBusy(true); setMsg('');
    try {
      setMsg(t.task.uploadingAudio);
      const up = await uploadTaskAudio(blob, {
        runId: session.runId, teamId: state.team.id, taskId: task!.id, contentType,
      });
      const res = await submitStationPhoto({
        ...ctx, teamId: state.team.id, taskId: task!.id, photoUrl: up.url, contentType: up.contentType,
      });
      setMsg(res.autoApproved ? t.task.approved : t.task.pendingReview);
      onChanged();
    } catch (e) {
      setMsg(submitError(e, t.task.uploadFailed));
    } finally { setBusy(false); }
  }

  // Presence-gated answer tasks (change: quiz-location-verification): when the
  // creator required the team to be at the spot, the server gate needs GPS on the
  // submit. Fetch it via withLocation and pass lat/lng; a GPS-denied device gets
  // the same guidance as a field check-in instead of a bare server rejection.
  // Tasks without requirePresence submit exactly as before (no GPS prompt).
  function submitWithOptionalPresence(run: (coords: { lat: number; lng: number } | undefined) => Promise<void>): void {
    if (task?.requirePresence) {
      withLocation(
        (lat, lng) => { void run({ lat, lng }); },
        () => { setMsg(t.task.gpsWarning); setBusy(false); },
      );
    } else {
      void run(undefined);
    }
  }

  // quiz / numeric / survey — submit a typed or chosen answer
  async function answer(text: string) {
    if (blockedOffline()) return;
    setBusy(true); setMsg('');
    submitWithOptionalPresence(async (coords) => {
      try {
        const res = await submitTaskAnswer({ ...ctx, taskId: task!.id, answer: text, ...(coords ?? {}) });
        if (res.correct) onChanged();
        else setMsg(t.task.notQuite);
      } catch (e) {
        setMsg(submitError(e, t.task.failed));
      } finally { setBusy(false); }
    });
  }

  // ordering quiz (change: quiz-ordering) — submit the player's arrangement.
  // A wrong arrangement keeps their layout (they refine, not restart).
  async function submitOrdered(items: string[]) {
    if (blockedOffline()) return;
    setBusy(true); setMsg('');
    submitWithOptionalPresence(async (coords) => {
      try {
        const res = await submitTaskAnswer({ ...ctx, taskId: task!.id, orderedAnswer: items, ...(coords ?? {}) });
        if (res.correct) onChanged();
        else setMsg(t.task.orderingWrong);
      } catch (e) {
        setMsg(submitError(e, t.task.failed));
      } finally { setBusy(false); }
    });
  }

  // sequence — submit the current ordered step. Returns whether the step was
  // accepted so the input is cleared only on success (P3).
  async function sequenceStep(stepIndex: number, ans: string): Promise<boolean> {
    if (blockedOffline()) return false;
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
  // Returns whether the check-in SUCCEEDED so the watcher can un-latch and retry
  // on a failed arrival (change: nightly geofence-latch fix) — otherwise a single
  // transient/rejected completeTask would freeze auto check-in for good.
  function geofenceArrive(la: number, ln: number): Promise<boolean> {
    if (readOnly || blockedOffline()) return Promise.resolve(false);
    setBusy(true); setMsg('');
    return completeTask({ ...ctx, taskId: task!.id, lat: la, lng: ln })
      .then(() => { onChanged(); return true; })
      .catch((e) => { setMsg(submitError(e, t.task.checkinFailed)); return false; })
      .finally(() => setBusy(false));
  }

  async function revealHint() {
    if (hint) return;
    // Hint auto escalation: when the server flagged the hint FREE, skip the
    // cost confirmation (the charge decision is re-made server-side anyway).
    if (!task!.hintFreeNow) {
      const cost = task!.hintPenalty ?? 25;
      if (!(await dialog.confirm(t.task.hintConfirm({ cost }), { confirmLabel: t.task.hintConfirmBtn }))) return;
    }
    setBusy(true);
    try {
      const res = await requestTaskHint({ ...ctx, taskId: task!.id });
      setHint(res.hint);
      if (res.penalty === 0 && res.free) setMsg(t.task.hintRevealedFree);
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

  // play-task-gating: SEALED hidden-location task. The server has not confirmed
  // arrival, so the payload literally contains no title, no type and no inputs —
  // there is nothing to render but the clue. This is not a UI-level hide; there
  // is nothing in devtools either.
  if (task.arrivalPending) {
    return (
      <Card className="p-5" data-testid="task-card" data-task-sealed="true" data-task-id={task.id}>
        <div className="text-xs text-accent uppercase tracking-widest mb-1">{headerLabel}</div>
        <h2 className="text-2xl font-bold mb-2">🧭 {t.task.sealedTitle}</h2>
        <div className="rounded-lg bg-app-raised border border-glass-border px-3 py-2.5 mb-1">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-warm mb-1">
            {t.task.hiddenBadge}
          </div>
          {(task.locationClueHe || task.locationClue) && (
            <p dir="auto" className="text-sm text-zinc-200" data-testid="sealed-clue">
              {task.locationClueHe || task.locationClue}
            </p>
          )}
          <p className="text-[11px] text-zinc-500 mt-1">{t.task.sealedHelp}</p>
        </div>

        <div className={readOnly ? 'mt-5 pointer-events-none opacity-60' : 'mt-5'} aria-disabled={readOnly}>
          <Button disabled={frozen} onClick={checkArrival} data-testid="task-check-arrival">
            {t.task.checkArrival}
          </Button>
        </div>

        {task.hasHint && !hint && (
          <div className="mt-3">
            <button onClick={revealHint} disabled={frozen}
              aria-label={t.task.hintStuck({ cost: task.hintPenalty ?? 25 })}
              className="text-xs text-accent-warm hover:underline disabled:opacity-40">
              💡 {t.task.hintStuck({ cost: task.hintPenalty ?? 25 })}
            </button>
          </div>
        )}
        {hint && <p dir="auto" className="mt-3 text-sm text-zinc-200 bg-app-raised rounded-lg px-3 py-2">💡 {hint}</p>}
        {msg && <p className="mt-3 text-sm text-zinc-300">{msg}</p>}
      </Card>
    );
  }

  return (
    <Card className="p-5" data-testid="task-card" data-task-type={task.type} data-task-id={task.id}>
      <div className="text-xs text-accent uppercase tracking-widest mb-1">{headerLabel}</div>
      {/* Legibility (change: fix-play-screen-hierarchy): the primary task text was
          too small/low-contrast. Bigger title + higher-contrast body (play-web's
          reversed zinc scale ⇒ zinc-300 is darker on the light theme). */}
      <h2 dir="auto" className="text-2xl font-bold mb-2">{task.title}</h2>
      {task.description && <p dir="auto" className="text-zinc-300 text-base leading-relaxed mb-3">{task.description}</p>}
      {task.media && task.media.length > 0 && <TaskMediaGallery media={task.media} />}
      {task.smart?.longInstructions && <p dir="auto" className="text-zinc-300 text-base mb-3">{task.smart.longInstructions}</p>}

      <ExpiryCountdown key={task.id} task={task} launchedAt={state.run.launchedAt} onExpired={onChanged} />

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
          <Button disabled={frozen} onClick={field} data-testid="task-field-checkin">
            {task.type === 'self_report'
              ? t.task.markComplete
              : task.locationHidden ? t.task.hiddenCheckIn : t.task.imHere}
          </Button>
        ) : task.type === 'smart_station' ? (
          <CodeEntry busy={frozen} label={task.smart?.codeInputLabel ?? t.task.enterStationCode} onSubmit={verify} />
        ) : task.type === 'quiz' ? (
          task.orderItems && task.orderItems.length > 0
            // Ordering quiz: the items arrive server-shuffled (per-team seed);
            // key by task id so a new task reseeds the local arrangement.
            ? <OrderingEntry key={task.id} items={task.orderItems} busy={frozen} onSubmit={submitOrdered} />
            : <QuizEntry task={task} busy={frozen} onSubmit={answer} />
        ) : task.type === 'numeric' ? (
          <NumericEntry busy={frozen} onSubmit={answer} />
        ) : task.type === 'geofence' ? (
          <GeofenceAuto task={task} onArrive={geofenceArrive} onRequestHelp={requestHelp} helpSent={helpSent} />
        ) : task.type === 'sequence' ? (
          <SequenceRunner task={task} stepsDone={state.team.taskStepProgress?.[task.id] ?? 0} busy={frozen} onSubmit={sequenceStep} />
        ) : task.type === 'survey' ? (
          <SurveyEntry task={task} busy={frozen} onSubmit={answer} />
        ) : task.smart?.captureKind === 'audio' ? (
          <AudioEntry busy={frozen} onSubmit={audio} />
        ) : (
          <PhotoEntry busy={frozen} onSubmit={photo} />
        )}
      </div>

      {task.hasHint && (
        <div className="mt-3">
          {hint
            ? <p dir="auto" className="text-sm text-zinc-200 bg-app-raised rounded-lg px-3 py-2">💡 {hint}</p>
            : task.hintFreeNow
              // Hint auto escalation: the server says this hint is free right now —
              // highlight it so a stuck team actually takes the help.
              ? <button onClick={revealHint} disabled={frozen} aria-label={t.task.hintFreeNow}
                  className="text-xs font-semibold text-accent bg-accent/10 border border-accent/30 rounded-full px-3 py-1.5 hover:bg-accent/20 disabled:opacity-40">
                  🎁 {t.task.hintFreeNow}
                </button>
              : <button onClick={revealHint} disabled={frozen} aria-label={t.task.hintStuck({ cost: task.hintPenalty ?? 25 })} className="text-xs text-accent-warm hover:underline disabled:opacity-40">
                  💡 {t.task.hintStuck({ cost: task.hintPenalty ?? 25 })}
                </button>}
        </div>
      )}

      {msg && <p className="text-center text-sm mt-3 text-zinc-300">{msg}</p>}
    </Card>
  );
}

// Task expiry (change: task-expiry): a ticking "expires in mm:ss" badge once
// fewer than 10 minutes remain, computed from the sanitizer-passthrough
// `expiresAfterMinutes` + the run's launchedAt (both already in the payload).
// On hitting zero it triggers the state refresh, so the server sweep skips the
// closed task and reroutes the team. The server clock decides — this is display.
function ExpiryCountdown({ task, launchedAt, onExpired }: {
  task: SafeTask; launchedAt?: string | null; onExpired: () => void;
}) {
  const { t } = useT();
  const closesAt = expiryInstantMs(task, launchedAt ?? undefined);
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    if (closesAt == null) return;
    // Stop ticking once the deadline passes — the display is static from then on,
    // so leaving the interval running would re-render this badge every second for
    // as long as the (now-closed) task stays assigned. onExpired already fired.
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= closesAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [closesAt]);
  useEffect(() => {
    if (closesAt != null && now >= closesAt && !fired.current) {
      fired.current = true;
      onExpired();
    }
  }, [now, closesAt, onExpired]);

  if (closesAt == null) return null;
  const remaining = closesAt - now;
  if (remaining >= 10 * 60_000) return null; // countdown only inside the last 10 min
  if (remaining <= 0) {
    return <p className="mt-2 text-sm text-rp-alert font-medium">⌛ {t.task.taskExpiredNotice}</p>;
  }
  const totalS = Math.ceil(remaining / 1000);
  const mm = String(Math.floor(totalS / 60)).padStart(2, '0');
  const ss = String(totalS % 60).padStart(2, '0');
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rp-alert/10 border border-rp-alert/30 px-3 py-1 text-xs font-bold text-rp-alert tabular-nums">
      ⏳ {t.task.expiresInLabel({ time: `${mm}:${ss}` })}
    </div>
  );
}

function DistanceBadge({ task }: { task: SafeTask }) {
  const { t } = useT();
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
    // Key on the coord PRIMITIVES, not the object: `coords` is re-derived from a
    // freshly-fetched task on every poll, so an object dep would tear down and
    // restart the geolocation watch every ~12s even when the target never moved
    // (mirrors GeofenceAuto's primitive-keyed watcher).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng]);
  if (dist == null) return null;
  return (
    <div className="text-xs text-zinc-500">
      📍 {dist < 1 ? t.task.metersAway({ m: Math.round(dist * 1000) }) : t.task.kmAway({ km: dist.toFixed(1) })}
    </div>
  );
}

function CodeEntry({ busy, label, onSubmit }: { busy: boolean; label: string; onSubmit: (code: string) => void }) {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  // Only offer the scanner where a camera API exists (feature-detect).
  const canScan = typeof navigator !== 'undefined' && !!navigator.mediaDevices;
  if (scanning) {
    return (
      <Suspense fallback={<div className="h-64 rounded-2xl bg-app-raised animate-pulse" />}>
        <QrScanner
          onClose={() => setScanning(false)}
          onDecode={(scanned) => { setCode(scanned); setScanning(false); onSubmit(scanned); }}
        />
      </Suspense>
    );
  }
  return (
    <div className="space-y-3">
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={label}
        className="text-center font-mono tracking-widest" data-testid="task-code-input" />
      <Button disabled={busy || !code} onClick={() => onSubmit(code)} data-testid="task-code-submit">{t.task.verify}</Button>
      {canScan && (
        <Button variant="ghost" disabled={busy} onClick={() => setScanning(true)}>📷 {t.task.scanQr}</Button>
      )}
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
          <Button key={c} variant="ghost" disabled={busy} onClick={() => onSubmit(c)} className="w-full"
            data-testid="quiz-choice" data-choice={c}>
            <span dir="auto">{c}</span>
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Input value={val} dir="auto" onChange={(e) => setVal(e.target.value)} placeholder={t.task.yourAnswer}
        onKeyDown={(e) => e.key === 'Enter' && !busy && val.trim() && onSubmit(val.trim())} data-testid="quiz-text-input" />
      <Button disabled={busy || !val.trim()} onClick={() => onSubmit(val.trim())} data-testid="quiz-text-submit">{t.task.submitAnswer}</Button>
    </div>
  );
}

// Survey (change: survey-tasks) — a question with no right answer. With
// surveyChoices, tap one option to submit; without, write a free-text response
// (≤ 500 chars). Submits via the same answer() helper as the quiz. No anonymity
// claim (responses are attributed to the team for the creator).
function SurveyEntry({ task, busy, onSubmit }: { task: SafeTask; busy: boolean; onSubmit: (a: string) => void }) {
  const { t } = useT();
  const [val, setVal] = useState('');
  if (task.surveyChoices && task.surveyChoices.length > 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">{t.task.surveyChoicePrompt}</p>
        {task.surveyChoices.map((c) => (
          <Button key={c} variant="ghost" disabled={busy} onClick={() => onSubmit(c)} className="w-full"
            data-testid="survey-choice" data-choice={c}>
            <span dir="auto">{c}</span>
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">{t.task.surveyTextPrompt}</p>
      <textarea value={val} dir="auto" rows={3} maxLength={500} data-testid="survey-text"
        onChange={(e) => setVal(e.target.value)} placeholder={t.task.surveyPlaceholder}
        className="w-full px-4 py-3 rounded-2xl text-base bg-white border border-glass-border text-zinc-100 placeholder:text-zinc-600 shadow-[0_1px_4px_rgba(26,10,0,0.06)] focus:outline-none focus:ring-2 focus:ring-rp-fire/30 focus:border-rp-fire/40 transition-all duration-150 resize-none" />
      <Button disabled={busy || !val.trim()} onClick={() => onSubmit(val.trim())} data-testid="survey-submit">{t.task.surveySubmit}</Button>
    </div>
  );
}

// Ordering quiz (change: quiz-ordering) — arrange the server-shuffled items with
// up/down buttons (touch-first, RTL-safe; no drag-and-drop) and submit the
// arrangement. The parent keeps a wrong arrangement on screen (no reset), so the
// team refines instead of restarting.
function OrderingEntry({ items, busy, onSubmit }: {
  items: string[]; busy: boolean; onSubmit: (arrangement: string[]) => void;
}) {
  const { t } = useT();
  const [arranged, setArranged] = useState<string[]>(items);
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= arranged.length) return;
    const next = arranged.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setArranged(next);
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">{t.task.orderingInstruction}</p>
      <ol className="space-y-1.5">
        {arranged.map((item, i) => (
          <li key={item} className="flex items-center gap-2 rounded-lg bg-app-raised border border-glass-border px-3 py-2">
            <span className="text-xs font-bold text-accent w-5 shrink-0 tabular-nums">{i + 1}</span>
            <span dir="auto" className="flex-1 min-w-0 text-sm text-zinc-100">{item}</span>
            <button onClick={() => move(i, -1)} disabled={busy || i === 0}
              aria-label={`${t.task.orderingMoveUp} ${i + 1}`} data-testid="ordering-up" data-item={item}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-app border border-glass-border text-zinc-300 disabled:opacity-30">↑</button>
            <button onClick={() => move(i, 1)} disabled={busy || i === arranged.length - 1}
              aria-label={`${t.task.orderingMoveDown} ${i + 1}`} data-testid="ordering-down" data-item={item}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-app border border-glass-border text-zinc-300 disabled:opacity-30">↓</button>
          </li>
        ))}
      </ol>
      <Button disabled={busy} onClick={() => onSubmit(arranged)} data-testid="ordering-submit">{t.task.orderingSubmit}</Button>
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
        className="text-center text-xl font-mono" data-testid="numeric-input"
        onKeyDown={(e) => e.key === 'Enter' && !busy && val !== '' && onSubmit(val)} />
      <Button disabled={busy || val === ''} onClick={() => onSubmit(val)} data-testid="numeric-submit">{t.task.submit}</Button>
    </div>
  );
}

// Geofence — watch position, auto-check-in once inside the radius.
// H2: check-in is auto-only, so flaky GPS could otherwise trap a player on "walk
// closer" forever. On a hard GPS error, or after ~40s still stuck outside the
// radius, we surface a "request help" affordance (raises a host alert) so the
// player is never dead-ended. We never fake location — the server validates.
function GeofenceAuto({ task, onArrive, onRequestHelp, helpSent }: {
  task: SafeTask; onArrive: (lat: number, lng: number) => Promise<boolean> | void;
  onRequestHelp?: () => void; helpSent?: boolean;
}) {
  const { t } = useT();
  const [dist, setDist] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState(false);
  const [stuckTooLong, setStuckTooLong] = useState(false);
  const fired = useRef(false);
  // Match the SERVER's default radius (defaultRadiusFor('radius') = 40) so the
  // client never auto-fires at a distance the server will reject (which used to
  // latch `fired` and freeze check-in) — nightly geofence-radius-mismatch fix.
  const radius = task.geofenceRadiusMeters ?? defaultRadiusFor('radius');
  const coords = task.coordinates;
  // After ~40s on this task without an auto check-in, offer the escape hatch.
  useEffect(() => {
    setStuckTooLong(false);
    const id = setTimeout(() => setStuckTooLong(true), 40_000);
    return () => clearTimeout(id);
  }, [coords?.lat, coords?.lng, radius]);
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
        if (d <= radius && !fired.current) {
          fired.current = true;
          // Un-latch on a failed arrival so the watcher retries as the player
          // stays in range, instead of freezing after one transient failure.
          Promise.resolve(onArrive(p.coords.latitude, p.coords.longitude))
            .then((ok) => { if (ok === false) fired.current = false; });
        }
      },
      () => { setGpsError(true); navigator.geolocation.clearWatch(id); },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng, radius]);
  // Escape hatch shown on a hard GPS error, or once the player has been stuck
  // outside the radius too long. A "request help" button raises a host alert.
  const helpBlock = onRequestHelp ? (
    <div className="mt-2">
      {helpSent
        ? <p className="text-xs text-accent font-medium" data-testid="geofence-help-sent">{t.task.helpSent}</p>
        : <button
            onClick={onRequestHelp}
            data-testid="geofence-help"
            className="text-xs font-semibold text-rp-alert bg-rp-alert/10 border border-rp-alert/30 rounded-full px-3 py-1.5 hover:bg-rp-alert/20">
            {t.task.requestHelp}
          </button>}
    </div>
  ) : null;

  if (gpsError) {
    return (
      <div className="text-center py-2 space-y-2" data-testid="geofence-status" data-gps-error="true">
        <div className="text-3xl">📡</div>
        <p className="text-sm text-rp-alert font-medium">{t.task.gpsUnavailable}</p>
        <p className="text-xs text-zinc-500">{t.task.gpsContactHost}</p>
        {helpBlock}
      </div>
    );
  }
  const stuckOutside = dist != null && dist > radius && stuckTooLong;
  return (
    <div className="text-center py-2" data-testid="geofence-status" data-inside={dist != null && dist <= radius}>
      <div className="text-3xl mb-2">📡</div>
      {dist == null
        ? <p className="text-sm text-zinc-500">{t.task.findingLocation}</p>
        : dist <= radius
          ? <p className="text-sm text-accent font-medium">{t.task.youreHere}</p>
          : <p className="text-sm text-zinc-500">{t.task.walkCloser({ dist: Math.round(dist), radius })}</p>}
      {stuckOutside && (
        <>
          <p className="text-xs text-zinc-500 mt-2">{t.task.gpsStuckHint}</p>
          {helpBlock}
        </>
      )}
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
      <p dir="auto" className="text-sm text-zinc-200" data-testid="sequence-prompt">{step.prompt}</p>
      <Input value={val} dir="auto" onChange={(e) => setVal(e.target.value)} placeholder={t.task.stepAnswer}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submitStep(); }} data-testid="sequence-input" />
      <Button disabled={busy} onClick={submitStep} data-testid="sequence-submit">{t.task.submitStep}</Button>
    </div>
  );
}

const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB — generous for a phone photo

function PhotoEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (file: File) => void }) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState('');
  // A full-size fallback (compression failed) is the difference between a 400 KB
  // and a 5 MB upload — tell the player instead of letting it look like a freeze.
  const [warn, setWarn] = useState('');
  // Live upload progress, published by uploadResilient() in services/firebase.ts.
  // A store rather than a prop because the upload is kicked off by TaskRunner's
  // photo() several components away. See docs/wave-a/upload-resiliency.md.
  const [pct, setPct] = useState<number | null>(getUploadProgress());
  const [retrying, setRetrying] = useState(getUploadRetrying());
  useEffect(() => {
    const un1 = subscribeUploadProgress(setPct);
    const un2 = subscribeUploadRetrying(setRetrying);
    return () => { un1(); un2(); };
  }, []);
  // Track the live object URL so we can revoke the previous one (and clean up on
  // unmount) — otherwise each re-pick leaks a blob URL.
  const prevPreviewRef = useRef<string | null>(null);

  function setPreviewUrl(next: string | null) {
    if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current);
    prevPreviewRef.current = next;
    setPreview(next);
  }
  useEffect(() => () => { if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current); }, []);

  // Camera-capture only (change: fix-photo-camera-capture): a hidden
  // `capture="environment"` input opens the camera; there is no gallery picker and
  // no paste-a-URL field. The captured image is downscaled + JPEG-compressed in the
  // browser BEFORE upload so it doesn't burn mobile data.
  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileErr(''); setWarn('');
    const f = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-selecting the same capture
    if (!f) { setFile(null); setPreviewUrl(null); return; }
    if (!f.type.startsWith('image/')) { setFileErr(t.task.chooseImage); setFile(null); setPreviewUrl(null); return; }
    if (f.size > MAX_PHOTO_BYTES) { setFileErr(t.task.imageTooLarge({ mb: Math.round(MAX_PHOTO_BYTES / 1024 / 1024) })); setFile(null); setPreviewUrl(null); return; }
    // compressImageWithReport reports WHY it fell back instead of silently
    // handing back the full-size capture (Task 11).
    const report = await compressImageWithReport(f);
    if (!report.compressed) setWarn(t.task.photoNotCompressed);
    const compressed = new File([report.blob], `photo-${Date.now()}.jpg`, { type: report.blob.type || 'image/jpeg' });
    setFile(compressed);
    setPreviewUrl(URL.createObjectURL(compressed));
  }

  const canSubmit = !busy && !fileErr && !!file;
  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={pickFile}
        data-testid="photo-file" className="hidden" />
      <Button variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()} data-testid="photo-take">
        {file ? t.task.retakePhoto : t.task.takePhoto}
      </Button>
      {fileErr && <p className="text-rp-alert text-sm">{fileErr}</p>}
      {!fileErr && warn && <p className="text-sm text-zinc-400" data-testid="photo-warn">{warn}</p>}
      {preview && <img src={preview} alt={t.task.photoPreview} className="w-full rounded-lg max-h-56 object-cover" />}
      {/* Determinate progress: a slow upload must never look like a frozen app. */}
      {busy && pct !== null && (
        <div className="space-y-1" data-testid="photo-progress">
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-rp-fire transition-all duration-200" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-zinc-400">
            {retrying ? t.task.uploadRetrying : t.task.uploadingPercent({ pct })}
          </p>
        </div>
      )}
      <Button disabled={!canSubmit} onClick={() => file && onSubmit(file)} data-testid="photo-submit">
        {busy ? t.task.working : t.task.submitPhoto}
      </Button>
    </div>
  );
}

// audio-tasks: record a short clip with MediaRecorder — record / stop / re-record
// with a 60s hard cap (auto-stop + live countdown), <audio> playback before
// submit. Prefers audio/webm;codecs=opus, falls back to audio/mp4 (Safari). All
// MediaStream tracks are stopped on unmount so the mic indicator clears.
const MAX_AUDIO_SECONDS = 60;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024; // mirrors the photo cap; 60s opus « 1MB

function pickAudioMimeType(): string | null {
  const rec = (typeof window !== 'undefined' ? window.MediaRecorder : undefined) as
    | (typeof MediaRecorder & { isTypeSupported?: (t: string) => boolean }) | undefined;
  if (!rec) return null;
  const supports = (t: string) => typeof rec.isTypeSupported === 'function' && rec.isTypeSupported(t);
  if (supports('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (supports('audio/webm')) return 'audio/webm';
  if (supports('audio/mp4')) return 'audio/mp4'; // Safari
  return null;
}

function AudioEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (blob: Blob, contentType: string) => void }) {
  const { t } = useT();
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(MAX_AUDIO_SECONDS);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [unsupported, setUnsupported] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPreviewRef = useRef<string | null>(null);

  function setPreview(next: string | null) {
    if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current);
    prevPreviewRef.current = next;
    setPreviewUrl(next);
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }
  function clearTimers() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopTimeoutRef.current) { clearTimeout(stopTimeoutRef.current); stopTimeoutRef.current = null; }
  }

  // Clean up mic + timers + blob URL on unmount.
  useEffect(() => () => {
    clearTimers();
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    stopTracks();
    if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current);
  }, []);

  function stop() {
    clearTimers();
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
  }

  async function start() {
    setErr('');
    const mime = pickAudioMimeType();
    if (!mime || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setUnsupported(true);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr(t.task.micDenied);
      return;
    }
    streamRef.current = stream;
    mimeRef.current = mime;
    chunksRef.current = [];
    setBlob(null);
    setPreview(null);

    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      clearTimers();
      stopTracks();
      setRecording(false);
      const out = new Blob(chunksRef.current, { type: mimeRef.current });
      if (out.size > MAX_AUDIO_BYTES) {
        setErr(t.task.audioTooLarge({ mb: Math.round(MAX_AUDIO_BYTES / 1024 / 1024) }));
        return;
      }
      setBlob(out);
      setPreview(URL.createObjectURL(out));
    };

    setRecording(true);
    setRemaining(MAX_AUDIO_SECONDS);
    recorder.start();
    timerRef.current = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    // Hard 60s cap — auto-stop.
    stopTimeoutRef.current = setTimeout(() => stop(), MAX_AUDIO_SECONDS * 1000);
  }

  if (unsupported) {
    return <p className="text-rp-alert text-sm">{t.task.audioUnsupported}</p>;
  }

  return (
    <div className="space-y-3">
      {err && <p className="text-rp-alert text-sm">{err}</p>}
      {recording ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{t.task.recording({ sec: remaining })}</p>
          <Button variant="ghost" onClick={stop}>{t.task.stopRecording}</Button>
        </div>
      ) : blob && previewUrl ? (
        <div className="space-y-2">
          <audio controls src={previewUrl} className="w-full" />
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={start}>{t.task.reRecord}</Button>
            <Button disabled={busy} onClick={() => onSubmit(blob, mimeRef.current)}>
              {busy ? t.task.working : t.task.submitAudio}
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={busy} onClick={start}>{t.task.startRecording}</Button>
      )}
    </div>
  );
}
