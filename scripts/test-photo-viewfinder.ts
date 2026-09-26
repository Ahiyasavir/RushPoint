// The in-app photo camera (change: camera-switch 2.4). Photo missions get the same viewfinder as
// video: front/back switch, a mirrored selfie preview, and the phone's own camera kept as the
// fallback. No component runner exists for play-web, so the shape that matters is pinned in source.
//   npx tsx scripts/test-photo-viewfinder.ts
import fs from 'node:fs';
import path from 'node:path';
import { stillSize, STILL_MAX_EDGE } from '../apps/play-web/src/lib/cameraChoice';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// The still is grabbed at the frame's own size, capped (the upload pipeline downsizes to 1280 anyway).
check('a 1080p frame is kept whole', JSON.stringify(stillSize(1920, 1080)) === JSON.stringify({ width: 1920, height: 1080 }));
check('a 4K frame is capped on its long edge', JSON.stringify(stillSize(3840, 2160)) === JSON.stringify({ width: STILL_MAX_EDGE, height: Math.round(2160 * STILL_MAX_EDGE / 3840) }));
check('portrait capped on its long edge too', stillSize(2160, 3840)?.height === STILL_MAX_EDGE);
check('garbage -> null (the shutter then reports a failure, never a blank photo)', stillSize(0, 100) === null && stillSize(NaN, 5) === null);

const vf = fs.readFileSync(path.join(__dirname, '..', 'apps', 'play-web', 'src', 'components', 'PhotoViewfinder.tsx'), 'utf8');
const tr = fs.readFileSync(path.join(__dirname, '..', 'apps', 'play-web', 'src', 'components', 'TaskRunner.tsx'), 'utf8');
check('the camera open is raced against the deadline (a WebView that never answers)', /withCameraDeadline\(/.test(vf));
check('any failure to open falls back to the phone camera', /onFallback\(\)/.test(vf));
check('the tracks stop on unmount (the camera light never stays on)', /return \(\) => \{[^}]*stopTracks\(\)/.test(vf));
check('the switch is rendered only when a second camera exists', /\{canSwitch && \(/.test(vf) && /data-testid="photo-camera-switch"/.test(vf));
check('the selfie preview is mirrored, the saved still is not', /shouldMirror\(facing\) \? '-scale-x-100' : ''/.test(vf) && !/ctx\.(scale|setTransform)\(/.test(vf));
check('the photo opens on choice > mission default > rear', /initialFacing\(\{ explicit: readCameraChoice\(/.test(vf));
check('a switch remembers the choice for the run', /writeCameraChoice\(/.test(vf));
check('the still goes through the SAME pipeline as a native capture', /acceptPhoto\(file\)/.test(tr) && /async function acceptPhoto\(/.test(tr));
check('the native camera stays reachable from the photo mission', /data-testid="photo-native"/.test(tr));

console.log(failures === 0 ? '\nphoto viewfinder: all passed' : `\nphoto viewfinder: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
