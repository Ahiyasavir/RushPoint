## Context

Copy lives mostly in the two i18n maps (`apps/creator-web/src/i18n.ts` and, after the
`play-web-i18n-hebrew` change, `apps/play-web/src/i18n.ts`). A grep for `—` and ` - ` across these
maps finds the offenders (wallet `creditsHint`/landing copy, etc.). The cleanest enforceable
boundary is "translation-map leaf values" — that is shipped UI copy and is pure data, so a test can
scan it deterministically.

## Goals / Non-Goals

**Goals:** document the standard; rewrite existing dash separators; add a pure test that fails on
future dashes in the maps.

**Non-Goals:** touching comments/paths/flags/CSS; codemod of free-form JSX; Firestore content.

## Decisions

### D1 — Define "dash separator" precisely
Forbidden in leaf values: em-dash `—` (U+2014), en-dash `–` (U+2013), and a spaced hyphen ` - `
(hyphen with a space on at least one side used as a separator). Allowed: intra-word hyphens with no
surrounding spaces inside a single token are rare in Hebrew/English copy and are NOT flagged by the
` - ` rule; the em/en-dash rule flags those characters unconditionally.

### D2 — Rewrite, don't delete meaning
Each offending string is rewritten to preserve meaning: `"A — B"` → `"A. B"` or `"A, B"` or two
lines, chosen per string for natural reading in each language.

### D3 — Test scans both maps via a shared scanner
`scripts/test-no-dashes.ts` imports `translations` from both apps, walks every string leaf, and
asserts none match `/—|–| - /`. A tiny explicit whitelist (empty initially) keeps the rule strict.

## Test strategy

**Pure logic** — `scripts/test-no-dashes.ts` (aggregator-picked): walk both apps' `translations`
leaf strings; fail listing any value containing `—`, `–`, or ` - `. Runs with `npm test`, no emulator.

**Manual sweep verification:** grep the apps for `—` and ` - ` in `.tsx` to catch JSX literals not
yet in i18n; rewrite those too (verified by re-grep returning only exempt matches).

## Risks / Trade-offs

- [Risk: the ` - ` rule false-positives on a legitimate spaced hyphen] → none expected in current
  copy; if one arises it goes through the explicit whitelist with a review note.
- [Trade-off: the test only guards the maps, not raw JSX] → acceptable; the standard pushes copy into
  i18n, and the play-web-i18n change already migrates play-web literals into a map.
