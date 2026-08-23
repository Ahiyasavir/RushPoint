## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-tags.ts` in the house style of `scripts/test-tags-input.ts`
      (`check(name, cond)`, `eq()` deep-compare, pass/fail counters, `process.exit`), importing
      `normalizeTags`, `MAX_TAGS` and `MAX_TAG_LEN` from `@rushpoint/shared`.
- [x] 1.2 Encode the splitting cases from the design's Test Strategy: `'a, b, c'`, `'a,b,c'`, the
      Arabic comma `،` (U+060C), the fullwidth comma `，` (U+FF0C), `\n` and `\r\n`, and a string
      mixing several separators.
- [x] 1.3 Encode the trimming / empties cases: surrounding whitespace, `'a,,b'`, trailing `'a,b,'`,
      leading `',a'`, `''`, `'   '`, `' , , '`, `undefined`, `null`, internal whitespace collapsing
      (`'old   city'` → `'old city'`), a multi-word tag kept whole, a zero-width character stripped,
      and an emoji tag left intact.
- [x] 1.4 Encode the de-duplication cases: exact duplicates, `'Park, park, PARK'` → `['Park']`
      (first-seen casing), and whitespace-differing duplicates.
- [x] 1.5 Encode the Hebrew / mixed-direction cases: three Hebrew tags byte-identical to input, a
      multi-word Hebrew tag kept whole, a Hebrew+English mixed list, and a Hebrew round-trip through
      `join(', ')`.
- [x] 1.6 Encode the cap boundaries: 19 / 20 / 21 distinct tags; a 39 / 40 / 41-character tag; a
      41-char tag whose truncation must not leave a trailing space; a 10 000-element array and a
      1 MB single tag (array input shape — the hostile-client shape); and `'a,a,a,b'` proving the
      count cap counts kept tags, not raw segments.
- [x] 1.7 Encode totality + idempotence: array inputs `['a','b']`, `['a, b']`,
      `['a', 1, null, {}, 'b']`; non-array non-string inputs `42`, `{}`, `true`;
      `normalizeTags(normalizeTags(x))` deep-equals `normalizeTags(x)` for every case.
- [x] 1.8 Add a shared invariant helper asserting on EVERY case that the output is an array of
      non-empty strings, contains no duplicate lowercase key, has length ≤ `MAX_TAGS`, and every
      member has length ≤ `MAX_TAG_LEN`.
- [x] 1.9 Create `functions/src/games/tagsNormalization.test.ts` (vitest, emulator-free) asserting
      the server-side guard on the exact function the callables invoke: 10 000-element array, 1 MB
      tag, non-string members, `undefined`, and a plain object all yield a bounded well-formed list,
      and re-normalizing is a no-op.
- [x] 1.10 Run `npx tsx scripts/test-tags.ts` and confirm it FAILS for the right reason (the export
      does not exist yet). Record the failure verbatim.

## 2. GREEN — the shared pure function

- [x] 2.1 Add `packages/shared/src/tags.ts` exporting `MAX_TAGS = 20`, `MAX_TAG_LEN = 40` and
      `normalizeTags(input: string | string[] | null | undefined): string[]`, implementing D2–D6:
      total over any input, split on the comma family + line breaks, strip zero-width/bidi-control
      characters, collapse internal whitespace, trim, truncate to `MAX_TAG_LEN` then re-trim, drop
      empties, dedupe on the invariant lowercase key preserving first-seen casing, stop at
      `MAX_TAGS` kept tags. No Unicode normalization form (must not break ZWJ emoji).
- [x] 2.2 Re-export it from `packages/shared/src/index.ts` alongside the other pure modules.
- [x] 2.3 Re-run `npx tsx scripts/test-tags.ts` — GREEN. Re-run `npx tsx scripts/test-tags-input.ts`
      — still GREEN (untouched regression guard).

## 3. GREEN — server-side enforcement

- [x] 3.1 `functions/src/games/index.ts` `createGame`: normalize the payload `tags` before writing
      the game document.
- [x] 3.2 `updateGame`: normalize `updates.tags`, and normalize each task's `tags` inside the stages
      pass that already rebuilds the array (`sanitizeStagesText`), producing a NEW array — never a
      dotted update of an array element.
- [x] 3.3 `publishGame`: normalize the tags written into `PublicGame` and into each `PublicTask`, so
      documents written before this guard are cleaned on their next publish.
- [x] 3.4 Confirm the published-game resync path needs no separate call (it reads the already
      normalized merged value) and note it in a comment so nobody adds a redundant one.
- [x] 3.5 Run `npx vitest run src/games/tagsNormalization.test.ts` in `functions/` — GREEN.

## 4. GREEN — creator-web wiring

- [x] 4.1 Reduce `apps/creator-web/src/lib/tags.ts` to a delegation to the shared `normalizeTags`,
      keeping the `parseTagsInput` export name and signature so `BuilderPage.tsx` and
      `scripts/test-tags-input.ts` are unaffected.
- [x] 4.2 Add a `TagChips` presentational component to creator-web: static Tailwind classes,
      `dir="auto"` on the tag text, renders nothing when the list is empty, caps visible chips and
      appends a translated `+N` overflow indicator.
- [x] 4.3 `BuilderPage.tsx` `TagsField`: render a live `TagChips` preview of the parsed tags under
      the input plus a translated helper line stating the comma rule (D9).
- [x] 4.4 Add a tags field to the task editor (`components/TaskWizard.tsx`, Advanced section) using
      the same raw-string-in-state + `parseTagsInput`-on-change pattern as the game field, with the
      same chip preview.
- [x] 4.5 `pages/GalleryPage.tsx`: render `TagChips` on the public **game** card and on the
      **mission library** card.
- [x] 4.6 Add the new keys to BOTH dictionaries in `apps/creator-web/src/i18n.ts` (Hebrew and
      English): the task tags label/placeholder, the comma helper line, and the `+N` overflow
      formatter.

## 5. GREEN — play-web wiring

- [x] 5.1 Add a `TagChips` to play-web honouring the reversed zinc scale, same contract as 4.2.
- [x] 5.2 Render it on `screens/GamePromoScreen.tsx` for a public game's tags.
- [x] 5.3 Add the overflow formatter key to BOTH dictionaries in `apps/play-web/src/i18n.ts`.

## 6. E2E — authored, deliberately not run

- [x] 6.1 Add assertions to the gallery / task-library scenario of `scripts/e2e-verify.mjs`: publish
      a game whose game tags and task tags were submitted un-normalized (duplicates, blanks, mixed
      case, an over-long tag, a 50-element list) and assert `searchGallery` / `searchTaskLibrary`
      return them normalized, deduped and capped.
- [x] 6.2 Confirm NO change to `ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` is needed (`tags` is
      already allowlisted at `scripts/e2e-verify.mjs:242`) and leave the allowlists untouched.
- [x] 6.3 Do NOT run `npm run e2e` — a live playtest stack owns the emulator. Record the assertions
      as written-but-unrun.

## 7. Gates

- [x] 7.1 `npm run typecheck` — green.
- [x] 7.2 `npm run lint` — 0 errors.
- [x] 7.3 `npm test` — green (includes `scripts/test-tags.ts`, `scripts/test-tags-input.ts` and the
      new functions vitest).
- [x] 7.4 `npm run creator:build` — green.
- [x] 7.5 `npm run play:build` — green.
- [x] 7.6 `npm run i18n:check` — PART A clean (hard gate); confirm zero NEW PART B warnings with
      `npm run i18n:check:strict`.
- [x] 7.7 `npx openspec validate game-task-tags --strict` — passes.
