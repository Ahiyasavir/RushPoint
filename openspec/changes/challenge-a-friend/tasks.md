# Tasks — Challenge a friend (RED → GREEN → REFACTOR)

> Uses [`share-branding`](../share-branding/tasks.md) for the teaser image.

- [x] **1. RED (pure):** new `scripts/test-challenge.ts` — `parseChallengeParam` valid/malformed/empty.
  Run `npm test` → RED.
- [x] **2. GREEN:** add `parseChallengeParam` to `packages/shared/src/`, export. Re-run → green.
- [x] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — `checkChallengeAnswer` correct → `{correct:true}`;
  wrong → `{correct:false}`; payload never includes the answer key; non-owner unpublished → refused.
  Run `npm run e2e` → RED.
- [x] **4. GREEN:** implement `checkChallengeAnswer` in `functions/src/games/index.ts` (reuse
  answer-match; read public/owner task); re-export + wrappers. Re-run e2e → green.
- [x] **5. GREEN (UI):** `?challenge=` route → `ChallengeTeaser` (timer, submit, result, CTAs, branded
  share image). Verify via preview.
- [x] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
