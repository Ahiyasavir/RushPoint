// The emergency number the participant app points to (change: sos-points-to-101).
//
// Declared ONCE so the SOS confirm, the "sent" and the "failed" dialogs can never disagree.
// 101 is Magen David Adom, Israel's medical emergency service. The API is geo-blocked to Israel
// (deploy/CLOUDFLARE.md), so every player who can reach a run is in reach of this number; a
// locale switch to English does not change the country the player is standing in.
// scripts/test-emergency.ts pins the value, so changing it is a deliberate act.

export const EMERGENCY_MEDICAL_NUMBER = '101';

export function emergencyTelHref(): string {
  return `tel:${EMERGENCY_MEDICAL_NUMBER}`;
}
