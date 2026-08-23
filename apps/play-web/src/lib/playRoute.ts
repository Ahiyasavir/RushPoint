// The play-web deep-link resolver — pure, DOM-free, unit-tested by
// scripts/test-play-route.ts (wave-e / task 12).
//
// play-web has no router: App.tsx used to read seven independent query params
// into seven pieces of `useState` and return early from a chain of `if`s. That
// produced two field bugs:
//
//  1. STAFF LINKS OPENED THE PLAYER VIEW. The staff link was
//     `?staff&owner=<uid>&game=<gameId>&run=<runId>` — a *valueless* `staff`
//     flag plus a `game` key that the public promo route reads as "show me this
//     game's teaser". Any intermediary that normalises a query string can drop a
//     bare flag while keeping the rest, and the surviving `game=` landed the
//     marshal on GamePromoScreen — which offers instant play, i.e. it silently
//     converts a staff member into a *participant*. The same fallthrough fired
//     whenever the `staffMode` boolean flipped false (back-to-join, sign-out)
//     while the URL still said staff.
//
//  2. A STALE SESSION BEAT THE URL. Scanning a new game's QR reopened the
//     previously joined run, because a restored localStorage session was checked
//     before the `?code=` link param.
//
// Both are the same defect: state that is not derived from the URL. So the URL
// is authoritative here, the route is ONE discriminated union, and the params a
// route consumes can never be re-read by a later branch.

import { parseChallengeParam } from '@rushpoint/shared';

/**
 * Query-param key that marks a join link as the creator's own REHEARSAL
 * (change: test-drive-straight-to-play): `?code=<CODE>&testdrive=1`.
 *
 * It is a pure UX modifier on the join route and carries NO authority — the run
 * is a test drive because the server said so (`getJoinInfo().isTestDrive`, from
 * `run.isTestDrive`), never because a URL claimed it. All this flag does is skip
 * the registration form the creator would otherwise fill in to look at their own
 * game. Forging it onto a real run's code therefore buys nothing: the join is the
 * same join, and every test-drive affordance downstream keys off the server flag.
 */
export const TEST_DRIVE_ROUTE_PARAM = 'testdrive';

/** Query-param key for the staff console: `?staff=<ownerUid>.<gameId>.<runId>`. */
export const STAFF_ROUTE_PARAM = 'staff';
/** Legacy staff link params, kept parseable for QRs already printed/shared. */
export const LEGACY_STAFF_PARAMS = ['owner', 'game', 'run'] as const;

export interface StaffCtx {
  ownerUid: string;
  gameId: string;
  runId: string;
}

/**
 * The parts of a persisted player session the resolver needs. Structural, so the
 * full `Session` from store.ts satisfies it without the pure lane importing the
 * store (and therefore localStorage).
 */
export interface SessionRef {
  code?: string | null;
  /** True when this device already saw the run finish. Never blocks a resume. */
  runFinished?: boolean;
}

/** The two public legal documents, keyed exactly as `LEGAL_DOCS` keys them. */
export type LegalDoc = 'terms' | 'privacy';

export type PlayRoute =
  | { kind: 'legal'; doc: LegalDoc }
  | { kind: 'staff'; ctx: StaffCtx | null }
  | { kind: 'tv'; code: string }
  | { kind: 'recap'; code: string }
  | { kind: 'ceremony'; code: string }
  | { kind: 'board'; code: string }
  | { kind: 'challenge'; gameId: string; taskId: string }
  | { kind: 'play' }
  | { kind: 'promo'; gameId: string }
  /**
   * `autoJoin` is set only by a `?testdrive` link (see TEST_DRIVE_ROUTE_PARAM) and
   * only alongside a code — "join this without making me fill the form". Absent
   * everywhere else, so a real participant's link resolves exactly as before.
   */
  | { kind: 'join'; code: string | null; autoJoin?: boolean };

export interface PlayRouteInput {
  /** `window.location.search`, with or without the leading `?`. */
  search: string;
  session: SessionRef | null;
  hasStaffSession?: boolean;
  /**
   * `window.location.pathname`. The ONLY thing read from the path is the two
   * public legal documents (change: legal-pages-participant-origin); every other
   * path resolves exactly as it does when this is omitted. Optional so existing
   * callers and tests are unaffected.
   */
  pathname?: string | null;
}

