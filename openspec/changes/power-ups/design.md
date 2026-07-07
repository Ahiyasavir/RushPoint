# Design — power-ups

## Data model

**`Game.powerUpsEnabled?: boolean`** (packages/shared/src/types/index.ts) — default
false; `updateGame` (functions/src/games/index.ts) destructures + persists it exactly
like `allowInstantPlay`.

**`RunTeam.powerUps?`**:
```ts
export type PowerUpType = 'double_points' | 'bonus_points';
export interface PowerUpLogEntry {
  taskId: string;          // the completion that triggered the roll
  type: PowerUpType;
  awardedAt: string;
  // bonus_points: the flat amount; double_points (on consumption): the extra points
  amount?: number;
  consumedByTaskId?: string; // double_points only, set when the ×2 fires
}
export interface TeamPowerUps {
  active?: 'double_points'; // single armed slot; absent = nothing armed
  log: PowerUpLogEntry[];
}
```
Server-write-only (rides the team doc — rules already deny client writes). Not
secret: it is the caller's own team state, returned by `getMyTeamState`.

## Pure roll (packages/shared/src/powerUps.ts)

```ts
export const POWER_UP_RATE = 25;   // percent
export const POWER_UP_BONUS = 15;  // flat points for bonus_points

// FNV-1a 32-bit over `${runId}:${teamId}:${taskId}` — dependency-free, stable.
export function powerUpHash(runId: string, teamId: string, taskId: string): number;

// null = no award. Deterministic: same inputs ⇒ same output, forever.
export function rollPowerUp(runId: string, teamId: string, taskId: string): PowerUpType | null;
//   award  iff hash % 100 < POWER_UP_RATE
//   type = (hash >>> 8) % 2 === 0 ? 'double_points' : 'bonus_points'
```
Determinism is the idempotency story: a retried/replayed completion recomputes the
identical roll, and the existing `if (taskRec.status === 'completed') return` guard
in `completeTaskForTeam` means the award block is never even reached twice.

## Server enforcement — completeTaskForTeam (functions/src/runs/index.ts)

All inside the **existing** `db.runTransaction` (repo lesson: never ADD a
transaction to this hot path — we add ~15 lines to the one already there; the game
doc and `runId` are already in scope, zero extra reads):

Order of operations after `earnedScore` (and the hot-zone multiplier) is computed:

1. **Consume** an armed double: if `team.powerUps?.active === 'double_points'` and
   `earnedScore > 0`:
   `const preDouble = earnedScore; earnedScore *= 2;` extend `scoreBreakdown` with
   `{ powerUpMultiplier: 2 }` (alongside the hot-zone field — both can apply; hot
   zone first, then ×2), append `consumedByTaskId`/`amount: preDouble` to the
   matching log entry, clear `active`. If `earnedScore === 0` the double stays armed
   (it must not be burned on a zero-point task).
2. **Roll** for the just-completed task: only when
   `game.powerUpsEnabled === true && game.scoringPreset !== 'time_only'`:
   `const won = rollPowerUp(runId, teamId, taskId)`.
   - `bonus_points` ⇒ `bonusPenalty = (team.bonusPenalty ?? 0) - POWER_UP_BONUS`
     (bonusPenalty is SUBTRACTED from score — a bonus is a decrement; identical sign
     convention to `adjustTeamScore` (`np = p - delta`) and the zone-capture bonus).
     Include `bonusPenalty` in the same `tx.update`.
   - `double_points` ⇒ if no `active` slot, arm it; if a double is ALREADY armed,
     convert this award to `bonus_points` (+15) instead — single slot, still fully
     deterministic. Append a log entry either way.
3. The existing `tx.update` gains `powerUps` (full object rewrite — the `log` array
   is always written whole, never a dotted array-element update) and, when awarded,
   `bonusPenalty`.

`taskRec.earnedScore`, stage `earnedScore` roll-up, and `newScore = score +
earnedScore` all flow the DOUBLED value, so the e2e leaderboard-invariant oracle
(Σ task earned == stage earned == team score) holds by construction. The flat bonus
flows through `bonusPenalty`, which `buildRankings` already applies via
`applyPenalties` for both live and final boards — no drift, no `buildRankings` edit.

`skipStage` and flash-mission paths are untouched (no roll). `getMyTeamState`
already returns team fields — ensure `powerUps` passes any team sanitizer (own-team
state, not secret).

## UI

- **creator-web Builder** (`BuilderPage.tsx`): "Power-ups" settings checkbox
  (default off) + one-line hint ("~25% chance per completed task: ×2 next task or
  +15"); persists through the existing save payload. `t.*` EN+HE.
- **play-web** (`PlayScreen.tsx`): derive from polled `getMyTeamState`:
  - **Toast** when `powerUps.log.length` grows (compare previous length in a ref):
    "⚡ Power-up! Next task ×2" / "🎁 +15 bonus points".
  - **Chip** near the score while `powerUps.active === 'double_points'`:
    "×2 armed". Static Tailwind classes; `t.*` EN+HE.

## Test strategy

- **Pure (TDD RED→GREEN):** `functions/src/__property__/powerUps.property.test.ts`
  (vitest, runs under `npm test`):
  - **Pinned known vectors** — ~6 literal `(runId, teamId, taskId) → expected`
    triples. This is the anti-drift contract: the e2e script embeds a copy of the
    6-line FNV roll, and these vectors guarantee shared + e2e copies can never
    diverge silently (sanitizer-allowlist pattern).
  - **Determinism** — 1 000 seeded-random triples, `rollPowerUp` twice ⇒ identical.
  - **Rate** — over a 20 000-triple corpus the award rate is within 25% ± 2pts, and
    both types occur with roughly equal frequency among awards.
  - **Input sensitivity** — changing any one of runId/teamId/taskId changes the hash.
- **Callable (e2e):** new `power-ups` scenario in `scripts/e2e-verify.mjs`:
  1. Create a game with `powerUpsEnabled: true`, `fixed_points_speed`, one stage of
     ~12 client-chosen task ids; launch + join (run id + team uid now known).
  2. Locally recompute `rollPowerUp` for every task (embedded FNV copy, pinned by
     the vitest vectors) → the exact expected award sequence.
  3. Complete all tasks; assert: `powerUps.log` matches the prediction exactly;
     each `bonus_points` decremented `bonusPenalty` by 15; each consumed
     `double_points` doubled exactly the NEXT >0-point task's `earnedScore`
     (breakdown shows `powerUpMultiplier: 2`) and cleared `active`; a re-submitted
     duplicate completion changes nothing (idempotence).
  4. `refreshLeaderboard` + the existing invariant oracle stay green (Σ earned ==
     score; bonus reflected identically live and after `finalizeRun`).
  5. Control game with `powerUpsEnabled` absent ⇒ `powerUps` never appears; a
     `time_only` game with the flag on ⇒ no rolls.
  No new callable ⇒ coverage-guard list unchanged.
- **UI:** preview toast + chip (force with a known-awarding task id);
  `npm run i18n:check` clean.

## Footguns respected
- Zero added transactions/reads in the hot path — logic rides the existing txn and
  already-fetched game/run docs.
- `powerUps.log` always rewritten as a whole array inside a real nested object.
- Scoring changes ONLY via `earnedScore`-at-award-time and `bonusPenalty` —
  `buildRankings` untouched, live/final parity preserved.
- `Math.random` never used — the roll must stay reproducible for tests and replays.
