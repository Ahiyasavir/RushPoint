// The phone's resumable stream (change: video-upload-speed, design D4): slices go up WHILE the
// clip is filmed, and a failure resumes from the server's offset instead of starting over.
// The transport is faked, so every byte range that crosses "the network" is recorded.
//   npx tsx scripts/test-stream-upload.ts
import { createStreamUpload, type SessionTransport } from '../apps/play-web/src/lib/streamUpload';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

interface FakeServer {
  stored: Uint8Array;
  sent: Array<[number, number]>;
  sessions: number;
  removed: number;
  failNext: number;           // fail this many PATCHes after writing half their body
  unsupported?: boolean;
  gone?: boolean;
  url?: string;
}

function fakeTransport(s: FakeServer): SessionTransport {
  let id: string | null = null;
  const concat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  return {
    async create() {
      if (s.unsupported) return { unsupported: true };
      s.sessions++; s.stored = new Uint8Array(0); s.gone = false;
      id = `id${s.sessions}`;
      return { id };
    },
    async patch(sid, offset, body, finalLength, onProgress) {
      if (s.gone || sid !== id) throw Object.assign(new Error('gone'), { code: 'session/gone' });
      if (offset !== s.stored.length) throw Object.assign(new Error('conflict'), { code: 'session/conflict', offset: s.stored.length });
      const buf = new Uint8Array(await body.arrayBuffer());
      if (s.failNext > 0) {
        s.failNext--;
        const half = buf.subarray(0, Math.floor(buf.length / 2));
        s.stored = concat(s.stored, half);
        s.sent.push([offset, offset + half.length]);
        onProgress(half.length);
        throw Object.assign(new Error('network'), { code: 'storage/unknown' });
      }
      s.stored = concat(s.stored, buf);
      s.sent.push([offset, offset + buf.length]);
      onProgress(buf.length);
      if (finalLength !== undefined && s.stored.length === finalLength) {
        s.url = `https://api/uploads/clip-${s.sessions}.webm`;
        return { offset: s.stored.length, url: s.url };
      }
      return { offset: s.stored.length };
    },
    async head(sid) {
      if (s.gone || sid !== id) throw Object.assign(new Error('gone'), { code: 'session/gone' });
      return s.stored.length;
    },
    async remove() { s.removed++; },
  };
}

