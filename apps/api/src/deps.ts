// ─── What a ported callable is allowed to reach for ──────────────────────────
//
// Everything a handler touches arrives through this object. Two consequences,
// both deliberate:
//
//   1. NO DIRECT DATABASE ACCESS. `repo` is the `@rushpoint/data` repository
//      interface — the same one `packages/data/src/postgres/` implements and
//      `packages/data/test/inMemory.ts` references. A handler that reached for
//      `pg` directly would re-create exactly the coupling the interface exists
//      to remove.
//   2. THE SERVER IS TESTABLE WITH NO BACKEND AT ALL. `createServer({deps})`
//      takes this whole object, so `scripts/test-api-contract.ts` hands it a
//      stub and never opens a socket to anything.
//
// `ApiRepository` is a structural SUBSET of `Repository` (a `Pick`), so the real
// Postgres repository satisfies it by construction and a test double only has to
// implement the handful of methods the ported callables actually call. As more
// callables land, widen the `Pick` — never change it to `any`.

import type { Repository } from '@rushpoint/data';

/** The repository slice the currently-ported callables use. */
export type ApiRepository = Pick<
  Repository,
  'getAccessCode' | 'getGame' | 'getRun' | 'getPlayerProfile'
>;

/**
 * A rate limiter with the same contract as `functions/src`'s `enforceRateLimit`:
 * it either resolves or throws `HttpsError('resource-exhausted', …)`.
 * Injected because the Firestore-backed counter is not the implementation the
 * box will use (DEPLOYMENT.md §4.1 puts rate limiting in an `onRequest` hook),
 * and because a test must not need one at all.
 */
export type RateLimiter = (uid: string, action: string) => Promise<void>;

export interface ApiDeps {
  repo: ApiRepository;
  /** Defaults to a no-op limiter — see `withDefaults`. */
  enforceRateLimit: RateLimiter;
  /** Injected clock. Nothing in a handler may call `Date.now()` directly. */
  now: () => string;
}

export type PartialApiDeps = Pick<ApiDeps, 'repo'> & Partial<ApiDeps>;

export function withDefaults(deps: PartialApiDeps): ApiDeps {
  return {
    repo: deps.repo,
    enforceRateLimit: deps.enforceRateLimit ?? (async () => {}),
    now: deps.now ?? (() => new Date().toISOString()),
  };
}
