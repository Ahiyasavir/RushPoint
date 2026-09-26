// Resumable upload sessions (change: video-upload-speed, design D4): a tus-shaped subset so a clip
// can be sent WHILE it is filmed and a dropped connection resumes from the bytes the server has,
// instead of re-sending the whole file. Built from uploadRoute.js's own checks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import fsPath from 'path';
import os from 'os';
import http from 'http';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createUploadSessionRoutes, SESSION_PREFIX, MAX_SESSIONS_PER_UID } = require('./uploadSessionRoute.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TMP_DIR_NAME, MAX_PARTICIPANT_VIDEO_BYTES, sweepStaleTempUploads, createUploadSlots } = require('./uploadRoute.js');

const UID = 'phone-1';
let uploadDir: string;

function buildApp(opts: Record<string, unknown> = {}) {
  const a = express();
  const r = createUploadSessionRoutes({
    verifyIdToken: async (token: string) => {
      if (token === 'bad') throw new Error('invalid');
      return { uid: token === 'other' ? 'phone-2' : UID };
    },
    uploadDir,
    resolveOrigin: () => 'https://api.example.test',
    onResponse: () => {},
    log: () => {},
    ...opts,
  });
  a.post('/upload/sessions', r.create);
  a.head('/upload/sessions/:id', r.head);
  a.patch('/upload/sessions/:id', r.patch);
  a.delete('/upload/sessions/:id', r.remove);
  return a;
}

const videoPath = `runs/run1/teams/${UID}/task1-1.webm`;
const auth = (tok = 'good') => ({ Authorization: `Bearer ${tok}` });

async function create(app: express.Express, path = videoPath, type = 'video/webm', tok = 'good', length?: number) {
  const req = request(app).post('/upload/sessions').query({ path }).set(auth(tok)).set('Content-Type', type);
  if (length !== undefined) req.set('Upload-Length', String(length));
  return req.send();
}
function patch(app: express.Express, id: string, offset: number, body: Buffer, final?: number, tok = 'good') {
  const req = request(app).patch(`/upload/sessions/${id}`).set(auth(tok))
    .set('Upload-Offset', String(offset)).set('Content-Type', 'application/offset+octet-stream');
  if (final !== undefined) req.set('Upload-Length', String(final));
  return req.send(body);
}

beforeEach(async () => { uploadDir = await fs.promises.mkdtemp(fsPath.join(os.tmpdir(), 'rp-sess-')); });
afterEach(async () => { await fs.promises.rm(uploadDir, { recursive: true, force: true }); });

const bytes = (n: number, seed = 1) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + seed) % 256));

describe('create: the SAME guards as PUT /upload', () => {
  it('201 with an id and a Location', async () => {
    const res = await create(buildApp());
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.headers.location).toBe(`/upload/sessions/${res.body.id}`);
    expect(fs.existsSync(fsPath.join(uploadDir, TMP_DIR_NAME, `${SESSION_PREFIX}${res.body.id}`))).toBe(true);
  });
  it.each([
    ['no token', undefined, videoPath, 'video/webm', 401],
    ['bad token', 'bad', videoPath, 'video/webm', 401],
    ['traversal', 'good', 'runs/../../etc/passwd', 'video/webm', 400],
    ['a disallowed type', 'good', videoPath, 'text/html', 400],
    ['another team folder', 'good', 'runs/run1/teams/someone-else/x.webm', 'video/webm', 403],
  ])('refuses %s', async (_label, tok, path, type, status) => {
    const req = request(buildApp()).post('/upload/sessions').query({ path }).set('Content-Type', type as string);
    if (tok) req.set(auth(tok as string));
    expect((await req.send()).status).toBe(status);
  });
  it('refuses a declared length over the cap', async () => {
    expect((await create(buildApp(), videoPath, 'video/webm', 'good', MAX_PARTICIPANT_VIDEO_BYTES + 1)).status).toBe(400);
  });
  it(`caps live sessions per phone at ${MAX_SESSIONS_PER_UID}`, async () => {
    const app = buildApp();
    for (let i = 0; i < MAX_SESSIONS_PER_UID; i++) expect((await create(app)).status).toBe(201);
    const over = await create(app);
    expect(over.status).toBe(503);
    expect(over.headers['retry-after']).toBeDefined();
  });
  it('below the disk floor answers 507', async () => {
    const app = buildApp({ belowFloor: async () => true });
    expect((await create(app)).status).toBe(507);
  });
});

