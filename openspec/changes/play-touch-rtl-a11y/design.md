## Context

`apps/play-web` renders the whole tree under `dir="rtl"` (`App.tsx:79`) and is used one-handed,
outdoors, on a phone. The audit findings this change answers are all client-side: no callable
reports the wrong thing, no rule is wrong, no payload is missing. Everything needed is already on
the client — including `task.smart.attemptLimit`, which `sanitizeTaskForParticipant` deliberately
passes through (`functions/src/runs/sanitizeTask.ts:125`) so the client can render an
attempt-limited task.

The one thing the client does **not** have is how many attempts a team has already used:
`taskAttempts` lives on the team document and is never sanitized into `getMyTeamState`
(`functions/src/runs/index.ts:3358`). Adding it would be a server payload change, which this change
is not allowed to make — so the confirmation reports a locally-derived **upper bound** rather than
inventing a server field (see D5).

The sibling change `play-no-silent-failures` has already landed in this tree. It owns the
`msg`/`showError`/`showProgress` message channels in `TaskRunner`, the `readErr` staff error line,
and the announcement composer. This change touches none of that logic; where it edits the same
files it edits different markup.

## Goals / Non-Goals

**Goals**
- Machine-data inputs and projected boards behave correctly under RTL.
- Every control that spends points, changes session state, or is adjacent to its opposite is
  reachable without a mis-tap, and destructive staff controls are deliberate.
- The confirmation surface behind SOS / leave / paid hints is a real dialog for keyboard and
  screen-reader users.
- A single mis-tap can never permanently lock an attempt-limited task.

**Non-Goals**
- No callable, payload, rule or shared-type change. No creator-web change.
- No new error reporting (owned by `play-no-silent-failures`).
- No navigation hand-off (a separate change).
- No visual redesign beyond growing controls and adding the confirmations named here.

## Decisions

### D1 — `dir="ltr"` on machine-data inputs only; free text keeps `dir="auto"`
Four sites get `dir="ltr"`: `JoinScreen.tsx` access code (`:237`) and team code (`:361`),
`TaskRunner.tsx` `CodeEntry` input (`:797`), `StaffConsole.tsx` PIN (`:157`).

Deliberately **not** touched: `JoinScreen.tsx:369` (member name), `JoinScreen.tsx:404` (team name),
`TaskRunner.tsx:825` (free-text quiz answer), `StaffConsole.tsx:154` (staff name),
`AnnouncementComposer`'s two fields (already explicitly `dir="rtl"` / `dir="ltr"` by the sibling
change). Those carry human language and `dir="auto"` is the correct answer there.

*Alternative rejected:* setting `dir="ltr"` on a wrapper. `dir` is inherited by the input anyway,
but a wrapper also flips the surrounding layout (helper text, adornments); putting it on the input
is the narrowest correct scope.

### D2 — `text-end` instead of `text-right` on the projected boards
`TvLeaderboard.tsx:104` and `CeremonyScreen.tsx:179`. One-token swap; the logical property is
already the house convention (CLAUDE.md).

### D3 — Touch sizes come from named constants in `lib/interaction.ts`, not ad-hoc classes
Tailwind only sees static class strings, so the constants are plain string literals that get
interpolated into `className` at their single use site. Two constants:

- `TAP_TARGET` — `'min-w-[44px] min-h-[44px]'`, for controls that already have a box.
- `TAP_PAD` — `'p-2 -m-2'`, the negative-margin trick for an inline glyph that must not change the
  layout around it (the live-ops ✕).

Sites, with the current value and the target:

| Site | Now | After |
|---|---|---|
| `TaskRunner.tsx:887,890` ordering ↑/↓ | `w-8 h-8` | `w-11 h-11` |
| `TaskRunner.tsx:589,690` hint trigger | bare text link | text link wrapped to `min-h-[44px] px-2 py-2` |
| `JoinScreen.tsx:206,218` sound / colourblind | `w-7 h-7` | `w-11 h-11` |
| `JoinScreen.tsx:432` remove-member ✕ | `px-3` only | `min-w-[44px] min-h-[44px]` |
| `PlayScreen.tsx:959` leave | `text-xs` link | `text-xs` link + `px-3 py-2 -me-1` |
| `PlayScreen.tsx:468` share progress | `text-xs` link | `text-xs` link + `px-3 py-2` |
| `LiveOps.tsx:129,137` dismiss ✕ | no name, no pad | `aria-label={t.liveOps.dismiss}` + `TAP_PAD` |
| `StaffConsole.tsx:416-426` ±5/±10 | `w-9 h-9 gap-1` | `w-11 h-11`, `gap-2`, negatives split from positives |

