## 1. RED — the pure decision, failing

- [x] 1.1 Write `scripts/test-touch-a11y.ts` asserting every RED case in design.md's Test Strategy
      against `apps/play-web/src/lib/interaction.ts` (`quizAttemptGuard`, `TAP_TARGET`, `TAP_PAD`),
      plus the dictionary cross-checks for every key this change adds. Run
      `npx tsx scripts/test-touch-a11y.ts` and confirm it fails because the module does not exist.

## 2. GREEN — the pure decision

- [x] 2.1 Create `apps/play-web/src/lib/interaction.ts` with `TAP_TARGET`, `TAP_PAD` and
      `quizAttemptGuard` per design.md D3/D5. No React, no Firebase imports.
- [x] 2.2 Add the new keys to BOTH dictionaries in `apps/play-web/src/i18n.ts`:
      `t.task.attemptConfirm({ remaining })`, `t.task.attemptConfirmBtn`,
      `t.liveOps.dismiss`, `t.staff.signOutConfirm`, `t.staff.adjustApplied({ delta })`,
      `t.play.leaveAria`. Hebrew must be real Hebrew; no `—`, `–` or ` - ` separators.
- [x] 2.3 Re-run `npx tsx scripts/test-touch-a11y.ts` and confirm every assertion passes.

## 3. RTL — machine-data fields and projected boards

- [x] 3.1 Add `dir="ltr"` to the access-code input (`JoinScreen.tsx:237`) and the team-code input
      (`JoinScreen.tsx:361`). Leave `dir="auto"` on the name/team-name inputs untouched.
- [x] 3.2 Add `dir="ltr"` to `CodeEntry`'s station-code input (`TaskRunner.tsx:797`) and to the
      staff PIN input (`StaffConsole.tsx:157`). Leave the staff name field's `dir="auto"` alone.
- [x] 3.3 Swap `text-right` → `text-end` in `TvLeaderboard.tsx:104` and `CeremonyScreen.tsx:179`.

## 4. Touch targets

- [x] 4.1 `TaskRunner.tsx` ordering ↑/↓ (`:887`, `:890`): `w-8 h-8` → `w-11 h-11`.
- [x] 4.2 `TaskRunner.tsx` hint triggers (`:589`, `:690`, and the free-hint variant at `:686`):
      give each a `min-h-[44px]` padded box while keeping the text-link look.
- [x] 4.3 `JoinScreen.tsx` sound + colourblind toggles (`:206`, `:218`): `w-7 h-7` → `w-11 h-11`.
- [x] 4.4 `JoinScreen.tsx` remove-member ✕ (`:432`): give it `TAP_TARGET` and centre the glyph.
- [x] 4.5 `PlayScreen.tsx` share-progress link (`:468`) and the Header leave link (`:959`): pad each
      to the 44px minimum; add `aria-label={t.play.leaveAria}` to leave.
- [x] 4.6 `LiveOps.tsx` dismiss ✕ (`:129`, `:137`): add `aria-label={t.liveOps.dismiss}` and
      `TAP_PAD`.

## 5. Staff destructive controls

- [x] 5.1 `StaffConsole.tsx:415-427`: split the adjusters into a `[-10, -5]` group and a `[+5, +10]`
      group with a wider separator between the groups; `w-9 h-9` → `w-11 h-11`, `gap-1` → `gap-2`.
- [x] 5.2 Add a `Record<teamId, string>` acknowledgement set after `adjustAction.run` resolves,
      rendered on that team's row and cleared on a timer. Clear the timer on unmount.
- [x] 5.3 `StaffConsole.tsx:381-394`: keep Approve filled/primary; demote Reject to an outline
      control (transparent background, danger border and text). Handlers and guards unchanged.
- [x] 5.4 `StaffConsole.tsx:308`: route sign-out through `dialog.confirm(t.staff.signOutConfirm)`.
- [x] 5.5 Swap `StaffChatSection`'s and `StaffFeedSection`'s hand-rolled ▲/▼ headers for the shared
      `Collapsible` from `components/ui.tsx`, keeping the unread badge as the `header` node.

## 6. Dialog accessibility

- [x] 6.1 `components/dialog.tsx`: add `role="alertdialog"`, `aria-modal="true"` and
      `aria-labelledby` on the `Card`; move focus to the confirm button on open (keyed on `req.id`);
      restore focus to the previously focused element in `close()`.
- [x] 6.2 Add a document `keydown` listener while a request is showing: `Escape` → `close(false)`.
- [x] 6.3 Give the story interstitial (`PlayScreen.tsx:576`) and the how-to-play modal
      (`PlayScreen.tsx:635`) their own `Escape` handler calling their existing dismiss/close.

## 7. Scroll trap

- [x] 7.1 Re-verify in the current tree that the map and task both render above `PlayScreen.tsx:506`,
      then remove `max-h-[60vh] overflow-y-auto` from that div, keeping the `-mx-1 px-1` gutter.

## 8. Attempt-limited quiz confirmation

- [x] 8.1 `TaskRunner.tsx`: add `wrongAttempts: Record<string, number>` state; increment it for
      `task.id` in `answer()` on `res.correct === false`.
- [x] 8.2 `QuizEntry`: accept `wrongSoFar`; in the multiple-choice branch only, consult
      `quizAttemptGuard(task.smart?.attemptLimit, wrongSoFar)` and, when `needsConfirm`, await
      `dialog.confirm(t.task.attemptConfirm({ remaining }), { confirmLabel: t.task.attemptConfirmBtn })`
      before calling `onSubmit`. Leave the free-text branch and `SurveyEntry` untouched.

## 9. REFACTOR

- [x] 9.1 Re-read the touched files: confirm every class string added is a static Tailwind literal
      (no interpolation), that new markup uses logical classes (`ms-`/`me-`/`text-start`/`text-end`),
      and that no user-facing string was hardcoded.

## 10. Gates

- [x] 10.1 Run and confirm green: `npx tsc --noEmit` in `apps/play-web` ·
      `npx tsx scripts/test-touch-a11y.ts` · `npm run i18n:check` (PART A clean, no new PART B
      findings). The repo-wide `npm run typecheck` / `lint` / `test` / `creator:build` /
      `play:build` are run once by the orchestrator at the end of the wave, because the tree is
      shared with other in-flight lanes. `npm run e2e` is **excluded**: this change touches no
      callable, no payload shape and no server behavior, and the emulator must not be started.
- [ ] 10.2 Note the manual/preview verification still owed: on a phone-width viewport, confirm the
      enlarged staff adjusters do not wrap and the play page scrolls as one surface.
