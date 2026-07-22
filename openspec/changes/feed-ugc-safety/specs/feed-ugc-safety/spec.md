## ADDED Requirements

### Requirement: Participants can report a live-feed item

Any authenticated member of a run SHALL be able to report a live photo feed item — a participant of
that run, and also run-scoped staff or the owner — through a `reportFeedItem` callable taking
`{ ownerUid, gameId, runId, itemId, reason }`. The `reason` SHALL be constrained to a closed,
server-validated set `FEED_REPORT_REASONS` (`inappropriate`, `harassment`, `privacy`, `other`) —
free-text reasons SHALL NOT be accepted. The callable SHALL enforce the same authorization posture
as `reactToFeedItem` (authenticated caller, run-membership resolution falling back to staff/owner)
and SHALL be rate limited by a `reportFeedItem` entry in the shared rate-limit table. Reporting
SHALL be idempotent per reporting **team** (a participant's `reporterKey` is their teamId — see the
auto-hide requirement below for why). Feed report state SHALL be written only by the server; clients
SHALL NOT write it directly.

#### Scenario: A run participant reports an item

- **WHEN** a participant of the run calls `reportFeedItem` with a valid reason for a live feed item
- **THEN** the call succeeds, the item records that participant's **team** as a reporter, and the
  returned report count is 1

#### Scenario: The same caller reporting twice does not inflate the count

- **WHEN** the same participant (or a teammate on another device attached to the same team) calls
  `reportFeedItem` again on the same item
- **THEN** the call succeeds, the stored report count remains unchanged, and no duplicate report is
  recorded

#### Scenario: An invalid reason is rejected

- **WHEN** a caller submits a `reason` outside `FEED_REPORT_REASONS` (including free text)
- **THEN** the call is rejected with an `invalid-argument` error and no report is recorded

#### Scenario: A stranger cannot report

- **WHEN** an authenticated user who is neither a participant of the run, nor run-scoped staff, nor
  the owner calls `reportFeedItem`
- **THEN** the call is denied

#### Scenario: Missing identifiers are rejected

- **WHEN** `reportFeedItem` is called without `ownerUid`, `gameId`, `runId`, or `itemId`
- **THEN** the call is rejected with an `invalid-argument` error

#### Scenario: Reporting is rate limited

- **WHEN** a caller exceeds the configured `reportFeedItem` rate limit within the window
- **THEN** further report calls are rejected by the rate limiter

#### Scenario: Report behavior is covered end to end

- **WHEN** the e2e suite runs
- **THEN** at least one scenario invokes `reportFeedItem`, satisfying the callable coverage guard,
  and `reportFeedItem` appears in the authorization matrix as participant-allowed and
  stranger-denied

### Requirement: Repeated reports auto-hide a feed item

Feed report state SHALL be computed by a pure, unit-tested reducer
`applyReport(item, reporterKey, reason)` in `packages/shared/src/feedReports.ts`, mirroring the
existing `applyReaction` reducer. The reducer SHALL be pure (never mutating its input), SHALL throw
on a reason outside `FEED_REPORT_REASONS`, SHALL track reporters as a `reportedBy` map from
`reporterKey` to reason, and SHALL derive `reportCount` as the number of **distinct** reporterKeys.
When `reportCount` reaches `FEED_AUTO_HIDE_REPORTS` (2) the reducer SHALL mark the item inactive
with `hiddenBy` set to the sentinel `auto:reports` and `hiddenAt` set, unless the item has been
cleared by staff (see the restore requirement). An item that is already inactive SHALL still accept
further reports idempotently rather than erroring.

**`reporterKey` is the caller's teamId, not their uid.** RushPoint supports shared team devices
(multiple uids attached to one team via `deviceUids`); keying distinctness by uid would let a single
team reach `FEED_AUTO_HIDE_REPORTS` on its own from two of its own phones — exactly the griefing the
threshold-of-2 exists to prevent. The `reportFeedItem` callable SHALL resolve the caller's teamId
(the same resolution `reactToFeedItem` already performs) and pass it as `reporterKey`; a staff/owner
reporter, who has no team, SHALL be keyed by the sentinel `staff:<uid>`. `reportCount` therefore
counts distinct **teams**, not distinct devices or uids.

