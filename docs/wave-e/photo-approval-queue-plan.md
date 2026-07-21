# Task 13 — Live photo approval queue in the Creator/Manager console

Phase 1 deliverable: findings + SDD + TDD plan. **No source file was modified.**
Branch `topographic-maps`, evidence read at commit `d705898`.

---

## 1. Findings — what is actually missing

**Verdict: a mix of (a) and (c), and NOT a broken pipeline.**

- **(c) is true for the whole server + staff path.** The submit → review → score → feed
  pipeline exists, is complete, is authz'd, and is e2e-covered. It was simply starved of
  input until an hour ago because `requireStorageUrl` rejected every emulator/tunnel
  download URL (`functions/src/index.ts:890-892` now passes
  `allowLocalEmulator: process.env.FUNCTIONS_EMULATOR === 'true'`; see
  `docs/wave-c/photo-upload-fix.md`). In production the guard never fired, so the
  production pipeline was always live — the "photos never appear" report is a
  dev/playtest-environment symptom for everything except point (a) below.
- **(a) is true for the Creator/Manager console specifically.** There is **no pending-photo
  review UI in `apps/creator-web`**. Grep for `reviewStationSubmission` across
  `apps/creator-web/src` returns exactly one hit — the typed wrapper
  `apps/creator-web/src/services/calls.ts:152` — and **zero call sites**. The creator
  console has a `FeedConsole` (`RunConsolePage.tsx:824-880`) but that subscribes to
  `…/runs/{runId}/feedItems`, which by construction contains only **already-approved**
  photos (`writeFeedItem` is called after `completed === true`, `index.ts:984-992` and
  `1069-1077`). So the creator sees approved photos and never sees anything pending.
- The **manager's only approval surface today is the play-web Staff console**
  (`apps/play-web/src/screens/StaffConsole.tsx:143-182, 216-222, 300-340`), reachable via
  a staff PIN. A creator/owner who never invited themselves as staff has no approval UI at
  all — pending photos sit in `taskSubmissions` forever and the team is blocked on that task.

### Evidence map (server)

| Concern | Where | Behaviour |
|---|---|---|
| Submission landing spot | `functions/src/index.ts:951-967` | `teams/{teamId}.taskSubmissions[taskId] = { photoUrl, submittedAt, status: 'pending'\|'approved', mediaKind }` — one map field on the **team doc**, no separate collection |
| autoApprove | `index.ts:971-993` | status `approved` immediately + `completeTaskForTeam` + feed item; never enters a review queue |
| Pre-write guards | `index.ts:933-949` | stage-active assert; already-completed or already-approved ⇒ idempotent no-op **without** writing (moderation-bypass fix) |
| Review | `index.ts:999-1085` | `assertStaffOrOwner`; team-existence guard (no phantom team); `.set({merge})` of `status/reviewedAt/reviewedBy/reviewNote`; on approve → `completeTaskForTeam` |
| Score + slot release | `functions/src/runs/index.ts:663-760, 966` | `completeTaskForTeam` scores **and** releases the station slot **atomically inside its transaction**, gated on `heldSlot` (`team.activeTaskId === taskId \|\| taskRec.status === 'assigned'`). Returns `{ completed }` — `false` on replay. The historic autoApprove/review slot leak is fixed; there is no post-commit `releaseTask` in either photo path by design |
| Feed | `index.ts:667-691` | best-effort `writeFeedItem`, gated on `completed && photoFeedEnabled && mediaKind !== 'audio'` |
| Owner read access | `firestore.rules:55-60` | `match /teams/{teamId} { allow read: if isOwner(uid) \|\| … }` — **the owner can already list all team docs.** No rules change needed |

**Double-approval idempotence is already correct server-side**: a second
`reviewStationSubmission(approved:true)` re-writes the review subfields but
`completeTaskForTeam` returns `completed:false`, so no second score, no second slot
release, no duplicate feed item (`index.ts:1067-1069`). The remaining double-click risk is
purely client-side (two in-flight calls, two toasts, wasted callables) — that is what
`useAsyncAction` is for.

---

## 2. SDD — design

### 2.1 Scope

Add a **Photo review** panel to `apps/creator-web/src/pages/RunConsolePage.tsx` that is a
deliberate near-clone of the staff panel: live pending queue, inline media, approve/reject,
optional reject note. Do **not** rebuild the server. Do **not** add a callable.
`reviewStationSubmission` already accepts the owner (`assertStaffOrOwner`) and the wrapper
already exists at `calls.ts:152`.

