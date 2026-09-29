# Tasks: review-wait-alarm

Source: `docs/field-report-2026-09-27.md` item 14. Extends `live-ops-feedback-loop`.

## 1. RED
- [x] 1.1 `scripts/test-review-wait-alarm.ts` against `reviewWaitAlarm` / `reviewRowTone`. Confirm RED.

## 2. GREEN
- [x] 2.1 `reviewQueueCue.ts`: `REVIEW_ALARM_MS`, `reviewWaitAlarm`, `reviewRowTone`. 1.1 → green.
- [x] 2.2 creator-web `sound.ts`: `playUrgent()`, `audioState()`; header sound control.
- [x] 2.3 creator-web: `useNow`, `ReviewAlarmBanner` (pinned), row tones, tab title, notification,
      mute; i18n he/en.
- [x] 2.4 play-web staff console: same verdict, banner and sound.

## 3. Verify
- [x] 3.1 Preview with a seeded pending submission (20 s, 60 s, mute, approve clears).
- [ ] 3.2 `npm run verify`, exit code to a file.

## Progress (2026-09-28)

Console implemented and verified in the browser (banner, tab title, mute, clears on approve). Staff console done too (banner pinned in the review section, row tones, urgent cue every 20 s, mute 5 min); browser-verified at 375x812 against a planted 30 s old submission: alarm, mute, clears when judged.
