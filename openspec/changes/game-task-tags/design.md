## Context

`tags` exists on four types and is written by three code paths, read by two callables, and rendered
by zero components. Everything below was verified in this working tree.

**What already works** (and must not be broken):

- `Game.tags: string[]` (`packages/shared/src/types/index.ts:503`), `Task.tags?: string[]` (`:373`),
  `PublicGame.tags: string[]` (`:575`), `PublicTask.tags?: string[]` (`:634`);
  `CreateGamePayload.tags?` (`:1248`) and `UpdateGamePayload.tags?` (`:1261`).
- Persist: `createGame` writes `tags` into the game doc (`functions/src/games/index.ts:186`);
  `updateGame` writes it (`:254`).
- Denormalize: the published-game resync copies `merged.tags` into `publicGames` (`:307`);
  `publishGame` writes `game.tags` into the `PublicGame` (`:683`) and `task.tags` into each
  `PublicTask` (`:733`).
- Return: `searchGallery` returns whole `PublicGame` docs and already ranks on tags
  (`functions/src/gallery/index.ts:110`); `searchTaskLibrary` returns whole `PublicTask` docs minus
  the deprecated exact `coordinates` (`:143`, `:155`). Neither strips `tags`.
- Sanitizer: `tags` is in `ALLOWED_TASK_KEYS` (`scripts/e2e-verify.mjs:242`) and passes through
  `sanitizeTaskForParticipant` inside `...rest` (`functions/src/runs/sanitizeTask.ts:74`).
- Builder input: `TagsField` (`apps/creator-web/src/pages/BuilderPage.tsx:757-779`), mounted on
  Step 1 "Details" at `:623`, keeps the raw typed string in local state and derives the array with
  `parseTagsInput` — a hard-won fix (binding `value={tags.join(', ')}` ate the separator mid-typing;
  the comment at `:752-756` records it). Labels `b.tagsLabel` / `b.tagsPlaceholder` already exist in
  both dictionaries (`apps/creator-web/src/i18n.ts:975-976` HE, `:2045-2046` EN).
- `scripts/test-tags-input.ts` already covers ten `parseTagsInput` cases in the pure lane.

**What does not exist:**

- Any render of `tags`. Grepping `tags` across `apps/creator-web/src` and `apps/play-web/src` yields
  the Builder input, the library copy at `TaskLibrary.tsx:33`, the `calls.ts` request types
  (`:134-135`) and test fixtures — and nothing else.
- Any task-level tags input. `TaskWizard.tsx`'s Advanced section edits points / est. minutes /
  max teams / trigger radius / expiry (`:1117-1145`) and no tags.
- Any server-side validation. `updates.tags = tags` (`games/index.ts:254`) is the entire guard.
- Any shared parser. `parseTagsInput` is in `apps/creator-web/src/lib/tags.ts`, which
  `functions/` cannot import.

Hard constraint: **a live playtest stack is serving from this tree.** No emulator, Vite, tunnel or
backup process may be started or stopped, and `npm run e2e` must not be run. All verification here is
pure-logic + static gates; the e2e assertions are authored and left unrun, and the browser rendering
of the new chips is left unverified and flagged.

## Goals / Non-Goals

**Goals:**
- One pure, total, shared definition of tag normalization, used identically by client and server, so
  what the creator sees and what is stored can never diverge.
- A comma is a separator in every tags field, and the field tells the creator so.
- Correct for Hebrew, mixed Hebrew/English, and pasted lists — this is a Hebrew-first product.
- The stored list is bounded regardless of what a client sends.
- Tags are visible everywhere a tagged item is shown.

**Non-Goals:**
- Filtering or searching by tag from the UI (the callable argument already exists; the interaction
  does not, and is out of scope).
- Autocomplete, suggested tags, a controlled vocabulary, or merging synonyms.
- Changing the sanitizer allowlist, the Firestore rules, or any callable signature.
- Backfilling or migrating stored tag arrays.

## Decisions

### D1 — The normalizer lives in `packages/shared`, not in either app

`normalizeTags` goes in a new `packages/shared/src/tags.ts` and is re-exported from the package
index, next to `validation.ts` and `geo.ts`. `functions/` and both apps already depend on
`@rushpoint/shared`; a parser that only creator-web can reach is precisely why the server has no
guard today.

