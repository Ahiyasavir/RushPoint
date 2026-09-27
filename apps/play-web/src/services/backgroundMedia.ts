// The real wiring of the background media queue (change: background-media-upload, D3): IndexedDB
// for surviving a reload, the quiet upload helpers, and attachSubmissionMedia. The decisions all
// live in lib/backgroundMedia.ts, which scripts/test-background-media.ts covers.
import { createBackgroundMedia, type BgJob, type BgStore, type BackgroundMedia } from '../lib/backgroundMedia';
import { uploadTaskMedia, uploadTaskPoster, sleepUntilVisible } from './firebase';
import { attachSubmissionMedia } from './calls';
import { posterTaskId } from '../lib/posterFrame';

const DB_NAME = 'rp-bg-media';
const STORE = 'jobs';

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
    });
    // A failed open is retried on the next call rather than cached as a permanent failure.
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  }));
}

const idbStore: BgStore = {
  async put(job) { await run('readwrite', (s) => s.put(job)); },
  async remove(id) { await run('readwrite', (s) => s.delete(id)); },
  async all() { return (await run<BgJob[]>('readonly', (s) => s.getAll() as IDBRequest<BgJob[]>)) ?? []; },
};

export const backgroundMedia: BackgroundMedia = createBackgroundMedia({
  store: idbStore,
  sleep: sleepUntilVisible,
  async upload(job) {
    const up = await uploadTaskMedia(job.kind, job.blob, { runId: job.ctx.runId, taskId: job.taskId, contentType: job.contentType, quiet: true });
    // The poster never holds the clip: any failure is simply "no poster".
    const posterUrl = job.poster
      ? await uploadTaskPoster(job.poster, { runId: job.ctx.runId, taskId: posterTaskId(job.taskId) }).catch(() => undefined)
      : undefined;
    return { ...up, ...(posterUrl ? { posterUrl } : {}) };
  },
  async attach(job, up) {
    await attachSubmissionMedia({
      ...job.ctx, taskId: job.taskId, photoUrl: up.url, contentType: up.contentType,
      // Omitted, never null, when absent (the undefined-to-null transport rule).
      ...(up.posterUrl ? { posterUrl: up.posterUrl } : {}),
    });
  },
});

let restored = false;
/** Resume whatever a reload left behind. Called once the player is signed in; safe to repeat. */
export function restoreBackgroundMedia(): void {
  if (restored) return;
  restored = true;
  void backgroundMedia.restore();
}
