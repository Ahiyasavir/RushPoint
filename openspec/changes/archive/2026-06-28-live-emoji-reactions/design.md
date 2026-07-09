# Design — Live emoji reactions

## Current behavior

- Live GPS / ephemeral data convention (Appendix A rule 8): high-frequency ephemeral data belongs in
  **RTDB**, never Firestore. The RTDB migration is Appendix B #2 (not yet built).
- Leaderboard + `?tv=` screen (the `tv-leaderboard` change) are the viewing surfaces.

## Approach

### Pure helper → `packages/shared/src`

```ts
shouldThrottleReaction(lastAtMs: number | null, nowMs: number, minGapMs = 500): boolean
  // true if a reaction was sent within minGapMs (caller suppresses it)
REACTION_EMOJI = ['❤️','🔥','😱','👏','🎉'] as const   // closed, safe set
```

Tested in `scripts/test-reaction-throttle.ts`: first reaction allowed; within-gap throttled;
after-gap allowed; null last → allowed.

### RTDB

Write `push('/runs/{runId}/reactions', { emoji, at })`; entries TTL-trimmed (a small capped list or
server timestamp + client-side window). Viewers `onChildAdded` → spawn a floating emoji that animates
up and removes itself. No Firestore involvement.

### UI

A reaction bar (the 5 emojis) on the leaderboard / TV screen; tapping respects
`shouldThrottleReaction`; incoming reactions float up with `prefers-reduced-motion` honored (fade
instead of motion).

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-reaction-throttle.ts`: throttle predicate cases.
- **UI (preview):** tapping an emoji floats it; rapid taps are throttled; reduced-motion fades.

## Conventions

- Ephemeral high-frequency → RTDB, never Firestore (rule 8). Depends on #2 (RTDB) for the backend.
- Closed emoji set (no free text → no moderation surface). `prefers-reduced-motion` respected.
