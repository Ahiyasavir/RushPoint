## 1. RED — the pure classifiers, failing

- [x] 1.1 Write `scripts/test-failure-visibility.ts` asserting every RED case in design.md's Test
      Strategy against `apps/play-web/src/lib/failureCopy.ts` (`taskMessageClass`,
      `classifyStaffError`, `announcementPayload`, `shouldOfferRetry`) and
      `apps/creator-web/src/lib/callErrors.ts` (`classifyBillingError`). Include the dictionary
      cross-checks (every mapper key exists in both `he` and `en`). Run `npx tsx
      scripts/test-failure-visibility.ts` and confirm it fails because the modules do not exist.

## 2. GREEN — the pure classifiers

- [x] 2.1 Create `apps/play-web/src/lib/failureCopy.ts` with the four exports and the code-only
      classification table from design.md D1/D2/D3/D5. No React, no Firebase imports.
- [x] 2.2 Create `apps/creator-web/src/lib/callErrors.ts` with `classifyBillingError` and the
      generic `classifyCallError`.
- [x] 2.3 Add the required keys to BOTH dictionaries in `apps/play-web/src/i18n.ts`
      (`t.staff.sessionExpired` / `notFound` / `rateLimited` / `offline` / `generic` /
      `backToSignIn` / `broadcastFailed` / `msgHePrimary` / `msgEnOptional`, `t.task.retryRouting`
      reuse, `t.play.noActiveStageTitle` / `noActiveStageBody`, `t.play.actionFailed`,
      `t.play.locationNotReady`, `t.chat.sendFailedRetry`, `t.promo.startFailed`,
      `t.board.retry`, `t.board.linkCopied`) and in `apps/creator-web/src/i18n.ts`
      (`t.wallet.insufficientFunds` / `rateLimited` / `offline` / `notConfigured` / `generic` /
      `statusFailed` / `retry`, `t.dashboard.templateFailed`, `t.dashboard.publishFailed`).
      Hebrew must be real Hebrew; no `—`, `–`, or ` - ` separators.
- [x] 2.4 Re-run `npx tsx scripts/test-failure-visibility.ts` and confirm every assertion passes.

## 3. Participant task card — error vs progress

- [x] 3.1 Retype `TaskRunner`'s `msg` state to `TaskMessage | null` and update every `setMsg` call
      site with its tone per design.md D1. Change `submitError()` to return
      `{ text, isError: true }`. Let the compiler find the sites; do not add a string matcher.
- [x] 3.2 Render both message sites (`TaskRunner.tsx` main card and the sealed-task card) through
      `taskMessageClass(msg.tone)` with `role="status" aria-live="polite"` and the ⚠ prefix on
      errors. Confirm `npm run play:build` passes.

## 4. Participant routing wait

- [x] 4.1 Replace the bare "finding your next task" card with the spinner markup used at
      `PlayScreen.tsx:339`, plus a `waitedMs` timer keyed on `routingAttempt`.
- [x] 4.2 Gate the retry button on `shouldOfferRetry(waitedMs, routingAttempt)`, firing the
      existing `setRoutingAttempt((n) => n + 1)`.

## 5. Participant screen dead ends

- [x] 5.1 Replace `PlayScreen.tsx`'s "No active stage." sentence with the icon + explanation +
      `t.common.tryAgain` → `refresh()` pattern already used for the load-failure state.
- [x] 5.2 Give `ZonesPanel` and `TrackablesPanel` a keyed `errors` record; replace both empty
      `catch` blocks with an inline per-row localized failure line.
- [x] 5.3 Replace `ZonesPanel`'s silent `if (!me) return;` with the "position not ready" message.
- [x] 5.4 Add the "could not send, tap to retry" line to `ChatPanel`, keeping the draft.

## 6. Staff console

- [x] 6.1 Route all five raw-`e.message` sites through `classifyStaffError`; hold `readErr` as
      `StaffFailure | null`; render `t.staff[key]`.
- [x] 6.2 Render a "back to sign in" `Button` when `sessionExpired`, calling `clearStaffSession()`
      and returning to the PIN screen. Clear `readErr` at the top of both `onSnapshot` success
      callbacks.
- [x] 6.3 Swap the announcement composer's field order (Hebrew primary + autofocus, English
      labelled optional), change the disable predicate to `(!msg.trim() && !msgHe.trim())`, and
      dispatch `announcementPayload(msg, msgHe)`.
- [x] 6.4 Wrap `send()` in try/catch: clear drafts only on success; on failure set a localized
      error and preserve both drafts.

## 7. Public routes

- [x] 7.1 `GamePromoScreen`: catch the `startInstantPlay` rejection into an error line with a retry
      and a pointer to "I have a code"; switch the CTA to the `Button` `loading` prop.
- [x] 7.2 `PublicLeaderboardScreen`: add a retry `Button` calling `load` in the unavailable state;
      add the `copied` confirmation to the share/copy path.

## 8. Creator console

- [x] 8.1 `WalletPage`: catch `loadStatus`, hold a `statusError` flag, and replace the unconditional
      spinner with a localized error + retry when it is set.
- [x] 8.2 `WalletPage`: map `purchaseCredits` / `subscribePro` rejections through
      `classifyBillingError`; `console.error` the original.
- [x] 8.3 `DashboardPage`: wrap the template-pick path in try/catch, alert localized copy, and
      re-open the picker on failure.
- [x] 8.4 `DashboardPage`: wrap `togglePublish` in try/catch with `toast.error`.

## 9. REFACTOR

- [x] 9.1 Re-read the touched files for any remaining empty `catch` on a user-initiated action or
      any rendered `e.message`; fix or justify each with a comment.
- [x] 9.2 Confirm every class string added is a static Tailwind literal (no interpolation) and that
      new markup prefers logical classes (`ms-`/`text-start`).

## 10. Gates

- [x] 10.1 Ran, green: `npx tsc --noEmit` in `apps/play-web` · `npx tsc --noEmit` in
      `apps/creator-web` · `npx tsx scripts/test-failure-visibility.ts` (all assertions pass) ·
      `npm run i18n:check` (PART A + PART B both clean). The repo-wide
      `npm run typecheck` / `lint` / `test` / `creator:build` / `play:build` are run once by the
      orchestrator at the end of the wave (the tree is shared with other in-flight lanes).
      Original gate list: `npm run typecheck` · `npm run lint` · `npm test` ·
      `npm run i18n:check` · `npm run i18n:check:strict` · `npm run creator:build` ·
      `npm run play:build`. All must be green, and `i18n:check:strict` must stay at its
      pre-change baseline of zero findings.
      `npm run e2e` is **excluded**: this change touches no callable, no payload shape and no server
      behavior, so the emulator suite cannot observe it, and the emulator must not be started (a
      live playtest tunnel owns it).
