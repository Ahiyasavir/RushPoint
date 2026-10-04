## Context

Templates are ordinary `Game` documents owned by an admin and flagged
`isTemplate: true`. Two callables read that catalogue and both key on the same
flag:

- `listGameTemplates` — any authenticated creator. A `collectionGroup('games')`
  query, `.select(...TEMPLATE_LIST_FIELDS)`, tombstones filtered in memory.
- `listAdminTemplates` — admin only. `users/{adminUid}/games`, same flag, same
  in-memory tombstone filter.

`setGameTemplateFlag` writes `isTemplate` plus `templateEmoji`, `templateOrder`,
`templateGroupKey`, `templateLang`, `templateGenre`. `createGameFromTemplate`
copies a template into the caller's account.

Because one flag drives both listings, "take it out of the picker" and "take it
out of my builder" are the same action. There is no third state.

Three properties of this codebase constrain the design, and each has already
caused a silent failure documented in CLAUDE.md:

1. **`TEMPLATE_LIST_FIELDS` is a Firestore field mask.** Adding `templateGenre`
   to the `Game` type, to the writer and to the client, but not to the mask,
   shipped `templateGenre: undefined` to every browser while Firestore held the
   value. Nothing threw.
2. **`where('x', '==', false)` does not match documents that lack `x`.** This is
   why the tombstone filter runs in memory rather than as a query clause.
3. **A list is not an authorization boundary.** Anything reachable by id must
   check for itself.

## Goals / Non-Goals

**Goals**

- An admin can park a template — out of the creator picker, still in their
  builder, still editable.
- Zero migration. Every template that exists today keeps behaving identically
  with no field written to it.
- Hiding is enforced where it matters: the instantiation callable, not only the
  listing.
- The three traps above are closed by construction and pinned by tests, not by
  reviewer memory.

**Non-Goals**

- Per-creator or per-cohort visibility (show this template only to schools).
  That is an audience system, not a visibility flag, and nothing asks for it yet.
- Scheduled visibility (publish on a date). `Stage.releaseAt` exists for stages;
  a template scheduler is a separate feature with its own clock problems.
- Draft/published *versioning* of a template's content. Hidden is about the
  catalogue, not about having two copies of a game.
- Changing who may administer templates. `authorization` is untouched.

## Decisions

### D1 — A boolean `templateHidden`, not a `templateStatus` enum

**Chosen:** `templateHidden?: boolean` on `Game`.

The spec is two-valued and the absent case must mean visible. A boolean whose
absent and `false` cases are identical expresses that exactly; an enum
(`'visible' | 'hidden'`) has three states in practice — the two named ones plus
`undefined` — and every reader would have to remember which way `undefined` falls.

**Rejected:** `templatePublished?: boolean`. Same shape, wrong default: absent
would have to mean *published*, i.e. `undefined` reads as `true`, which is the
inversion that trips people up. Naming the field after the non-default state
keeps "absent means the ordinary case" true by reading.

**Consequence to hold:** the only correct test is `templateHidden === true`.
Truthiness (`if (g.templateHidden)`) is equivalent here but `!== false` is not,
and a future `templateHidden: null` from a cleared client field must not read as
hidden. The predicate lives in ONE exported function so this cannot be decided
twice — see D3.

### D2 — Filter in memory, next to the tombstone filter

The visibility filter runs on the fetched rows, in the same pass that already
drops tombstones, and NOT as a `where()` clause.

A query clause would be `where('templateHidden', '==', false)`, which silently
excludes every template that predates this change — the entire current
catalogue — because Firestore does not match documents missing the field. The
in-memory filter is the same decision the tombstone filter already made, for the
same reason, so it also needs no new composite index.

Cost: hidden templates are fetched and discarded. The dataset is a handful of
documents and the comment in `listGameTemplates` already calls it small.

### D3 — One predicate, exported, used by all four call sites

`isTemplateHidden(game): boolean` in `packages/shared`, next to the other
template helpers. Both listings, the instantiation guard and the admin page read
it.

This is the countermeasure to the field-mask trap. The predicate takes the
partial document a mask returns, and its test asserts the behaviour on a document
where the field was *not selected* — which is what makes the mask omission a
failing test rather than a quiet no-op. Four hand-rolled `g.templateHidden ===
true` checks would each look correct in review and one of them would be reading
`undefined`.

### D4 — `templateHidden` joins `TEMPLATE_LIST_FIELDS`, and a test pins the pair

The mask gains the field. Separately, a test asserts that every field the
creator-facing filter or projection reads is present in the mask.

Adding the field is a one-line fix; the test is the part that matters, because
the same omission has already shipped once with `templateGenre` and would
otherwise be waiting to happen again for the next field.

### D5 — `createGameFromTemplate` refuses hidden templates, owner included

The callable already loads the template document to copy it. The refusal is a
`failed-precondition` on that loaded document, before anything is written.

No owner exemption. An admin who wants to work on a hidden template opens it in
the Builder, which is what "still in my builder" means; giving the owner a
special instantiate path would create a second way to produce games from
unfinished content and a second thing to keep in sync.

This is also what makes cache staleness a non-issue (see the spec's last
requirement): a creator whose cached menu still lists a hidden template gets a
clean refusal instead of a half-created game.

### D6 — `setGameTemplateFlag` treats the field as optional-and-sticky

Absent means "do not touch". Only an explicit boolean writes.

The callable's existing fields already behave this way, and the alternative —
defaulting a missing value to visible — would mean that editing a hidden
template's emoji un-hides it. That is the "clearing an optional field" class of
bug CLAUDE.md documents on `updateGame`, arriving from the other direction.

