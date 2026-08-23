# הקמה מהירה (Quick Setup) audit playbook

For an agent asked to "fix Quick Setup" on a template/game — or to add/patch
`wizardSteps` on a production doc directly. Started after a single session
where the SAME game needed four separate follow-up fixes because each one was
verified in isolation instead of against the full picture, and extended after
a follow-up session on a DIFFERENT game surfaced a new set of failure classes
(§6-§9) the first pass didn't cover. Every failure class below is a real bug
that shipped and had to be caught by the user, not by review — the goal of
this document is that the NEXT one gets caught here instead. If you find a new
failure class this playbook doesn't cover, add it — that's the whole point.

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
- **A boolean never reads as "empty," so it never gets audited by the same
  logic as a missing string.** `smart.autoApprove` on a photo/video task is a
  real, working setting either way (`true`, `false`, or simply absent) — a
  creator can build and launch a whole game without ever having consciously
  chosen manual-review vs auto-approve, because nothing about a boolean looks
  unfinished. This class of field needs its OWN check, independent of
  "is it empty": does the creator get a DELIBERATE moment to choose it, or did
  it just default? (Fixed generally in `extractQuickSetupSteps` — see §2a
  below — but the pattern recurs: any enum/boolean/toggle with a working
  default is a candidate for the same treatment.)
- **Does the task's own TYPE still match what the mission is actually asking
  for?** A `numeric` task whose creator note says "just navigate there, no
  counting needed" is not a copy problem to word around — the type itself
  should become `geofence`, which structurally removes the need for
  `numericAnswer`/`numericTolerance` rather than leaving them stale. Check the
  type against the ACTUAL mechanic before patching text onto a mismatched
  shape.

### 2a. A photo/video task always needs an autoApprove decision — structural, not note-derived

This one is no longer something to remember per game: `extractQuickSetupSteps`
(`packages/shared/src/templateWizard.ts`) generates a `smart.autoApprove` step
for EVERY task with `smart.enabled && verificationType === 'photo_upload'`
that doesn't already have one, whether or not any operator note ever mentioned
it. Re-running extraction against a game picks these up automatically — you
should not need to hand-author this class of step again. If you find a
photo/video task STILL missing one after running extraction, that is a
regression in the general pass, not a one-off gap to patch around.

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

## 6. Where does this text ACTUALLY reach a player? Check the sanitizer, not the field name

A field's name and a field's VISIBILITY are two different questions, and the
second one is answered by server code, not by reading the schema or guessing
from where a Builder tab puts the control. A real bug this session: a
`hideLocation: true` task's "decode the riddle, then navigate there" framing
sentence was written into `description` — which reads like the obvious place
for mission-flavor text — but `functions/src/runs/sanitizeTask.ts`'s sealed
stub is built from an EXPLICIT ALLOW-LIST for a not-yet-arrived hidden task,
and that allow-list does not include `title` or `description` at all, only
`locationClue` + media + non-revealing chrome (`pointValue`, `difficulty`,
`estimatedMinutes`). A player never saw the sentence, because the field that
held it is invisible until `reportArrival` unseals the mission.

**Before writing player-facing copy into ANY field, find and read the actual
sanitizer/call site that decides what ships to a client** — for a mission,
that's `sanitizeTaskForParticipant`. Don't infer visibility from:

- Which Builder TAB the field lives on (a field can be editable and still be
  server-withheld from players at certain states).
- What the field is named (`description` sounds player-facing everywhere; it
  is not, pre-arrival, on a hidden task).
- What FIELD_RANK or `QUICK_SETUP_FIELDS` say — those describe where a
  CREATOR edits something, not what a PLAYER receives.

This generalizes past locationClue: any task state with its own sanitizer
branch (sealed vs revealed, before vs after a station scan, etc.) can hide a
field a creator assumes is always shown. When in doubt, grep for where the
field is read on the CLIENT side of a real network response, not the CREATOR
side.

## 7. The placeholder-marker convention — a bare bracket is NOT auto-detected

Leaving `[הכנס משהו כאן]` in a field you want to visibly mark "still needs the
creator's input" does NOT work with this codebase's existing tooling: `isPlaceholderValue`
/ `findOperatorNotes` only recognize a bracket containing one of a specific set
of keywords (`מפעיל`, `ליוצר`, `operator`, `organizer`) — see `BRACKET_NOTE` in
`packages/shared/src/templateWizard.ts`. A plain descriptive bracket with none
of those words reads as ordinary, fully-configured text: `isWizardStepConfigured`
returns `true`, the Quick Setup step silently drops off the outstanding list,
and the bracket ships to a player verbatim.

If you want real framing text to ship NOW (because it applies regardless of
what the creator eventually fills in) while ALSO keeping a portion of the same
field correctly flagged as unfinished, use the recognized convention:

```
"<real framing text that is fine to ship as-is>: [הערת מפעיל: <what the creator still needs to add>]"
```

