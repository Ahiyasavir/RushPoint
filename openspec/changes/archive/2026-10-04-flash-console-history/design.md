## Decisions

### D1. One pure split
`splitFlashes(flashes, claimsByFlash, now)` returns `{ current, past }`, both in the input
order (newest first, as `useRecentFlashMissions` delivers). Pure and total, so the rule is
testable and the panel only renders.

### D2. What keeps a flash current
- `flashMissionState` is `open` or `taken`: it is running.
- Any claim is `submitted`: a team waits on the organizer. Never fold this away, however old.
- It ended (`endedAt`, else `expiresAt`) less than 15 minutes ago and no claim is `approved`:
  the organizer may still award it by hand (the announcement-only case, "first to the gate").

### D3. Past is a summary, not a control panel
A past flash shows its title and its winners (claims `approved`), or "nobody". The award picker
stays only on current flashes: awarding a flash from long ago is rare, and the picker on every
past flash is what made the panel grow. If an organizer must award an old flash, the score
adjustment on the team does the same thing.

### D4. Folded by default
A native `<details>` with a counted summary: keyboard and screen-reader friendly, no state.

## Risks
- An organizer who wanted to award a flash 20 minutes after it ended uses the team score
  adjustment instead. Acceptable, and named in the past line's hint.
