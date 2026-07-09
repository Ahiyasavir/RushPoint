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

export const uid = () => auth.currentUser?.uid ?? null;
