## Why

Ahiya, 2026-10-02: the mission timer should be shown to players live, in a cool way that gets them
into a frenzy and into action.

Today a mission with a time limit (`Task.timeLimitMinutes`, change: mission-time-limit) shows a small
grey pill, "⏱️ נשאר 4:32" (`TimeLimitCountdown` in `apps/play-web/src/components/TaskRunner.tsx`), that
turns red only in the last minute. Nothing in it says how much of the time is already gone, nothing
builds tension, and nothing happens at the moments that matter (half time, the last minute, the last
seconds). A countdown is the one place in the product where pressure IS the fun.

## What Changes

- **A burning fuse replaces the pill.** A fixed-height strip at the top of the mission: big tabular
  digits, a short phase label, and a bar that drains as time runs out, with a glowing spark at its tip.
- **Four phases, decided by a pure function of time left and total time:**
  calm (green, "הזמן שלכם"), hurry from half time (amber, "תזדרזו!"), critical in the final stretch
  (red, heartbeat pulse, "רגעים אחרונים!"), final 10 seconds (the digits pop every second, "עכשיו!").
  Time up keeps today's notice, with a single shake.
- **Moments, not noise.** Crossing half time, the critical line and the final 10 seconds each fires once:
  a haptic and a sound cue (new cues `hurry`, `tick`, `timeUp`), and a screen-reader announcement. The
  final 10 seconds tick once per second. All of it obeys the existing sound/haptic mute, and with
  `prefers-reduced-motion` only colour changes.
- **It never gets in the way.** Fixed height (no layout jump while ticking), never an overlay, never
  covering the answer field or the SOS button.
- No server change: the phone already receives `activeTaskTimeLeftMs` and the task's `timeLimitMinutes`.

## Capabilities

### New Capabilities
- `mission-countdown-fuse`: how a player sees and feels a mission's time limit.

## Impact

- `apps/play-web/src/lib/timeLimitCountdown.ts` (pure phase / fraction / milestone logic) and
  `scripts/test-time-limit-countdown.ts`.
- `apps/play-web/src/lib/sound.ts` (+3 cues) and `scripts/test-sound.ts`.
- `apps/play-web/src/components/TaskRunner.tsx` (`TimeLimitCountdown` → the fuse), `index.css`
  (keyframes), `i18n.ts` (HE/EN phase labels and announcements).
- No callable, rule or data change.
