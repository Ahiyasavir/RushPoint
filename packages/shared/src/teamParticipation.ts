// How many of a team's people are actually here, and acting
// (change: every-member-plays).
//
// THE REPORTED PROBLEM. "It is enough for one participant to watch the video or do the
// mission for the team to advance, which leads to some members being inactive."
//
// THAT IS THE DESIGN, NOT A DEFECT. `types/index.ts` states it plainly: "one phone per
// attached participant; EXACTLY ONE (controllerUid) may submit". Every mutating
// participant callable passes `{ requireController: true }`, and `assertController`
// rejects every other device with `not-controller`. A teammate on their own phone is,
// by construction, a spectator.
//
// And a team could not even all attach: `MAX_TEAM_DEVICES = 3`, with `canAttachDevice`
// refusing the fourth as 'full'. The six-person teams in run ijI9JMITSf8C9heN1Cwp were
// physically unable to satisfy "everyone on their own device" before anyone tried.
//
// Meanwhile `RunTeam` already carried BOTH numbers this needs — `memberCount` (people
// the team said they are) and `deviceUids` (phones that turned up) — and nothing in the
// product ever compared them. A team of six sharing one phone was indistinguishable from
// a solo player on every screen in the product.
//
// ─── THE RULE THAT SHAPES EVERYTHING HERE ────────────────────────────────────
//
// UNKNOWN IS A FIRST-CLASS ANSWER. `memberCount` is only meaningful when the game
// actually collects member names — `joinRun` writes `memberNames.length || 1`, so in
// individual mode, and in team mode with no names field, it is 1. Reporting "five people
// missing" for a game that never asked how many people there are would be a confident
// lie, and a gate built on it would hold teams for a question they were never asked.
//
// So a shortfall is `null` when it cannot be known — never 0, which would claim full
// attendance, and never the headcount, which would claim nobody came. The attendance
// gate reads null as "do not block".
//
// Dependency-free — scripts/test-team-participation.ts.

/**
 * Today's fixed per-team ceiling, which becomes the FLOOR.
 *
 * Load-bearing: no team may lose capacity it has today. A solo player with a spare
 * handset, and every team whose headcount is unknown, keeps exactly this.
 */
export const TEAM_DEVICE_FLOOR = 3;

/**
 * The most devices one team may ever hold.
 *
 * This exists to stop a single team eating the run's whole device budget — a team that
 * typed 999 into a headcount field must not be able to write itself an unbounded
 * allowance. It is NOT the read-cost control: `MAX_RUN_DEVICES` (runCapacity.ts) bounds
 * total phones in a run, which is the unit that actually maps to Firestore reads, and it
 * is unchanged. Raising a team's share of that fixed total reallocates phones between
 * teams; it does not create new ones.
 */
export const TEAM_DEVICE_HARD_CAP = 8;

/** The minimum of a team these helpers need. */
export interface ParticipationTeam {
  id?: string;
  memberCount?: number | null;
  deviceUids?: readonly string[] | null;
}

export interface TeamAttendance {
  /** People the team declared, or null when that cannot be known. */
  declared: number | null;
  /** Distinct devices attached. Always a number; a legacy doc counts its founder. */
  attached: number;
  /** People not yet connected, or null when the headcount is unknown. */
  missing: number | null;
  /** Is anyone knowably missing? False whenever `missing` is null. */
  short: boolean;
}

/** A whole number above zero, or null. */
function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * How many people the team declared, or null when that is unknowable.
 *
 * A count of 1 is treated as UNKNOWN rather than as a genuine solo team, because it is
 * also the default `joinRun` writes when a game collects no member names — the two are
 * indistinguishable in the stored data. Treating it as "fully attended" would be a lie
 * in the other direction, and would silently pass an attendance gate for every game that
 * never asked.
 */
function declaredMembers(team: ParticipationTeam): number | null {
  const n = positiveInt(team.memberCount);
  return n === null || n <= 1 ? null : n;
}

/** Distinct attached device uids. A legacy doc implies just the founding uid. */
function attachedCount(team: ParticipationTeam): number {
  const raw = Array.isArray(team.deviceUids) ? team.deviceUids : [];
  const seen = new Set<string>();
  for (const uid of raw) {
    if (typeof uid === 'string' && uid) seen.add(uid);
  }
  // Mirrors `attachedDeviceUids` in functions/src/runs/teamDevices.ts: an absent or
  // empty array means the founding device is the only one.
  return seen.size > 0 ? seen.size : 1;
}

