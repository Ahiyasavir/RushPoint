## Context

The mission-library map (`task-library-map-view`) plots one pin per public task, reading only
`PublicTask.approxLocation` — the ~1 km grid-cell centre written by `publicTaskLocation()`. The
exact authored `coordinates` is deprecated, no longer written by `publishGame`, and stripped from
the `searchTaskLibrary` response; `publicTasks` is `allow read: if true`, which is the whole reason
the exact point may not live there.

The reported symptom (world-zoomed map, zero pins, "none of these missions has a published area")
is the correct rendering of a result set in which **no document carries `approxLocation`**. Verified
hop by hop:

| Hop | File:line | Verdict |
|---|---|---|
| area derivation | `packages/shared/src/publicTaskLocation.ts:89-102` | correct — snaps to grid, `undefined` for hidden/locationless/unplaced |
| publish write | `functions/src/games/index.ts:719-729` | correct — writes `approxLocation`, never `coordinates` |
| backfill rule | `packages/shared/src/publicTaskBackfill.ts:66-76` | correct — repairs a legacy doc, fails closed |
| backfill I/O | `functions/src/maintenance/publicTaskBackfill.ts:66-165` | correct — paged, idempotent |
| sweep callable | `functions/src/maintenance/index.ts:260-270` | correct — but `assertAdmin`, no operator entry point |
| callable payload | `functions/src/gallery/index.ts:155` | correct — strips `coordinates` only, `approxLocation` passes |
| read predicate | `packages/shared/src/publicTaskLocation.ts:112-116` | correct — reads `approxLocation`, no fallback (deliberate) |
| marker build | `apps/creator-web/src/pages/GalleryPage.tsx:62-70` | correct |
| empty state | `apps/creator-web/src/components/GalleryMap.tsx:112` | correct — `points.length === 0`, so a mixed set is unaffected |
| default framing | `apps/creator-web/src/components/GalleryMap.tsx:58-59` | `center: [35, 31.5], zoom: 4` — the eastern Mediterranean the creator saw |

So there is **no field-name mismatch and no rendering bug**. Two data sources produce documents
without `approxLocation`:

- Documents published before `ad6a3e4`/`3953e1f` (legacy `coordinates`-only), repairable only by
  re-publishing the game or by an admin running `backfillPublicTaskCoordinatesNow`.
- The seed scripts, which still write the pre-privacy shape on **every** seed:
  `scripts/seed-local.mjs:173-177`, `scripts/seed-games-youth.mjs:1156-1167`,
  `scripts/lib/sansana-game-def.mjs:197-202`, `scripts/lib/qa-game-def.mjs:385-390`.

Note the emulator currently attached to this working tree serves **zero** `publicGames` and
`publicTasks` documents (verified by a read-only REST query), so the reporting environment's actual
documents could not be inspected from here. The seeder defect is proven from source; the legacy-doc
condition is proven from the change history and the absence of any automatic repair path.

## Goals / Non-Goals

**Goals**
- The unplottable-map state tells the creator what produces an area and what to do about it, in
  Hebrew and English, through `t.*`.
- "Which map state applies to this result set" is a pure, tested function — not an inline check.
- A seeded environment produces plottable public tasks and stops writing exact points into a
  world-readable collection.

**Non-Goals**
- Any fallback to `coordinates` on the read side. Explicitly forbidden.
- Changing the writer, the grid, the sanitizer or the callable payload. All verified correct.
- Automating, scheduling or re-authorizing the admin backfill sweep.

## Decisions

### 1. A pure `publicTaskMapCoverage(tasks)` classifier, in `@rushpoint/shared`

Added to `packages/shared/src/publicTaskLocation.ts` (the module that already owns both the write
rule and the read rule — a third place to reason about area presence would be a third place to get
it wrong):

```
type PublicTaskMapCoverage = 'no-results' | 'none-plottable' | 'partial' | 'all-plottable';
publicTaskMapCoverage(tasks): PublicTaskMapCoverage
```

It reuses `isPlottablePublicTask` per item, so the classifier can never disagree with the marker
filter about a single task. `'partial'` and `'all-plottable'` both mean "show the map, no empty
state"; they are kept distinct so a future "N of M shown" affordance needs no signature change.

**Why a classifier and not a boolean.** The renderer needs three outcomes from one input, and the
bug class the user hit is precisely a *misclassification* — a state that reads "nothing is here"
over data that has something. A named enum makes each outcome individually assertable.

**Why not in the component.** `GalleryMap` is deliberately domain-free (its header states that
domain filtering belongs to the caller), and creator-web has no component test runner. A predicate
in `shared` is covered by vitest in the fast lane.

### 2. `GalleryMap` gains an optional `emptyDetail` second line

`emptyLabel` stays the one-line reason. `emptyDetail` (optional, already localized) renders under
it in the same overlay. The component still renders the overlay purely on `points.length === 0`;
it gains no knowledge of tasks, games or areas.

### 3. `GalleryPage` selects the strings from the coverage value

```
coverage = publicTaskMapCoverage(tasks ?? [])
emptyLabel  = gl.noLocatedTasks           // unchanged wording
emptyDetail = coverage === 'none-plottable' ? gl.noLocatedTasksHelp : undefined
```