### 2.2 Subscription / query strategy (with cost argument)

**Chosen: one `onSnapshot` on the `teams` collection of this run, flattened client-side.**
Identical to `StaffConsole.tsx:145-182`.

```
onSnapshot(collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/teams`))
  → for each team doc, for each entry of taskSubmissions where status === 'pending'
  → flatten to { teamId, displayName, taskId, photoUrl, submittedAt, mediaKind }
```

Why this and not the alternatives:

| Option | Cost | Verdict |
|---|---|---|
| **Collection listener on `teams` (chosen)** | 1 listener; initial read = N team docs (N ≤ 16 by the run device cap, realistically ≤ 30 teams); afterwards **only changed docs** are billed/delivered. Team docs already change constantly (score, stages, activeTaskId) and the console already polls `listRunTeams` every 5s (`RunConsolePage.tsx:98-102`) — this listener is *cheaper* than that poll, not additive | ✅ |
| Listener per team | N listeners, same data, more sockets/state | ❌ |
| `where('taskSubmissions.…')` filtered query | Impossible: `taskSubmissions` is a **map keyed by taskId**; there is no single field to index. Would need a `hasPendingSubmission` boolean written server-side (a new write path in a hot callable) | ❌ — only worth it above ~200 teams, which the device cap forbids |
| Collection-group query over a new `submissions` subcollection | Requires a server-side schema migration + a composite index + a new write in `submitStationPhoto` (hot path). Real benefit only at large N | ❌ for now; noted in §5 as the scale escape hatch |
| Reuse `feedItems` | Contains **approved only**; structurally cannot show a pending queue | ❌ |

**Index needed: none.** The listener is an unfiltered collection read. `firestore.indexes.json`
stays untouched.

**Rules: none.** `firestore.rules:55-60` already grants `isOwner(uid)` read on all team docs;
the console already reads `alerts`, `feedItems`, `chat` the same way.

### 2.3 Panel design

`PhotoReviewConsole` — a new local component in `RunConsolePage.tsx`, mounted next to the
existing consoles at `RunConsolePage.tsx:317-324` (place it **above** `FeedConsole`: pending
work outranks the approved-photo gallery).

- Header: `📷 <label> (<count>)` with the count in accent when > 0 — mirrors
  `StaffConsole.tsx:300-304`.
- Empty state: reuse the creator `EmptyState` primitive if available, else a muted line.
- Row per submission, **sorted oldest-first by `submittedAt`** (FIFO — the team waiting
  longest is unblocked first; the staff console does not sort and should be brought in line
  later, see §5).
- Media: `mediaKind === 'audio'` → `<audio controls preload="none">`; otherwise `<img loading="lazy">`;
  a non-`https?://` value falls back to a plain text/link (same guard as
  `StaffConsole.tsx:309-313`).
- Actions: **Approve** / **Reject**, both wrapped in
  `useAsyncAction(review, (s) => `${s.teamId}:${s.taskId}`)` from
  `apps/creator-web/src/hooks/useAsyncAction.ts` — per-row keying so one row in flight does
  not freeze the others; per-row spinner via `isBusy(key)`.
- Reject asks for an optional note via the existing `dialog.prompt` and passes it as `note`
  (already supported, `index.ts:1032`). Approve does not prompt (speed matters in the field).
- Errors → `toast.error`; success → `toast.success` (both already imported at
  `RunConsolePage.tsx:18-19`).
- Audible/visual cue on a **new** pending arrival, ref-baselined exactly like the alerts
  listener (`RunConsolePage.tsx:55-78`) so a fresh mount does not replay the backlog. Reuse
  `playAlert()`? No — use a softer cue or none; an SOS-grade sound for a photo is wrong.
  **Recommendation: no sound, only the count badge + title-flash reuse is out of scope.**
- Hidden when the run is `finished` (like the other live consoles), but the count still
  renders while `!finished`.

### 2.4 Pure logic to extract (so it is testable without React or the emulator)

New file `packages/shared/src/photoQueue.ts`, exported from `packages/shared/src/index.ts`:

