## Context (verified 2026-10-02)

- The server sends `activeTaskTimeLeftMs`, a DURATION on its own clock; the phone counts it down from
  arrival (`countdownLeftMs`), re-anchoring on every poll. Never an absolute deadline against the phone
  clock (CLAUDE.md). At zero it refreshes so the server sweep can move the team on (kept as is).
- `timeLimitMinutes` reaches the phone (sanitizer allowlist, `functions/src/runs/sanitizeTask.ts`), so the
  TOTAL is known. A staff hold moves `startedAt` forward, so time left never exceeds the total; the
  fraction is still clamped.
- Feedback: `lib/sound.ts` (synthesized cues + paired haptic, one mute) and `lib/haptics.ts` (skips under
  reduced motion).
- The play screen is designed not to scroll (field report 2026-09-27) and the mission sheet must never
  cover SOS: a countdown may not grow or overlay.

## Decisions

### D1: phases are pure (`lib/timeLimitCountdown.ts`)
`countdownFraction(left, total)` → 0..1, or null when the total is unknown/invalid.
`countdownThresholds(total)` → `{ hurry: total/2, critical: min(60 s, total/4), final: min(10 s, total/4) }`
(so a 1 minute sprint does not start red; total unknown ⇒ hurry 2 min, critical 60 s, final 10 s).
`countdownPhase(left, total)` → `'up' | 'final' | 'critical' | 'hurry' | 'calm'` (`left <= 0` ⇒ up).
`countdownMilestone(prevLeft, left, total)` → the phase ENTERED by going from prevLeft to left
(`hurry` / `critical` / `final` / `up`), else null; only downward crossings count, so a re-anchor that
adds time back never re-fires a moment. All total, never throw.

### D2: the fuse
A strip `h-16`, full width, `role="timer"`: digits `text-2xl` (final: `text-3xl`, re-keyed per second
for a pop), label beside them, and under them a track `h-2.5` with a fill anchored at the inline start,
width = fraction (inline style, the only dynamic value), and a spark dot at the fill's tip. Colours:
calm `rp-go`, hurry `rp-amber`, critical/final `rp-alert`; text uses the ink tokens (contrast). Static
class strings per phase. Keyframes in `index.css`: `rp-spark` (flicker), `rp-heartbeat`, `rp-pop`,
`rp-shake`, switched off by the reduced-motion block in `index.css`.

### D3: moments
Entering hurry and entering critical each fire cue `hurry` (two quick rising notes, haptic `warn`);
every second inside final fires `tick` (a 50 ms click, haptic `tap`); time up fires `timeUp` (a falling
buzz, haptic `error`). All through `feedback()`, so the existing mute governs sound and vibration alike.
An `aria-live="polite"` sr-only line announces hurry, critical and final once each, never every second.

### D4: what stays
ExpiryCountdown (the absolute close) is untouched. The time-up notice text and the refresh at zero are
unchanged. `data-testid="time-limit-countdown"` / `"time-limit-up"` stay on the same elements.

## Test strategy

- Pure (RED first), `scripts/test-time-limit-countdown.ts`: thresholds for 1, 2, 5, 15 minutes and an
  unknown total; phase table; fraction clamping (left > total, junk); milestone crossings incl. a
  re-anchor upward (no fire), a jump across two lines (the deeper one wins), and `up` once.
- `scripts/test-sound.ts`: the three new cues have envelopes and haptics.
- Guards: `test-play-a11y-scan`, `test-brand-class-scan`, `test-touch-a11y`, i18n strict, bundle budget.
- Browser at 375x667: a 1 minute mission walked through every phase (height constant, no overflow, SOS
  visible), reduced motion on.
