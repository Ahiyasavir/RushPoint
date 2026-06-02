import { httpsCallable } from 'firebase/functions';
import { functions, ensureAuth } from './firebase';

// ─────────────────────────────────────────────────────────────────────────────
// Callable factory. Every admin callable needs an authenticated caller, so each
// page used to repeat `await ensureAuth()` before every `httpsCallable(...)`
// invocation. `callable(name)` folds that in: it returns a thin async function
// that ensures auth, invokes the emulator/cloud function, and unwraps `.data`
// (the only field call sites ever read). Behaviour is identical — just centralised.
//
//   const listTeams = callable<void, { teams: TeamRow[] }>('listTeams');
//   const { teams } = await listTeams();
// ─────────────────────────────────────────────────────────────────────────────
export function callable<Req = void, Res = unknown>(
  name: string,
): (data?: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data?: Req) => {
    await ensureAuth();
    const res = await fn(data as Req);
    return res.data;
  };
}
