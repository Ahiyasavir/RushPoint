// The cold-launch demo entry — pure, DOM-free, unit-tested by
// scripts/test-play-demo-route.ts (change: cold-launch-demo-entry).
//
// WHY THIS EXISTS
// play-web has no router: every public entry point is a query param on the
// participant origin (`?game=`, `?challenge=`, `?board=`, `?recap=`, `?tv=`,
// `?staff=`). That is correct for a link-shared field game — but an app installed
// from the Play Store launches with a BARE url, so `resolvePlayRoute` fell through
// to step 10 and a fresh installer met an access-code prompt with nothing behind
// it. Two costs: Play review rejects a cold install that shows only an impassable
// gate ("minimum functionality"), and an organic installer who is not attending an
// event today has nothing to try.
//
// WHAT THIS IS NOT
// Not a new route, not a new screen, and not a new callable. The platform already
// has a staffless, locationless, GPS-free, instant-play showcase game — the
// FLAGSHIP demo seeded by scripts/lib/spy-academy-game-def.mjs and already linked
// from creator-web's logged-out landing page — reachable through the EXISTING
// `?game=<id>` promo route, whose "Play now" button starts a fresh solo run via
// `startInstantPlay`. All that was missing was a way to reach it without a URL.
// So this module only decides WHEN to show a link and WHAT that link is; the
// resolver, the promo screen and the join flow are untouched.

import type { PlayRoute } from './playRoute';

/**
 * The FLAGSHIP instant-play demo game.
 *
 * Must stay in sync with `GAME_ID` in `scripts/lib/spy-academy-game-def.mjs` and
 * `DEMO_GAME_ID` in `apps/creator-web/src/components/AuthGate.tsx`; pinned by
 * scripts/test-play-demo-route.ts so a rename can't silently point the button at
 * a "game not found" card.
 *
 * The id is a *hint*, never an assumption: the caller (JoinScreen) probes the
 * world-readable `publicGames/{id}` doc first and simply renders nothing when the
 * game is absent or not instant-play-eligible. A backend with no demo seeded
 * therefore shows exactly today's join screen rather than a dead end — which
 * would be worse than the gate this change removes.
 */
export const DEMO_GAME_ID = 'demo-instant-spy';

/**
 * The search string that opens the demo through the existing public promo route.
 * Encoded, because it is interpolated straight into `history.replaceState`.
 */
export function demoPromoSearch(gameId: string = DEMO_GAME_ID): string {
  return `?game=${encodeURIComponent(gameId)}`;
}

/**
 * Is this the cold, empty launch that has nothing to offer?
 *
 * TRUE for exactly one situation: the resolver produced a join route with NO code
 * and the device holds no player session. Everything else — a link with a code, a
 * restored session, a promo/board/recap/challenge/tv/staff/legal link — is a
 * visitor who already has somewhere to be, and must see precisely what they see
 * today. In particular a genuine participant can never be diverted into the demo:
 * their URL always carries a code, or their device already holds the run.
 */
export function shouldOfferDemo(route: PlayRoute, hasSession: boolean): boolean {
  if (hasSession) return false;
  return route.kind === 'join' && route.code === null;
}
