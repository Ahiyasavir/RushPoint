# Wave-H — Task grading-correctness & answer-secrecy audit

Read-only trace of EVERY task type end-to-end: the participant sanitizer (secrecy)
and every grading callable (correctness). Goal = catch a leaked answer key, a wrong
grade, a false-reject that strands a player, a double-score, or an accepted spoof.

Scope note — items already fixed in wave-f / wave-g are NOT re-reported and were
re-confirmed correct in passing:
- hidden-location omission from `getMyTeamState` / `buildRecommendations` / the sealed
  sanitizer stub (wave-D) — verified still intact.
- `requestTaskHint` future-stage `assertStageActiveForTask` guard (wave-G #1) — present.
- live-photo-feed hidden-location exclusion `shouldFeedTask` (wave-F S1) — present.
- discovery-POI bonus via `bonusPenalty` channel + finalize TOCTOU in-txn re-check
  (wave-G scoring) — present.

Line numbers are against the tree at audit time.

---

## CONFIRMED findings (prioritized)

| # | file:line | type + invariant | concrete failure | sev | one-line fix |
|---|-----------|------------------|------------------|-----|--------------|
| 1 | `functions/src/index.ts:777-866` `verifyStationCode` | smart_station — the anti-brute-force `attemptLimit` must be ENFORCED (as it is for quiz/numeric) | `attemptLimit` is only **counted** here (`:836-841` increments `taskAttempts`), never enforced. Comment at `:834-835` admits "enforcing a station attempt cap stays out of scope." A creator who sets `smart.attemptLimit = 3` on a code station gets **no lockout** — a team can submit unlimited codes (throttled only by the global per-uid rate limiter), brute-forcing a short/numeric `secretCode`. `submitTaskAnswer` (`runs/index.ts:3269-3275`) DOES throw `resource-exhausted` at the cap → asymmetry: the same authored control works on a quiz, silently no-ops on a station. | **Med** | Mirror `submitTaskAnswer`: before the code compare, read `taskAttempts[taskId]` and `throw resource-exhausted` when `attemptLimitReached(attempts, stationTask.smart.attemptLimit)`. |
| 2 | `functions/src/index.ts:777-866` `verifyStationCode` | smart_station — an EXPIRED / not-yet-RELEASED task must be refused by its completion callable (per `types/index.ts:341` contract "refused by completion callables, auto-skipped when in flight") | `verifyStationCode` has **no** `isReleased` / `isExpired` / `assertTaskNotExpired` gate (grep confirms none in `index.ts`). `completeTaskForTeam` — the shared choke point — also does NOT check release/expiry (grep of `runs/index.ts:651-964` finds none; those gates live only in the callable wrappers). So a smart_station that **expires while a team holds it** can still be completed for full points by submitting the code after expiry — and a scheduled-release station can be completed before its window if the taskId+code are known. `completeTask` (`:2867-2877`) enforces both gates; `verifyStationCode` is the outlier. | **Med** | Add the same release+expiry block `completeTask` uses (load run `launchedAt`, `isReleased`/`isExpired`) after `assertStageActiveForTask` in `verifyStationCode`; same for `submitStationPhoto`. |
| 3 | `functions/src/index.ts:869-1017` `submitStationPhoto` | photo — same expiry/release contract | Same gap as #2 for the photo path: no `isReleased`/`isExpired`. An expired photo task's upload still auto-approves (or queues for staff review) and scores. Lower than #2 only because a photo also needs staff/autoApprove. | **Med/Low** | Same fix as #2. |
| 4 | `packages/shared/src/geo.ts:84-85` `evaluateTrigger` | radius/exact trigger — a valid on-site check-in must be accepted | `const limit = radiusM != null && Number.isFinite(radiusM) ? radiusM : default` does **not** guard `radiusM > 0` (unlike `evaluatePresence` `:124` which requires `> 0`). A task persisted with `geofenceRadiusMeters === 0` (or negative) yields `limit = 0`, so `distanceM > 0` is true for ANY real GPS → the task is **permanently unwinnable** (player stranded at the correct spot). The creator UI clamps to `Math.max(1,…)` (`TaskWizard.tsx:993`), so this is a defense-in-depth gap reachable only via a hand-crafted `updateGame` or legacy data — but it's a silent hard-stranding when it happens. | **Low** | Match `evaluatePresence`: `radiusM != null && Number.isFinite(radiusM) && radiusM > 0 ? radiusM : defaultRadiusFor(mode)`. |
| 5 | `packages/shared/src/challenge.ts:40-42` `matchesTaskAnswer` (numeric) | numeric — only a genuine number should grade correct | `parseFloat(raw)` is lenient: `parseFloat("42abc")` → `42`, so `"42anything"` grades **correct** against `numericAnswer:42`. Not a leak and not a stranding (it over-accepts, never rejects a valid answer), so purely a minor grading-laxity. Boundary handling is otherwise correct: `<=` tolerance is inclusive, `NaN`/`null` → false. | **Low** | Use a strict parse (`Number(raw.trim())` + `Number.isFinite`) if strictness is desired; or leave as intentional leniency (document it). |
| 6 | `functions/src/games/index.ts:489-515` `checkChallengeAnswer` | quiz/numeric teaser — public answer-check must not be a free brute-force oracle | No `enforceRateLimit` and no auth (by design — public acquisition surface). Returns only `{correct}` (answer key never leaves the server — secrecy is CLEAN). But an unauthenticated caller can brute-force a published task's answer (a small numeric range is trivially enumerable). Non-scoring teaser, so impact is limited to spoiling a public teaser answer. Note: an ordering-variant quiz (`orderItems`, no `answers`) always returns `correct:false` here because `matchesTaskAnswer` reads `task.answers ?? []` — a harmless teaser dead-end, not a scoring path. | **Low** | Add `enforceRateLimit` keyed on IP/appId (or a per-game attempt cap) to the public challenge check. |

---

## CLEAN — verified correct (bill of health)

| surface | file | verdict |
|---------|------|---------|
| Sanitizer answer-key stripping — quiz `answers`, numeric `numericAnswer`, sequence `steps[].answer`, ordering `orderItems`, station `smart.secretCode`/`adminNotes`, paid `hint` | `functions/src/runs/sanitizeTask.ts:74,103-127` | All six secrets destructured out (`{ smart, hint, answers, numericAnswer, steps, orderItems, ...rest }`) or omitted from the rebuilt `smart` allow-list. `steps` re-emitted as `{id,prompt}` only (answer dropped). `secretCode` never in the `smart` allow-list. Survey `surveyChoices` deliberately passed (no answer key). Correct for every type. |
| Sealed hidden-location stub | `sanitizeTask.ts:40-56` | Built by CONSTRUCTION (fields default WITHHELD), so a new `Task` field defaults to hidden on the sealed path. Fails CLOSED when `revealed` is omitted. |
| Ordering shuffle correctness | `sanitizeTask.ts:79-82` + `shared/ordering.ts:48-79` | Server grades against the AUTHORED `task.orderItems` order (`matchesOrderedAnswer`), position-by-position by normalized item TEXT — the shuffled display order the client shows is irrelevant to grading, so a shuffle can never mis-grade. Shuffle is seed-deterministic (`teamId:taskId`, reload-stable), and the identity guard (`:56-58`) guarantees the payload never equals the authored order. No seed ⇒ field stripped (fail closed). |
| e2e allowlist mirror | `scripts/e2e-verify.mjs:229-279` | `ALLOWED_TASK_KEYS`/`ALLOWED_SMART_KEYS`/step-key guard exclude every answer field; a NEW leaking key fails the sanitizer scenario loud. Mirror matches the current `Task` shape (media/survey/ordering/presence/expiry/unlock all accounted). |
| Locked/future-stage answer oracle | `runs/index.ts:3158-3162,3209,3330`, `index.ts:804` | `assertStageActiveForTask` runs BEFORE any correctness compute AND before the attempt-limit read on `submitTaskAnswer`/`submitSequenceStep`/`verifyStationCode`/`reportArrival`/`requestTaskHint` — a wrong vs a correct probe on a locked stage throw the byte-identical error. No stage-probe oracle. |
| completeTask type gate (anti-cheat) | `runs/index.ts:2887-2895` | `completeTask` refuses any type other than `field`/`self_report`/`geofence`, so a bare-id completion can't score a quiz/photo/station/sequence with no verification. |
| Spoof resistance — radius/exact | `runs/index.ts:2897-2918`, `geo.ts:74-97` | Server computes haversine distance from server-held coords; `evaluateTrigger` rejects out-of-range. Hidden-location rejections are digit-free (no distance oracle to triangulate the secret spot). Coords validated up front (`assertCoordIfPresent`). No self-declared arrival. |
| reportArrival grading path | `runs/index.ts:3043-3107` | Same distance rule (`evaluateTrigger {hidden:true}`), controller-only, rate-limited, stage-scoped, coords required, digit-free reason, latch idempotent (whole-array rewrite, never a dotted array path). No new leak vs wave-D. |
| requirePresence answer gate | `runs/index.ts:3217-3222` + `geo.ts:114-127` | Missing/invalid GPS → refuse ("no disable-location bypass"); no coords on task → pass (opt-in never a lockout); reason carries no distance/answer (safe for hidden). Checked BEFORE grading so an out-of-range probe consumes no attempt slot. |
| Attempt-limit / brute-force — quiz/numeric | `runs/index.ts:3264-3294` | Cap read BEFORE correctness; even a correct answer is blocked once locked (`resource-exhausted`). Wrong attempts recorded via a real nested map (not a dotted key). Exhausting the cap dead-ends scoring but does not crash the play loop. (Only smart_station is unguarded — finding #1.) |
| Sequence step ordering | `runs/index.ts:3334-3348` | Must answer `stepIndex === done` (in order); replays of cleared steps are a benign no-op; empty `step.answer` = tap-to-confirm (accepted); completes exactly at `newDone >= steps.length`. No off-by-one. |
| Power-up × grading interaction | `runs/index.ts:842-934` | `time_only` earns 0 and never rolls a power-up (`:918` guard) — pure-time ranking uncorrupted. `double_points` doubles only `earnedScore > 0` (a 0-point task keeps the double armed, not burned) and consumes exactly one armed slot (`:890-902`). Flat `bonus_points` flows through the `bonusPenalty` channel `buildRankings` reads; a second concurrent double converts to a bonus (single armed slot). Deterministic seeded roll → idempotent replay. All inside the one completion transaction, so no double-count. |
| Idempotent / duplicate completion | `runs/index.ts:765-767,776,2927`, `index.ts:862` | An already-terminal task record folds to a no-op (`completed:false`); callers skip re-assign + slot-release, so a duplicate submission never double-scores nor leaks a station slot. `heldSlot` guard stops a cross-team completion from draining another team's reservation. |
| Unwinnable-task authoring guard | `shared/taskCompletability.ts` + `games/index.ts:182` + `runs/index.ts:217` | `isTaskCompletable` (quiz needs a non-empty answer / valid orderItems; numeric needs finite `numericAnswer`; station needs `secretCode`; sequence needs steps) is enforced server-side at BOTH `updateGame`/`createGame` and `launchRun`, so an empty-answer-key task can't reach players — closing the "false-reject strands everyone" class at the source. |
| Finished-run straggler completion | `runs/index.ts:681-683,729-731` | Rejected at both the pre-txn AND in-txn `status==='finished'` check (wave-G TOCTOU fix) — a last-second completion can't rewrite the frozen final board. |

---

## NEEDS RUNTIME CHECK

None of the six confirmed findings needs the emulator to confirm the code path — all
are readable defects. Finding #2's real-world trigger (a station expiring *while in
flight*, then completed by code) is best proven with an e2e scenario: author a
smart_station with `expiresAfterMinutes` fractional, assign it to a team, let it
expire, then `verifyStationCode` with the correct code and assert it is REFUSED
(currently it would score). That scenario does not yet exist in `e2e-verify.mjs`.

---

## Highest-severity takeaway

The answer-secrecy boundary (the sanitizer + its e2e allowlist mirror) is **clean for
every task type** — no leaked key found. The real cluster is **grading-gate asymmetry
on the smart_station / photo callables**: `verifyStationCode` (and `submitStationPhoto`)
skip the `attemptLimit` enforcement (finding #1) and the release/expiry gate (findings
#2/#3) that `completeTask` and the answer callables enforce, because the shared
`completeTaskForTeam` choke point never carried those two gates — each wrapper must add
them, and the station/photo wrappers didn't. Fix by porting `completeTask`'s
release+expiry block and `submitTaskAnswer`'s attempt-limit block into
`verifyStationCode`/`submitStationPhoto`.