Validation: reject anything that is not a boolean with `invalid-argument`, rather
than coercing. `null` from the callable transport is not a boolean and is
therefore refused, which is correct — there is no "clear this" meaning to express
for a field whose absent state is already the default.

### D7 — The admin page shows state, and the control is not a delete

The row gets a badge and a toggle labelled for what it does to CREATORS ("not
offered to creators"), not for what it does to the document ("hidden"). An admin
looking at their own list is asking "can people see this", and the destructive
neighbour on that page is `deleteGame` — the two must not read alike.

## Risks / Trade-offs

- **[The mask omission repeats for a future field]** → D4's test asserts mask
  membership for every field the creator path reads, so the next field fails the
  gate rather than shipping `undefined`.

- **[A reviewer adds a fifth call site with its own inline check]** → D3 puts the
  predicate in shared and the tests import it; an inline `=== true` elsewhere is
  visible in review as a duplicate of a named function. Not mechanically
  enforced — accepted.

- **[Hiding every template empties the guided path]** → The wizard already has a
  copy string for an empty catalogue (`noGenreTemplates`) and the `scratch` path
  never depends on templates, so the floor is a real, already-handled state
  rather than a dead end. Deliberately NOT adding a refusal like the mission
  bank's bookend guard: an admin emptying their own catalogue on purpose is a
  legitimate act, unlike a stored row silently emptying a pool.

- **[Hidden templates still cost a read in `listGameTemplates`]** → Accepted;
  the catalogue is a handful of documents and the query is already uncapped by
  design.

- **[A creator mid-flow when a template is hidden]** → They get a
  `failed-precondition` at instantiation. The message must say the template is no
  longer available rather than surfacing an internal state name.

## Migration Plan

None required, and that is a design goal rather than an omission: absent means
visible (D1), so no template needs a write for the change to deploy safely.

Deploy order is unconstrained — the field is additive, old clients ignore it, and
a new client reading an old document sees `undefined` and treats it as visible.

Rollback: revert the code. No data written by this change needs undoing; a
`templateHidden: true` left behind by a rolled-back deploy is an unknown field on
a `Game`, which is inert.

## Open Questions

Both answered during task 1 (reconnaissance), before any code was written.

### RESOLVED — Does hiding a template also close `duplicateGame`'s `shareToken` door?

**No, and deliberately not.** `functions/src/games/share.ts` contains no
reference to `isTemplate` at all: the share door resolves owner and game from a
token the admin minted **on purpose** for one specific game, and can revoke with
`revokeGameShareLink`.

That is a different grant from the public catalogue. The catalogue is "anyone
authenticated may start a game from this"; a share token is "I gave this link to
this person". Hiding a template says the first thing, not the second, and
silently revoking deliberately-issued links as a side effect would be the sort of
invisible consequence this codebase keeps getting bitten by. An admin who wants
to stop sharing has a tool for it.

### RESOLVED — Does the template cache or the picker need the new field?

**Neither needs it, for the same reason: the server filters, so a hidden template
never reaches the client at all.**

- `TemplateVariant` (services/calls.ts) is a PROJECTED shape, not a `Game`. It
  gains no field: there is nothing to represent, because the row is absent.
- `lib/templateCache.ts` needs no change. It already exports
  `invalidateTemplateCache()` and `AdminTemplatesPage.tsx` already calls it
  (line 67) after a flag write — the admin who makes the change is otherwise the
  one person still seeing the old menu. The visibility toggle rides that path.
- The ≤24h `TEMPLATE_MAX_AGE_MS` stale window on other creators' devices is
  precisely what decision D5 exists to cover: the refusal at instantiation is
  what makes cache freshness a non-issue rather than a race.

### RESOLVED — a simplification the reconnaissance surfaced

`listAdminTemplates` returns `{ games: Game[] }` in full — no field mask. So the
state reaches the admin builder **automatically** the moment `templateHidden` is
on the `Game` type, and task 5.2 is a no-op on the server. Only the creator-facing
`listGameTemplates` masks its fields, which is why D4's trap applies to that one
listing and not to both.

### RESOLVED — grouping is safe by ordering

`listGameTemplates` builds its HE/EN variant groups by iterating the rows that
SURVIVED filtering. Filtering hidden rows in the same pass as tombstones (D2)
therefore means a group whose only variant is hidden is never constructed — no
empty group reaches the picker — and a group with a visible Hebrew variant and a
hidden English one correctly keeps the Hebrew one. No extra guard is needed, but
the ORDER is load-bearing: filter before grouping, never after.

### RESOLVED — should any current site template seed hidden (task 9.2)

**No.** All eight `SITE_TEMPLATES` declarations (`education`, `family-home`,
`help-at-home`, `team-building`, `birthday`, `bar-mitzvah`, `wedding`,
`youth-movement`) are finished, research-backed content — `test-site-templates.ts`
holds all of them to the full `gameStructureProblems` go-live battery, the audience
checks, and the declared session-length band. None is a stub or a work in
progress; the three that were originally deferred (`bar-mitzva`, `hatuna`,
`tnuat-noar`) were completed in the same body of work that added `SiteTemplateDecl
.hidden`, so the situation that motivated the question no longer exists.

The mechanism (`decl.hidden` → `templateHidden: true` in `seed-site-templates.ts`)
stays in place for the NEXT time a template is authored incrementally — that is
what task 9.2 asked to decide, and the decision is: use it then, not now.
