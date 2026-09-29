## Why

Field report 2026-09-27 item 16: *"it doesn't let me rotate the screen in the middle of filming."*
Cause: the app is locked to portrait twice: `"orientation": "portrait"` in
`apps/play-web/public/manifest.webmanifest` (installed PWA) and in `twa-manifest.json` (the Play
Store app). The TWA toolchain bakes that value into `AndroidManifest.xml`, and the Screen
Orientation API's `unlock()` only returns to that default, so no runtime code can free it while the
manifests say portrait. Players filming a landscape clip cannot.

## What Changes

- Both manifests declare `"orientation": "any"`.
- While a team plays, the app asks for portrait with `screen.orientation.lock('portrait')` where the
  platform supports it (installed app on Android), so the game screen still behaves as today there.
- While the in-app camera is open (photo or video), the app releases that lock, so the phone can be
  turned, and records the video in the orientation it was filmed in. Closing the camera asks for
  portrait again.
- Where locking is not supported (iPhone, a browser tab), the game screen works in landscape
  without breaking: no page scroll, the mission sheet usable.
- The Play Store app needs a new build (the pending TWA v5) to pick up the manifest change; until
  then the web app and the installed web app get it.

## Capabilities

### New Capabilities
- `capture-orientation`: rotation during capture, portrait during play where supported.

## Non-goals

- A landscape-optimised game layout (it only has to work, not be redesigned for landscape).
- Rotating an already-recorded clip.

## Surfaces

play-web: `manifest.webmanifest`, a pure `lib/orientation.ts` (`orientationIntent(screen, cameraOpen)`)
+ a small hook, the camera components in `TaskRunner`; root `twa-manifest.json`; `PLAY_STORE.md`
note for the rebuild.
