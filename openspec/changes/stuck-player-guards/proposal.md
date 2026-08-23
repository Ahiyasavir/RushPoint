## Why

A participant was recently frozen out of their own game by CLIENT state: the wrong-answer retry
lockout put an ABSOLUTE server instant on the wire and `TaskRunner` counted it down against the
DEVICE clock, so a phone running hours behind disabled its own answer controls for hours — and a
reload re-read the same instant and re-froze it. That specific instance is fixed
(`retry-lockout-clock-skew`). This change hunts and fixes its SIBLINGS: other places where
client-only state can disable, hide or block a player's ability to progress and then get stuck.

Three were confirmed by reading `apps/play-web/src` and its callers:

1. **A single transient GPS error permanently kills geofence check-in.**
   `TaskRunner.tsx:1113` — `GeofenceAuto`'s `watchPosition` error callback sets `gpsError` AND calls
   `clearWatch(id)`. Nothing ever restarts that watch: `setGpsError(false)` happens only when the
   effect re-runs, and its deps are `[coords?.lat, coords?.lng, radius]` — constant for the task the
   player is standing on. Geolocation errors are NOT only permission denials: `POSITION_UNAVAILABLE`
   (code 2) fires routinely indoors, in a courtyard, in a tunnel. A `geofence` task has **no manual
   submit path** for a real player (the "I'm here" button at `:757` renders only when
   `session.isTestDrive`), so one transient error = that task can never be completed on that phone,
   for the rest of the run, while GPS is working fine again seconds later. The app's own browser
   simulator already documents this behaviour as a blocker it had to work around
   (`scripts/simulate-browser-run.mjs:167`: "GeofenceAuto clears its watch on any error"). The only
   remaining affordance is a host alert, which brings us to:

2. **The stuck-player escape hatch latches for the whole run.** `helpSent`
   (`TaskRunner.tsx:107,377`) is TaskRunner-level state that is never reset when the assigned task
   changes — the reset effect at `:190` clears only `hint` and `msg`. After one successful
   "ask the host for help", every LATER task renders "Sent, the host has been alerted"
   (`:1123-1124`) and the button is gone. A team that gets stuck twice can raise the alarm once.

3. **Every submit fails CLOSED on `navigator.onLine`.** `blockedOffline` (`TaskRunner.tsx:286`)
   short-circuits check-in, station code, photo, audio, quiz, numeric, sequence, arrival AND the
   automatic geofence check-in whenever `navigator.onLine === false`. That flag is a browser
   heuristic that is known to read `false` on a working connection (VPN/virtual adapters, some
   Android and captive-portal network states); when it is wrong, it is cleared only by an `online`
   event that never fires, because the browser never thought it went offline. The player then taps
   a live button that does nothing, forever, with a server that would have accepted every one of
   those submissions.

All three are the same class as the motivating bug: **client-only state that can block progress and
that nothing is guaranteed to clear.**

## What Changes

**Every blocking decision fails OPEN and is a pure, tested function.**

- A new `apps/play-web/src/lib/stuckGuards.ts` holds the decisions as pure functions (no React, no
  storage, no `Date.now`), covered by `scripts/test-stuck-player-guards.ts` in the `npm test` fast
  lane — the same extraction pattern as `lib/failureCopy.ts`.

**Geofence GPS errors become recoverable instead of terminal.**
- The watcher retries with bounded backoff after an error instead of clearing itself for good, and
  a successful fix clears the error state — so a player who walks out of the dead spot resumes
  automatically, with no reload and no staff intervention.
- The error card says help is on the way back rather than implying the device is finished.

**The host-help affordance is scoped to the task it was raised for.**
- "Sent" is remembered per task id, so a team stuck on a later task can raise the alarm again.

**The offline gate warns once, then gets out of the way.**
- The first blocked attempt on a task still shows the localized offline nudge (the honest, common
  case). A repeat attempt on the same task goes through and lets the network and the server decide.
  A player is never permanently blocked by a browser flag the server does not consult.

## Impact

- Affected specs: `play-stuck-guards` (new capability).
- Affected code: `apps/play-web/src/lib/stuckGuards.ts` (new),
  `apps/play-web/src/components/TaskRunner.tsx` (`GeofenceAuto` watcher, `blockedOffline`,
  `helpSent`), `apps/play-web/src/i18n.ts` (two new keys, HE + EN),
  `scripts/test-stuck-player-guards.ts` (new).
- NOT touched: the wrong-answer retry-lockout logic (already fixed, owned elsewhere), the chat /
  `chatSeen` code, and every server-side gate — the server remains the only authority on whether a
  submission is allowed.