/** Who is here, who is not, and whether we can even tell. */
export function teamAttendance(team: ParticipationTeam): TeamAttendance {
  const safe = (team && typeof team === 'object' && !Array.isArray(team))
    ? team
    : ({} as ParticipationTeam);

  const declared = declaredMembers(safe);
  const attached = attachedCount(safe);
  // Never negative: more phones than declared people is legitimate (a spare handset, a
  // parent watching) and must not read as an error.
  const missing = declared === null ? null : Math.max(0, declared - attached);
  return { declared, attached, missing, short: missing !== null && missing > 0 };
}

/**
 * How many devices this team may attach.
 *
 * Never below today's constant, so nothing regresses; never above the hard cap, so one
 * team cannot claim the run's whole budget. The run-wide ceiling
 * (`canAddRunDevice`) still decides last and is the authority when the two disagree.
 */
export function teamDeviceAllowance(team: ParticipationTeam): number {
  const safe = (team && typeof team === 'object' && !Array.isArray(team))
    ? team
    : ({} as ParticipationTeam);
  const declared = positiveInt(safe.memberCount);
  if (declared === null) return TEAM_DEVICE_FLOOR;
  return Math.max(TEAM_DEVICE_FLOOR, Math.min(declared, TEAM_DEVICE_HARD_CAP));
}

/**
 * The wire value `getMyTeamState` reports, and `holdNotice` recognises, when a team is
 * waiting for the rest of its people to connect.
 *
 * A string rather than a boolean because `holdReason` already carries one hold kind
 * (`guardian_consent`) and an app version that predates this one resolves an unfamiliar
 * value to `unknown` — held, generic copy, help offered — rather than to "not held".
 * So a new reason ships safely to a client that has never heard of it.
 */
export const MEMBERS_OFFLINE_HOLD = 'members_offline';

/** The minimum of a game the attendance gate needs. */
export interface AttendanceGameConfig {
  requireAllMembersOnline?: boolean;
}

/**
 * Should this team wait until the rest of its people are on their own phones?
 *
 * FAILS OPEN, twice over, and both matter:
 *
 *  • The setting must be a LITERAL `true`. This holds a team out of a game they turned
 *    up to play, so a stored `"true"` string or a legacy truthy value is not consent
 *    to that.
 *  • An UNKNOWN headcount never holds. `memberCount` is only meaningful when the game
 *    collects member names, so holding on it would block a team for a question they
 *    were never asked — and the organizer would have no idea why.
 *
 * Total: a malformed team or game holds nobody.
 */
export function teamShouldWaitForMembers(
  team: ParticipationTeam,
  game: AttendanceGameConfig,
): boolean {
  const cfg = (game && typeof game === 'object' && !Array.isArray(game))
    ? game
    : ({} as AttendanceGameConfig);
  if (cfg.requireAllMembersOnline !== true) return false;
  return teamAttendance(team).short;
}

/**
 * How many contributors a mission really needs from THIS team.
 *
 * Reduced to what the team can actually achieve. A mission authored for four
 * contributors, played by a team of two, must not be unwinnable — the same rule
 * `planTaskSkip` applies to a stage's `requiredTaskCount`, applied to people.
 */
export function effectiveContributorRequirement(
  required: number | null | undefined,
  attachedDevices: number,
): number {
  const want = positiveInt(required);
  if (want === null) return 0;
  const have = positiveInt(attachedDevices);
  if (have === null) return 0;
  return Math.min(want, have);
}

/**
 * Have enough DISTINCT devices contributed?
 *
 * Distinctness is the whole point: one phone tapped three times is one person, and
 * counting it three times would make the requirement decorative.
 */
export function contributorsSatisfied(
  contributors: readonly string[] | null | undefined,
  required: number | null | undefined,
): boolean {
  const want = positiveInt(required);
  if (want === null) return true;
  const raw = Array.isArray(contributors) ? contributors : [];
  const seen = new Set<string>();
  for (const uid of raw) {
    if (typeof uid === 'string' && uid) seen.add(uid);
  }
  return seen.size >= want;
}
