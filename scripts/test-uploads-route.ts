// REAL HTTP round trip over GET /uploads/* (change: media-serving-correctness).
//
// WHY THIS EXISTS RATHER THAN AN e2e SCENARIO. `scripts/e2e-verify.mjs` drives the
// Firebase emulator suite, and the emulator does not serve /uploads at all — that
// route lives only in the self-hosted VPS API (functions/server.js). So the e2e
// lane structurally cannot reach it, and the header/streaming WIRING would
// otherwise be the one part of this change nothing proved: the three decision
// functions are unit-tested next door, but "the decision was correct" and "the
// response actually carried it" are different claims.
//
// The handler takes its upload directory by injection (same shape as
// createUploadHandler in functions/uploadRoute.js), so this mounts the REAL
// handler on a bare express app over a temp directory and speaks real HTTP to it.
// No Firebase, no built callables bundle, no emulator.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const express = require_('express');
const { createUploadsGetHandler } = require_('../functions/mediaServing.js');

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

const ch = (code: number): string => String.fromCharCode(code);

// ─── Fixtures on disk ────────────────────────────────────────────────────────
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-uploads-'));

/** A synthetic EBML prefix carrying the given CodecID markers, then filler. */
function webmBytes(codecIds: string[], totalLen: number): Buffer {
  const head = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const marks = codecIds.map((c) => Buffer.concat([Buffer.alloc(3, 0x86), Buffer.from(c, 'ascii')]));
  const front = Buffer.concat([head, ...marks]);
  const tail = Buffer.alloc(Math.max(0, totalLen - front.length), 0x77);
  return Buffer.concat([front, tail]).subarray(0, Math.max(front.length, totalLen));
}

const BODY_1000 = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
fs.writeFileSync(path.join(uploadDir, 'plain.bin'), BODY_1000);
fs.writeFileSync(path.join(uploadDir, 'video.webm'), webmBytes(['V_VP8', 'A_OPUS'], 1000));
fs.writeFileSync(path.join(uploadDir, 'voice.webm'), webmBytes(['A_OPUS'], 1000));
fs.writeFileSync(path.join(uploadDir, 'photo.jpg'), BODY_1000);
fs.writeFileSync(path.join(uploadDir, 'empty.webm'), Buffer.alloc(0));
fs.mkdirSync(path.join(uploadDir, 'nested'), { recursive: true });
fs.writeFileSync(path.join(uploadDir, 'nested', 'clip.webm'), webmBytes(['V_VP9'], 1000));
// A file OUTSIDE the upload root, to prove traversal is refused rather than served.
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-outside-'));
fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'TOP SECRET');

// ─── The real handler on a bare express app ──────────────────────────────────
const app = express();
app.get(/^\/uploads\/(.+)$/, createUploadsGetHandler({ uploadDir }));
const server = http.createServer(app);

interface Res { status: number; headers: Record<string, string>; body: Buffer }

