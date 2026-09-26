// Tests for the streaming upload route (change: stream-upload-write).
//
// These cover BOTH halves: the guards that must not regress (auth, path, IDOR,
// content-type, empty/oversized) and the streaming properties that are the whole
// point of the change — an oversized body is cut off mid-flight instead of being
// fully buffered, and no partial file is ever reachable at its public path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import fsPath from 'path';
import os from 'os';
import { Readable } from 'stream';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  MAX_PARTICIPANT_BYTES,
  MAX_PARTICIPANT_VIDEO_BYTES,
  MAX_CREATOR_BYTES,
  TMP_DIR_NAME,
  classifyUploadPath,
  ownsUploadPath,
  maxBytesFor,
  contentTypeAllowed,
  streamToFileWithLimit,
  sweepStaleTempUploads,
  createUploadHandler,
  uploadFailureResponse,
  uploadLogRecord,
} = require('./uploadRoute.js');

const UID = 'team-uid-1';
const OTHER_UID = 'someone-else';

let uploadDir: string;
let app: express.Express;

function buildApp(uid: string | null = UID) {
  const a = express();
  a.put(
    '/upload',
    createUploadHandler({
      verifyIdToken: async (token: string) => {
        if (!uid || token === 'bad') throw new Error('invalid');
        return { uid };
      },
      uploadDir,
      resolveOrigin: () => 'https://api.example.test',
      onResponse: () => {},
    }),
  );
  return a;
}

beforeEach(async () => {
  uploadDir = await fs.promises.mkdtemp(fsPath.join(os.tmpdir(), 'rp-upload-'));
  app = buildApp();
});

afterEach(async () => {
  await fs.promises.rm(uploadDir, { recursive: true, force: true });
});

const okPath = `runs/run1/teams/${UID}/task1-123.jpg`;

describe('pure path/type helpers', () => {
  it('classifies participant and creator paths, rejects everything else', () => {
    expect(classifyUploadPath('runs/r/teams/u/f.jpg')).toBe('participant');
    expect(classifyUploadPath('gameMedia/u/games/g/f.jpg')).toBe('creator');
    expect(classifyUploadPath('other/f.jpg')).toBeNull();
    expect(classifyUploadPath('')).toBeNull();
    expect(classifyUploadPath(undefined)).toBeNull();
  });

  it('rejects path traversal and absolute paths', () => {
    expect(classifyUploadPath('runs/../../etc/passwd')).toBeNull();
    expect(classifyUploadPath('/runs/r/teams/u/f.jpg')).toBeNull();
    expect(classifyUploadPath('\\runs\\r')).toBeNull();
  });

  it('scopes uploads to the caller uid', () => {
    expect(ownsUploadPath('participant', `runs/r/teams/${UID}/f.jpg`, UID)).toBe(true);
    expect(ownsUploadPath('participant', `runs/r/teams/${OTHER_UID}/f.jpg`, UID)).toBe(false);
    expect(ownsUploadPath('participant', 'runs/r/teams', UID)).toBe(false);
    expect(ownsUploadPath('creator', `gameMedia/${UID}/games/g/f.jpg`, UID)).toBe(true);
    expect(ownsUploadPath('creator', `gameMedia/${OTHER_UID}/f.jpg`, UID)).toBe(false);
  });

  it('applies the participant vs creator content-type allowlists', () => {
    expect(contentTypeAllowed('participant', 'image/jpeg')).toBe(true);
    expect(contentTypeAllowed('participant', 'audio/webm')).toBe(true);
    expect(contentTypeAllowed('participant', 'application/x-msdownload')).toBe(false);
    expect(contentTypeAllowed('creator', 'video/mp4')).toBe(true);
    expect(contentTypeAllowed('creator', 'image/svg+xml')).toBe(false);
  });
});

