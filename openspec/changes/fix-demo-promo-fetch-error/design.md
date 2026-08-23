## Context

`GamePromoScreen` (`apps/play-web/src/screens/GamePromoScreen.tsx`) tracks the game as
`useState<PublicGame | null | undefined>(undefined)`:

- `undefined` → still loading (renders a spinner, `:59-67`).
- `null` → both "document does not exist" AND "the fetch threw" (`:54-55`), rendered as the terminal
  not-found card (`:69-82`).

The loader effect (`:50-57`) keys on `[gameId]` and guards with an `alive` flag. `startErr` already
demonstrates the local error-flag pattern in this same file (`:20`, `:187-191`) for the instant-play
failure, so an equivalent flag for the load path fits the file's existing shape.

`PlayScreen` (`:335-346`) is the reference recovery shape: on a persistent load failure it shows a
warning glyph, a message, and a "try again" button wired to re-run the fetch, using `t.common.tryAgain`
(already bilingual, `i18n.ts:24` / `:583`).

## Goals / Non-Goals

**Goals:**
- A network blip on the promo screen offers a retry instead of a dead "not found" card.
- A real missing / unpublished game keeps its existing copy and behavior.

**Non-Goals:**
- Auto-retry loops or exponential backoff. One explicit, participant-driven retry is enough for a
  first-impression screen and avoids hammering a truly-missing document.
- Changing the found-game render, instant-play, or share.

## Decisions

### D1 — A separate `loadError` state, distinct from `game === null`

Add `const [loadError, setLoadError] = useState(false)`. In the loader:

- On success: `setGame(snap.exists() ? (snap.data() as PublicGame) : null)` (unchanged), and clear
  `loadError`.
- On rejection: `setLoadError(true)` and leave `game` as-is (do NOT set it to `null`), so the error
  branch is chosen deterministically rather than colliding with the not-found value.

Render precedence:

1. `game === undefined && !loadError` → the existing loading spinner.
2. `loadError` → the NEW error card (message + retry).
3. `game === null` → the existing not-found card (unchanged).
4. otherwise → the found-game content (unchanged).

### D2 — Retry re-runs the load

The loader effect keys on `[gameId]`. Add a `reloadKey` counter to its deps; the retry button does
`setLoadError(false); setGame(undefined); setReloadKey((k) => k + 1)`, which re-enters the loading
state and re-fires the effect. No new fetch code path; the same `getDoc` runs again.

### D3 — Copy

Two new `promo` keys in BOTH dictionaries:

- `promo.loadError` — a short title, e.g. HE "לא הצלחנו לטעון את המשחק" / EN "Couldn't load this game".
- `promo.loadErrorSub` — one line inviting a retry, e.g. HE "בדקו את החיבור ונסו שוב." / EN "Check your
  connection and try again."

The retry BUTTON label reuses `t.common.tryAgain` (no third key). Values contain no em-dashes and no
mixed-language leakage, so PART A stays clean and PART B gains no new hardcoded string.

## Risks / Trade-offs

- **A retry against a genuinely unreachable backend fails again.** Accepted: the participant retries at
  will and the honest error copy stays, which is strictly better than the false "game not found".
- **A real missing game that also happened to blip could now show the retry once before resolving to
  not-found.** Acceptable and self-correcting: the retry re-fetches, `snap.exists() === false`
  resolves, and the not-found card renders.

## Test Strategy

play-web has no component test runner, so this is verified by:

- `npm run i18n:check:strict` for the two new keys (PART A hard gate; zero new PART B warnings).
- `npm run play:build` / `npm run creator:build` / `npm run typecheck` / `npm run lint` green.
- Manual browser verification (flagged, not run here as a gate): open `?game=<id>` with the network
  offline / throttled, confirm the error card + retry appears; restore the network, tap retry, confirm
  the game loads; open a non-existent `?game=nope`, confirm the not-found card still renders.

## RTL / i18n notes

Hebrew is the default language; the `Screen` wrapper and existing promo markup already handle RTL and
`dir="auto"`. Both new strings are routed through `t.promo.*` (no hardcoded literal), Hebrew copy is
Hebrew and English copy is English, and neither contains an em-dash.
