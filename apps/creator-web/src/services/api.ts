import { httpsCallable } from 'firebase/functions';
import { functions, auth } from './firebase';

// ─────────────────────────────────────────────────────────────────────────────
// Callable factory. Creators sign in with real Firebase Auth (email/Google),
// so unlike v1 there is no anonymous auto-login — the caller must already be
// authenticated (enforced by AuthGate). callable(name) invokes the function and
// unwraps `.data`.
//
//   const listGames = callable<void, { games: Game[] }>('listGames');
//   const { games } = await listGames();
// ─────────────────────────────────────────────────────────────────────────────
export function callable<Req = void, Res = unknown>(
  name: string,
): (data?: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data?: Req) => {
    if (!auth.currentUser) throw new Error('Not signed in');
    const res = await fn(data as Req);
    return res.data;
  };
}

/**
 * A callable a SIGNED-OUT visitor is expected to make (change: game-share-link).
 *
 * The `Not signed in` guard above is right for every other call this app makes —
 * a console call with no session is a bug, and failing early names it. But a
 * share link is opened by somebody who may have no account at all, and running
 * `getSharedGame` through the guarded factory would reject the read in the
 * BROWSER, before any request left it: the page would render "this link is not
 * active" for a link that is perfectly alive, with nothing in any server log to
 * find. Public callables therefore get their own door, and there are exactly two
 * of them (see PUBLIC_CALLABLES in scripts/lib/callableHardening.mjs).
 */
export function publicCallable<Req = void, Res = unknown>(
  name: string,
): (data?: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data?: Req) => (await fn(data as Req)).data;
}

export const uid = () => auth.currentUser?.uid ?? null;
