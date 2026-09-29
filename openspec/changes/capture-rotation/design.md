## Decisions

### D1: manifests say "any"; the code asks for portrait

`orientationIntent({ screen: 'game' | 'other', cameraOpen })` → `'portrait' | 'free'` (pure).
`useOrientationIntent` calls `screen.orientation?.lock?.('portrait')` for `portrait` and
`screen.orientation?.unlock?.()` for `free`, each in try/catch, ignoring the rejected promise
(unsupported / not installed / not fullscreen are all "fine, do nothing"). Never throws, never
blocks capture.

### D2: capture follows the phone

The video viewfinder reads `screen.orientation.type` (fallback `matchMedia('(orientation:
landscape)')`) and swaps the requested track aspect; the recorder keeps the track's real
dimensions (no forced 9:16 canvas). The photo `capture` input needs nothing (the OS camera rotates).

### D3: landscape does not break the game screen

With `play-screen-no-scroll` the screen is `100dvh` and the sheet heights are computed from the
viewport, so landscape is covered by the same snap maths (`peek` clamps to 40 % of a short viewport).

## Test strategy

- **Pure** `scripts/test-orientation-intent.ts` (truth table) and a manifest guard in the same
  file: both manifests declare `any` (fails if someone restores `portrait`).
- **UI** preview: resize to 740×360 on the game screen (no page scroll, sheet usable) and with the
  camera open; Android device check noted for after the TWA rebuild.