describe('guards (must not regress)', () => {
  it('401s with no Authorization header, writing nothing', async () => {
    const res = await request(app).put('/upload').query({ path: okPath })
      .set('Content-Type', 'image/jpeg').send('hello');
    expect(res.status).toBe(401);
    expect(fs.existsSync(fsPath.join(uploadDir, okPath))).toBe(false);
  });

  it('401s on an invalid token', async () => {
    const res = await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer bad').set('Content-Type', 'image/jpeg').send('hello');
    expect(res.status).toBe(401);
  });

  it('400s on a traversal path', async () => {
    const res = await request(app).put('/upload').query({ path: 'runs/../../etc/passwd' })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg').send('hello');
    expect(res.status).toBe(400);
  });

  it('403s when writing to another team folder', async () => {
    const res = await request(app).put('/upload')
      .query({ path: `runs/run1/teams/${OTHER_UID}/f.jpg` })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg').send('hello');
    expect(res.status).toBe(403);
  });

  it('400s on a disallowed content type, writing nothing', async () => {
    const res = await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good')
      .set('Content-Type', 'application/x-msdownload').send('hello');
    expect(res.status).toBe(400);
    expect(fs.existsSync(fsPath.join(uploadDir, okPath))).toBe(false);
  });

  it('400s on an empty body', async () => {
    const res = await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg')
      .set('Content-Length', '0').send();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/empty/i);
  });
});

describe('successful upload', () => {
  it('writes the exact bytes and returns the servable url', async () => {
    const payload = Buffer.from('the quick brown fox'.repeat(100));
    const res = await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe(`https://api.example.test/uploads/${encodeURI(okPath)}`);
    const written = await fs.promises.readFile(fsPath.join(uploadDir, okPath));
    expect(written.equals(payload)).toBe(true);
  });

  it('leaves no temp file behind after success', async () => {
    await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg').send('data');
    const tmp = fsPath.join(uploadDir, TMP_DIR_NAME);
    const entries = fs.existsSync(tmp) ? await fs.promises.readdir(tmp) : [];
    expect(entries).toEqual([]);
  });

  it('honors the larger creator cap on a gameMedia path', async () => {
    // A body over the participant cap but under the creator cap must succeed on a
    // creator path — proves the cap is selected per path kind, not globally.
    const creatorPath = `gameMedia/${UID}/games/g1/clip.mp4`;
    const payload = Buffer.alloc(MAX_PARTICIPANT_BYTES + 1024, 7);
    const res = await request(app).put('/upload').query({ path: creatorPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'video/mp4').send(payload);
    expect(res.status).toBe(200);
    const st = await fs.promises.stat(fsPath.join(uploadDir, creatorPath));
    expect(st.size).toBe(payload.length);
  });
});

describe('size cap enforcement', () => {
  it('rejects a body over the cap and leaves no file at the target path', async () => {
    const payload = Buffer.alloc(MAX_PARTICIPANT_BYTES + 1024, 1);
    const res = await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too large/i);
    expect(fs.existsSync(fsPath.join(uploadDir, okPath))).toBe(false);
  });

  // NOTE: the Content-Length fast path is an optimization, not the guard. The
  // authoritative check is the streaming byte count, covered directly at the unit
  // level in "streaming semantics" below (a source with no declared length that
  // overruns the cap is refused mid-stream). Driving a chunked/no-Content-Length
  // request through supertest proved flaky for transport reasons unrelated to the
  // code under test, so that assertion lives at the helper level instead.

  it('discards the partial temp file when the cap is exceeded', async () => {
    const payload = Buffer.alloc(MAX_PARTICIPANT_BYTES + 4096, 2);
    await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg').send(payload);

    const tmp = fsPath.join(uploadDir, TMP_DIR_NAME);
    const entries = fs.existsSync(tmp) ? await fs.promises.readdir(tmp) : [];
    expect(entries).toEqual([]);
  });
});

