## 1. Establish the defect from the code

- [x] 1.1 Confirmed the Firebase callable SDK's default timeout is **70,000ms**, so an
  autosave on a dead connection hangs that long before the existing failure banner can
  possibly appear.
- [x] 1.2 Confirmed `status === 'saving'` is the ONLY state shown for that whole window,
  so a stuck save and a healthy save say the same word.
- [x] 1.3 Confirmed the manual save button carries `disabled={status === 'saving'}`
  directly beneath a comment describing it as the control that "unconditionally tries
  again right now" — removed for exactly the window it exists for.
- [x] 1.4 Confirmed creator-web has no connection indicator at all, while play-web has
  `ConnectionBanner`.

## 2. The pure verdict — RED

- [x] 2.1 `scripts/test-save-health.ts`: a save past the slow threshold must stop
  saying "saving". Run; confirmed RED because the module did not exist.
- [x] 2.2 Escalation at each threshold, and the stalled threshold asserted to be far
  below the SDK's 70s — the whole point being that the creator learns in seconds.
- [x] 2.3 Offline reported immediately and outranking the clock; unknown connectivity
  NOT treated as offline.
- [x] 2.4 Non-`saving` statuses passed straight through, never escalated.
- [x] 2.5 Do-not-cry-wolf: every unusable clock reads as ordinary, including a
  BACKWARDS one (device time change, tab resume).
- [x] 2.6 A 5000-case seeded sweep asserting escalation is monotonic in elapsed time and
  that offline always wins, with every level reached and the denominator printed.

## 3. The pure verdict — GREEN

- [x] 3.1 `apps/creator-web/src/lib/saveHealth.ts`. 48 assertions green.

## 4. Wire it in

- [x] 4.1 Stamp `saveStartedAt` when a save begins.
- [x] 4.2 A one-second interval that runs ONLY while a save is in flight, so an idle
  Builder ticks nothing; it is what makes the verdict re-evaluate rather than freeze on
  its first answer.
- [x] 4.3 `online` from `navigator.onLine` plus the `online` / `offline` events.
- [x] 4.4 The dot and the word read from the escalated level; `slow`, `stalled` and
  `offline` keep their word at every width via `needsAttention`, for the same reason a
  failure does — a coloured dot cannot say "check your connection".
- [x] 4.5 **Removed `disabled={status === 'saving'}` from the manual save.** `save()` is
  already a no-op when nothing changed and already carries the `saveSeq` out-of-order
  guard, so pressing it mid-flight cannot persist a stale snapshot.
- [x] 4.6 Hebrew and English copy for the three new states.

## 5. Gates

- [x] 5.1 `npm run verify` — **300/300 pure-logic unit files green**, every build green,
  lint 0 errors. The only red gate is the pre-existing `check-marketing-output` failure
  on the untracked `_kit-b83f9d2e` kit, outside this change.
- [x] 5.2 `npm run i18n:check:strict` — PART A and PART B both clean.
- [x] 5.3 No callable, no server file and no stored shape changed, so `npm run e2e`
  is deliberately not re-run for this change.

## 6. Verify in the browser — NOT YET DONE

The dev stack's functions emulator was serving a bundle from before several
`packages/shared` rebuilds in this session, so the Builder could not load a game at all
(`internal` on `getGame` — the documented stale-shared-bundle signature). These three
are outstanding and are NOT claimed as passing.

- [ ] 6.1 Open the Builder, edit something, and confirm a normal save still shows the
  ordinary indication and settles to "saved".
- [ ] 6.2 Throttle the network to offline, edit, and confirm the offline word appears
  at once rather than after 70 seconds.
- [ ] 6.3 Confirm the manual save button is still clickable while a save is in flight.

## 7. Ship

- [ ] 7.1 `deploy:hosting`.

## 8. Follow-ups filed, not built

- [ ] 8.1 Persisting unsaved edits so they survive a reload or a crash — the strongest
  version of "changes were not saved", and its own proposal because it interacts with
  two open tabs, a newer server version and the game's conflict model (design Open
  Question 1).
- [ ] 8.2 A persistent connection banner for creator-web, like play-web's (design Open
  Question 2).
