## 1. Guest creators
- [x] 1.1 RED: `scripts/test-guest-creator.ts` (isGuest, defaultAuthMode, accountGateFor, guestSaveMoment)
- [x] 1.2 GREEN: `lib/guestCreator.ts`, `startAsGuest` / `upgradeGuestWithEmail` / `upgradeGuestWithGoogle`
- [x] 1.3 Landing + marketing CTA start as guest; guest bar; sign out hidden for guests
- [x] 1.4 `SaveAccountSheet` (soft "reveal", required "continue", launch, publish); Builder hooks; leave prompt
- [x] 1.5 Browser check: guest wizard → soft ask → 3 edits → required → email save keeps uid and game

## 2. Sign-up form
- [x] 2.1 Stranger opens on sign up; confirm-password field removed

## 3. End-run call
- [x] 3.1 RED: `scripts/test-end-run-call.ts`
- [x] 3.2 GREEN: `lib/endRunCall.ts` + hero/banner in RunConsolePage; moments open after ending
- [x] 3.3 Browser check with a run whose teams all finished

## 4. Youth template
- [x] 4.1 `code-names` → `three-feet` in site-youth-movement; `youth` tag dropped from code-names

## 4b. Swipe generator
- [x] 4b.1 Embla in `SteppedWizard`, auto advance in `SmartBuildWizard`
- [x] 4b.2 Browser check: tap advances, swipe both ways, multi-choice keeps next, last step composes

## 5. Next
- [ ] 5.1 Draft reminder emails + `draftWaiting` notification for unlaunched games
- [ ] 5.2 Push (VAPID key from Ahiya)

## 6. Gates
- [x] 6.1 `npm run verify` (origin:check red only because this worktree has no .env; rerun on the main checkout before deploy)
