## Why

Ahiya, 29.10: make creators want to stay on the platform as much as possible, and want to launch.
Use a red badge like Instagram for notifications, send notifications that bring people back, use
variable reward (the dopamine of anticipation, not only of the prize), give the feeling that
something big is close if they stay a bit longer, use TikTok design elements, and find more methods.

The research note `docs/creator-stickiness-2026-10-29.md` (kept out of git: real user numbers) found:
few creators ever launch, total time is short, and many runs are launched to nobody. People
get a game from the composer and leave. Nothing ever calls them back, because the only creator email
is sent after a run ends. The reward of the product (people playing what you made) is invisible to
the creator until the event day and then gone.

## Guiding rule

Every pull back to the app is about something REAL in the creator's own game: people joined it,
played it, photographed it, liked it, copied it, the event is close. Anticipation is used honestly:
we never invent activity, never fake scarcity, never notify a minor, and we respect quiet hours.
A creator who feels tricked leaves for good; one who feels their game is alive comes back.

## What Changes

1. **Notification center with a red badge** (Instagram red) in the creator header. Server-written
   items under `users/{uid}/notifications`, unread = newer than `users/{uid}.notificationsSeenAt`.
   Items: first team joined, player milestones (5, 10, 25, 50, 100, ...), run finished and the
   recap is ready, new photos from a run, someone liked or copied your game or mission in the
   gallery, players rated the game, the event is in 3 days / tomorrow / today.
2. **Event date**: `Game.eventAt`, asked at the end of the composer and in the walk. Drives a
   countdown on the dashboard card, and the countdown notifications.
3. **Variable reward, used honestly**: (a) the mission swap reveal ("משימה אחרת") becomes a short
   spin with a visible rarity when the bank's best missions come up; (b) the run recap is revealed
   moment by moment, not as one static page; (c) notifications carry the specific thing (which team,
   which photo, how many), so each one is a small surprise.
4. **TikTok style moments feed**: after a run, a full screen vertical swipe feed of the run's photos
   and videos with the mission and team on each, a double tap heart, and one share action.
5. **"Something big is close"**: creator milestones shown as the next goal ("עוד 6 שחקנים ותגיעו
   ל 50"), and a set of rare missions that unlocks with the first real launch.
6. **Push** (phase 2, needs a VAPID key Ahiya creates): the same items as web push, asked for only
   at a moment with a reason ("רוצים לדעת כשהקבוצה הראשונה מצטרפת?"), never at signup.

## Non goals

Streaks, points for creators, notifications to players, any notification not tied to the creator's
own game. Email reminders for unlaunched drafts are a separate change (they need the event date and
the send seam from this one).

## Impact

- `packages/shared`: new `creatorNotifications.ts` (types, ids, unread math, milestones, countdown),
  `FIRESTORE_PATHS.notification(s)`, `Game.eventAt`.
- `functions`: `notifyCreator` helper; writes from `joinRun`, `onRunFinalized`, `setPublicLike`,
  `incrementTaskCopyCount`, `submitRunFeedback`, and the daily cron for countdowns. `updateGame`
  accepts `eventAt`.
- `firestore.rules`: owner may read `users/{uid}/notifications/*`, nobody writes them.
- `apps/creator-web`: header bell, notification sheet, dashboard countdown, composer and walk date
  question, swap spin, moments feed. i18n HE and EN.
