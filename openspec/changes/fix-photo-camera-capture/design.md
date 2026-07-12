# Design: fix-photo-camera-capture

## Files touched

### 1. `apps/play-web/src/lib/imageResize.ts` (new) — pure resize math + a canvas compressor

```ts
// Pure, dependency-free, unit-testable: given source pixels and a max edge,
// return the target draw size preserving aspect ratio and NEVER upscaling.
export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) {
    return { width: Math.max(0, Math.round(width) || 0), height: Math.max(0, Math.round(height) || 0) };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_JPEG_QUALITY = 0.7;

// Impure (browser-only, verified via preview): decode the File, draw it onto a
// canvas at computeScaledDimensions(), export JPEG at PHOTO_JPEG_QUALITY. Falls
// back to the original File if the browser can't decode/encode (e.g. HEIC in an
// old engine) so capture never hard-fails.
export async function compressImageFile(file: File): Promise<Blob> { /* createImageBitmap → canvas → toBlob */ }
```

- Only `computeScaledDimensions` (+ the two constants) is exercised by the unit test; `compressImageFile`
  touches `createImageBitmap`/`<canvas>`/`toBlob`, so it is verified via the preview tools.

### 2. `apps/play-web/src/components/TaskRunner.tsx` — `PhotoEntry` becomes camera-capture-only

- **Remove** the visible `<input type="file" …>` styling that renders the gallery/file button, and
  **remove** the entire "…or paste a photo URL" `<Input value={url} …>` block plus all `url` state.
- **Keep** a single hidden `<input ref={inputRef} type="file" accept="image/*" capture="environment"
  className="hidden" onChange={pickFile} data-testid="photo-file" />`.
- **Add** a visible `<Button onClick={() => inputRef.current?.click()}>` labelled `t.task.takePhoto`
  (or `t.task.retakePhoto` once a preview exists) — this is the only capture affordance.
- In `pickFile`, after the existing type/size validation, run `compressImageFile(f)` and keep the
  resulting `Blob` (with a derived `File`/filename) as the thing to upload; show the preview from the
  compressed blob. `onSubmit` narrows from `(input: File | string)` to `(file: File)` — no URL branch.
- `canSubmit` no longer references `url`.

### 3. `apps/play-web/src/components/TaskRunner.tsx` — `photo()` handler

- Change signature to `async function photo(file: File)`. Delete the `typeof input === 'string'` branch
  (the pasted-URL path). Always `uploadTaskPhoto(file, …)` then `submitStationPhoto`.
- Map the storage-path backstop error to a friendly message: if `submitError` detects the
  storage-path failure, show `t.task.photoSaveRetry` instead of the raw text.

### 4. `apps/play-web/src/services/firebase.ts` — `uploadTaskPhoto`

- Accept a `Blob` (the compressed output). Force `contentType: 'image/jpeg'` and a `.jpg` extension for
  the compressed path so the object type is deterministic (the storage rule already allows `image/.*`).
  Signature widens to `file: File | Blob`; path/scoping is unchanged (`runs/{runId}/teams/{teamId}/…`).

### 5. `packages/shared/src/validation.ts` — plain-language message

- Reword the `requireStorageUrl` failure (lines 321-324) from the anti-cheat phrasing to plain copy,
  e.g. EN `'That photo could not be saved. Please retake the photo.'` /
  HE `'לא הצלחנו לשמור את התמונה. צלמו שוב.'`. The check itself is unchanged.

### 6. `apps/play-web/src/i18n.ts` — copy

- **Add** `task.takePhoto`, `task.retakePhoto`, `task.photoSaveRetry` (HE + EN, key parity enforced).
- **Remove** `task.pastePhotoUrl` (no longer rendered). Removing a key from BOTH dictionaries keeps
  the `EN: typeof HE` parity intact.

## Test strategy

- **Pure helper (`scripts/test-image-resize.ts`, tsx, no emulator, auto-run by `npm test`):** asserts
  `computeScaledDimensions`:
  - a 4000×3000 source with `maxEdge=1280` → `1280×960` (longest edge clamped, aspect preserved);
  - a portrait 3000×4000 → `960×1280`;
  - an already-small 800×600 is returned unchanged (**never upscaled**);
  - a square 2000×2000 → `1280×1280`;
  - degenerate inputs (0, negative, non-finite) don't throw and never return a negative/NaN dimension.
  RED before `imageResize.ts` exists.
- **UI (preview tools):** on a photo task the only control is **Take Photo** (opens the camera via
  `capture="environment"`); there is **no** gallery/file button styling and **no** URL field; after a
  capture a compressed preview shows and Submit uploads a small (~sub-MB) JPEG; the flow completes
  without the "own team folder" error. Verify Hebrew + English labels switch.
- **i18n:** `npm run i18n:check` clean (new keys are real HE/EN; removed key leaves no dangling `t.*`).

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check`. (No backend callable logic changes, so `npm run e2e` is unaffected; run it if the
shared `validation.ts` message reword needs the full-lifecycle confidence — it stays green either way.)
