// Pure tests for the background media queue (change: background-media-upload, D3).
//
// WHY. On an auto-approved photo or video mission nobody looks at the file before the team may go
// on, yet the team used to wait for every byte. The server now approves first; this queue owns the
// upload afterwards. It must never lose a file (persisted before the UI moves on, resumed after a
// reload), never send the bytes twice (reuses the capture-time upload, and an upload that landed is
// not repeated when only the attach failed), retry on its own, and give up only on a refusal that
// no retry can change.
//   npx tsx scripts/test-background-media.ts
import {
  createBackgroundMedia, backgroundRetryDelayMs, isPermanentBackgroundError,
  type BgJob, type BgStore, type Uploaded,
} from '../apps/play-web/src/lib/backgroundMedia';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const err = (code: string) => Object.assign(new Error(code), { code });

function memStore(initial: BgJob[] = [], opts: { broken?: boolean } = {}) {
  const m = new Map<string, BgJob>(initial.map((j) => [j.id, j]));
  const store: BgStore = {
    async put(j) { if (opts.broken) throw new Error('idb down'); m.set(j.id, { ...j }); },
    async remove(id) { if (opts.broken) throw new Error('idb down'); m.delete(id); },
    async all() { if (opts.broken) throw new Error('idb down'); return [...m.values()]; },
  };
  return { store, m };
}

const job = (id: string, over: Partial<BgJob> = {}): BgJob => ({
  id, ctx: { ownerUid: 'o', gameId: 'g', runId: 'r' }, taskId: `t-${id}`, kind: 'photo',
  contentType: 'image/jpeg', blob: new Blob(['x']), createdAt: 1, ...over,
});

