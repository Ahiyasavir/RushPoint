# Design

## D1. The shape of the bug

Two different failures wear the same clothes ("a field with no UI"), and they need different fixes.

| Field | Failure | Fix class |
|---|---|---|
| `requiresGuardianConsent` | server holds a participant in a state **nothing reports and no client can leave** | make the hold visible |
| `safeZone` | server reads a field that is **written without any validation** | validate at the door |
| `minAge` | server reads it **nowhere**; the name implies a gate that does not exist | escalate, do not code |
| `Task.status` | real live-ops gap, needs a new authorized callable | separate change |
| `attemptLimit`, `benchmarkOptOut`, `expectedDurationMinutes` | absent value has a correct default | leave alone |

Only the first two are addressed. The ranking is by consequence, not by field count.

## D2. Why "report the hold" and not "build the flow"

`startTeams` currently answers "how many started". A held team is the difference between two numbers
the caller never sees, so silence is structural, not a missing log line. The minimal honest change is
to make the result say what happened:

```
{ launched, heldForConsent }
```

`heldForConsent` is derived by the SAME predicate that does the holding, from one pure function, so
the count cannot disagree with the behavior. Everything else (a consent UI, what a guardian is told,
what is recorded) is policy on a child-safety surface and is escalated, not invented.

Deliberate consequence: after this change a consent-required game still cannot start teams. That is
correct. The failure becomes **loud** instead of **silent**, which is the whole point; silently
launching a minor to satisfy a progress bar would be the actively harmful fix.

## D3. Purity boundary

Everything decidable without I/O is decided in `packages/shared`, unit-tested before it is wired:

- `partitionTeamsByConsent(teams, gameConfig)` — total; returns `{ ready, held }`, a partition
  (`ready ∪ held === input`, `ready ∩ held === ∅`). Delegates per-team to the existing
  `isConsentSatisfied`, so no second definition of "consented" is created.
- `validateMinAge(value)` / `validateConsentFlag(value)` — `{ ok }` or `{ ok: false, error }`.
- `validateSafeZone(value)` — `{ ok: true, value }` / `{ ok: true, value: undefined }` (an explicit
  clear) / `{ ok: false, error }`.

Server code calls these; it does not re-derive them.

## D4. Validator semantics (the rules the tests encode)

Absent is never an error. Every validator distinguishes three inputs:

- **`undefined`** ⇒ "no change" — `updateGame` skips the field entirely. This is what every existing
  save path sends, so nothing in flight is affected.
- **`null`** ⇒ an explicit clear (safe zone only; a boundary can be removed).
- **present** ⇒ must be well-formed, or the call is refused with `invalid-argument`.

`validateSafeZone` accepts only: a plain object with `center.lat` finite in `[-90, 90]`,
`center.lng` finite in `[-180, 180]`, and `radiusMeters` finite and `> 0` and
`<= SAFE_ZONE_MAX_RADIUS_M` (50 000 m). Rejected: NaN, `Infinity`, strings, arrays, a missing
`center`, `radiusMeters: 0` (a zero-radius zone is not "no boundary", it is a boundary every team is
outside of), negatives, and an absurd radius that spans continents and therefore configures nothing.

`validateMinAge` accepts an integer in `[0, 120]`. Rejected: fractional, NaN, `Infinity`, negative,
absurd, and non-numbers. `validateConsentFlag` accepts booleans only, so a truthy string can never
arm a child-safety gate by accident.

Note on `radiusMeters: 0`: `evaluateSafeZoneStatus` already treats a non-positive radius as `no_zone`
(`packages/shared/src/safeZone.ts:119-122`), so a stored zero is inert today. It is still rejected on
the way IN, because a control that silently means "off" when the author meant "tiny" is the same
class of bug this change exists to remove.

## D5. Why validation goes in `updateGame` and nowhere else

`updateGame` (`functions/src/games/index.ts:214`) is the only writer of these fields from a client,
and `importGameFile` shares its `stagesProblems` validation already (`:254-255`), which is the house
precedent for "the Builder path and the file path must not drift". Validation is placed on the
payload BEFORE `ref.update(updates)` so a malformed boundary never reaches Firestore and therefore
never reaches `updateLocation`.

## D6. Test Strategy

Pure lane only — a live playtest stack is serving from this tree, so no emulator is touched.

New `scripts/test-enforced-settings.ts` (house style: `ok(cond, msg)`, counters, `process.exit(1)`),
picked up automatically by `scripts/run-unit-tests.mjs` (`/^test-.*\.ts$/`) and therefore by
`npm test`.

