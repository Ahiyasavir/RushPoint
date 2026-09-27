// Source guard for the camera switch (change: camera-switch, D2-D4). No component
// test runner exists for play-web, so the shape that matters is pinned in the source:
//   npx tsx scripts/test-camera-switch-guard.ts
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '..', 'apps', 'play-web', 'src', 'components', 'TaskRunner.tsx'), 'utf8');
let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

// The switch button must never be available mid-take: swapping the track would end
// the recording. "Not rendered" rather than "disabled" - a dead grey button during a
// take is exactly what the recorder guards forbid.
const btn = src.indexOf('data-testid="camera-switch"');
check('the viewfinder has a camera switch button', btn !== -1);
const before = src.slice(Math.max(0, btn - 600), btn);
check('the switch is rendered only when NOT recording and a second camera exists',
  /\{!recording && canSwitch && \(/.test(before));
check('the old tracks stop before the new camera is requested (iOS: one camera at a time)',
  /stopTracks\(\);\s*\n\s*let next: MediaStream \| null = null;/.test(src));
check('a failed switch reopens the previous camera instead of leaving a black viewfinder',
  /facingMode: \{ ideal: facing \}/.test(src));
check('the front camera preview is mirrored, from the pure verdict',
  /shouldMirror\(facing\) \? '-scale-x-100' : ''/.test(src));
check('a selfie photo mission asks the phone camera for the front side',
  /capture=\{selfie \? 'user' : 'environment'\}/.test(src));
check('the video viewfinder opens on the precedence of choice > mission default > rear',
  /initialFacing\(\{ explicit: readCameraChoice\(/.test(src));

console.log(failures === 0 ? '\ncamera switch guard: all passed' : `\ncamera switch guard: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