```ts
export interface PendingSubmissionRow {
  teamId: string; displayName: string; taskId: string;
  photoUrl: string; submittedAt: string; mediaKind?: 'photo' | 'audio';
  status: 'pending' | 'approved' | 'rejected';
}
export function buildPendingQueue(
  teams: { id: string; displayName?: string; taskSubmissions?: Record<string, {...}> }[],
): PendingSubmissionRow[];        // pending only, FIFO by submittedAt, stable tiebreak on `${teamId}:${taskId}`
export function submissionKey(r): string;               // `${teamId}:${taskId}`
export function nextStatus(current, action): status;     // transition table + idempotence
```

`nextStatus` encodes the server contract so the UI never offers an illegal action:
`pending --approve--> approved`, `pending --reject--> rejected`,
`approved --approve--> approved` (no-op), `approved --reject--> rejected` (allowed: staff
correction; server re-writes status but does **not** un-score — see §4/§5),
`rejected --approve--> approved` (allowed, and DOES score, because
`completeTaskForTeam` had never run).

### 2.5 Approve/reject → score path (unchanged, documented)

```
Creator clicks Approve
  → reviewStationSubmission({ownerUid,gameId,runId,teamId,taskId,approved:true})   calls.ts:152
  → assertStaffOrOwner                                                             index.ts:1000
  → team-exists guard                                                              index.ts:1019-1022
  → taskSubmissions[taskId].status = 'approved' (+reviewedAt/By/Note)              index.ts:1025-1037
  → completeTaskForTeam(...)  → scores the task, releases the station slot
                                atomically, returns {completed}                    runs/index.ts:663-760
  → if completed && feedEnabled && !audio → writeFeedItem                          index.ts:1069-1077
  → team doc changes → the SAME onSnapshot fires → the row disappears from the queue
```

No new server code. The queue is self-healing: the row vanishes because `status` left
`pending`, not because of local optimistic state. **Do not add optimistic removal** — it
would hide a failed call.

### 2.6 Files + line ranges to touch (phase 2)

| File | Change |
|---|---|
| `packages/shared/src/photoQueue.ts` | NEW — pure queue logic |
| `packages/shared/src/index.ts` | export the new module |
| `apps/creator-web/src/pages/RunConsolePage.tsx` | ~`:317-324` mount `<PhotoReviewConsole/>`; new component near `FeedConsole` (`:824-880`); import `reviewStationSubmission` into the `:9-16` block and `useAsyncAction` |
| `apps/creator-web/src/i18n.ts` **(locked in phase 1)** | new keys: `runConsole.photoReview`, `noSubmissions`, `approve`, `reject`, `rejectNotePrompt`, `reviewFailed`, `reviewApproved`, `reviewRejected` — EN + HE. Mandatory `npm run i18n:check` after |
| `scripts/test-photo-approval-queue.ts` | NEW — auto-discovered by `scripts/run-unit-tests.mjs:22-24` |
| `scripts/e2e-verify.mjs` **(locked in phase 1)** | extend the existing feed scenario (see §3) |
| `firestore.rules`, `firestore.indexes.json` | **no change** |

---

## 3. TDD — failing tests first

### 3.1 Pure lane — `scripts/test-photo-approval-queue.ts` (RED first)

Written against `@rushpoint/shared`'s `photoQueue` before that file exists, so `npm test`
fails on the import. Assertions:

1. `buildPendingQueue` returns **only** `status === 'pending'` rows (approved/rejected/absent excluded).
2. Flattens **across teams and across tasks** (2 teams × 2 pending tasks ⇒ 4 rows).
3. **FIFO order** by `submittedAt` ascending; equal timestamps fall back to a stable
   `teamId:taskId` sort (deterministic re-render, no row jitter).
4. **Dedupe**: the same `teamId:taskId` can appear at most once (map keys guarantee it —
   assert `new Set(keys).size === rows.length` over a generated fixture).
5. Missing/legacy fields tolerated: `taskSubmissions` undefined, `displayName` undefined
   (falls back to the doc id), `submittedAt` missing (sorts last, never `undefined`-throws),
   `mediaKind` undefined ⇒ treated as `'photo'`.
6. `nextStatus` transition table, including `approved --approve--> approved` **and**
   `nextStatus(nextStatus(p,'approve'),'approve') === nextStatus(p,'approve')` (idempotence
   as an algebraic property).
7. `submissionKey` matches the key the staff console already uses
   (`${teamId}:${taskId}`) so the `useAsyncAction` key can never drift.

