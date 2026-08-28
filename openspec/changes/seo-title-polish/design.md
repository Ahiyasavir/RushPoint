## Context

Three separate mechanisms produce the titles this change touches, and they are all already
policed by one script:

- `apps/play-web/index.html` and `apps/creator-web/index.html` are hand-written documents
  carrying `<title>` plus the Open Graph and Twitter blocks. `scripts/test-no-dashes.ts`
  PART C reads them, and carries a REACH assertion (`scanned >= 14`) so a markup reshuffle
  that made every regex miss fails instead of silently passing over zero fields.
- `scripts/lib/landingPages.ts` is a pure registry; `scripts/build-landing-pages.ts` is its
  only writer and the output under `apps/play-web/public/{he,en}/` is COMMITTED, with
  `scripts/test-landing-pages.ts` failing if the committed bytes drift from what the
  registry now produces. PART D scans the registry rather than the generated markup, so an
  offender is named by its field path.
- `apps/marketing` composes titles from the content files through the `%s, RushPoint`
  template in `src/config.yaml`. That template already documents the house decision: a
  comma, not a dash. Its titles are already colon free, so the marketing site is untouched.

## Goals / Non-Goals

**Goals:** colon free, outcome first titles on every indexed page, and a gate that keeps
them that way.

**Non-Goals:** descriptions and body copy; the domain name; anything in `apps/marketing`;
any change to what the pages actually say.

## Decisions

### D1 — The rule is scoped to titles, not to all copy

The obvious implementation is "no colon in user-facing copy", parallel to the dash rule.
It is wrong. A colon inside a sentence is correct punctuation and the existing copy uses it
correctly in a dozen descriptions and paragraphs. Banning it everywhere would either fail
that copy or accumulate exemptions until the rule meant nothing. What is actually wrong is
a colon in a NAME, so the rule is written about names.

### D2 — The scan reads values, never whole tags

`<meta property="og:title" content="...">` contains a colon in its KEY on every page ever
written. A rule applied to the tag text would fail universally and immediately be deleted.
PART C already parses key and value separately for the dash rule, so this reuses the same
parse and inspects `value` only. The same is true for the JSON-LD block and for URLs.

### D3 — Titles are rewritten, not merely de-coloned

Deleting the colon from `RushPoint: build your own real world field game` yields
`RushPoint build your own real world field game`, which is worse than what it replaced.
Each title is rewritten so the outcome leads and the brand follows after a comma:
`Build your own real world field game, RushPoint`. This also moves the searched-for words
to the front of the line, which is where a result is judged, and it matches the marketing
site's existing template rather than inventing a second pattern.

### D4 — The generated landing pages are regenerated, not hand-edited

`scripts/build-landing-pages.ts` is the only writer. Editing the committed HTML directly
would pass a reading of the diff and fail `scripts/test-landing-pages.ts`, which is exactly
the drift that test exists to catch.

## Test Strategy

No logic changes, so the proof is a gate rather than a behaviour test:

1. Extend `scripts/test-no-dashes.ts` with a PART F: a `BANNED_TITLE_SEPARATOR` rule over
   the title fields named in the spec, plus its own reach assertion, in the same shape as
   PARTS C, D and E. Run it FIRST and confirm it fails on today's titles, naming all
   eleven.
2. Rewrite the titles. Re-run and confirm it passes with a non-zero field count.
3. `npm run build:landing-pages`, then `scripts/test-landing-pages.ts` to confirm the
   committed output matches the registry.
4. `scripts/test-i18n-parity.ts` and `scripts/test-marketing-content.ts` to confirm the
   Hebrew titles are still Hebrew and the English ones still English.
5. `npm run verify` for the whole set.

## Risks / Trade-offs

- **[A title rewrite is a ranking input]** → the keywords are preserved and moved earlier,
  the URLs are unchanged so nothing needs redirecting, and these pages are new enough to
  carry little accumulated authority. The alternative, leaving them, keeps a title that
  reads like a filename.
- **[The reach assertion could pass over zero fields]** → it is asserted explicitly, in the
  same shape as PARTS C, D and E, for the reason recorded there: a set of absences is
  satisfied by an empty input set.
