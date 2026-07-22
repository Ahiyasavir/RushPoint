# Design — game-file-export-import

## Context

The incident this change answers is not "a game was deleted". It is "a game existed in exactly one
place". `recoverable-game-deletion` (concurrent change) makes deletion undoable; the emulator
backup work (concurrent change) makes the *platform's* copy trustworthy. Neither gives the creator
a copy they hold. This change does, and only that.

There is one adjacent precedent: `exportMyData` (`functions/src/users/index.ts:65`) already returns
every raw game document to its owner, secrets included, for the right-of-access obligation. It is
**not** a portability format — it is account-wide, it embeds run counts and trash flags, it is
un-versioned, and nothing can read it back. This change does not replace it; the two coexist and
the security posture (owner-only, secrets included) is already established by it.

## Relationship to `import-game-spreadsheet`

`openspec/specs/import-game-spreadsheet/spec.md` covers a **different capability** and this change
neither modifies nor duplicates it.

| | `import-game-spreadsheet` | `game-file-export-import` (this change) |
|---|---|---|
| Purpose | Author a new game fast from a human-written sheet | Hold and restore an exact copy of an authored game |
| Written by | A person, in Excel/Sheets | The platform, machine-generated |
| Fidelity | Deliberately lossy: 9 flat columns, no `smart`, no steps, no unlock graph, no media | Lossless for the entire authored template |
| Where it runs | Client-side parse (`packages/shared/src/importSheet.ts` `parseGameRows`), persisted via `createGame` + `updateGame` | Server-side callables, validated on the server |
| Versioned | No (a sheet is a human artifact) | Yes, refuses unknown versions |
| Export half | None (import only) | Yes, and the export is the point |

