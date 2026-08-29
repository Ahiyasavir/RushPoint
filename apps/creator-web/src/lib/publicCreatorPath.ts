// Which creator-web routes are readable WITHOUT signing in (change: game-share-link).
//
// creator-web is a console: AuthProvider renders the login screen instead of its
// children for a logged-out visitor, so a route is public only if AuthGate itself
// knows about it. That list used to be a bare `['/privacy','/terms']` compared
// against `window.location.pathname` — which is wrong under the playtest tunnel,
// where the app is served under the `/creator/` base and every pathname carries
// that prefix.
//
// A share link is handed to somebody who very often has no account, so getting
// this wrong means the link bounces them to a login screen for a product they
// have never heard of. Hence a pure, testable resolver rather than one more
// inline comparison.
import { isValidShareToken } from '@rushpoint/shared';

export type PublicCreatorRoute =
  | { kind: 'legal'; type: 'privacy' | 'terms' }
  | { kind: 'shared'; token: string };

/** Strip the router basename (`/` in dev, `/creator/` behind the playtest proxy). */
export function stripBase(pathname: string, base = '/'): string {
  const path = typeof pathname === 'string' ? pathname : '';
  const prefix = (base || '/').replace(/\/+$/, '');
  const rest = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const withSlash = rest.startsWith('/') ? rest : `/${rest}`;
  // Collapse a trailing slash so `/terms/` and `/terms` resolve identically —
  // but never turn the root itself into an empty string.
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

/**
 * The public route this pathname names, or null for "sign in first".
 * Total: never throws, whatever the caller passes.
 */
export function resolvePublicCreatorRoute(pathname: string, base = '/'): PublicCreatorRoute | null {
  const path = stripBase(pathname, base);
  if (path === '/privacy') return { kind: 'legal', type: 'privacy' };
  if (path === '/terms') return { kind: 'legal', type: 'terms' };
  const shared = /^\/p\/([^/]+)$/.exec(path);
  if (shared) {
    const token = decodeURIComponent(shared[1]);
    // A malformed token is NOT a public route: it must fall through to the normal
    // app rather than render a share page that can only ever fail. The server
    // refuses it too — this just avoids a pointless round trip.
    return isValidShareToken(token) ? { kind: 'shared', token } : null;
  }
  return null;
}

/**
 * Where a visitor who pressed "make a copy" while signed OUT should be returned
 * to once they have an account. Lives here rather than on the page component so
 * App can read it without pulling that lazy route into the entry chunk.
 */
export const SHARE_RETURN_KEY = 'rp-share-return';

/** The path a share token is served at, for building the link the creator copies. */
export function sharedGamePath(token: string): string {
  return `/p/${encodeURIComponent(token)}`;
}
