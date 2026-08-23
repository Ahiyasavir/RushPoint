## Why

A creator's real game was destroyed and could not be recovered. The forensic finding was not a
user mistake: the local dataset was replaced by an import of a dataset that never contained the
game, and creator identities disappeared alongside their games. Backups were absent for 13 days
because `dev:all` never enabled them, and the import picker could let a stale dataset win.

Those are infrastructure bugs, and two other changes are fixing them. But the reason the game was
*unrecoverable* is separate and unfixed: **the game existed in exactly one place, and the creator
had no copy of their own.** Every recovery path in the product today, trash/restore, backups,
`exportMyData`, runs on infrastructure the creator does not control and cannot inspect. A creator
who has spent weeks authoring stages, riddles, answer keys and coordinates currently has no way to
hold that work in their own hands.

This change gives the creator a file. A game they can export is a game no infrastructure failure
can take away.

## What Changes

**A creator can export one of their games to a file they keep.**
- A new owner-only callable returns the complete **authored template** of one of the caller's own
  games as a single self-describing JSON document: title, description, mode, scoring preset and
  options, registration fields, branding, tags, cover image, approximate location, game-level
  instructions, safe zone, consent/age settings, feature flags, and every stage in order with its
  title, `isFinal`, `requiredTaskCount`, release timing, narrative beats and exclusive groups.
- Every task carries **every authored field**, including the answer keys: quiz `answers` and
  `choices`, `orderItems`, `numericAnswer`/`numericTolerance`, `steps[].answer`, `hint` and
  `hintPenalty`, `smart.secretCode`, survey choices, media references, unlock graph
  (`unlockAfterTaskIds`), availability windows (`releaseAt` / `releaseAfterMinutes` /
  `expiresAfterMinutes`), trigger mode, hidden-location settings and coordinates.
- The Builder gains an **Export** action that downloads that document as a `.rushpoint.json` file.

**A creator can create a game from such a file.**
- A new owner-only callable accepts a previously exported document and creates a **new** game in
  the caller's own account from it. The restored game is immediately launchable: it goes through
  exactly the same structural, unlock-graph, availability-window, ordering, survey and
  completability validation that authoring through the Builder goes through.
- Import **always creates a new game**. It never overwrites an existing one. (Overwriting is
  another way to lose a game, which is the failure mode this change exists to end.)
- The Builder gains an **Import** action that reads a file and creates the game from it.

**The file is versioned and refuses to guess.**
- The document carries an explicit schema version. A file whose version this server does not know
  how to read is **refused with a clear message** rather than partially imported. Silently dropping
  fields is how a creator loses their work a second time, quietly.

**Round-trip stability is the contract.**
- Exporting a game, importing it, and exporting the result yields the **same document** (modulo the
  server-owned identity fields). This is stated as a requirement and proven by property tests over
  all nine task types, every optional field present and absent, Hebrew/RTL text, emoji, empty
  stages, partial-completion stages, exclusive groups, unlock graphs and media arrays.

**The file contains secrets, and is treated as such.**
- Because the export deliberately contains answer keys, hint text, station codes and hidden-location
  coordinates, it is produced **only for the authenticated owner of that game**, and it never flows
  through any participant-facing surface, the `publicGames`/`publicTasks` denormalization, or any
  unauthenticated path. A non-owner asking for another creator's game is denied.

## Capabilities

### New Capabilities
- `game-file-export-import`: A creator can export any game they own to a single versioned,
  self-contained file that reproduces the complete authored template, and can create a new,
  immediately launchable game from such a file. The export is owner-only and carries answer keys;
  the import validates like any authored game and refuses malformed or unknown-version input
  loudly rather than importing a partial game.

### Modified Capabilities
<!-- None. `import-game-spreadsheet` is a DIFFERENT capability with a different purpose (author a
     new game quickly from a flat human-written sheet, lossy by design, client-side parse). This
     change adds a lossless machine-written round-trip format and does not alter, replace or
     contradict any requirement of that spec. See design.md § "Relationship to
     import-game-spreadsheet". -->

## Non-goals

- **Not a backup service.** This change does not schedule, store, upload or retain anything on the
  creator's behalf. The file lives wherever the creator puts it. Automatic/periodic export is out
  of scope.
- **Not run history.** Runs, teams, scores, leaderboards, submitted photos, feed items, feedback
  and `playCount` are not exported and not imported. The export is the authored template, not what
  happened when it was played. (Enumerated and justified in design.md.)
- **Not a migration/transfer tool.** Import always lands in the caller's own account. There is no
  cross-account transfer, no "restore over" an existing game, and no un-delete path (trash/restore
  is `recoverable-game-deletion`, a separate change).
- **Not media file export.** Task media and cover images are exported as URL references, not as
  embedded binary. A file imported after its Storage objects are gone will import cleanly with
  those references dropped by the existing media trust boundary.
- **Does not touch the emulator backup scripts or the game deletion lifecycle.** Both are owned by
  concurrent changes.
- **Not a participant/staff feature.** play-web is untouched.

## Impact

- **Surfaces touched:** `packages/shared` (a new pure serialize/deserialize module + types),
  `functions/src/games/index.ts` (**two new callables**), `functions/src/index.ts` (re-export),
  `apps/creator-web` (Builder header actions + `services/calls.ts` typed wrappers + `i18n.ts`
  strings in both dictionaries). **No `play-web` changes. No new Firestore collection, no new
  index, no new env var.**
- **New callables (drives a typed wrapper + e2e coverage):** `exportGameFile` (owner-only read)
  and `importGameFile` (owner-only create). Both are re-exported from `functions/src/index.ts` and
  both need a scenario in `scripts/e2e-verify.mjs` — the callable coverage guard fails the suite
  otherwise.
- **Firestore rules:** unchanged. Both operations go through callables using the Admin SDK; no
  client write path is introduced, and no new document location is read or written.
- **No new Task/Stage/Game field** is introduced, so the e2e sanitizer allowlist
  (`ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS`) is unaffected.
- **Risk:** the export must not drift from the `Task`/`Stage`/`Game` types as they evolve. Mitigated
  by deriving the exported field set from an explicit, tested key list plus a
  round-trip property test that fails the moment a new authored field is added without being
  taught to the exporter.
- **Testing:** the whole serialize/deserialize core is pure and lands in `packages/shared` with
  seeded property tests in the existing no-emulator lane; the two callables get an e2e scenario.
