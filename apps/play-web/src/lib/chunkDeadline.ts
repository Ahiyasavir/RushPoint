/**
 * A deadline for a lazy chunk import (2026-10-22). `lazyWithRetry` heals an import that FAILS with
 * one reload, but an import that never settles (a request stuck on weak reception) used to wait
 * forever: the production stress of the join found a phone that joined its team in 5 s and then
 * showed nothing and asked for nothing. Past the deadline the import rejects, so the same one-reload
 * heal runs. creator-web carries an identical copy (packages/shared is framework-free and these are
 * the apps' own helpers); scripts/test-chunk-import-deadline.ts keeps the two the same.
 */
export const CHUNK_IMPORT_DEADLINE_MS = 30_000;

export function withImportDeadline<T>(p: Promise<T>, ms: number = CHUNK_IMPORT_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`chunk import did not settle in ${ms} ms`), { name: 'ChunkImportTimeout' }));
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