`validateSafeZone` cases: valid boundary · `undefined` (no change) · `null` (clear) · missing
`center` · `center` not an object · `lat` NaN · `lng` NaN · `lat` `Infinity` · `lat` 91 / `-91` ·
`lng` 181 / `-181` · lat/lng at exactly `±90` / `±180` (accepted) · `radiusMeters` 0 · negative ·
NaN · `Infinity` · string · exactly `1` (accepted) · exactly `SAFE_ZONE_MAX_RADIUS_M` (accepted) ·
`SAFE_ZONE_MAX_RADIUS_M + 1` (rejected) · array input · string input · number input · a valid zone
with extra unknown keys (accepted, normalized to just centre + radius so nothing rides along).

`validateMinAge` cases: `undefined` · 0 · 13 · 120 · 121 · `-1` · `12.5` · NaN · `Infinity` ·
`'13'` · `null` · `true`.

`validateConsentFlag` cases: `undefined` · `true` · `false` · `'true'` · `1` · `0` · `null`.

`partitionTeamsByConsent` cases: empty · consent not required (everyone ready, even with no consent
record) · required with no records (everyone held) · required, mixed · required with
`grantedAt: ''` (falsy ⇒ held) · a team whose `guardianConsent` is `null`. Plus the partition
invariant asserted on EVERY case: `ready.length + held.length === input.length`, no id in both, and
input order preserved within each side.

Not covered by tests here, and said plainly rather than implied: the `startTeams` result shape and
the `updateGame` rejections are callable behavior, which lives in `scripts/e2e-verify.mjs` — a file
this lane does not own. The assertions to add are listed in tasks.md §5 for the owning lane.

## D7. What is NOT built, and why

Restated from the proposal because it is the load-bearing part of this design:

1. **No participant consent UI.** Mechanism only. What a guardian is shown, who may consent, and
   what is stored are policy on a child-safety and legal surface. Escalated to the product owner.
2. **No `minAge` control.** It is enforced nowhere. Giving it a control would create a false age
   gate, which is worse than the current inert field. Report, do not wire.
3. **No `Task.status` live-ops control.** Genuine gap, needs a new authorized callable plus console
   UI, plus authz coverage. It earns its own change.
4. **No `benchmarkOptOut` / `expectedDurationMinutes` controls.** Their defaults are correct.

---

# Design — wave 2 (the control, and the unchecked door)

## D8. Why the safe zone outranks everything else left

Ranked by consequence, not by field count, and re-derived rather than inherited:

| Field | Who is harmed, and how loudly |
|---|---|
| `safeZone` | An entire chain is built and dead. `updateLocation` flags, routing pauses, the player is told "you are outside the play area", the organizer gets a badge and a release button — and no creator can draw the boundary any of it reacts to. Nobody is harmed today because nobody can turn it on; the day someone hand-edits a file, an unvalidated shape lands in a safety path. **Fixed.** |
| `requiresGuardianConsent` | Reachable through the file door, unsatisfiable once armed: teams are held forever with no participant action available. **Made unreachable at that door.** |
| `Task.status` | Real live-ops gap. A venue closes mid-run and the operator has no lever. Needs a new authorized callable + console UI + authz + e2e. **Deferred as its own change.** |
| `minAge` | Compared against nothing. A name that implies a gate. **Escalated, not coded.** |
| `attemptLimit`, `benchmarkOptOut`, `expectedDurationMinutes` | Absent value defaults correctly. **Left alone.** |

## D9. Why the centre is derived, not typed

A boundary needs a centre and a radius. A radius is a number a person has an intuition for
("about 800 m"); a centre is two decimal degrees, which nobody types correctly and everybody
mistypes silently. So the control asks for the number a human knows and derives the one they do not:
`suggestSafeZone(stages)` fits an area around the stops the creator has already placed on the map.

Rules, all encoded in tests before the button existed:

- **Extent midpoint, not centroid.** A mean is dragged by clusters, so a game with nine stops in one
  square and one across town would centre on the square and leave the tenth outside. The midpoint of
  the bounding extent does not have that failure.
- **Only placed stops count.** Locationless stops, out-of-range coordinates, non-finite coordinates
  and null island contribute nothing, matching the house rule everywhere else that reads task
  coordinates.
- **`hideLocation` stops DO count**, unlike `publicTaskLocation`. The safe zone lives on the private
  game document and is never copied into `publicGames` or any participant payload, so a hidden stop
  cannot leak through it; whereas an area that omitted the hidden stops would fence players out of
  the very tasks they are sent to find. The difference is deliberate and documented at the function.
