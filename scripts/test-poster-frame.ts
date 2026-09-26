// The poster frame a video submission carries (change: video-upload-speed, D7).
//   npx tsx scripts/test-poster-frame.ts
import { posterSize, POSTER_MAX_WIDTH, posterTaskId } from '../apps/play-web/src/lib/posterFrame';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
check('max width is 480', POSTER_MAX_WIDTH === 480);
const l = posterSize(1280, 720);
check('landscape 720p -> 480x270', l?.width === 480 && l?.height === 270, JSON.stringify(l));
const p = posterSize(720, 1280);
check('portrait keeps its aspect', p?.width === 480 && p?.height === 853, JSON.stringify(p));
const s = posterSize(320, 240);
check('a small frame is never upscaled', s?.width === 320 && s?.height === 240, JSON.stringify(s));
for (const bad of [[0, 720], [1280, 0], [NaN, 5], [-1, 5], [Infinity, 5]]) {
  check(`garbage size ${JSON.stringify(bad)} -> null (no poster, never a throw)`, posterSize(bad[0], bad[1]) === null);
}
check('poster lands in the same task folder under its own name', posterTaskId('t-1') === 't-1-poster');
console.log(failures === 0 ? '\nposter frame: all passed' : `\nposter frame: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
