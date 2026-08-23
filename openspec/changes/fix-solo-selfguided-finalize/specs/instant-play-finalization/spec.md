## ADDED Requirements

### Requirement: A solo self-guided run finalizes itself when its sole participant finishes

The server SHALL automatically finalize a run that has no organizer — one flagged `selfGuided` with a
single participant — the moment its only team reaches `status:'finished'`. Finalizing SHALL write a
published, frozen `leaderboard` computed by the SAME ranking logic (`buildRankings`) and the SAME run
write that the organizer-triggered `finalizeRun` performs, so the solo finisher receives a real rank,
podium, published board, and the badges recorded on finalize.

Because a self-guided run has no host to perform a staged reveal, the auto-finalized board SHALL be
published unconditionally (it SHALL NOT be withheld pending a manual reveal).

Auto-finalize SHALL be idempotent: once a run is finalized, a subsequent finish, re-completion, or
finalize attempt SHALL NOT recompute or overwrite the published board, and the badge/profile
consolidation that fires on the `status:'finished'` transition SHALL run at most once.

#### Scenario: A solo instant-play finisher gets a published final leaderboard

- **WHEN** the sole team of a `selfGuided`, single-participant run completes its final task and reaches `status:'finished'`
- **THEN** the run document carries a `leaderboard` that is `published` and `frozen`
- **AND** that leaderboard ranks the finisher at rank #1
- **AND** `getMyTeamState` returns the published `run.leaderboard` (not null), so the finish screen shows the rank, podium and board instead of a "waiting for the host" spinner

#### Scenario: The solo finisher's badges are recorded

- **WHEN** a solo self-guided run auto-finalizes
- **THEN** the run's `status:'finished'` transition fires the finalize trigger exactly as a manual finalize would
- **AND** the participant's cross-run player profile / badges are recorded once

#### Scenario: Auto-finalize is published even when the game opts into manual reveal

- **WHEN** a solo self-guided run auto-finalizes for a game whose template requests a manual leaderboard reveal
- **THEN** the board is published anyway, because there is no host to reveal it

#### Scenario: Re-finishing does not double-finalize

- **WHEN** an already-finalized solo run receives another completion or finalize attempt
- **THEN** the published board is not recomputed or overwritten
- **AND** the badge/profile consolidation does not run a second time

### Requirement: A normal organizer run is never auto-finalized

Auto-finalize SHALL apply ONLY to runs flagged `selfGuided` with a single participant. A run launched
by an organizer (not self-guided), or any run with more than one participant, SHALL NOT be
auto-finalized: it SHALL continue to wait for the organizer's explicit `finalizeRun`, and any staged
("withheld until reveal") leaderboard behavior SHALL remain unchanged.

#### Scenario: A multi-team organizer run still waits for manual finalize

- **WHEN** every team of a launched, non-self-guided run reaches `status:'finished'`
- **THEN** `run.leaderboard` remains null until the organizer calls `finalizeRun`
- **AND** the organizer's manual finalize and any staged-reveal gating behave exactly as before