`apps/creator-web/src/lib/tags.ts` is **kept** as a one-line delegation
(`export const parseTagsInput = (raw: string) => normalizeTags(raw)`) rather than deleted, so
`BuilderPage.tsx:41`'s import and the existing `scripts/test-tags-input.ts` keep working unchanged.

### D2 — One function, two input shapes

`normalizeTags(input: string | string[] | null | undefined): string[]`.

A single entry point handles both callers: the UI passes the raw typed string; the server passes the
array off the payload (whose elements may themselves contain commas — a client is free to send
`["a, b"]`, and normalizing it the same way is the only way client and server agree). A non-array,
non-string input (number, object, `null`, `undefined`) returns `[]` — total, never throws. Array
elements that are not strings are skipped, not stringified: `String({})` is `"[object Object]"`, and
storing that as a tag would be worse than dropping it.

### D3 — Separators: the comma family plus newlines

Split on `,` (U+002C), `،` Arabic comma (U+060C), `，` fullwidth comma (U+FF0C), and any line break.

Rationale, since the prompt asks for an explicit decision on the non-ASCII comma: this product is
Hebrew-first and phone-first. Hebrew Android/iOS layouts sit one long-press from an Arabic layout,
and several third-party IMEs emit U+060C on the comma key; a fullwidth comma arrives via paste from
a CJK-authored document. Neither character is ever meaningful *inside* a tag, so accepting them is
free and refusing them produces exactly the reported bug ("my comma does nothing") for a subset of
users we cannot see. Newlines are accepted so pasting a bulleted/one-per-line list works.

**Not** accepted as separators: semicolon (legitimately appears in authored prose), and the Hebrew
maqaf/geresh punctuation (legitimately appears inside Hebrew words). Whitespace alone is not a
separator — that is what makes multi-word tags like `old city` / `העיר העתיקה` possible, and the
prompt requires them.

### D4 — Trimming and internal whitespace

Each segment is trimmed of Unicode whitespace, and internal whitespace runs collapse to one space
(`old   city` → `old city`), so two visually identical tags typed with different spacing are one
tag. Zero-width and bidi-control characters are stripped: this repo already treats them as a
spoofing vector for authored display text (`stripUnsafeDisplayChars`, applied to titles at
`functions/src/games/index.ts:177-179`), and a tag is authored display text shown to strangers in a
world-readable gallery. Emoji and combining marks are untouched — the codebase explicitly warns that
naive normalization "destroys ZWJ emoji sequences" (`packages/shared/src/gameFile.ts:503`), so no
Unicode normalization form is applied.

An empty segment is dropped. That covers `a,,b`, a trailing comma `a,b,`, a leading comma, and a
whitespace-only input.

### D5 — De-duplication is case-insensitive, first-seen casing wins

The comparison key is the segment lowercased with `toLowerCase()`; the value stored is the segment
**as first typed**. `Park, PARK, park` → `["Park"]`.

Rationale: a gallery showing `Park` and `park` as two chips reads as a bug, and matching is
case-insensitive everywhere else in this codebase's search (`publicTextMatch`,
`functions/src/gallery/index.ts:29`). Preserving the first casing rather than forcing lowercase keeps
proper nouns (`Jerusalem`) and acronyms (`GPS`) looking authored. Hebrew has no case, so
`toLowerCase()` is identity for it and cannot mangle it. `toLowerCase()` rather than
`toLocaleLowerCase()` deliberately: the locale-aware variant makes the result depend on the *user's*
locale, so the same input would dedupe differently on a Turkish device than on the server — client
and server must agree, so the invariant culture wins.

### D6 — Caps: clamp, never reject

`MAX_TAGS = 20`, `MAX_TAG_LEN = 40` — the values already in `apps/creator-web/src/lib/tags.ts:9-10`,
kept so no currently-savable game becomes unsavable. A tag longer than the cap is **truncated**
(then re-trimmed, so truncation cannot leave a trailing space); tags past the count cap are
**dropped**. Ordering: truncate → trim → drop-if-empty → dedupe → stop at the count cap, so the cap
counts *kept* tags, not raw segments (`a,a,a,b` with a cap of 2 yields `["a","b"]`, not `["a"]`).

