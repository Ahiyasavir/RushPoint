## Why

Each located task in the participant TaskRunner renders **two competing map-provider links
side-by-side** in `NavigateHereLink` (`apps/play-web/src/components/TaskRunner.tsx`): a Waze link
(`🧭 {t.task.navigateHere}`, `text-ink-fire`) leads, with a Google Maps link
(`{t.task.navigateMaps}`, `text-zinc-500`) demoted next to it. Two links for the same action
("take me there") is visual noise on a card meant to be scanned one-handed while walking, and the
link that leads is the **wrong** one: RushPoint is a **walking** field game, but Waze is a
driving-oriented navigator. A walker wants **walking directions**, which Google Maps provides
properly; the current Google Maps link is also a plain pin (`?q=`), so it opens a dropped pin, not
walking directions.

## What Changes

- Lead with **one primary** navigation link — **Google Maps in walking mode** (`🧭 Navigate here`) —
  as the single weighted control, because a walker at a walking event wants walking directions.
- Build the Google Maps URL as a **walking-mode directions link** (`.../maps/dir/?api=1&destination=
  <lat>,<lng>&travelmode=walking`) instead of the current bare pin (`?q=<lat>,<lng>`), so the app
  opens in walking navigation, not a dropped pin.
- **Demote Waze** to a clearly subordinate, compact secondary affordance so only one link carries
  visual weight, instead of two co-equal side-by-side links. Both remain a single tap away.

## What does NOT change

- **Both providers stay reachable in one tap.** Google Maps (walking) is the primary link; Waze
  remains available as the demoted secondary. Ability preserved: navigating with either provider —
  only which one leads and the Google Maps travel mode change.
- **`navigationTarget()` still owns whether a link may appear** — a hidden-location task (whose
  coordinates are the puzzle answer) still gets no handoff. This change never touches that gate; it
  only restyles the two links and changes the Google Maps URL mode when a target exists.
- **No handler/behavior change beyond the URL mode and which link leads.** The Waze URL is
  unchanged; the distance badge is unchanged; both `data-testid`s (`task-navigate-waze` /
  `task-navigate-maps`) stay on their links.
- **No new i18n strings.** Reuses `task.navigateHere` / `task.navigateMaps` / `task.navigateAria`.

## Impact

- `apps/play-web` — `src/components/TaskRunner.tsx` (`NavigateHereLink` only: flip which link leads,
  restyle to one primary + one subordinate secondary) and `src/lib/navigateTo.ts` (`googleMapsUrl`
  emits the walking-mode directions URL).
- **Not touched:** `functions/`, `packages/shared`, `apps/creator-web`, `src/i18n.ts` (existing keys
  reused), `navigationTarget` / `wazeUrl` helpers.
