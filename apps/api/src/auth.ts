// ─── Bearer-token auth, with the verifier injected ───────────────────────────
//
// docs/migration/DEPLOYMENT.md §4.3: Firebase Auth STAYS. The box keeps
// `firebase-admin` and calls `getAuth().verifyIdToken(token)` — offline RS256
// verification against Google's cached public keys, so no per-request round
// trip. `requireAuth` / `assertStaffOrOwner` in `functions/src` then port
// UNCHANGED, because `context.auth` arrives in exactly the same shape.
//
// The verifier is an INJECTED dependency and firebase-admin is NOT imported at
// module scope. That is deliberate: it makes the whole protocol layer runnable
// offline in `scripts/test-api-contract.ts` with a fake verifier, and it keeps
// the service-account credential out of every import graph but the entry point's.
//
// Verified against firebase-functions `common/providers/https.js:314-343`
// (`checkAuthToken`):
//   * no Authorization header               → MISSING (NOT an error)
//   * header that is not `Bearer <x>`       → INVALID
//   * verifyIdToken throws                  → INVALID
//   * verified                              → VALID, ctx.auth = {uid, token}
// MISSING is not rejected by the protocol layer; the handler's own
// `requireAuth`/`if (!context.auth)` rejects it with `unauthenticated`. Both
// paths therefore land on HTTP 401 / "UNAUTHENTICATED", which is what the
// client's existing error handling already expects.

// `callable.ts` refers to this module only in a TYPE position (`import('./auth.js')`),
// which erases at compile time — so this static import is not a runtime cycle.
import { HttpsError } from './callable.js';

/** The decoded ID token. Loose on purpose — staff custom claims live here too. */
export interface DecodedIdToken extends Record<string, unknown> {
  uid: string;
}

/** The verifier signature. `admin.auth().verifyIdToken` satisfies it structurally. */
export type IdTokenVerifier = (idToken: string) => Promise<DecodedIdToken>;

export type AuthResolution =
  | { status: 'MISSING' }
  | { status: 'INVALID'; reason: string }
  | { status: 'VALID'; auth: { uid: string; token: Record<string, unknown> } };

const BEARER = /^Bearer (.+)$/i;

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  // Node lower-cases incoming header names, but be defensive: a hand-built
  // request object in a test (or a proxy) may not have.
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const v = Array.isArray(direct) ? direct[0] : direct;
  if (typeof v === 'string') return v;
  for (const [k, raw] of Object.entries(headers)) {
    if (k.toLowerCase() !== name.toLowerCase()) continue;
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (typeof val === 'string') return val;
  }
  return undefined;
}

/** Pull the raw JWT out of an `Authorization: Bearer <token>` header. */
export function extractBearerToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const authorization = headerValue(headers, 'authorization');
  if (!authorization) return null;
  const match = authorization.match(BEARER);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Build the `resolveAuth` function `handleCallableRequest` takes.
 *
 * NEVER throws: a verifier that rejects, times out or blows up yields INVALID
 * (→ 401), never a 500. An auth layer that can 500 turns a key-rotation blip
 * into an outage the client's retry cannot describe.
 */
export function createAuthResolver(verifyIdToken: IdTokenVerifier) {
  return async function resolveAuth(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthResolution> {
    const authorization = headerValue(headers, 'authorization');
    if (!authorization) return { status: 'MISSING' };

    const token = extractBearerToken(headers);
    if (!token) return { status: 'INVALID', reason: 'malformed Authorization header' };

    try {
      const decoded = await verifyIdToken(token);
      const uid = decoded?.uid ?? (decoded?.sub as string | undefined);
      if (!uid || typeof uid !== 'string') {
        return { status: 'INVALID', reason: 'verified token carries no uid' };
      }
      return { status: 'VALID', auth: { uid, token: { ...decoded, uid } } };
    } catch (err) {
      return { status: 'INVALID', reason: String((err as Error)?.message ?? err) };
    }
  };
}

/**
 * The real verifier. Imported LAZILY so nothing else in this package pulls in
 * firebase-admin (or needs a service account) merely to be loaded.
 *
 * `projectId` comes from the env; credentials come from
 * GOOGLE_APPLICATION_CREDENTIALS pointing at the read-only mounted
 * service-account JSON (DEPLOYMENT.md §4.3 — never baked into the image, never
 * in git).
 */
export async function createFirebaseAdminVerifier(opts: {
  projectId?: string;
}): Promise<IdTokenVerifier> {
  const adminApp = await import('firebase-admin/app');
  const adminAuth = await import('firebase-admin/auth');
  const app = adminApp.getApps().length
    ? adminApp.getApp()
    : adminApp.initializeApp({
        credential: adminApp.applicationDefault(),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      });
  const auth = adminAuth.getAuth(app);
  return (idToken: string) => auth.verifyIdToken(idToken) as unknown as Promise<DecodedIdToken>;
}

/**
 * The `requireAuth` every ported handler already calls. Kept here so the ported
 * bodies read identically to `functions/src`.
 */
export function requireAuth(context: { auth?: { uid: string } }): string {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}
