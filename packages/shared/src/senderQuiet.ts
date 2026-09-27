// Has the team's SENDING phone gone quiet? (change: team-phones-simple, D5)
//
// Only one phone answers for a team. When it dies, runs out of battery or sits in a bag, the other
// phones used to show "X is sending for the team" forever. The API remembers in memory when each
// phone last asked for the team state (functions/src/devicePresenceStore.ts, zero Firestore cost)
// and ships ages to every phone; this verdict decides whether to offer "take over".
//
// Fails OPEN toward "not quiet": an UNKNOWN sender (the server restarted and has not seen it yet),
// a team where nobody else is active either (everyone may simply be walking), or any malformed
// value never produces the notice. Telling a team its phone died when it did not is worse than a
// few minutes' delay.

export const SENDER_QUIET_AFTER_SEC = 180;
export const OTHER_ACTIVE_WITHIN_SEC = 90;

export interface DevicePresence {
  uid: string;
  /** Seconds since this phone last asked the server for the team state. */
  lastSeenSec: number;
}

export function senderQuiet(input: {
  presence: readonly DevicePresence[] | null | undefined;
  controllerUid: string | null | undefined;
}): boolean {
  const { presence, controllerUid } = input;
  if (!controllerUid || !Array.isArray(presence)) return false;
  const valid = presence.filter((p): p is DevicePresence => !!p && typeof p.uid === 'string'
    && typeof p.lastSeenSec === 'number' && Number.isFinite(p.lastSeenSec) && p.lastSeenSec >= 0);
  const sender = valid.find((p) => p.uid === controllerUid);
  if (!sender || sender.lastSeenSec <= SENDER_QUIET_AFTER_SEC) return false;
  return valid.some((p) => p.uid !== controllerUid && p.lastSeenSec <= OTHER_ACTIVE_WITHIN_SEC);
}