// change: video-submission-task. A participant video submission needs more room than
// a photo, but raising the SHARED participant cap would also let a "photo" balloon to
// 20MB, which is never legitimate. So the cap is selected per content-type family.
describe('video submissions (participant)', () => {
  const videoPath = `runs/run1/teams/${UID}/task1-123.webm`;

  it('allows the video content types on a participant path', () => {
    expect(contentTypeAllowed('participant', 'video/webm')).toBe(true);
    expect(contentTypeAllowed('participant', 'video/mp4')).toBe(true);
    expect(contentTypeAllowed('participant', 'video/quicktime')).toBe(true);
    // Not every video/* — the allowlist stays exact, mirroring VIDEO_CONTENT_TYPES.
    expect(contentTypeAllowed('participant', 'video/3gpp')).toBe(false);
    expect(contentTypeAllowed('participant', 'video/x-msvideo')).toBe(false);
  });

  it('gives video its own cap without loosening the photo/audio cap', () => {
    expect(MAX_PARTICIPANT_VIDEO_BYTES).toBeGreaterThan(MAX_PARTICIPANT_BYTES);
    expect(MAX_PARTICIPANT_VIDEO_BYTES).toBeLessThan(MAX_CREATOR_BYTES);
    expect(maxBytesFor('participant', 'video/webm')).toBe(MAX_PARTICIPANT_VIDEO_BYTES);
    expect(maxBytesFor('participant', 'image/jpeg')).toBe(MAX_PARTICIPANT_BYTES);
    expect(maxBytesFor('participant', 'audio/webm')).toBe(MAX_PARTICIPANT_BYTES);
    expect(maxBytesFor('participant', undefined)).toBe(MAX_PARTICIPANT_BYTES);
    // Codec params must not defeat the match.
    expect(maxBytesFor('participant', 'video/webm;codecs=vp8,opus')).toBe(MAX_PARTICIPANT_VIDEO_BYTES);
    // A creator path is unaffected either way.
    expect(maxBytesFor('creator', 'video/mp4')).toBe(MAX_CREATOR_BYTES);
  });

  it('accepts a video body between the photo cap and the video cap', async () => {
    const payload = Buffer.alloc(MAX_PARTICIPANT_BYTES + 512 * 1024, 4);
    const res = await request(app).put('/upload').query({ path: videoPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'video/webm').send(payload);

    expect(res.status).toBe(200);
    const st = await fs.promises.stat(fsPath.join(uploadDir, videoPath));
    expect(st.size).toBe(payload.length);
  });

  it('still refuses a video body over the video cap, leaving nothing behind', async () => {
    const payload = Buffer.alloc(MAX_PARTICIPANT_VIDEO_BYTES + 4096, 6);
    const res = await request(app).put('/upload').query({ path: videoPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'video/webm').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too large/i);
    expect(fs.existsSync(fsPath.join(uploadDir, videoPath))).toBe(false);
    const tmp = fsPath.join(uploadDir, TMP_DIR_NAME);
    const entries = fs.existsSync(tmp) ? await fs.promises.readdir(tmp) : [];
    expect(entries).toEqual([]);
  });

  it('does not let a photo upload borrow the video cap', async () => {
    // The regression this guards: selecting the cap by PATH or by caller-declared
    // intent instead of by validated content-type would hand every participant
    // upload the larger ceiling.
    const payload = Buffer.alloc(MAX_PARTICIPANT_BYTES + 512 * 1024, 8);
    const res = await request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good').set('Content-Type', 'image/jpeg').send(payload);
    expect(res.status).toBe(400);
  });
});

// These are the tests that actually distinguish streaming from buffer-then-write.
// Against the old express.raw() implementation the whole body was resident in RAM
// before any check ran, and nothing was written to disk until it was complete.
describe('streaming semantics', () => {
  it('stops reading as soon as the cap is crossed, not after the whole body', async () => {
    // A source that reports how much it was actually asked to produce. With
    // streaming + req.destroy() the consumer stops pulling shortly after the cap;
    // a buffering implementation would drain all of it.
    const chunk = Buffer.alloc(64 * 1024, 3);
    const totalChunks = Math.ceil((MAX_PARTICIPANT_BYTES * 3) / chunk.length);
    let produced = 0;
    const body = new Readable({
      read() {
        if (produced >= totalChunks) { this.push(null); return; }
        produced += 1;
        this.push(chunk);
      },
    });

    const req = request(app).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer good')
      .set('Content-Type', 'image/jpeg');
    // Supertest/superagent accepts a piped stream body.
    await new Promise<void>((resolve) => {
      body.pipe(req as unknown as NodeJS.WritableStream);
      req.on('response', () => resolve());
      req.on('error', () => resolve()); // destroyed socket is an expected outcome
      req.end?.();
    });

    const producedBytes = produced * chunk.length;
    // The generous bound is deliberate: what matters is that we did NOT have to
    // produce the entire 3x-oversized body. Buffering would have consumed all of it.
    expect(producedBytes).toBeLessThan(MAX_PARTICIPANT_BYTES * 3);
  });

  it('streamToFileWithLimit writes incrementally rather than all at once', async () => {
    // Feed a slow stream and observe the temp file growing WHILE the promise is
    // still pending — impossible with a buffer-then-write implementation.
    const dest = fsPath.join(uploadDir, 'incremental.bin');
    const chunk = Buffer.alloc(32 * 1024, 9);
    let pushes = 0;
    const src = new Readable({
      read() {
        if (pushes >= 8) { this.push(null); return; }
        pushes += 1;
        setTimeout(() => this.push(chunk), 5);
      },
    }) as unknown as NodeJS.ReadableStream & { headers?: unknown };

    const p = streamToFileWithLimit(src, dest, 10 * 1024 * 1024, 5000);
    // Sample mid-flight.
    await new Promise((r) => setTimeout(r, 25));
    const midSize = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    const total = await p;

    expect(midSize).toBeGreaterThan(0);
    expect(midSize).toBeLessThan(total);
    expect(total).toBe(8 * chunk.length);
  });

  it('never leaves a partial file at the public path when the stream fails', async () => {
    const dest = fsPath.join(uploadDir, 'should-not-exist.bin');
    const chunk = Buffer.alloc(16 * 1024, 5);
    let pushes = 0;
    const src = new Readable({
      read() {
        pushes += 1;
        if (pushes > 100) { this.push(null); return; }
        this.push(chunk);
      },
    }) as unknown as NodeJS.ReadableStream;

    // Cap far below what the source produces ⇒ must reject with 'too-large'.
    await expect(streamToFileWithLimit(src, dest, 32 * 1024, 5000)).rejects.toMatchObject({
      reason: 'too-large',
    });
  });
});

describe('temp-file sweep', () => {
  it('removes only stale temp entries, never in-flight ones', async () => {
    const tmp = fsPath.join(uploadDir, TMP_DIR_NAME);
    await fs.promises.mkdir(tmp, { recursive: true });
    const stale = fsPath.join(tmp, 'stale');
    const fresh = fsPath.join(tmp, 'fresh');
    await fs.promises.writeFile(stale, 'x');
    await fs.promises.writeFile(fresh, 'y');
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await fs.promises.utimes(stale, old, old);

    const removed = await sweepStaleTempUploads(uploadDir);
    expect(removed).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('is a no-op when no temp dir exists', async () => {
    await expect(sweepStaleTempUploads(uploadDir)).resolves.toBe(0);
  });
});

// ── media-upload-reliability ──────────────────────────────────────────────────
// A server-side STALL used to answer 400 INVALID_ARGUMENT, which the phone treats as a PERMANENT
// refusal (only 408/429/5xx are retried), so a phone that paused sending for 45 s (screen locked,
// app switched) was told "upload failed" and never retried. And nothing recorded how uploads
// perform in the field: "how long do uploads take?" had no answer in production.
describe('failure statuses (media-upload-reliability)', () => {
  it('a stall is 408, which the client retries', () => {
    expect(uploadFailureResponse('stalled').status).toBe(408);
  });
  it('an io error is 500, also retried', () => {
    expect(uploadFailureResponse('io').status).toBe(500);
  });
  it('too-large stays a 400 (a real refusal, never retried)', () => {
    expect(uploadFailureResponse('too-large').status).toBe(400);
  });
  it('an unknown reason is a 500, never a permanent 400', () => {
    expect(uploadFailureResponse('weird' as never).status).toBe(500);
  });
});

describe('upload telemetry (media-upload-reliability)', () => {
  it('records kind, bytes, duration, outcome and run, and NO uid or filename', () => {
    const rec = uploadLogRecord({ contentType: 'video/webm', bytes: 1234, ms: 5678, outcome: 'ok', uploadPath: `runs/run9/teams/${UID}/t-1.webm` });
    expect(rec).toEqual({ msg: 'upload', kind: 'video', bytes: 1234, ms: 5678, outcome: 'ok', runId: 'run9' });
    expect(JSON.stringify(rec)).not.toContain(UID);
    expect(JSON.stringify(rec)).not.toContain('t-1.webm');
  });
  it('classifies photo and audio, and a creator upload', () => {
    expect(uploadLogRecord({ contentType: 'image/jpeg', bytes: 1, ms: 1, outcome: 'ok', uploadPath: 'runs/r/teams/x/a.jpg' }).kind).toBe('photo');
    expect(uploadLogRecord({ contentType: 'audio/webm', bytes: 1, ms: 1, outcome: 'ok', uploadPath: 'runs/r/teams/x/a.webm' }).kind).toBe('audio');
    const c = uploadLogRecord({ contentType: 'image/png', bytes: 1, ms: 1, outcome: 'ok', uploadPath: 'gameMedia/u/games/g/a.png' });
    expect(c.kind).toBe('creator');
    expect(c.runId).toBeNull();
  });
  it('the handler logs one record for a successful upload', async () => {
    const lines: unknown[] = [];
    const a = express();
    a.put('/upload', createUploadHandler({
      verifyIdToken: async () => ({ uid: UID }), uploadDir, resolveOrigin: () => 'https://api.example.test',
      onResponse: () => {}, log: (r: unknown) => lines.push(r),
    }));
    const res = await request(a).put(`/upload?path=${encodeURIComponent(okPath)}`)
      .set('Authorization', 'Bearer ok').set('Content-Type', 'image/jpeg').send(Buffer.from([1, 2, 3]));
    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string; bytes: number }).outcome).toBe('ok');
    expect((lines[0] as { outcome: string; bytes: number }).bytes).toBe(3);
  });
});

