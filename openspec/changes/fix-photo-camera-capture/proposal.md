# Proposal: fix-photo-camera-capture

## Why

The 2026-07-11 family playtest flagged the photo mission as a top P1 problem
(`docs/playtest-2026-07-11-takeaways.md` §P1-1, complaint #1):

1. **Uploads were huge and slow on mobile data.** `PhotoEntry` uploads the raw camera file
   (up to the 12 MB `MAX_PHOTO_BYTES` cap) untouched — a modern phone photo is 4-8 MB, which
   crawls over a cellular/ngrok connection and burns the players' data.
2. **The confusing error `"Photo must be uploaded to your own team folder."` fired 13×.** It is a
   developer-oriented anti-cheat message that a normal player has no way to act on.
3. **The "Take Photo" control is really a file/gallery picker.** The current control is a bare
   `<input type="file" accept="image/*" capture="environment">` *plus a "…or paste a photo URL"
   text field*. On most phones this opens the gallery/file chooser, not the camera, and the
   URL field lets a player paste **any** link — which is exactly the input that trips the
   "own team folder" error (a pasted foreign URL fails the caller-scoped storage-path check).

**Root cause of the confusing error** (`packages/shared/src/validation.ts:319-325`): `requireStorageUrl`
requires the submitted `photoUrl` to start with `runs/{runId}/teams/{uid}/`. A genuine in-app capture
always uploads to exactly that folder (`uploadTaskPhoto`, `apps/play-web/src/services/firebase.ts:133`)
and passes. The **only** way a normal player violates it is the "paste a photo URL" affordance
(`apps/play-web/src/components/TaskRunner.tsx:780-781`), whose string is forwarded verbatim to
`submitStationPhoto` (`TaskRunner.tsx:219-220`). Removing that affordance eliminates the error class;
rewording the remaining message makes the rare backstop case human-readable.

## What Changes

- **Camera-capture-only control.** Replace the visible file-input + URL field with a single
  **"Take Photo" / "Retake"** button that opens a hidden `<input type="file" accept="image/*"
  capture="environment">`. Drop the gallery/file-picker affordance and **remove the "paste a photo
  URL" field entirely**. The photo `onSubmit` no longer accepts a raw URL string.
- **Client-side downscale + compression before upload.** After capture, draw the image onto a canvas
  scaled so its longest edge is ≤ **1280 px** (never upscale), re-encode as **JPEG quality ~0.7**, and
  upload that blob. Typical result: a multi-MB capture becomes ~150-400 KB. A pure helper
  `computeScaledDimensions(w, h, maxEdge)` owns the resize math and is unit-tested.
- **Plain-language error.** Reword the `requireStorageUrl` failure message from the anti-cheat
  phrasing to plain player-facing copy, and map it in the play-web client to a friendly `t.*` string
  so a stray backstop hit reads as "Could not save that photo, please retake it."

## Non-goals

- No change to `submitStationPhoto`'s signature, the storage path scheme, or the
  caller-scoped security check itself (it stays as the anti-cheat backstop; only its message changes).
- No change to the audio-mission capture path (`AudioEntry`/`uploadTaskAudio`) beyond what it already does.
- No server-side image processing or thumbnailing; compression is client-side only.
- No change to `storage.rules` / `firestore.rules`.

## Capabilities

### New Capabilities
- `photo-capture-ux`: the photo mission captures from the device camera only (no gallery, no file
  picker, no URL entry), compresses the image on-device before upload, and never surfaces a
  developer-oriented storage-path error to a player.

## Impact

- **Surfaces touched:** play-web (`components/TaskRunner.tsx` `PhotoEntry` + `photo()` handler,
  `services/firebase.ts` `uploadTaskPhoto`, `i18n.ts` new/removed keys), a new pure helper
  (`apps/play-web/src/lib/imageResize.ts` — `computeScaledDimensions`), shared
  (`packages/shared/src/validation.ts` message reword).
- **Callables affected:** none by signature; `submitStationPhoto` receives a smaller, always-team-scoped
  URL and effectively never returns the storage-path `invalid-argument` for a normal capture.
- **Tests:** pure-logic (`scripts/test-image-resize.ts`) for `computeScaledDimensions`; UI verified via
  the preview tools (camera capture, downscale, no gallery/URL affordance); i18n gate for the copy.
