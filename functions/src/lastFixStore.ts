// Where a team's last written location lives (change: spark-tier-location-load).
//
// The DECISION lives in the pure `shouldWritePin` / `shouldRetainTrackPoint` functions in
// @rushpoint/shared. This file only owns WHERE the per-team reference state is kept.
//
// WHY IN MEMORY AND NOT IN FIRESTORE: the whole point of the change is to stop
// `updateLocation` costing a read and two writes on every ping. Reading
// `teamLocations/{teamId}` in order to decide whether to write `teamLocations/{teamId}`
// would add back exactly the read we are removing, and the saving would be zero.
//
// ⚠️ PRECONDITION: a SINGLE API process — the same precondition docCache.ts and
// rateLimitStore.ts already carry, and for the same underlying reasons:
//
//   (a) The API is the SOLE writer of `teamLocations` (`firestore.rules` denies client
//       writes on every run subcollection), so its own memory is authoritative about what
//       it last wrote.
//   (b) There is exactly ONE such process. functions/server.js has no `cluster`, and
//       docker-compose.api.yml runs a single replica.
//
// If the API is ever scaled horizontally, each process would hold a partial view: a team
// whose pings land on process B would be invisible to process A's suppression logic. The
// failure is BENIGN — an unknown team writes — so scaling out degrades to today's cost
// rather than to a wrong answer. Revisit this file before raising replicas anyway.
//
// Losing state is always the safe direction: an absent entry means the next ping writes.
// That covers restarts, cap eviction and idle reclamation alike.

import type { StoredFix } from '@rushpoint/shared';

/** Drop a team's record after this long with no ping — a finished run, or a phone gone home. */
export const LAST_FIX_IDLE_MS = 30 * 60 * 1000;

/** Hard ceiling on retained keys, so the map cannot grow without bound. */
const MAX_KEYS = 50_000;

/** Sweep every N writes, so memory is bounded without a timer keeping the process alive. */
const RECLAIM_EVERY = 1_000;

export interface TeamFixRecord {
  /** The last fix actually written to `teamLocations`. */
  pin?: StoredFix;
  /** The last point actually appended to `locationTrack`. */
  track?: { lat: number; lng: number };
  /** When this team was last seen, for idle reclamation. */
  seenMs: number;
}

export interface LastFixStore {
  get(key: string): TeamFixRecord | undefined;
  recordPin(key: string, fix: StoredFix, nowMs: number): void;
  recordTrack(key: string, point: { lat: number; lng: number }, nowMs: number): void;
  /** Drop every entry idle for longer than the window. */
  reclaim(nowMs: number): void;
  size(): number;
}

/**
 * Build an isolated store. Exported as a factory so the pure suite can drive the clock and
 * the bounds; production uses the module singleton below.
 */
export function createLastFixStore(opts: {
  maxKeys?: number;
  idleMs?: number;
  reclaimEvery?: number;
} = {}): LastFixStore {
  const maxKeys = opts.maxKeys ?? MAX_KEYS;
  const idleMs = opts.idleMs ?? LAST_FIX_IDLE_MS;
  const reclaimEvery = opts.reclaimEvery ?? RECLAIM_EVERY;

  const records = new Map<string, TeamFixRecord>();
  let sinceReclaim = 0;

  function reclaim(nowMs: number): void {
    // A non-finite clock cannot classify anything as idle. Sweeping on it would compare
    // against NaN — which is false for every entry, so nothing would be dropped anyway —
    // but returning early keeps the intent explicit rather than accidental.
    if (!Number.isFinite(nowMs)) { sinceReclaim = 0; return; }
    for (const [key, rec] of records) {
      if (nowMs - rec.seenMs >= idleMs) records.delete(key);
    }
    sinceReclaim = 0;
    trim();
  }

  // Reclamation only frees IDLE entries, so it frees nothing while every team is live.
  // play-web signs in anonymously, so uids are free to mint and every one is a fresh live
  // key — the real bound has to be applied on every insert, not only on the sweep.
  //
  // Evicting a live entry is the lesser evil and is deliberately chosen: the team simply
  // writes on its next ping (today's behavior), whereas an unbounded map is an OOM that
  // takes the whole API down mid-run.
  function trim(): void {
    while (records.size > maxKeys) {
      const oldest = records.keys().next();
      if (oldest.done) return;
      records.delete(oldest.value);
    }
  }

  function touch(key: string, nowMs: number): TeamFixRecord | undefined {
    if (typeof key !== 'string' || key.length === 0) return undefined;
    if (++sinceReclaim >= reclaimEvery || records.size > maxKeys) reclaim(nowMs);

    const seenMs = Number.isFinite(nowMs) ? nowMs : 0;
    const existing = records.get(key);
    if (existing) {
      existing.seenMs = seenMs;
      return existing;
    }
    const fresh: TeamFixRecord = { seenMs };
    records.set(key, fresh);
    return fresh;
  }

  return {
    get(key) {
      return typeof key === 'string' ? records.get(key) : undefined;
    },

    recordPin(key, fix, nowMs) {
      if (!fix || typeof fix !== 'object') return;
      const rec = touch(key, nowMs);
      if (!rec) return;
      rec.pin = { lat: fix.lat, lng: fix.lng, atMs: fix.atMs };
      trim();
    },

    recordTrack(key, point, nowMs) {
      if (!point || typeof point !== 'object') return;
      const rec = touch(key, nowMs);
      if (!rec) return;
      rec.track = { lat: point.lat, lng: point.lng };
      trim();
    },

    reclaim,
    size: () => records.size,
  };
}

/** The process-wide store. One per API process, by design (see the note above). */
export const lastFixStore = createLastFixStore();

/** Key a team's record by its run AND id — the same team id in another run is another team. */
export function lastFixKey(runId: string, teamId: string): string {
  return `${runId}:${teamId}`;
}
