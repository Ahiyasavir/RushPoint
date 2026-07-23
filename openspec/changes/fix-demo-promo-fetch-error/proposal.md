## Why

`GamePromoScreen` is the flagship acquisition funnel's first impression: the logged-out demo button
sends a stranger to `?game=<id>` and this screen loads the public game
(`openspec/changes/flagship-instant-demo/`). Its loader collapses a network failure into the same state
as a genuinely missing game (`apps/play-web/src/screens/GamePromoScreen.tsx:50-57`):

```ts
getDoc(doc(db, FIRESTORE_PATHS.publicGame(gameId)))
  .then((snap) => { if (alive) setGame(snap.exists() ? (snap.data() as PublicGame) : null); })
  .catch(() => { if (alive) setGame(null); });
```

A transient fetch rejection sets `game = null`, the SAME value as "this game does not exist / is not
public", so the not-found branch (`:69-82`) renders "Game not found / This game isn't public yet" with
only an "Enter a code" button. A first-ever visitor on flaky mobile data is told the sample game does
not exist and is given no way to retry, on the single most important surface for turning a stranger
into a creator.

## What Changes

- The loader SHALL distinguish a fetch ERROR from a successful "document does not exist". A load error
  gets its own state, separate from `game === null`.
- On the error state the screen SHALL render a distinct error card with a RETRY control that re-runs
  the load, instead of the terminal not-found card. (This is the recovery shape `PlayScreen` already
  uses at `PlayScreen.tsx:335-346`.)
- A genuine missing / unpublished game (`snap.exists() === false`) SHALL keep the existing not-found
  copy and the "Enter a code" affordance, unchanged.

## What does NOT change

- The not-found copy and behavior for a real missing / unpublished game.
- Instant-play (`playNow` / `startInstantPlay`), share, and every rendered detail for a found game.
- No server change; the loader still reads the same `publicGame` document.

## Impact

- Affected specs: `game-promo-resilience` (new capability, one requirement ADDED).
- Affected code: `apps/play-web/src/screens/GamePromoScreen.tsx` (error state + retry),
  `apps/play-web/src/i18n.ts` (two new `promo` keys in HE + EN; the retry label reuses
  `t.common.tryAgain`).
- NOT touched: the callable layer, `store`, and the not-found path for a real missing game.
