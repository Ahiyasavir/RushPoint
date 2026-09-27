# Proposal: mission-time-limit

Owner (2026-09-27): "add an option to limit a mission in time". Chosen: BOTH kinds, and when a
team's time runs out it moves on with no points.

- **Per team countdown** `Task.timeLimitMinutes`: from the moment THAT team gets the mission.
  Time up ⇒ skipped for that team (`skipCause: 'timeLimit'`, 0 points), routed on, told why. Judged
  at SUBMISSION: a photo sent in time and reviewed later still scores. 5 s grace for an answer in
  flight at the buzzer.
- **Clock window for everyone**: `releaseAt` gets a Builder editor (it had none), and a new
  absolute close `expiresAt` joins the existing relative `expiresAfterMinutes` (earlier wins).