const bytes = (n: number, seed: number) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 13 + seed) % 256));
const blobOf = (...parts: Uint8Array[]) => new Blob(parts);
const tick = () => new Promise((r) => setTimeout(r, 0));
const noSleep = async () => {};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  // ── Slices go up while recording; finish sends only what is left ──────────────
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 0 };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep });
    const a = bytes(1000, 1), b = bytes(1000, 2), c = bytes(500, 3);
    up.append(blobOf(a)); await tick(); await tick();
    up.append(blobOf(b)); await tick(); await tick();
    check('slices are committed while recording', srv.stored.length === 2000, String(srv.stored.length));
    up.append(blobOf(c));
    const url = await up.finish(blobOf(a, b, c));
    check('finish resolves with the url', url === 'https://api/uploads/clip-1.webm', url);
    check('the server holds exactly the clip', same(srv.stored, new Uint8Array(await blobOf(a, b, c).arrayBuffer())));
    check('no byte crossed the network twice', srv.sent.reduce((n, [x, y]) => n + (y - x), 0) === 2500, JSON.stringify(srv.sent));
    check('one session', srv.sessions === 1);
  }

  // ── A failure resumes from the server's offset, never from 0 ───────────────────
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 1 };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep });
    const a = bytes(4000, 5);
    up.append(blobOf(a));
    const url = await up.finish(blobOf(a));
    check('a dropped PATCH still ends with the url', !!url);
    check('the stored file is byte-identical after resume', same(srv.stored, a));
    const total = srv.sent.reduce((n, [x, y]) => n + (y - x), 0);
    check('resume re-sent nothing already stored', total === 4000, `${total} :: ${JSON.stringify(srv.sent)}`);
    check('the resume started at the stored offset', srv.sent[1]?.[0] === 2000, JSON.stringify(srv.sent));
  }

  // ── All bytes already up when the recorder stops: finish is one tiny request ───
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 0 };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep });
    const a = bytes(3000, 7);
    up.append(blobOf(a)); await tick(); await tick(); await tick();
    const before = srv.sent.length;
    const url = await up.finish(blobOf(a));
    check('finish with nothing left sends an empty final request', !!url && srv.sent.length === before + 1 && srv.sent[srv.sent.length - 1][0] === srv.sent[srv.sent.length - 1][1], JSON.stringify(srv.sent));
  }

  // ── Retake: abort drops the session ─────────────────────────────────────────────
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 0 };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep });
    up.append(blobOf(bytes(500, 1))); await tick(); await tick();
    up.abort();
    await tick();
    check('abort deletes the session on the server', srv.removed === 1);
    let code = '';
    try { await up.finish(blobOf(bytes(500, 1))); } catch (e) { code = String((e as { code?: string }).code); }
    check('finish after abort rejects as aborted', code === 'storage/canceled', code);
  }

  // ── Old server (no session route): the caller is told to use PUT ────────────────
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 0, unsupported: true };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep });
    const a = bytes(100, 1);
    up.append(blobOf(a));
    let code = '';
    try { await up.finish(blobOf(a)); } catch (e) { code = String((e as { code?: string }).code); }
    check('an old server reports session/unsupported (the caller falls back to PUT)', code === 'session/unsupported', code);
  }

  // ── A session the server lost (restart, sweep) starts a fresh one ───────────────
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 0 };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep });
    const a = bytes(1000, 9), b = bytes(1000, 10);
    up.append(blobOf(a)); await tick(); await tick();
    srv.gone = true;
    up.append(blobOf(b));
    const url = await up.finish(blobOf(a, b));
    check('a lost session is recreated and the whole clip sent again', !!url && srv.sessions === 2 && same(srv.stored, new Uint8Array(await blobOf(a, b).arrayBuffer())));
  }

  // ── A blob that is not what was streamed is refused, not silently mixed ─────────
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 0 };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep });
    up.append(blobOf(bytes(100, 1)));
    let code = '';
    try { await up.finish(blobOf(bytes(101, 1))); } catch (e) { code = String((e as { code?: string }).code); }
    check('finish with a different-size blob reports session/mismatch', code === 'session/mismatch', code);
    check('matches() tells the caller before it tries', !up.matches(blobOf(bytes(101, 1))) && up.matches(blobOf(bytes(100, 1))));
  }

  // ── Persistent failure: finish rejects retryably, and a second finish resumes ───
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 50 };
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep, maxFailures: 3 });
    const a = bytes(8000, 11);
    up.append(blobOf(a));
    let code = '';
    try { await up.finish(blobOf(a)); } catch (e) { code = String((e as { code?: string }).code); }
    check('after repeated failures finish rejects with a retryable code', code === 'storage/unknown', code);
    srv.failNext = 0;
    const url = await up.finish(blobOf(a));
    check('a later finish resumes and completes byte-identical', !!url && same(srv.stored, a));
  }

  // ── Progress: committed + in flight, over the clip total ────────────────────────
  {
    const srv: FakeServer = { stored: new Uint8Array(0), sent: [], sessions: 0, removed: 0, failNext: 0 };
    const seen: Array<[number, number]> = [];
    const up = createStreamUpload(fakeTransport(srv), { sleep: noSleep, onProgress: (l, t) => seen.push([l, t]) });
    const a = bytes(2000, 1);
    up.append(blobOf(a));
    await up.finish(blobOf(a));
    const last = seen[seen.length - 1];
    check('progress ends at total/total', !!last && last[0] === 2000 && last[1] === 2000, JSON.stringify(seen));
    check('progress never goes past the total', seen.every(([l, t]) => l <= t));
  }

  console.log(failures === 0 ? '\nstream upload: all passed' : `\nstream upload: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
