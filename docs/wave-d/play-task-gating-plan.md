# Wave D — Play task gating (hidden-location reveal + locked-task visibility)

> ## Revision (post-review) — the user's rulings, which OVERRIDE §5 below
>
> **Status: IMPLEMENTED.** The plan below is kept as the reasoning record; where it
> disagrees with this section, this section wins.
>
> **R1. Visibility — simpler and stronger than the §2.1 three-tier rule.**
> The user's rationale: *"it doesn't matter for them since they are not the ones
> choosing where to go"* — routing assigns the route, so a player can act on
> nothing except their current task. The implemented rule is therefore:
> `getMyTeamState` ships **full content only for the team's ASSIGNED task and for
> tasks the team has already COMPLETED** (history/progress must still render).
> **Every other task of the active stage is omitted entirely** — no title, no
> stub, no `lockedReason`. The `stub` tier of §2.1 was **not built**; neither was
> the `classifyTaskAvailability` refactor of §2.2 (with only two visible states
> there is no truth table to share, and routing needed no change).
> This subsumes the pre-read leak §2.1 identified (a multi-task stage used to ship
> every task's quiz choices at once); the user approved closing it here.
> ⇒ answers **P1** (hide entirely) and **P4** (adopt, in this same change).
>
> **R2. Hidden-location arrival:** implemented as planned — option (b) built on
> option (c)'s predicate. New controller-only `reportArrival({taskId, lat, lng})`
> reuses the same haversine + `evaluateTrigger(…, {hidden:true})` rule as a
> check-in and latches `arrivedAt` on the team's `RunTaskRecord`.
>
> **R3. Coordinates ARE released after arrival** (reverses the §1.3 / **P2**
> recommendation): a player who wanders off must be able to navigate back. Before
> arrival the payload is the sealed stub; after arrival the task sanitizes like any
> other task, coordinates and radius included, and the map pin is drawn. The
> `locationHidden` flag is kept so the clue chrome survives.
>
> **R4. Anti-spoof** is byte-identical to the check-in path, with a tighter rate
> budget (`reportArrival: 30/min` vs `completeTask: 60/min`) so it can never become
> a cheaper grid-search oracle. No distance is ever returned. **P3** (hint before
> arrival) = yes, as recommended. **P5** (manual button) = unlimited, rate-limited.
>
> **R5. Deliberately obsoleted test.** The `unlockable tasks` e2e scenario asserted
> that a LOCKED task still shipped with `unlockAfterTaskIds` intact. Under R1 that
> is wrong. The assertion is **inverted, not deleted**, with the product decision
> written into the diff comment. `LockedTasksList` in the play UI now renders null
> by design and carries a comment saying so.
>
> **Files touched beyond the original ownership list, and why:**
> `packages/shared/src/types/index.ts` (`RunTaskRecord.arrivedAt` — the latch has to
> live on the run record), `packages/shared/src/rateLimit.ts` (a budget for the new
> bucket; without it `enforceRateLimit` fails open with a warning),
> `functions/src/index.ts` (one re-export line). No `apps/creator-web` file was
> touched.
>
> ---

**Status:** PLAN ONLY. Nothing implemented. No source file touched.
**Branch:** `topographic-maps`.
**Owned files for the implementation pass:** `functions/src/runs/sanitizeTask.ts`,
`functions/src/runs/index.ts`, `functions/src/routing/assignNextTask.ts`,
`apps/play-web/src/screens/PlayScreen.tsx`, `apps/play-web/src/components/TaskRunner.tsx`,
`apps/play-web/src/i18n.ts` (+ the two unavoidable seams called out in §1.6).
**Explicitly out of scope:** `apps/creator-web/**` (Builder is another agent's).

---

## 0. What the code does today (verified, with line anchors)

| Fact | Where |
|---|---|
| `hideLocation` strips only `coordinates` + `geofenceRadiusMeters`, nulls `smart.stationCoords`/`smart.geofenceRadiusMeters`, adds `locationHidden:true`. **`title`, `description`, `type`, `media`, `choices`, `orderItems`, `surveyChoices`, `steps[].prompt`, `smart.longInstructions` all still ship.** | `functions/src/runs/sanitizeTask.ts:52-95` |
| `getMyTeamState` sanitizes **every task of the active stage**, not just the assigned one. | `functions/src/runs/index.ts:3312-3336` |
| `getMyTeamState` accepts **only** `{ownerUid, gameId, runId, code}` — **no lat/lng today**. | `functions/src/runs/index.ts:3275-3277` |
| Arrival authority today is `completeTask`: server-held coords → `haversineKm` → `evaluateTrigger(mode, distM, radius, {hidden})`. Rejection message carries no distance for hidden tasks. | `functions/src/runs/index.ts:2859-2880`, `packages/shared/src/geo.ts:74-97` |
| `updateLocation` already receives a controller-only GPS ping (~20 s) and writes `teamLocations` + `locationTrack` + safe-zone state. Lives in `functions/src/index.ts:296-356` (**outside my ownership list**). | — |
| Routing candidate filter already drops: completed, paused/closed, unreleased, expired, unlocked-gate-unmet, station-cap-full. | `functions/src/routing/assignNextTask.ts:174-181` |
| Play UI: hidden task renders clue box but the **title/description are rendered above it unconditionally**. | `apps/play-web/src/components/TaskRunner.tsx:415-435` |
| Hidden tasks are already excluded from map pins. | `apps/play-web/src/screens/PlayScreen.tsx:388` |
| Sanitizer allowlist mirror lives in the e2e script. | `scripts/e2e-verify.mjs:229-263` |
| Anti-spoof today = "server recomputes distance from client-supplied GPS against server-held coords"; the adversarial sim's SPOOF lane asserts every far-away check-in is rejected. | `scripts/simulate-adversarial.mjs:207-212, 272-273` |

---

## 1. SDD — Point 1A: hidden-location tasks reveal nothing until arrival

### 1.1 The decision: **arrival is an explicit, server-evaluated, latched event** (option b, built on option c's predicate)

Add a callable **`reportArrival`** in `functions/src/runs/index.ts` (next to `requestTaskHint`,
~line 2920):

```
reportArrival({ taskId, lat, lng, ownerUid|code, gameId, runId })
  → { arrived: boolean }        // never a distance, never a reason with digits
```

Behaviour:
1. `requireAuth` + `enforceRateLimit(uid, 'reportArrival')` + `assertCoordIfPresent(lat,lng)`.
2. `resolveCallerTeam(..., { requireController: true })` — same rule as `completeTask`/`updateLocation`.
3. Load the game task via `findGameTask`. If it is **not** `hideLocation` → `{ arrived: true }` (no-op,
   nothing to reveal). If it is not in the team's **active** stage → `failed-precondition`.
4. Reject a missing/invalid GPS with the same wording family as `evaluatePresence`
   ("Location required…") — a player must never be able to self-declare arrival with no coordinates.
5. `distM = haversineKm({lat,lng}, task.coordinates) * 1000` →
   `evaluateTrigger(normalizeTriggerMode(task), distM, task.geofenceRadiusMeters, { hidden: true })`.
   **This is exactly the predicate `completeTask` already uses** — so option (c) is honoured: there is
   one arrival rule in the codebase, not two.
6. On `ok`, **latch** `arrivedAt = new Date().toISOString()` onto the team's `RunTaskRecord` for that
   task inside a team-doc transaction (read-modify-write of the whole `stages` array — **never** a
   dotted-path update into an array; see the CLAUDE.md footgun). Idempotent: an existing `arrivedAt`
   is left untouched.
7. Return `{ arrived }`. No distance, no metres, no "you are 60 m away" — identical to the
   `evaluateTrigger(..., {hidden:true})` message contract.

New field: `RunTaskRecord.arrivedAt?: string` in `packages/shared/src/types/index.ts:690-707`
(shared type edit — flagged in §1.6).

### 1.2 Why not the alternatives

| Option | Verdict | Reasoning |
|---|---|---|
| **(a) client sends lat/lng to `getMyTeamState`, server evaluates per read** | Rejected as the primary mechanism | `getMyTeamState` takes no coordinates today (`index.ts:3275`), so this is a payload change either way. Fatal flaws: (i) it is **stateless** — the moment GPS goes stale, is denied, drifts indoors, or the app is reopened offline, the task text *un-reveals itself mid-play*; that is a worse bug than the one we are fixing; (ii) it turns the 12-second hot poll into a free, unthrottled distance oracle; (iii) it makes a hot read depend on a browser permission. It is however **cheap** (no write, no schema) — see §1.3 for the hybrid where it survives as a fallback we deliberately do NOT adopt. |
| **(b) explicit arrival event, latched on the team record** | **CHOSEN** | Sticky (survives offline, reload, GPS loss), auditable, server-authoritative, one small write per hidden task per team, and it keeps the hot read pure. |
| **(c) reuse `evaluateTrigger` as the authority** | **Adopted as the predicate, not as the trigger point** | `evaluateTrigger` today only runs inside `completeTask`, which is *terminal* — arrival and completion are the same instant. That is useless for a hidden task whose content must be **read after arriving and before answering** (a hidden quiz/photo/sequence). We reuse the function; we add an earlier, non-terminal call site. |
| **(d) piggyback on `updateLocation`** | Rejected | Tempting (teams already ping every ~20 s) but: it lives in `functions/src/index.ts`, outside this agent's ownership; it would add a game read + a team-doc transaction to **every** GPS ping of **every** team — precisely the hot-path-write class of defect that `fix-getmyteamstate-hotpath-writes` removed; and it makes a telemetry call silently mutate game state. Instead, the **client** calls `reportArrival` on the same `watchPosition` tick (§1.5), throttled, and only while an unarrived hidden task exists. |

### 1.3 Payload shape: before vs after arrival

`sanitizeTaskForParticipant` gains an option: `opts.revealed?: boolean`.

```
revealed = !task.hideLocation
        || record?.arrivedAt != null
        || record?.status === 'completed'
        || record?.status === 'skipped'
```
(a completed/skipped hidden task is always fully revealed — the player has been there, and the recap /
final screens must be able to name it.)

**Hidden + NOT arrived → "sealed stub". Emitted keys, exhaustively:**

| key | value |
|---|---|
| `id` | real id (the client needs it to call `reportArrival`/`completeTask`) |
| `locationHidden` | `true` |
| `arrivalPending` | `true` **← NEW sanitizer-added key** |
| `locationClue`, `locationClueHe` | the clue — the *only* content the player gets |
| `hasHint`, `hintPenalty`, `hintFreeNow` | paid-hint affordance still works pre-arrival (a hint that helps you *find* the spot is the whole point) |
| `pointValue`, `difficulty`, `estimatedMinutes` | non-revealing, drive the card chrome |

**Withheld until arrival:** `title`, `description`, `type`, `media`, `smart` (entirely — including
`longInstructions`, `codeInputLabel`, `imageUrl`), `choices`, `orderItems`, `surveyChoices`, `steps`,
`numericTolerance`, `requirePresence`, `tags`, `unlockAfterTaskIds`, `maxConcurrentTeams`,
`currentTeamCount`, `status`, `expiresAfterMinutes`, `releaseAt`, `releaseAfterMinutes`,
`maxDurationMinutes`, `expectedDurationMinutes`, `hintAutoRevealMinutes`, `hintAutoRevealAttempts`,
`locationless`, `hideLocation`, `triggerMode`, `coordinates`, `geofenceRadiusMeters`.

Implementation note: build the stub by **construction (allowlist)**, not by deleting from `...rest`.
A future `Task` field must default to *withheld*, exactly like the answer-key policy. `type` is
withheld rather than faked — the client keys off `arrivalPending`, never off a lying `type`.

**Hidden + arrived** → today's exact payload (coordinates + radius still stripped: knowing you are
there ≠ being handed the pin; the clue stays the navigation story and re-finding it on a reload
should not become trivial). `arrivalPending` absent.
**Not hidden** → byte-identical to today.

### 1.4 Anti-spoof story

- Arrival is **never** self-declared. `reportArrival` with no/invalid coordinates is refused.
- The check is the **same** server-side haversine-vs-server-held-coordinates rule that gates check-ins,
  with the same `{hidden:true}` no-distance message contract, so a spoofer gains nothing they could not
  already get from `completeTask` today. There is **no new oracle**: `completeTask` already returns a
  boolean-ish accept/reject for arbitrary submitted coordinates. `reportArrival` is strictly weaker
  (it only unseals text; it awards no points and starts no timer).
- Rate-limited under its own key so it cannot be used as a fast grid-search: the pre-existing
  `completeTask` limiter already bounds that attack class; `reportArrival` gets an equal-or-tighter budget.
- A GPS-faking player who *does* fake being at the right coordinates already wins `completeTask` today.
  Defeating fake-GPS is out of scope for this change and must not be implied as solved.
- The adversarial sim's SPOOF lane gets a new assertion (§2.3) so this stays true.

### 1.5 Client flow (`PlayScreen.tsx`, `TaskRunner.tsx`, `i18n.ts`)

1. `PlayScreen`'s existing `watchPosition` (`:155-171`) already has the coordinates and a ~20 s
   throttle. Add: **iff** the active stage contains a task with `locationHidden && arrivalPending`,
   also call `reportArrival({taskId, lat, lng})` on that tick (own throttle, ≥15 s). On
   `{arrived:true}` → `void refresh()` so the reveal is immediate.
2. `TaskRunner` renders a **sealed card** when `task.arrivalPending`: the compass badge + the clue +
   "keep following the clue" help + a manual **"I think I'm here"** button that calls `reportArrival`
   with a fresh `getCurrentPosition()` (covers a player whose background ping is stale). No title
   (`:415`), no description (`:416`), no media, no instruction block, **no input widget at all** —
   the whole `type` switch (`:437-465`) is skipped.
3. `LockedTasksList` (`PlayScreen.tsx:~795-820`) already `.filter(n => !!n)`s missing titles, so a
   sealed prerequisite degrades gracefully; add an explicit "🧭 hidden spot" placeholder label.
4. New i18n keys (EN + HE, both real languages — `npm run i18n:check` is a hard gate):
   `t.task.sealedTitle`, `t.task.sealedHelp`, `t.task.checkArrival`, `t.task.notThereYet`,
   `t.task.arrivalNeedsOnline`, `t.play.hiddenTaskPlaceholder`. Zero new PART B warnings
   (`npm run i18n:check:strict`).

### 1.6 Offline behaviour (must not brick the task)

- **Arrived earlier, now offline:** `arrivedAt` is latched server-side and the revealed payload is
  already in `PlayScreen` state; the existing "reconnecting" banner keeps the game on screen. To
  survive a **hard reload while offline**, cache the revealed payload in `localStorage` under
  `rp:revealed:<runId>:<taskId>` on first reveal and rehydrate when the poll fails. This caches only
  content the server already released to this device — it is not a new leak, and it is never written
  for a sealed task.
- **Arriving while offline:** `reportArrival` cannot run. The sealed card shows
  `t.task.arrivalNeedsOnline` ("you're at the spot? we'll unlock it the moment you're back online")
  and the pending call is retried on the existing `window.online` listener (`PlayScreen.tsx:~130`).
  This is honest, not a brick: `completeTask` also requires connectivity, so the player could not
  have scored offline anyway.
- **GPS denied entirely:** the manual button surfaces the same "location required" message as a
  check-in. Unchanged from today's hidden-task experience.

### 1.7 Seams outside the owned file list (small, unavoidable, flagged for approval)

1. `functions/src/index.ts` — one re-export line for `reportArrival`.
2. `packages/shared/src/types/index.ts` — `RunTaskRecord.arrivedAt?: string`, and doc-comment updates
   on `Task.hideLocation`.
3. `apps/play-web/src/services/calls.ts` — typed wrapper + `SafeTask.arrivalPending?: boolean` and
   loosening `title`/`type` to optional.
4. `scripts/e2e-verify.mjs` — allowlist + scenarios (see §2).
5. `scripts/simulate-adversarial.mjs` — SPOOF-lane assertion.
No `apps/creator-web` change is required: the Builder reads the owner's own game template, which is
untouched.

---

## 2. SDD — Point 1B: locked/unavailable tasks

`getMyTeamState` currently ships **every** task of the active stage. Per-category decision:

| Category | Detected by | Decision | Why |
|---|---|---|---|
| **Prerequisite-locked** (`unlockAfterTaskIds` unmet) | `isUnlocked` (shared `gating.ts`) | **Show as locked — title + prerequisite names only. Strip body/inputs.** | Deliberate product behaviour (the chain is the motivation), and the `unlockable tasks` e2e asserts `unlockAfterTaskIds` survives. We keep visibility but reduce it to a *stub*: title + gate ids, no description/choices/steps/media. |
| **Not yet released** (task-level `releaseAt`/`releaseAfterMinutes`) | `isReleased` | **Show as locked with the countdown** (title + `releaseAt`), body/inputs stripped. | The countdown is the feature; the `scheduled release` e2e asserts `releaseAt` survives the sanitizer. |
| **Stage not yet released** | stage stays `locked` ⇒ `activeStageIdx < 0` | **Already invisible** (`activeStageTasks` is `[]`). No change. | e2e asserts `activeStageTasks.length === 0` here. |
| **Expired** | `isExpired` | **Hide entirely**, unless the team's record for it is `completed` (history) — an expired task is dead, and a visible dead card invites a wasted walk. | The `task expiry` e2e reads `x-f` (*not* expired) for the passthrough check and reads the **team record** (not `activeStageTasks`) for the skip assertion, so hiding expired **content** is compatible. Must be re-verified. |
| **Exclusive-group loser** (`blockedTaskIds` / sibling `skipped`) | `mutualExclusion.ts` + record `status === 'skipped'` | **Hide entirely.** | It can never be played by this team again; showing it is pure confusion. The `mutually exclusive tasks` e2e allowlists payloads of the *pre-completion* list, which still contains both — check before completion is unaffected. |
| **Auto-skipped leftovers of a partial stage** | record `status === 'skipped'` after stage completion | Hide entirely (same as above). | — |
| **Outside the routed subset of a partial stage** (`requiredTaskCount < tasks.length`) | *no persistent marker exists* | **Cannot be hidden reliably — do not try.** Routing picks the next-best task at each completion; there is no durable "this team's subset". Instead apply the **stub rule** below. | Inventing a persisted subset would change routing semantics and break the `partial-completion stage` scenario. Flagged as a product decision in §4. |
| **Station cap full / paused / closed** | `taskCounts`, `status` | Show as unavailable stub (title + reason), no inputs. | Players legitimately need to know "this stop is busy, come back". |

### 2.1 The unifying rule — "full content only for what you may act on"

Implement one rule in `getMyTeamState` (`index.ts:3312-3336`) rather than seven special cases:

```
detail = 'full'   when the record status is 'assigned' (or 'completed'/'skipped' — history)
       = 'stub'   when the task is visible but not actionable (locked / unreleased / capped / unrouted)
       = omitted  when expired, exclusive-loser, or a skipped sibling of a finished partial stage
```
`stub` = `{ id, title, type, pointValue, difficulty, estimatedMinutes, locationless, coordinates
(map pin), unlockAfterTaskIds, releaseAt, releaseAfterMinutes, expiresAfterMinutes, lockedReason }`
— **no** `description`, `choices`, `orderItems`, `surveyChoices`, `steps`, `media`, `smart`,
`numericTolerance`. `lockedReason ∈ 'prerequisite' | 'scheduled' | 'busy' | 'paused' | 'unrouted'`.

This is a second, independent security win: today a 6-task partial stage hands the client **all six
quiz question sets** at once, so a player can pre-read every question before routing assigns it.

A hidden **and** unarrived task is sealed by §1.3 regardless of detail level (the two rules compose:
sealed wins).

### 2.2 Routing (`assignNextTask.ts`)

No behavioural change needed — the candidate filter (`:174-181`) is already the correct authority and
is what the stub/omit classification should be **derived from**. Refactor only: export a small
`classifyTaskAvailability(task, ctx)` helper so `getMyTeamState` and `buildRecommendations` share one
truth table instead of duplicating the predicates. Exclusive-group blocking must be added to that
helper if it is not already in the candidate filter (verify at implementation time).

---

## 3. TDD — the failing tests, written first

### 3.1 Pure / unit (no emulator) — extend `functions/src/runs/sanitizeTask.test.ts`

RED before any implementation:

1. `hidden + NOT arrived → no title` — `out.title === undefined`.
2. `hidden + NOT arrived → no description / type / media / smart / choices / orderItems /
   surveyChoices / steps / numericTolerance`.
3. `hidden + NOT arrived → emits arrivalPending:true, locationHidden:true, clue EN+HE, hasHint,
   hintPenalty`.
4. **Key-set exactness**: `Object.keys(out).sort()` equals the sealed allowlist exactly — so a new
   `Task` field defaults to withheld (mirrors the answer-key policy).
5. `hidden + arrived (arrivedAt set) → title/description/type present, coordinates + radius still
   stripped, arrivalPending absent`.
6. `hidden + record.status==='completed' → revealed even without arrivedAt`.
7. `NOT hidden → payload byte-identical to today` (snapshot the existing expectations).
8. Sealed task with `orderItems` + a shuffleSeed → `orderItems` still absent (sealed beats shuffle).
9. New `functions/src/runs/arrival.test.ts` (pure): the arrival predicate
   (distance + `evaluateTrigger(...,{hidden:true})`) — inside radius ⇒ arrived; outside ⇒ not arrived;
   missing/NaN coords ⇒ not arrived; the returned reason contains **no digits**.
10. `classifyTaskAvailability` truth table: prerequisite-locked ⇒ stub/`prerequisite`; unreleased ⇒
    stub/`scheduled`; expired ⇒ omit; exclusive-loser ⇒ omit; cap-full ⇒ stub/`busy`; assigned ⇒ full.
11. Extend `functions/src/__property__/invariants.property.test.ts`: for seeded random tasks,
    `hideLocation && !arrived ⇒ JSON.stringify(payload)` contains neither the title string nor the
    description string nor any answer key.

### 3.2 e2e — `scripts/e2e-verify.mjs`

**Allowlist first** (`:229-263`): add `arrivalPending` and `lockedReason` to `ALLOWED_TASK_KEYS`,
each with a comment saying why it is safe. Nothing is added to `ALLOWED_SMART_KEYS` (sealed tasks emit
no `smart` at all). Skipping this makes the allowlist guard fail loud — by design.

**Modify** `hidden-location task (treasure hunt)` (`:2856-2912`) — assert **on the wire**, the way the
manual-leaderboard `reveal:` scenario does:
- `hidden: title ABSENT from the payload before arrival` → `hiddenTask.title === undefined`.
- `hidden: description ABSENT before arrival`, `hidden: type ABSENT`, `hidden: smart ABSENT`.
- `hidden: whole-payload string does not contain the authored title/description` —
  `!JSON.stringify(sHL).includes('The secret spot')` (catches a leak through any *other* field:
  narratives, recommendations, records).
- `hidden: arrivalPending true`; clue + `locationHidden` assertions **kept**.
- `reportArrival` far away → `{arrived:false}`, message has no digits, and a follow-up
  `getMyTeamState` still has no title.
- `reportArrival` with **no coordinates** → refused (no self-declared arrival).
- `reportArrival` in range → `{arrived:true}`; follow-up `getMyTeamState` **now** has
  `title === 'The secret spot'`, the input affordance, and **still no `coordinates`**.
- `reportArrival` again → idempotent, `arrivedAt` unchanged (read the team doc as admin).
- `assertTaskPayloadAllowlisted` on both the sealed and the revealed payload.
- Visible sibling `hl-2` unchanged (regression anchor).

**New scenario** `hidden-location: cross-team + authz`:
- team B (never arrived) sees the sealed stub while team A has arrived — `arrivedAt` is per-team.
- a stranger / other-run participant calling `reportArrival` is denied → also add `reportArrival` to
  the **authorization denial matrix** (`:4742`).

**New scenario** `task visibility gating (stub vs omitted)`:
- a 3-task stage: assigned ⇒ full; prerequisite-locked ⇒ stub with `title` + `unlockAfterTaskIds` +
  `lockedReason:'prerequisite'` and **no `description`/`choices`**; expired ⇒ **absent from
  `activeStageTasks` entirely**.
- a partial stage's non-assigned quiz ⇒ **`choices` absent** (the pre-read leak is closed).

**Coverage guard** (`:5268`): `reportArrival` is a new callable ⇒ ships RED until the scenario above
invokes it. That is the intended gate, not an obstacle to route around.

### 3.3 Adversarial + browser sims

- `scripts/simulate-adversarial.mjs` SPOOF lane: after a far-away `reportArrival`, assert the team's
  next state still has no title for that task (`spoofRevealRejected` counter alongside
  `spoofRejected`).
- `scripts/simulate-browser.mjs` / `npm run test:ui`: synthetic geolocation is already supported —
  add a hidden-task leg that asserts the DOM has **no** task title until the synthetic position moves
  inside the radius. (Beware the documented Playwright locator/synthetic-GPS gotchas.)

### 3.4 Gate order for the implementation pass

`npm test` (RED → GREEN) → `npm run typecheck` → `npm run lint` → `npm run i18n:check` (+`:strict`) →
`creator:build` / `play:build` → `npm run e2e` → `npm run verify:emulator` (**serialized**, never
concurrently with `verify` — shared `packages/shared/dist`).

---

## 4. Regression risk list

| Scenario in `scripts/e2e-verify.mjs` | Risk | Proof it still passes |
|---|---|---|
| `unlockable tasks` (`:2273`) | **Deliberate change**: locked task keeps `title` + `unlockAfterTaskIds` (assertion survives) but loses `description`/`choices`. If the scenario later asserts a body field it must be updated **with the product decision written in the diff comment** — never silently deleted. | Keep the two existing `check()`s verbatim; add the "no description" assertion next to them. |
| `scheduled release` (`:2150`) | `releaseAt` must survive on a stubbed task; `activeStageTasks.length === 0` for a locked stage must stay 0; the viewer/controller persistence checks look up `p-b` **by id** — stubs keep `id`. | Run the scenario unchanged first, then add stub assertions. |
| `task expiry` (`:2458`) | Hiding expired tasks could break `fTask` lookup — but `x-f` is *not* expired. The skip assertion reads `team.stages[].tasks`, not `activeStageTasks`. | Verify `expiresAfterMinutes` passthrough on the non-expired task; add an explicit "expired task absent from activeStageTasks" check. |
| `partial-completion stage` (`:1105`) + `locationless uncapped` (`:1145`) | Stub rule must not change *routing* or the auto-skip maths. | Routing untouched; assert the same `done=1 skipped=1`. |
| `mutually exclusive tasks` (`:2355`) | `assertTaskPayloadAllowlisted` loops all payloads (`:2388`) — stubs must stay allowlisted; the loser must disappear only **after** completion. | Add a post-completion "loser absent" check. |
| `core lifecycle` (`:352`, `:530-535`) | `activeStageTasks[0]` is indexed positionally; omitting tasks reorders. | Re-check `:530`; switch to a by-id lookup if it becomes order-dependent. |
| `quiz ordering` (`:1525`), `survey tasks` (`:1646`), `task types` (`:2001`), `quiz location verification` (`:2101`), `task media` (`:2914`), `audio` (`:856`), `paid hints` (`:1191`), `hint auto escalation` (`:1384`) | All read content of a task that must now be **assigned** to be full-detail. Several of these single-task stages are auto-assigned at `startTeams`, so they are fine — but each must be confirmed. | Run the full `npm run e2e` before/after and diff the per-scenario summary; where a scenario reads an unassigned task, call `requestNextTask` first (a legitimate test fix, documented). |
| `leaderboard invariants`, `station contention`, `authz matrix`, `boundary fuzz`, `callable coverage` | Not content-shaped, but coverage guard needs the new callable's scenario. | Guard must report the new count (67/67). |
| `npm run simulate` / `simulate:browser` / `simulate-adversarial` | Sims read `activeStageTasks` to decide what to submit. | Sims must key off the **assigned record**, not the task list; fix any positional lookups. |

---

## 5. Things I think are BAD ideas / decisions the user must make

**Bad ideas (recommend against):**
1. **Hiding the title only in the client.** Non-negotiable — devtools reads the payload. Same class as
   the leaderboard bug just fixed.
2. **Reusing `updateLocation` as the arrival writer.** Puts a game-state transaction on every GPS ping
   of every team; re-introduces the hot-path-write defect class.
3. **A `getMyTeamState({lat,lng})` per-read evaluation as the *only* mechanism.** The reveal would
   flicker off whenever GPS is stale/denied/offline — a worse player experience than the leak.
4. **Returning any distance or "getting warmer" signal from `reportArrival`.** Triangulation.
5. **Faking `type` on a sealed task** so `TaskRunner`'s switch keeps working. Lying payloads rot.
6. **Silently deleting the `unlockable tasks` assertion** to make locked tasks disappear. If that
   product decision is made, it must be an explicit, commented test change.
7. **Persisting a "routed subset" for partial stages** just to hide unrouted tasks. It would change
   routing semantics and strand teams when a station fills up.
8. **Trying to defeat GPS spoofing in this change.** Out of scope; do not let the plan imply it.

**Product decisions the user must make (blocking the implementation pass):**
- **P1.** Prerequisite-locked tasks: keep them visible as a title-only stub (recommended, preserves the
  existing feature and its e2e), or hide them entirely (requires deliberately rewriting the
  `unlockable tasks` scenario)?
- **P2.** Should a hidden task's **coordinates** be released *after* arrival (so the map can pin it and
  a returning player can navigate back), or stay hidden forever? Recommendation: stay hidden.
- **P3.** Should the **paid hint** be purchasable *before* arrival on a sealed task? Recommendation:
  yes (finding the spot is exactly what a hint is for).
- **P4.** Adopt the §2.1 stub rule for **all** non-assigned tasks — which also closes the "all quiz
  questions ship at once" pre-read leak — or scope this change strictly to hidden-location tasks and
  file the stub rule separately? Recommendation: adopt it, it is the same review and the same tests.
- **P5.** Manual "I think I'm here" button: allowed unlimited (rate-limited only), or capped per task?
  Recommendation: unlimited, rate-limited — it grants no points.
- **P6.** Approve the five out-of-ownership seams in §1.7 (shared type, root re-export, play-web
  `calls.ts`, e2e script, adversarial sim).
