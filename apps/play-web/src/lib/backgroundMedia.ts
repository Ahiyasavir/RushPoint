// The background media queue (change: background-media-upload, D3).
//
// On an auto-approved photo, clip or recording the server approves FIRST (submitStationPhoto with
// `mediaDeferred`), the team is routed on at once, and this queue owns the upload afterwards: it
// sends the file and attaches it to the submission (attachSubmissionMedia).
//
// Rules it keeps:
//  - Never lose a file: a job is persisted before `enqueue` resolves, so the UI only moves on once
//    the file is safe, and `restore` resumes whatever a reload or a killed tab left behind.
//  - Never send the bytes twice: the first attempt reuses the capture-time upload already in
//    flight, and an upload that landed is saved with the job, so a failed ATTACH only retries the
//    attach (after a reload too).
//  - Retry on its own, forever, on a curve; give up only on a refusal no retry can change.
//  - One job per task: a newer file for the same mission supersedes the older job.
//
// Framework free: every dependency is injected, so scripts/test-background-media.ts drives it
// without a network or IndexedDB. services/backgroundMedia.ts wires the real ones.

export type BgKind = 'photo' | 'audio' | 'video';

export interface Uploaded {
  url: string;
  contentType: string;
  posterUrl?: string;
}

export interface BgJob {
  id: string;
  ctx: { ownerUid: string; gameId: string; runId: string };
  taskId: string;
  kind: BgKind;
  contentType: string;
  blob: Blob;
  /** A video's poster frame, when one was captured. Its failure never holds the clip. */
  poster?: Blob;
  durationSec?: number;
  createdAt: number;
  /** Set once the file landed, so a later attempt (or a reload) only attaches. */
  uploaded?: Uploaded;
}

export interface BgStore {
  put(job: BgJob): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<BgJob[]>;
}

export interface BgSnapshot {
  pending: number;
  failed: number;
  pendingTaskIds: string[];
}

export interface BgDeps {
  upload(job: BgJob, attempt: number): Promise<Uploaded>;
  attach(job: BgJob, up: Uploaded): Promise<void>;
  store: BgStore;
  sleep(ms: number): Promise<void>;
}

export interface BackgroundMedia {
  /** Persist the job, then start it. `firstTry` is the capture-time upload already in flight. */
  enqueue(job: BgJob, firstTry?: Promise<Uploaded>): Promise<void>;
  /** Resume stored jobs that are not already running. Returns how many were started. */
  restore(): Promise<number>;
  snapshot(): BgSnapshot;
  subscribe(fn: (s: BgSnapshot) => void): () => void;
  dismissFailed(): void;
}

const RETRY_STEPS_MS = [5_000, 10_000, 20_000, 40_000];
const RETRY_CEILING_MS = 60_000;

/** 5 s, 10 s, 20 s, 40 s, then every 60 s. Total: garbage reads as the first step. */
export function backgroundRetryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return n < RETRY_STEPS_MS.length ? RETRY_STEPS_MS[n] : RETRY_CEILING_MS;
}

// Refusals that mean "this file can never be attached": the folder is not this phone's, the
// server calls the request malformed, the submission is gone, another phone owns it, or the
// mission refuses it. Everything else (network, timeouts, server errors, an expired token) is
// worth another try. An unknown shape is NOT permanent: dropping a player's file on a guess is
// the one outcome this queue exists to prevent.
const PERMANENT_CODES = new Set([
  'storage/not-your-folder',
  'storage/invalid-argument',
  'functions/invalid-argument',
  'functions/not-found',
  'functions/permission-denied',
  'functions/failed-precondition',
]);

export function isPermanentBackgroundError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && PERMANENT_CODES.has(code);
}

export function createBackgroundMedia(deps: BgDeps): BackgroundMedia {
  // Running jobs by id, and the job currently owning each task.
  const running = new Map<string, BgJob>();
  const byTask = new Map<string, string>();
  const superseded = new Set<string>();
  const listeners = new Set<(s: BgSnapshot) => void>();
  let failed = 0;

  const snapshot = (): BgSnapshot => ({
    pending: running.size,
    failed,
    pendingTaskIds: [...running.values()].map((j) => j.taskId),
  });
  const announce = () => {
    const s = snapshot();
    for (const fn of listeners) { try { fn(s); } catch { /* a listener never breaks an upload */ } }
  };
  // The store is a convenience for surviving a reload; it failing must never fail the upload.
  const safe = async (p: () => Promise<void>) => { try { await p(); } catch { /* memory only */ } };

  function finish(job: BgJob, outcome: 'done' | 'failed' | 'superseded') {
    running.delete(job.id);
    superseded.delete(job.id);
    if (byTask.get(job.taskId) === job.id) byTask.delete(job.taskId);
    if (outcome === 'failed') failed++;
    void safe(() => deps.store.remove(job.id));
    announce();
  }

  async function work(job: BgJob, firstTry?: Promise<Uploaded>): Promise<void> {
    let attempt = 0;
    let first = firstTry;
    for (;;) {
      if (superseded.has(job.id)) { finish(job, 'superseded'); return; }
      try {
        if (!job.uploaded) {
          const up = first ? await first : await deps.upload(job, attempt);
          first = undefined;
          if (superseded.has(job.id)) { finish(job, 'superseded'); return; }
          job.uploaded = up;
          await safe(() => deps.store.put(job));
        }
        await deps.attach(job, job.uploaded);
        finish(job, 'done');
        return;
      } catch (e) {
        first = undefined;
        if (isPermanentBackgroundError(e)) { finish(job, 'failed'); return; }
        await deps.sleep(backgroundRetryDelayMs(attempt));
        attempt++;
      }
    }
  }

  function start(job: BgJob, firstTry?: Promise<Uploaded>) {
    const prev = byTask.get(job.taskId);
    if (prev && prev !== job.id) superseded.add(prev);
    byTask.set(job.taskId, job.id);
    running.set(job.id, job);
    announce();
    void work(job, firstTry);
  }

  return {
    async enqueue(job, firstTry) {
      // A rejection of the in-flight upload before work() awaits it must not surface as unhandled.
      firstTry?.catch(() => undefined);
      await safe(() => deps.store.put(job));
      start(job, firstTry);
    },
    async restore() {
      let stored: BgJob[] = [];
      try { stored = await deps.store.all(); } catch { return 0; }
      let n = 0;
      for (const job of stored.sort((a, b) => a.createdAt - b.createdAt)) {
        if (running.has(job.id)) continue;
        start(job);
        n++;
      }
      return n;
    },
    snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    dismissFailed() {
      if (failed === 0) return;
      failed = 0;
      announce();
    },
  };
}
