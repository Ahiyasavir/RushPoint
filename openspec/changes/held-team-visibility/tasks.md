## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-held-team-notice.ts` in the house style (`check(label, cond, detail)`),
      importing `heldNotice` and its types from `../apps/play-web/src/lib/holdNotice`.
- [x] 1.2 Encode the five mandated fixtures from the design's Test Strategy: not held, held awaiting
      consent, held for an unknown/future reason, held-then-released, and missing/undefined state.
- [x] 1.3 Encode the degradation fixtures: non-string reasons, empty/whitespace reasons, absent and
      non-boolean `launched`.
- [x] 1.4 Encode the invariants asserted over EVERY fixture: `held === (kind !== 'none')`,
      `offerHelp === held`, `blameless === true`, kind ∈ the three values, never throws.
- [x] 1.5 Re-run the whole suite under a stubbed `Date.now` (epoch, ±6 h) — no result may change.
- [x] 1.6 Add the wiring guards: `PlayScreen.tsx` imports and calls the function, the held branch
      does not render `waitingStart`, and no hold-clearing control exists; `functions/src/runs/index.ts`
      ships `holdReason` on `getMyTeamState` and `heldForConsent` on the `listRunTeams` row; both
      `i18n.ts` files carry the new keys in HE and EN.
- [x] 1.7 Run `npx tsx scripts/test-held-team-notice.ts` and confirm it FAILS for the right reason.
      Record the failure verbatim.

## 2. GREEN — the pure decision

- [x] 2.1 Add `heldNotice`, `HeldNotice`, `HeldKind` and `HELD_HELP_KEY` to
      `apps/play-web/src/lib/holdNotice.ts` per D3. No React, no storage, no `Date.now`.
- [x] 2.2 Re-run the script; the pure section goes GREEN, only the wiring guards remain red.

## 3. GREEN — the server projections

- [x] 3.1 `functions/src/runs/index.ts`: `getMyTeamState` returns
      `holdReason: 'guardian_consent' | null`, derived from `isConsentSatisfied` + `team.launched`.
      Read-only, additive, no PII.
- [x] 3.2 `functions/src/runs/index.ts`: `listRunTeams` reads the game doc best-effort and projects
      `heldForConsent: boolean` per row; a failed read degrades every row to `false`.
- [x] 3.3 Mirror both on the client types: `MyTeamState` in `apps/play-web/src/services/calls.ts`,
      `RunTeamRow` in `apps/creator-web/src/services/calls.ts`.

## 4. GREEN — the two screens

- [x] 4.1 `apps/play-web/src/i18n.ts`: add the held-notice copy in Hebrew and English (no em-dashes).
- [x] 4.2 `apps/play-web/src/screens/PlayScreen.tsx`: in the `!team.launched` branch, render the held
      card from `heldNotice(...)`, replacing the `waitingStart` line when held. Reuse the SOS
      affordance already on that screen; add no control that changes the hold.
- [x] 4.3 `apps/creator-web/src/i18n.ts`: add the row-badge label in Hebrew and English.
- [x] 4.4 `apps/creator-web/src/pages/RunConsolePage.tsx`: one added JSX block on the team row, next
      to the out-of-bounds badge. Additive only; the file is under concurrent edit.
- [x] 4.5 Re-run the script; all guards GREEN.

## 5. REFACTOR + gates

- [x] 5.1 Re-read the concurrently-owned files and confirm the diff is purely additive.
- [x] 5.2 `npm run typecheck`
- [x] 5.3 `npm run lint`
- [x] 5.4 `npm test`
- [x] 5.5 `npm run play:build`
- [x] 5.6 `npm run creator:build`
- [x] 5.7 `npm run bundle:budget`
- [x] 5.8 `npm run i18n:check:strict`
- [x] 5.9 `npx openspec validate held-team-visibility --strict`
- [x] 5.10 Report the e2e assertions that belong in `scripts/e2e-verify.mjs` (file owned by another
      lane, not edited here).
