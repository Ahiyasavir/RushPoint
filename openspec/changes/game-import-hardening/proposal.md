## Why

`importGameFile` (change: `game-file-export-import`) reads a file the creator hands us. That file is
**untrusted input**: it is a plain JSON document that lives on the creator's disk, can be hand-edited,
can be mailed between creators, and can be produced by anything at all. The callable is the only
place a client can hand the server a whole `Game` shape in one payload.

`parseGameFile` already does a lot of the work — envelope + version, a 2 MiB byte cap, stage/task
counts, a 20 000-character string cap, an allow-listed key `pick()` at the game / stage / task /
`smart` levels, required ids and titles, task-type enum, coordinate validity, and the same pure
structural rules (`validateUnlockGraph`, `validateAvailabilityWindow`, `validateOrderItems`,
`validateSurveyChoices`) the Builder save path runs. Identity and authz smuggling are already
closed: `id`, `ownerUid`, `visibility`, `playCount`, `createdAt`/`updatedAt`, the trash tombstone and
the integration webhook are excluded from the exported key set, and the callable assigns them from
the authenticated caller after the parse. **Nothing in this change weakens or duplicates any of
that.**

What is *not* covered is the space **between** the allow-listed keys. `pick()` allow-lists key
*names* at four fixed levels; it does not look inside the values. Anything nested inside an
allow-listed value — `branding`, `scoringOptions`, `safeZone`, `registrationFields`, `media`,
`steps[]`, `answers[]`, `choices[]` — is cloned through to the Firestore write **unexamined**. Four
gaps were demonstrated against the shipped code (see design.md for the verbatim probe output):

1. **A non-array where a list is expected crashes the import with a 500.** A quiz task carrying
   `"answers": 5` passes `parseGameFile` cleanly, and then `taskCompletabilityError` inside
   `stagesProblems` throws `TypeError: task.answers.some is not a function`. The creator gets an
   opaque `internal` error instead of "this field is wrong"; the same value as `["a", 5]` throws on
   `a.trim`. Type confusion in a validator is exactly the class the sanitizer allowlist exists to
   stop elsewhere in this repo.
2. **Prototype-pollution key names survive anywhere below the four picked levels.** `__proto__`,
   `constructor` and `prototype` inside `task.media`, `steps[]`, `branding` or `scoringOptions` pass
   validation and are carried into the document that is written to Firestore. Field names that begin
   and end with `__` are reserved in Firestore, so the best case is another opaque write failure and
   the worst case is a key nobody audited reaching a merge/spread somewhere downstream.
3. **Numeric poison is silently coerced instead of refused.** `1e999` parses to `Infinity`; the
   `clone()` JSON round-trip then turns it into `null`, and `numericAnswer: null`,
   `geofenceRadiusMeters: null`, `hintPenalty: null`, `requiredTaskCount: null` are accepted. Only
   the numeric-answer case is caught downstream, by luck, by the completability guard. The rest are
   persisted as a game that behaves wrongly at run time rather than a file that was refused.
4. **Depth and per-array length are unbounded.** A 200 000-element `answers` array and a 50 000-step
   `sequence` are accepted (only the 2 MiB envelope bounds them), and a deeply nested value makes the
   recursive string-length walk throw `RangeError: Maximum call stack size exceeded` — breaking
   `parseGameFile`'s documented "NEVER throws" contract, which the Builder's client-side pre-check
   relies on.

The failure mode of all four is the same and it is the one this family of changes exists to prevent:
**a bad file produces a confusing runtime failure instead of a clean, actionable refusal.**

## What Changes

**Every value in an imported document is examined, not just the allow-listed key names.**
- One iterative (never recursive) pre-scan walks the whole candidate game graph *before* any clone,
  normalization or write, and reports every problem it finds with the **path of the offending
  field**.
- The scan enforces, at every depth: a maximum nesting depth, a maximum array length, the existing
  maximum string length, that every number is finite, and that no key is a prototype-pollution name.

**A key named `__proto__`, `constructor` or `prototype` anywhere in the document is a refusal.**
- Not stripped — refused, and named. An exported RushPoint file never contains one, so its presence
  is evidence of tampering, and this module's stated rule is *refuse, never guess*.

**A value of the wrong type is a named refusal, not a downstream crash.**
- `answers`, `choices` and `unlockAfterTaskIds` must be arrays of strings; `steps` and `media` must be
  arrays of objects; `narrative`, `instructions`, `smart` and `coordinates` must be objects; text
  fields must be text; optional numeric fields must be finite numbers when present.

**Every new refusal names the field and the bound.**
- The message says which path was wrong and what the limit is, in the same voice as the existing
  refusals, and is surfaced by the same Builder dialog that already shows parse errors — no new
  hardcoded UI string is introduced.

**Non-goals.** No change to the exported document, to `serializeGameToFile`, to the schema version,
or to any accepted file: a legitimate export must still import byte-identically, including Hebrew
and RTL content and every task type. No change to the identity/ownership assignment in the callable,
which is already correct.

## Impact

- Affected specs: `game-file-import-hardening` (new capability).
- Affected code: `packages/shared/src/gameFile.ts` (the pure validator — the only behavioural
  change), a new co-located `packages/shared/src/gameFile.hardening.test.ts`, and new assertions in
  the existing `game-file-export-import` scenario of `scripts/e2e-verify.mjs`.
- `functions/src/games/index.ts` is **not** modified: `importGameFile` already refuses the whole
  import when `parseGameFile` returns errors, so hardening the pure function hardens the callable.
- Risk: a previously-accepted malformed file now fails with a message. That is the point, and the
  round-trip property test over all nine task types is the guard that no *legitimate* file changes
  behaviour.