function request(method: string, url: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c as Buffer));
      r.on('end', () => resolve({
        status: r.statusCode || 0,
        headers: r.headers as unknown as Record<string, string>,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main(): Promise<void> {
  console.log('\nmedia-serving — GET /uploads/* over real HTTP');

  // ── 1. The defect that made four production videos unwatchable ─────────────
  {
    const r = await request('GET', '/uploads/video.webm');
    eq('an Android .webm video is served as video/webm', r.headers['content-type'], 'video/webm');
    const a = await request('GET', '/uploads/voice.webm');
    eq('an audio-only .webm is still audio/webm', a.headers['content-type'], 'audio/webm');
    const n = await request('GET', '/uploads/nested/clip.webm');
    eq('a nested .webm video is served as video/webm', n.headers['content-type'], 'video/webm');
    const j = await request('GET', '/uploads/photo.jpg');
    eq('an unambiguous extension is unchanged', j.headers['content-type'], 'image/jpeg');
  }

  // ── 2. Seekable media ──────────────────────────────────────────────────────
  {
    const r = await request('GET', '/uploads/plain.bin', { Range: 'bytes=0-9' });
    eq('a range request is answered 206', r.status, 206);
    eq('Content-Range names the window and the total', r.headers['content-range'], 'bytes 0-9/1000');
    eq('Content-Length is the window, not the object', r.headers['content-length'], '10');
    eq('exactly the requested bytes arrive', r.body.length, 10);
    ok('the bytes are the FIRST ten of the object', r.body.equals(BODY_1000.subarray(0, 10)),
      r.body.toString('hex'));

    const mid = await request('GET', '/uploads/plain.bin', { Range: 'bytes=500-599' });
    eq('a mid-file window is answered 206', mid.status, 206);
    ok('a mid-file window carries the right bytes', mid.body.equals(BODY_1000.subarray(500, 600)));

    const suffix = await request('GET', '/uploads/plain.bin', { Range: 'bytes=-20' });
    eq('a suffix window is answered 206', suffix.status, 206);
    ok('a suffix window carries the LAST bytes', suffix.body.equals(BODY_1000.subarray(980)));

    const whole = await request('GET', '/uploads/plain.bin');
    eq('a request with no Range is a plain 200', whole.status, 200);
    eq('a plain 200 advertises ranges anyway', whole.headers['accept-ranges'], 'bytes');
    eq('a plain 200 declares the full length', whole.headers['content-length'], '1000');
    ok('a plain 200 is byte-identical to what is on disk', whole.body.equals(BODY_1000));

    const bad = await request('GET', '/uploads/plain.bin', { Range: 'bytes=5000-6000' });
    eq('an unsatisfiable range is 416', bad.status, 416);
    eq('a 416 says how long the object really is', bad.headers['content-range'], 'bytes */1000');

    const junk = await request('GET', '/uploads/plain.bin', { Range: 'sausages' });
    eq('a malformed Range degrades to 200 rather than erroring', junk.status, 200);
    ok('a malformed Range still serves the whole object', junk.body.equals(BODY_1000));
  }

  // ── 3. HEAD advertises without transferring ────────────────────────────────
  {
    const r = await request('HEAD', '/uploads/plain.bin');
    eq('HEAD is answered 200', r.status, 200);
    eq('HEAD advertises range support', r.headers['accept-ranges'], 'bytes');
    eq('HEAD declares the full length', r.headers['content-length'], '1000');
    eq('HEAD declares the same type a GET would', r.headers['content-type'], 'application/octet-stream');
    eq('HEAD sends no body', r.body.length, 0);
    const v = await request('HEAD', '/uploads/video.webm');
    eq('HEAD reports the probed type too', v.headers['content-type'], 'video/webm');
  }

  // ── 4. Download really downloads ───────────────────────────────────────────
  {
    const d = await request('GET', '/uploads/video.webm?download=1');
    ok(`?download=1 sets an attachment disposition :: ${d.headers['content-disposition']}`,
      typeof d.headers['content-disposition'] === 'string'
      && d.headers['content-disposition'].startsWith('attachment'));
    ok('the attachment names the file',
      String(d.headers['content-disposition']).includes('video.webm'));
    const p = await request('GET', '/uploads/video.webm');
    eq('without the flag no disposition is sent', d.status === 200 && p.headers['content-disposition'], undefined);
  }

  // ── 5. Security headers survive every path ─────────────────────────────────
  {
    const cases: Array<[string, Res]> = [
      ['200', await request('GET', '/uploads/plain.bin')],
      ['206', await request('GET', '/uploads/plain.bin', { Range: 'bytes=0-9' })],
      ['416', await request('GET', '/uploads/plain.bin', { Range: 'bytes=9999-' })],
      ['HEAD', await request('HEAD', '/uploads/plain.bin')],
      ['download', await request('GET', '/uploads/plain.bin?download=1')],
    ];
    for (const [label, r] of cases) {
      eq(`nosniff is present on the ${label} response`,
        r.headers['x-content-type-options'], 'nosniff');
      eq(`CORS is open on the ${label} response`,
        r.headers['access-control-allow-origin'], '*');
      eq(`immutable caching survives on the ${label} response`,
        r.headers['cache-control'], 'public, max-age=31536000, immutable');
    }
  }

  // ── 6. The guards are not bypassable through the new code path ─────────────
  {
    // A traversal WITH a Range header present — the range must never become a way
    // to reach a file the containment check would have refused.
    for (const p of [
      '/uploads/../../etc/passwd',
      `/uploads/..${ch(47)}..${ch(47)}secret.txt`,
      '/uploads/nested/../../secret.txt',
    ]) {
      const r = await request('GET', p, { Range: 'bytes=0-4' });
      ok(`${p} with a Range is refused (${r.status})`, r.status === 400 || r.status === 403 || r.status === 404);
      ok(`${p} serves no file content`, !r.body.includes('TOP SECRET'), r.body.toString('utf8').slice(0, 40));
    }
    const missing = await request('GET', '/uploads/nope.webm');
    eq('a missing object is still 404', missing.status, 404);
    const dir = await request('GET', '/uploads/nested');
    eq('a directory is not served as a file', dir.status, 404);
  }

  // ── 7. A zero-byte object does not hang or lie ─────────────────────────────
  {
    const r = await request('GET', '/uploads/empty.webm');
    eq('an empty object is 200', r.status, 200);
    eq('an empty object declares zero length', r.headers['content-length'], '0');
    eq('an empty object sends no bytes', r.body.length, 0);
    const ranged = await request('GET', '/uploads/empty.webm', { Range: 'bytes=0-0' });
    eq('any range on an empty object is 416', ranged.status, 416);
  }

  console.log('');
  if (failures > 0) {
    console.error(`✗ uploads-route: ${failures} assertion(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log('✓ uploads-route: all assertions passed');
}

server.listen(0, '127.0.0.1', () => {
  main()
    .catch((e) => { console.error('✗ uploads-route threw ::', e); process.exitCode = 1; })
    .finally(() => {
      server.close();
      try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch { /* temp dir */ }
      try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* temp dir */ }
    });
});
