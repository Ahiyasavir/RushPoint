## Context

Current behaviour, verified 2026-09-25 against the code and in the running app:

| Fact | Where |
|---|---|
| `frozen = busy \|\| readOnly \|\| sentFor === task.id` is passed to every entry as its `busy` prop | `apps/play-web/src/components/TaskRunner.tsx:408`, `:1343-1387` |
| `UploadProgress` renders whenever its `busy` prop is true; `pct === null` renders `t.task.uploadStarting` | `TaskRunner.tsx:2022-2045` |
| The upload store (`setUploadProgress(null)`) is cleared in `uploadResilient`'s `finally` | `apps/play-web/src/services/firebase.ts`, `uploadResilient` |
| `sentFor` is reset ONLY when `assignedRec?.taskId` changes | `TaskRunner.tsx:302` |
| The submit result ("waiting for approval") lives only in local `msg` state | `TaskRunner.tsx:859/882/903` |
| `sanitizeTeamForParticipant` copies the whole `taskSubmissions` map (status, submittedAt, photoUrl, mediaKind, reviewNote, reviewedAt) | `packages/shared/src/testMode.ts:149` |
| `submissionVerdict` recognises only `rejected` | `apps/play-web/src/lib/submissionVerdict.ts:73` |
| A pending submission keeps the mission assigned; the team waits until `reviewStationSubmission` | `functions/src/index.ts` `submitStationPhoto` (no completion unless auto-approved) |

Every piece of information the correct screen needs already reaches the device. This change
is a client-side truth fix with zero added reads or writes.

## Goals / Non-goals

Goals: one honest status line per media mission; no bar unless bytes are moving; the server record
drives "waiting / approved / rejected"; a rejection re-opens the controls; a reload shows the same
state as before it.

Non-goals: upload speed, the non-controller experience beyond inheriting this line, review policy.

## Decisions

### D1: one pure status derivation, `lib/submissionStatus.ts`

```ts
type SubmissionPhase =
  | { kind: 'idle' }                                   // nothing captured / nothing sent
  | { kind: 'preparing' }                              // compressing a photo / finalising a clip
  | { kind: 'uploading'; pct: number | null }          // bytes in flight (null = first event not yet)
  | { kind: 'retrying' }                               // between upload attempts
  | { kind: 'saving' }                                 // submitStationPhoto in flight
  | { kind: 'waitingForApproval'; sentAtMs: number | null; mediaUrl: string | null }
  | { kind: 'approved' }
  | { kind: 'rejected'; note: string }
  | { kind: 'failed'; reason: 'network' | 'tooLarge' | 'refused' | 'unknown' };

function submissionPhase(input: {
  local: { preparing: boolean; uploadPct: number | null; uploading: boolean; retrying: boolean;
           saving: boolean; failed: 'network' | 'tooLarge' | 'refused' | 'unknown' | null };
  server: { status?: unknown; submittedAt?: unknown; photoUrl?: unknown; reviewNote?: unknown } | null;
  latestLocalSubmitAtMs: number | null;
}): SubmissionPhase
```

Precedence, highest first: a LOCAL in-flight phase (preparing → uploading/retrying → saving) wins,
because it describes something happening right now on this device. Then the SERVER record:
`rejected` → `rejected`, `approved` → `approved`, `pending` → `waitingForApproval`. Then a local
`failed`. Otherwise `idle`.

One subtlety: a rejection that arrives BEFORE a newer local re-submit has landed must not flash
"rejected" over "saving"; the local in-flight precedence already guarantees that. After the new
submit lands the server record flips to `pending`, which wins over the stale rejection because the
server writes the whole submission object (verified: `submitStationPhoto` rewrites
`taskSubmissions[taskId]` with a fresh `status: 'pending'`).

Total by construction (the same contract as `submissionVerdict`): garbage `status`, a non-string
note, an unparsable `submittedAt` degrade to the calmer reading, never throw.

### D2: `UploadProgress` renders from the upload store, not from `busy`

`UploadProgress` becomes a rendering of `phase.kind === 'uploading' | 'retrying'` only. The
`busy` prop is removed from it. This alone deletes the fake bar in all three entries AND on the
non-controller phone, which today shows it permanently (reproduced: `readOnly` feeds `frozen`).

### D3: the `sentFor` latch is replaced by the server phase

`sentFor` exists to stop a second press re-uploading a submission that already landed (live run
2026-09-17). The server phase says the same thing more truthfully: while `waitingForApproval` or
`approved`, the send button is not offered; the entry shows the sent media and the line. When the
phase becomes `rejected`, the entry shows its capture controls again, enabled, with the previous
capture still loaded (`capturedRef` keeps it; the stored url is dropped so a re-send uploads the
new capture if one is taken, or reuses nothing: a rejected file must not be re-submitted
silently).

`frozen` keeps `busy || readOnly` (the in-flight guard and the viewer gate); the `sentFor` term is
deleted. The double-press protection is preserved because `begin()`/`inFlight` still guards the
in-flight window and, after it, the phase is `waitingForApproval` and no send control exists.

Auto-approved submissions: the phase becomes `approved` for the instant before routing moves on,
exactly the window `sentFor` covered.

### D4: "replace my submission" while waiting

A player who realises they sent the wrong picture can replace it: the waiting card offers a
secondary "send a different one" action that re-opens capture. Re-submitting is already legal
server-side (a `pending` record is overwritten; an `approved` one is refused as `already`). This is
the positive version of the duplicate-upload behaviour production shows: the player can do it on
purpose, knowingly, instead of by accident.

### D5: the waiting card

`waitingForApproval` renders: the sent media (thumbnail for photo; a small player for video/audio,
from `photoUrl`, already served with range support), "sent at HH:MM", a line saying the organizer
is reviewing it, and two actions: "message the organizer" (opens the existing chat tab) and "send a
different one" (D4). An elapsed-time line appears after 3 minutes ("waiting 4 min"), because a
wait with no clock reads as broken.

### D6: copy

New `t.task.phase.*` keys in both dictionaries. `uploadStarting` is kept (it is the real "first
progress event not yet arrived" state). No string may name a phase the system does not perform;
the review asked for "transcribing / analysing" and those are deliberately absent (see
`docs/field-report-2026-09-25.md`).

## Risks

- **A stale `rejected` shown after a successful re-send until the snapshot arrives.** Covered by
  D1's precedence (`saving` wins) and by the submit handler optimistically setting a local
  `justSubmittedAtMs` that outranks a server record older than it.
- **Legacy submissions without `submittedAt`.** `sentAtMs: null` hides the time, nothing else.

## Test strategy

- Pure (`scripts/test-submission-status.ts`): the precedence table (every local phase × every server
  status), garbage inputs, the "rejected then re-sent" ordering, the auto-approved instant.
- A source guard in the same test: `UploadProgress` must not accept a `busy` prop, and no entry may
  pass `frozen` to it (a regex over `TaskRunner.tsx`, the same shape as
  `test-task-entry-keying.ts`).
- e2e (`scripts/e2e-verify.mjs`, existing photo-review scenario): after `reviewStationSubmission`
  rejects, `getMyTeamState` returns `taskSubmissions[taskId].status === 'rejected'` with the note,
  and a second `submitStationPhoto` for the same task is accepted and flips it to `pending`
  (behaviour exists; the assertion pins it because the UI now depends on it).
- UI via preview, 375×812: the three reproductions from the proposal must each end in the correct
  state (waiting card with no bar; rejection with enabled controls; reload shows the waiting card).
  `npm run i18n:check:strict` clean.
