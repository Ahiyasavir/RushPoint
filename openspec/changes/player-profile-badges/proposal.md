## Why

Every participant today is an anonymous, single-run team — nothing they do persists once
the run ends. A lightweight cross-run **player profile** that accumulates lifetime stats and
earns **badges** ("First Finish", "Photographer", "Speed Demon", "Streak Master") gives
players a reason to come back and play more RushPoint games — the retention meta-layer that
Munzee/Pokémon GO build their long-term engagement on.

## What Changes

- A durable **`players/{uid}`** profile doc (the anonymous Firebase Auth uid stays stable per
  device, so it naturally accumulates across runs on that device). Written ONLY by a callable
  at run finish — never a client write.
- On a team finishing, a new **`recordPlayerResult`** step (called from the finish flow /
  `finalizeRun` fan-out) updates the player's lifetime aggregates (games played, tasks done,
  best rank, total points, longest streak) and **awards badges** via a pure, unit-tested
  rule set (`evaluateBadges`).
- A play-web **Profile** screen shows the player's badges + lifetime stats; the Final screen
  surfaces any newly-earned badge with a celebratory reveal.

## Capabilities

### New Capabilities
- `player-profile-badges`: a server-written `players/{uid}` profile with lifetime stats and a
  pure badge-award rule set, plus a profile screen and a new-badge reveal on finish.

## Non-goals
- **No account system / login** in v1 — identity is the existing anonymous uid (persists per
  device/browser). Optional account-linking to carry a profile across devices is a later change.
- No cross-run leaderboards/clans (a bigger social layer; profile is the foundation for it).
- No PII beyond a self-chosen display name; the profile stores aggregates, not run PII, so it
  survives the 90-day run prune.

## Surfaces touched
- **shared:** `playerProfile.ts` (`PlayerProfile`, `Badge`, `evaluateBadges`, stat-merge —
  pure, unit-tested); `FIRESTORE_PATHS.player`.
- **functions:** `recordPlayerResult` (internal, called on finish) + `getMyProfile` callable
  (+ re-export); writes `players/{uid}` with Admin SDK.
- **rules:** `match /players/{uid}` — `read: if request.auth.uid == uid` (own profile),
  `write: if false` (CF-only).
- **play-web:** Profile screen + new-badge reveal on FinalScreen; `calls.ts` wrapper; i18n.
- **Tests:** `scripts/test-player-badges.ts` (badge thresholds, idempotent re-award, stat
  merge); e2e — finish a run, assert the profile + a badge is recorded; a stranger can't read
  another uid's profile (authz matrix). Consider a `players` composite index only if queried.