#### Scenario: One report does not hide the item

- **WHEN** a single distinct reporterKey (team) has reported an item
- **THEN** the item remains active and visible to other participants

#### Scenario: A second distinct reporter hides the item

- **WHEN** a second, different reporterKey (a different team) reports the same item
- **THEN** the item becomes inactive, `hiddenBy` is `auto:reports`, `hiddenAt` is set, and the
  result indicates the item was hidden by this call

#### Scenario: A second device on the same team does not hide the item

- **WHEN** a second device belonging to a team that has already reported an item reports it again
- **THEN** because both devices share the same team's `reporterKey`, the call is idempotent
  (`changed: false` when the reason is unchanged), `reportCount` does not increase, and the item
  stays active — a single team can never reach the auto-hide threshold on its own

#### Scenario: Changing a reason does not raise the count

- **WHEN** a reporterKey that already reported an item reports it again with a different valid
  reason
- **THEN** the stored reason for that reporterKey is updated and `reportCount` is unchanged

#### Scenario: Reporting an already-hidden item is idempotent

- **WHEN** a further report arrives for an item that is already inactive
- **THEN** the report is recorded, the item stays inactive, and the call does not error

#### Scenario: The reducer never mutates its input

- **WHEN** `applyReport` is called with a feed item
- **THEN** the passed-in item object is unchanged and a new state object is returned

#### Scenario: An invalid reason throws in the reducer

- **WHEN** `applyReport` is called with a reason outside `FEED_REPORT_REASONS`
- **THEN** it throws, and the callable surfaces that as an `invalid-argument` error

#### Scenario: Reducer behavior is proven without an emulator

- **WHEN** the pure-logic test lane runs (`npm test`)
- **THEN** a `scripts/test-feed-reports.ts` assertion script exercises the reducer's counting,
  idempotence, auto-hide threshold, and immutability without needing the emulator

#### Scenario: Hidden items disappear from the ceremony slideshow

- **WHEN** an item has been hidden, whether by staff or by the auto-hide threshold
- **THEN** it is excluded from the ceremony feed selection (existing `active !== false` filter)

### Requirement: A reporter's own view is suppressed immediately

Reporting an item SHALL immediately remove that item from the reporting participant's own feed on
their device, without waiting for the auto-hide threshold, and without depending on the report call
succeeding over the network.

#### Scenario: Reported item vanishes for the reporter

- **WHEN** a participant reports a feed item
- **THEN** that item is removed from their feed view immediately, even though the item is still
  visible to other teams until the auto-hide threshold is reached

#### Scenario: Suppression survives an offline report

- **WHEN** the report call fails or is pending because the device is offline
- **THEN** the item is still suppressed locally for the reporter

### Requirement: Participants can mute a team's feed content on their device

The participant app SHALL provide a per-device suppression ("block") mechanism for feed content: a
participant SHALL be able to mute an individual item and to mute **all** items from a given team.
Mute state SHALL be computed by pure, unit-tested helpers in `packages/shared/src/feedMute.ts`
(`addMutedItem`, `addMutedTeam`, `isFeedItemMuted`, plus tolerant parse/serialize helpers) and
persisted locally by `play-web` in `localStorage`, scoped to the run. Mute state SHALL NOT be
written to Firestore by the client. Because participants are anonymous (`uid == teamId`), muting
SHALL be understood and described as **team-level suppression on this device**, not identity-level
blocking.

#### Scenario: Muting a team hides all of its items

- **WHEN** a participant chooses "mute this team" on a feed card
- **THEN** every feed item from that team is hidden from their feed, including items that arrive
  afterwards

#### Scenario: Mute persists across reloads

- **WHEN** the participant reloads the app in the same run
- **THEN** previously muted items and teams remain hidden

#### Scenario: Mute is device-local and never written to Firestore

- **WHEN** a participant mutes an item or a team
- **THEN** no client write to Firestore occurs and other participants' feeds are unaffected

#### Scenario: Corrupted local mute state degrades safely

- **WHEN** the persisted mute value is missing or not valid JSON
- **THEN** the parse helper returns the empty mute state without throwing and the feed renders
  normally

