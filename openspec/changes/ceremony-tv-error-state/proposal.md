# Ceremony / TV projector: distinguish a fetch error from a not-yet-published run

## Why

The Ceremony and TV projector screens both poll `getPublicLeaderboard` and collapse
**every** non-published outcome to one holding screen. A rejected fetch — most often a
**wrong access code** typed into the projector URL — is treated identically to a run that
simply has not been published yet: both land on "waiting to publish" / "not available yet".

So a projector opened with a bad code sits on "the ceremony begins the moment your host
publishes…" **forever**. It never comes alive, and nobody watching the wall can tell the
screen is broken versus merely early. On a projector there is no console and no operator at
the keyboard — the wrong-code case is silent and permanent.

Confirmed in the source:

- `CeremonyScreen.tsx` — the poll's `catch` does `setData(null)` then reschedules
  (`CeremonyScreen.tsx:54-58`); the holding screen renders on `!published` with no way to
  know an error occurred (`CeremonyScreen.tsx:106-111`).
- `TvLeaderboard.tsx` — the poll's `catch` does `setData(null)` (`TvLeaderboard.tsx:36-38`);
  the "not available yet" screen renders on `!published` (`TvLeaderboard.tsx:67-72`).

## What Changes

- Track a small **error flag** in both screens: set it when `getPublicLeaderboard` rejects,
  clear it on any successful fetch.
- When the holding screen shows **because of an error** (not merely because the run is
  unpublished), render a **distinct, projector-legible error line** ("couldn't load — check
  the code, retrying…") instead of the neutral "waiting to publish" line.
- **Keep polling on error.** A transient network blip self-heals on the next successful
  poll (flag clears, normal holding/live screen returns), and a run genuinely published
  later still comes alive when it publishes.
- Add the error-line copy to both play-web dictionaries (HE + EN), routed through `t.*`.

## What does NOT change

- The **poll cadence** (`POLL_MS` / `REFRESH_MS`) and the poll/reschedule mechanics.
- The **published-run happy path** — the live board and ceremony sequence are untouched.
- The **not-yet-published holding screen** for the ordinary early-open case (no error).
- Server behavior, the published gate, and `getPublicLeaderboard` itself.

## Impact

- Affected screens: `apps/play-web/src/screens/CeremonyScreen.tsx`,
  `apps/play-web/src/screens/TvLeaderboard.tsx`.
- Affected i18n: `apps/play-web/src/i18n.ts` (HE + EN `tv` and `ceremony` blocks).
- UI-only; verified via the play-web UI lane (no component test runner). No callable,
  no server state, no poll-cadence change.
