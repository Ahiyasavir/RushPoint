## Why

In the 2026-09-10 run the organizer reported that on arrival missions the "I'm here"
button let teams advance *"without precise verification of the participants' physical
location."*

The mechanism is not missing — it is blind to how good the fix is.

`packages/shared/src/safeZone.ts` already learned this lesson for safety boundaries.
Its own header records that the previous version decided a breach *"on that answer
alone: no accuracy, no age"*, and it now refuses to call a team out of bounds unless a
fresh fix clears the boundary **by more than its own error radius**.

The arrival gate never learned it:

- `evaluateTrigger` (`packages/shared/src/geo.ts`) compares a bare `distanceM` to a
  bare `radiusM`. There is no accuracy parameter.
- `completeTask` and `reportArrival` do not accept one.
- `TaskRunner`'s `withLocation` does not send one, although the browser hands it over
  on every fix as `GeolocationCoordinates.accuracy`.

So a phone with a poor fix — indoors, an urban canyon, a cold start, which is exactly
a field game — reports a point that can land inside a 40m radius while the player is
hundreds of metres away, and the check-in is accepted. The platform holds the evidence
that the fix is worthless and throws it away.

**The direction of the fix is the opposite of the safe-zone one, and that is the
point.** For a safety boundary an imprecise fix must not ACCUSE. For an arrival gate
an imprecise fix must not PROVE. Same missing input, opposite fail-safe.

## What Changes

- **A check-in reports how good its fix was.** The participant app sends the browser's
  reported accuracy alongside the coordinates it already sends.
- **A fix too imprecise to locate the player within the mission's own radius stops
  counting as arrival.** Where the fix's error is larger than the target it is being
  measured against, it carries no information about being there.
- **This is never a dead end.** A fix that cannot prove arrival asks the player to hold
  still and try again, and keeps the existing route to a human. A retry with a better
  fix succeeds.
- **A client that sends no accuracy behaves exactly as it does today**, so an
  installed app that has not updated is never stranded.

**BREAKING**: none. Every existing payload stays valid, and a mission whose players
have ordinary outdoor fixes sees no change at all.

## Capabilities

### New Capabilities
- `arrival-verification`: what counts as evidence that a team reached a place.

## Impact

- **Surfaces**: `packages/shared` (a new pure verdict beside `evaluateTrigger`),
  `functions/src/runs/index.ts` (`completeTask`, `reportArrival` accept and apply it),
  `apps/play-web` (send the accuracy, and say what to do when it is not good enough).
- **No new callable.** Two existing ones gain an optional payload field, so no new
  `services/calls.ts` entry and the callable-coverage guard is unchanged.
- **No Firestore shape, rule, index or env var changes.**
- **i18n**: one new participant message, both languages.
- **Deployment**: server by VPS rebuild, participant app by `deploy:hosting`. Safe in
  either order: until the server is updated the extra field is ignored, and until the
  app is updated no accuracy is sent and behaviour is today's.

## Non-goals

- **Detecting a faked GPS position.** A determined client can lie about coordinates;
  that is a different threat with a different answer, and pretending otherwise here
  would be worse than saying so.
- **Tightening the default radius.** 40m is a product decision and is not this bug.
- **Changing the safe-zone verdict**, which is already correct for its own direction.
- **Requiring accuracy on tasks that are not located** — a locationless or
  self-report mission is unaffected.
- **Photo or answer verification**, which is a separate reported issue.
