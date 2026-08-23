## Context

`DistanceBadge` (`apps/play-web/src/components/TaskRunner.tsx`) is the only wayfinding affordance a
participant has beyond a 208px static map. It already computes the exact thing a navigation link
needs, and already guards it correctly:

```ts
const coords = task.locationless ? undefined : (task.smart?.stationCoords ?? task.coordinates);
// …
if (!navigator.geolocation || !coords
  || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)
  || (!coords.lat && !coords.lng)) return;
```

Two facts make the hidden-location case the whole design problem:

1. **A sealed hidden-location task carries no coordinates at all.** `sanitizeTaskForParticipant`
   returns a stub before it ever reaches the passthrough, so `task.coordinates` is genuinely absent
   on the client — nothing to leak.
2. **A revealed hidden-location task DOES carry coordinates.** After `reportArrival` latches
   `arrivedAt`, the server deliberately releases them (`sanitizeTask.ts`, "wave D product decision")
   so the map can pin the spot. The task keeps `locationHidden: true` so the client still tells the
   treasure-hunt story — and `TaskRunner` renders the clue box *instead of* `DistanceBadge` in that
   branch.

So a naive "render a link wherever coordinates exist" would be safe today only because of where the
badge happens to sit in the JSX. That is exactly the kind of implicit safety that breaks the next
time someone moves the markup. The decision is therefore lifted into a pure, tested function that
refuses on `locationHidden` explicitly.

## Goals / Non-Goals

**Goals**
- A participant can hand the current task's location to Waze or Google Maps in one tap.
- The suppression rule is explicit, pure, tested, and fails closed.

**Non-Goals**
- No in-app routing, no platform sniffing, no app-store deep links.
- No hand-off from the run map or completed-task pins.
- No server change of any kind.

## Decisions

### D1 — `lib/navigateTo.ts` owns the decision; `TaskRunner` only renders it

```ts
export interface NavTarget { lat: number; lng: number }

/** The coordinates it is legitimate to hand to a navigation app, or null. */
export function navigationTarget(task: NavigableTask | null | undefined): NavTarget | null;
export function wazeUrl(target: NavTarget): string;
export function googleMapsUrl(target: NavTarget): string;
```

`NavigableTask` is a **structural minimum** — `{ locationHidden?, arrivalPending?, locationless?,
coordinates?, smart? }` — not `SafeTask`. That keeps the module free of the services layer, keeps
the test script free of Firebase types, and means a future caller (a map popup, a stage overview)
can reuse it without widening anything.

`navigationTarget` returns `null` when **any** of these holds, checked in this order:

1. the task is missing;
2. `task.arrivalPending` is truthy — the server has not confirmed arrival, so the location is still
   secret by definition;
3. `task.locationHidden` is truthy — the coordinates ARE the puzzle answer. This is checked even
   though a revealed hidden task legitimately has coordinates: a treasure hunt where the app can
   navigate you to the treasure is not a treasure hunt, and the check must not depend on where the
   caller happens to render it;
4. `task.locationless` is truthy — there is no place to go;
5. the resolved coordinates (`task.smart?.stationCoords ?? task.coordinates`) are absent, either
   axis is not a finite number, or **both** are exactly `0` (the classic "null island" default that
   a half-filled Builder form produces).

Rule 5 mirrors `DistanceBadge`'s existing guard exactly, so the badge and the link can never
disagree about whether a task has a usable location.

*Alternative rejected:* an allow-list keyed on `task.type`. Location secrecy is orthogonal to task
type — a `quiz` can hide its location and a `field` task can be locationless — so a type table would
be wrong in both directions.

### D2 — Waze primary, Google Maps secondary, both plain https
`https://waze.com/ul?ll=<lat>,<lng>&navigate=yes` and `https://www.google.com/maps?q=<lat>,<lng>`.
Both are ordinary https URLs the OS hands to an installed app when there is one, and both degrade to
the web in a desktop browser. `rel="noreferrer"` (matching `StaffConsole.tsx:337-344`) also keeps
the referrer — which on this app can contain the run's access code — out of the third-party request.

Coordinates are emitted with `Number(...)` already validated by `navigationTarget`, so no
string from the task can reach the URL: the functions take a `NavTarget`, not a task.

