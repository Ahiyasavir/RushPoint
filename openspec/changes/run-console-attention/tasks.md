## 1. RED — failing tests first

- [x] 1.1 Create `apps/creator-web/src/lib/__tests__/teamAttention.test.ts` (vitest, in the house style
      of the sibling tests in that folder) importing `classifyTeamAttention`, `buildAttentionContext`,
      `countTeamsNeedingAttention` and the threshold constants from `../teamAttention`. Fixtures only:
      `nowMs` injected, no `Date.now()`, no I/O.
- [x] 1.2 Encode the suppression cases: finished team with hours-old timestamps; unlaunched team;
      team launched inside `START_GRACE_MS` with a deliberately stale `updatedAt`. All ⇒ `ok`, empty
      reasons.
- [x] 1.3 Encode the healthy case: launched long ago, active 4 min ago, GPS 1 min ago, no lockout ⇒
      `ok`.
- [x] 1.4 Encode the idle cases: median 3 min + idle 30 min ⇒ `stuck`/`idle`; median 20 min + idle
      30 min ⇒ `ok`; idle just under and just over each floor; median above `IDLE_HARD_STUCK_MS`
      suppresses the hard ceiling.
- [x] 1.5 Encode the out-of-bounds case: `outOfBounds: true` on an otherwise perfect row ⇒ `stuck` with
      `outOfBounds`.
- [x] 1.6 Encode the lockout cases: 30 s remaining ⇒ `ok`; 6 min ⇒ `watch`/`answerLockout`; 12 min ⇒
      `stuck`; expired lockout in the past ⇒ `ok`; `NaN` lockout ⇒ `ok`.
- [x] 1.7 Encode the location cases: GPS 20 min old + active ⇒ `watch`/`gpsSilent`; GPS 40 min old +
      idle 30 min ⇒ `stuck` with both `gpsSilent` and `idle`; `lastLocationAt` `undefined` and `null` ⇒
      no location reason.
- [x] 1.8 Encode `pendingReviews`: alone on a healthy row ⇒ `ok`; on an already-flagged row ⇒
      `awaitingReview` appended, level unchanged.
- [x] 1.9 Encode the malformed-input cases: `updatedAt` absent / `''` / `'not-a-date'`; `startedAt`
      garbage; `Infinity` and negative numbers ⇒ `ok`, no throw.
- [x] 1.10 Encode clock skew: every timestamp in the browser's future ⇒ `ok`, and assert no derived
      duration is negative by asserting the level rather than internals.
- [x] 1.11 Encode `buildAttentionContext`: skips finished / unlaunched / unparsable rows; `null` below
      `MIN_TEAMS_FOR_MEDIAN`; correct median for odd and even active counts.
- [x] 1.12 Encode the totality invariant over a matrix of every field × {present, absent, `NaN`,
      negative, `Infinity`}: never throws, `level` in the known set, `reasons` a subset of the known
      set, and `reasons.length === 0` iff `level === 'ok'`.
- [x] 1.13 Encode `countTeamsNeedingAttention` over a mixed table and assert it equals the count of
      per-row non-`ok` classifications.
- [x] 1.14 Run `npx vitest run --root apps/creator-web src/lib/__tests__/teamAttention.test.ts` and
      confirm it FAILS because `../teamAttention` does not exist. Record the failure verbatim.

## 2. GREEN — the pure classifier

- [x] 2.1 Create `apps/creator-web/src/lib/teamAttention.ts` with the types (`AttentionTeam`,
      `AttentionLevel`, `AttentionReason`, `TeamAttention`, `AttentionContext`) and the named threshold
      constants from design D3. No imports beyond types.
- [x] 2.2 Implement the single duration helper: `null` for missing / empty / unparsable / non-finite
      timestamps, negatives clamped to `0`. Every other rule goes through it.
- [x] 2.3 Implement `buildAttentionContext` (median idle over active rows, `null` below
      `MIN_TEAMS_FOR_MEDIAN`).
- [x] 2.4 Implement `classifyTeamAttention` with the D2 precedence: suppression gates, reason
      collection, level = max candidate, `awaitingReview` appended only to an already-flagged row,
      reasons emitted in fixed severity order.
- [x] 2.5 Implement `countTeamsNeedingAttention`.
- [x] 2.6 Re-run the vitest file and confirm GREEN.

## 3. GREEN — server projection

- [x] 3.1 In `functions/src/runs/index.ts` `listRunTeams`, after the existing owner gate, read the run's
      `teamLocations` collection once and build a `teamId → updatedAt` map. Best-effort: a failed read
      degrades to an empty map, never to a failed call.
- [x] 3.2 Add `updatedAt`, `answerLockoutUntil` (max finite `answerPenalties[*].cooldownUntil`, or
      `null`) and `lastLocationAt` to the projected row. No new parameters, no writes, no change to the
      auth gate.
- [x] 3.3 Mirror the three optional fields onto `RunTeamRow` in
      `apps/creator-web/src/services/calls.ts` with doc comments naming their source.

## 4. GREEN — run console surface

- [x] 4.1 Add the HE and EN `runConsole` copy: `attentionCount`, `attentionStuck`, `attentionWatch`,
      and one label per reason. Natural Hebrew, no em-dashes. Re-read `apps/creator-web/src/i18n.ts`
      immediately before editing (another lane is adding keys to it) and keep the edit additive.
- [x] 4.2 In `RunConsolePage.tsx`, build the context once per render from the loaded rows and classify
      each row. Add the header count when it is greater than zero.
- [x] 4.3 Render one `Badge` per flagged row (`red` for `stuck`, `gold` for `watch`) with the joined
      reason labels, suppressed when `outOfBounds` is the only reason so the existing line and rescue
      button are not duplicated. Existing primitives, static Tailwind, logical spacing classes.

## 5. REFACTOR & gates

- [x] 5.1 Re-read every shared file touched (`i18n.ts`, `calls.ts`, `runs/index.ts`) and confirm the
      edits are purely additive and nothing from another lane was reverted.
- [x] 5.2 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`. All green.
- [x] 5.3 Run `npx openspec validate run-console-attention --strict`.
- [x] 5.4 Record in the change report: the e2e assertions from the design that were NOT added (that file
      is owned by another lane), and that the UI was not exercised in a browser because a live playtest
      stack is serving from this tree.