Clamping rather than throwing is a deliberate product call: the Builder autosaves, so a validation
throw on tags would fail the whole save and lose unrelated edits the creator just made. The one
thing the server must guarantee is that the stored list is bounded — 20 tags × 40 chars ≈ 800 bytes
worst case, versus the unbounded field today.

### D7 — Where the server applies it

Three call sites in `functions/src/games/index.ts`, chosen so no path into storage is unguarded:

1. `createGame` — `tags` from `CreateGamePayload` (`:164`) → normalized before the doc is written.
2. `updateGame` — `updates.tags` (`:254`) → normalized. Also each task's `tags` inside the stages
   array, applied inside the existing `sanitizeStagesText` pass so a **new stages array** is
   produced (`:249`); this repo's hard rule is never to dotted-update an array element.
3. `publishGame` — the `PublicGame.tags` (`:683`) and per-`PublicTask.tags` (`:733`) writes are
   normalized on the way into the world-readable collections, so a document written by the old
   unguarded code is cleaned by its next publish instead of persisting forever.

The published-game resync at `:307` reads `merged.tags`, which is the already-normalized value from
step 2, so it needs no separate call.

`normalizeTags` is called on the server even when the client already called it. It is idempotent
(`normalizeTags(normalizeTags(x)) === normalizeTags(x)`, asserted in the tests), so the double call
is free — and the server must not depend on a client having run it.

### D8 — Rendering: one chip component per app, four call sites

A tiny presentational `TagChips` in each app (not shared — creator-web is dark-themed and play-web
reverses the zinc scale, so a shared component would need a theme prop for no benefit). Rules that
apply to all of them:

- Static Tailwind class strings only.
- The chip text is creator-authored, so `dir="auto"` on the element carrying it; the surrounding
  layout uses logical classes so an RTL chip row is not misaligned.
- Renders nothing at all (not an empty box) when the list is empty.
- Caps the number of visible chips and appends a `+N` overflow indicator, so a 20-tag game cannot
  blow out a card's height. The `+N` text is a `t.*` formatter, not string concatenation.

Call sites: creator-web gallery **game** card, creator-web gallery **mission** card, creator-web
Builder Details step (a live preview of what the raw input parsed to — which is also what makes the
comma behavior *visible* while typing, the second half of the reported bug), and play-web
`GamePromoScreen`.

### D9 — Discoverability of the comma

The existing label is already `tagsLabel: 'Tags (comma separated)'` / `'תגיות (מופרדות בפסיק)'`
(`apps/creator-web/src/i18n.ts:2045` / `:975`) and the placeholder already shows a comma-separated
example — yet the creator still reported that commas do nothing. The label is not the problem; the
absence of *feedback* is. So the fix for discoverability is the live chip preview under the field
(D8): typing a comma visibly splits one chip into two. A short helper line under the field states
the rule in words as well, in both dictionaries.

### D10 — E2E assertions are written, not run

New assertions go into the gallery/task-library scenario of `scripts/e2e-verify.mjs`: publish a game
whose game tags and task tags were sent in adversarial form (a client-side-unnormalized array with
duplicates, blanks, differing case and an over-long tag, plus a 50-element list), then assert the
`searchGallery` / `searchTaskLibrary` payloads come back normalized and capped. No allowlist edit is
required — `tags` is already in `ALLOWED_TASK_KEYS` (`e2e-verify.mjs:242`) — so the callable-coverage
and sanitizer guards are untouched. The suite is **not executed**: a live playtest stack owns the
emulator. This is recorded as unverified, not assumed green.

## Risks / Trade-offs

- **Silent data loss in the normalizer.** It drops and truncates by design. Mitigated by purity and
  totality (every input has a defined output) and by testing both caps at `n-1` / `n` / `n+1` rather
  than only in the middle.
- **Case-insensitive dedupe is lossy for a creator who genuinely wants `IT` and `it`.** Accepted:
  two chips differing only in case read as a duplicate to every reader, and search is already
  case-insensitive.
- **Accepting U+060C/U+FF0C means a creator can never have one inside a tag.** Accepted: no
  plausible tag contains one, and the failure mode of *not* accepting them is the bug being fixed.
