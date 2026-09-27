// Pure-logic tests — what Content-Type the API declares for a stored object
// (change: media-serving-correctness).
//
// The motivating defect: `functions/server.js` mapped '.webm' to 'audio/webm' and
// also sent `X-Content-Type-Options: nosniff`, so a participant's Android video
// was declared audio AND the browser was forbidden from correcting it. Four of
// seven videos in production run ijI9JMITSf8C9heN1Cwp were unviewable for exactly
// this reason; the three iOS `.mp4` ones worked, which is why it looked random.
//
// The rule these assertions pin: an INCONCLUSIVE probe falls back to the extension
// table, never to a guess. That makes the change strictly additive — it can only
// upgrade a `.webm` from audio to video, never the reverse — so nothing that
// renders today can stop rendering.
//
// Pure: takes a filename and a Buffer, touches no fs. Runs via `npm test`.
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const {
  EXTENSION_TYPES,
  AMBIGUOUS_EXTENSIONS,
  DEFAULT_CONTENT_TYPE,
  PROBE_PREFIX_BYTES,
  probeWebmHasVideo,
  resolveContentType,
} = require_('../functions/mediaServing.js');

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

/** A synthetic EBML-ish prefix carrying the given CodecID markers. */
function webmPrefix(...codecIds: string[]): Buffer {
  const head = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // EBML magic
  const filler = Buffer.alloc(64, 0x00);
  const marks = codecIds.map((c) => Buffer.concat([Buffer.alloc(3, 0x86), Buffer.from(c, 'ascii')]));
  return Buffer.concat([head, filler, ...marks, filler]);
}

console.log('\nmedia-serving — resolveContentType');

// ── 1. The defect itself: an Android video recording ──────────────────────────
{
  eq('a .webm carrying a V_VP8 video track is video/webm',
    resolveContentType('clip.webm', webmPrefix('V_VP8', 'A_OPUS')), 'video/webm');
  eq('a .webm carrying V_VP9 is video/webm',
    resolveContentType('clip.webm', webmPrefix('V_VP9')), 'video/webm');
  eq('a .webm carrying V_AV1 is video/webm',
    resolveContentType('clip.webm', webmPrefix('V_AV1')), 'video/webm');
}

// ── 2. A genuine audio recording stays audio ──────────────────────────────────
{
  eq('a .webm carrying only A_OPUS stays audio/webm',
    resolveContentType('voice.webm', webmPrefix('A_OPUS')), 'audio/webm');
  eq('a .webm carrying only A_VORBIS stays audio/webm',
    resolveContentType('voice.webm', webmPrefix('A_VORBIS')), 'audio/webm');
}

// ── 3. Inconclusive falls back to the table — the additive guarantee ──────────
{
  eq('an empty prefix falls back to the table',
    resolveContentType('x.webm', Buffer.alloc(0)), 'audio/webm');
  eq('a truncated prefix falls back to the table',
    resolveContentType('x.webm', Buffer.from([0x1a, 0x45])), 'audio/webm');
  eq('a random prefix with no CodecID falls back to the table',
    resolveContentType('x.webm', Buffer.alloc(4096, 0x5a)), 'audio/webm');
  eq('a missing prefix falls back to the table',
    resolveContentType('x.webm', undefined), 'audio/webm');
  eq('a non-Buffer prefix falls back to the table',
    resolveContentType('x.webm', 'V_VP8' as unknown as Buffer), 'audio/webm');
  eq('a null prefix falls back to the table',
    resolveContentType('x.webm', null), 'audio/webm');
}

// ── 4. Unambiguous extensions never consult the probe ─────────────────────────
{
  // A .mp4 whose bytes happen to contain the marker must STILL be video/mp4 from
  // the table, and an image must not be reclassified by a hostile payload.
  eq('.jpg is image/jpeg', resolveContentType('a.jpg', webmPrefix('V_VP8')), 'image/jpeg');
  eq('.jpeg is image/jpeg', resolveContentType('a.jpeg', undefined), 'image/jpeg');
  eq('.png is image/png', resolveContentType('a.png', webmPrefix('V_VP8')), 'image/png');
  eq('.mp4 is video/mp4', resolveContentType('a.mp4', webmPrefix('A_OPUS')), 'video/mp4');
  eq('.mov is video/quicktime', resolveContentType('a.mov', undefined), 'video/quicktime');
  eq('.m4a stays audio/mp4', resolveContentType('a.m4a', webmPrefix('V_VP8')), 'audio/mp4');
  ok('only .webm is declared ambiguous',
    Array.from(AMBIGUOUS_EXTENSIONS).join(',') === '.webm',
    Array.from(AMBIGUOUS_EXTENSIONS).join(','));
}

// ── 5. Totality — every input yields a non-empty type, nothing throws ─────────
{
  eq('an unknown extension is octet-stream',
    resolveContentType('a.xyz', undefined), DEFAULT_CONTENT_TYPE);
  eq('no extension at all is octet-stream',
    resolveContentType('README', undefined), DEFAULT_CONTENT_TYPE);
  eq('an uppercase extension is matched case-insensitively',
    resolveContentType('A.WEBM', webmPrefix('V_VP8')), 'video/webm');
  for (const bad of [null, undefined, 42, {}, [], '']) {
    let threw = false;
    let out: unknown = null;
    try { out = resolveContentType(bad as unknown as string, undefined); } catch { threw = true; }
    ok(`a ${JSON.stringify(bad)} filename does not throw and yields a type`,
      !threw && typeof out === 'string' && (out as string).length > 0, String(out));
  }
  const emptyType = Object.entries(EXTENSION_TYPES)
    .filter(([, v]) => typeof v !== 'string' || !v)
    .map(([k]) => k);
  ok(`every EXTENSION_TYPES entry yields a non-empty type :: ${Object.keys(EXTENSION_TYPES).length} checked`,
    emptyType.length === 0, emptyType.join(','));
}

// ── 6. The probe itself is total and never throws ─────────────────────────────
{
  for (const bad of [null, undefined, '', 0, {}, [], Buffer.alloc(0)]) {
    let threw = false;
    try { probeWebmHasVideo(bad as unknown as Buffer); } catch { threw = true; }
    ok(`probeWebmHasVideo(${JSON.stringify(bad)}) does not throw`, !threw);
  }
  eq('a marker split by nothing is still found', probeWebmHasVideo(webmPrefix('V_VP8')), true);
  eq('an audio-only prefix probes false', probeWebmHasVideo(webmPrefix('A_OPUS')), false);
  ok('the probe prefix bound is a positive finite number',
    typeof PROBE_PREFIX_BYTES === 'number' && PROBE_PREFIX_BYTES > 0 && Number.isFinite(PROBE_PREFIX_BYTES),
    String(PROBE_PREFIX_BYTES));
}

console.log('');
if (failures > 0) {
  console.error(`✗ media-content-type: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ media-content-type: all assertions passed');