Plus one guard test reusing the existing `scripts/test-async-action-guard.ts` contract:
a double `run()` under the same key fires the underlying fn **once** (already proven there;
just assert the creator hook is imported with a `keyOf`, via a small structural check — or
skip if it forces a React import; prefer skipping over faking).

### 3.2 e2e lane — extend, don't add scenarios

Extend `scripts/e2e-verify.mjs`:

**A. `live photo feed (approve → broadcast → react → hide → prune)` (`:1859`)** — it already
submits `fp-rev` pending and approves it as **creator** (`:1905`), which is exactly the new
path. Add:
- `pending state is visible on the team doc before review` — read
  `…/teams/{fUid}` and assert `taskSubmissions['fp-rev'].status === 'pending'` and
  `photoUrl` present, i.e. the queue has a source. *(This is the assertion that would have
  caught the starvation bug from the console side.)*
- **`double approval is idempotent`** — call `reviewStationSubmission(approved:true)` on
  `fp-rev` a **second** time; assert (i) the call resolves `ok:true`, (ii) the team's `score`
  is unchanged versus after the first approval, (iii) `feedItems` count is still 2 (no
  duplicate broadcast).
- **Concurrent double reviewer** — `Promise.all` of two `reviewStationSubmission(approved:true)`
  from two identities (creator + staff) on a fresh pending task; same three invariants.
- **`station slot released on approval`** — the photo tasks already carry
  `maxConcurrentTeams: 3`. After the approval, assert the run's station counter for that
  taskId is back to 0 (the `simulate`/`e2e` suites already read this counter — reuse the
  same helper used by `verifyStationCode releases its station slot (WO-1)` at `:4431`) and
  that the team's `activeTaskId` is no longer the approved task.
- **reject path** — a third task submitted then `approved:false`: assert status
  `'rejected'`, **score unchanged**, **no feed item**, and that the participant can
  re-submit (status returns to `pending`) since the WO Fix 4 guard only blocks
  `approved`/completed.

**B. `station contention + duplicate submissions` (`:4013`)** — no change needed; it already
covers the cap. Do not duplicate.

**C. Owner-read rules** — `scripts/test-rules.mjs` already exercises team reads; add an
assertion that the **owner** can `list` the `teams` collection of its own run (the exact
read the panel performs) so a future rules tightening breaks loudly instead of silently
rendering an empty queue.

### 3.3 Gates

`npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
`npm run play:build` · `npm run i18n:check` (**mandatory — this is a UI change**) ·
`npm run e2e`.

---

## 4. Regression risk list

1. **i18n leak (highest).** New creator UI strings are the exact recurring bug class. Every
   label must go through `t.runConsole.*`; `npm run i18n:check` must be clean and
   `i18n:check:strict` must add **zero** new PART B warnings.
2. **Listener + poll duplication.** The console already polls `listRunTeams` every 5s
   (`:98-102`). Adding a `teams` snapshot means two sources of team data. Keep them
   separate — do **not** refactor `teams` state onto the snapshot in this change (that is a
   bigger, riskier cleanup; noted in §5).
3. **Double-mutation on double-click.** Mitigated by `useAsyncAction` with a per-row key.
   Without a `keyOf` the whole queue would freeze on one approval.
4. **Reject-after-approve does not un-score.** `reviewStationSubmission(approved:false)` on
   an already-approved task flips the status string but `completeTaskForTeam` already ran;
   the points stay. This is pre-existing server behaviour, not introduced here — but a
   creator panel makes it *reachable* in a way it mostly wasn't before. See §5.
5. **PII in the panel.** Photos + team names render in the creator console; that is exactly
   the owner's own run data and rules already allow it. No new exposure.
6. **Bundle size.** The panel is small and inline; do not lazy-load it (unlike `FeedPanel` in
   play-web) — no heavy deps.
7. **StrictMode double-effect.** `useAsyncAction` already handles mount/dispose re-arm
   (`useAsyncAction.ts:105-108`); the snapshot effect must return the unsubscribe directly
   like every sibling listener does.
8. **Audio submissions.** `mediaKind: 'audio'` rows land in the same queue (they are
   `pending` too). Rendering them as `<img>` would show a broken image. Handle both kinds or
   the audio-tasks feature regresses visibly.
9. **Stale `taskSubmissions` for auto-approved tasks** — they are written with status
   `approved` and must never appear in the queue. Covered by test 3.1.1.

---

## 5. Bad ideas / decisions needed from the user

**Things I recommend against:**

- **Do not** add a `submissions` subcollection or a `hasPending` flag to `submitStationPhoto`
  now. It is a hot path, run docs are server-write-only so it means new server code, and the
  run device cap (16 phones) bounds N hard. The collection listener is correct until someone
  runs a 200-team event — at which point the flag + collection-group query is the escape
  hatch, with the composite index it then needs.
- **Do not** add optimistic row removal. The snapshot is the truth; optimism hides failures.
- **Do not** reuse `playAlert()` (the SOS cue) for photo arrivals. Desensitising the safety
  sound is a real operational hazard.
- **Do not** refactor `StaffConsole` and the creator panel into one shared component in this
  change. They live in different apps with different design systems and different i18n
  dictionaries; share the **pure** `photoQueue` logic only. (Sharing the pure part does fix
  the real drift risk — ordering and keying.)

**Needs a user decision:**

1. **Should rejecting an already-approved submission claw back the points?** Today it does
   not. Options: (a) leave as-is and hide/disable Reject on approved rows in the panel;
   (b) add a server-side reversal (new logic in `completeTaskForTeam`'s vicinity — risky,
   touches scoring). My recommendation: **(a)** for this change; open a separate change for
   the reversal if the user wants it.
2. **Should the creator panel show *all* submissions (with a pending/approved/rejected
   filter) or pending only?** Pending-only is the fastest field UX; an "all" tab is nicer for
   post-run auditing but doubles the render cost. Recommendation: **pending only**, with the
   existing `FeedConsole` continuing to serve the approved view.
3. **Should the owner also be pushed a notification (title flash / badge) for pending
   photos**, as with SOS alerts? It competes with the SOS cue for attention.
   Recommendation: count badge only.
4. **Should the staff console adopt the shared FIFO ordering** (it currently renders in
   `Object.entries` order)? It is a one-line change in a file *not* locked in phase 1
   (`StaffConsole.tsx`) but it touches play-web strings' neighbourhood. Recommendation:
   yes, ordering only, no string changes.

---

# PHASE 2 — implementation log

## 2a — DONE, green

| File | State |
|---|---|
| `packages/shared/src/photoQueue.ts` | **NEW.** Pure module: `flattenSubmissions` · `buildPendingQueue` (FIFO) · `buildReviewedQueue` (newest first, capped at `DEFAULT_REVIEWED_LIMIT = 8`) · `buildSubmissionQueues` (one pass, both lists + `pendingCount`) · `submissionKey` · `normalizeStatus` · `nextStatus` · `canApprove` / `canReject` · `isPending` · `isRenderableMedia` |
| `packages/shared/src/index.ts` | one export line added next to `./mediaKinds` |
| `scripts/test-photo-approval-queue.ts` | **NEW.** 53 assertions, **53 passed / 0 failed**. Imports `../packages/shared/src/photoQueue` (SOURCE, never dist) |
| `apps/creator-web/src/services/calls.ts` | **no change needed** — the existing `reviewStationSubmission` wrapper at `:152` already carries `{ownerUid,gameId,runId,teamId,taskId,approved,note?}` |

`npx tsc --noEmit` in `packages/shared` is clean. `npm run shared:build` was **not** run.

Decisions baked into the module:
- **User decision 1** → `canReject('approved') === false` and `nextStatus('approved','reject') === 'approved'`.
  The panel must render the Reject button **disabled with a reason**, never a silent no op.
  No clawback anywhere; `adjustTeamScore` remains the manual recourse.
- **User decision 2** → `buildReviewedQueue` / `buildSubmissionQueues().reviewed` back the
  "recently reviewed" strip. Capped at 8, newest first, `reviewedAt` falling back to
  `submittedAt` (autoApprove writes no `reviewedAt`). Not an audit view.
- `normalizeStatus(undefined) === 'pending'` — an unreadable status is still work waiting
  for a human; hiding it would block a team forever.
- `mediaKind` absent ⇒ `'photo'`; `'audio'` preserved so the panel plays it instead of
  rendering a broken `<img>`.

## 2b — BLOCKED, ready to apply

### `apps/creator-web/src/pages/RunConsolePage.tsx` — deliberately NOT started yet

It is unlocked, but every visible string in the panel must come from `t.runConsole.*`, and
`apps/creator-web/src/i18n.ts` is locked. Writing the component against keys that do not
exist fails `typecheck`; writing it with literals fails `i18n:check` PART B and would have
to be rewritten immediately. So the panel lands **in one pass together with the keys**, the
moment i18n is free. The component is fully specified in §2.3 above; mount point
`RunConsolePage.tsx:317-324`, **above** `<FeedConsole/>`.

### `apps/creator-web/src/i18n.ts` — exact keys to add under `runConsole` (both dictionaries)

Wording deliberately mirrors the play-web StaffConsole strings (`apps/play-web/src/i18n.ts:274-282`
HE / `:732-740` EN) so the two consoles read the same. **No hyphen or dash of any kind**
(`scripts/test-no-dashes.ts`).

| key | HE | EN |
|---|---|---|
| `photoReview` | `בדיקת תמונות` | `Photo review` |
| `photoReviewHelp` | `הגשות של קבוצות שממתינות לאישור. אישור מזכה את הקבוצה בנקודות ומשחרר אותה להמשך.` | `Team submissions waiting for approval. Approving awards the points and releases the team to continue.` |
| `noSubmissions` | `אין הגשות ממתינות.` | `No submissions waiting.` |
| `taskLabel` | `משימה` | `task` |
| `noPhoto` | `אין תמונה` | `no photo` |
| `submissionAlt` | `הגשה` | `submission` |
| `audioSubmission` | `הגשת שמע` | `audio submission` |
| `approve` | `אישור` | `Approve` |
| `reject` | `דחייה` | `Reject` |
| `rejectNotePrompt` | `סיבת הדחייה (לא חובה)` | `Reason for the rejection (optional)` |
| `reviewApproved` | `ההגשה אושרה והנקודות נרשמו` | `Submission approved and the points were awarded` |
| `reviewRejected` | `ההגשה נדחתה` | `Submission rejected` |
| `reviewFailed` | `הבדיקה נכשלה` | `Review failed` |
| `reviewedRecently` | `נבדקו לאחרונה` | `Recently reviewed` |
| `reviewedApprovedTag` | `אושר` | `Approved` |
| `reviewedRejectedTag` | `נדחה` | `Rejected` |
| `rejectDisabledApproved` | `כבר אושר. לביטול השתמשו בעדכון ניקוד ידני.` | `Already approved. To undo, use a manual score adjustment.` |
| `pendingSince` | `` ({ time }) => `הוגש בשעה ${time}` `` | `` ({ time }) => `submitted at ${time}` `` |

*(Every entry above is dash free; `rejectDisabledApproved` is the self explaining disabled
state the user asked for.)*

### `scripts/e2e-verify.mjs` — extensions to apply on unlock

All inside the **existing** `live photo feed (approve → broadcast → react → hide → prune)`
scenario at `:1859` (it already creates an autoApprove task `fp-auto`, a staff reviewed task
`fp-rev` with `maxConcurrentTeams: 3`, and approves as the **creator** at `:1905` — the exact
owner path the new panel uses). No new scenario.

1. **Pending state is visible to the queue** — before the approve at `:1905`, read
   `users/{OWNER}/games/{fg}/runs/{fr}/teams/{fUid}` and assert
   `taskSubmissions['fp-rev'].status === 'pending'` and `photoUrl` is the submitted URL.
   *This is the assertion that would have caught the starvation bug from the console side.*
2. **Double approval is idempotent** — capture the team `score` and `feedItems.length` right
   after the first approve, call `reviewStationSubmission({...,approved:true})` on `fp-rev`
   a second time, assert `ok === true`, **score unchanged**, **feedItems still 2**.
3. **Concurrent two reviewer approval** — on a fresh pending task, `Promise.all` of a
   creator approve and a staff approve; assert the same three invariants (one score, one
   feed item, no throw). Uses the staff identity already minted in the lifecycle scenario.
4. **Station slot released on approval** — after the approve, assert the run's station
   counter for `fp-rev` is back to `0` (reuse the counter helper used by
   `verifyStationCode releases its station slot (WO-1)` at `:4431`) and the team's
   `activeTaskId !== 'fp-rev'`.
5. **Reject path** — add a third photo task, submit it, `reviewStationSubmission({approved:false})`:
   assert `status === 'rejected'`, **score unchanged**, **no new feed item**, and that the
   participant can resubmit (status returns to `pending`) — the WO Fix 4 guard only blocks
   `approved`/completed, so a rejected task must stay retryable.

### `scripts/test-rules.mjs` (unlocked, will apply with 2b)

Add: the **owner** can `list` `users/{owner}/games/{g}/runs/{r}/teams` — the exact read the
panel performs — so a future rules tightening fails loudly instead of silently rendering an
empty queue.

## Files still needed unlocked

1. `apps/creator-web/src/i18n.ts` (**hard blocker** for the panel)
2. `scripts/e2e-verify.mjs`

---

# FINAL STATE — all phases complete

## Files changed

| File | Change |
|---|---|
| `packages/shared/src/photoQueue.ts` | **NEW** — pure queue module (see 2a above) |
| `packages/shared/src/index.ts` | one export line |
| `scripts/test-photo-approval-queue.ts` | **NEW** — 53 assertions, pure lane |
| `apps/creator-web/src/pages/RunConsolePage.tsx` | **NEW** `PhotoReviewConsole` (above `FeedConsole`); imports `reviewStationSubmission`, `useAsyncAction`, the shared queue helpers, `useMemo` |
| `apps/creator-web/src/i18n.ts` | 20 keys appended under `runConsole` in BOTH dictionaries, behind a `wave-e task 13` comment anchor. Nothing else touched |
| `scripts/e2e-verify.mjs` | 21 new assertions inside the existing `live photo feed` scenario |
| `e2e-ui/photo-review.creator.spec.ts` | **NEW** — Playwright browser proof that the panel is actually fed |
| `firestore.rules`, `firestore.indexes.json`, `functions/**` | **untouched** — no server change was needed |

## The panel

One `onSnapshot` on `FIRESTORE_PATHS.teamsCol(...)`, flattened through
`buildSubmissionQueues`. Pending grid (FIFO, oldest first) + a capped
"recently reviewed" strip. Per row: the media (`<img>`, or `<audio>` when
`mediaKind === 'audio'`, or a "no photo" fallback when the URL is not http(s)),
team name, task, submitted-at clock, Approve and Reject. Reject prompts for an
optional note. Both actions go through one `useAsyncAction` keyed by
`submissionKey(row)` — a double-tapped Approve fires ONE callable, and a different
row can still act while one is in flight. On an approved row Reject is rendered
**disabled** with the explaining label, never a silent no-op. No optimistic
removal: rows leave because the snapshot says the status left `pending`.

## Verification performed

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p apps/creator-web/tsconfig.json` | clean |
| `npx tsc --noEmit` (packages/shared) | clean |
| `npx eslint` on every touched file | **0 errors** (only pre-existing non-null-assertion warnings) |
| `npm run creator:build` | built |
| `npx tsx scripts/check-i18n.ts` | PART A **and** PART B clean |
| `npx tsx scripts/test-no-dashes.ts` | ALL PASSED |
| `node scripts/run-unit-tests.mjs` | **95/95 files**, including the new 53 assertions |
| `node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"` | **ALL PASS** (log read, not just the exit code) — all 21 new assertions PASS |
| `npx playwright test --project=creator e2e-ui/photo-review.creator.spec.ts` | 2/2, green on three consecutive runs |

Notable e2e evidence: `queue: approval awarded points :: 80` ·
`queue: double approval does NOT score twice :: 80 vs 80` ·
`queue race: at least one concurrent approval succeeds :: ["ok","ok"]` ·
`queue race: two simultaneous approvals score the task exactly once :: 0 → 40` ·
`queue race: two simultaneous approvals broadcast exactly ONE feed item` ·
`queue: approving a photo releases its station slot (taskCounts back to 0)`.

The Playwright fixture uploads a real 1x1 PNG to the Storage emulator and submits
it through `submitStationPhoto`, so it also re-proves the wave-c upload fix end to
end from a client.

## Not verified / caveats

- **No hand-driven browser session.** I did not sign in to the console by typing
  the fixture password into the login form; the browser evidence is the Playwright
  spec, which authenticates through the emulator REST API exactly like the existing
  `builder-groups.creator.spec.ts`. The spec asserts the rendered image, the pending
  count, the row content and the post-approve transition, so the panel is proven to
  render real data — but nobody has eyeballed the layout for aesthetics.
- **Task titles are not shown, only task ids** (`משימה pr-a`). The submission map
  stores no title and the panel does no game-doc read. Matches the StaffConsole.
  Worth a follow-up if creators find ids unhelpful.
- **Reject-after-approve still does not claw back points** — by decision. The panel
  disables the control and points at the manual score adjustment.
