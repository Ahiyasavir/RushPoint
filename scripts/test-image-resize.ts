// Pure-logic test for computeScaledDimensions (change: fix-photo-camera-capture).
// Client-side photo downscale math: aspect-preserving, never upscales, always
// yields finite non-negative dimensions even for junk input. No emulator/DOM.
//   npx tsx scripts/test-image-resize.ts
import {
  computeScaledDimensions,
  chooseUploadBlob,
  nextEncodeStep,
  PHOTO_MAX_EDGE,
  PHOTO_JPEG_QUALITY,
} from '../apps/play-web/src/lib/imageResize';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: { width: number; height: number }, w: number, h: number) => a.width === w && a.height === h;

check('landscape 4000x3000 → 1280x960', eq(computeScaledDimensions(4000, 3000, 1280), 1280, 960), JSON.stringify(computeScaledDimensions(4000, 3000, 1280)));
check('portrait 3000x4000 → 960x1280', eq(computeScaledDimensions(3000, 4000, 1280), 960, 1280));
check('already-small 800x600 not upscaled', eq(computeScaledDimensions(800, 600, 1280), 800, 600));
check('square 2000x2000 → 1280x1280', eq(computeScaledDimensions(2000, 2000, 1280), 1280, 1280));
check('exact-edge 1280x720 unchanged', eq(computeScaledDimensions(1280, 720, 1280), 1280, 720));

// Junk input never yields a non-finite / negative dimension.
for (const d of [
  computeScaledDimensions(0, 0, 1280),
  computeScaledDimensions(-5, 10, 1280),
  computeScaledDimensions(4000, 3000, 0),
  computeScaledDimensions(NaN, 3000, 1280),
  computeScaledDimensions(4000, Infinity, 1280),
]) {
  check('junk input stays finite & non-negative', d.width >= 0 && d.height >= 0 && Number.isFinite(d.width) && Number.isFinite(d.height), JSON.stringify(d));
}

// ── chooseUploadBlob — never upload a re-encode that isn't meaningfully smaller,
// and never silently ship the full-size original without saying so (Task 11).
check('encoded much smaller → encoded', chooseUploadBlob(5_000_000, 400_000) === 'encoded');
check('encoded bigger → original', chooseUploadBlob(400_000, 900_000) === 'original');
check('encoded barely smaller → original', chooseUploadBlob(1_000_000, 990_000) === 'original');
check('junk sizes → original', chooseUploadBlob(NaN, 100) === 'original' && chooseUploadBlob(100, 0) === 'original');

// ── nextEncodeStep — the multi-pass budget must strictly tighten and terminate.
let step: { maxEdge: number; quality: number } | null = { maxEdge: PHOTO_MAX_EDGE, quality: PHOTO_JPEG_QUALITY };
let passes = 0;
let prev = step;
while (step && passes < 20) {
  const next = nextEncodeStep(step);
  if (!next) break;
  check('encode step tightens', next.quality < prev.quality || next.maxEdge < prev.maxEdge,
    JSON.stringify({ prev, next }));
  check('encode step stays sane', next.quality > 0 && next.quality <= 1 && next.maxEdge >= 320,
    JSON.stringify(next));
  prev = next; step = next; passes++;
}
check('encode plan terminates', passes > 0 && passes < 20, `passes=${passes}`);

console.log(`\n${failures === 0 ? 'ALL IMAGE-RESIZE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
