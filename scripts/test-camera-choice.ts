// Pure tests for switching between the front and back camera (change: camera-switch, D2-D4).
//
// Players filming a selfie mission had no way to turn the camera around: the in-app viewfinder
// always opened the rear camera and offered no switch. This file pins the decisions behind the
// switch button, which have to hold on browsers that hide device labels until permission is
// granted and on iOS, which allows only one open camera at a time.
//   npx tsx scripts/test-camera-choice.ts
import {
  canSwitchCamera, facingFromLabel, planCameraSwitch, shouldMirror, initialFacing,
  readCameraChoice, writeCameraChoice,
} from '../apps/play-web/src/lib/cameraChoice';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const cam = (deviceId: string, label = '') => ({ kind: 'videoinput', deviceId, label });
const mic = (deviceId: string) => ({ kind: 'audioinput', deviceId, label: '' });

// ── is a switch possible at all? ─────────────────────────────────────────────
check('no devices -> no switch', canSwitchCamera([]) === false);
check('one camera -> no switch (a dead button is worse than none)', canSwitchCamera([cam('a'), mic('m')]) === false);
check('two cameras -> switch', canSwitchCamera([cam('a'), cam('b')]) === true);
check('microphones do not count as cameras', canSwitchCamera([cam('a'), mic('m1'), mic('m2')]) === false);
check('garbage input -> no switch, never a throw', canSwitchCamera(null as never) === false);

// ── labels ──────────────────────────────────────────────────────────────────
check('"Front Camera" is the user side', facingFromLabel('Front Camera') === 'user');
check('"camera2 1, facing front" is the user side', facingFromLabel('camera2 1, facing front') === 'user');
check('"Back Triple Camera" is the environment side', facingFromLabel('Back Triple Camera') === 'environment');
check('"camera2 0, facing back" is the environment side', facingFromLabel('camera2 0, facing back') === 'environment');
check('"FaceTime HD Camera" is the user side', facingFromLabel('FaceTime HD Camera') === 'user');
check('an unhelpful label says nothing', facingFromLabel('USB Camera (1234:abcd)') === null);
check('an empty label (permission not granted yet) says nothing', facingFromLabel('') === null);

// ── the switch plan ─────────────────────────────────────────────────────────
{
  const labelled = [cam('back1', 'Back Camera'), cam('front1', 'Front Camera')];
  const p = planCameraSwitch({ devices: labelled, currentFacing: 'environment', currentDeviceId: 'back1' });
  check('labelled: rear -> the labelled front deviceId', p?.kind === 'deviceId' && p.deviceId === 'front1', JSON.stringify(p));
  check('labelled: the plan says which way the new camera faces', p?.facing === 'user');
  const back = planCameraSwitch({ devices: labelled, currentFacing: 'user', currentDeviceId: 'front1' });
  check('labelled: front -> the labelled back deviceId', back?.kind === 'deviceId' && back.deviceId === 'back1', JSON.stringify(back));
}
{
  const unlabelled = [cam('x'), cam('y'), cam('z')];
  const p = planCameraSwitch({ devices: unlabelled, currentFacing: 'environment', currentDeviceId: 'x' });
  check('unlabelled: ask for the exact opposite facing', p?.kind === 'facing' && p.facing === 'user', JSON.stringify(p));
  check('unlabelled: with the NEXT deviceId as the fallback cycle', p?.kind === 'facing' && p.fallbackDeviceId === 'y');
  const wrap = planCameraSwitch({ devices: unlabelled, currentFacing: 'user', currentDeviceId: 'z' });
  check('unlabelled: the cycle wraps around', wrap?.kind === 'facing' && wrap.fallbackDeviceId === 'x' && wrap.facing === 'environment', JSON.stringify(wrap));
}
{
  const p = planCameraSwitch({ devices: [cam('x'), cam('y')], currentFacing: null, currentDeviceId: null });
  check('unknown current camera: assume the rear default and ask for the front', p?.kind === 'facing' && p.facing === 'user', JSON.stringify(p));
  check('unknown current deviceId: the fallback is the first camera', p?.kind === 'facing' && p.fallbackDeviceId === 'x');
}
check('one camera -> no plan', planCameraSwitch({ devices: [cam('a')], currentFacing: 'environment', currentDeviceId: 'a' }) === null);
{
  // A label that names the opposite side but is the device already open must not be chosen:
  // "switching" to the same camera is the dead button this module exists to avoid.
  const p = planCameraSwitch({ devices: [cam('a', 'Front Camera'), cam('b')], currentFacing: 'environment', currentDeviceId: 'a' });
  check('never plans a switch to the device already open', !(p?.kind === 'deviceId' && p.deviceId === 'a'), JSON.stringify(p));
}

// ── mirroring ───────────────────────────────────────────────────────────────
check('front camera preview is mirrored', shouldMirror('user') === true);
check('rear camera preview is not mirrored', shouldMirror('environment') === false);
check('unknown facing is not mirrored', shouldMirror(null) === false);

// ── which camera opens first ────────────────────────────────────────────────
check('nothing set -> rear', initialFacing({}) === 'environment');
check('selfie mission -> front', initialFacing({ taskDefault: 'front' }) === 'user');
check('player chose rear on a selfie mission -> rear (the explicit choice wins)',
  initialFacing({ taskDefault: 'front', explicit: 'environment' }) === 'environment');
check('player chose front on a normal mission -> front', initialFacing({ explicit: 'user' }) === 'user');
check('an unknown task default is ignored', initialFacing({ taskDefault: 'sideways' as never }) === 'environment');

// ── remembering the choice ──────────────────────────────────────────────────
{
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  check('nothing remembered yet', readCameraChoice(storage, 'run1') === null);
  writeCameraChoice(storage, 'run1', 'user');
  check('the choice is read back for the same run', readCameraChoice(storage, 'run1') === 'user');
  check('another run does not inherit it', readCameraChoice(storage, 'run2') === null);
  store.set([...store.keys()][0], 'garbage');
  check('a corrupted value reads as nothing', readCameraChoice(storage, 'run1') === null);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  check('storage that throws reads as nothing', readCameraChoice(broken, 'run1') === null);
  let threw = false;
  try { writeCameraChoice(broken, 'run1', 'user'); } catch { threw = true; }
  check('storage that throws never breaks a write', threw === false);
  check('no storage at all reads as nothing', readCameraChoice(null, 'run1') === null);
}

console.log(failures === 0 ? '\ncamera choice: all passed' : `\ncamera choice: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