This is the same pattern already used elsewhere in this codebase's own
original templates (e.g. the spy protocol's "התיק החסר" mission). It is
intentional, not an accident: `findOperatorNotes` will keep finding it (and a
future `extractQuickSetupSteps` run will keep re-flagging it) for as long as
the bracket survives, which is exactly the "still needs a human" signal you
want.

## 8. Never blindly re-apply a content script — diff against LIVE state first

A one-off `apply-*-prod.cjs` script is not idempotent by assumption just
because it reads `existing` steps before writing. This session nearly
overwrote a creator's own hand-edits: between one fix and the next, `updatedAt`
had moved hours forward and the STORED instruction text no longer matched
anything the script had ever written — the creator had been actively
rewording content in the Builder in between. Re-running the full content
script would have silently discarded their real edits with no error, because
`.update()` succeeds regardless of what it's replacing.

**Before re-running any content-fix script against a document you've touched
before:**

1. Read the CURRENT doc fresh (§0) and diff its text against what your LAST
   script run actually wrote (not what the override map currently says — the
   map may have changed since).
2. If `updatedAt` is newer than your last write AND the text has changed, STOP
   — assume the creator has taken over that field and gate any further edit on
   the field STILL being genuinely template-default (empty, or byte-identical
   to what your own script last wrote), the same way `descriptionIsUnclaimed`
   in `apply-nogar-fixes-prod.cjs` gates a description overwrite on it still
   being empty. Never overwrite a value just because your override map has an
   entry for that key.
3. For a narrow, mechanical fix that must land regardless (a banned character,
   a typo) prefer a SURGICAL pass that touches only the specific substring in
   place over a full content re-apply — see the em-dash recovery pattern: walk
   every string field, replace only the offending character, leave everything
   else byte-identical.

## 9. Copy quality bar when writing or replacing mission content

When a mission's premise itself needs replacing (not just cleanup), the copy
is a creative deliverable, not just a data fix, and needs the same bar:

- **No dated/time-sensitive references in template content meant to last.** A
  2020 pandemic-signature-collection premise reads as obviously stale in 2026;
  prefer evergreen mechanics (collect signatures / reactions / a video) over
  a premise tied to a specific event or era.
- **Don't write "AI-sounding" generic content** ("think of a fun word and show
  it to someone") when the creator's own request implies a sharper, more
  specific comic angle. If the creator gives you EXACT wording for a
  petition/sign/script, use it VERBATIM — don't paraphrase or soften it.
- **Match register to the stated audience.** A 14-18 template's humor can be
  edgier/more absurdist than an 11-13 template's; don't default every
  "funny mission" replacement to the same safe teen-generic tone.
- **Every new string still has to pass the project-wide gates**: no `—`/`–`/
  spaced `-` (INSTRUCTIONS.md §C, `scripts/test-no-dashes.ts`), and if it's
  hardcoded anywhere in app CODE (not template data) it must go through
  `t.*`/`i18n.ts`. A one-off content script writing directly to Firestore
  bypasses the automated dash-lint — grep your own new strings for `—`/`–`/
  ` - ` before ever calling `.update()`, the same discipline `npm test` would
  enforce if this were shipped code instead of data.

## 10. Verification order for a session, top to bottom

1. Read the CURRENT production doc(s). Print wizardSteps sorted through
   `orderQuickSetupSteps`, not raw. If you've touched this doc before, diff its
   current text against what you last wrote (§8) before assuming anything.
2. For every task in scope, apply §2's checklist regardless of what any note or
   override map claims — derive requirements from the task's actual shape,
   including whether the task's TYPE still matches the mechanic (§2) and
   whether every photo/video task has its autoApprove step (§2a, should be
   automatic).
3. Cross-reference every override-map key against the resulting step list
   (§1) — anything unmatched gets injected, not assumed.
4. Re-print the resorted list and read it top to bottom as a creator would,
   checking §3 (order) and §5 (copy contradictions) together.
5. For any field behind a collapsed panel, grep the source for its anchor and
   its open/close wiring (§4) — don't infer reachability from the data alone.
6. For every field you're about to write PLAYER-facing copy into, confirm via
   the actual sanitizer (§6) that a player at the relevant state can see it —
   don't assume from the field name or Builder tab.
7. If any field needs to visibly mark "still needs the creator" while other
   text in the same field ships as real content now, use the recognized
   bracket convention (§7) — a bare descriptive bracket will not be detected.
8. Grep every new string you're about to write for `—`, `–`, or ` - ` (§9) —
   a one-off script bypasses `npm test`'s dash lint entirely, so this check
   only happens if you do it yourself.
9. `git diff` any code change, run the full gate
   (`typecheck · lint · test · creator:build · i18n:check:strict`), THEN
   dry-run the data script, THEN execute, THEN read the doc back and diff
   against what you intended to write.
10. Deploy code changes (`npm run deploy:hosting`) and confirm the LIVE bundle
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
- Don't write player-facing copy into a field without checking, in the actual
  sanitizer, whether a player at the relevant state can see it (§6). A field
  named `description` is not automatically player-visible everywhere.
- Don't leave a bare `[הכנס כאן]`-style bracket expecting it to read as
  "unfinished" — it won't, unless it uses the recognized marker keyword (§7),
  and an undetected placeholder ships to a player verbatim.
- Don't re-run a content-fix script against a document you've touched before
  without diffing its current text against what you last wrote (§8) — a
  creator who has since hand-edited the field gets silently overwritten with
  no error.
- Don't ship replacement mission content that's dated, generic/AI-sounding, or
  off-register for the stated audience (§9) — a content REPLACEMENT is a
  creative deliverable with its own quality bar, not just a data fix. Use the
  creator's own exact wording verbatim when they give it to you.
- Don't assume a boolean/enum/toggle field is "covered" just because it has a
  value — check whether the creator ever got a deliberate moment to choose it
  (§2), the same way you'd check an empty string.
