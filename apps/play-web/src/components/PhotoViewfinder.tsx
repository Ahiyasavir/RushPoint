import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18nContext';
import {
  canSwitchCamera, initialFacing, planCameraSwitch, readCameraChoice, shouldMirror, stillSize,
  writeCameraChoice, type Facing,
} from '../lib/cameraChoice';
import { CAMERA_OPEN_DEADLINE_MS, withCameraDeadline } from '../lib/videoCapture';

// The in-app photo camera (change: camera-switch 2.4, design D1-D4). The same viewfinder shape as
// video: open on the player's own choice, then the mission's selfie default, then the rear camera;
// switch front/back when a second camera exists; mirror the selfie PREVIEW only (the saved photo is
// what others see). Anything that goes wrong opening the camera (no API, refused, a WebView that
// never answers) hands over to the phone's own camera, which always worked.

function safeSessionStorage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

function reportedFacing(stream: MediaStream): Facing | null {
  try {
    const f = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
    return f === 'user' || f === 'environment' ? f : null;
  } catch { return null; }
}

const FRAME = { width: { ideal: 1920 }, height: { ideal: 1080 } };

export default function PhotoViewfinder({ selfie, runId, onShot, onClose, onFallback }: {
  selfie: boolean;
  runId: string;
  onShot: (file: File) => void;
  onClose: () => void;
  onFallback: () => void;
}) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [canSwitch, setCanSwitch] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  function stopTracks() {
    try { streamRef.current?.getTracks().forEach((tr) => tr.stop()); } catch { /* already stopped */ }
    streamRef.current = null;
  }

  function attach(stream: MediaStream) {
    streamRef.current = stream;
    const el = videoRef.current;
    if (el) {
      el.srcObject = stream;
      void el.play().catch(() => { /* preview only */ });
    }
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { onFallback(); return; }
      const wanted = initialFacing({ explicit: readCameraChoice(safeSessionStorage(), runId), taskDefault: selfie ? 'front' : undefined });
      try {
        const stream = await withCameraDeadline(
          navigator.mediaDevices.getUserMedia({ video: { ...FRAME, facingMode: { ideal: wanted } }, audio: false }),
          CAMERA_OPEN_DEADLINE_MS,
          (late) => { try { late.getTracks().forEach((tr) => tr.stop()); } catch { /* best effort */ } },
        );
        if (!alive) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        attach(stream);
        setFacing(reportedFacing(stream) ?? wanted);
        setReady(true);
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
        if (alive) setCanSwitch(canSwitchCamera(devices));
      } catch {
        if (alive) onFallback();
      }
    })();
    return () => { alive = false; stopTracks(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchCamera() {
    if (switching || !navigator.mediaDevices?.getUserMedia) return;
    setSwitching(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      const current = streamRef.current?.getVideoTracks()[0]?.getSettings?.();
      const plan = planCameraSwitch({ devices, currentFacing: facing, currentDeviceId: current?.deviceId ?? null });
      if (!plan) { setCanSwitch(false); return; }
      const ask = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video, audio: false });
      // iOS allows one camera at a time: stop the old one first.
      stopTracks();
      let next: MediaStream | null = null;
      try {
        next = await ask(plan.kind === 'deviceId' ? { ...FRAME, deviceId: { exact: plan.deviceId } } : { ...FRAME, facingMode: { exact: plan.facing } });
      } catch {
        if (plan.kind === 'facing' && plan.fallbackDeviceId) {
          next = await ask({ ...FRAME, deviceId: { exact: plan.fallbackDeviceId } }).catch(() => null);
        }
      }
      // Never a black viewfinder: if the other camera would not open, reopen the one they had.
      if (!next) {
        next = await ask({ ...FRAME, facingMode: { ideal: facing } }).catch(() => null);
        setErr(t.task.cameraSwitchFailed);
        if (!next) { onFallback(); return; }
      }
      attach(next);
      const nowFacing = reportedFacing(next) ?? plan.facing;
      setFacing(nowFacing);
      writeCameraChoice(safeSessionStorage(), runId, nowFacing);
    } finally {
      setSwitching(false);
    }
  }

  function shoot() {
    const el = videoRef.current;
    const size = el ? stillSize(el.videoWidth, el.videoHeight) : null;
    if (!el || !size) { setErr(t.task.photoCaptureFailed); return; }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { setErr(t.task.photoCaptureFailed); return; }
      // Drawn UNMIRRORED: the preview is a mirror for the players, the photo is what others see.
      ctx.drawImage(el, 0, 0, size.width, size.height);
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) { setErr(t.task.photoCaptureFailed); return; }
        stopTracks();
        onShot(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    } catch {
      setErr(t.task.photoCaptureFailed);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={t.task.takePhoto}>
      <video ref={videoRef} muted playsInline autoPlay data-testid="photo-viewfinder"
        className={`absolute inset-0 h-full w-full object-cover ${shouldMirror(facing) ? '-scale-x-100' : ''}`} />
      <div className="relative flex items-start justify-between gap-3 p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button type="button" onClick={() => { stopTracks(); onClose(); }} aria-label={t.common.cancel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/50 text-2xl leading-none text-white">✕</button>
        {err && <span role="alert" className="rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white">{err}</span>}
      </div>
      <div className="relative mt-auto flex flex-col items-center gap-3 p-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        {canSwitch && (
          <button type="button" onClick={() => void switchCamera()} disabled={switching}
            aria-label={t.task.switchCamera} title={t.task.switchCamera} data-testid="photo-camera-switch"
            className="absolute start-6 bottom-[34px] flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/80 bg-black/45 backdrop-blur-sm text-xl text-white transition-transform active:scale-95 disabled:opacity-50">
            🔄
          </button>
        )}
        <button type="button" onClick={shoot} disabled={!ready} aria-label={t.task.shutter} data-testid="photo-shutter"
          className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white/90 bg-transparent transition-transform active:scale-95 disabled:opacity-40">
          <span className="h-14 w-14 rounded-full bg-white" />
        </button>
      </div>
    </div>
  );
}
