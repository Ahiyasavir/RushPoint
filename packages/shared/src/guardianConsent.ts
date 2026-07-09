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
