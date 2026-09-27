// Pure-logic tests — the HTTP Range decision (change: media-serving-correctness).
//
// `GET /uploads/*` ended in a bare `createReadStream(path).pipe(res)`: no
// Accept-Ranges, no Content-Length, no 206. Production run ijI9JMITSf8C9heN1Cwp
// carried 68MB of participant video in 6.9-14.7MB objects, so nothing could be
// previewed before it fully downloaded and the organizer approved submissions
// without watching them.
//
// This function decides ONLY which byte window to serve. It is total and never
// throws: a malformed or absent header must degrade to a plain 200, because the
// alternative is a media route that 500s on a header the client is free to send.
// The containment guards in the route run BEFORE this and are not its business.
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { parseRange } = require_('../functions/mediaServing.js');

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function window_(label: string, header: unknown, total: number,
  want: { status: number; start?: number; end?: number }): void {
  let got: { status: number; start: number; end: number } | null = null;
  let threw = false;
  try { got = parseRange(header, total); } catch (e) { threw = true; got = { status: -1, start: -1, end: -1 }; void e; }
  const matches = !threw && !!got && got.status === want.status
    && (want.start === undefined || got.start === want.start)
    && (want.end === undefined || got.end === want.end);
  ok(`${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, matches);
}

console.log('\nmedia-serving — parseRange');

// ── 1. The ordinary cases a video player actually sends ───────────────────────
{
  window_('bytes=0-99 of 1000 serves the first 100 bytes', 'bytes=0-99', 1000, { status: 206, start: 0, end: 99 });
  window_('bytes=500- runs to the last byte', 'bytes=500-', 1000, { status: 206, start: 500, end: 999 });
  window_('bytes=-200 is the last 200 bytes', 'bytes=-200', 1000, { status: 206, start: 800, end: 999 });
  window_('bytes=0- is the whole object as a 206', 'bytes=0-', 1000, { status: 206, start: 0, end: 999 });
  window_('a suffix longer than the object is clamped to the object',
    'bytes=-5000', 1000, { status: 206, start: 0, end: 999 });
  window_('an end past the object is clamped to the last byte',
    'bytes=900-99999', 1000, { status: 206, start: 900, end: 999 });
  window_('a single byte is a legal window', 'bytes=7-7', 1000, { status: 206, start: 7, end: 7 });
  window_('whitespace around the header is tolerated', '  bytes=0-9  ', 1000, { status: 206, start: 0, end: 9 });
  window_('a case-varied unit is tolerated', 'BYTES=0-9', 1000, { status: 206, start: 0, end: 9 });
}

// ── 2. Unsatisfiable ranges are 416, not a lie ────────────────────────────────
{
  window_('a start past the end is 416', 'bytes=5000-6000', 1000, { status: 416 });
  window_('a start exactly at the length is 416', 'bytes=1000-', 1000, { status: 416 });
  window_('any range on a zero-byte object is 416', 'bytes=0-0', 0, { status: 416 });
  window_('a suffix of zero bytes is 416', 'bytes=-0', 1000, { status: 416 });
  window_('a reversed window is 416', 'bytes=500-100', 1000, { status: 416 });
}

// ── 3. Anything unparseable degrades to a plain 200 ───────────────────────────
{
  window_('a non-numeric range is a plain 200', 'bytes=abc-def', 1000, { status: 200 });
  window_('an unknown unit is a plain 200', 'items=0-10', 1000, { status: 200 });
  window_('an empty range spec is a plain 200', 'bytes=', 1000, { status: 200 });
  window_('a bare dash is a plain 200', 'bytes=-', 1000, { status: 200 });
  window_('an empty header is a plain 200', '', 1000, { status: 200 });
  window_('an absent header is a plain 200', undefined, 1000, { status: 200 });
  window_('a null header is a plain 200', null, 1000, { status: 200 });
  window_('a non-string header is a plain 200', 42, 1000, { status: 200 });
  window_('an object header is a plain 200', {}, 1000, { status: 200 });
  window_('an array header is a plain 200', ['bytes=0-9'], 1000, { status: 200 });
  // Multi-range is legal HTTP but needs multipart/byteranges to answer honestly.
  // Serving only the first part while claiming to satisfy the request would be a
  // lie, so it degrades to the whole entity.
  window_('a multi-range request degrades to a plain 200', 'bytes=0-9,20-29', 1000, { status: 200 });
  window_('a negative total is a plain 200', 'bytes=0-9', -1, { status: 200 });
  window_('a NaN total is a plain 200', 'bytes=0-9', Number.NaN, { status: 200 });
  window_('a fractional total is a plain 200', 'bytes=0-9', 10.5, { status: 200 });
}

// ── 4. The invariant, swept ───────────────────────────────────────────────────
// Any 206 this function returns MUST name a window that really exists in the
// object. A route that streamed `{start, end}` outside the file would hang or
// send fewer bytes than its own Content-Length promised.
{
  let seed = 0x2f6e2b1;
  const rnd = (n: number): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const totals = [0, 1, 2, 999, 1000, 1024 * 1024];
  let violations = 0;
  let sweeps = 0;
  let sawPartial = 0;
  for (let i = 0; i < 4000; i++) {
    const total = totals[rnd(totals.length)];
    const a = rnd(2200) - 100;
    const b = rnd(2200) - 100;
    const shape = rnd(4);
    const header = shape === 0 ? `bytes=${a}-${b}`
      : shape === 1 ? `bytes=${a}-`
      : shape === 2 ? `bytes=-${b}`
      : `bytes=${a}`;
    sweeps++;
    let r: { status: number; start: number; end: number };
    try { r = parseRange(header, total); } catch { violations++; continue; }
    if (![200, 206, 416].includes(r.status)) { violations++; continue; }
    if (r.status !== 206) continue;
    sawPartial++;
    if (!(Number.isInteger(r.start) && Number.isInteger(r.end)
      && r.start >= 0 && r.start <= r.end && r.end < total)) violations++;
  }
  ok(`every 206 names a window inside the object :: ${sweeps} sweeps, ${sawPartial} partial`,
    violations === 0, `${violations} violation(s)`);
  ok('the sweep actually exercised the partial path', sawPartial > 100, String(sawPartial));
}

console.log('');
if (failures > 0) {
  console.error(`✗ range-request: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ range-request: all assertions passed');