- **`stripUnsafeDisplayChars`-style stripping could in principle alter an exotic legitimate tag.**
  Scoped to zero-width + bidi-control characters only; no normalization form is applied, so emoji
  ZWJ sequences and Hebrew niqqud survive.
- **Chip rendering is unverified in a browser.** The live stack cannot be restarted, so correctness
  rests on the type checker, the lint rule set, both production builds and the i18n gate. Called out
  explicitly.

## Test Strategy

All automated coverage is in the **pure-logic lane** — no emulator, no DOM.

**`scripts/test-tags.ts`** (new; house style of `scripts/test-tags-input.ts`: `check(name, cond)`,
counters, `process.exit`), importing `normalizeTags` from `@rushpoint/shared`:

*Splitting*
- `'a, b, c'` → `['a','b','c']`; `'a,b,c'` (no spaces) → same.
- Arabic comma `'a، b'` and fullwidth comma `'a，b'` → `['a','b']`.
- Newline-separated and CRLF-separated input → split.
- Mixed separators in one string.

*Trimming and empties*
- `'  a ,  b '` → `['a','b']`; `'a,,b'` → `['a','b']`; `'a,b,'` → `['a','b']`; `',a'` → `['a']`.
- `''` → `[]`; `'   '` → `[]`; `' , , '` → `[]`; `undefined` → `[]`; `null` → `[]`.
- `'old   city'` → `['old city']` (internal run collapsed); `'old city'` survives as ONE tag.
- A zero-width joiner-free zero-width space inside a tag is stripped; an emoji tag survives intact.

*De-duplication*
- `'a, a, b'` → `['a','b']`.
- `'Park, park, PARK'` → `['Park']` — first-seen casing preserved (the documented D5 rule).
- `'Park , park'` (whitespace-differing) → `['Park']`.

*Hebrew and mixed direction*
- `'חוץ, חידה, משפחה'` → three tags, byte-identical to the input segments.
- `'העיר העתיקה, ירושלים'` → `['העיר העתיקה','ירושלים']` (multi-word Hebrew preserved).
- `'ירושלים, Jerusalem, טיול'` → three tags, neither script mangled.
- A Hebrew tag round-trips: `normalizeTags(normalizeTags(x).join(', '))` equals `normalizeTags(x)`.

*Caps (boundaries, not midpoints)*
- 19 / 20 / 21 distinct tags → 19 / 20 / 20 kept.
- A tag of 39 / 40 / 41 chars → length 39 / 40 / 40.
- A 41-char tag whose 41st-char truncation would leave a trailing space is re-trimmed (no trailing
  space in the output).
- A 10 000-tag array and a 1 MB single tag → ≤ 20 tags, each ≤ 40 chars. This is the payload-weapon
  case and is asserted on the *array* input shape, which is what a hostile client actually sends.
- `'a,a,a,b'` with duplicates ahead of the cap: the cap counts kept tags, not raw segments.

*Totality and idempotence*
- Array input: `['a','b']`, `['a, b']` (comma inside an element), `['a', 1, null, {}, 'b']` → only
  the string members survive.
- Non-string, non-array input (`42`, `{}`, `true`) → `[]`, no throw.
- `normalizeTags(normalizeTags(x))` deep-equals `normalizeTags(x)` for every case above.
- Output is always an array of non-empty strings with no duplicate lowercase key — asserted as a
  shared invariant helper over every case, in the style of the retention suite's keep/prune
  invariant.

**`functions/src/games/tagsNormalization.test.ts`** (new vitest, emulator-free): asserts the
server-side contract directly on the function the callables invoke — a 10 000-element array, a
1 MB tag, an array containing non-strings, `undefined`, and a plain object all produce a bounded,
well-formed list; and that normalizing an already-normalized list is a no-op, which is what makes it
safe to apply on both create and publish.

**`scripts/test-tags-input.ts`** (existing): kept and re-run unchanged. It is the regression guard
for the Builder's raw-string typing fix, and it must stay green through the delegation in D1.

**E2E (`scripts/e2e-verify.mjs`)**: assertions authored per D10 and **left unrun**.

**UI**: no component test runner in this repo; the chips are covered by `npm run typecheck`,
`npm run lint`, both production builds, and `npm run i18n:check` (PART A hard gate, zero new PART B
warnings). Browser verification is deliberately not attempted — the live stack must not be touched.