#### Scenario: Mute helpers are pure and unit-tested

- **WHEN** the pure-logic test lane runs (`npm test`)
- **THEN** a `scripts/test-feed-mute.ts` assertion script proves the helpers are immutable, deduped,
  match by both item id and team id, and round-trip through serialize/parse

### Requirement: Staff can see hidden items and restore a false positive

Staff and the run owner SHALL be able to review and reverse feed moderation. `hideFeedItem` SHALL
accept an optional `restore` flag that reactivates an item, clears `hiddenAt` and `hiddenBy`, and
marks the item so that the automatic report threshold SHALL NOT hide it again. Authorization SHALL
be unchanged: only run-scoped staff or the owner may hide or restore. In moderation mode the feed
panel SHALL display hidden items (not only active ones), with a report-count indicator, so that a
hidden item can be found and restored.

#### Scenario: Owner restores an auto-hidden item

- **WHEN** the owner calls `hideFeedItem` with `restore: true` for an item hidden by reports
- **THEN** the item becomes active again, `hiddenAt` and `hiddenBy` are cleared, and it is marked as
  cleared of automatic hiding

#### Scenario: A restored item is not immediately re-auto-hidden

- **WHEN** further distinct participants report a restored item past the auto-hide threshold
- **THEN** the item remains active, while the reports are still recorded and the report count still
  increases

#### Scenario: A participant cannot restore

- **WHEN** a participant calls `hideFeedItem` with `restore: true`
- **THEN** the call is denied by the same staff/owner authorization check that guards hiding

#### Scenario: Moderation view lists hidden items

- **WHEN** the feed panel renders in moderation mode for staff or the owner
- **THEN** hidden items are listed alongside active ones, visually distinguished and annotated with
  their report count, and each offers a restore action

#### Scenario: Participants still never see hidden items

- **WHEN** a participant's feed listener runs
- **THEN** it continues to filter to active items only, so hidden content is not delivered to
  participants

### Requirement: The content policy governing the live photo feed is published in-app

The in-app legal document (`LegalPage`) SHALL contain an explicit clause naming the **live photo
feed**, stating: what participants may not upload; that uploaded photos are visible to all teams in
the run; that any participant may report content; that reported content is removed pending review;
and that the organizer and RushPoint may remove content. The clause SHALL be present in both the
Hebrew and English document bodies.

#### Scenario: The clause names the feed explicitly

- **WHEN** a user reads the terms in either language
- **THEN** there is a clause that names the live photo feed (not only the creator task gallery) and
  states the upload prohibitions, run-wide visibility, the report right, removal pending review, and
  the organizer's and platform's removal rights

#### Scenario: The clause exists in both languages

- **WHEN** the legal page is viewed in Hebrew and in English
- **THEN** the feed clause is present and complete in both, with Hebrew copy in Hebrew and English
  copy in English

### Requirement: The creator is told what enabling the photo feed means

The Builder's photo-feed toggle SHALL carry bilingual helper text stating that photos will be
visible to every team in the run and that the organizer is responsible for their participants'
content. The toggle's default SHALL remain unchanged: an absent `photoFeedEnabled` value still means
the feed is **enabled**.

#### Scenario: Disclosure appears next to the toggle

- **WHEN** a creator views the photo-feed setting in the Builder
- **THEN** helper text states that photos are visible to every team in the run and that the
  organizer is responsible for participant content

#### Scenario: The default is unchanged

- **WHEN** a game has no `photoFeedEnabled` value set
- **THEN** the photo feed is treated as enabled, exactly as before this change

### Requirement: New UGC-safety UI text is fully localized

All user-facing text added by this change SHALL be sourced from the applications' translation maps
with both Hebrew and English entries, and SHALL NOT be hardcoded in components. This covers the
report control and reason labels, mute controls, moderation badges and the restore action, the
Builder helper text, and the legal clause, in both apps.

#### Scenario: i18n gate stays green

- **WHEN** `npm run i18n:check` runs after the change
- **THEN** it passes with no PART A errors

#### Scenario: No new hardcoded strings

- **WHEN** `npm run i18n:check:strict` runs after the change
- **THEN** the new UI contributes zero new PART B findings
