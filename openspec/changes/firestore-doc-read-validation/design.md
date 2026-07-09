## Context

Inbound trust and outbound trust are asymmetric in the backend today. Callable *payloads* are
validated by `packages/shared/src/validation.ts` before any Firestore access — a rejection is a
typed `ValidationError` carrying `{ field, constraint, message, messageHe }`, and the functions
adapter maps it to `HttpsError('invalid-argument')`. Stored *documents*, by contrast, are read with
a bare TypeScript assertion:

```ts
const run  = runSnap.data() as Run;                    // runs/index.ts:981
const game = gameSnap.data() as Game;                  // runs/index.ts:989
const teams = teamsSnap.docs.map((d) => d.data() as RunTeam); // runs/index.ts:992
const w = snap.data() as Wallet;                       // payments/index.ts:65
const data = snap.data() as { taskCounts?: …; hotZone?: HotZone | null }; // assignNextTask.ts:136
```

A grep for `.data() as ` returns **143 hits across 9 files** (104 in `runs/index.ts`). The cast is a
compile-time fiction: at runtime `snap.data()` is `any`, so a partial/legacy/corrupt document yields
an object that TypeScript *believes* is a `RunTeam` but that may be missing `score`, `bonusPenalty`,
or `stages`. That object flows into `buildRankings` (shared by `finalizeRun` and `refreshLeaderboard`
so live and final standings can't drift), into the routing comparator, and into wallet credit math —
exactly the paths where a `NaN` or `undefined` corrupts a result silently instead of failing where
it can be diagnosed.

The core stored shapes and their required fields (from `packages/shared/src/types/index.ts`):
- **Game** (`:428`): `id, ownerUid, title, mode, stages[], scoringPreset, registrationFields[],
  visibility, tags[], playCount, createdAt, updatedAt` (+ many optional fields).
- **Run** (`:554`): `id, gameId, ownerUid, status, accessCode, billingType, maxParticipants,
  participantCount, createdAt, updatedAt` (+ optional `hotZone`, `leaderboard`, …).
- **RunTeam** (`:679`): `id, runId, gameId, ownerUid, displayName, registrationData, status,
  stages[], score, bonusPenalty` (+ optional power-ups/consent/…).
- **Wallet** (`:843`): `uid, eventCredits, lifetimeFreeRunsUsed, plan, updatedAt` (+ optional
  Stripe/referral fields).

## Goals / Non-Goals

**Goals:**
- Verify the required fields of the four core stored shapes at the read boundary, so a malformed
  document fails loud (a diagnosable `HttpsError('internal')` naming the bad field) and safe (never
  a mis-typed object entering scoring/routing/payments).
- Keep well-formed documents behaving *exactly* as today — a valid doc parses to the same object the
  `as` cast produced, so `npm run e2e` passes unchanged.
- Tolerate unknown/extra fields (forward compatibility): a document written by a newer code version
  with additional fields must still parse under the current parser.
- Stay consistent with the existing `validation.ts` style — hand-rolled, pure, dependency-free,
  unit-testable with a plain tsx script; no new heavy dependency.

**Non-Goals:**
- Not converting all 143 read sites — only the highest-risk scoring/routing/payments reads in this
  change (see Decision 3 for the exact scope).
- Not changing `hotZoneMultiplier`, `buildRankings`, scoring presets, or any callable's success-path
  output.
- Not a schema migration, backfill, or rules change — the documents themselves are untouched.
- Not a secrecy mechanism — the participant sanitizer remains the sole answer-key boundary.

## Decisions

**1. Hand-rolled parser module in `packages/shared/src/storedDocs.ts`, not a schema library.**
A schema lib (zod/io-ts/ajv) would give declarative schemas "for free," but the repo deliberately
runs zero heavy runtime deps in `packages/shared` (it's imported by both the functions bundle and
the client apps), and `validation.ts` already establishes the house pattern: small pure functions,
a typed error carrying a machine-readable `field`, bilingual-ready messages, tsx-testable with no
Firebase. Adding zod would (a) pull a new dependency into the shared package's bundle for a
four-shape need, and (b) create two competing validation idioms in the same package. Rejected in
favor of a hand-rolled module that mirrors `validation.ts`. If stored-doc validation later grows to
dozens of shapes, revisiting a schema lib is a reasonable future call — noted in Open Questions.

The parsers throw a plain `StoredDocError extends Error` (carrying `docType` + `field` +
`constraint`) rather than importing `firebase-functions` — `packages/shared` must stay
Firebase-free. A thin functions-side adapter (alongside the existing `ValidationError → HttpsError`
mapping) converts `StoredDocError` to `functions.https.HttpsError('internal', …)`. `internal` (not
`invalid-argument`) is correct: a malformed *stored* doc is a server-side data-integrity fault, not
a caller mistake.

**2. Validate required scalars/arrays; tolerate everything else.** Each parser checks only the
fields the type marks required (Decision-context list above): the right primitive type for scalars
(`typeof x === 'string'`/`'number'` with `Number.isFinite` for numeric fields like `score`,
`bonusPenalty`, `eventCredits`), and `Array.isArray` for `stages`/`tags`/`registrationFields`. It
does **not** deep-validate nested elements (a `Stage`'s inner tasks, a `RunStageRecord`'s shape) in
this iteration — that keeps the parser cheap on the hot leaderboard path (which maps over every team
doc) and matches the "guard the boundary, not every leaf" goal. Optional fields are passed through
untouched. Unknown fields are preserved (the parser returns the original object typed, after
asserting required fields — it does not construct a whitelist copy), so extra fields tolerate
cleanly and no field is accidentally dropped.

Alternative considered: full deep validation of nested stages/tasks. Rejected for this iteration —
disproportionate cost on the per-team leaderboard map, and the required-field check already catches
the failure modes that produce `NaN` rankings (missing `score`/`bonusPenalty`/`scoringPreset`).

**3. Adopt the parsers at the highest-risk reads first — explicit scope.** The following reads are
converted in this change (they feed scoring, routing, or the credit ledger):
- `functions/src/runs/index.ts` — `refreshLeaderboard`: run `:981`, game `:989`, teams `:992`;
  and the analogous reads that feed `buildRankings` in `finalizeRun` and live/final parity around
  `:1165`/`:1171`/`:1174` and `:1281`/`:1287`/`:1290`.
- `functions/src/routing/assignNextTask.ts` — `getRunRouting` run read `:136` and `assignTask`'s
  in-transaction run read `:242` (both destructure `hotZone`/`taskCounts`/`launchedAt`). These use a
  narrowed `parseRun` (or a dedicated `parseRunRouting` view) so a corrupt hot-zone/count can't skew
  assignment.
- `functions/src/payments/index.ts` — wallet reads `:65`, `:265`, `:269`, `:353` via `parseWallet`,
  including the in-transaction read at `:353` (parse the snapshot data before mutating credits).

Explicitly **out of scope for this change** (left as blind casts, to adopt later): denormalized/
public reads in `gallery/index.ts`, public teaser/leaderboard reads in `runs/index.ts`
(`getPublicLeaderboard`, game-promo), `maintenance/index.ts` prune reads, and the ~100 non-scoring
reads in `runs/index.ts`/`index.ts`. Scoping keeps the diff reviewable and the e2e-provable surface
tight; the parsers are the reusable primitive the follow-up will use.

**4. In-transaction reads parse the snapshot, then proceed.** For `assignTask` and the wallet
transaction, the parse happens on the value read inside the transaction *before* any write is
computed — a malformed doc aborts the transaction with `internal` rather than committing a mutation
derived from garbage. No behavior change for well-formed docs (the transaction commits identically).

## Test Strategy

- **Pure logic — new `scripts/test-stored-docs.ts` (tsx, auto-picked-up by the aggregator) or a
  co-located `packages/shared/src/storedDocs.test.ts` vitest.** For each of `parseGame`, `parseRun`,
  `parseRunTeam`, `parseWallet`:
  - **(valid)** a fully-populated well-formed doc parses and returns an object deep-equal to the
    input (identity of required + optional + extra fields preserved).
  - **(missing required)** dropping each required field in turn (e.g. `RunTeam` without `score`, or
    without `bonusPenalty`; `Game` without `scoringPreset`; `Wallet` without `eventCredits`) throws
    `StoredDocError` whose `field` names the offending field.
  - **(wrong type)** a required field present but wrong-typed (e.g. `score: "12"`, `stages: {}` not
    an array, `eventCredits: NaN`) throws with the right `field`/`constraint`.
  - **(extra fields tolerated)** a doc with unknown extra fields parses successfully and the extras
    survive on the returned object (forward compatibility).
  - **(null/undefined doc)** `parseX(undefined)` / `parseX(null)` throws rather than returning a
    phantom object.
  These are written and confirmed **failing FIRST** (RED — the module doesn't exist), then the
  module is implemented to green.
- **Functions adapter — extend the existing error-mapping unit coverage** (co-located vitest near
  the `ValidationError → invalid-argument` mapping): a thrown `StoredDocError` maps to
  `HttpsError` with `code === 'internal'`.
- **e2e — `scripts/e2e-verify.mjs` stays green unmodified.** The full create→launch→join→start→play
  →review→leaderboard→finalize lifecycle exercises every converted read with well-formed data; it
  passing unchanged is the regression proof that parsing valid docs is behavior-preserving. No new
  e2e scenario is strictly required (there is no new callable), but optionally the leaderboard-
  invariant oracle already asserts ranking sanity end-to-end over the parsed reads.
- **No UI** — `npm run i18n:check` is a no-op for this change (no user-facing strings added); still
  run it to satisfy the gate discipline.

## Risks / Trade-offs

- **[Risk] A parser rejecting a field the required-list gets subtly wrong (e.g. a legacy Wallet
  missing a field that is actually optional in practice) could turn a previously-working read into a
  hard `internal` error.** → Mitigation: derive each required-field list strictly from the
  non-optional (`?`-less) fields of the type in `types/index.ts` (enumerated in Context), and the
  "valid doc" tests include a legacy-shaped doc (e.g. Wallet with `balanceILS`, without the newer
  optional fields) to confirm it still parses. e2e over the real seeded data is the backstop.
- **[Trade-off] Shallow validation (no deep nested-element checks) means a malformed *inner* task or
  stage record still slips through.** Accepted for this iteration — the required-field boundary
  catches the failure modes that actually corrupt scoring; deep validation is a possible follow-up.
- **[Risk] Per-team `parseRunTeam` on the leaderboard hot path adds a small cost.** → Negligible: a
  handful of `typeof`/`Array.isArray` checks per doc, no allocation of a copy (the original object is
  returned), dwarfed by the Firestore read itself.
- **[Trade-off] Only the highest-risk reads are converted; 100+ blind casts remain.** Deliberate
  (Decision 3) — this change delivers the primitive and hardens the paths where a bad doc does the
  most damage, without a sprawling 143-site diff.

## Migration Plan

Pure additive: a new shared module + a functions adapter + swapping `as` casts for parser calls at
the named sites. No persisted schema change, no data migration, no rules change, no new env var.
Rollback is a plain revert. Because well-formed documents parse to the identical object, there is no
observable behavior change for any healthy run — the only new behavior is that a *corrupt* doc now
fails cleanly instead of silently. Ships independently of any feature flag.

## Open Questions

- If stored-doc validation later expands to most of the 143 reads (and to nested stage/task
  validation), is that the point to reconsider a schema library for `packages/shared`, or does the
  hand-rolled module scale acceptably? (Deferred — revisit once the follow-up scope is known.)
- Should a malformed-doc `internal` error also emit a structured Sentry breadcrumb via the existing
  observability seam, so corrupt docs are alerted on in production rather than only surfaced to the
  affected caller? (Likely yes in a follow-up; out of scope here to keep the change pure-logic.)
