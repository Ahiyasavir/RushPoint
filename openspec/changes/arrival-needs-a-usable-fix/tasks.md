## 1. Establish the defect from the code, not from a guess

- [x] 1.1 Confirmed `evaluateTrigger` takes no accuracy; `completeTask` / `reportArrival`
  accept none; `withLocation` dropped `p.coords.accuracy`. Confirmed `safeZone.ts` DOES
  read accuracy, so the asymmetry is real and one-sided.
- [x] 1.2 Confirmed the default arrival radius is 40m, so an ordinary 100 to 500m indoor
  fix can satisfy it from anywhere.

## 2. The pure verdict — RED

- [x] 2.1 `scripts/test-arrival-fix-quality.ts`: the reported field case (200m fix, 40m
  radius) must NOT be arrival. Run; confirmed RED because the module did not exist.
- [x] 2.2 Ordinary outdoor fixes unchanged; genuinely-too-far unchanged and still
  carrying the distance; the equal-to-radius boundary accepted. Still RED.
- [x] 2.3 Coarse-and-far reported as COARSE, not as too far — a distance claim a fix
  cannot support is not advice a player can act on. Still RED.
- [x] 2.4 Every shape of absent accuracy reproduces the old decision exactly.
- [x] 2.5 `retriable` and `countsAsAttempt` correct per outcome, plus a 6000-case seeded
  sweep asserting arrival is never granted on evidence that cannot support it, with
  every outcome reached and the denominator printed.

## 3. The pure verdict — GREEN

- [x] 3.1 `packages/shared/src/arrivalFix.ts` + barrel export. 50 assertions green.

## 4. Server

- [x] 4.1 `completeTask` accepts `accuracyMeters` and applies the verdict BEFORE the
  distance check.
- [x] 4.2 The coarse refusal is `unavailable`, not `failed-precondition`, so the client
  can tell "stand still" from "walk".
- [x] 4.3 `reportArrival` gets the same guard for the hidden-mission unseal, with a
  digit-free reason so the sealed point stays untriangulable.
- [x] 4.4 The test-drive bypass still applies to both, so a creator can rehearse from
  their desk exactly as before.

## 5. Participant app

- [x] 5.1 `withLocation` passes `p.coords.accuracy` as an optional THIRD callback
  argument, so existing two-argument callers compile and behave unchanged.
- [x] 5.2 Both check-in call sites forward it.
- [x] 5.3 The `unavailable` code renders a distinct message with tone `progress`, not
  `error`: the player is probably in the right place and the phone does not know it yet.
- [x] 5.4 Hebrew and English copy.
- [x] 5.5 Corrected the now-false comment in `withLocation` claiming "no safety verdict
  is fed by this helper" — it feeds one now, and the accuracy is load-bearing.

## 6. Gates

- [x] 6.1 `npm run verify` — **299/299 pure-logic unit files green**, i18n PART A and
  PART B clean, every build green. The only red gate is the pre-existing
  `check-marketing-output` failure on the untracked `_kit-b83f9d2e` kit, outside this
  change.
- [x] 6.2 `npm run e2e` — **ALL PASS**, exit 0, 121/121 callables covered, no stale
  exempt entries. Both changed payloads are backward compatible, as D4 requires.

## 7. Ship

- [ ] 7.1 API by VPS rebuild, participant app by `deploy:hosting`, either order (D4).
- [ ] 7.2 Post-deploy: check in at a real mission outdoors and confirm nothing changed;
  check in from indoors with a deliberately poor fix and confirm the retriable message.

## 8. Follow-ups filed, not built

- [ ] 8.1 Builder legibility: a mission with skip-GPS on, an unplaced pin, or a very
  large radius all mean "anyone can check in from anywhere", and the card says nothing
  (design Open Question 1).
- [ ] 8.2 Surfacing a player stuck behind a repeatedly coarse fix to the organizer
  (design Open Question 2).

## 9. THE CORRECTION — the first version of this gate halted the game

Ahiya read the shipped design and rejected it on sight, before a line of it ran in the
field: *"אם אין הרבה קליטת GPS המשחק לא יוכל להמשיך, וגם אם הרדיוס הוא 4 מטר אז זה אף
פעם לא יעבוד."* Both halves were correct, and both were fatal.

`accuracy > radius ⇒ refuse` had no ceiling and no exit:

- A mission authored at **4m** is unwinnable by construction — a consumer handset
  essentially never reports 4m accuracy, so the refusal is unconditional and permanent.
- **Anywhere the sky is poor** — an alley, a courtyard, under trees — the team is
  standing in exactly the right place and the button never works, forever.

