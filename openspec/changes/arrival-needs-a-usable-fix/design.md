## Context

`packages/shared/src/safeZone.ts` already learned that a position without its error
radius is not evidence. Its header records that the previous version decided a breach
*"on that answer alone: no accuracy, no age"*, and `evaluateSafeZoneStatus` now refuses
to call a team out of bounds unless a fresh fix clears the boundary by more than its
own accuracy.

The arrival gate never learned it:

- `evaluateTrigger` (`packages/shared/src/geo.ts`) takes `(mode, distanceM, radiusM)`.
  No accuracy parameter exists.
- `completeTask` and `reportArrival` (`functions/src/runs/index.ts`) destructure
  `{ taskId, lat, lng, ... }`. No accuracy is accepted.
- `withLocation` (`apps/play-web/src/utils/withLocation.ts`) called
  `cb(p.coords.latitude, p.coords.longitude)`. The browser hands over
  `p.coords.accuracy` on every fix and it was dropped on the floor.

The default arrival radius is 40m (`defaultRadiusFor('radius')`). A phone indoors, in
an urban canyon, or on a cold start routinely reports 100 to 500m of error. Its
reported POINT can sit inside the 40m circle while the player is nowhere near it, and
today that is accepted.

## Goals / Non-Goals

**Goals:** a fix that cannot locate the player within the mission's own radius stops
counting as arrival; the refusal is recoverable; an app that sends no accuracy behaves
exactly as before.

**Non-Goals:** detecting a faked position, changing the default radius, touching the
safe-zone verdict, or anything about photo or answer verification. See `proposal.md`.

## Decisions

### D1 — The rule is "an error larger than the target proves nothing"

`evaluateArrivalFix` refuses arrival when `accuracyMeters > radiusM`. A 200m fix cannot
place anyone within 40m of anything.

**Alternatives considered:**

- **`distance + accuracy <= radius` (definitely inside).** Mathematically the strongest
  claim, and too strong in practice: a 40m radius with a 30m fix would demand the
  player be within 10m, so ordinary phones would fail at the correct spot. That is the
  stranding failure CLAUDE.md warns about repeatedly.
- **A fixed ceiling such as 75m.** Arbitrary, and wrong at both ends: too lax for a 10m
  radius, too strict for a 150m presence radius. Scaling to the mission's own radius is
  the only threshold that means the same thing everywhere.

**The boundary belongs to the player:** accuracy EQUAL to the radius is still usable, so
the common "40m radius, 40m fix" case keeps working. Only a strictly worse fix is
refused.

### D2 — The coarse check runs BEFORE the distance check

Telling a player "you are 500m away" on the strength of a fix with 800m of error
asserts something the evidence does not support, and it is not advice they can act on.
"Hold still, we cannot see you well enough yet" is.

### D3 — `unavailable`, not `failed-precondition`

The two refusals need different advice and the client must be able to tell them apart:
"you are not there" means walk, "we cannot see you" means stand still. They are
therefore different error CODES, not different message strings — a client that matched
on prose would break the moment the prose was translated.

`fixTooCoarse` is **retriable** and **not charged as an attempt**. Charging it would
apply a wrong-answer cooldown to a player standing in exactly the right place.

### D4 — Absent accuracy reproduces the old decision exactly

An installed participant app that has not updated sends nothing. `positive()` returns
null, the coarse branch is skipped, and the distance-versus-radius decision is
byte-for-byte what it was. The server change is therefore safe to ship before the
client change, in either order.

### D5 — The hidden-mission unseal gets the same guard

Revealing a sealed location to someone who is not there is the same defect in a
treasure-hunt costume. `reportArrival` applies the same verdict, and its refusal
message stays digit-free so the secret point cannot be triangulated by polling — the
constraint that path already lives under.

## Test Strategy

**Pure — `npm test`, `scripts/test-arrival-fix-quality.ts` (50 assertions):** ordinary
outdoor fixes unchanged; genuinely-too-far still too far and still reporting the
distance; the reported field case (200m fix, 40m radius) refused; the equal-to-radius
boundary accepted; coarse-and-far reported as coarse; every shape of absent accuracy
reproducing the old decision; `retriable` and `countsAsAttempt` correct per outcome; a
missing or nonsensical radius falling back rather than stranding; totality; and a
6000-case seeded sweep asserting **arrival is never granted on evidence that cannot
support it**, with every outcome reached.

**e2e — `npm run e2e`:** two callables changed payload shape, so the whole suite must
stay green, including the callable-coverage guard (no callable added).

**UI:** `npm run i18n:check:strict` for the new participant message in both languages.

## Risks / Trade-offs

- **[Stranding a player at the correct spot]** → the single biggest risk, and the
  reason for D1's threshold, D3's retriability, and leaving the existing "ask a human"
  escape hatch untouched. A player who waits a few seconds for a better fix gets
  through; nothing is permanent.
- **[A client can still lie about its accuracy]** → true, and named as a non-goal. This
  closes an honest-phone failure, not an adversary. Claiming otherwise would be worse
  than saying so.
- **[Indoor missions with tight radii become harder]** → they become CORRECT. A mission
  that only ever passed because the fix was bad was never verifying anything.
- **[Two deploy targets]** → safe in either order, per D4.

## Migration Plan

Land, `npm run verify` and `npm run e2e` green, ship the API by VPS rebuild and the
participant app by `deploy:hosting` in either order. **Rollback:** revert; nothing
stored changes shape and no run in flight is affected.

## Open Questions

1. **Should the creator see which missions will actually verify arrival?** A mission
   with "skip GPS check" on, an unplaced pin, or a very large radius all produce
   "anyone can check in from anywhere", and nothing on the mission card says so. That
   is a Builder legibility change and deserves its own proposal.
2. **Should a repeatedly coarse fix escalate to the organizer?** A player stuck behind
   a bad fix for minutes is someone the console should probably surface, and the
   stranded-team machinery from `late-joiner-autostart` is the obvious place.