*Alternative rejected:* a `geo:` URI. It is the "correct" scheme but resolves to nothing on iOS
Safari and to a chooser dialog on Android, which is worse for a person walking.

### D3 — Rendering: a sibling of `DistanceBadge`, inside the same non-hidden branch
`DistanceBadge` returns `null` until it has a distance fix, so the link cannot live inside it — a
player with GPS still warming up needs the link most. `TaskRunner` renders
`<NavigateHereLink task={task} />` immediately after `<DistanceBadge task={task} />` in the
`else` branch of the `task.locationHidden` conditional (belt and braces with D1's rule 3).

`NavigateHereLink` calls `navigationTarget` and renders nothing on `null`. Markup: an `<a>` with the
44px minimum tap target (`min-h-[44px]`, matching the sibling `play-touch-rtl-a11y` change), the
Waze destination as its `href`, and a smaller Google Maps `<a>` beside it. Copy comes from
`t.task.navigateHere` / `t.task.navigateMaps`; the group carries `aria-label` from
`t.task.navigateAria`.

## Risks / Trade-offs

- **[A future refactor moves the badge and re-exposes a hidden task]** → rule 3 makes the function
  itself refuse, so the safety no longer depends on JSX placement. The test asserts the revealed
  hidden case explicitly, not just the sealed one.
- **[Leaving the app mid-run]** → `target="_blank"`, so the game keeps running in its own tab and
  the offline-hardened PWA shell is not torn down.
- **[Handing a player straight to the destination reduces the challenge]** → intended for ordinary
  located tasks, which is why hidden-location tasks are excluded: those are the ones where finding
  the place IS the game.

## Migration Plan

Pure client change; no data migration, no index, no rule, no env var. Rollback is a revert of the
listed files.

## Test Strategy

**Pure logic — first, and RED before anything else.** New `scripts/test-navigate-handoff.ts`
(plain `tsx` assertion script, auto-collected by `scripts/run-unit-tests.mjs`, following
`scripts/test-failure-visibility.ts` as the house pattern). Asserted against `lib/navigateTo.ts`:

*Suppression (the security half — each must yield `null`):*
- `{ locationHidden: true, coordinates: { lat: 31.77, lng: 35.21 } }` — a **revealed** hidden task
  that really does carry coordinates. This is the case that proves the rule is not accidental.
- `{ arrivalPending: true, coordinates: {...} }` — sealed / arrival still pending.
- `{ locationless: true, coordinates: {...} }`
- `{}` and `{ coordinates: undefined }` — no coordinates at all.
- `{ coordinates: { lat: NaN, lng: 35.2 } }`, `{ lat: 31.7, lng: Infinity }`,
  `{ lat: '31.7', lng: 35.2 }` (wrong type) — non-finite / non-numeric.
- `{ coordinates: { lat: 0, lng: 0 } }` — null island.
- `null` / `undefined` task — total, no throw.
- A combined case: `{ locationHidden: true, smart: { stationCoords: {...} } }` — the station path
  must not bypass the hidden rule.

*Allowed:*
- `{ coordinates: { lat: 31.7767, lng: 35.2345 } }` → that exact pair.
- `{ coordinates: {...}, smart: { stationCoords: { lat: 32.08, lng: 34.78 } } }` → the **station**
  coordinates win.
- `{ coordinates: { lat: 0, lng: 35.2 } }` and `{ lat: 31.7, lng: 0 }` → allowed (a single zero axis
  is a real place; only the (0,0) pair is the sentinel).
- Negative coordinates round-trip unchanged.

*URLs:*
- `wazeUrl` contains both numbers and `navigate=yes`; `googleMapsUrl` carries `q=<lat>,<lng>`.
- **Leak guard:** for a task carrying a title, clue, hint and answers, neither URL contains any of
  those substrings — the URL builders take a `NavTarget`, so this is structural, and the test
  encodes it so a future signature change fails loudly.

Confirm the script **fails** (module missing) before writing `lib/navigateTo.ts`.

**UI.** `npx tsc --noEmit` in `apps/play-web`, plus `npm run i18n:check` for the three new keys.

**Not run:** `npm run e2e` (no callable/payload/server behavior; the emulator must not be started).
Repo-wide `typecheck` / `lint` / `test` / `creator:build` / `play:build` are run once by the
orchestrator at the end of the wave.

## Open Questions

None.
