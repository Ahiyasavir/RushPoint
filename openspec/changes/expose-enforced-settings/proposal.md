## Why

An audit catalogued `Game`/`Task` fields the **server enforces** but that **no creator control sets**.
This is worse than a merely invisible setting: the server gates real behavior on a value nobody can
configure, and one of them can hold a participant in a state they cannot leave.

Verified in this working tree, claim by claim:

1. **`Game.requiresGuardianConsent` is a silent, unsatisfiable hold. CONFIRMED, and it is the reason
   this change exists.** `startTeams` filters teams through `isConsentSatisfied`
   (`functions/src/runs/index.ts:598-605`) and returns only `{ launched: targets.length }`
   (`:630`) — a team held for consent is **subtracted from a count**, with no field naming it. The
   creator client then reports unconditional success: `RunConsolePage.tsx:315` awaits `startTeams`
   and toasts `startedAllTeams` whatever the number was. So on a consent-required game the organizer
   presses "start all teams", is told it worked, and nobody starts. The consent callables
   themselves DO exist server-side (`requestGuardianConsent` `:639`, `grantGuardianConsent` `:657`)
   and are exported (`functions/src/index.ts:47`), but **play-web wraps neither** — no match for
   `requestGuardianConsent`/`grantGuardianConsent` anywhere under `apps/play-web/src`. There is
   therefore no participant-side path to satisfy the gate.
2. **`Game.minAge` is enforced NOWHERE. CONFIRMED dead.** It is stored
   (`functions/src/games/index.ts:276`), typed (`packages/shared/src/types/index.ts:510`) and
   accepted by the file-import allow-list (`packages/shared/src/gameFile.ts:112`), and that is the
   whole of it. No comparison against it exists in `functions/src`. A field named `minAge` next to a
   consent flag reads as an age gate and is not one. That is a misleading safety signal on a
   child-safety surface, which is a documentation/decision problem, not a coding one.
3. **`Game.safeZone` is enforced with no author and no validation. CONFIRMED.** Enforced in
   `updateLocation` (`functions/src/index.ts:344-367`) and in the routing pause path
   (`functions/src/runs/index.ts:3290-3301`, `evaluateSafeZoneStatus`). No control sets it in either
   app. `updateGame` accepts it **completely unchecked** — `functions/src/games/index.ts:277` is a
   bare `updates.safeZone = safeZone ?? undefined`, so any shape at all persists onto a field the
   safety path reads. The archived spec even asserts a control that was never built:
   `openspec/specs/safe-zone/spec.md` says "the creator sets a safe-zone center and radius in the
   Builder".
4. **`Task.status` (`paused`/`closed`) is honored by routing with no live-ops control. CONFIRMED.**
   `functions/src/routing/assignNextTask.ts:172,286,334` all exclude paused/closed tasks. Nothing in
   `apps/creator-web/src` ever writes the value, and there is no run-console action for it
   (`apps/creator-web/src/lib/runConsoleActions.ts:12` lists the run actions; task status is absent).
5. **`smart.attemptLimit` is enforced and SHOWN to players with no creator input. CONFIRMED.**
   Server-enforced via `attemptLimitReached` (`functions/src/index.ts:11`), carried to participants
   by the sanitizer, and rendered as a live attempts-left guard
   (`apps/play-web/src/components/TaskRunner.tsx:975-981`, `apps/play-web/src/lib/interaction.ts:36-61`).
   `apps/creator-web/src/components/TaskWizard.tsx` exposes `secretCode` and `autoApprove` under
   `smart` but never `attemptLimit`.
6. **`Game.benchmarkOptOut` (`functions/src/runs/index.ts` benchmark path) and
   `Task.expectedDurationMinutes` (`packages/shared/src/scoringPresets.ts:72`) — CONFIRMED
   unauthored, and deliberately NOT addressed here.** Both are tuning knobs whose absent value has a
   correct default. A default that works is not a bug.

