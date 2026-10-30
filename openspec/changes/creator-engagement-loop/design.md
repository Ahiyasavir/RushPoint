## D1 Storage: one subcollection, one "seen" stamp

`users/{uid}/notifications/{id}`, written only by the Admin SDK. Fields: `kind`, `createdAt` (ISO),
`gameId?`, `runId?`, `params` (numbers and short names only), `count` (for coalesced items).
Unread is DERIVED: `createdAt > users/{uid}.notificationsSeenAt`. Opening the sheet writes that one
field on the creator's own profile doc, which the rules already let the owner write. So there is no
per-item read flag, no mark-read callable, and no new callable for the coverage guard to chase.

The client listens to the newest 30, ordered by `createdAt`. One listener per open creator tab.

## D2 Ids make writes idempotent and coalesce

The id is derived from what the item is about: `join-<runId>-<milestone>`, `final-<runId>`,
`like-game-<gameId>-<yyyy-mm-dd>`, `copy-task-<taskId>-<yyyy-mm-dd>`, `rated-<runId>`,
`event-<gameId>-<d3|d1|d0>`. A retried callable rewrites the same document, and a day of likes is one
item with a growing `count`, not twenty. Coalescing is what keeps the badge meaningful.

## D3 The writer never fails the operation it describes

`notifyCreator` is best effort: wrapped, logged, never awaited inside a transaction, never thrown.
A failed notification must not fail a join.

## D4 What earns a notification (and what never does)

| kind | when | why it pulls |
|---|---|---|
| `firstJoin` | the first team joins a REAL run | the moment the game becomes real |
| `players` | the run passes 5, 10, 25, 50, 100, 250 participants | goal gradient, social proof |
| `finished` | `onRunFinalized` | the recap is the peak; it brings them to the moments feed |
| `liked` | someone else likes your published game or mission | external validation, variable |
| `copied` | someone copies your mission into their game | "my work is used" |
| `rated` | first feedback answer on a run | what players said |
| `eventSoon` | 3 days, 1 day, day of `eventAt`, while setup is open | real deadline, real reason |

Never: test-drive runs, the creator's own like, demo/self-guided runs, anything at night (the cron
skips 22:00 to 08:00 Israel time for push; in-app items simply wait).

## D5 Red, as an exception

The badge uses a dedicated token `--rp-badge` (#FF3040, Instagram's notification red) with white
text, and nothing else in the UI uses it, so red keeps meaning "something new for you". Shows the
count up to 9, then "9+". A small pop animation when the count rises, none under reduced motion.

## D6 Variable reward, honest version

The dopamine studies (Schultz) show the response moves to the CUE that predicts a reward, and is
strongest when the reward is uncertain (Fiorillo 2003: peak near 50%). So the design puts an honest
uncertain reveal where real value is waiting: the swap spin (the bank really has better and weaker
missions; a top rated one is shown as rare), the recap revealed moment by moment, notification
content that differs each time. No random fake rewards, no loot boxes, no paid chance.

## D7 TikTok elements that fit

Full screen vertical media, one item at a time, swipe up for next, double tap to heart, actions on
the side within thumb reach, autoplay muted video, progress dots. Used for the run moments feed,
and the walk already moves vertically. Not used for editing screens, where precision matters more.

## Test strategy

Pure lane: `scripts/test-creator-notifications.ts` (ids, coalescing day keys, unread count, badge
label, milestones crossed between two counts, countdown kind for a date, quiet hours, self-like and
test-drive exclusions). Rules lane: owner reads own notifications, nobody writes, a stranger cannot
read. e2e: a real join writes `firstJoin`, a second join does not duplicate it, a test drive writes
nothing, finalize writes `finished`, a like from another creator writes `liked`. UI: preview tools.
