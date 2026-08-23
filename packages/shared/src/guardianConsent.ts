// Guardian-consent gate (change: guardian-consent-qr). A run can require a
// guardian to approve before a minor's team starts playing. The decision is a
// pure predicate so the gate can be unit-tested and reused by the server + client.

/** A guardian's recorded approval, stored on the team doc once granted. */
export interface GuardianConsent {
  guardianName?: string;
  grantedAt?: string; // ISO; present only once approved
}

/** A single-use consent token issued by requestGuardianConsent. */
export interface ConsentRecord {
  token: string;
  teamId: string;
  guardianName?: string;
  grantedAt?: string;
  used: boolean;
  createdAt: string;
}

/**
 * Whether a team is cleared to start. Runs that don't require consent are always
 * satisfied; runs that do require a recorded `grantedAt` on the team's consent.
 */
export function isConsentSatisfied(
  team: { guardianConsent?: GuardianConsent | null },
  runConfig: { requiresGuardianConsent?: boolean },
): boolean {
  if (!runConfig.requiresGuardianConsent) return true;
  return !!team.guardianConsent?.grantedAt;
}

// ─── Reporting the hold (change: expose-enforced-settings) ────────────────────
//
// `startTeams` filtered un-consented teams out of the cohort and returned only a
// count of what DID start, so a team held for consent was the difference between
// two numbers the caller never saw. The organizer was told "started all teams"
// over a no-op. This partition is what the launch path and the reported count are
// BOTH derived from, so the number and the behavior cannot drift.

/** A cohort split into the teams that may start and the teams held for consent. */
export interface ConsentPartition<T> {
  ready: T[];
  held: T[];
}

/**
 * Split a cohort by consent. Total, order-preserving, and a true partition:
 * `ready ∪ held` is exactly the input and the two sides are disjoint. Delegates
 * per team to `isConsentSatisfied` so "consented" has exactly one definition.
 */
export function partitionTeamsByConsent<T extends { guardianConsent?: GuardianConsent | null }>(
  teams: readonly T[],
  runConfig: { requiresGuardianConsent?: boolean },
): ConsentPartition<T> {
  const ready: T[] = [];
  const held: T[] = [];
  for (const team of teams ?? []) {
    (isConsentSatisfied(team, runConfig) ? ready : held).push(team);
  }
  return { ready, held };
}

// ─── Configuration validation (change: expose-enforced-settings) ──────────────
//
// `updateGame` persisted both of these unchecked. `undefined` means "not sent"
// and is never an error; anything present must be well formed.

export type SettingValidation = { ok: true } | { ok: false; error: string };

/** Oldest minimum age that describes a participant rather than a typo. */
export const MAX_MIN_AGE = 120;

/**
 * The consent flag is accepted as a BOOLEAN only. A truthy string must never be
 * able to arm a child-safety gate by coercion, in either direction.
 */
export function validateConsentFlag(input: unknown): SettingValidation {
  if (input === undefined) return { ok: true };
  if (typeof input !== 'boolean') {
    return { ok: false, error: 'requiresGuardianConsent must be true or false' };
  }
  return { ok: true };
}

/** A minimum age is a whole number of years in a plausible range. */
export function validateMinAge(input: unknown): SettingValidation {
  if (input === undefined) return { ok: true };
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return { ok: false, error: 'minAge must be a finite number' };
  }
  if (!Number.isInteger(input)) return { ok: false, error: 'minAge must be a whole number' };
  if (input < 0 || input > MAX_MIN_AGE) {
    return { ok: false, error: `minAge must be between 0 and ${MAX_MIN_AGE}` };
  }
  return { ok: true };
}
