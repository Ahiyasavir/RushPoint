# Wave A — hidden-location leak guard

Audit + completion notes, 2026-07-21. Change: `openspec/changes/hidden-location-leak-guard/`.

## The bug, restated

The report was "hidden-location tasks are visible before arriving". Two distinct leaks hide behind
that sentence:

1. **Coordinate leak — already fixed, server side.** `functions/src/runs/sanitizeTask.ts:58-65`
   strips `coordinates` and `geofenceRadiusMeters` from the participant payload for a `hideLocation`
   task and emits `locationHidden: true`; `apps/play-web/src/screens/PlayScreen.tsx:381` therefore
   draws no map pin. Nothing to do here.
2. **Text leak — the real complaint.** `title` and `description` must keep shipping to the
   participant (the player has to know what the task is), so a creator who writes "Meet at the Old
   City fountain" or "המשימה ברחוב יפו" hands over the answer in plain text and the riddle
   collapses. This is a *content* failure, not a plumbing failure.

## The fix's core principle: warn, never mutate

Auto-stripping or rewriting an authored title is destructive and unpredictable, and "this text
reveals the location" is inherently fuzzy. So the guard is **authoring-time and advisory only**:

- No auto-strip, no auto-edit, no save-block, no launch-block.
- `title` / `description` still reach the participant unchanged.
- No server or sanitizer change at all. This is purely additive Builder-side.

## What exists

- **`packages/shared/src/locationLeak.ts`** — pure, dependency-free (imports only the `Task` type).
  `locationLeakWarnings(task): ('title' | 'description')[]`.
  - Returns `[]` immediately when `hideLocation` is falsy (nothing hidden ⇒ nothing to leak).
  - Otherwise checks `title` then `description` independently against a curated bilingual token set,
    so the Builder can name the exact offending field.
  - English tokens match on a word-ish boundary (`(^|[^a-z])tok([^a-z]|$)` over the lowercased text)
    so a fragment inside a longer word ("apartment") does not fire. Hebrew tokens match as
    substrings — Hebrew has no reliable word-boundary metacharacter and the tokens are prefixed in
    practice ("ברחוב" contains "רחוב"), which is exactly what we want to catch.
  - `locationClue` / `locationClueHe` are deliberately **exempt**: the clue is supposed to describe
    the spot.
  - Explicitly not NLP or a gazetteer, and not a security boundary — a helpful nudge, biased toward
    useful flags over exhaustive coverage.
- **`packages/shared/src/index.ts:54`** — `export * from './locationLeak';`.
- **`apps/creator-web/src/components/TaskWizard.tsx`** — import at line 13; the caution renders at
  lines 935-947, inside the existing `{task.hideLocation && …}` block, right below the clue textarea
  and the `hideLocationNeedsClue` note. It is a bare `<p className="text-[11px] text-rp-fire mt-1">`
  that picks one of three messages (title / description / both). It calls no `set()` and touches no
  Save or Next control, so the advisory-only contract holds structurally, not just by convention.
  The whole hide-location block only renders for `radius` / `exact` trigger modes.
- **`apps/creator-web/src/i18n.ts`** — `hideLocationLeakTitle` / `hideLocationLeakDesc` /
  `hideLocationLeakBoth`, HE at 544-546 and EN at 1302-1304. Each tells the creator to move the
  place name into the clue. HE is pure Hebrew, EN pure English, no dash separators; `EN: typeof HE`
  enforces key parity.
- **Authoring validation that a hidden task has a clue at all** already lives separately at
  `packages/shared/src/geo.ts:159-176` — that is a different requirement and was not touched.

## Audit result vs `tasks.md`

`tasks.md` showed 12 unchecked boxes, but every implementation task had in fact landed in commit
`d30fb5a` ("family-playtest crash/UX fixes + nightly edge-case hardening"); the working tree is clean
for all of these files. The checkboxes were simply never reconciled after that commit. They now
reflect reality, with the gate boxes left to the centralized gate run.

One task line was also factually wrong and has been corrected: it said `npm run shared:build` was a
prerequisite for the test. It is not — `scripts/test-location-leak.ts` imports
`../packages/shared/src/locationLeak` (the TypeScript source) directly under `tsx`, so the lane runs
without touching `packages/shared/dist`. That matters here: concurrent agents share `dist` in place,
and a needless `shared:build` is exactly the footgun CLAUDE.md warns about.

## What this pass added

Test coverage only — the shipped behavior was already correct against the delta spec, so nothing in
`locationLeak.ts` or the UI needed changing. `scripts/test-location-leak.ts` went from 8 to 21
assertions (21/21 green), closing gaps the original set left open:

- **Language symmetry.** The original only proved EN-in-title and HE-in-description, which would let
  a one-sided regression through. Added HE-in-title, EN-in-description, HE-in-both, and a mixed
  EN-title / HE-description case.
- **A total falsy short-circuit.** The original checked the falsy path with one field; now both
  fields are loaded with obvious place names in both languages, for `hideLocation` absent and for
  `hideLocation: undefined`, and still expect `[]`.
- **Shape and false-positive guards.** Missing fields, whitespace-only fields, EN case
  insensitivity, a multi-word token ("in front of"), `locationClueHe` also exempt, a neutral Hebrew
  instruction, and a stable result order (always `title` before `description`, regardless of the
  object's key order — the Builder's `leaks[0] === 'title'` branch depends on it).

## Gates

Not run in this lane by design: concurrent agents share `packages/shared/dist`, and `verify`,
`typecheck` and `i18n:check` all invoke `shared:build`, which rewrites it in place. The pure lane was
verified directly with `npx tsx scripts/test-location-leak.ts`; the remaining gates belong to the
orchestrating run. The change adds no callable, so no e2e or emulator work is owed.