One nuance the audit missed and this proposal records: these fields are **not** literally
unreachable. `packages/shared/src/gameFile.ts:112,151,170` allow-lists `requiresGuardianConsent`,
`minAge`, `safeZone`, task `status` and `smart.attemptLimit` through `importGameFile`, which the
Builder exposes (`apps/creator-web/src/pages/BuilderPage.tsx:347`). A hand-edited game file can set
every one of them. That does not make them configurable in any reasonable sense — but it does mean
the unsatisfiable consent state is **reachable today**, and that unvalidated values can already be
written to `safeZone`.

## What Changes

**A consent hold stops being invisible.**
- Starting teams reports *why* a team did not start. The result distinguishes teams that were
  launched from teams that were **held for guardian consent**, so an organizer is told the truth
  instead of being toasted "started all teams" over a no-op.
- The creator console surfaces the held count instead of an unconditional success message.
- The decision stays a **pure, total function** over (teams, game config) so the hold and the count
  can never drift from each other.

**Consent configuration becomes validated rather than trusted.**
- `updateGame` validates `requiresGuardianConsent` and `minAge` instead of persisting whatever
  arrives. A non-boolean flag and a non-integer / out-of-range / NaN age are refused loudly.
- No consent *flow* is invented here, and no legal copy is written. See "Deliberately not exposed".

**The safe zone gets a validator, and the enforcement path stops trusting its input.**
- A pure `validateSafeZone` decides whether a candidate boundary is usable: finite coordinates in
  range, a positive radius, a sane maximum, and an explicit clear.
- `updateGame` refuses an invalid boundary rather than writing it to a field two safety paths read.

### Deliberately not exposed

Recorded here because "we chose not to" is a different statement from "we missed it":

- **`Game.minAge`** — NOT given a control. Wiring an input to a field nothing compares against would
  manufacture the impression of an age gate that does not exist. Its fate (enforce it, or delete it)
  is a **policy decision for the product owner**, not an implementation detail an agent should
  settle. Flagged, not decided.
- **A guardian-consent participant flow** — NOT built. Consent is a child-safety and legal surface;
  designing who may consent, what they are told, and what is recorded is not a mechanism question.
  This change makes the existing hold **visible** and leaves the flow to a human decision.
- **`Game.benchmarkOptOut`** and **`Task.expectedDurationMinutes`** — LOW severity, skipped. Both
  default correctly when absent (benchmark participation on, duration derived). Adding a control
  would be UI for its own sake.
- **`Task.status` live-ops pause/close** — a real gap (a station closing mid-event is exactly when
  you need it) but it needs a new authorized callable plus run-console UI, which is a change of its
  own rather than a tail on this one. Recommended as the immediate follow-up.

## Capabilities

### Modified Capabilities
- `guardian-consent`: adds a requirement that a consent hold is **reported**, not silently
  subtracted, and a requirement that consent configuration is server-validated.
- `safe-zone`: adds a requirement that a safe-zone boundary is validated before it is persisted, so
  the enforcement path can never read a boundary the system would not accept.

## Impact

- **Surfaces touched:** `packages/shared/src` (two pure modules), `functions/src/games/index.ts`
  (validation only), `functions/src/runs/index.ts` (`startTeams` result shape only),
  `apps/creator-web/src` (call type + one console message + i18n).
- **No** Firestore rules, **no** storage rules, **no** play-web changes, **no** new callables.
- **Backwards compatibility:** `startTeams` only ADDS fields to its result; existing callers that
  read `launched` are unaffected. Validation only rejects values that no control produces today.
- **Testing:** pure-logic lane only (`scripts/test-enforced-settings.ts`, no emulator). Callable
  behavior changes are reported as suggested e2e assertions rather than written, because
  `scripts/e2e-verify.mjs` is owned by another lane.
- **Risk:** the validators reject input. Both are biased so that ABSENT means "no change" and only a
  present-but-malformed value is refused, which is why every validator case is enumerated in tests
  before it is wired.
