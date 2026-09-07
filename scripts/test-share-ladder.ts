// The share ladder (change: share-ladder-unification).
//
// Five surfaces — the finish story card, the podium, a task photo, the challenge
// teaser and the run recap — each hand-rolled the same native-share/download/
// clipboard sequence, and drifted. Two defects survived every gate because both
// are invisible on the machine the code was written on:
//
//   (1) Dismissing the OS share sheet rejects with `AbortError`. Three of the five
//       ladders mapped that to 'failed', which `shareOutcomeFeedback` turns into a
//       visible "couldn't share" notice — so call sites suppressed the notice on
//       'failed' entirely, and a GENUINE failure became a dead button on the one
//       screen the whole viral loop runs through.
//   (2) `URL.revokeObjectURL` ran on the line after `a.click()`, racing the
//       browser's own read of the blob. Chrome tolerates it; Firefox and older
//       WebKit silently download nothing.
//
// These assertions are the contract that keeps the sixth surface from re-deriving
// the sequence and re-introducing either one.
import {
  routeShare, nativeShare, isShareCancel, canNativeShare, downloadBlob, copyText,
  type ShareNav, type ShareOutcome,
} from '../apps/play-web/src/lib/shareLadder';
import { shareOutcomeFeedback } from '../apps/play-web/src/lib/shareFeedback';

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n[share ladder] cancellation is not failure');

// ── The cancel predicate ───────────────────────────────────────────────────────
const abort = Object.assign(new Error('share canceled'), { name: 'AbortError' });
ok(isShareCancel(abort), 'an AbortError is a cancellation');
ok(isShareCancel({ name: 'NotAllowedError' }),
  'a NotAllowedError (iOS, share outside a user gesture) is also treated as a dismissal');
ok(!isShareCancel(new TypeError('boom')), 'an ordinary error is NOT a cancellation');
ok(!isShareCancel(null) && !isShareCancel(undefined) && !isShareCancel('AbortError'),
  'the predicate is total: null / undefined / a bare string are not cancellations');

// ── The outcome union survives the round trip to feedback ─────────────────────
ok(shareOutcomeFeedback('cancelled') === 'silent',
  'a cancellation stays silent — the player already knows they backed out');
ok(shareOutcomeFeedback('failed') === 'fallback',
  'a real failure is VISIBLE — this is the case the drifted ladders could not express');
for (const good of ['shared', 'downloaded', 'copied'] as const) {
  ok(shareOutcomeFeedback(good) === 'confirm', `'${good}' confirms`);
}

// ── Fakes ─────────────────────────────────────────────────────────────────────
function fakeNav(opts: {
  share?: (d: unknown) => Promise<void>;
  canShare?: boolean;
  writeText?: (s: string) => Promise<void>;
}): ShareNav {
  const n: Record<string, unknown> = {};
  if (opts.share) n.share = opts.share;
  if (opts.canShare !== undefined) n.canShare = () => opts.canShare!;
  n.clipboard = { writeText: opts.writeText ?? (async () => { throw new Error('no clipboard'); }) };
  return n as unknown as ShareNav;
}
const blob = { size: 4, type: 'image/png' } as unknown as Blob;

console.log('\n[share ladder] canNativeShare is a RUNTIME check');
ok(canNativeShare(fakeNav({ share: async () => undefined })) === true,
  'present when navigator.share is a function');
ok(canNativeShare(fakeNav({})) === false,
  'absent on desktop Firefox / insecure contexts — lib.dom types it as REQUIRED, so a bare `if (nav.share)` narrows to always-true and asserts nothing');