A player who cannot advance is a worse outcome than one who advanced on a weak fix:
the first ends their game, the second costs some points. CLAUDE.md already states the
underlying rule twice ("every client-side blocking flag must fail OPEN", "a disabled
primary button explains nothing") — a gate with no exit is that same defect wearing a
server costume. The rule simply had not travelled to this module.

- [x] 9.1 **RED first.** 13 new assertions against the module as shipped, failing for
  the right reasons — headline: a 4m mission with an ordinary 18m fix returned
  `fixTooCoarse`, and the hopeless-reception case never passed at all.
- [x] 9.2 **The radius floor.** `ARRIVAL_RADIUS_FLOOR_M = 25`, applied as
  `max(authored, floor)`. It only ever WIDENS, so no mission becomes harder than it was
  authored. Reported back as `effectiveRadiusM` so no caller re-derives it.
- [x] 9.3 **The floor applies to the DISTANCE check too**, at both call sites —
  `evaluateTrigger` is now passed `fix.effectiveRadiusM`, not the authored radius.
  Without this a 4m mission cleared the accuracy gate and then failed the distance gate
  one line later: the same dead end wearing a different message.
- [x] 9.4 **The grace window.** `COARSE_FIX_GRACE_MS = 10_000`, the number Ahiya
  named — long enough for a cold fix to sharpen, short enough to read as a pause rather
  than a wall. Measured from the team's FIRST refusal at that mission; a repeat press
  inside the window does NOT restart it, or the window would never arrive.
- [x] 9.5 **It forgives imprecision, never distance.** Once the window opens the coarse
  check stops short-circuiting and the distance check runs, so a player at home is
  still `tooFar` however long they wait. Swept, not asserted once: of 2,633 open
  windows, 2,054 were still refused on distance.
- [x] 9.6 **`graceElapsed` fails SHUT** on every unusable input — missing clock, NaN,
  a stamp in the future. A window that cannot be measured has not elapsed; inventing
  elapsed time would open the gate on corrupt data rather than on a decision.
- [x] 9.7 **The clock's home: a flat `coarseFixSince` map on the TEAM document**, keyed
  by taskId. NOT a field on the task record — those live inside the `stages` array, and
  CLAUDE.md is explicit that an array element can never be dotted-path-updated, so one
  stamp would need a read-modify-write of the whole array inside a transaction, on a
  REFUSAL path that has no transaction. A nested object merges in one write.
- [x] 9.8 **The unverified record**, stamped inside the EXISTING completion / latch
  transaction so it is written atomically with the arrival it describes and can never
  exist without it. Only ever set to true.
- [x] 9.9 **Withheld from the participant by construction.**
  `sanitizeTeamForParticipant` is a copy-out allow-list, so `arrivalUnverified` and
  `coarseFixSince` never reach a player. Documented in place as a DECISION, beside
  `submittedAnswer`, which is withheld the same way for the same kind of reason:
  telling a player "waiting got you in" publishes the way through the gate.
- [x] 9.10 **`listRunTeams` reports a COUNT**, never the places. One team arriving this
  way at every stop is the only pattern worth walking over for; where they were is not
  the organizer's business.
- [x] 9.11 **Console strip**, `arrivalsUnverified`, severity **info** and deliberately
  not phrased as cheating — the server let them through precisely BECAUSE refusing was
  the worse bug. 4 new vitest cases; 137 green in that file.
- [x] 9.12 **One press, not two.** The app now presses again for the player once, on
  its own, `COARSE_FIX_GRACE_MS + 1500` after a retriable refusal, with a FRESH fix —
  ten seconds is usually exactly what a cold GPS needed, so re-sending the refused
  reading would waste the wait. Exactly once per mission: anything still refusing after
  the window is a real problem the player must see. Cancelled on task change and on
  unmount, because TaskRunner does NOT remount between missions.
- [x] 9.13 The message still never names the ten seconds. A countdown would be an
  instruction manual for the gate.
- [x] 9.14 **The old sweep was measuring the wrong thing and passing.** It compared
  against the AUTHORED radius, so after the floor it asserted a property the module no
  longer had — and the combination that would have caught it is about one sweep in a
  thousand. Rewritten against `effectiveRadiusM`, 6,000 → 20,000 sweeps, all four
  outcomes reached, and now printing its DENOMINATORS (2,400 sub-floor radii, 2,633
  open windows) so "examined nothing" can never again read as "found no problem".

## 10. Gates for the correction

- [x] 10.1 `npm run verify` — 302/302 pure-logic unit files, i18n PART A and PART B
  clean, every build green, lint 0 errors. The only red gate is the pre-existing
  `check-marketing-output` failure on the UNTRACKED `_kit-b83f9d2e` kit, outside this
  change and present before it.
- [x] 10.2 `npm run e2e` — **ALL PASS, exit 0**, 122/122 callables covered. 15 new
  assertions: 11 new assertions in the arrival scenario, including a
  deliberate `COARSE_FIX_GRACE_MS + 1500` wait. That wait is LOAD-BEARING: a test that
  presses again too early gets the CORRECT refusal and would report a passing feature
  that never ran. Same trap the late-joiner scenario already fell into once.

- [x] 10.3 **Two guards fired and were ANSWERED, not worked around.**
  `test-no-dashes` caught a hyphen in both the English ("check-ins") and the Hebrew
  (`מ-${m}`) of the new copy; both were rephrased. The e2e's `listRunTeams` row
  allowlist refused `unverifiedArrivals` until it was consciously classified — the
  entry records WHY a count is publishable where a list of places would not be.
- [x] 10.4 **One existing e2e expectation changed, deliberately and visibly.**
  `exact: 10m-away check-in rejected` encoded the old promise that a 4m authored radius
  is honoured literally — which is the defect. It now asserts both halves of the new
  contract: a check-in well beyond the floor is still rejected, and a 10m one is
  accepted. The comment says why the expectation moved, so a future reader does not
  read it as a test bent to fit the code.
- [x] 10.5 **The Builder now tells the truth about a sub-floor radius.** The tight
  preset on that very control is 4m, so the Builder was handing creators a value the
  game would not honour literally, with no way to discover it except by failing to
  check in at their own mission. `radiusBelowFloor` / `enforcedRadiusM`
  (`lib/locationPicker.ts`, 11 new assertions) drive a note under the radius input.
  Verified present in the built BuilderPage chunk, not just in source.
