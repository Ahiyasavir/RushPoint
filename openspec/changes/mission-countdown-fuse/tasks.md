# Tasks: mission-countdown-fuse

Source: Ahiya 2026-10-02 ("live and cool, a frenzy of action").

## 1. RED
- [x] 1.1 `scripts/test-time-limit-countdown.ts`: `countdownThresholds`, `countdownPhase`, `countdownFraction`,
      `countdownMilestone` per design D1. Confirm RED.
- [x] 1.2 `scripts/test-sound.ts`: cues `hurry`, `tick`, `timeUp` with envelopes and haptics. Confirm RED.

## 2. GREEN
- [x] 2.1 Pure logic in `apps/play-web/src/lib/timeLimitCountdown.ts`.
- [x] 2.2 Cues in `apps/play-web/src/lib/sound.ts`.
- [x] 2.3 `TimeLimitCountdown` → the fuse (D2), moments (D3); keyframes in `index.css`; HE/EN strings.

## 3. Verify
- [x] 3.1 Guards: play a11y scan, brand class scan, touch a11y, i18n strict, bundle budget.
- [ ] 3.2 Browser 375x667: every phase on a 1 minute mission; constant height; SOS visible; reduced motion.
      DONE: every phase in order, height 64px throughout, SOS untouched, no overflow, bar drains. NOT YET:
      reduced motion.
- [x] 3.3 `npm run verify` (exit code to a file).
