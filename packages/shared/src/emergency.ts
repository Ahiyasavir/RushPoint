// The emergency number the participant app points to (change: sos-points-to-101).
//
// Declared ONCE so the SOS confirm, the "sent" and the "failed" dialogs can never disagree.
// 101 is Magen David Adom, Israel's medical emergency service. The API is geo-blocked to Israel
// (deploy/CLOUDFLARE.md), so every player who can reach a run is in reach of this number; a
// locale switch to English does not change the country the player is standing in.
// scripts/test-emergency.ts pins the value, so changing it is a deliberate act.

import { normalizePhone } from './phoneLink';

export const EMERGENCY_MEDICAL_NUMBER = '101';

export function emergencyTelHref(): string {
  return `tel:${EMERGENCY_MEDICAL_NUMBER}`;
}

// ─── Every service, and the number to call back (change: sos-callback-and-authorities) ─────
// Ahiya, 2026-10-05: SOS should offer "contact the authorities" with all the options, not only
// 101, and ask for a team member's phone so the organizers can call back.

export type EmergencyServiceId = 'medical' | 'police' | 'fire';

/** Israel's emergency numbers. Medical first: an injury is the most common field emergency. */
export const EMERGENCY_SERVICES: readonly { id: EmergencyServiceId; number: string }[] = [
  { id: 'medical', number: EMERGENCY_MEDICAL_NUMBER },
  { id: 'police', number: '100' },
  { id: 'fire', number: '102' },
];

/** Longest callback number accepted, as typed (decorations included). */
const MAX_CALLBACK_LEN = 40;

/**
 * The SOS callback field. Empty is fine: an alert without a number beats no alert, so it never
 * blocks sending. A value must be a dialable number (normalizePhone), kept as the person typed
 * it, trimmed; the call link is built from it with toTelHref where it is shown.
 */
export function sosCallbackVerdict(raw: unknown): { ok: true; phone?: string } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== 'string') return { ok: false };
  const phone = raw.trim();
  if (!phone) return { ok: true };
  if (phone.length > MAX_CALLBACK_LEN || !normalizePhone(phone)) return { ok: false };
  return { ok: true, phone };
}