They agree on the one rule that matters and this change restates it: **import always creates a new
game and never overwrites an existing one** (`import-game-spreadsheet` spec, "Confirmed import
creates a new game via existing callables"). `parseGameRows` is left exactly as it is; the new
module does not call it and does not share its `ParsedGame` shape.

## Decisions

### D1 — The format

A single JSON object, extension `.rushpoint.json`:

```jsonc
{
  "format": "rushpoint.game",   // fixed identifier; anything else is refused
  "schemaVersion": 1,           // integer; see D5
  "exportedAt": "2026-07-22T…", // informational only, excluded from round-trip comparison
  "game": { /* the authored template — see D2 */ }
}
```

`game` is the **authored subset** of `Game`, with `stages[].tasks[]` nested exactly as they are
stored. No re-shaping, no flattening, no id renumbering: the file is recognisably the game.

### D2 — What is in the export (the authored template)

Derived from an explicit, exported key list in `packages/shared`, not from a spread of the stored
document — a spread would leak whatever field is added next.

**Game level:** `title`, `description`, `mode`, `scoringPreset`, `scoringOptions`,
`registrationFields`, `branding`, `tags`, `coverImage`, `approxLocation`, `instructions`,
`safeZone`, `requiresGuardianConsent`, `minAge`, `benchmarkOptOut`, `allowInstantPlay`,
`photoFeedEnabled`, `powerUpsEnabled`, `manualLeaderboardReveal`, `stages`.

**Stage level:** `id`, `order`, `title`, `isFinal`, `requiredTaskCount`, `releaseAt`,
`releaseAfterMinutes`, `narrative`, `exclusiveGroups`, `tasks`.

**Task level:** `id`, `title`, `description`, `type`, `coordinates`, `difficulty`,
`estimatedMinutes`, `expectedDurationMinutes`, `pointValue`, `maxConcurrentTeams`, `status`,
`maxDurationMinutes`, `triggerMode`, `locationless`, `hideLocation`, `locationClue`,
`locationClueHe`, `hint`, `hintPenalty`, `hintAutoRevealMinutes`, `hintAutoRevealAttempts`,
`choices`, `answers`, `orderItems`, `surveyChoices`, `numericAnswer`, `numericTolerance`,
`geofenceRadiusMeters`, `requirePresence`, `steps`, `media`, `releaseAt`, `releaseAfterMinutes`,
`expiresAfterMinutes`, `unlockAfterTaskIds`, `tags`, `smart`.

**`smart` level:** every `SmartStationConfig` field **except** `stationCoords` (see D3).

### D3 — What is deliberately NOT in the export, and why

| Excluded | Category | Why |
|---|---|---|
| runs, teams, scores, leaderboards | run history | The file is a *template*, not a record of an event. A restored template is a game you can run again; a restored run would be a fabricated event with real people's names and timings in it. Run data also carries participant PII that is subject to the 90-day prune — putting it in a file the creator keeps forever silently defeats that retention promise. |
| submitted photos, audio, feed items, feedback responses, location tracks | run history + PII | Same. Participant-authored content; not the creator's to carry away, and the binaries live in Storage anyway. |
| `playCount` | run history | A popularity counter earned by the original. A restored game that claims 400 plays it never had is a lie, and (via `publishGame` → `publicGames.popularity`) a way to manufacture gallery ranking. Reset to 0 by import, exactly as `duplicateGame` already does. |
| access codes | run history | Bound to a specific run of a specific game in a specific account. A code cannot be meaningfully "restored" (`recoverable-game-deletion` already establishes that codes are revoked/reinstated, never recreated). |
| `ownerUid` | server-owned | Import lands in the caller's account, always. Honouring an `ownerUid` from a file would be an account-transfer primitive nobody asked for and a privilege-escalation shape. |
| `id` | server-owned | The document id is the Firestore address. A file must not be able to choose where it lands (that is an overwrite, see D6). Stage/task ids **are** kept — they are internal to the template and the unlock graph and exclusive groups reference them. |
| `createdAt` / `updatedAt` | server-owned | Server clock. A file-supplied timestamp would corrupt `listGames`'s `orderBy('updatedAt')` ordering. |
| `visibility` | server-owned | Per the audit note, visibility changes **only** through `publishGame`, which re-runs the structural winnability guard before indexing into the public gallery. An import that could set `visibility: 'public'` would be a way into the gallery that skips that guard. Imported games are always `private`. |
| `deletedAt` / `deletedBy` | server-owned | The trash tombstone is written only by `deleteGame`. Importing "deleted" state is meaningless and rules already reject client writes of these fields. |
| `smart.stationCoords` | runtime | The type says it outright: "injected by `assignTask`; never authored". It is per-run routing state that happens to live on the config object. |
| `currentTeamCount` | runtime | "runtime counter maintained per run (not on template)" — a live station-occupancy count. Exporting it and importing it would seed a fresh game with phantom occupancy and starve routing. |
| `integrationWebhookUrl` / `integrationPlatform` | owner secret | A Slack/Teams incoming-webhook URL is a bearer credential for a channel. `duplicateGame` and `translateGame` both already strip it from copies; a file that leaves the machine must not carry it. Re-enter it after import. |

Media and cover images are exported as **URL references**, not embedded binary (Non-goal). On
import they pass back through `normalizeTaskMedia`, so a reference whose Storage object no longer
exists is dropped by the existing trust boundary rather than persisting a dead pointer.

### D4 — Answer-key secrecy (hard security requirement)

The export **contains secrets by design**: `answers`, the authored `orderItems` order,
`numericAnswer`, `steps[].answer`, `hint`, `smart.secretCode`, and the real `coordinates` of
`hideLocation` tasks. This is correct — a "backup" that omits the answer keys would restore an
unplayable game, which is the failure being fixed.

It therefore carries a hard constraint:

1. `exportGameFile` requires `requireAuth(context)` and asserts `game.ownerUid === uid`. A
   non-owner gets `permission-denied`; an unauthenticated caller gets `unauthenticated`. There is
   no `sourceOwnerUid` parameter (unlike `duplicateGame`) and no public-game path — a published
   game is **not** exportable by strangers, because publishing exposes the sanitized
   `publicTasks` projection, never the answer key.
2. A trashed game is `not-found`, matching `getGame`'s `assertGameNotDeleted`.
3. The serializer lives in `packages/shared` but is **never** imported by `play-web`, and never
   called from any participant/staff callable. Nothing in this change touches
   `sanitizeTaskForParticipant`, `publicGames`, or `publicTasks`.
4. No new Firestore document is written, so nothing new is readable under `firestore.rules`.

**Proven by:** an e2e assertion that a second authenticated creator calling `exportGameFile` on
another creator's game is denied and receives no game content; a pure test asserting the exported
document for a fully-loaded game contains each secret; and a pure test asserting the serializer
output contains no `stationCoords`/`integrationWebhookUrl` key.

### D5 — Versioning policy

- `format` must be exactly `"rushpoint.game"`. Absent or different ⇒ refuse: *"This is not a
  RushPoint game file."*
- `schemaVersion` must be an integer. `CURRENT_GAME_FILE_VERSION = 1`.
- `schemaVersion > CURRENT` ⇒ **refuse loudly**, naming both numbers: *"This file was exported by a
  newer version of RushPoint (format 2). This version reads up to format 1."* We do not import it
  by ignoring unknown fields — silently dropping fields is exactly how a creator loses their work a
  second time, and the loss would be invisible until the day they launch.
- `schemaVersion < CURRENT` ⇒ accepted, and passed through a small ordered chain of pure upgrade
  functions (`upgradeGameFile`) before validation. Version 1 has no predecessors, so the chain is
  empty today; the seam exists so that adding version 2 is a pure function plus a test, not a
  redesign.
- **When to bump:** only when an old file can no longer be read faithfully by the current
  deserializer. Adding a new optional authored field does **not** bump the version (an old file
  simply lacks it, which is indistinguishable from the field being unset). Renaming, re-typing or
  removing a field does.
- Unknown *fields* inside a document at a **known** version are dropped silently — that is the
  forward-compatibility escape hatch, and it is safe because a known version means the field was
  never one of ours.

### D6 — New game, never overwrite (recommendation adopted)

`importGameFile` takes no target game id and always allocates a new document via
`db.collection('users/{uid}/games').doc()`. Rationale: an overwrite is a destructive operation
whose failure mode is *losing a game*, which is the exact thing this change exists to prevent. A
creator who wants to replace a game imports and then deletes the old one — and deletion is now
recoverable.

### D7 — Size limits

Bounds are checked **before** any parsing work, on the serialized string the client sends:

| Bound | Value | On exceed |
|---|---|---|
| `MAX_GAME_FILE_BYTES` | 2 MiB (UTF-8 byte length of the serialized document) | refuse: *"That file is too large (X MB). The limit is 2 MB."* |
| `MAX_FILE_STAGES` | 100 | refuse, naming the bound |
| `MAX_FILE_TASKS` | 1000 (across all stages) | refuse, naming the bound |
| `MAX_FILE_STRING_LEN` | 20 000 chars for any single string leaf | refuse, naming the field |

2 MiB is comfortably below the Firebase callable request limit (10 MiB) and is roughly a
1000-task game with long instructions; the caps exist so a hostile or corrupt file cannot make the
server do unbounded work before it fails. The same caps are checked client-side before upload so an
obviously-too-big file fails instantly with the same message.

Export is not capped — a game that could be authored can always be exported. (`updateGame` already
bounds what can be authored in the first place, and a Firestore document is hard-capped at 1 MiB,
so an exportable game is structurally under the import cap.)

### D8 — Validation on import

The deserializer is pure and returns `{ game, errors[] }` — it never throws. The callable refuses
when `errors` is non-empty, joining them with ` · ` into one `invalid-argument`, matching
`updateGame`'s existing style. Layers, in order:

1. **Envelope** — `format`, `schemaVersion`, size/count caps (D5, D7).
2. **Shape** — required fields present and correctly typed (`title`; per stage `id`, `order`,
   `title`, `tasks[]`; per task `id`, `title`, `type` ∈ `TaskType`, numeric `difficulty` /
   `estimatedMinutes` / `pointValue`), unknown fields dropped, ids unique within their scope,
   `coordinates` validated with `isValidCoord`, strings passed through `stripUnsafeDisplayChars`.
3. **Semantic** — the *same* functions `updateGame` runs, called from the same place so they can
   never drift: `gameStructureProblems`, `validateUnlockGraph`, `validateAvailabilityWindow`,
   `validateOrderItems`, `validateSurveyChoices`, plus the orderItems/quiz mutual-exclusion rule.
4. **Trust boundary** — `normalizeTaskMedia` (with `allowLocalEmulator` under
   `FUNCTIONS_EMULATOR`), `cleanGameInstructions`, and the `sanitizeStagesText` pass, exactly as
   `updateGame` applies them.

Only after all four pass is a single `ref.set(game)` performed — **one write**, so a refusal can
never leave a half-game. (Deliberately not `createGame` + `updateGame`, which is two writes and can
strand an empty game if the second fails. That is a real, if minor, weakness of the spreadsheet
import path; this change does not alter that path, it just does not repeat the shape.)

### D9 — Where the shared logic lives

A new `packages/shared/src/gameFile.ts`, exported from `packages/shared/src/index.ts`. It is
**pure** — no Firebase imports — so the whole round-trip property can be tested with no emulator,
and so the Builder can pre-validate a chosen file before spending a round trip.

## Files to touch

**`packages/shared/`**
- `src/gameFile.ts` (**new**) — `GAME_FILE_FORMAT`, `CURRENT_GAME_FILE_VERSION`, the cap
  constants, `GameFile` / `GameFileGame` types, `EXPORTED_GAME_KEYS` / `EXPORTED_STAGE_KEYS` /
  `EXPORTED_TASK_KEYS` / `EXPORTED_SMART_KEYS`, `serializeGameToFile(game)`,
  `parseGameFile(input)` → `{ game, errors }`, `upgradeGameFile(doc)`, `gameFileFilename(title)`.
- `src/index.ts` — add `export * from './gameFile';`.

**`functions/`**
- `src/games/index.ts` — `exportGameFile` and `importGameFile` callables. `sanitizeStagesText` and
  `normalizeStagesMedia` are currently module-private there; the import path reuses them directly.
  The four semantic validators are extracted out of `updateGame`'s inline loop into one local
  `stagesProblems(stages)` helper that **both** `updateGame` and `importGameFile` call, so the
  two can never diverge (this is the refactor step, taken after both are green).
- `src/index.ts` — nothing to add: line 23 is already `export * from './games/index'`, so both
  callables are re-exported automatically. **Verify** they appear in the emulator's callable list.

**`apps/creator-web/`**
- `src/services/calls.ts` — typed wrappers:
  `exportGameFile: callable<{ gameId: string }, { file: GameFile }>` and
  `importGameFile: callable<{ file: GameFile }, { gameId: string }>`.
- `src/pages/BuilderPage.tsx` — two actions in the Builder header area: **Export** (calls, then
  triggers a Blob download named from `gameFileFilename`) and **Import** (a hidden file input →
  `JSON.parse` → client-side `parseGameFile` pre-check → callable → navigate to the new game).
  Deliberately **not** `DashboardPage.tsx` or `WalletPage.tsx` (owned by a concurrent change).
- `src/i18n.ts` — new keys in **both** `he` and `en`: action labels, the download/success toast,
  and one message per refusal class (not-a-game-file, newer-version, too-large, invalid). Hebrew
  values must be real Hebrew and must not use `—`/`–`/` - ` as separators (INSTRUCTIONS §3.C).

**`scripts/`**
- `scripts/test-game-file.ts` (**new**) — the pure lane, auto-collected by
  `scripts/run-unit-tests.mjs`.
- `scripts/e2e-verify.mjs` — one new scenario (below). **Required**: the callable coverage guard
  fails the suite for any callable the emulator serves that no scenario invoked.

**Not touched:** `firestore.rules` (no new document, no new client read/write),
`functions/src/maintenance/`, `scripts/emulator-backup.mjs`, `scripts/dev-emulator.mjs`,
`scripts/lib/emulatorBackup.mjs`, `DashboardPage.tsx`, `WalletPage.tsx`, all of `play-web`.

**Allowlist note:** this change adds **no** `Task`-shaped field, so `ALLOWED_TASK_KEYS` /
`ALLOWED_SMART_KEYS` in `scripts/e2e-verify.mjs` need no edit.

## Test strategy

Every claim in the spec is bound to a named test below. Tests are written **first** and confirmed
RED before any production code.

### Pure lane — `scripts/test-game-file.ts` (tsx, no emulator, in `npm test`)

Seeded-random property tests in the style of
`functions/src/__property__/invariants.property.test.ts` (a small LCG, no `fast-check`
dependency), plus targeted example tests.

**The round-trip property (the core test).** A seeded generator builds a random `Game`; then
`parseGameFile(serializeGameToFile(g))` deep-equals `g` restricted to the authored key set, and
`serializeGameToFile(parseGameFile(serializeGameToFile(g)).game)` equals the first document
excluding `exportedAt`. 300 seeded samples, covering by construction:
- **all nine task types** — `field`, `smart_station`, `photo`, `self_report`, `quiz`, `numeric`,
  `geofence`, `sequence`, `survey`;
- **each optional field independently set and unset** — the generator flips every optional field
  with 50% probability, so absence is asserted as absence (never a materialised `null`/default);
- **unicode / RTL Hebrew** and **emoji in titles**, in stage titles, task titles, descriptions,
  clues, hints and answers;
- **an empty stage list** and a **stage with `requiredTaskCount`**;
- **exclusive groups**, **unlock graphs** (acyclic, generated as a DAG over the stage's tasks) and
  **media arrays** (image / video / canonical YouTube entries).

Plus explicit tests:
- `secrets present in an owner export` — a fully-loaded game exports `answers`, `numericAnswer`,
  `steps[].answer`, `hint`, `smart.secretCode`, `orderItems`, and a `hideLocation` task's
  `coordinates`.
- `exclusions` — the serialized document has no `ownerUid`, `id`, `visibility`, `playCount`,
  `createdAt`, `updatedAt`, `deletedAt`, `integrationWebhookUrl`, `integrationPlatform`,
  `currentTeamCount` or `smart.stationCoords` key, even when the source game carries all of them.
- `unknown schema version refused` — `schemaVersion: CURRENT + 1` returns an error naming both
  versions and no game.
- `wrong format refused` — missing/different `format`.
- `missing required field refused` — no game title; a task with no `id`; a task with no `type`.
- `cyclic unlock graph refused` — two tasks in one stage referencing each other.
- `size caps` — over-byte, over-stage, over-task and over-string-length documents each refused
  naming their bound.
- `key-list drift guard` — a type-level + runtime assertion that every key of a fully-populated
  `Task`/`Stage`/`Game` literal is either in the exported key list or in an explicit
  `DELIBERATELY_EXCLUDED` list. Adding a field to `Task` without classifying it fails this test.
  This is what stops the exporter silently rotting.

### E2E lane — `scripts/e2e-verify.mjs`, scenario `game file export/import (owner-only, round trip, launchable)`

1. Owner creates a game with stages covering several task types, answer keys, a hint, a smart
   station code and a media attachment.
2. `exportGameFile` as the owner ⇒ document returned; assert `format` / `schemaVersion`; assert the
   quiz answer and the station secret code are **present**; assert `ownerUid`/`id`/`playCount` are
   **absent**.
3. A **second authenticated creator** calls `exportGameFile` on that gameId ⇒ `permission-denied`,
   and the error body carries no game content. *(This is the security requirement's e2e proof.)*
4. `exportGameFile` on a nonexistent gameId ⇒ `not-found`.
5. `importGameFile` as the owner with the document from (2) ⇒ new gameId, different from the
   original; `getGame` on it shows the same stage/task counts, the same answer keys, `visibility`
   `private`, `playCount` 0, `ownerUid` = caller.
6. `launchRun` on the imported game succeeds ⇒ "a restored game is launchable".
7. Re-export the imported game and compare to (2) ignoring `exportedAt` ⇒ round-trip parity
   end-to-end, not just in the pure lane.
8. Malformed imports each rejected with `invalid-argument` and **no new game created** (assert
   `listGames` length is unchanged): unknown `format`; `schemaVersion` = CURRENT + 1; a cyclic
   unlock graph; a quiz task with no answers.
9. Import a document naming a foreign `ownerUid`/`id` ⇒ ignored; created game is the caller's.

⚠️ **This scenario cannot be executed in this session** — a live tunnel is running and the emulator
must not be started. It is written, but **unverified**.

### UI lane

Preview-based verification of the Builder Export/Import actions, plus `npm run i18n:check` and
`npm run i18n:check:strict` — the strict baseline for this tree is **clean** (PART A and PART B
both pass), so this change must add **zero** new findings.

## Risks

- **Exporter rot** — a new authored `Task` field silently missing from exports. Mitigated by the
  key-list drift guard test (above), which fails the moment a field is added without being
  classified.
- **Validator drift** — `importGameFile` and `updateGame` accepting different games. Mitigated by
  extracting the semantic checks into one `stagesProblems()` helper both call.
- **A creator treats the file as a backup of their event.** Mitigated by the export/import copy
  saying plainly, in both languages, that the file holds the game, not the results.