export interface PlayRouteResult {
  route: PlayRoute;
  /**
   * The stored player session is stale (the URL points at a DIFFERENT run) and
   * must be cleared before rendering. Never true for a same-run link — dropping
   * an in-progress run at a live event is worse than the bug being fixed.
   */
  clearSession: boolean;
}

/** Build the staff deep-link param value — inverse of `parseStaffParam`. */
export function buildStaffParam(ownerUid: string, gameId: string, runId: string): string {
  return `${ownerUid}.${gameId}.${runId}`;
}

/**
 * Parse `<ownerUid>.<gameId>.<runId>`. Returns null for anything malformed so the
 * staff route falls back to manual entry — it must NEVER fall through to a player
 * route. Ids are nanoid/uid style and contain no dots, mirroring the `:`
 * convention in `parseChallengeParam`.
 */
export function parseStaffParam(raw: string | null | undefined): StaffCtx | null {
  if (!raw) return null;
  const parts = raw.trim().split('.');
  if (parts.length !== 3) return null;
  const [ownerUid, gameId, runId] = parts.map((p) => p.trim());
  if (!ownerUid || !gameId || !runId) return null;
  return { ownerUid, gameId, runId };
}

/**
 * The path → legal-document decision, and the whole of play-web's path handling.
 *
 * play-web has no router: it is served from the origin root in dev, behind the
 * playtest tunnel and in production (only creator-web carries a `/creator/`
 * base), so an exact match on the two documented paths is correct everywhere.
 *
 * Tolerant of the shapes a real link takes — a trailing slash, any letter case,
 * and a query string or fragment still attached — because these URLs are typed
 * by hand, printed in store listings and pasted into legal references. Anything
 * else returns null and the participant experience resolves untouched.
 */
export function resolveLegalPath(pathname: string | null | undefined): LegalDoc | null {
  if (!pathname) return null;
  // Strip anything after the path, then a single trailing slash, then normalize.
  const path = String(pathname).split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
  if (path === '/terms') return 'terms';
  if (path === '/privacy') return 'privacy';
  return null;
}