*Alternative rejected:* a global CSS rule raising every `button` to 44px. It would silently change
dozens of untested layouts, including dense creator-side chrome that is not phone-first.

### D4 — Staff destructive controls
- **Score adjusters** render as two groups — `[-10, -5]` and `[+5, +10]` — inside one flex row with
  a wider separator between the groups than the `gap-2` inside each. No confirmation *before* the
  tap (a volunteer awards points dozens of times a run and a modal per tap is unusable); instead an
  **acknowledgement after** the callable resolves: a transient `±N` line on that team's row, held in
  a `Record<teamId, string>` and cleared on a timer. This is the missing feedback the audit named,
  and it is what makes a mis-tap noticeable and correctable with the opposite button.
- **Approve / Reject**: Approve keeps the filled accent style, Reject becomes an outline/ghost
  (transparent background, danger-tinted border and text). Same handlers, same guards.
- **Sign-out** routes through the existing `dialog.confirm` with copy that says the PIN will be
  needed to return. `dialog` is already imported in play-web and is non-blocking.

### D5 — `quizAttemptGuard` is the pure decision, and it reports an upper bound honestly
`apps/play-web/src/lib/interaction.ts`:

```ts
export interface AttemptGuard { needsConfirm: boolean; remaining: number }
export function quizAttemptGuard(attemptLimit: number | undefined, wrongSoFar: number): AttemptGuard
```

Rules:
- `needsConfirm` is true **only** when `attemptLimit` is a finite number strictly greater than 0.
  `undefined`, `0`, negative, `NaN` and `Infinity` all mean "no limit" ⇒ `{ needsConfirm: false,
  remaining: 0 }`. Fail *open* (submit immediately) is correct here: the guard exists to protect a
  finite resource, and where there is no finite resource an extra modal is pure friction.
- `remaining = max(0, attemptLimit - max(0, wrongSoFar))`, floored to an integer.

`wrongSoFar` is a **client-side, this-session** count: `TaskRunner` already learns of every wrong
answer (`answer()` at `:460` sees `res.correct === false`), so it keeps
`wrongAttempts: Record<taskId, number>` and passes `wrongAttempts[task.id] ?? 0`. After a reload the
count restarts at 0, so `remaining` can **overstate** what is left — never understate it. The copy
is therefore worded as an upper bound ("up to N attempts left"), which is true in both cases. The
honest alternative — shipping `taskAttempts` in the participant payload — is a server change and is
out of scope; it is the right follow-up if exact counts are ever wanted.

The guard is applied **only to the multiple-choice branch of `QuizEntry`** (`TaskRunner.tsx:811-821`),
which is the misclick surface. The free-text branch (`:823-829`) already requires typing and a
separate submit press, and `SurveyEntry` has no right answer and no limit — neither is touched.

### D6 — `dialog.tsx` becomes a real dialog
`DialogHost` gains:
- `role="alertdialog"` + `aria-modal="true"` + `aria-labelledby` pointing at the message paragraph,
  on the `Card` (the backdrop stays a plain div).
- A `ref` on the confirm `Button`, focused in a `useEffect` keyed on `req.id` — keyed on the id so
  a queued second request also takes focus when it surfaces.
- The previously focused element captured on open (`document.activeElement`) and re-focused in
  `close()`.
- A `keydown` listener on `document` while a request is showing: `Escape` calls `close(false)`,
  which resolves an `alert` as `undefined` and a `confirm` as "cancelled" — matching the existing
  `Cancel` button exactly, so no caller's contract changes.

The story interstitial (`PlayScreen.tsx:576`) and how-to-play modal (`PlayScreen.tsx:635`) each get
their own `Escape` handler calling their existing dismiss/close function. They are informational,
so they keep their current markup otherwise.

### D7 — Staff collapsibles swap to the shared `Collapsible`
`StaffChatSection` (`StaffConsole.tsx:517-528`) and `StaffFeedSection` (`:602-608`) are already
`open`/`setOpen` controlled, which is exactly `Collapsible`'s contract (`components/ui.tsx:125`).
The swap keeps the badge markup as the `header` node and moves the body into `children`. No
behavior change beyond the added `aria-expanded` and the larger header.

