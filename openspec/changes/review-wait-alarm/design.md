## Context (verified 2026-09-28)

- `packages/shared/src/reviewQueueCue.ts` `newPendingKeys` decides "something new arrived";
  `RunConsolePage.tsx` plays `playAlert()` on it. Pending rows come from `buildSubmissionQueues`
  (`packages/shared/src/photoQueue.ts`), each with `submittedAt`.
- `apps/creator-web/src/lib/sound.ts`: `unlockAudio()` / `playAlert()`; a context that is not
  `running` drops the cue (never queues). Nothing tells the organizer the sound is locked.
- `lib/photoReviewQueue.ts` (creator-web) already computes a clock-injected wait label per row.

## Decisions

### D1: one pure verdict, clock injected

`reviewWaitAlarm(pending, nowMs, { mutedUntilMs })` → `{ level: 'none' | 'alarm', oldest:
{ key, waitedMs } | null, overCount, playSound: boolean }` where `alarm` ⇔ some row waited ≥
`REVIEW_ALARM_MS = 20_000`; `playSound` ⇔ alarm and not muted. Rows with an unparseable
`submittedAt` never alarm (fail quiet on bad data, the same rule as the wait label). Plus
`reviewRowTone(waitedMs)` → `'fresh' | 'amber' (≥20 s) | 'red' (≥60 s)`.

### D2: a 1 s ticker drives it, the sound repeats every 20 s

A `useNow(1000)` tick recomputes the verdict; the page plays `playUrgent()` (a new louder,
longer cue, distinct from the SOS two-tone) when the verdict turns `alarm` and then every 20 s
while it stays `alarm` and unmuted. The ticker exists only while at least one row is pending.

### D3: every place the organizer might be looking

- Banner component `ReviewAlarmBanner` rendered in the pinned zone (above every section), with
  "open" (switches to the moderation section and scrolls to that row) and "mute 5 min".
- `document.title` = `(N) ⏳ …` while alarmed, restored after.
- `Notification` when `document.hidden` and permission granted; asked for once from the sound
  control, never on load.

### D4: sound state is visible

`audioState()` in `sound.ts` returns `'locked' | 'running' | 'unavailable'`; the header shows the
enable control while `locked`. Any click on the page also unlocks (existing behaviour) and the
control disappears.

## Test strategy

- **Pure** (`scripts/test-review-wait-alarm.ts`): 19.9 s none / 20 s alarm; oldest chosen; mute
  window; bad timestamps never alarm; tone thresholds 20 s / 60 s; empty queue none.
- **UI** (preview): seed a pending submission in the emulator, wait 20 s: banner, amber row, tab
  title; mute; open. Sound control shows before the first click. `npm run i18n:check:strict`.
