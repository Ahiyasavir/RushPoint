## Why

The participant app is used one-handed, outdoors, while walking, in Hebrew (`App.tsx:79` sets
`dir="rtl"` on the whole tree). A UI audit found three classes of defect in that context, each
verified against the current tree:

**Machine-data fields inherit RTL.** The four highest-frequency inputs in the product carry
Latin/numeric machine data but inherit the document's `dir="rtl"`, so the caret starts on the
wrong side and typed characters appear to jump: the access code (`JoinScreen.tsx:237`), the team
code (`JoinScreen.tsx:361`), the station code (`TaskRunner.tsx:797`) and the staff PIN
(`StaffConsole.tsx:157`). Free-text fields next to them already do the right thing with
`dir="auto"` (`JoinScreen.tsx:369`, `TaskRunner.tsx:825`), which is exactly why the machine fields
read as broken by comparison. Two projected boards (`TvLeaderboard.tsx:104`,
`CeremonyScreen.tsx:179`) use physical `text-right`, so under RTL the score column aligns toward
the middle of a wall-sized screen instead of its edge.

**Controls that change points or state are below the 44px touch minimum.** The ordering-quiz ↑/↓
buttons are `w-8 h-8` and adjacent (`TaskRunner.tsx:887,890`), so a mis-tap silently reorders the
answer the player is about to submit. The paid-hint trigger — an action that **costs points** — is
a bare ~16px text link (`TaskRunner.tsx:589,690`). "Leave" (`PlayScreen.tsx:959`) clears the
session from a `text-xs` link. The live-ops dismiss ✕ (`LiveOps.tsx:129,137`) has no padding and
no accessible name at all.

**The staff console gives a volunteer no margin for error.** The ±5/±10 score buttons are `w-9 h-9`
with `gap-1` (`StaffConsole.tsx:416-426`), so −5 and +5 sit about 4px apart with no confirmation,
no undo and no acknowledgement that anything happened. Approve and Reject are identical-weight
adjacent buttons (`StaffConsole.tsx:381-394`). Sign-out is one tap (`StaffConsole.tsx:308`) and
recovery needs a PIN the volunteer no longer has. Two panels are hand-rolled ▲/▼ collapsibles with
no `aria-expanded` (`StaffConsole.tsx:517-528`, `602-608`) while the shared `Collapsible`
(`components/ui.tsx:125`) already solves exactly this, correctly.

**The dialog that gates the riskiest actions is not a dialog.** `components/dialog.tsx:58-72` — the
surface behind SOS, leaving a run and paid-hint purchase — has no `role`, no `aria-modal`, no focus
move and no Escape. A keyboard or screen-reader user is not told a decision is being asked of them.

**Plus one targeted safety defect.** A wrong quiz answer normally costs nothing
(`functions/src/runs/index.ts:3367-3380` only increments `taskAttempts`), but when a creator has
set `smart.attemptLimit`, `submitTaskAnswer` refuses at the cap with `resource-exhausted`
(`:3356-3362`). `QuizEntry` submits on the choice button's own `onClick` with no staged selection
(`TaskRunner.tsx:815`), so on an attempt-limited task **one misclick burns a finite attempt and can
permanently lock the task**. The server behavior is correct; the client offers no moment to stop.

## What Changes

- **Machine-data inputs read left-to-right.** The access code, team code, station code and staff
  PIN fields declare `dir="ltr"`. Free-text fields keep `dir="auto"` untouched.
- **Projected boards align to the screen edge** in both directions (`text-end`).
- **Every control that costs points, changes state, or is adjacent to its own opposite meets the
  44px minimum**, and the live-ops dismiss button gains an accessible name and a real tap area.
- **Staff destructive controls become deliberate.** The score adjusters are enlarged and the
  negative group is visually separated from the positive; an adjustment confirms **after** the
  callable resolves, so the volunteer sees that it landed. Reject is demoted to a ghost button
  beside a primary Approve. Sign-out asks first, saying the PIN will be needed again.
- **The two hand-rolled staff collapsibles become the shared `Collapsible`**, gaining
  `aria-expanded` and a ≥44px header for free.
- **The dialog behaves like a dialog**: `role="alertdialog"`, `aria-modal="true"`, focus moved to
  the confirm control on open and restored on close, and Escape resolves it as a cancel. The two
  full-screen participant overlays (story interstitial, how-to-play) also close on Escape.
- **The secondary panel region stops trapping the scroll gesture.** `PlayScreen.tsx:506`'s
  `max-h-[60vh] overflow-y-auto` is removed: the map and task are already pinned above it by the
  shipped `fix-play-screen-hierarchy` work, so the nested scroller buys nothing and costs a
  swipe that goes nowhere on a phone.
- **An attempt-limited quiz choice asks before it spends an attempt** — and *only* then. A task
  with no `attemptLimit` submits on the first tap exactly as today, because a wrong answer there is
  free and a blanket confirm would tax the common case for nothing.

## Capabilities

### New Capabilities
- `play-touch-and-dialog-a11y`: Participant- and staff-facing controls are reachable and reversible
  on a phone held one-handed in an RTL locale: machine-data fields are read left-to-right,
  point-affecting and destructive controls meet the touch-size minimum and confirm before they act,
  modal surfaces announce themselves and are dismissible from the keyboard, and an irreversible
  answer attempt is never spent on a single mis-tap.

### Modified Capabilities
<!-- None. The sibling change `play-no-silent-failures` owns error reporting; this change adds no
     requirement to it and contradicts none of it. -->

## Impact

- **Surfaces touched:** `apps/play-web` **only**. No callables, no callable payloads, no Firestore
  rules, no `packages/shared` changes. `apps/creator-web` is untouched.
- **Files:** `screens/JoinScreen.tsx`, `screens/StaffConsole.tsx`, `screens/PlayScreen.tsx`,
  `screens/TvLeaderboard.tsx`, `screens/CeremonyScreen.tsx`, `components/TaskRunner.tsx`,
  `components/LiveOps.tsx`, `components/dialog.tsx`, new `lib/interaction.ts`, `i18n.ts`.
- **New pure logic (the TDD surface):** `quizAttemptGuard` — "does this choice tap need a
  confirmation, and how many attempts are left" — plus the touch-target class constant used by the
  enlarged controls. Pure functions, no React, tested by a new `scripts/test-touch-a11y.ts` in the
  existing `npm test` lane before any component is edited.
- **Risk:** the scroll-container removal changes page layout on the play screen. It is a deletion
  of a bound, so the content below the task simply joins the page's own scroll; nothing is hidden.
- **Gates:** `npm run e2e` is **excluded** — no callable, no payload and no server behavior changes,
  so the emulator suite cannot observe this change, and the emulator must not be started (a live
  playtest tunnel owns it).

## Non-goals

- **No new callable, no callable signature change, no Firestore rule change, no shared-type
  change.** The client cannot learn how many attempts a team has actually used without a payload
  change, so the confirmation states an upper bound rather than inventing a server field.
- **No error-reporting work** — `play-no-silent-failures` owns that and has landed.
- **No "navigate here" hand-off** — that is a separate change.
- **No redesign.** Colours, copy tone and layout stay as they are except where a control must grow
  or a confirmation must newly appear.
- **No blanket confirmation on answer submission.** Only the attempt-limited multiple-choice tap.
- **No `dir` change to free-text or user-authored content** — `dir="auto"` there is already correct.