### D8 — Delete the nested scroller rather than mask it
`PlayScreen.tsx:506` is `max-h-[60vh] overflow-y-auto -mx-1 px-1`. Verified in the current tree:
the map (`:476-480`) and the task (`:482-501`) both render **above** this div and are unconditional
siblings in the same column, so removing the bound cannot push the task off-screen — the task is
already the first thing below the map. The `-mx-1 px-1` gutter is kept (it exists to stop card
shadows clipping), only the height bound and the `overflow-y-auto` go. A fade mask was the fallback
if the hierarchy check had failed; it did not.

## Risks / Trade-offs

- **[Reported "remaining" can overstate after a reload]** → wording is an explicit upper bound
  ("up to N"), and the server remains the only authority: it still refuses at the real cap with
  `resource-exhausted`, which `play-no-silent-failures` already surfaces as a readable message.
- **[Removing the `max-h-[60vh]` lengthens the play page]** → the map and task are pinned above it,
  so the change only affects how far the page itself scrolls. The alternative (a fade mask) keeps a
  gesture trap on a phone, which is the defect being fixed.
- **[Escape-to-cancel could surprise a caller that treats `false` as a distinct outcome]** →
  `close(false)` is exactly what the existing Cancel button does; every caller already handles it.
- **[Enlarging the staff score buttons could wrap the row on a narrow phone]** → the row is
  `shrink-0` inside a `justify-between` flex; four `w-11` buttons plus gaps is ~200px, which fits
  the 320px-minimum phone alongside a truncating team name (`min-w-0 truncate` already set).

## Migration Plan

Pure client change; no data migration, no index, no rule, no env var. Rollback is a revert of the
listed files.

## Test Strategy

**Pure logic — first, and RED before anything else.** New `scripts/test-touch-a11y.ts`, following
the house pattern of `scripts/test-failure-visibility.ts` (plain `tsx` assertion script, picked up
automatically by `scripts/run-unit-tests.mjs`). It asserts against
`apps/play-web/src/lib/interaction.ts`:

- `quizAttemptGuard(undefined, 0).needsConfirm === false` (no limit ⇒ no friction)
- `quizAttemptGuard(0, 0).needsConfirm === false` and `quizAttemptGuard(-3, 0).needsConfirm === false`
- `quizAttemptGuard(NaN, 0).needsConfirm === false`, `quizAttemptGuard(Infinity, 0).needsConfirm === false`
- `quizAttemptGuard(3, 0)` ⇒ `{ needsConfirm: true, remaining: 3 }`
- `quizAttemptGuard(3, 1).remaining === 2`; `quizAttemptGuard(3, 3).remaining === 0`;
  `quizAttemptGuard(3, 99).remaining === 0` (never negative)
- `quizAttemptGuard(3, -5).remaining === 3` (a nonsense count cannot inflate the bound)
- `Number.isInteger(quizAttemptGuard(3.7, 0.4).remaining)`
- `TAP_TARGET` / `TAP_PAD` are static strings containing no `${`, and `TAP_TARGET` encodes 44px.
- Dictionary cross-check: every key this change adds exists in **both** `he` and `en` of
  `apps/play-web/src/i18n.ts`, the Hebrew value contains a Hebrew letter, and the English value
  contains no Hebrew letter — mirroring the sibling script's dictionary block.

Confirm the script **fails** (module missing) before writing `lib/interaction.ts`.

**UI.** No component test runner exists in play-web, so the UI half is proven by: `npx tsc --noEmit`
in `apps/play-web` (the `dialog.tsx` ref/focus work and the `Collapsible` swap are type-checked),
plus `npm run i18n:check` for the new keys. Visual verification of the enlarged controls is a
preview/manual step and is listed as such in tasks.md.

**Not run:** `npm run e2e` — no callable, payload or server behavior is touched, so the emulator
cannot observe this change and must not be started (a live playtest tunnel owns it). Repo-wide
`typecheck` / `lint` / `test` / `creator:build` / `play:build` are run once by the orchestrator at
the end of the wave; the tree is shared with other in-flight lanes.

## Open Questions

- Should the exact attempt count be shipped to participants (a `taskAttempts` field in
  `getMyTeamState`)? Out of scope here; it would turn the "up to N" wording into an exact "N left".
