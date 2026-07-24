# Tasks

## 1. RED — pure outcome→feedback mapping
- [x] 1.1 Add a failing `scripts/test-share-outcome-feedback.ts` (auto-discovered
      by the `npm test` aggregator) asserting `shareOutcomeFeedback('shared'|'downloaded'|'copied')
      === 'confirm'`, `('failed') === 'fallback'`, `('cancelled') === 'silent'`.

## 2. GREEN — minimum code
- [x] 2.1 Extract `shareOutcomeFeedback(result)` into a small play-web lib
      (e.g. `apps/play-web/src/lib/shareFeedback.ts`) — pure, no DOM — so 1.1 passes.
- [x] 2.2 Widen the share-ladder outcome union to include `'cancelled'` and
      return it for an `AbortError` from `navigator.share` (both `nav.share`
      sites) in `apps/play-web/src/lib/recapCollage.ts` and
      `apps/play-web/src/lib/challengeCard.ts`. All other paths unchanged.
- [x] 2.3 `apps/play-web/src/screens/RunRecap.tsx`: read the outcome from
      `shareRecap(...)`, map via `shareOutcomeFeedback`, render a transient inline
      note — confirm on `'confirm'`, clipboard `writeText(window.location.href)` +
      "couldn't share, link copied" on `'fallback'`, nothing on `'silent'`.
- [x] 2.4 `apps/play-web/src/screens/ChallengeTeaser.tsx`: add a `busy` guard,
      read the outcome from `shareChallenge(...)`, and apply the same
      mapped feedback. Keep the collage import lazy (no new eager import).

## 3. i18n
- [x] 3.1 Add `shareSaved` (positive) + `shareFailed` (fallback) copy to the
      `recap` and `challenge` blocks in BOTH HE and EN in
      `apps/play-web/src/i18n.ts` (no em-dash), routed through `t.*` — or reuse
      `t.final.shareSaved` / top-level `linkCopied` for the positive case and add
      only `shareFailed`.
- [ ] 3.2 `npm run i18n:check:strict` clean (HE reads HE, EN reads EN, zero new
      PART B warnings).

## 4. REFACTOR / gates
- [ ] 4.1 Confirm no new eager import re-enters the play-web entry chunk
      (`npm run bundle:budget`).
- [ ] 4.2 Full gate sweep: `npm run verify`.
