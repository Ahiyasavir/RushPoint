## Why

`task-library-map-view` gave `publicTasks` a location contract — publish a coarse ~1 km area, and
for a `hideLocation` task publish nothing at all — and enforced it at the **write**, in
`publishGame`. That change fixed every document written after it shipped and, by its own admission,
**nothing that was already stored**. Its `design.md` §Residual risk says so in as many words:

> Documents published before this change keep their stored `coordinates` until their owner
> re-publishes. […] `publicTasks` is `allow read: if true`, so a direct Firestore read still sees
> the legacy value.

That residual is not a slow leak, it is a standing one. Every task published before the fix still
sits in a world-readable, unauthenticated collection carrying the creator's **exact authored GPS
point** — including `hideLocation` tasks, whose coordinates this codebase treats as server-secret
everywhere else (`sanitizeTaskForParticipant`, the routing payload, the photo feed, the run recap,
the game-file export). Nothing forces a creator to re-publish, so "it drains as creators republish"
is a hope, not a mechanism. A game published once and never touched again leaks forever.

This change is the mechanism: a one-off, admin-triggered sweep that rewrites the already-stored
documents to satisfy the contract the write path now enforces.

## What Changes

**Stored public task documents are brought under the location contract.**
- A stored `publicTasks` document that still carries the deprecated exact `coordinates` field is
  repaired: the field is **deleted**, and it is replaced by the same coarse area the current
  `publishGame` would write today — or by **no location at all** when the authored task says its
  location must not be published.
- **The authored task is the authority, not the public document.** A `publicTasks` document does not
  carry `hideLocation` or `locationless` — those authoring flags were never denormalised — so the
  public document alone cannot decide whether its point may be coarsened or must vanish. The repair
  reads the owning game and applies the rule to the authored task.
- **The rule fails closed.** When the owning game or the task inside it cannot be found (deleted,
  unpublished, task removed), the document is stripped and **no** area is published. Losing a map
  pin is recoverable by re-publishing; leaking a hidden location is not.
- A stale published area is cleared too: a task that has since become `hideLocation` ends up with
  neither `coordinates` nor `approxLocation`.
- The sweep is **idempotent** — a conformant document is skipped and written to zero times, so a
  second run reports nothing repaired.

**A new admin callable runs it.**
- `backfillPublicTaskCoordinatesNow` — admin-only, **paged** (`limit` + `startAfter`, returning a
  `cursor`), with a **`dryRun`** mode that reports what would change and writes nothing. It is an
  operational tool expected to be invoked a handful of times, ever, not a scheduled job.

**Non-goals**
- No change to `publishGame`, `searchTaskLibrary`, the shared coarsening function, or the gallery
  map. This change consumes `task-library-map-view`'s contract; it does not restate or alter it.
- No change to `firestore.rules`. `publicTasks` stays public-read; what is *in* it is what changes.
- No scheduled trigger, no automatic run at deploy, no client-facing surface. Nothing in
  `creator-web` or `play-web` is touched, so no typed `services/calls.ts` wrapper and no i18n work.
- No new Firestore index — see `design.md` §D2 for why the sweep scans rather than queries.
- No repair of anything other than the location fields. Titles, points, difficulty, tags and copy
  counts are left exactly as they are.
- No deletion of public task documents. An unplaceable task stays listed, just without a location.

## Capabilities

### New Capabilities
- `public-task-location-backfill`: how already-stored public task documents are brought under the
  public location contract — what counts as a document needing repair, what replaces the exact
  point, what happens when the authored task cannot be found, and the operational shape (admin-only,
  paged, dry-runnable, idempotent) of the sweep that applies it.

### Modified Capabilities
None. The contract being enforced (`public-task-location-privacy`) is introduced by the sibling
change `task-library-map-view` and is unchanged by this one — this change only extends its reach
from newly-written documents to already-stored ones.

## Impact

- **Surfaces touched:** `packages/shared` (a new pure module), `functions/` (a new maintenance
  module and a **new admin callable**, re-exported from `functions/src/index.ts`). No `creator-web`,
  no `play-web`, no `firestore.rules`, no new index, no new env var.
- **Files:** `packages/shared/src/publicTaskBackfill.ts` + `.test.ts` (new), re-exported from
  `packages/shared/src/index.ts`; `functions/src/maintenance/publicTaskBackfill.ts` (new);
  `functions/src/maintenance/index.ts` (the callable); `functions/src/index.ts` (re-export);
  `scripts/e2e-verify.mjs` (a new scenario + a row in the authz denial matrix).
- **New callable ⇒ e2e obligation.** The suite's coverage guard fails the run if a callable the
  emulator serves was never invoked, so `backfillPublicTaskCoordinatesNow` ships RED until it has
  a scenario. That scenario is part of this change.
- **Risk — this job writes to production data.** It deletes a field from documents it did not
  create. The mitigations are that it is admin-gated, dry-runnable, paged, idempotent, and driven by
  a pure decision rule that is unit-tested independently of any I/O. It cannot delete a document and
  cannot touch anything outside `publicTasks`.
- **Risk — a coarser map after the sweep.** A document whose owning game has since been deleted is
  stripped of its location, so its marker disappears from the mission library map. That is the
  fail-closed trade, taken deliberately.
- **Testing:** the decision rule is pure and lands in `packages/shared` with a co-located vitest
  file in the existing `npm test` lane (no emulator). The callable and the write behaviour are
  proven by a dedicated `scripts/e2e-verify.mjs` scenario.
