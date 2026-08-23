# Design — gallery-mission-detail

## 1. What the client already has (audited, with file:line)

`searchTaskLibrary` (`functions/src/gallery/index.ts:122-158`) returns `{ tasks, likedIds }` where
each task is a whole `PublicTask` **minus** the deprecated exact point:

```ts
// functions/src/gallery/index.ts:154
const tasks = ranked.map(({ coordinates: _exact, ...safe }) => safe);
```

`PublicTask` (`packages/shared/src/types/index.ts:618-655`) carries: `id`, `sourceGameId`,
`sourceGameTitle?`, `ownerUid`, `ownerDisplayName?`, `title`, `description?`, `type`,
`coordinates?` (deprecated, stripped on the wire), `approxLocation?`, `difficulty`,
`estimatedMinutes`, `pointValue`, `tags?`, `copyCount`, `likeCount?`, `popularity?`, `createdAt`.

**Conclusion: no callable is needed.** Both call sites already hold the complete payload in state
(`GalleryPage.tsx:31` `tasks`, `TaskLibrary.tsx:52` `tasks`). Adding a `getPublicTask` callable
would (a) duplicate a payload already in memory, (b) add a rate-limited round trip on every press,
and (c) trip the e2e callable-coverage guard for no behavioral gain. Not done.

## 2. Why the decision lives in a pure module

creator-web has **no component test runner** (CLAUDE.md). The only way to prove "the detail view
never shows an answer key" is to make the detail view a **value**, produced by a pure function, and
assert on that value. So:

```
PublicTask (from the callable)  ──buildGalleryTaskDetail()──▶  GalleryTaskDetail  ──▶  <GalleryTaskDetailModal>
                                        (pure, tested)              (a plain object)        (dumb renderer)
```

The renderer holds no field knowledge: it walks `detail.rows` and maps `row.key` to an i18n label.
A field can therefore only appear on screen if `buildGalleryTaskDetail` put it in the object, and
the test suite asserts over `JSON.stringify(detail)` that no secret value is in there.

### Copy-out, never strip-out
`buildGalleryTaskDetail` **constructs** its result field by field from named reads. It never spreads
the input. This is the important direction: a strip-list (`const { hint, ...rest } = task`) is
correct only for the secrets someone remembered, and silently leaks the next field `PublicTask`
grows. A copy-out list leaks nothing by construction, and the cost of forgetting is a *missing* row,
which is visible, not a *leaked* row, which is not.

The secret names are still declared explicitly as `SECRET_TASK_FIELD_NAMES` so the test can sweep
them, and so the intent is greppable, but they are documentation of the test, not the mechanism.

## 3. The view model

```ts
export type GalleryTaskTypeKey = TaskType | 'unknown';

export type GalleryDetailRowKey =
  | 'type' | 'difficulty' | 'estimatedMinutes' | 'points'
  | 'copies' | 'likes' | 'source' | 'author' | 'published';

export interface GalleryDetailRow { key: GalleryDetailRowKey; value: string | number }

export interface GalleryTaskDetail {
  id: string;
  title: string;
  /** null when the author wrote none — the UI says so rather than showing a gap. */
  description: string | null;
  typeKey: GalleryTaskTypeKey;
  rows: GalleryDetailRow[];
  tags: string[];
  /** COARSE area only. Never the exact authored point. */
  area: { lat: number; lng: number } | null;
  areaState: 'area' | 'no-area';
}
```

### Row order and suppression

| # | key | value | suppressed when |
|---|---|---|---|
| 1 | `type` | the `GalleryTaskTypeKey` string | never (falls back to `unknown`) |
| 2 | `difficulty` | integer 1..10 | value is not a finite number |
| 3 | `estimatedMinutes` | positive number | value is not finite or `<= 0` |
| 4 | `points` | non-negative integer | value is not a finite number |
| 5 | `copies` | non-negative integer | never (absent ⇒ `0`) |
| 6 | `likes` | non-negative integer | count is `0` (a zero-likes row is noise) |
| 7 | `source` | `sourceGameTitle` | blank or absent |
| 8 | `author` | `ownerDisplayName` | blank or absent |
| 9 | `published` | `YYYY-MM-DD` | `createdAt` absent or unparseable |

`published` is normalized to `YYYY-MM-DD` **in the pure module**, deliberately not in the renderer:
a `toLocaleDateString` in the component would be untestable and would render differently per
machine. A date is a fact, not copy.

**Difficulty is clamped to 1..10 and rounded**, matching `TaskCard`'s `DifficultyDots`
(`apps/creator-web/src/components/TaskCard.tsx:27`). Points and copies are floored at 0. A stored
`NaN` therefore never reaches the DOM as the string "NaN".

### Location
`area` is populated **only** through `isPlottablePublicTask` from `@rushpoint/shared`
(`packages/shared/src/publicTaskLocation.ts:133`) — the same predicate `GalleryPage` filters its map
markers with (`GalleryPage.tsx:63`). Reading `approxLocation` directly would be a second, drifting
copy of the reader's rule; that drift is exactly what `publicTaskMapCoverage` was written to prevent.
There is **no fallback to `coordinates`**: the field is deprecated, is stripped on the wire, and
falling back to it is the exposure the whole `task-library-map-view` change exists to close.

`areaState` is `'no-area'` for a hidden-location, locationless or unplaced mission, and the modal
prints the explanation rather than an empty map slot (the mistake `public-task-area-visibility`
fixed on the library map).

