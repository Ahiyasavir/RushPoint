## Why

`apps/play-web` is being submitted to Google Play. The live photo feed (change:
`live-photo-feed`) broadcasts participant-uploaded photos **run-wide to every team**, and today it
has:

- **no participant-facing report/flag affordance** — only staff/owner can hide (`hideFeedItem`);
- **no block/mute mechanism** — a participant who objects to a photo has no way to stop seeing it,
  or to stop seeing that team's photos;
- **no moderation before broadcast** — `writeFeedItem` publishes on photo approval with
  `active: true`, and the only removal path requires a staff member to be watching the console;
- **no published in-app content policy naming the feed** — `LegalPage.tsx` §5.4 "Content
  Prohibitions" reads as governing the Creator **task gallery**; it never mentions the live photo
  feed, reporting, or removal;
- **no disclosure in the Builder** — the `photoFeedEnabled` checkbox (default ON) does not tell the
  creator that every team will see every photo.

Google Play's User Generated Content policy requires **all** of: an in-app report/flag affordance,
a block mechanism, moderation within a reasonable timeframe, and a published in-app content policy.
Minors are a declared audience (youth groups, bar/bat mitzvah runs). **This is a launch blocker.**

## What Changes

**Participants can report feed content (new callable).**
- New callable `reportFeedItem({ ownerUid, gameId, runId, itemId, reason })` — same auth posture as
  `reactToFeedItem` (`requireAuth` + run-membership resolution + `enforceRateLimit`), with a new
  `reportFeedItem: { max: 20, windowMs: MIN }` rate-limit entry.
- `reason` comes from a **closed set** `FEED_REPORT_REASONS`
  (`inappropriate` | `harassment` | `privacy` | `other`), validated server-side. **No free text**
  (free text is itself UGC and would need its own moderation).

**Reports auto-hide at a threshold (new pure reducer).**
- New pure module `packages/shared/src/feedReports.ts` exporting `applyReport(item, uid, reason)`,
  mirroring `feedReactions.ts`: idempotent per uid (`reportedBy: Record<uid, reason>`),
  `reportCount` = number of **distinct** reporting uids, and at
  `reportCount >= FEED_AUTO_HIDE_REPORTS` (**2**) it flips `active: false` with
  `hiddenBy: 'auto:reports'` + `hiddenAt`. Pure, never mutates input, throws on an invalid reason.

**Reporter-side suppression + team mute (the "block" requirement).**
- New pure module `packages/shared/src/feedMute.ts` — per-device mute state (muted item ids + muted
  team ids) with pure helpers (`addMutedItem`, `addMutedTeam`, `isFeedItemMuted`); play-web persists
  it in `localStorage`. Reporting an item **immediately** adds it to the local muted set, so the
  reporter never keeps seeing content they objected to even though the global auto-hide threshold is 2.
- Each feed card gains a "mute this team" action that hides all of that team's items on this device.

**Staff moderation gains restore + visibility of hidden items.**
- `hideFeedItem` gains an optional `restore?: boolean` that sets `active: true`, clears
  `hiddenAt`/`hiddenBy`, and sets `reportsCleared: true` on the item so `applyReport` will **not**
  auto-hide it again. Authz unchanged (staff/owner only).
- In `moderate` mode `FeedPanel` drops the `active == true` listener filter so staff can **see**
  hidden items (with a report-count badge) and restore a false positive.

**Published policy + creator disclosure.**
- `LegalPage.tsx` gains an explicit bilingual (HE + EN) clause naming the live photo feed: what may
  not be uploaded, that photos are visible to all teams in the run, that any participant may report,
  that reported content is removed pending review, and that the organizer / RushPoint may remove
  content.
- The `photoFeedEnabled` checkbox in `BuilderPage.tsx` gains bilingual helper text stating photos
  are visible to every team in the run and the organizer is responsible for their participants'
  content.

## Non-goals

- **Not** changing the `photoFeedEnabled` default. Undefined still means **enabled**; compliance is
  achieved by report/block/moderation controls, not by turning the feature off.
- **No** pre-publication human review queue and **no** automated image classification / ML content
  scanning — moderation stays report-driven plus the existing staff-review path.
- **No** free-text report reason, and no reporter-visible report history or appeals UI.
- **No** identity-level blocking. Participants are anonymous (`uid == teamId`), so "block a user"
  can only mean **team-level** suppression on the reporting device.
- **No** server-side per-device mute state — mute is deliberately local (`localStorage`), never a
  Firestore write from a client.
- **No** change to the reaction system, the photo upload/approval flow, `writeFeedItem`'s
  best-effort semantics, or the ceremony slideshow (`pickCeremonyFeed` already filters
  `active !== false`, so auto-hidden and staff-hidden items drop out for free).
- **No** account-level bans or cross-run reputation.

## Capabilities

### New Capabilities

- `feed-ugc-safety`: The live photo feed carries a complete UGC-safety surface — any participant can
  report an item from a closed reason set, repeated reports auto-hide it, the reporter's own view is
  suppressed immediately and they can mute a whole team on their device, staff can see and restore
  hidden items, and the content policy governing the feed is published in-app and disclosed to the
  creator at authoring time.

### Modified Capabilities

<!-- None. `live-photo-feed` was never archived into `openspec/specs/`, so there is no living
     requirement contract to amend; the feed's safety behavior is added as a new capability. The
     existing hideFeedItem/reaction behavior is restated here only where this change extends it. -->

## Impact

- **Surfaces touched:** shared types + two new pure shared modules · one **new callable** + one
  changed callable (`functions/src/index.ts`) · `play-web` (FeedPanel + calls wrapper + i18n) ·
  `creator-web` (LegalPage + BuilderPage + i18n). **No** Firestore rules change and **no** new index
  (the `feedItems` read surface already covers owner/staff/run-participant; staff read hidden items
  through the same rule, and the moderate listener drops a `where` clause rather than adding one).
- **Code:**
  - New: `packages/shared/src/feedReports.ts`, `packages/shared/src/feedMute.ts`,
    `scripts/test-feed-reports.ts`, `scripts/test-feed-mute.ts`.
  - Edited: `packages/shared/src/types/index.ts` (`FeedItem` gains `reportedBy`, `reportCount`,
    `reportsCleared`), `packages/shared/src/rateLimit.ts`, `packages/shared/src/index.ts` (exports),
    `functions/src/index.ts` (`reportFeedItem`, `hideFeedItem` restore),
    `apps/play-web/src/services/calls.ts`, `apps/play-web/src/components/FeedPanel.tsx`,
    `apps/play-web/src/i18n.ts`, `apps/creator-web/src/pages/LegalPage.tsx`,
    `apps/creator-web/src/pages/BuilderPage.tsx`, `apps/creator-web/src/i18n.ts`,
    `scripts/e2e-verify.mjs`.
- **New callable:** yes — `reportFeedItem`. This drives (a) a typed wrapper in
  `apps/play-web/src/services/calls.ts` and (b) **mandatory** e2e coverage: `npm run e2e`'s
  **callable coverage guard** introspects the callables the emulator serves and fails if any was
  never invoked, so `reportFeedItem` ships **RED** until a scenario invokes it.
- **Dependencies:** none added.
- **Risk:** low-to-moderate. The auto-hide threshold is the judgement call — teams are competitive
  rivals, so a 1-report instant global hide is griefable; 2 distinct reporters is the floor, with
  reporter-side local suppression covering the gap and staff `restore` covering false positives.
- **i18n:** every new string in both apps must route through `t.*` with HE **and** EN entries;
  `npm run i18n:check` is a hard gate and new UI must add **zero** new PART B findings.