function params(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

/** A present-and-non-empty param value, else null. */
function value(p: URLSearchParams, key: string): string | null {
  const v = p.get(key);
  return v && v.trim() ? v.trim() : null;
}

function normCode(raw: string | null | undefined): string | null {
  const c = (raw ?? '').trim().toUpperCase();
  return c ? c : null;
}

/**
 * Remove every staff param from a search string. Called on staff exit/sign-out so
 * the URL can never re-resolve to the promo (bug 1). `game` is deliberately
 * included: on a legacy staff link it is the run's gameId, not a promo id.
 */
export function stripStaffParams(search: string): string {
  const p = params(search);
  if (!p.has(STAFF_ROUTE_PARAM)) return search;
  p.delete(STAFF_ROUTE_PARAM);
  for (const k of LEGACY_STAFF_PARAMS) p.delete(k);
  const rest = p.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Resolve the single route this URL + persisted state means.
 *
 * Precedence (first match wins):
 *   0. legal       — the path `/terms` or `/privacy`, ahead of everything else
 *   1. staff       — `?staff[=o.g.r]`, legacy `?staff&owner&game&run`, or a stored staff session
 *   2. tv          — `?tv=<accessCode>`
 *   3. recap       — `?recap=<accessCode>`
 *   4. ceremony    — `?board=<accessCode>&ceremony`
 *   5. board       — `?board=<accessCode>`
 *   6. challenge   — `?challenge=<gameId>:<taskId>`, only without a session
 *   7. join/play   — `?code=<ACCESSCODE>`: same run resumes, different run rejoins
 *   8. play        — a stored session and no code in the URL
 *   9. promo       — `?game=<gameId>`, only without a session
 *  10. join        — everything else
 */
export function resolvePlayRoute(input: PlayRouteInput): PlayRouteResult {
  // 0. Legal documents — the path wins over every query param and every stored
  //    session. A participant is the person who accepts these documents, and they
  //    must be readable mid-run: `clearSession` is false, so opening the policy
  //    can never cost a team their progress.
  const legalDoc = resolveLegalPath(input.pathname);
  if (legalDoc) return { route: { kind: 'legal', doc: legalDoc }, clearSession: false };

  const p = params(input.search);
  const session = input.session;

  // An explicit `?code=` in the URL is a player-join intent, and the URL is
  // authoritative here. It must beat a *stored* staff session: a tester (or a
  // marshal) who signed into the staff console once keeps that session in
  // localStorage until an explicit logout, and without this a later scan of any
  // player/test QR was hijacked straight to the staff console — the code never
  // reached JoinScreen. A `?staff=` PARAM (real staff intent in the link) still
  // wins; only a mere stored session yields to the code.
  const linkCode = normCode(p.get('code'));
  // Only ever consulted together with `linkCode` below — a bare `?testdrive` with
  // no code is meaningless and must not change any route.
  const autoJoin = p.has(TEST_DRIVE_ROUTE_PARAM);

  // 1. Staff — highest precedence, and it CONSUMES owner/game/run so no later
  //    branch can re-read `game` as a promo id. A staff link never touches the
  //    player session: a marshal borrowing a player's phone must not wipe it.
  if (p.has(STAFF_ROUTE_PARAM) || (input.hasStaffSession && !linkCode)) {
    const ctx =
      parseStaffParam(value(p, STAFF_ROUTE_PARAM)) ??
      (() => {
        const ownerUid = value(p, 'owner');
        const gameId = value(p, 'game');
        const runId = value(p, 'run');
        return ownerUid && gameId && runId ? { ownerUid, gameId, runId } : null;
      })();
    return { route: { kind: 'staff', ctx }, clearSession: false };
  }

  // 2-5. Read-only projection surfaces (public marketing routes).
  const tv = value(p, 'tv');
  if (tv) return { route: { kind: 'tv', code: tv }, clearSession: false };

  const recap = value(p, 'recap');
  if (recap) return { route: { kind: 'recap', code: recap }, clearSession: false };

  const board = value(p, 'board');
  if (board) {
    return {
      route: p.has('ceremony') ? { kind: 'ceremony', code: board } : { kind: 'board', code: board },
      clearSession: false,
    };
  }

  // 6. Challenge teaser — only for a visitor who is not already playing.
  const challenge = parseChallengeParam(p.get('challenge'));
  if (challenge && !session) {
    return { route: { kind: 'challenge', ...challenge }, clearSession: false };
  }

  // 7. A join code in the URL is an explicit intent and BEATS a restored session
  //    (and, per the guard above, a stored staff session too).
  if (linkCode) {
    const sessionCode = normCode(session?.code);
    if (!session) return { route: { kind: 'join', code: linkCode, autoJoin }, clearSession: false };
    // Same run → a no-op resume. This is the load-bearing case: re-scanning the
    // team's own QR mid-event must not drop their progress. A finished run with
    // the same code also resumes, so the player keeps their results screen.
    if (sessionCode && sessionCode === linkCode) {
      return { route: { kind: 'play' }, clearSession: false };
    }
    // Different run (or a session with no code at all) → the URL wins.
    return { route: { kind: 'join', code: linkCode, autoJoin }, clearSession: true };
  }

  // 8. No code in the URL → a stored session simply resumes.
  if (session) return { route: { kind: 'play' }, clearSession: false };

  // 9. Public game teaser.
  const gameId = value(p, 'game');
  if (gameId) return { route: { kind: 'promo', gameId }, clearSession: false };

  // 10. Plain join screen.
  return { route: { kind: 'join', code: null }, clearSession: false };
}

/**
 * The bottom render decision AFTER the informational overlays (board / recap /
 * challenge / promo / ceremony) have been shown-and-dismissed in-app.
 *
 * wave-g robustness #1: those overlay routes keep their own `route.kind` even once
 * the visitor taps "join" and the overlay is dismissed — the resolver never
 * downgrades `?board=` to `play` for an already-joined device (board outranks a
 * session resume so a player CAN peek at the leaderboard first). If we only
 * resumed on `route.kind === 'play'`, a joined player who opened a shared board
 * link and dismissed it would be stranded on a blank JoinScreen. So: a device that
 * still holds a session RESUMES play regardless of the residual overlay route; a
 * visitor with NO session falls through to the join screen exactly as before.
 */
export function resumeOrJoin(route: PlayRoute, hasSession: boolean): 'play' | 'join' {
  if (route.kind === 'play') return 'play';
  return hasSession ? 'play' : 'join';
}
