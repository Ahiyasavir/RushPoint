## Context

Three defects from run `ijI9JMITSf8C9heN1Cwp` (2026-09-10), grouped because each is a
surface that never received a capability the platform already has. See `proposal.md`
for the evidence; this document is about how to close them without inventing anything.

Current state, stated precisely because it constrains all three:

- **The SOS cue exists and is correct.** `RunConsolePage.tsx:186-217` holds a
  `useRef<Set<string> | null>` of seen alert ids, baselines it to `null` so the first
  snapshot never cues, and calls `playAlert()` only when a snapshot introduces an id
  the previous one did not have. That shape is the thing to reuse — not the call.
- **The review queue reads from a different listener** (`RunConsolePage.tsx:374`),
  over the whole `teams` collection, feeding `buildSubmissionQueues(teamDocs)`. It has
  no cue and no seen-set. `StaffConsole` (play-web) imports no sound module at all,
  though play-web *has* `lib/sound.ts`.
- **`apps/play-web/src/lib/scoreReasons.ts` is complete and framework-free.** Preset
  ids split by sign, `reasonsForDelta`, `resolveReason` (free text trimmed to 200),
  `parseAdjustAmount` (rejects empty / non-integer / zero / >10 000). It is already
  wired into `StaffConsole.tsx:614-782`. `RunConsolePage.tsx:919` sends the literal
  `'manual'` and has its own `parseScoreDelta`.
- **`skipTaskForTeam` writes `earnedScore = 0`** (`functions/src/runs/index.ts:1635`)
  behind a comment that argues the case for it, while `skipStage` pays
  `skipAward(game.scoringPreset, gameTask)` (`:1465`). `skipAward` is already total
  and already guards a non-finite `pointValue`.

## Goals / Non-Goals

**Goals**

- A submission arriving in the pending review queue cues audibly in both consoles,
  with no cue on first paint and none on a refresh.
- An organizer's manual adjustment carries a reason chosen from the same vocabulary
  the staff console uses, in a form the audit trail can be read back from in either
  language.
- One definition of that vocabulary, reachable by both apps.
- A single-mission skip pays the same consolation a stage skip pays.

**Non-Goals**

- Everything in `proposal.md` § Non-goals. In particular no other scoring term moves,
  and this does not attempt to make manual awards unnecessary.

## Decisions

### D1 — `scoreReasons` moves to `packages/shared`, it is not copied

`apps/play-web/src/lib/scoreReasons.ts` → `packages/shared/src/scoreReasons.ts`,
re-exported from the barrel, with play-web's import repointed.