The games tab is untouched: `PublicGame.approxLocation` is a creator-authored, label-carrying field
written by `updateGame`, a different contract from the derived task area, and the games map was not
reported broken.

### 4. New i18n keys (HE + EN), no hardcoded strings

`gallery.noLocatedTasksHelp` — what publishes an area and why an entry may be missing one:
- HE: `אזור מפורסם נוצר כשמפרסמים את המשחק. משימות שפורסמו לפני העדכון הזה, ומשימות עם מיקום מוסתר, לא יופיעו במפה עד שהמשחק שלהן יפורסם מחדש.`
- EN: `A published area is created when a game is published. Missions published before this update, and missions with a hidden location, stay off the map until their game is published again.`

Deliberately phrased for the creator (re-publish), not the operator (run the sweep): the creator is
who sees this screen, and re-publishing is an action they can actually take. The operator remedy is
recorded in the Operator note below, not in product copy.

### 5. Seeders derive the public location from the shared rule

Each seed writer replaces `coordinates: t.coordinates` (and, in two of them, the
`t.hideLocation ? { lat: 0, lng: 0 } : …` improvisation) with:

```js
import { publicTaskLocation } from '@rushpoint/shared';
const approxLocation = publicTaskLocation(t);
… ...(approxLocation ? { approxLocation } : {}),
```

`@rushpoint/shared` already resolves from `.mjs` scripts (`e2e-verify.mjs:32`,
`proxy.mjs:6`), so this adds no build step. The `{lat:0,lng:0}` improvisation goes away because
`publicTaskLocation` treats null island as "unplaced" and omits the field — matching what
`publishGame` produces, which is the point: **seeded documents become byte-shape-identical to
published ones.**

### 6. The seeder rule is guarded by a source-level regression test

The seeders are `.mjs` I/O against a live emulator; they cannot run in the pure lane. Instead
`scripts/test-public-task-seed.ts` reads the four seed sources and asserts that each
`publicTasks/...` write derives `approxLocation` from `publicTaskLocation` and contains no
`coordinates:` key. Cheap, no emulator, and it fails loudly the next time someone hand-rolls a
public-task write — the exact regression this change is closing.

## Risks / Trade-offs

- **A source-text assertion is coupled to formatting.** Accepted: the alternative (running the
  seeders) needs an emulator, which this lane must not touch. The test matches on the semantic
  tokens (`publicTasks`, `approxLocation`, `publicTaskLocation`, `coordinates:`) inside the
  public-task write block, not on whitespace.
- **The message can be shown to a creator whose missions are legitimately all hidden-location.**
  The copy covers that case explicitly ("missions with a hidden location") rather than implying
  something is broken.
- **Legacy documents remain unplottable until repaired.** That is intentional and is the privacy
  guarantee; the change makes the state legible instead of silently wrong.

## Test Strategy

**Pure logic — vitest, `packages/shared/src/publicTaskLocation.test.ts` (extends the existing file):**

| Case | Expectation |
|---|---|
| task with coordinates **and** a published area | plottable; coverage `all-plottable` |
| task with coordinates but **no** `approxLocation` (the legacy doc) | not plottable; coverage `none-plottable` |
| task with a deliberately hidden location (writer emitted nothing) | not plottable |
| task with no location at all | not plottable |
| malformed / `NaN` / out-of-range / null-island `approxLocation` | not plottable |
| **mixed set** — some with areas, some without | coverage `partial` ⇒ the empty state must NOT apply |
| every item plottable | coverage `all-plottable` |
| empty array | coverage `no-results` |
| `null` / `undefined` entries inside the array | tolerated, counted as not plottable |

**Pure logic — tsx, `scripts/test-public-task-seed.ts`** (auto-collected by
`scripts/run-unit-tests.mjs`): each of the four seed sources writes `approxLocation` via
`publicTaskLocation` into its `publicTasks/{id}` document and writes no `coordinates` key there.

**Callable lane:** none. `searchTaskLibrary`'s payload was traced and is correct
(`functions/src/gallery/index.ts:155` keeps `approxLocation`); the publish/backfill behavior is
already covered by the `hidden-location leak` and `publicTasks legacy-coordinate backfill`
scenarios in `scripts/e2e-verify.mjs:6782-6947`. **No assertions are added to `e2e-verify.mjs` and
the e2e suite is deliberately NOT run** — a live playtest stack owns the emulator for this lane.

**UI:** `npm run i18n:check` (PART A hard gate) plus `npm run i18n:check:strict` for zero new
PART B findings; both new strings go through `t.gallery.*`. Visual verification of the map overlay
is left to the operator — the preview pane is not available to this lane.

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
`npm run play:build`, `npm run i18n:check`.

## Operator note (not product copy)

To repair legacy `publicTasks` documents in a given environment, an **admin** calls
`backfillPublicTaskCoordinatesNow` — `{ dryRun: true }` first to see `scanned/repaired/cleared/
orphaned`, then paged with `{ startAfter: <cursor> }` until `done: true`
(`functions/src/maintenance/index.ts:260-270`). Re-publishing an individual game repairs that
game's tasks with no admin involvement. **Neither has been run from this lane** — it requires a
real emulator or production credentials.