### Never throws
`buildGalleryTaskDetail` accepts `unknown` and tolerates `null`, a non-object, and every field being
the wrong type. It runs on a callable response inside a modal; a throw there blanks the Gallery
behind an ErrorBoundary. A garbage input yields a detail with a blank title and the `unknown` type,
never an exception.

## 4. UI

`apps/creator-web/src/components/GalleryTaskDetailModal.tsx` — new, presentational.

- Same modal shell as `TaskLibrary.tsx:74-76`: fixed overlay, backdrop click closes, `Card` body,
  `max-h-[80vh]` with an internal scroll. Consistency with the existing design system beats a new
  side panel, and the Builder's library is itself already a modal (a panel inside a modal would be
  the second stacking context).
- Closes on **Escape** as well as backdrop and the ✕ button. `role="dialog"` + `aria-modal` +
  `aria-labelledby` pointing at the title.
- The map is `React.lazy(() => import('./GalleryMap'))` behind a `Suspense`, so opening a detail is
  what pulls MapLibre in, not mounting the modal file. Single `MapPoint`, amber marker, the same
  `gl.approxPinsNote` caption the library map already carries.
- A standing note (`gl.detailSecretNote`) states that answers, codes and hints stay with the author.
  This is not decoration: a creator evaluating a quiz mission will otherwise assume the missing
  answer list is a bug in the view.
- **Action:**
  - from `TaskLibrary` (Builder): the modal receives `onUse` and shows the real
    "use this mission" button, which runs the existing `pick()` path (insert + `incrementTaskCopyCount`).
  - from `GalleryPage`: no `onUse`; the modal shows `gl.detailUseHint` telling the creator the
    mission is added from the Builder's mission library. The Gallery has no target game, so an
    "insert" there would have nowhere to insert to.

### Press targets
- `GalleryPage` mission card: the whole `Card` becomes a `role="button"` div with `tabIndex={0}` and
  Enter/Space, exactly like `TaskCard` — *not* a `<button>`, because the card already contains the
  interactive `LikeButton`, and nested interactive content inside a `<button>` is invalid HTML and
  unreachable by keyboard in Safari (the reason recorded at `TaskCard.tsx:73-76`). The `LikeButton`
  gets `stopPropagation` so liking never opens the detail.
- `TaskLibrary` row: same treatment; the existing "insert" button gets `stopPropagation` so the
  one-tap insert path is preserved for creators who already know the mission.

## 5. Test strategy

**Lane: pure.** `scripts/test-gallery-task-detail.ts`, auto-discovered by
`scripts/run-unit-tests.mjs`. Run: `npx tsx scripts/test-gallery-task-detail.ts`.

1. **Secrecy (mandatory).** Build a detail from a `PublicTask`-shaped object polluted with
   `answers: ['CORRECT-ANSWER']`, `numericAnswer: 4242`, `numericTolerance`, `hint: 'SECRET-HINT'`,
   `hintPenalty`, `steps: [{ answer: 'STEP-ANSWER' }]`, `smart: { secretCode: 'SECRET-CODE' }`,
   `secretCode: 'SECRET-CODE'`, `choices`, `surveyChoices`, and an exact
   `coordinates: { lat: 31.7767, lng: 35.2345 }`. Assert that the serialized detail contains none of
   the sentinel strings, none of the sentinel numbers, and none of the secret **key names**; and
   that the exact latitude does not appear anywhere.
2. **Exact coordinates never become the area.** A task with `coordinates` but **no**
   `approxLocation` yields `area === null` / `areaState === 'no-area'`.
3. **Area passthrough.** With a valid `approxLocation` the area is exactly it, and it agrees with
   `isPlottablePublicTask` for a matrix of inputs (absent, `NaN`, out-of-range, string, valid).
4. **Rows.** Full task ⇒ the documented order; each suppression rule ⇒ the row is absent; zero
   likes ⇒ no likes row; blank/whitespace source or author ⇒ no row.
5. **Normalization.** `difficulty` `0`/`99`/`NaN`; `pointValue` `-5`/`NaN`; `copyCount` absent;
   `estimatedMinutes` `0`/negative/`NaN`; `createdAt` valid ISO / `'not a date'` / absent.
6. **Type key.** All nine `TaskType`s round-trip; unknown / absent / non-string ⇒ `'unknown'`.
7. **Totality.** `null`, `undefined`, `42`, `'x'`, `[]`, `{}` never throw and always yield a
   well-formed detail.
8. **Wiring guards** (source scans, the pattern used by `scripts/test-held-team-notice.ts`):
   `GalleryTaskDetailModal.tsx` references no secret field name and does not read `.coordinates`;
   both call sites import and open the modal; `i18n.ts` defines every new key in **both** language
   maps.

**Lane: UI.** `npx tsx scripts/check-i18n.ts --strict` must stay clean, zero new PART B findings.
Visual check via the preview tools (Gallery ▸ mission library ▸ press a card; Builder ▸ add mission
from library ▸ press a row).

**Lane: e2e.** Nothing to add. No callable is added or changed. `ALLOWED_TASK_KEYS` in
`scripts/e2e-verify.mjs` is untouched because no `Task` field is added.

## 6. Non-decisions worth recording

- **No new Firestore index, no rules change, no env var.**
- **`popularity` is deliberately not shown.** It is a server-internal ranking score, not a fact a
  creator can act on, and surfacing it invites gaming the sort.
- **`ownerUid` / `sourceGameId` are not shown.** They are opaque ids; the human-readable
  `ownerDisplayName` / `sourceGameTitle` are what the creator can use.