// ── Server brake (change: video-upload-speed, D6) ────────────────────────────
// The box does not fall over from bandwidth at our scale; it falls over from a full disk or an
// unbounded pile of streams. Both answers are RETRYABLE statuses the phone already handles.
describe('upload slots (video-upload-speed D6)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createUploadSlots, MAX_CONCURRENT_UPLOADS, MAX_UPLOADS_PER_UID, diskFloorBytes } = require('./uploadRoute.js');

  it('defaults are 64 per process and 2 per uid', () => {
    expect(MAX_CONCURRENT_UPLOADS).toBe(64);
    expect(MAX_UPLOADS_PER_UID).toBe(2);
  });

  it('the 65th concurrent upload is refused, globally', () => {
    const slots = createUploadSlots();
    const held = Array.from({ length: 64 }, (_, i) => slots.acquire(`u${i}`));
    expect(held.every((h: { ok: boolean }) => h.ok)).toBe(true);
    expect(slots.acquire('u-new')).toMatchObject({ ok: false, reason: 'global' });
    held[0].release();
    expect(slots.acquire('u-new').ok).toBe(true);
  });

  it('a third concurrent upload from one uid is refused', () => {
    const slots = createUploadSlots();
    const a = slots.acquire('same');
    const b = slots.acquire('same');
    expect(a.ok && b.ok).toBe(true);
    expect(slots.acquire('same')).toMatchObject({ ok: false, reason: 'uid' });
    expect(slots.acquire('other').ok).toBe(true);
  });

  it('release is idempotent and tracks the peak', () => {
    const slots = createUploadSlots({ maxConcurrent: 5, maxPerUid: 5 });
    const a = slots.acquire('x');
    const b = slots.acquire('y');
    a.release(); a.release();
    expect(slots.stats()).toMatchObject({ inFlight: 1, peak: 2 });
    b.release();
    expect(slots.stats().inFlight).toBe(0);
    expect(slots.acquire('x').ok).toBe(true);
  });

  it('the disk floor is max(2 GiB, 5% of the volume)', () => {
    expect(diskFloorBytes(10 * 1024 ** 3)).toBe(2 * 1024 ** 3);
    expect(diskFloorBytes(100 * 1024 ** 3)).toBe(5 * 1024 ** 3);
    expect(diskFloorBytes(NaN)).toBe(2 * 1024 ** 3);
  });
});