**Why moved rather than duplicated:** the ids are a *wire vocabulary*. They are
written into `auditLogs` by the server and read back by an organizer possibly in the
other language; two copies that drift produce audit rows nobody can group. CLAUDE.md
already records this exact failure for the i18n leak predicate ("lives in exactly ONE
place… fix the rule there, never in a checker") and for the upload origin
(`test-upload-origin-parity.ts`).

**Why not a copy in creator-web:** the repo has a deliberate duplication policy for
`lazyWithRetry` and `mapRtl` — both because `packages/shared` is framework-free and
those need React / a map engine. `scoreReasons` needs neither. It is pure TypeScript
with no dependency, which is exactly what `packages/shared` is for.

**The labels do NOT move.** `t.staff.reasonCreativity` is a display string and stays
per-app in each `i18n.ts`; creator-web gains its own Hebrew and English values. The id
is shared, the wording is local — the same split `scoreReasons.ts`'s own header
argues for.

### D2 — The arrival cue is a pure "what is new here" function, not a `useEffect`

New pure module `apps/creator-web/src/lib/reviewQueueCue.ts`:

```
newPendingKeys(previous: ReadonlySet<string> | null, current: Iterable<string>)
  → { keys: string[]; shouldCue: boolean }
```

- `previous === null` ⇒ **baseline**: `shouldCue: false` however many rows arrived.
  This is the whole defect the SOS listener already avoids, and the reason to have a
  function rather than an inline diff: it is the part that is easy to get wrong and
  impossible to see in a screenshot.
- `shouldCue` is true only when `current` introduces a key `previous` lacks. A key
  *leaving* (reviewed) never cues.
- Total: a null/undefined/non-iterable `current` yields `{ keys: [], shouldCue: false }`
  — a cue is a nicety, and a defect in it must never break the queue that renders
  beside it.

**The key is `teamId + taskId`, not a document id**, because a submission is a field
inside the team document (`taskSubmissions`), not a document of its own — so there is
no id to diff. `buildSubmissionQueues` already produces both.

**Why a shared module is NOT used here:** this is creator-web-only state. play-web's
staff console gets the same function through its own copy at the same path — the
deliberate duplication policy — *no*: on reflection it does not, see D3.

### D3 — play-web's staff console reuses the shared function, not a copy

`newPendingKeys` is pure TypeScript with no React and no DOM, so it belongs in
`packages/shared/src/reviewQueueCue.ts` and both consoles import it. The duplication
precedent in CLAUDE.md (`lazyWithRetry`, `mapRtl`) exists *only* because those need a
framework `packages/shared` deliberately does not depend on. Neither of the two
modules this change adds does. Supersedes the aside in D2.

### D4 — The organizer's picker is the staff console's picker, rendered by creator-web

No new component abstraction across apps. `RunConsolePage` renders its own controls
using the shared ids and its own `t.*`, and replaces its local `parseScoreDelta` call
with `parseAdjustAmount` from shared so the two consoles agree on what is submittable.

**`reason` stays optional.** `resolveReason(null, '')` returns `''` and the callable
treats it as absent. A marshal correcting a score mid-event must never be blocked by
an empty text box — `scoreReasons.ts`'s header already commits to this and the Builder
readiness work records the same rule ("prefer an answering button to a disabled one").

**REVISED WHILE APPLYING — the two parsers must NOT be unified here.** This design
originally said `RunConsolePage` should drop its `parseScoreDelta` for shared's
`parseAdjustAmount` "so the two consoles agree". Applying it revealed that they are
not interchangeable and the creator's is the more field-tested one:
`parseScoreDelta` (`apps/creator-web/src/lib/scoreAdjustment.ts`) normalises the four
dash characters a Hebrew or typographic keyboard emits — a Unicode minus is what an
organizer's phone actually produces — accepts a leading `+`, rounds a decimal, and
caps at 100 000. `parseAdjustAmount` rejects all three and caps at 10 000. Swapping
would have made a live console start refusing input it accepts today, for tidiness.
The console keeps `parseScoreDelta`; unifying them is now Open Question 3, to be
decided on which behaviour is right for BOTH consoles rather than by which module
happened to move.

**The confirm dialog keeps naming the action.** `dialog.confirm(message, title, danger)`
— CLAUDE.md records that the second argument used to land on the BUTTON and every run
action offered a button reading "Before you go ahead"; the current call passes
`rc.adjustScoreConfirmTitle` and must keep doing so.

### D5 — `skipTaskForTeam` pays `skipAward`, and the header comment is rewritten, not deleted

The existing comment is a real argument that was tested in the field and lost. It gets
replaced with what actually happened, so the next reader does not re-derive the
original position from first principles.

**Retroactivity: none, and it is structural rather than a choice.** `earnedScore` is
stamped onto the `RunTaskRecord` at the moment of the skip, and `buildRankings` sums
stored records — CLAUDE.md's live/final parity rule ("a pure function of the STORED
team document… never re-derived from the current template"). A finished run therefore
cannot move, and a run in flight keeps whatever its already-skipped tasks were stamped
with. Nothing needs a migration or a flag.

**`skipAward` is already safe for this call site**: `time_only` → 0 (a time-ranked
game has no points to award, which is correct), `fixed_points_speed` →
`max(0, pointValue)` guarding a non-finite value, `smart_weighted` → the on-target
sigmoid score. It is the same function `skipStage` passes the same shaped task to.

## Test Strategy

Stated up front. **Every defect gets a failing test before its fix.**

**Pure lane — `npm test`:**

- `scripts/test-review-queue-cue.ts` (new) — `newPendingKeys`:
  - first snapshot with N rows ⇒ `shouldCue: false` ← **RED today**
  - a snapshot introducing a key ⇒ `shouldCue: true`, and `keys` names only the new one
  - an unchanged snapshot ⇒ false; a key disappearing ⇒ false
  - a key disappearing AND another arriving ⇒ true
  - null / undefined / non-iterable / an iterable yielding non-strings ⇒
    `{keys: [], shouldCue: false}`, never throws
  - a seeded sweep asserting `keys ⊆ current` and `keys ∩ previous = ∅`
- `scripts/test-score-reasons-shared.ts` (new) — a **parity guard** in the shape of
  `test-upload-origin-parity.ts`: every id exported by
  `packages/shared/src/scoreReasons.ts` has a label in **both** language maps of
  **both** apps' `i18n.ts`, and no app declares an id shared does not export. This is
  the assertion that makes D1's "one vocabulary" claim enforceable rather than
  aspirational.
- The existing `scripts/test-skip-single-task.ts` gains: under `smart_weighted` a
  skipped task's award equals `skipAward(preset, task)` and is > 0; under `time_only`
  it is 0; under `fixed_points_speed` it is the task's `pointValue`. ← **RED today**
  (the award is not the planner's output — see the risk below).

**e2e lane — `npm run e2e`:**

- The existing skip scenario asserts the skipped record's `earnedScore` equals the
  preset's `skipAward` rather than 0, and that the team's total moved by exactly that.
  ← **RED today**
- `adjustTeamScore` with a preset reason id writes that id into the audit record;
  with no reason it still succeeds. (The callable already supports this; the assertion
  pins that the console's new payload shape is accepted.)

**UI lane** — no component runner exists, so: preview-based verification that the cue
fires on a new submission and is silent on refresh, plus
`npm run i18n:check:strict` clean with zero new PART B findings, plus
`scripts/test-creator-tap-targets.ts` for any new glyph-only control.

## Risks / Trade-offs

- **[`planTaskSkip` does not decide the award, and must not start to]** → the award is
  applied in `functions/src/runs/index.ts` from `skipAward(game.scoringPreset, …)`,
  because the preset lives on the game and the planner is a pure stage-arithmetic
  helper with no scoring knowledge. So the pure test extends `test-skip-single-task.ts`
  with a direct `skipAward` assertion, and the *wiring* is proven by e2e. Do not push
  the preset into `planTaskSkip` to make the pure test prettier.
- **[A cue that fires on every re-render would be worse than none]** → the baseline is
  `null`-then-set, identical to the SOS listener, and the diff is a pure function with
  its own suite. The listener also re-subscribes on `runLive` changing, so the ref must
  be reset deliberately, not incidentally.
- **[Moving `scoreReasons` could break the staff console silently]** → it is a move
  plus a repointed import; `npm run typecheck` catches a missed reference, and the new
  parity guard catches a label that stopped resolving.
- **[The audit trail changes shape for future adjustments]** → from the literal
  `'manual'` to an id or free text. Nothing reads `reason` programmatically today
  (`listAuditLogs` renders it), so this is additive to a human-read field.
- **[Two deploy targets]** → the `skipAward` line rides the callables bundle to the
  VPS; the UI rides `deploy:hosting`. They are independent and safe in either order.

## Migration Plan

1. Land the change; `npm run verify` and `npm run e2e` green.
2. Ship the UI (`deploy:hosting`) — safe alone: the reason picker degrades to sending
   `''`, which the callable already accepts.
3. Ship the API (VPS rebuild) for the `skipAward` line. Expect the ~40 s `503` window;
   not mid-event.
4. Verify: skip one mission for one team in a test-drive run under `smart_weighted`
   and confirm the record's `earnedScore` is the on-target value, not 0.

**Rollback:** revert. No stored shape changed, and already-stamped `earnedScore`
values stay whatever they were — which is the point of D5.

## Open Questions

1. **Should the arrival cue be suppressible?** An organizer running a 100-team event
   may want it off. Not built here — a preference with no UI is worse than a cue with
   no preference, and nobody has asked yet.
2. **Which score parser is right?** The two consoles disagree about `+50`, a Unicode
   minus, `10.6` and the ceiling (100 000 vs 10 000) — see the revision in D4. The
   creator's is more forgiving and matches what a Hebrew keyboard emits; the staff
   console's is stricter and drives a disabled Confirm. Deliberately NOT resolved by
   this change, because resolving it means changing one console's live behaviour and
   that deserves its own decision rather than riding along with a reason picker.
3. **Should `reason` become required above some magnitude?** A +500 that decides a
   winner arguably should say why. Deliberately not decided here; making it *possible*
   is the prerequisite for ever making it *required*.
