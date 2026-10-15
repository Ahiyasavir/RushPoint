// reportClientEvent (change: self-healing-entry).
//
// On 14.10 the server was blind to what happened on the phones: no user agent, no client errors, so
// even the early warning at the 27.9 run (only 41% of identities ever reached a team) looked normal.
// The phone now reports each lost sign-in, after it has recovered, with the browser it ran on.
//
// The payload is untrusted input from an anonymous phone, so it is a CLOSED, size-capped shape: an
// unknown field, kind, outcome or phase is refused, never logged. It writes exactly one structured
// log line and NO Firestore document: zero quota, no rules, no index, and it lands in `docker logs`
// where an investigation already looks.
import * as functions from 'firebase-functions';
import { loggedCallable, logClientEvent } from './log';
import { requireAuth } from '../auth';
import { enforceRateLimit } from '../rateLimitStore';

export const MAX_USER_AGENT_LEN = 300;
const KINDS = new Set(['authLost']);
const OUTCOMES = new Set(['reinstated', 'freshSignIn', 'failed']);
const PHASES = new Set(['join', 'play']);
const FIELDS = new Set(['kind', 'outcome', 'phase', 'msSinceSignIn', 'userAgent']);

export interface ClientEvent {
  kind: 'authLost';
  outcome: 'reinstated' | 'freshSignIn' | 'failed';
  phase: 'join' | 'play';
  msSinceSignIn: number;
  userAgent: string;
}

/** Total: any input yields a clean event or null. Never throws. */
export function parseClientEvent(input: unknown): ClientEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => !FIELDS.has(k))) return null;
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null;
  if (typeof o.outcome !== 'string' || !OUTCOMES.has(o.outcome)) return null;
  if (typeof o.phase !== 'string' || !PHASES.has(o.phase)) return null;
  const ua = typeof o.userAgent === 'string' ? o.userAgent : '';
  if (ua.length > MAX_USER_AGENT_LEN) return null;
  const ms = typeof o.msSinceSignIn === 'number' && Number.isFinite(o.msSinceSignIn) && o.msSinceSignIn >= 0
    ? Math.round(o.msSinceSignIn) : -1;
  return {
    kind: o.kind as ClientEvent['kind'],
    outcome: o.outcome as ClientEvent['outcome'],
    phase: o.phase as ClientEvent['phase'],
    msSinceSignIn: ms,
    userAgent: ua,
  };
}

export const reportClientEvent = loggedCallable('reportClientEvent', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'reportClientEvent');
  const event = parseClientEvent(data);
  if (!event) throw new functions.https.HttpsError('invalid-argument', 'Malformed client event');
  logClientEvent({ uid, ...event });
  return { ok: true };
});
