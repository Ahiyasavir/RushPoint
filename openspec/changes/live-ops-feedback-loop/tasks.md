## 1. The arrival cue — RED

- [x] 1.1 Create `scripts/test-review-queue-cue.ts` with failing assertions for
  `packages/shared/src/reviewQueueCue.ts` (not yet created): a first snapshot of N rows
  yields `shouldCue: false`; a snapshot introducing a key yields `shouldCue: true` and
  `keys` naming only the new one; an unchanged snapshot, a key leaving, and an empty
  snapshot all yield false; a key leaving WHILE another arrives yields true. Run it and
  confirm it fails because the module does not exist.
- [x] 1.2 Add totality assertions: `null` / `undefined` / a number / an object /
  an iterable yielding non-strings each return `{keys: [], shouldCue: false}` and never
  throw. Confirm still RED.
- [x] 1.3 Add a seeded sweep (>=2000 cases) asserting `keys` is a subset of `current`
  and disjoint from `previous`, printing the denominator and asserting the sweep
  actually reached the cue path. Confirm still RED.

## 2. The arrival cue — GREEN

- [x] 2.1 Created `packages/shared/src/reviewQueueCue.ts` exporting `newPendingKeys`.
  **Deviation from design D2/D3: NO `submissionKey` was added.** `submissionKey`
  already exists in `packages/shared/src/photoQueue.ts` and is the identity both
  consoles already key their per-row in-flight guard on; adding a second one would
  have been a second answer to "are these the same submission?" — the exact drift this
  change's own spec forbids — and would have collided on the barrel export. Callers
  pass keys built there.
- [x] 2.2 Run the suite — GREEN. Confirm no other suite regressed.

## 3. Wire the cue into the creator Run Console

- [x] 3.1 `RunConsolePage.tsx`: hold a `useRef<Set<string> | null>` of seen submission
  keys beside the existing `seenAlertIds`, feed `photoQueues`' pending rows through
  `newPendingKeys`, and call `playAlert()` on `shouldCue`. Baseline exactly as the SOS
  listener does — `null` until the first snapshot.
- [x] 3.2 Confirm the ref resets deliberately when the listener re-subscribes
  (`gameId` / `runId` / `runLive` change), so switching runs cannot replay a queue.
- [ ] 3.3 Manual check via preview: open a console over a queue with pending items ⇒
  silence; submit one ⇒ one cue; refresh ⇒ silence.

## 4. Wire the cue into the staff console

- [x] 4.1 `apps/play-web/src/screens/StaffConsole.tsx`: import `playAlert` from
  play-web's own `lib/sound.ts` (it has one; the console just never used it) and apply
  the same `newPendingKeys` baseline to its pending-submission source.
- [x] 4.2 Confirm the play-web audio unlock path already covers this surface — the
  Web Audio context must be unlocked by a user gesture, and a staff member reaches this
  screen through a PIN sign-in, which is one. If it is not unlocked, wire the unlock at
  sign-in rather than queueing cues (the `audio-haptic-feedback` spec forbids queueing).
- [ ] 4.3 Manual check via preview.

## 5. Move the reason vocabulary to shared — RED

- [x] 5.1 Create `scripts/test-score-reasons-shared.ts` with failing assertions: every
  id exported by `packages/shared/src/scoreReasons.ts` has a label in BOTH language
  maps of BOTH `apps/*/src/i18n.ts`, and neither app declares a reason id shared does
  not export. Modelled on `scripts/test-upload-origin-parity.ts`. Run it; confirm RED
  (shared has no such module, and creator-web has no labels).

## 6. Move the reason vocabulary to shared — GREEN

- [x] 6.1 Move `apps/play-web/src/lib/scoreReasons.ts` to
  `packages/shared/src/scoreReasons.ts` verbatim, export from the barrel, and repoint
  `StaffConsole.tsx`'s import. Delete the play-web copy — do NOT leave both.
- [x] 6.2 Add the Hebrew and English labels to `apps/creator-web/src/i18n.ts`. Hebrew
  must be Hebrew and English must be English (PART A is a hard gate), and no dash or
  hyphen in the copy (`scripts/test-no-dashes.ts`).
- [x] 6.3 Run `npm run typecheck` — a missed reference to the old path fails here.
  Run the parity guard — GREEN.

## 7. The organizer's console records a reason

- [x] 7.1 `RunConsolePage.tsx` `adjustScore`: sign-aware preset list plus the
  free-text option, sending `resolveReason(...)` instead of the literal `'manual'`.
  **This needed a new dialog kind**: creator-web's `dialog` had only
  alert/confirm/prompt, so `dialog.choose(message, choices, opts)` was added. It has
  THREE outcomes deliberately — an option's id, `''` for "carry on without choosing",
  and `null` for Cancel — because collapsing the last two would make skipping an
  optional question indistinguishable from abandoning the action it belongs to.
