// When each phone of a team last asked for the team state (change: team-phones-simple, D5).
//
// Feeds the "the sending phone went quiet, take over" notice. Kept in PROCESS MEMORY, touched by
// getMyTeamState, which every phone already calls on every team snapshot and at least once a
// minute: zero Firestore reads or writes, which matters under the Spark quota.
//
// SINGLE-PROCESS PRECONDITION (the sixth module resting on it, with docCache.ts,
// rateLimitStore.ts, lastFixStore.ts, runs/locationFreshnessCache.ts and trackStore.ts): with
// several API processes each would see only its own callers. The failure is benign by design:
// an unknown phone reads as NOT quiet (senderQuiet fails open), so a restart or a second process
// can only delay the notice, never raise a false one.
//
// Bounded: a team keeps at most its device cap (the longest-silent phone is dropped first), the
// store keeps at most `maxTeams` teams (the least recently touched is dropped), and a team idle
// past the window is forgotten on read.

export interface DevicePresenceEntry { uid: string; lastSeenSec: number }

export interface DevicePresenceStore {
  touch(teamKey: string, uid: string, nowMs: number): void;
  /** Most recent first. Never negative, never throws. */
  list(teamKey: string, nowMs: number): DevicePresenceEntry[];
}

export function createDevicePresenceStore(opts: {
  maxDevicesPerTeam?: number;
  maxTeams?: number;
  idleMs?: number;
} = {}): DevicePresenceStore {
  const maxDevices = opts.maxDevicesPerTeam ?? 12;
  const maxTeams = opts.maxTeams ?? 20_000;
  const idleMs = opts.idleMs ?? 30 * 60 * 1000;
  // Map iteration order is insertion order: re-inserting on touch keeps the least recently
  // touched team first, so eviction is O(1).
  const teams = new Map<string, Map<string, number>>();

  return {
    touch(teamKey, uid, nowMs) {
      if (!teamKey || !uid || !Number.isFinite(nowMs)) return;
      const phones = teams.get(teamKey) ?? new Map<string, number>();
      teams.delete(teamKey);
      phones.delete(uid);
      phones.set(uid, nowMs);
      while (phones.size > maxDevices) {
        let oldest: string | null = null;
        let oldestMs = Infinity;
        for (const [u, ms] of phones) if (ms < oldestMs) { oldestMs = ms; oldest = u; }
        if (oldest === null) break;
        phones.delete(oldest);
      }
      teams.set(teamKey, phones);
      while (teams.size > maxTeams) {
        const first = teams.keys().next();
        if (first.done) break;
        teams.delete(first.value);
      }
    },
    list(teamKey, nowMs) {
      const phones = teams.get(teamKey);
      if (!phones || !Number.isFinite(nowMs)) return [];
      let newest = -Infinity;
      for (const ms of phones.values()) if (ms > newest) newest = ms;
      if (nowMs - newest >= idleMs) { teams.delete(teamKey); return []; }
      return [...phones.entries()]
        .map(([uid, ms]) => ({ uid, lastSeenSec: Math.max(0, Math.floor((nowMs - ms) / 1000)) }))
        .sort((a, b) => a.lastSeenSec - b.lastSeenSec);
    },
  };
}

/** The API's one instance. See the single-process precondition above. */
export const devicePresence = createDevicePresenceStore();
