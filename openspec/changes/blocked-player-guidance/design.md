## Context

`evaluateSafeZoneStatus` (change: `out-of-bounds-recovery`) already made the SERVER's verdict rich
and fail-open: it returns `{ outOfBounds, reason, distanceMeters, stalenessMs, confidenceMeters }`
and only `reason: 'outside'` means a genuine breach. Both callables that can block a player forward
that verdict — `requestNextTask` returns `{ taskId: null, outOfBounds: true, reason }` and
`updateLocation` returns `{ ok, outOfBounds, reason }`.

The participant app throws all of it away. `TaskRunner`'s `requestNextTask` handler inspects only
`res.reason === 'stationsFull'`; the out-of-bounds card is rendered from the boolean
`state.team.outOfBounds` alone. So the richest signal in the system — the one that distinguishes
"you walked out" from "your phone cannot tell us where you are" — never reaches the person standing
in the field.

Hard constraint: a live playtest stack (Vite 5180/5181, Firestore emulator 8080) serves from this
tree. Nothing here starts, stops or restarts a process, and the emulator-bound gates (`e2e`,
`test:rules`, `simulate`, `verify:emulator`) are deliberately not run. Every new decision is
therefore pure logic verified in the no-emulator lane, plus static wiring assertions over the
component source and the production build.

## Goals / Non-Goals

**Goals:**
- A blocked player is told which of the four situations they are in, in their own language, and what
  will end it.
- A player who cannot be located is never blamed for it, and is never given a distance derived from
  a fix the server itself refused to trust.
- Every blocking card carries a route to a human, reusing the existing SOS/host-alert channel.
- The mapping from server `reason` to card is a pure, total function with fixture coverage for every
  reason value plus missing, unknown, null-distance and stale-fix inputs.

**Non-Goals:**
- Letting the client decide it is in bounds. The card's "check again" re-asks the server; the client
  never clears `outOfBounds` on its own say-so, and the server remains the only writer.
- A manual `geofence` completion for a real player. Explicitly out of scope (as in
  `stuck-player-guards`): the automatic path recovers, and the human escape hatch is reachable.
- Changing `evaluateSafeZoneStatus`, the latch, or any authorization rule.
- Plumbing `updateLocation`'s `reason` through `PlayScreen` into `TaskRunner`. `requestNextTask`
  already answers on exactly the screen that is blocked, and one wire is enough to unblock the
  player; the second one is state-plumbing for no additional information.

## Decisions

### D1 — The mapping is a pure function, `blockedGuidance()`, in `lib/stuckGuards.ts`

Same reasoning as `stuck-player-guards` D1: `play-web` has no component test runner, so a decision
left inside the `.tsx` can only be eyeballed. It joins its siblings in `lib/stuckGuards.ts` (it is
the same class of decision: "may this player still act, and what do we tell them?") and is covered
by the existing `scripts/test-stuck-player-guards.ts`.

Signature:

```ts
blockedGuidance(input: { reason?: string | null; metersOutside?: number | null }): BlockedGuidance
```

`BlockedGuidance = { kind, metersBack, blameless, offerHelp: true, offerRecheck: true }`.

It is TOTAL: `reason` is typed `string | null | undefined` rather than the shared union on purpose,
because it arrives over the wire from a server that may be a version ahead. An unrecognized value
must produce a card, not a crash and not a stronger claim than we can support.

### D2 — Four kinds, and the precedence between them

| server `reason` | kind | meaning shown to the player |
|---|---|---|
| `outside` | `outside` | a fresh, confident fix outside the boundary. Walk back; here is roughly how far. |
| `low_confidence`, `stale_fix`, `no_fix`, `invalid_fix`, `unverifiable` | `unconfirmed` | we cannot place you. Not your fault. We keep trying, and staff can release you. |
| `override`, `inside`, `no_zone` | `released` | the server says nothing is blocking you. Check again. |
| missing / unknown / non-string | `unknown` | we are checking. Staff can release you. |

`unconfirmed` deliberately COLLAPSES four server reasons: from the player's side there is no useful
difference between "too imprecise", "too old", "never reported" and "malformed" — all four mean the
same action (stand somewhere open, or ask a human), and naming the sensor failure mode would be
noise in a field at night. `unverifiable` is included because `evaluateTeamOutOfBounds` returns it
from its catch branch.

`released` exists because the card is rendered from `state.team.outOfBounds`, which is a SNAPSHOT.
A staff release (`override`) or a recovered fix (`inside`) can make the server's live answer
"nothing is wrong" while the stale team doc still says otherwise. Telling that player "head back
into the play area" is actively harmful. They get "you're clear, check again".

### D3 — A distance is shown ONLY for `kind: 'outside'`