describe('append, resume, finish', () => {
  it('appends in order and finishes byte-identical, with PUT\'s url shape', async () => {
    const app = buildApp();
    const src = bytes(300_000);
    const { body: { id } } = await create(app);
    const a = await patch(app, id, 0, src.subarray(0, 100_000));
    expect(a.status).toBe(204);
    expect(a.headers['upload-offset']).toBe('100000');
    const b = await patch(app, id, 100_000, src.subarray(100_000), src.length);
    expect(b.status).toBe(200);
    expect(b.body.url).toBe(`https://api.example.test/uploads/${videoPath}`);
    expect(Buffer.compare(fs.readFileSync(fsPath.join(uploadDir, videoPath)), src)).toBe(0);
    // Finished: the session is gone.
    expect((await request(app).head(`/upload/sessions/${id}`).set(auth())).status).toBe(404);
  });

  it('a wrong offset answers 409 with the true offset', async () => {
    const app = buildApp();
    const { body: { id } } = await create(app);
    await patch(app, id, 0, bytes(1000));
    const wrong = await patch(app, id, 500, bytes(1000));
    expect(wrong.status).toBe(409);
    expect(wrong.headers['upload-offset']).toBe('1000');
  });

  it('HEAD reports the stored offset (and the length once known)', async () => {
    const app = buildApp();
    const { body: { id } } = await create(app, videoPath, 'video/webm', 'good', 5000);
    await patch(app, id, 0, bytes(1234));
    const h = await request(app).head(`/upload/sessions/${id}`).set(auth());
    expect(h.status).toBe(200);
    expect(h.headers['upload-offset']).toBe('1234');
    expect(h.headers['upload-length']).toBe('5000');
    expect(h.headers['cache-control']).toBe('no-store');
  });

  it('a mid-stream abort KEEPS the bytes, and the resume completes byte-identical', async () => {
    const app = buildApp();
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const src = bytes(200_000, 3);
      const { body: { id } } = await create(server as never);
      // Send 80 KB, then drop the connection before the body is complete.
      await new Promise<void>((resolve) => {
        const req = http.request({ port, method: 'PATCH', path: `/upload/sessions/${id}`,
          headers: { authorization: 'Bearer good', 'upload-offset': '0', 'content-length': String(src.length) } });
        req.on('error', () => resolve());
        req.write(src.subarray(0, 80_000), () => setTimeout(() => { req.destroy(); setTimeout(resolve, 150); }, 100));
      });
      const h = await request(server).head(`/upload/sessions/${id}`).set(auth());
      const offset = Number(h.headers['upload-offset']);
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThanOrEqual(80_000);
      const done = await request(server).patch(`/upload/sessions/${id}`).set(auth())
        .set('Upload-Offset', String(offset)).set('Upload-Length', String(src.length)).send(src.subarray(offset));
      expect(done.status).toBe(200);
      expect(Buffer.compare(fs.readFileSync(fsPath.join(uploadDir, videoPath)), src)).toBe(0);
    } finally {
      server.close();
    }
  });

  it('the cap is CUMULATIVE across patches', async () => {
    const app = buildApp({ maxBytesFor: () => 1000 });
    const { body: { id } } = await create(app);
    expect((await patch(app, id, 0, bytes(800))).status).toBe(204);
    expect((await patch(app, id, 800, bytes(300))).status).toBe(400);
    // Too large can never complete: the session is removed.
    expect((await request(app).head(`/upload/sessions/${id}`).set(auth())).status).toBe(404);
  });

  it('a second concurrent PATCH on one session answers 409', async () => {
    const app = buildApp();
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const { body: { id } } = await create(server as never);
      const held = http.request({ port, method: 'PATCH', path: `/upload/sessions/${id}`,
        headers: { authorization: 'Bearer good', 'upload-offset': '0', 'content-length': '2000' } });
      held.on('error', () => {});
      const heldDone = new Promise<number>((r) => held.on('response', (res) => { res.resume(); r(res.statusCode ?? 0); }));
      held.write(bytes(1000));
      await new Promise((r) => setTimeout(r, 100));
      const second = await request(server).patch(`/upload/sessions/${id}`).set(auth()).set('Upload-Offset', '0').send(bytes(10));
      expect(second.status).toBe(409);
      held.end(bytes(1000));
      expect(await heldDone).toBe(204);
    } finally {
      server.close();
    }
  });

  it('a PATCH holds an upload slot, so the stage-1 concurrency brake applies', async () => {
    const slots = createUploadSlots({ maxConcurrent: 0, maxPerUid: 2 });
    const app = buildApp({ slots });
    const { body: { id } } = await create(app);
    const res = await patch(app, id, 0, bytes(10));
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('3');
  });
});

describe('ownership and cleanup', () => {
  it('another phone may not HEAD, PATCH or DELETE the session', async () => {
    const app = buildApp();
    const { body: { id } } = await create(app);
    expect((await request(app).head(`/upload/sessions/${id}`).set(auth('other'))).status).toBe(403);
    expect((await patch(app, id, 0, bytes(10), undefined, 'other')).status).toBe(403);
    expect((await request(app).delete(`/upload/sessions/${id}`).set(auth('other'))).status).toBe(403);
  });
  it('an unknown or malformed id is 404, never a path', async () => {
    const app = buildApp();
    expect((await request(app).head('/upload/sessions/nope').set(auth())).status).toBe(404);
    expect((await request(app).head('/upload/sessions/..%2F..%2Fetc').set(auth())).status).toBe(404);
  });
  it('DELETE removes the bytes and the sidecar', async () => {
    const app = buildApp();
    const { body: { id } } = await create(app);
    await patch(app, id, 0, bytes(100));
    expect((await request(app).delete(`/upload/sessions/${id}`).set(auth())).status).toBe(204);
    const tmp = fsPath.join(uploadDir, TMP_DIR_NAME);
    expect(fs.readdirSync(tmp).filter((n) => n.includes(id))).toEqual([]);
    // And a deleted session frees its per-phone slot.
    for (let i = 0; i < MAX_SESSIONS_PER_UID; i++) expect((await create(app)).status).toBe(201);
  });
  it('an idle session older than the temp TTL is swept (bytes and sidecar)', async () => {
    const app = buildApp();
    const { body: { id } } = await create(app);
    const tmp = fsPath.join(uploadDir, TMP_DIR_NAME);
    const removed = await sweepStaleTempUploads(uploadDir, Date.now() + 2 * 60 * 60 * 1000);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(fs.readdirSync(tmp).filter((n) => n.includes(id))).toEqual([]);
  });
});
