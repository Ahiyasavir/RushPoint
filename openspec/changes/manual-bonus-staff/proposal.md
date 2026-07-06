## Why

Staff running an event on their phones (the play-web Staff Console) can review photos,
acknowledge SOS, and broadcast announcements — but they cannot award or dock points.
Only the game owner's desktop RunConsole can, via the existing `adjustTeamScore` callable.
On-the-ground staff are exactly the people who witness a great effort or a rule break and
should be able to reward/penalize on the spot.

## What Changes

- The play-web **Staff Console** gains a **"Team scores"** panel listing every team with
  its live score and quick **+/− point** actions (−10 / −5 / +5 / +10), wired to the
  existing `adjustTeamScore` callable (positive delta = bonus, absorbed by `bonusPenalty`).
- Team rows come from the snapshot the console **already** opens over `.../teams` (for the
  photo-review queue) — no extra reads.
- A staff custom token already satisfies the server's `assertStaffOrOwner` gate, and the
  callable re-reads the team under the run path (IDOR-safe), so no backend change is needed.

## Capabilities

### Modified Capabilities
- `authorization`: (no rule change) — documents that `adjustTeamScore` is now exercised from
  the staff surface, not only the owner console. The gate is unchanged.

## Non-goals

- No new callable, shared type, index, or rules change — this is a play-web UI + typed
  wrapper gap over an already-tested callable.
- No free-text reason entry on mobile (reason is stamped `'staff'`); the owner console keeps
  its custom prompt.

## Surfaces touched
- **play-web:** `services/calls.ts` (new `adjustTeamScore` wrapper), `screens/StaffConsole.tsx`
  (Team scores panel), `i18n.ts` (new `t.staff.*` keys, EN + HE).
- **Tests:** e2e already covers `adjustTeamScore` (owner + authz matrix); add a staff-token
  adjust assertion. UI verified via preview + `npm run i18n:check`.
