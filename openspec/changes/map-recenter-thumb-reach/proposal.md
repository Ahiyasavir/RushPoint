# Move the play-map recenter control to a thumb-reachable bottom corner

## Why

On the participant play screen, the map's "focus back on me" (recenter) button is
pinned to the hard-to-reach **top** corner (`absolute top-14 start-2` in
`apps/play-web/src/components/NavMap.tsx`). A walking participant holds the phone
one-handed and taps this control a lot — reframing the map on their own dot after
every stray drag. A top-corner control forces a hand shift or a two-handed grip on
a tall phone. The thumb naturally rests near the **bottom** of the screen, so the
most-tapped map control belongs in a bottom corner.

## What Changes

- Move the recenter button from the top corner to a thumb-reachable **bottom**
  corner: change the Tailwind position class `top-14` → `bottom-14` on the button,
  keeping the logical inline edge `start-2` so it still mirrors correctly in Hebrew
  (RTL default). `bottom-14` sits one row **above** the `bottom-2` map attribution
  and the `bottom-2` search-area legend, so it clears both.

## What does NOT change

- No handler, verdict, or logic change — `recenter()` / `recenterVerdict()` and the
  disabled/aria states are untouched.
- RTL behaviour is preserved (still a **logical** inline edge, `start-2`).
- No i18n change — same `t.play.recenter` / `t.play.recenterNoFix` strings.

## Impact

- `apps/play-web/src/components/NavMap.tsx` only (one position class). Presentation
  only; no callable, no shared type, no build wiring.
