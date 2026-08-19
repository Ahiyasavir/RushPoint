# הקמה מהירה (Quick Setup) audit playbook

For an agent asked to "fix Quick Setup" on a template/game — or to add/patch
`wizardSteps` on a production doc directly. Written after a single session where
the SAME game needed four separate follow-up fixes because each one was verified
in isolation instead of against the full picture. Every failure class below is a
real bug that shipped and had to be caught by the user, not by review.

The core lesson: **a wizardStep is three separate claims, and each one can be
individually wrong while the other two look fine.**

1. The step exists and targets the right field.
2. The field is actually reachable in the UI from that step's `tab`/`optInGroup`.
3. The step's own text is accurate for the position it renders in.

Checking only #1 (which templateWizard.ts / extractQuickSetupSteps.ts produced)
is what let three fields ship with drafted-but-never-attached instructions, one
field ship unreachable behind a collapsed panel with no anchor, and one panel
ship that opened but never closed. None of those are visible from reading the
override map alone — each needs its own check below.

## 0. Before touching anything: get the REAL current state

Never reason from a script's SOURCE about what a production doc contains. Read
the doc:

```js
const snap = await db.doc(`users/${OWNER}/games/${gameId}`).get();
const g = snap.data();
```

Then, for every wizardStep, print `targetFieldPath`, `isRequired`, and the first
~80 chars of `instructionPrompt` — this is the ONLY reliable way to see what a
creator will actually be walked through, because storage order is not display
order (see §3).

## 1. Cross-reference the override map against what's ACTUALLY attached

If you're building or reviewing a per-game fix script that layers hand-written
`instructionPrompt` text onto `extraction.wizardSteps` (the `apply-*-prod.cjs`
pattern), every key in that override map is a CLAIM that a step with that
`taskId|targetFieldPath` exists. That claim is silent when false — a
`wizardSteps.map(...)` override that never matches anything is not an error, it's
just dead code.

**Mechanical check:** for every key in the override map, assert it appears in
`extraction.wizardSteps` (or in the final steps array) before applying anything.
Anything present in the map but absent from the steps is a MISSING step, not a
skippable one — inject it (see §2), don't assume the general extractor "must
have" produced it just because you wrote a note for it.

This is exactly how `FINAL_CODE|coordinates`, `FINAL_CODE|smart.longInstructions`,
and `MISSING_BAG|coordinates` silently vanished — three drafted instructions with
nobody ever pointed at them.

## 2. For every task the creator must configure, name EVERY field it needs — don't trust the extractor's coverage

The general extractor (`extractQuickSetupSteps`) reads operator notes and infers
fields from vocabulary. It has known gaps, and a `hideLocation: true` task hits
several of them at once. Before calling a mission "covered," walk its actual
shape and ask what a creator needs to DO, independent of what any note said:

- **Located task** (any `triggerMode` besides `locationless`) → needs a
  `coordinates` step. Don't assume this exists just because OTHER missions in
  the same game got one — check per task.
- **`hideLocation: true`** → needs `coordinates` (above) AND `locationClue`,
  and the clue step should be `isRequired: true` — a hidden spot with no clue
  is unfindable, not "nice to have." (`checkHiddenLocationTask` in
  `packages/shared/src/geo.ts` treats a missing clue as a soft warning at the
  VALIDATION layer; Quick Setup's OWN required flag is a separate, stricter
  decision you make per mission, not inherited from that warning.)
- **`smart.enabled` / `code_verification`** → needs `smart.secretCode`, and if
  `smart.longInstructions` contains a bracket placeholder (`[...]`) that a
  PLAYER would otherwise read verbatim, it needs its own step too. Grep the
  actual stored task for literal `[` in any player-facing field
  (`description`, `smart.longInstructions`, `locationClue`) — a bracket in
  shipped content is a placeholder that was never finished, whether or not a
  step exists for it.
- **`numericAnswer`/`numericTolerance` used** → needs its own step (the
  general extractor does not infer these — see the module comment in
  `apps/creator-web/src/lib/quickSetup.ts` above `QUICK_SETUP_FIELDS`).
