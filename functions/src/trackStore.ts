// The run's GPS movement track, stored on the VPS's own disk (change: vps-track-storage).
//
// WHY THIS EXISTS. `spark-tier-location-load` retains one track point per ~100 m travelled
// instead of one per ping. That sampling buys nothing except Firestore write quota — it is a
// compromise, not a feature. On the self-hosted VPS the same Node process that serves
// `updateLocation` already writes participant media to local disk (`storageUtil.ts`,
// `UPLOAD_DIR`), where a write costs nothing against the Spark ceilings. Once the write is
// free there is no reason left to sample, so this store records EVERY ping and the post-run
// heatmap becomes exact rather than approximate.
//
// ⚠️ PRECONDITION: a SINGLE API process. This is the FIFTH module resting on it, alongside
// `docCache.ts`, `rateLimitStore.ts`, `lastFixStore.ts` and `runs/locationFreshnessCache.ts`:
//
//   (a) The write queue below serialises appends WITHIN one process. Two processes writing the
//       same run's file would interleave, and the queue could not see it.
//   (b) The disk itself is local to one machine, so a second instance elsewhere would write a
//       different, partial file.
//
// Unlike the memory-backed four, the failure here is CORRUPTION rather than mere staleness, so
// this is the one to revisit first if the API is ever scaled out. Firestore mode (the fallback)
// has no such constraint and stays available by simply leaving the env var unset.
//
// OFF BY DEFAULT. `RUSHPOINT_TRACK_DIR` unset ⇒ every operation is inert and `read()` returns
// null, so `getRunHeatmap` falls back to Firestore and behavior is byte-for-byte what it was
// before this module existed. The emulator and real Cloud Functions have no stable local disk
// and must never set it.
//
// BEST-EFFORT THROUGHOUT. `updateLocation` already documents that the movement track must never
// fail a location update. Every function here catches internally and logs; none can throw.

import * as functions from 'firebase-functions';
import fs from 'node:fs';
import path from 'node:path';

/** The env var that points at the track root. Unset/blank ⇒ disk storage is off. */
export const TRACK_DIR_ENV = 'RUSHPOINT_TRACK_DIR';

export interface TrackRunRef {
  ownerUid: string;
  gameId: string;
  runId: string;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  teamId?: string;
  /** ISO timestamp, as written by the caller. */
  at?: string;
}

export interface TrackStore {
  /** Whether a root is configured. When false every method is a no-op. */
  readonly enabled: boolean;
  /** Append one point to a run's track. Never throws. */
  append(ref: TrackRunRef, point: TrackPoint): Promise<void>;
  /**
   * Every stored point for a run, or **null when no file exists** — the caller must be able to
   * tell "nothing was ever written here, go and read Firestore" apart from "disk mode is active
   * and this run genuinely has no points yet", which is `[]`. Never throws.
   */
  read(ref: TrackRunRef): Promise<TrackPoint[] | null>;
  /** Remove a run's track. A run with no file is a silent no-op. Never throws. */
  delete(ref: TrackRunRef): Promise<void>;
}

/**
 * A path segment is safe only if it is a plain name. Rejecting outright (rather than stripping
 * or escaping) is deliberate: these ids come from validated callable input, so anything shaped
 * like a traversal is a bug or an attack, and quietly rewriting it into a *different* valid
 * path would hide both.
 */
function safeSegment(seg: unknown): seg is string {
  return (
    typeof seg === 'string' &&
    seg.length > 0 &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.includes('/') &&
    !seg.includes('\\') &&
    !seg.includes('\0')
  );
}