- **Rounding goes UP.** The radius is rounded up to a tidy 10 m, never down, so a cosmetic rounding
  can never shrink the area below its own stops.
- **A clamp is reported, not hidden.** A game whose stops span further than
  `SAFE_ZONE_MAX_RADIUS_M` cannot be contained by one circle. The suggestion returns the clamped
  radius plus `coversAllTasks: false`, and the Builder warns. Silently emitting a boundary that flags
  players standing on the game's own tasks would be the actively harmful option.

## D10. Two defects the wave-1 validation left standing

**A clear did not clear.** `updateGame` wrote `updates.safeZone = undefined` on an explicit clear,
and `functions/src/firebase.ts:10` sets `ignoreUndefinedProperties: true`, so the write was dropped
and the boundary survived. This is only discoverable by building the control that clears it, which is
why it surfaced now. Fixed with `FieldValue.delete()`, exactly as `instructions` already clears.

**The validated door was not the reachable one.** Wave 1 hardened `updateGame`. But `importGameFile`
spreads the parsed file straight into the new game and ran none of the validators, and the file door
was the ONLY way any of these fields could actually be set. The hardening was applied to the door
nobody could use. `functions/src/games/index.ts:139-141` already states the rule ("a game restored
from a file can never be accepted on terms an authored one would be refused"); both doors now share
the validators and the import stores the normalized centre-and-radius rather than the file's object.

## D11. Guardian consent: refuse, do not strip, do not design

The armed state is unsatisfiable in-product: `startTeams` holds every team until a consent record
exists, `startInstantPlay` refuses outright, the callables that would write the record are never
called by any participant surface. The only reachable way to arm it is the file door.

Three options, and why the middle one:

1. *Leave it.* A creator can import a game whose run can never start, and nothing says why. Rejected.
2. *Refuse it at the door, with a message that says what is missing.* The state becomes unreachable
   AND the situation becomes visible to the person who tried. Chosen.
3. *Build a consent flow.* Requires deciding who may consent, what they are shown, what is recorded
   and for how long. That is policy on a child-safety and legal surface. **Out of bounds for this
   change and for an agent.**

The refusal is a guard on an unsatisfiable state, not a statement about what consent should require.
When a participant path exists, this guard is the thing to remove, and the delta spec says so.

## D12. Test Strategy — wave 2

Pure lane only; a live playtest stack serves from this tree, so no emulator was touched.

`scripts/test-enforced-settings.ts` gains a `suggestSafeZone` section, RED before the function
existed: no stages · empty stages · a non-array · a stage with no tasks · a null stage · a task with
no coordinates · a locationless task · null island · NaN and Infinity coordinates · an out-of-range
latitude · one placed stop (centred on it, at exactly the minimum radius) · several stops across
stages (every stop verified inside the radius by an independent haversine, padding present, centre
inside the extent) · order independence · a continent-wide spread (clamped, `coversAllTasks: false`)
· totality over hostile input. Plus the invariant asserted on every suggestion produced: it is
accepted by `validateSafeZone`, so the control can never offer a boundary the server would refuse.

`scripts/test-game-presentation.ts` (the payload-completeness guard) gains: `safeZone` is declared
builder-editable, reaches the payload, a clear is a distinguishable serialization (so it marks the
game dirty), and a clear is sent as `null` rather than `undefined`. The guard itself was strengthened
— it now requires the fixture game to POPULATE every declared field. Previously an unpopulated field
compared `undefined` with `undefined` and passed, so the guard went quiet at exactly the moment a new
control was added, which is the one moment it exists for.

Not written here, and said plainly: the callable behavior (the import refusals, the clear actually
deleting) belongs in `scripts/e2e-verify.mjs`, which this lane does not own. The assertions are
listed for the owning lane in tasks.md.

## D13. What wave 2 did NOT build

1. **No participant consent flow, and no creator control for the consent flag.** Policy.
2. **No `minAge` control.** Enforced nowhere; a control would fake an age gate.
3. **No `Task.status` live-ops control.** Earns its own change; ranked second overall.
4. **No map picker for the safe-zone centre.** Derived and refittable instead. A MapLibre picker is a
   real improvement and a real bundle cost, and the derivation makes the control usable without it.
5. **No safe-zone display on the participant map.** The player is already told when they leave the
   area. Drawing the circle is a separate question about how much of the boundary a player should see.