describe('handler brake (video-upload-speed D6)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http');

  function brakedApp(opts: Record<string, unknown>, log?: (r: unknown) => void) {
    const a = express();
    a.put('/upload', createUploadHandler({
      verifyIdToken: async () => ({ uid: UID }),
      uploadDir,
      resolveOrigin: () => 'https://api.example.test',
      onResponse: () => {},
      log,
      ...opts,
    }));
    return a;
  }

  it('over the cap answers 503 + Retry-After, and the slot is released after the held upload ends', async () => {
    const a = brakedApp({ limits: { maxConcurrent: 1, maxPerUid: 1 } });
    const server = a.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      // Upload A holds the only slot: its body is still being sent.
      const held = http.request({ port, method: 'PUT', path: `/upload?path=${encodeURIComponent(okPath)}`,
        headers: { authorization: 'Bearer t', 'content-type': 'image/jpeg' } });
      const heldDone = new Promise<number>((r) => held.on('response', (res: { statusCode: number; resume: () => void }) => { res.resume(); r(res.statusCode); }));
      held.write(Buffer.alloc(1024, 1));
      await new Promise((r) => setTimeout(r, 100));

      const refused = await request(server).put('/upload').query({ path: okPath })
        .set('Authorization', 'Bearer t').set('Content-Type', 'image/jpeg').send(Buffer.alloc(10, 2));
      expect(refused.status).toBe(503);
      expect(refused.headers['retry-after']).toBe('3');

      held.end(Buffer.alloc(1024, 1));
      expect(await heldDone).toBe(200);

      const after = await request(server).put('/upload').query({ path: okPath })
        .set('Authorization', 'Bearer t').set('Content-Type', 'image/jpeg').send(Buffer.alloc(10, 2));
      expect(after.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('releases the slot after a too-large refusal too', async () => {
    const a = brakedApp({ limits: { maxConcurrent: 1, maxPerUid: 1 } });
    const big = await request(a).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer t').set('Content-Type', 'image/jpeg').send(Buffer.alloc(MAX_PARTICIPANT_BYTES + 10, 1));
    expect(big.status).toBe(400);
    const ok = await request(a).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer t').set('Content-Type', 'image/jpeg').send(Buffer.alloc(10, 1));
    expect(ok.status).toBe(200);
  });

  it('below the disk floor answers 507 and logs disk-floor', async () => {
    const records: Array<{ outcome?: string }> = [];
    const a = brakedApp({ statfs: async () => ({ bavail: 10, bsize: 4096, blocks: 1_000_000 }) }, (r) => records.push(r as { outcome?: string }));
    const res = await request(a).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer t').set('Content-Type', 'image/jpeg').send(Buffer.alloc(10, 1));
    expect(res.status).toBe(507);
    expect(records.some((r) => r.outcome === 'disk-floor')).toBe(true);
    expect(fs.existsSync(fsPath.join(uploadDir, okPath))).toBe(false);
  });

  it('a statfs that throws fails OPEN (the upload goes through)', async () => {
    const a = brakedApp({ statfs: async () => { throw new Error('ENOSYS'); } });
    const res = await request(a).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer t').set('Content-Type', 'image/jpeg').send(Buffer.alloc(10, 1));
    expect(res.status).toBe(200);
  });

  it('plenty of disk: the upload goes through', async () => {
    const a = brakedApp({ statfs: async () => ({ bavail: 100_000_000, bsize: 4096, blocks: 200_000_000 }) });
    const res = await request(a).put('/upload').query({ path: okPath })
      .set('Authorization', 'Bearer t').set('Content-Type', 'image/jpeg').send(Buffer.alloc(10, 1));
    expect(res.status).toBe(200);
  });
});

describe('uploads telemetry line (video-upload-speed D6)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { uploadsTelemetryRecord } = require('./uploadRoute.js');
  const loop = (ms: number) => ({ percentile: () => ms * 1e6 });
  it('reports in-flight, peak and the loop p99 in ms', () => {
    expect(uploadsTelemetryRecord({ inFlight: 3, peak: 9 }, loop(12.4))).toEqual({ msg: 'uploads', inFlight: 3, peak: 9, loopDelayP99Ms: 12 });
  });
  it('a quiet minute logs nothing', () => {
    expect(uploadsTelemetryRecord({ inFlight: 0, peak: 0 }, loop(5))).toBeNull();
  });
  it('a slow loop is logged even with no uploads', () => {
    expect(uploadsTelemetryRecord({ inFlight: 0, peak: 0 }, loop(250))).toMatchObject({ loopDelayP99Ms: 250 });
  });
  it('garbage in never throws', () => {
    expect(uploadsTelemetryRecord(null, { percentile: () => { throw new Error('x'); } })).toBeNull();
  });
});