async function main(): Promise<void> {
  // ── Pure helpers ────────────────────────────────────────────────────────────
  check('backoff: 5 s, 10 s, 20 s, 40 s, then every 60 s',
    [0, 1, 2, 3, 4, 9].map(backgroundRetryDelayMs).join(',') === '5000,10000,20000,40000,60000,60000');
  check('backoff: garbage is the first step', backgroundRetryDelayMs(Number.NaN) === 5000 && backgroundRetryDelayMs(-3) === 5000);
  check('permanent: a refused folder, a bad argument, a missing submission, another phone',
    ['storage/not-your-folder', 'storage/invalid-argument', 'functions/invalid-argument', 'functions/not-found', 'functions/permission-denied', 'functions/failed-precondition']
      .every((c) => isPermanentBackgroundError(err(c))));
  check('not permanent: network, timeouts, server errors, auth refresh, unknown shapes',
    ['storage/unknown', 'storage/internal-error', 'storage/deadline-exceeded', 'storage/unauthorized', 'functions/unavailable', 'functions/internal', '']
      .every((c) => !isPermanentBackgroundError(err(c))) && !isPermanentBackgroundError(null) && !isPermanentBackgroundError('x'));

  // ── 1. Happy path: persisted first, the capture-time upload reused, attached, removed ────
  {
    const { store, m } = memStore();
    const uploads: string[] = []; const attached: Array<[string, Uploaded]> = [];
    const q = createBackgroundMedia({
      store, sleep: async () => {},
      upload: async (j) => { uploads.push(j.id); return { url: `u-${j.id}`, contentType: j.contentType }; },
      attach: async (j, up) => { attached.push([j.id, up]); },
    });
    let resolveFirst!: (u: Uploaded) => void;
    const first = new Promise<Uploaded>((r) => { resolveFirst = r; });
    await q.enqueue(job('a'), first);
    check('enqueue persists the job before it resolves', m.has('a'));
    check('pending counts the job while it is on its way', q.snapshot().pending === 1 && q.snapshot().pendingTaskIds.includes('t-a'));
    resolveFirst({ url: 'first-url', contentType: 'image/jpeg', posterUrl: 'p' });
    await tick();
    check('the capture-time upload is reused: no second upload', uploads.length === 0, uploads.join());
    check('attached with the uploaded file and poster', attached.length === 1 && attached[0][1].url === 'first-url' && attached[0][1].posterUrl === 'p');
    check('done: removed from the store and no longer pending', !m.has('a') && q.snapshot().pending === 0 && q.snapshot().failed === 0);
  }

  // ── 2. The capture-time upload failed: retried from the blob after a backoff ──────────
  {
    const { store } = memStore();
    const sleeps: number[] = []; let uploads = 0; let attached = 0;
    const q = createBackgroundMedia({
      store, sleep: async (ms) => { sleeps.push(ms); },
      upload: async () => { uploads++; if (uploads < 3) throw err('storage/unknown'); return { url: 'u', contentType: 'image/jpeg' }; },
      attach: async () => { attached++; },
    });
    await q.enqueue(job('b'), Promise.reject(err('storage/deadline-exceeded')));
    await tick(20);
    check('a failing first try falls back to uploading the blob, with backoff', uploads === 3 && attached === 1 && sleeps.join(',') === '5000,10000,20000', `${uploads} ${sleeps}`);
  }

  // ── 3. The upload landed but attach failed: only attach is retried, the url is kept ────
  {
    const { store, m } = memStore();
    let uploads = 0; let attaches = 0; let seenWhileFailing: BgJob | undefined;
    const q = createBackgroundMedia({
      store, sleep: async () => { seenWhileFailing = m.get('c'); },
      upload: async () => { uploads++; return { url: 'landed', contentType: 'image/jpeg' }; },
      attach: async () => { attaches++; if (attaches < 2) throw err('functions/unavailable'); },
    });
    await q.enqueue(job('c'));
    await tick(20);
    check('an attach failure never re-uploads', uploads === 1 && attaches === 2, `${uploads} ${attaches}`);
    check('the landed url is saved with the job, so a reload attaches without re-uploading', seenWhileFailing?.uploaded?.url === 'landed', JSON.stringify(seenWhileFailing?.uploaded));
  }

  // ── 4. A permanent refusal drops the job and counts it as failed ────────────────────
  {
    const { store, m } = memStore();
    const seen: string[] = [];
    const q = createBackgroundMedia({
      store, sleep: async () => {},
      upload: async () => ({ url: 'u', contentType: 'image/jpeg' }),
      attach: async () => { throw err('functions/not-found'); },
    });
    q.subscribe((s) => seen.push(`${s.pending}/${s.failed}`));
    await q.enqueue(job('d'));
    await tick(10);
    check('a permanent refusal is removed and counted', !m.has('d') && q.snapshot().pending === 0 && q.snapshot().failed === 1);
    check('subscribers hear every change', seen.includes('1/0') && seen[seen.length - 1] === '0/1', seen.join(' '));
    q.dismissFailed();
    check('the failure notice can be dismissed', q.snapshot().failed === 0);
  }

  // ── 5. Restore after a reload: resumed, an already uploaded file only attached ─────────
  {
    const stored = [job('e'), job('f', { uploaded: { url: 'already', contentType: 'image/jpeg' } })];
    const { store, m } = memStore(stored);
    const uploads: string[] = []; const attached: string[] = [];
    const q = createBackgroundMedia({
      store, sleep: async () => {},
      upload: async (j) => { uploads.push(j.id); return { url: `u-${j.id}`, contentType: 'image/jpeg' }; },
      attach: async (j, up) => { attached.push(`${j.id}:${up.url}`); },
    });
    const n = await q.restore();
    await tick(10);
    check('restore resumes every stored job', n === 2 && m.size === 0, `${n} ${m.size}`);
    check('restore re-uploads only what never landed', uploads.join() === 'e' && attached.sort().join() === 'e:u-e,f:already', `${uploads} ${attached}`);
    const again = await q.restore();
    check('a second restore starts nothing twice', again === 0);
  }

  // ── 6. A broken store (private window) degrades to memory, never breaks the upload ─────
  {
    const { store } = memStore([], { broken: true });
    let attached = 0;
    const q = createBackgroundMedia({
      store, sleep: async () => {},
      upload: async () => ({ url: 'u', contentType: 'image/jpeg' }),
      attach: async () => { attached++; },
    });
    await q.enqueue(job('g'));
    await tick(10);
    check('a store that throws still uploads and attaches', attached === 1 && q.snapshot().pending === 0);
    check('restore with a broken store is zero, not a throw', (await q.restore()) === 0);
  }

  // ── 7. The same task twice: the newer file wins, the older job is dropped ──────────────
  {
    const { store, m } = memStore();
    const attached: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const q = createBackgroundMedia({
      store, sleep: async () => {},
      upload: async (j) => { await gate; return { url: `u-${j.id}`, contentType: 'image/jpeg' }; },
      attach: async (j, up) => { attached.push(up.url); },
    });
    await q.enqueue(job('h1', { taskId: 'same' }));
    await q.enqueue(job('h2', { taskId: 'same' }));
    release();
    await tick(10);
    check('one job per task: only the newer file is attached', attached.join() === 'u-h2' && m.size === 0, attached.join());
  }
}

void main().then(() => {
  console.log(`\n${failures === 0 ? 'ALL BACKGROUND-MEDIA TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
});
