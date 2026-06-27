// Pure-logic test for share branding (change: share-branding). The watermark's
// QR destination and box placement are pure so they're unit-tested without a DOM;
// the canvas drawing itself is verified via the preview tools. No emulator.
//   npx tsx scripts/test-watermark.ts
import { resolveShareQrTarget, computeWatermarkLayout } from '../packages/shared/src/shareBranding';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const base = 'https://play.rushpoint.app';

// ── resolveShareQrTarget ─────────────────────────────────────────────────────
check('accessCode → joinable URL', resolveShareQrTarget({ accessCode: 'PLAY01', playBaseUrl: base }) === `${base}/?code=PLAY01`);
check('gameId only → promo URL', resolveShareQrTarget({ gameId: 'g1', playBaseUrl: base }) === `${base}/?game=g1`);
check('accessCode wins over gameId', resolveShareQrTarget({ accessCode: 'C1', gameId: 'g1', playBaseUrl: base }) === `${base}/?code=C1`);
check('neither → base URL', resolveShareQrTarget({ playBaseUrl: base }) === base);
check('trailing slash on base is normalized', resolveShareQrTarget({ playBaseUrl: `${base}/` }) === base);
check('special chars are encoded', resolveShareQrTarget({ accessCode: 'A B', playBaseUrl: base }) === `${base}/?code=A%20B`);

// ── computeWatermarkLayout ───────────────────────────────────────────────────
{
  const W = 1080, H = 1920;
  const L = computeWatermarkLayout({ width: W, height: H });
  const inside = (b: { x: number; y: number; size: number }) =>
    b.x >= L.margin && b.y >= L.margin && b.x + b.size <= W - L.margin && b.y + b.size <= H - L.margin;
  check('logo box is inside the margin', inside(L.logo));
  check('qr box is inside the margin', inside(L.qr));
  check('url line is inside the margin', L.url.x >= L.margin && L.url.x + L.url.maxWidth <= W - L.margin && L.url.maxWidth > 0);
  check('logo and qr do not overlap', L.logo.x + L.logo.size <= L.qr.x || L.qr.x + L.qr.size <= L.logo.x);
  check('stamp clears the centre subject band (sits low)', L.logo.y > H * 0.6 && L.qr.y > H * 0.6);

  // A landscape canvas (recap collage) must also lay out cleanly.
  const L2 = computeWatermarkLayout({ width: 1600, height: 900 });
  check('landscape: boxes inside margin', L2.logo.x >= L2.margin && L2.qr.x + L2.qr.size <= 1600 - L2.margin);
  check('landscape: logo/qr non-overlapping', L2.logo.x + L2.logo.size <= L2.qr.x);
}

console.log(`\n${failures === 0 ? 'ALL WATERMARK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
