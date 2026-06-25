// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Marketing & virality (share branding + run recap)
// ───────────────────────────────────────────────────────────────────────────
// See v21-data-and-scalability.todo.test.ts for how to use this file. Each test.todo is one
// numbered requirement/scenario from the OpenSpec changes; these become the failing tests written
// first when each change is implemented via /opsx:apply.
//   OpenSpec changes:
//     openspec/changes/share-branding/  (logo + link + QR on every shared image)
//     openspec/changes/run-recap/       (competition summary + everyone's photos)
//   Lane tags: [pure] → scripts/test-*.ts (no DOM/emulator) · [e2e] → scripts/e2e-verify.mjs ·
//              [ui] → preview tools.
import { describe, test } from 'vitest';

describe('share-branding — universal logo + link + QR on every shared image', () => {
  // Requirement: every shared image carries a scannable QR (resolveShareQrTarget)
  test.todo('[pure] resolveShareQrTarget(accessCode) → `<playBaseUrl>/?code=<accessCode>` (joinable)');
  test.todo('[pure] resolveShareQrTarget(gameId only) → `<playBaseUrl>/?game=<gameId>` (promo)');
  test.todo('[pure] resolveShareQrTarget(neither) → the generic app base URL');
  // Requirement: every shared image carries the brand stamp (computeWatermarkLayout)
  test.todo('[pure] computeWatermarkLayout: logo, QR, and URL boxes all sit inside the configured margin');
  test.todo('[pure] computeWatermarkLayout: logo box and QR box never overlap each other');
  test.todo('[pure] computeWatermarkLayout: brand boxes stay clear of the center subject band');
  // Requirement: story card uses the shared stamp
  test.todo('[ui] story card renders the logo mark + app URL + scannable QR on the side (not center)');
  // Requirement: participants can share an individual task photo, watermarked
  test.todo('[ui] "share photo" on a completed photo task brands the image and opens the share sheet');
  // Requirement: branding degrades gracefully and never blocks a share
  test.todo('[ui] logo image fails to load → watermark falls back to the RUSHPOINT text wordmark, share still completes');
  test.todo('[ui] cross-origin photo taints the canvas → falls back to original URL + branded caption, no throw');
});

describe('run-recap — competition summary + everyone\'s photos', () => {
  // Requirement: getRunRecap returns the competition summary with everyone's photos
  test.todo('[pure] buildRunRecap: standings reuse the shared ranking order (cannot drift from leaderboard)');
  test.todo('[pure] buildRunRecap: stats report correct teamCount, photoCount, winnerName');
  test.todo('[e2e] owner getRunRecap on a finalized run → ordered standings + approved photos from every team');
  // Requirement: recap photos respect moderation and retention
  test.todo('[pure] buildRunRecap: only approved/correct photos included; rejected + photo_pending excluded');
  test.todo('[pure] buildRunRecap: pruned/cleared photoUrl ⇒ photos:[] with standings + stats intact (no error)');
  // Requirement: public recap is gated to published runs
  test.todo('[e2e] non-owner getRunRecap on an UNPUBLISHED run → permission-denied / no recap exposed');
  test.todo('[e2e] after publish, a non-owner getRunRecap returns the public recap (mirrors getPublicLeaderboard gate)');
  test.todo('[ui] ?recap=<accessCode> public route renders standings + photo montage (published-only)');
  // Requirement: recap renders a branded photo montage
  test.todo('[pure] computeMontageGrid: non-overlapping, in-bounds, square-balanced cells for 1/4/9/20+ photos');
  test.todo('[pure] computeMontageGrid: beyond the tile cap, overflow "+N" count is reported (no canvas overflow)');
  test.todo('[ui] "Share recap" builds a branded collage (montage + logo + link + QR) via the share-branding stamp');
  test.todo('[ui] creator RunConsole post-finalize "Share recap" surfaces the ?recap= link via ShareSheet');
});
