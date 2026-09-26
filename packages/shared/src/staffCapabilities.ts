// Staff capabilities (change: staff-capabilities).
//
// Staff invites used to carry a `permissions` array that nothing read, so every staff token could
// call every staff callable: a marshal handed a PIN to watch one station could add points to any
// team. Three layers now decide what a staff member may do:
//   1. the GAME default (`Game.staffDefaults`), set in the Builder; absent = full, today's behaviour;
//   2. the staff CODE (a run's `staffInvites` doc), shared by several people, each code with its
//      own capabilities, editable during the run;
//   3. the PERSON (`staffGrants/{uid}`), who can be removed.
// This module is the arithmetic every gate reads: the server (`assertStaffCan`), the callable
// hardening scan, the console's checklist and the staff app's action list. Pure and total.

export const STAFF_CAPABILITIES = [
  'safety',
  'staffChannel',
  'outline',
  'review',
  'score',
  'route',
  'hold',
  'broadcast',
  'chat',
  'feed',
  'tasks',
  'locations',
  'contactTeams',
] as const;

export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

/**
 * Never removable. Safety (SOS acknowledge, clearing a false out-of-bounds) must work for anyone
 * standing in the field; the staff channel is the marshal's line to the organizer; the outline is
 * mission NAMES only, without which the staff console shows raw ids.
 */
export const ALWAYS_GRANTED_CAPABILITIES: readonly StaffCapability[] = ['safety', 'staffChannel', 'outline'];

const MARSHAL: StaffCapability[] = ['chat', 'hold', 'locations'];
export const STAFF_PRESETS: Readonly<Record<'marshal' | 'judge' | 'full', readonly StaffCapability[]>> = {
  marshal: MARSHAL,
  judge: [...MARSHAL, 'review'],
  full: [...STAFF_CAPABILITIES],
};

/**
 * Which capability each staff-reachable callable needs. DECLARED, never inferred: the server gate
 * reads it, and `scripts/lib/callableHardening.mjs` fails when a callable that admits staff is
 * missing here or an entry names a callable that no longer exists.
 */
export const STAFF_CAPABILITY_BY_CALLABLE: Readonly<Record<string, StaffCapability>> = {
  acknowledgeAlert: 'safety',
  clearTeamOutOfBounds: 'safety',
  sendStaffChannelMessage: 'staffChannel',
  getRunOutline: 'outline',
  reviewStationSubmission: 'review',
  // Teams' own free-text survey answers: judging content, so it sits with review. Only the
  // organizer console calls it today; a staff token must still not read it by default.
  getRunSurveyResults: 'review',
  adjustTeamScore: 'score',
  skipTaskForTeam: 'route',
  forceAssignTask: 'route',
  returnTeamTo: 'route',
  setTeamHold: 'hold',
  pushAnnouncement: 'broadcast',
  deactivateAnnouncement: 'broadcast',
  pushFlashMission: 'broadcast',
  sendTeamChatMessage: 'chat',
  hideFeedItem: 'feed',
  setRunTaskStatus: 'tasks',
};

const KNOWN = new Set<string>(STAFF_CAPABILITIES);

/**
 * Validate a capability list from a client or a stored document: every id known, deduped, in the
 * canonical order. Returns null when ANY id is unknown or the value is not an array, so a typo is
 * refused loudly rather than silently granting less. Always-granted ids are accepted, not required.
 */
export function normalizeStaffCapabilities(input: unknown): StaffCapability[] | null {
  if (!Array.isArray(input)) return null;
  if (!input.every((x) => typeof x === 'string' && KNOWN.has(x))) return null;
  const set = new Set(input as string[]);
  return STAFF_CAPABILITIES.filter((c) => set.has(c));
}

/**
 * What a new code gets when the organizer does not choose: the game's default. Absent, or a stored
 * value that no longer validates, means FULL: that is the behaviour every existing game had, and
 * falling to "nothing" would hand the organizer a code that cannot do anything mid-event.
 */
export function defaultCodeCapabilities(staffDefaults: { capabilities?: unknown } | null | undefined): StaffCapability[] {
  const caps = normalizeStaffCapabilities(staffDefaults?.capabilities);
  return caps ?? [...STAFF_CAPABILITIES];
}

export interface StaffGrantFacts {
  codeId?: unknown;
  removed?: unknown;
}

export interface StaffCodeFacts {
  capabilities?: unknown;
  disabled?: unknown;
}

export interface StaffAccess {
  /** False = this person may do nothing at all (removed, or their code is gone). */
  allowed: boolean;
  /** Signed in before this change: no grant document exists. Treated as full. */
  legacy: boolean;
  capabilities: ReadonlySet<StaffCapability>;
}

/**
 * A person's effective capabilities. `grant === null` means a staff token with no grant document,
 * i.e. signed in before staff-capabilities shipped: full, and marked legacy so the server can log
 * it. A DISABLED code keeps the people already in (it stops new sign-ins only): an organizer
 * closing a leaked code mid-event must not also lock out the marshals standing at stations.
 */
export function resolveStaffAccess(facts: { grant: StaffGrantFacts | null; code: StaffCodeFacts | null }): StaffAccess {
  const { grant, code } = facts;
  if (!grant) {
    return { allowed: true, legacy: true, capabilities: new Set(STAFF_CAPABILITIES) };
  }
  if (grant.removed === true || !code) {
    return { allowed: false, legacy: false, capabilities: new Set() };
  }
  // A code minted before this change has NO capabilities field: full, so a run in flight at
  // deploy time keeps its staff. Only a PRESENT but malformed list falls to the always-granted set.
  if (code.capabilities === undefined) {
    return { allowed: true, legacy: true, capabilities: new Set(STAFF_CAPABILITIES) };
  }
  const own = normalizeStaffCapabilities(code.capabilities) ?? [];
  return {
    allowed: true,
    legacy: false,
    capabilities: new Set<StaffCapability>([...ALWAYS_GRANTED_CAPABILITIES, ...own]),
  };
}

export function staffCan(access: StaffAccess, capability: StaffCapability): boolean {
  return access.allowed && access.capabilities.has(capability);
}

/**
 * The machine-readable reason a staff refusal carries in the HttpsError's `details` (never in its
 * message, which is English and must not be classified or echoed). Both arrive as
 * `permission-denied`, the same code as an expired session, so without this a marshal whose code
 * lacks a permission would be sent back to the PIN screen, where the same code is refused again.
 */
export const STAFF_REFUSAL_REASON = {
  missing: 'staff-capability-missing',
  removed: 'staff-removed',
} as const;

export function staffRefusal(e: unknown): 'missing' | 'removed' | null {
  if (!e || typeof e !== 'object') return null;
  const details = (e as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const reason = (details as { reason?: unknown }).reason;
  if (reason === STAFF_REFUSAL_REASON.missing) return 'missing';
  if (reason === STAFF_REFUSAL_REASON.removed) return 'removed';
  return null;
}
