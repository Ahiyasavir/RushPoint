/**
 * Contact messages from the marketing site (change: marketing-site).
 *
 * `submitContactMessage` is the ONLY write endpoint on the platform a complete
 * stranger can reach. It has to be: the sender is by definition someone who does
 * not have an account yet, so requiring one would mean nobody can ask a question
 * before signing up. Everything that would normally be carried by authentication
 * is therefore carried by validation, a size bound and a rate limit, and each of
 * those is asserted by the e2e suite rather than assumed.
 *
 * Reading them back is a separate, admin-only callable. The stored collection is
 * server-write-only and no client can read it, so a message is never exposed by
 * the same door it came in through.
 */
import * as functions from 'firebase-functions/v1';

import { db } from '../firebase';
import { assertAdmin } from '../auth';
import { loggedCallable } from '../obs/log';
import { writeAuditLog } from '../obs/audit';
import { enforceRateLimit } from '../rateLimitStore';
import { sendContactNotification } from './notify';

/** Field bounds. Generous for a person, useless for a script. */
export const CONTACT_LIMITS = {
  name: 120,
  email: 200,
  message: 4_000,
} as const;

/**
 * How many messages a single origin may STORE before it is refused. Charged only
 * once a payload has passed validation, so a mistyped address never eats into it.
 */
export const CONTACT_RATE_BUCKET = 'submitContactMessage';

/**
 * How many times a single origin may CALL, refusals included. Deliberately much
 * wider than the bucket above: see the reasoning beside the two budgets in
 * packages/shared/src/rateLimit.ts.
 */
export const CONTACT_ATTEMPT_BUCKET = 'submitContactMessageAttempt';

/**
 * Deliberately permissive: the job is to reject something that cannot be an
 * address, not to adjudicate the grammar of every valid one. Over strict address
 * validation rejects real people, and the address is only ever used to reply.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A required string field.
 *
 * `null` and `undefined` are treated identically, because the callable transport
 * encodes BOTH as null on the wire: a guard that distinguishes them rejects a
 * caller for omitting a field, with no way to comply.
 */
function requiredText(value: unknown, field: string, max: number): string {
  if (value === null || value === undefined) {
    throw new functions.https.HttpsError('invalid-argument', `${field} is required`);
  }
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', `${field} must be text`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', `${field} is required`);
  }
  if (trimmed.length > max) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${field} must be at most ${max} characters`,
    );
  }
  return trimmed;
}

/** An optional field. Absent and explicitly null mean the same thing. */
function optionalLanguage(value: unknown): 'he' | 'en' | null {
  if (value === null || value === undefined || value === '') return null;
  if (value !== 'he' && value !== 'en') {
    throw new functions.https.HttpsError('invalid-argument', 'language must be he or en');
  }
  return value;
}

/**
 * The rate limit key.
 *
 * There is no uid, so it comes from the connection. Deriving it SERVER side is
 * the whole point: a key the caller supplies is a key the caller can vary, which
 * turns the limit off for exactly the sender who is abusing it. An unresolvable
 * address falls back to one shared bucket, which throttles harder rather than
 * softer, which is the correct direction to fail for an anonymous endpoint.
 */
export function rateKeyFor(context: functions.https.CallableContext): string {
  const raw = context.rawRequest as { ip?: string; headers?: Record<string, unknown> } | undefined;
  const forwarded = raw?.headers?.['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
  const ip = first || raw?.ip;
  return `contact:${ip && ip.length > 0 ? ip : 'unknown'}`;
}

export const submitContactMessage = loggedCallable(
  'submitContactMessage',
  async (data, context) => {
    const key = rateKeyFor(context);

    // The wide bound first, charged for this call whatever becomes of it, so a
    // flood of garbage still ends. It costs one map lookup.
    await enforceRateLimit(key, CONTACT_ATTEMPT_BUCKET);

    const payload = (data ?? {}) as Record<string, unknown>;

    const name = requiredText(payload.name, 'name', CONTACT_LIMITS.name);
    const email = requiredText(payload.email, 'email', CONTACT_LIMITS.email);
    const message = requiredText(payload.message, 'message', CONTACT_LIMITS.message);
    const language = optionalLanguage(payload.language);

    if (!EMAIL_SHAPE.test(email)) {
      throw new functions.https.HttpsError('invalid-argument', 'email must be an address');
    }

    // The tight bound only now, once this is a message rather than an attempt.
    // Ordering is the whole point: charged before validation, a person who
    // mistypes their own address a few times is locked out of the only way they
    // have to reach us, for a mistake they were never told was costing them
    // anything.
    await enforceRateLimit(key, CONTACT_RATE_BUCKET);

    await db.collection('contactMessages').add({
      name,
      email,
      message,
      language,
      // Server assigned. Ordering and the retention sweep must not depend on a
      // value the sender supplied, and a sender can supply anything.
      receivedAt: Date.now(),
      // Signed in senders exist too (someone already using the product), and
      // knowing that saves a reply asking who they are.
      uid: context.auth?.uid ?? null,
    });

    // Best effort, and never allowed to fail the call: the message is already
    // stored, so telling the sender it failed would invite a duplicate.
    await sendContactNotification({ name, email, message, language });

    // Nothing but the outcome. A document id is an internal fact, and handing one
    // to an anonymous caller invites probing.
    return { ok: true };
  },
);

export const listContactMessages = loggedCallable('listContactMessages', async (data, context) => {
  const uid = assertAdmin(context);

  const { limit } = (data ?? {}) as { limit?: number };
  const capped = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(1, Math.min(200, Math.floor(limit)))
    : 100;

  const snap = await db
    .collection('contactMessages')
    .orderBy('receivedAt', 'desc')
    .limit(capped)
    .get();

  await writeAuditLog({
    operatorId: uid,
    actionType: 'listContactMessages',
    newValue: snap.size,
  });

  return {
    messages: snap.docs.map((d) => {
      const m = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: String(m.name ?? ''),
        email: String(m.email ?? ''),
        message: String(m.message ?? ''),
        language: (m.language as string | null) ?? null,
        receivedAt: Number(m.receivedAt ?? 0),
        uid: (m.uid as string | null) ?? null,
      };
    }),
  };
});
