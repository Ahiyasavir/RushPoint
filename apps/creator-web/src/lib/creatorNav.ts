// Primary-navigation rule + a game's own live run
// (change: creator-onboarding-and-plain-language).
//
// The nav array used to live inline in App.tsx and be rendered twice (desktop
// links + mobile drawer). It already had a conditional member (the wallet, gated
// on PAYMENTS_ENABLED), so it was a rule pretending to be a constant. Here it is
// one function both renderers call, which makes "is /live in the menu?" a unit
// test instead of a visual review.
//
// Pure: no React, no Firebase.
import type { LiveRunSummary } from '@rushpoint/shared';

export type NavDestinationId = 'myGames' | 'gallery' | 'wallet' | 'settings' | 'admin' | 'adminTemplates';

export interface NavDestination {
  id: NavDestinationId;
  to: string;
  end?: boolean;
}

/**
 * The creator console's primary destinations.
 *
 * `/live` is deliberately NOT in the union: it is not a primary destination, it
 * is empty for most of a creator's life, and it duplicated chrome that the
 * floating run bar and the run console already provide. Its ROUTE stays
 * registered in App.tsx — the bar's "+N more" navigates there and bookmarks must
 * keep resolving.
 */
export function buildNavDestinations(
  { paymentsEnabled, isAdmin = false }: { paymentsEnabled: boolean; isAdmin?: boolean },
): NavDestination[] {
  return [
    { id: 'myGames', to: '/', end: true },
    { id: 'gallery', to: '/gallery' },
    // Free mode hides the wallet surface entirely, matching the hidden route.
    ...(paymentsEnabled ? [{ id: 'wallet' as const, to: '/wallet' }] : []),
    { id: 'settings', to: '/settings' },
    // Platform admin dashboard (change: admin-user-activity-dashboard). LAST, so it never
    // displaces an everyday destination, and only for an admin.
    //
    // `isAdmin` DEFAULTS TO FALSE on purpose: a caller that forgets to pass it must not
    // leak an admin entry into every creator's menu. Fail closed.
    //
    // This is cosmetic only. Hiding the link is not what protects the page — the route
    // stays registered for anyone who types the URL, the page re-checks the claim, and
    // `listPlatformUsers` re-checks it server side. The menu just stops showing a door
    // that would not open.
    ...(isAdmin ? [
      { id: 'admin' as const, to: '/admin/users' },
      // Admin-managed game templates (change: admin-manage-game-templates). Same
      // cosmetic-only reasoning as the admin entry above — hiding it is not the
      // security boundary, AdminTemplatesPage and setGameTemplateFlag both
      // re-check the claim themselves.
      { id: 'adminTemplates' as const, to: '/admin/templates' },
    ] : []),
  ];
}

/**
 * The live run belonging to this game, if any — the game card's own entry point
 * into a run in progress, now that `/live` has left the menu.
 */
export function liveRunForGame(
  gameId: string,
  runs: LiveRunSummary[] | null | undefined,
): LiveRunSummary | null {
  if (!gameId || !runs || runs.length === 0) return null;
  return runs.find((r) => r.gameId === gameId) ?? null;
}
