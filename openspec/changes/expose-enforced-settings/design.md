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
