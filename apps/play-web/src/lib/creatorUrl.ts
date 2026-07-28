// Origin of the CREATOR app, resolved from play-web.
//
// play-web and creator-web are two separate Firebase Hosting targets, so any
// link from a participant screen to a creator-hosted page (the /terms and
// /privacy React Router routes, the ?ref= referral landing) has to cross
// origins. This is the single source of truth for that origin — never hardcode
// the host at a call site.
//
// Deliberately a FUNCTION, not a module-level const: `scripts/test-i18n-parity.ts`
// carries a P9 regression guard forbidding module-level `window.location` access
// in JoinScreen, because reading the URL at module-parse time is exactly how a
// stale session once beat the join link's ?code= param. Resolving lazily at call
// time keeps that class of bug impossible and keeps the guard honest.
import { CANONICAL_CREATOR_URL } from '@rushpoint/shared';

export function creatorUrl(): string {
  return import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:5180`
    : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? CANONICAL_CREATOR_URL);
}
