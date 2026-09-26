// Front / back camera decisions for the in-app viewfinder (change: camera-switch, D2-D4).
//
// Pure: no getUserMedia, no DOM. The viewfinder hands in what `enumerateDevices()` and the open
// track report, and gets back what to ask for next. Every function is total: garbage in means
// "no switch" / "rear camera", never a throw, because a camera that fails to open is a mission a
// team cannot finish.

export type Facing = 'user' | 'environment';

export interface CameraDevice {
  kind: string;
  deviceId: string;
  label?: string;
}

export type CameraSwitchPlan =
  /** Labels identified the other side: ask for exactly this device. */
  | { kind: 'deviceId'; deviceId: string; facing: Facing }
  /** Labels are hidden or unhelpful: ask for `facingMode: { exact }`, and on an
   *  OverconstrainedError cycle to `fallbackDeviceId`. */
  | { kind: 'facing'; facing: Facing; fallbackDeviceId: string | null };

function cameras(devices: readonly CameraDevice[] | null | undefined): CameraDevice[] {
  if (!Array.isArray(devices)) return [];
  return devices.filter((d): d is CameraDevice =>
    !!d && d.kind === 'videoinput' && typeof d.deviceId === 'string' && d.deviceId !== '');
}

/** A switch button is shown only when there is a second camera to switch to. */
export function canSwitchCamera(devices: readonly CameraDevice[] | null | undefined): boolean {
  return cameras(devices).length >= 2;
}

const FRONT = /\b(front|user|facetime|selfie)\b|קדמית/i;
const BACK = /\b(back|rear|environment)\b|אחורית/i;

/** What a device label says about which way it faces, or null when it says nothing
 *  (labels are empty until the page holds camera permission). */
export function facingFromLabel(label: string | null | undefined): Facing | null {
  if (typeof label !== 'string' || !label) return null;
  if (FRONT.test(label)) return 'user';
  if (BACK.test(label)) return 'environment';
  return null;
}

export function planCameraSwitch(input: {
  devices: readonly CameraDevice[] | null | undefined;
  currentFacing: Facing | null | undefined;
  currentDeviceId: string | null | undefined;
}): CameraSwitchPlan | null {
  const cams = cameras(input.devices);
  if (cams.length < 2) return null;
  // An unknown current camera is treated as the rear default, the side every
  // viewfinder opens on unless told otherwise.
  const current: Facing = input.currentFacing === 'user' ? 'user' : 'environment';
  const next: Facing = current === 'user' ? 'environment' : 'user';

  const labelled = cams.find((c) => c.deviceId !== input.currentDeviceId && facingFromLabel(c.label) === next);
  if (labelled) return { kind: 'deviceId', deviceId: labelled.deviceId, facing: next };

  const at = cams.findIndex((c) => c.deviceId === input.currentDeviceId);
  const fallback = at === -1 ? cams[0] : cams[(at + 1) % cams.length];
  return { kind: 'facing', facing: next, fallbackDeviceId: fallback?.deviceId ?? null };
}

/** The front camera's preview is mirrored, like the system camera. The saved photo
 *  and the recorded clip are NOT: players send what others see. */
export function shouldMirror(facing: Facing | null | undefined): boolean {
  return facing === 'user';
}

/** Which side opens first: the player's own choice this run, then the mission's
 *  "selfie" default, then the rear camera. */
export function initialFacing(input: {
  explicit?: Facing | null;
  taskDefault?: 'front' | 'back' | null;
}): Facing {
  if (input.explicit === 'user' || input.explicit === 'environment') return input.explicit;
  if (input.taskDefault === 'front') return 'user';
  return 'environment';
}

export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const key = (runId: string) => `rp-camera-facing:${runId}`;

/** The player's last explicit choice in this run, or null. Storage that is absent,
 *  blocked or holding garbage reads as "nothing remembered". */
export function readCameraChoice(storage: ChoiceStorage | null | undefined, runId: string): Facing | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(key(runId));
    return v === 'user' || v === 'environment' ? v : null;
  } catch {
    return null;
  }
}

export function writeCameraChoice(storage: ChoiceStorage | null | undefined, runId: string, facing: Facing): void {
  if (!storage) return;
  try { storage.setItem(key(runId), facing); } catch { /* private mode / blocked: the choice is simply not remembered */ }
}
