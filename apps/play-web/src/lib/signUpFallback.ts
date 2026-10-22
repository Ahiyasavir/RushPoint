/**
 * change: signup-quota-fallback. Firebase creates at most 100 accounts an hour from one IP address, and
 * at an event on the venue WiFi every phone shares one. Past that, anonymous sign-in is refused with
 * `auth/too-many-requests` and the phone could not join. The API can create the account itself for a
 * live join code (`startPlayerSession`), so on exactly that refusal, and only when the phone knows which
 * game it is joining, it signs in with the session the API made. Anonymous sign-in stays the first path.
 * Pure and total: scripts/test-signup-fallback.ts.
 */
import { normalizeJoinCodeInput } from './joinCode';

export function shouldUseServerSession(e: unknown, code: string | null): boolean {
  if (!code) return false;
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return c === 'auth/too-many-requests';
}

/** The game code a page was opened with (`?code=`), normalized, or null. */
export function joinCodeFromSearch(search: string): string | null {
  try {
    const raw = new URLSearchParams(search).get('code');
    const code = raw ? normalizeJoinCodeInput(raw) : '';
    return code ? code : null;
  } catch {
    return null;
  }
}
