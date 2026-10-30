## 1. Notification model (pure)

- [x] 1.1 RED: `scripts/test-creator-notifications.ts` for `packages/shared/src/creatorNotifications.ts`
- [x] 1.2 GREEN: the module, exported from the shared barrel; `FIRESTORE_PATHS.notification(s)`

## 2. Server writes

- [x] 2.1 RED: e2e scenario `creator notifications` (first join, milestone, no duplicate, test drive
      silent, finished, liked by others coalesced, own like silent, eventAt stored/refused/cleared)
- [x] 2.2 GREEN: `functions/src/notify.ts` `notifyCreator` (best effort) and calls from `joinRun`,
      `runPostFinalizeConsolidation`, `setPublicLike`, `incrementTaskCopyCount`, `submitRunFeedback`
- [x] 2.3 Rules: owner read, no client write; `scripts/test-rules.mjs` assertions

## 3. Red badge and sheet (creator-web)

- [x] 3.1 `rp-badge` token (#FF3040), `NotificationBell` in the header, list, seen stamp on open
- [x] 3.2 i18n HE and EN for every kind (`notificationView` drops a row it cannot word)

## 4. Event date and countdown

- [x] 4.1 RED: `normalizeEventAt` / `daysUntilEvent` / `eventCountdownKind` tests
- [x] 4.2 GREEN: `Game.eventAt`, `updateGame`, `BUILDER_EDITABLE_FIELDS`, walk plan question, dashboard
      countdown chip; excluded from game files (one occasion's date)
- [x] 4.3 Daily cron (`digest-cron.ts` → `eventReminders.ts`) writes `eventSoon`; index on games.eventAt

## 5. Variable reward and moments

- [x] 5.1 Swap roll: the dice spins through real mission names (~400ms, a second press lands at once).
      No quality label: the ratings stay hidden from creators (decision 22.10)
- [x] 5.3 TikTok style moments feed (`MomentsFeed`, `?moments=1`), opened from the run console and
      from the "finished" notification
- [ ] 5.2 Recap revealed moment by moment on the report page
- [ ] 5.4 Creator milestones as the next goal on the dashboard; rare missions unlock on first launch

## 6. Push (phase 2)

- [ ] 6.1 Ahiya creates the VAPID key in the Firebase console and puts it in the .env files himself
- [ ] 6.2 FCM token per creator, opt-in at the first launch, same items as push, quiet hours

## 7. Gates

- [x] 7.1 `npm run verify` (all but `origin:check`, which needs the main checkout's .env files)
- [x] 7.2 `npm run verify:emulator` (e2e ALL PASS incl. the new scenario, both rules suites, load + adversarial sims)
- [x] 7.3 Browser check of the bell, the walk, the countdown and the feed (launch-to-first-missing not yet seen in a browser)