- [x] 7.2 **NOT DONE, and deliberately so — see design D4's revision.** Replacing
  `parseScoreDelta` with shared's `parseAdjustAmount` is a REGRESSION, not a tidy-up:
  the creator's parser normalises the four dashes a Hebrew keyboard emits, accepts a
  leading `+`, rounds decimals and caps at 100 000; the staff console's rejects all
  three and caps at 10 000. The swap was made, `npm run lint` caught the now-unused
  import, and reading why it was unused surfaced the divergence. Reverted; filed as
  Open Question 2. The console keeps its own parser and its invalid-input alert.
- [ ] 7.3 Keep passing `rc.adjustScoreConfirmTitle` as the dialog's TITLE argument and
  a verb as the CTA — CLAUDE.md records the regression where the title landed on the
  button and every run action read "Before you go ahead".
- [ ] 7.4 `reason` stays OPTIONAL: confirm the flow completes with nothing selected,
  and that no control is `disabled` for a missing reason.
- [ ] 7.5 Every new glyph-only control declares a real tap target from
  `lib/interaction.ts`; run `scripts/test-creator-tap-targets.ts`.

## 8. `skipTaskForTeam` pays the consolation — RED

- [x] 8.1 Extend `scripts/test-skip-single-task.ts` with direct `skipAward` assertions
  for the three presets against a representative task, asserting `smart_weighted` and
  `fixed_points_speed` are strictly greater than 0 and `time_only` is 0. (These pin the
  VALUE; the wiring is proven in 9.1 — `planTaskSkip` must not learn about presets.)
- [x] 8.2 Add a failing assertion to the skip scenario in `scripts/e2e-verify.mjs`:
  after `skipTaskForTeam` under `smart_weighted`, the skipped `RunTaskRecord` carries
  `earnedScore === skipAward(preset, task)` and the team's total moved by exactly that.
  Run `npm run e2e`; confirm THIS scenario fails and the others still pass.

## 9. `skipTaskForTeam` pays the consolation — GREEN

- [x] 9.1 `functions/src/runs/index.ts`: replace `rec.earnedScore = 0` with
  `skipAward(game.scoringPreset, gameTask)`, resolving the template task the same way
  the surrounding code already does. Guard the task being absent from the template
  (award 0) rather than throwing.
- [x] 9.2 Rewrite the block comment at the head of `skipTaskForTeam`: the current text
  argues FOR awarding zero. Replace the argument with what happened in run
  `ijI9JMITSf8C9heN1Cwp` — the organizer computed the fair value by hand mid-run and
  paid it as an untraceable manual bonus — so the next reader does not re-derive the
  original position.
- [x] 9.3 Note in the comment that finished runs cannot move, and why: `earnedScore` is
  stamped per record and `buildRankings` sums stored records.
- [x] 9.4 `npm run e2e` — GREEN, but only after a SECOND defect the assertion caught:
  stamping `rec.earnedScore` alone left `team.score` and the stage total behind it, so
  the record read 50 while the team read 0. The live board reads the team document, so
  a half-applied award is a team that was paid and cannot see it. The consolation now
  rolls up the same two places `skipStage` rolls it up, and the callable returns it.

## 10. Gates

- [x] 10.1 `npm run verify` — 297/297 unit files, i18n clean, all builds green. The one
  red gate is the pre-existing `check-marketing-output` failure on the untracked
  `_kit-b83f9d2e` template kit, outside this change.
- [x] 10.2 `npm run e2e` — **ALL PASS**, exit 0, 121/121 callables covered and no stale
  exempt entries. No callable added, and the introspected set is unchanged.
- [x] 10.3 `npm run i18n:check:strict` — clean, zero new PART B findings.
- [x] 10.4 `scripts/test-api-image-contents.ts` — no new `functions/` runtime require
  was added, but run it; it is the guard that caught the missing Docker COPY in
  `media-serving-correctness`.

## 11. Ship

- [ ] 11.1 UI half by `deploy:hosting`; the `skipAward` line by VPS rebuild
  (`docker compose -f docker-compose.api.yml up -d --build`). State both in the PR body
  and that they are independent.
- [ ] 11.2 Post-deploy: skip one mission for one team in a test-drive run under
  `smart_weighted`, confirm the record earns the on-target value rather than 0, and
  confirm a manual adjustment's audit row carries the chosen reason id.