`metersBack` is `null` for every other kind, and for a non-finite or non-positive input. A distance
computed from a fix the server explicitly refused to trust (`low_confidence`, `stale_fix`) would
send a player walking in a direction nobody can vouch for. The number is rounded to a whole metre:
GPS does not justify decimals, and "127.4 m" reads like precision that is not there.

The number itself comes from the SERVER (`metersOutside`), never from client geometry — the client
is not given the zone and must not infer it.

### D4 — `blameless`, and why it is in the data rather than in the copy

`blameless` is `true` for every kind except `outside`. It is what stops the "unconfirmed" branch
from reusing the accusatory card: the copy for a blameless kind states that WE could not place them
(`לא הצלחנו לאתר אתכם`), never that they left, and never that they must do something to fix a sensor
failure. Keeping it as a field means the property is asserted in the unit test rather than argued
about in a review of two Hebrew strings.

### D5 — The card's two affordances: a human, and the server

- **Help** reuses the existing `requestHelp()` (`triggerSOS`) and `helpAlreadySent()`. `requestHelp`
  currently latches on `task!.id`, and on this card there IS no task, so it takes the id to latch as
  a parameter and the card passes the constant `BLOCKED_HELP_KEY`. That keeps the existing
  "re-arms when the situation changes" property: once a task is assigned, the affordance is armed
  again for that task.
- **Check again** bumps `routingAttempt` and clears the single-flight ref, which re-fires
  `requestNextTask`. That is a SERVER round trip: it is how a staff release or a recovered fix is
  discovered. There is no client-side path that clears the block.

### D6 — `metersOutside` on the wire, and why the server computes it

`evaluateTeamOutOfBounds` already holds both the evaluated `distanceMeters` (from the zone centre)
and `safeZone.radiusMeters`. `max(0, round(distance − radius))` is metres BEYOND the boundary — the
only figure the player needs, and the one that leaks least: it does not disclose the centre, the
radius, or the shape. It is emitted ONLY on the already-abnormal `outOfBounds: true` path, so the
happy path is byte-identical, and it is additive to the response, so no existing client breaks.

### D7 — The geofence escape hatch drops its `dist != null` precondition

`stuckOutside` required a distance, so the "no fix ever arrived, and no error was reported either"
state — a permission prompt left open, a webview that silently never calls back — showed
"Finding your location…" with no button, forever. The condition becomes "40 s elapsed AND we are not
known to be inside", which covers both `dist == null` and `dist > radius` and cannot fire while the
player is standing on the spot.

## Risks / Trade-offs

- **A card that says "you're clear" while the team doc says otherwise.** Mitigated by making the
  ONLY resolution a server round trip: `released` still shows a blocking card, it just tells the
  truth about the server's live answer and offers the re-check.
- **Copy drift between the four kinds.** Mitigated by the unit test asserting kind + `blameless` +
  `metersBack` per reason, and by the i18n gate (PART A) on the new keys.
- **No browser verification is possible** (the pane is not usable and the stack is live). The React
  side is verified statically (source assertions in the test script) and by `play:build`; on-device
  behaviour under a real safe-zone breach stays unverified and is reported as such.

## Test Strategy

Pure lane only (`npm test` → `scripts/test-stuck-player-guards.ts`, no emulator).

`blockedGuidance` fixtures:
- every reason value: `outside`, `low_confidence`, `stale_fix`, `no_fix`, `invalid_fix`,
  `override`, `inside`, `no_zone`, `unverifiable` → the kind from D2.
- missing reason (`undefined`), explicit `null`, empty string, an unknown future value
  (`'quantum_fix'`), and a non-string (`42`, `{}`) → `kind: 'unknown'`, never a throw.
- distance: `outside` + `120` → `metersBack === 120`; `outside` + `119.6` → `120` (rounded);
  `outside` + `null`/`undefined`/`NaN`/`Infinity`/`-5`/`0`/`'120'` → `null`;
  `low_confidence` + `500` → `null` (an untrusted fix never yields a distance); `stale_fix` + `500`
  → `null`.
- invariants over every fixture: `offerHelp === true` and `offerRecheck === true` for ALL of them
  (there is no input that leaves the player without a route to a human), `blameless === (kind !== 'outside')`,
  and `metersBack === null` whenever `kind !== 'outside'`.
- the whole set is re-run under the existing `Date.now` stubs (epoch, ±6 h) — the function takes no
  clock and must not budge.

Wiring assertions over `TaskRunner.tsx` source (the RED phase for the React side):
- `blockedGuidance(` is called;
- the out-of-bounds card references `BLOCKED_HELP_KEY` and `helpAlreadySent(`;
- `requestHelp` takes an id parameter rather than latching `task!.id`;
- the geofence escape hatch no longer requires `dist != null`.

Gates (verbatim, all no-emulator): `npm run typecheck`, `npm run lint`, `npm test`,
`npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`.
