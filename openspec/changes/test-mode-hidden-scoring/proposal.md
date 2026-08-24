## Why

A creator running an **assessment** — a school quiz, a training check, a tryout — needs the
opposite of what RushPoint gives them today. The participant app is built to motivate: it shows a
live score, celebrates a correct answer, buzzes "לא מדויק" on a wrong one, charges points for
hints, and ranks everyone on a leaderboard. In a test that feedback is the problem. It tells a
player their answer was wrong (so they retry until they stumble onto the right one), it lets them
read their standing off the board, and it makes the whole exercise a race rather than a
measurement.

Today a creator has no way to turn any of that off, and the platform stores **no record of what a
participant actually answered** — only a hash of the last wrong attempt, used for duplicate
detection. So even after the run, the creator cannot grade. Test mode is the missing half of the
product: it seals the feedback loop from the player while opening the answer record to the creator.

## What Changes

- A new **Test mode** switch in the creator's game settings. Off by default; every existing game
  and every existing run behaves exactly as it does today.
- **A wrong answer no longer blocks.** With test mode on, submitting an answer always completes the
  task and routes the player onward. Retry lockouts, wrong-answer point penalties and paid-hint
  costs are all suppressed for the run — a player can never be stuck on, or charged for, a question
  whose verdict they are not allowed to see.
- **Adaptive difficulty switches signal.** Routing already steers a team toward tasks matching its
  measured strength, but strength is derived from *pace*. Once a wrong answer completes a task that
  signal inverts — a player who answers quickly and wrongly reads as strong and gets routed the
  hardest questions. In test mode, strength is derived from **accuracy** instead, so a struggling
  player is routed toward easier questions.
- **The participant payload is sealed at the server.** Score, per-task earned points, score
  breakdown, smart streak, the run leaderboard, and the "a wrong answer will cost you N" warning
  are omitted from `getMyTeamState`. `submitTaskAnswer` returns a neutral *recorded* verdict
  carrying no correctness. This is a payload change, not a UI change: hiding these client-side
  would leave them readable in devtools.
- **Submissions become gradable.** On a test-mode run the server records what the participant
  answered, and whether it was right, on the task record. Stripped from the participant payload;
  visible to the creator.
- **The run ends neutrally for the player** — a completion screen with no score, rank, leaderboard
  or share card.
- **The creator side does not change at all.** Scoring, ranking, `listRunTeams`,
  `getRunAnalytics`, `getRunSummary`, `getRunRecap`, `refreshLeaderboard`, `finalizeRun` and the
  Run Console keep working on a test-mode run exactly as on any other.

## Non-goals

- **No per-run override.** Test mode is a property of the game, set once in its settings. Launching
  a test-mode game as a casual practice run is out of scope.
- **No grading UI.** This change makes submissions *available* (stored, server-side, owner-readable)
  but does not build a creator screen for reviewing them per participant. That is a follow-on.
- **No change to how answers are checked.** Correctness is still decided by the same server logic;
  only the verdict's visibility and its consequences change.
- **No new proctoring or anti-cheat.** Test mode hides feedback; it does not attempt to detect
  collusion, lock the device, or verify identity.
- **Not retroactive.** Runs already finished do not gain stored submissions.
- **Answer keys stay server-secret.** Nothing here relaxes `sanitizeTaskForParticipant`.

## Capabilities

### New Capabilities
- `test-mode`: A per-game assessment mode that seals every score and correctness signal from the
  participant (payload-level, not cosmetic), makes every answer advance, suppresses penalties and
  lockouts, routes on accuracy rather than pace, records each submission for the creator to grade,
  and ends the run on a neutral completion screen — while leaving the creator and staff views
  unchanged.

### Modified Capabilities
- `answer-submission`: `submitTaskAnswer`'s contract gains a test-mode branch — a wrong answer
  completes the task instead of being refused, the response omits correctness, the attempt limit
  and retry lockout do not apply, and the submission is recorded.

## Impact

**Surfaces touched:** shared types · a callable (`submitTaskAnswer`, plus the `getMyTeamState`
payload) · routing · creator-web · play-web. **No `firestore.rules` change** — the new record
fields live on the already server-write-only team document, which the owner can already read and
no participant can.

- `packages/shared` — `Game.testMode`; new `RunTaskRecord` fields for the recorded submission; a
  pure accuracy→strength helper for routing; a pure "what does this run seal?" predicate shared by
  both apps so the two can never drift.
- `functions/` — `submitTaskAnswer` (advance-always branch, neutral verdict, recording, penalty and
  attempt-limit suppression), `getMyTeamState` (payload sealing), `requestTaskHint` (no charge),
  `routing/assignNextTask.ts` (accuracy-derived strength).
- `apps/creator-web` — the settings switch, plus `BUILDER_EDITABLE_FIELDS` (a field missing from
  that list silently never saves).
- `apps/play-web` — score header, `TaskRunner` feedback and cost warnings, `LiveOps` leaderboard
  peek, `FinalScreen`, `CeremonyScreen`, `TvLeaderboard`, `RunRecap`, `PublicLeaderboardScreen`,
  and the `storyCard` / `podiumCard` share images.
- **Callable contract change ⇒ e2e coverage.** `scripts/e2e-verify.mjs` needs a test-mode scenario,
  and its sanitizer allowlist must learn the new field names or the suite fails loud — which is the
  intended behaviour, since an un-allowlisted field is exactly how a stored answer would leak to
  the device.
- **i18n** — new copy in both dictionaries of both apps; `npm run i18n:check:strict` must stay clean.