console.log('\n[share ladder] nativeShare maps rejections');
void (async () => {
  const cancelled = await nativeShare(fakeNav({ share: async () => { throw abort; } }), { text: 'x' });
  ok(cancelled === 'cancelled', 'a dismissed sheet resolves "cancelled", never "failed"');
  const failed = await nativeShare(fakeNav({ share: async () => { throw new TypeError('nope'); } }), { text: 'x' });
  ok(failed === 'failed', 'a genuine error resolves "failed"');
  const shared = await nativeShare(fakeNav({ share: async () => undefined }), { text: 'x' });
  ok(shared === 'shared', 'a resolved share resolves "shared"');

  console.log('\n[share ladder] routeShare walks the channels in order');

  // A dismissal ENDS the ladder. Falling through to a download would hand the
  // player a file they just declined to share — the app overriding a "no".
  let downloadAttempted = false;
  const origDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => { downloadAttempted = true; return { style: {}, click() {}, remove() {} }; },
    body: { appendChild() {} },
  };
  const origURL = (globalThis as { URL?: unknown }).URL;
  (globalThis as { URL?: unknown }).URL = {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => undefined,
  };

  const cancelledRoute = await routeShare({
    blob, filename: 'a.png', text: 'hi',
    nav: fakeNav({ canShare: true, share: async () => { throw abort; } }),
  });
  ok(cancelledRoute === 'cancelled', 'a dismissed file-share ends the ladder as "cancelled"');
  ok(downloadAttempted === false,
    'and does NOT silently download the file anyway — the player said no');

  // A genuine file-share failure DOES fall through: the content still has to land.
  downloadAttempted = false;
  const fellThrough = await routeShare({
    blob, filename: 'a.png', text: 'hi',
    nav: fakeNav({ canShare: true, share: async () => { throw new TypeError('nope'); } }),
  });
  ok(fellThrough === 'downloaded', 'a genuine file-share failure falls through to the download');
  ok(downloadAttempted === true, 'and the download really was attempted');

  // ── The revoke race ─────────────────────────────────────────────────────────
  console.log('\n[share ladder] the object URL outlives the click');
  let revokedAt: number | null = null;
  let clickedAt: number | null = null;
  let tick = 0;
  const timers: Array<() => void> = [];
  const origTimeout = globalThis.setTimeout;
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => { timers.push(fn); return 0; }) as unknown as typeof setTimeout;
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ style: {}, click() { clickedAt = ++tick; }, remove() {} }),
    body: { appendChild() {} },
  };
  (globalThis as { URL?: unknown }).URL = {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => { revokedAt = ++tick; },
  };

  const saved = downloadBlob(blob, 'a.png');
  ok(saved === true, 'downloadBlob reports success when there is a DOM to download into');
  ok(clickedAt !== null, 'the anchor was clicked');
  ok(revokedAt === null,
    'the object URL is NOT revoked synchronously after the click — a same-tick revoke races the browser’s read of the blob and silently yields an empty file outside Chrome');
  timers.forEach((fn) => fn());
  ok(revokedAt !== null, 'it IS revoked on a later task, so nothing leaks');
  (globalThis as { setTimeout: unknown }).setTimeout = origTimeout;

  // No DOM at all ⇒ report failure rather than a download that never happened.
  (globalThis as { document?: unknown }).document = undefined;
  ok(downloadBlob(blob, 'a.png') === false,
    'with no DOM, downloadBlob returns false instead of claiming a success');

  // ── The clipboard floor ─────────────────────────────────────────────────────
  console.log('\n[share ladder] the ladder always reaches a floor');
  let copied = '';
  const noShare = await routeShare({
    blob: null, filename: 'a.png', text: 'caption', url: 'https://x.test',
    nav: fakeNav({ writeText: async (s: string) => { copied = s; } }),
  });
  ok(noShare === 'copied', 'with no card and no share API, the ladder falls to the clipboard');
  ok(copied === 'caption https://x.test',
    'and the copied text carries BOTH the caption and the link');

  const denied = await copyText('x', fakeNav({ writeText: async () => { throw new Error('denied'); } }));
  ok(denied === 'failed', 'a denied clipboard resolves "failed" — it never throws at the call site');

  const allFailed: ShareOutcome = await routeShare({
    blob: null, filename: 'a.png', text: 'caption', nav: fakeNav({}),
  });
  ok(allFailed === 'failed',
    'when every channel is unavailable the result is "failed", which shareOutcomeFeedback makes VISIBLE');

  (globalThis as { document?: unknown }).document = origDoc;
  (globalThis as { URL?: unknown }).URL = origURL;

  console.log(failures === 0 ? '\n✅ share ladder: ALL PASS\n' : `\n❌ share ladder: ${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
