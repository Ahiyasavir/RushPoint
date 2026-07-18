## Why

RushPoint validates every *inbound* callable payload — `packages/shared/src/validation.ts`
(`requireString`, `optionalCoordinatePair`, …) is applied before any Firestore read, transaction,
or haversine math. But the *opposite* boundary — reading a document back out of Firestore — has no
validation at all. Nearly every backend read is a blind cast: `snap.data() as Game`,
`d.data() as RunTeam`, `snap.data() as Wallet`, `runSnap.data() as Run`. A grep for `.data() as `
finds **143 occurrences across 9 files** (104 in `functions/src/runs/index.ts` alone, plus
`index.ts`, `games/index.ts`, `payments/index.ts`, `routing/assignNextTask.ts`, `users/index.ts`,
`gallery/index.ts`, `maintenance/index.ts`). The cast *asserts* the stored shape but never *checks*
it.

A partial, legacy, or corrupt document therefore flows silently into the most consequential code
paths: `buildRankings(game, teams, now)` feeds off `refreshLeaderboard`/`finalizeRun` reads
(`functions/src/runs/index.ts:981` run, `:989` game, `:992` teams; and again at `:1165`/`:1281`),
smart routing reads `run.hotZone`/`taskCounts` (`routing/assignNextTask.ts:136`, `:242`), and the
credit ledger casts `snap.data() as Wallet` (`payments/index.ts:65`, `:265`, `:269`, `:353`). If a
`RunTeam` is missing `score` or `bonusPenalty`, or a `Game` is missing `scoringPreset`, the mis-typed
object produces `NaN` scores, mis-ranked leaderboards, or a thrown-deep-in-scoring stack trace
instead of a clean, diagnosable failure at the read boundary. This is a latent data-integrity gap
that a senior review flagged: we trust our writes implicitly and have no guard when that trust is
violated.

## What Changes

- Add lightweight, hand-rolled runtime parsers/type-guards to `packages/shared/src` for the four
  core stored shapes — `parseGame`, `parseRun`, `parseRunTeam`, `parseWallet` — each verifying the
  document's **required** fields are present and correctly typed, tolerating unknown/extra fields
  (forward-compatible), and returning the strongly-typed object on success.
- On a malformed stored document, a parser **fails loud and safe**: it throws a typed
  `functions.https.HttpsError('internal', …)` at the read boundary (via a thin functions-side
  adapter — the shared parsers stay Firebase-free and throw a plain typed error the adapter maps),
  so a corrupt doc surfaces as a diagnosable 500 with the offending field name, never a mis-typed
  object silently propagating into scoring/routing/payments.
- Replace the blind `as` casts at the **highest-risk read sites first** (scoring/leaderboard,
  routing, payments) with the parsers. This is deliberately scoped — not all 143 casts at once (see
  `design.md`). Lower-risk read-only/denormalized reads (gallery, public teasers) are left for a
  follow-up; the parsers exist so they *can* be adopted incrementally.
- No new callables, no Firestore schema change, no data migration. This is read-boundary hardening:
  the same documents, the same fields, now verified on the way out. Answer-key secrecy and
  `FIRESTORE_PATHS` conventions are untouched (parsers validate shape only; the participant
  sanitizer still strips secrets independently).

Surfaces touched: **shared types** (`packages/shared/src` — new parser module) and **backend
callables** (`functions/src/runs`, `functions/src/routing`, `functions/src/payments`). No UI, no
`firestore.rules`, no new env var.

## Capabilities

### New Capabilities
- `stored-doc-validation`: the backend validates core stored documents (Game / Run / RunTeam /
  Wallet) at the read boundary and fails loud/safe on a malformed doc rather than propagating a
  mis-typed object into scoring, routing, or payments.

### Modified Capabilities
(none)

## Impact

- `packages/shared/src/storedDocs.ts` (new) — pure, dependency-free `parseGame`/`parseRun`/
  `parseRunTeam`/`parseWallet` plus a small `StoredDocError` (typed, carries the offending field),
  mirroring the style of the existing `validation.ts`. Exported from the package's public surface.
- `functions/src/` (a thin adapter, e.g. in an existing helpers module) — wraps a `StoredDocError`
  into `functions.https.HttpsError('internal', …)`, the same way `ValidationError` is mapped to
  `invalid-argument` for inbound payloads.
- `functions/src/runs/index.ts` — the leaderboard/finalize read sites (`refreshLeaderboard`'s run/
  game/teams reads at `:981`/`:989`/`:992`, and the `finalizeRun` / live-parity reads at `:1165`+
  and `:1281`+) adopt `parseRun`/`parseGame`/`parseRunTeam` where the result feeds `buildRankings`.
- `functions/src/routing/assignNextTask.ts` — the run-doc reads that drive assignment
  (`getRunRouting` at `:136`, `assignTask`'s transactional read at `:242`) adopt `parseRun` (or a
  narrowed routing view) so a corrupt `hotZone`/`taskCounts`/`launchedAt` can't skew routing.
- `functions/src/payments/index.ts` — the wallet ledger reads (`:65`, `:265`, `:269`, `:353`) adopt
  `parseWallet` so credit math never runs against a partial wallet.
- Test coverage: a new pure-logic test per parser (`scripts/test-stored-docs.ts` or a co-located
  `packages/shared` vitest) proving valid docs pass, missing/wrong-typed required fields are
  rejected, and extra fields are tolerated; `npm run e2e` stays green proving no behavior regression
  on well-formed data through the full lifecycle.

## Non-goals

- **Not** validating all 143 read sites in one change — only the highest-risk scoring/routing/
  payments reads are converted now; the rest can adopt the parsers later.
- **Not** a schema migration — no stored document is rewritten, no field is added or backfilled.
- **Not** a new secrecy boundary — the participant sanitizer that strips answer keys
  (`smart.secretCode`, `hint`, quiz `answers`, `numericAnswer`, `steps[].answer`) is unchanged; the
  parsers check shape, not what may be sent to a client.
- **Not** adopting a schema library (zod/io-ts/ajv) — the design justifies staying hand-rolled to
  match the repo's zero-new-heavy-deps style (see `design.md`, Decision 1).
- **Not** changing any callable's success-path behavior or its typed `services/calls.ts` wrapper —
  well-formed documents parse to exactly the object the `as` cast produced today.