export function createTrackStore(opts: { root?: string }): TrackStore {
  const root = typeof opts.root === 'string' ? opts.root.trim() : '';
  const enabled = root.length > 0;

  // One promise chain per run file. Appends to the SAME run serialise through it; appends to
  // DIFFERENT runs never wait on each other. Same keyed-isolation shape as docCache's per-path
  // invalidation and lastFixStore's per-key map.
  //
  // This is not merely belt-and-braces over `fs.appendFile`'s POSIX atomicity: that guarantee
  // only holds below PIPE_BUF, and a future field on TrackPoint could cross it without anyone
  // noticing. Stating the invariant directly costs one Map and survives that change.
  const queues = new Map<string, Promise<void>>();

  /** Absolute path for a run's file, or null if anything about the reference is unsafe. */
  function fileFor(ref: TrackRunRef): string | null {
    if (!enabled || !ref) return null;
    if (!safeSegment(ref.ownerUid) || !safeSegment(ref.gameId) || !safeSegment(ref.runId)) {
      functions.logger.warn('trackStore: refused unsafe run reference', {
        ownerUid: ref.ownerUid, gameId: ref.gameId, runId: ref.runId,
      });
      return null;
    }

    const target = path.resolve(root, ref.ownerUid, ref.gameId, `${ref.runId}.jsonl`);
    const base = path.resolve(root);
    // Second, independent check: even with clean segments, resolve() is the authority on where
    // the path actually lands. Mirrors safeUploadPath() in storageUtil.ts.
    if (!target.startsWith(base + path.sep)) {
      functions.logger.warn('trackStore: refused path escape', { runId: ref.runId });
      return null;
    }
    return target;
  }

  function keyFor(ref: TrackRunRef): string {
    return `${ref.ownerUid}/${ref.gameId}/${ref.runId}`;
  }

  return {
    enabled,

    append(ref, point) {
      const file = fileFor(ref);
      if (!file) return Promise.resolve();

      // A non-finite coordinate would be serialised by JSON.stringify as `null` and read back
      // as a point at null island — a real team apparently off the coast of Africa. Refuse it
      // at the door so the file stays trustworthy for the aggregator.
      if (
        !point ||
        typeof point.lat !== 'number' || !Number.isFinite(point.lat) ||
        typeof point.lng !== 'number' || !Number.isFinite(point.lng)
      ) {
        return Promise.resolve();
      }

      const line = `${JSON.stringify({
        lat: point.lat,
        lng: point.lng,
        ...(point.teamId ? { teamId: point.teamId } : {}),
        ...(point.at ? { at: point.at } : {}),
      })}\n`;

      const key = keyFor(ref);
      const previous = queues.get(key) ?? Promise.resolve();
      const next = previous.then(async () => {
        try {
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.appendFile(file, line, 'utf8');
        } catch (e) {
          // Best-effort by contract: a location ping must never fail because a disk write did.
          functions.logger.warn('trackStore: append failed', { runId: ref.runId, err: String(e) });
        }
      });

      queues.set(key, next);
      // Drop the chain once it drains, so a long-lived process does not accumulate one entry
      // per run forever. Only if nothing newer was queued behind it in the meantime.
      void next.then(() => {
        if (queues.get(key) === next) queues.delete(key);
      });
      return next;
    },

    async read(ref) {
      const file = fileFor(ref);
      if (!file) return null;
      let raw: string;
      try {
        raw = await fs.promises.readFile(file, 'utf8');
      } catch {
        // No file (or unreadable) ⇒ null, so the caller falls back to Firestore. Deliberately
        // NOT an empty array: see the `read` contract above.
        return null;
      }

      const points: TrackPoint[] = [];
      for (const line of raw.split('\n')) {
        if (!line) continue;
        try {
          const rec = JSON.parse(line) as TrackPoint;
          // One torn or hand-edited line must not destroy an entire run's track.
          if (Number.isFinite(rec?.lat) && Number.isFinite(rec?.lng)) points.push(rec);
        } catch {
          // Skip and keep going.
        }
      }
      return points;
    },

    async delete(ref) {
      const file = fileFor(ref);
      if (!file) return;
      try {
        await fs.promises.rm(file, { force: true });
      } catch (e) {
        functions.logger.warn('trackStore: delete failed', { runId: ref.runId, err: String(e) });
      }
    },
  };
}

/** The process-wide store. One per API process, by design (see the note above). */
export const trackStore = createTrackStore({ root: process.env[TRACK_DIR_ENV] });