- **Any field with a demo/placeholder VALUE that looks configured** (a real
  number instead of a bracket, e.g. a template's illustrative `secretCode:
  "27"`) is more dangerous than an empty field — it silently verifies wrong.
  If the template's own note calls a value illustrative, CLEAR it, don't leave
  it, and give it a required step.

## 3. Never trust array order — verify RENDER order via field rank

`orderQuickSetupSteps` (`packages/shared/src/templateWizard.ts`) resorts by
`stageIndex → taskIndex → quickSetupFieldRank(fieldPath) → authored order`. The
`FIELD_RANK` table encodes a real, deliberate sequence (concept → details/clue →
location → verification → advanced) — read it before assuming "I added a step,
the order must be fine." Two things to actually check:

- **Print the game's steps through `orderQuickSetupSteps`, not the raw array.**
  The array you wrote them in is not what a creator sees.
- **Does the rendered order narratively make sense for THIS specific pair of
  fields?** The rank table is right in general (`locationClue` before
  `coordinates` — write the idea, then place the exact pin) but the WORDING of
  each step must match whichever position it actually renders in. A clue step
  worded "for the place you chose" (past tense) is wrong if it renders BEFORE
  the coordinates step. Reread both steps back to back in rank order before
  shipping either one's copy.

## 4. Verify UI reachability, not just data correctness

A step with the right `targetFieldPath` can still be unreachable. Check, IN THE
SOURCE, not from memory:

- Does `QUICK_SETUP_FIELDS` (`apps/creator-web/src/lib/quickSetup.ts`) have an
  entry for this `targetFieldPath` at all? An unlisted field silently degrades
  to "open the editor, focus nothing."
- Does that entry's `anchor` value actually exist as a literal
  `data-qs-field="<anchor>"` attribute somewhere in `TaskWizard.tsx`? Grep for
  it — don't assume a control has an anchor just because a sibling field does.
- Is the anchor inside a COLLAPSED panel (an opt-in chip, the Location step's
  Advanced panel, or any future one)? If so:
  - Does `QUICK_SETUP_FIELDS`' `optInGroup` for this field name that panel?
  - Does the panel's OWN open-state have a wired path from `focusGroup` to
    actually open it (check `TaskWizard`'s `[focusNonce]` effect)?
  - **Does something also CLOSE it** when a later step doesn't need it? An
    "open" with no corresponding "close" leaves the panel covering whatever
    the NEXT step needs to show — this shipped once already. The fix pattern
    is to always SET the open state deterministically off the current target
    (`setPanelOpen(focusGroup === 'thatGroup')`), never just conditionally
    open it.

## 5. Copy review: read every step's headline together with its authored note, not in isolation

`QuickSetupBar` shows TWO lines: the generic `copy[copyKey]` headline (product
voice) and the step's own `instructionPrompt` (authored voice), stacked. Reading
either alone can look fine while the PAIR contradicts:

- A generic headline that assumes the field is empty/optional ("want to give a
  clue?") paired with a field that is now structurally REQUIRED (hideLocation)
  reads as permission to skip something mandatory. If a field's role changed,
  check whether its `copy[key]` generic line still matches — that line is
  GLOBAL (affects every creator, every game with this field), so fix it in
  `i18n.ts`, don't patch around it per game.
- An authored override that says "already fine, don't touch" paired against a
  headline that asks the creator to do the very thing the note says not to
  ("describe what happens here" + "already done, don't touch") is not a wording
  problem, it's a signal the STEP shouldn't exist at all — remove it, don't
  reword either half.
- New copy must pass `npm test` (`scripts/test-no-dashes.ts` bans `—`/`-` in any
  shipped copy) and `npm run i18n:check:strict` (HE must be Hebrew, EN must be
  English, both languages must be edited together — never ship one without the
  other).

## 6. Verification order for a session, top to bottom

1. Read the CURRENT production doc(s). Print wizardSteps sorted through
   `orderQuickSetupSteps`, not raw.
2. For every task in scope, apply §2's checklist regardless of what any note or
   override map claims — derive requirements from the task's actual shape.
3. Cross-reference every override-map key against the resulting step list
   (§1) — anything unmatched gets injected, not assumed.
4. Re-print the resorted list and read it top to bottom as a creator would,
   checking §3 (order) and §5 (copy contradictions) together.
5. For any field behind a collapsed panel, grep the source for its anchor and
   its open/close wiring (§4) — don't infer reachability from the data alone.
6. `git diff` any code change, run the full gate
   (`typecheck · lint · test · creator:build · i18n:check:strict`), THEN
   dry-run the data script, THEN execute, THEN read the doc back and diff
   against what you intended to write.
7. Deploy code changes (`npm run deploy:hosting`) and confirm the LIVE bundle
   contains the change — `curl` the deployed hashed chunk and grep for a
   literal string unique to your fix. A build succeeding locally and a
   deploy command exiting 0 both mean "you deployed A file," never "you
   deployed the RIGHT content" — the origin/base-clobber incidents documented
   in `CLAUDE.md` are the same lesson at a different layer.

## What NOT to do

- Don't fix the field the user named and stop. The user finding four separate
  bugs in one game across four messages is what this playbook exists to
  prevent — audit the WHOLE mission, not the one field mentioned.
- Don't assume the general extractor's output is complete because it produced
  SOME steps for a task. Partial coverage looks identical to full coverage
  until a creator hits the gap.
- Don't change `FIELD_RANK` (the general ordering table) to fix one game's
  wording problem — it's shared, tested, deliberate product behavior. Reword
  the specific step's `instructionPrompt` to fit the order instead.
- Don't leave a demo/placeholder value that looks like real data (a number, not
  brackets) — clear it and make it a required step, or it silently ships wrong.
