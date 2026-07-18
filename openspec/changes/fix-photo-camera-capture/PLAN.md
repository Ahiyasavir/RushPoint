# Implementation Plan — fix-photo-camera-capture

Precise, file-by-file plan. No source is edited by this change proposal; this is the build recipe.

## Root cause of the confusing "own team folder" error

`packages/shared/src/validation.ts:303-327` — `requireStorageUrl(url, runId, uid)`:

```ts
// line 319-325
const expected = `runs/${runId}/teams/${uid}/`;
if (!objectPath || !objectPath.startsWith(expected)) {
  fail('photoUrl', 'storagePath', [
    'Photo must be uploaded to your own team folder.',   // <-- line 322, shown to players
    'יש להעלות את התמונה לתיקיית הקבוצה שלכם.',            // <-- line 323
  ]);
}
```

Called from `functions/src/index.ts:843`:
`validate(() => requireStorageUrl(photoUrl, runId, uid));`

A genuine in-app capture always uploads to exactly `runs/{runId}/teams/{teamId}/…`
(`apps/play-web/src/services/firebase.ts:133`) and the controller's `teamId === uid`, so it passes.
The **only** normal-player way to violate the check is the "…or paste a photo URL" text field
(`apps/play-web/src/components/TaskRunner.tsx:780-781`), whose raw string is forwarded verbatim to
`submitStationPhoto` by the `photo()` handler (`TaskRunner.tsx:219-220`):

```ts
if (typeof input === 'string') {
  url = input;          // pasted URL goes straight through — fails requireStorageUrl → invalid-argument
}
```

**Fix:** delete the URL affordance + the string branch (removes the error class entirely) and reword the
backstop message at `validation.ts:322-323` to plain copy. The security check itself is unchanged.

## File 1 (NEW) — `apps/play-web/src/lib/imageResize.ts`

```ts
export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_JPEG_QUALITY = 0.7;

export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxEdge)
      || width <= 0 || height <= 0 || maxEdge <= 0) {
    const w = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
    const h = Number.isFinite(height) && height > 0 ? Math.round(height) : 0;
    return { width: w, height: h };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function compressImageFile(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = computeScaledDimensions(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', PHOTO_JPEG_QUALITY));
    return blob ?? file;      // fallback keeps capture working on decode/encode failure
  } catch {
    return file;
  }
}
```

## File 2 (NEW) — `scripts/test-image-resize.ts` (RED first)

tsx assertion script, picked up by `scripts/run-unit-tests.mjs` / `npm test`. Assertions:

```ts
import { computeScaledDimensions } from '../apps/play-web/src/lib/imageResize';
import assert from 'node:assert/strict';

assert.deepEqual(computeScaledDimensions(4000, 3000, 1280), { width: 1280, height: 960 });
assert.deepEqual(computeScaledDimensions(3000, 4000, 1280), { width: 960, height: 1280 });
assert.deepEqual(computeScaledDimensions(800, 600, 1280),  { width: 800, height: 600 });   // no upscale
assert.deepEqual(computeScaledDimensions(2000, 2000, 1280), { width: 1280, height: 1280 });
for (const d of [computeScaledDimensions(0, 0, 1280), computeScaledDimensions(-5, 10, 1280),
                 computeScaledDimensions(4000, 3000, 0), computeScaledDimensions(NaN, 3000, 1280)]) {
  assert.ok(d.width >= 0 && d.height >= 0 && Number.isFinite(d.width) && Number.isFinite(d.height));
}
console.log('image-resize: OK');
```

(Confirm the aggregator's discovery pattern for `scripts/test-*.ts` and match it; add an explicit entry
if the runner uses a manifest.)

## File 3 — `apps/play-web/src/components/TaskRunner.tsx`

`PhotoEntry` (currently 736-787). Before/after:

- **Remove** the visible file `<input>` classes (776-777) → make it hidden + ref-clicked.
- **Remove** the URL `<Input>` block (780-781) and all `url` state (739, 770, 773, 780).
- **Add** `const inputRef = useRef<HTMLInputElement>(null);` and a visible Button.

After (shape):
```tsx
function PhotoEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (file: File) => void }) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState('');
  // …prevPreviewRef / setPreviewUrl / unmount cleanup unchanged…

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileErr('');
    const f = e.target.files?.[0] ?? null;
    if (f && !f.type.startsWith('image/')) { setFileErr(t.task.chooseImage); e.target.value=''; setFile(null); setPreviewUrl(null); return; }
    if (f && f.size > MAX_PHOTO_BYTES)     { setFileErr(t.task.imageTooLarge({ mb: Math.round(MAX_PHOTO_BYTES/1024/1024) })); e.target.value=''; setFile(null); setPreviewUrl(null); return; }
    if (!f) { setFile(null); setPreviewUrl(null); return; }
    const blob = await compressImageFile(f);
    const compressed = new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
    setFile(compressed);
    setPreviewUrl(URL.createObjectURL(compressed));
    e.target.value = '';
  }

  const canSubmit = !busy && !fileErr && !!file;
  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
             onChange={pickFile} data-testid="photo-file" className="hidden" />
      <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()} data-testid="photo-take">
        {file ? t.task.retakePhoto : t.task.takePhoto}
      </Button>
      {fileErr && <p className="text-rp-alert text-sm">{fileErr}</p>}
      {preview && <img src={preview} alt={t.task.photoPreview} className="w-full rounded-lg max-h-56 object-cover" />}
      <Button disabled={!canSubmit} onClick={() => file && onSubmit(file)} data-testid="photo-submit">
        {busy ? t.task.working : t.task.submitPhoto}
      </Button>
    </div>
  );
}
```

`photo()` handler (currently 213-231). Before/after:
```tsx
async function photo(file: File) {                    // was (input: File | string)
  if (blockedOffline()) return;
  setBusy(true); setMsg('');
  try {
    setMsg(t.task.uploadingPhoto);
    const url = await uploadTaskPhoto(file, { runId: session.runId, teamId: state.team.id, taskId: task!.id });
    const res = await submitStationPhoto({ ...ctx, teamId: state.team.id, taskId: task!.id, photoUrl: url });
    setMsg(res.autoApproved ? t.task.approved : t.task.pendingReview);
    onChanged();
  } catch (e) {
    setMsg(isStoragePathError(e) ? t.task.photoSaveRetry : submitError(e, t.task.uploadFailed));
  } finally { setBusy(false); }
}
```
Add a small `isStoragePathError(e)` guard (matches the reworded message / `invalid-argument` + `photoUrl`
field) near `submitError`. Add `compressImageFile` to the existing import from `../lib/imageResize`.
`<PhotoEntry … onSubmit={photo} />` at 386 is unchanged (prop type narrows automatically).

## File 4 — `apps/play-web/src/services/firebase.ts` (`uploadTaskPhoto`, 126-137)

```ts
export async function uploadTaskPhoto(
  file: File | Blob,
  p: { runId: string; teamId: string; taskId: string },
): Promise<string> {
  await ensureAuth();
  const safeTask = p.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `runs/${p.runId}/teams/${p.teamId}/${safeTask}-${Date.now()}.jpg`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: 'image/jpeg' });
  return getDownloadURL(r);
}
```
(Compressed output is always JPEG; the `image/.*` storage-rule match still allows it.)

## File 5 — `packages/shared/src/validation.ts` (322-323 reword)

```ts
fail('photoUrl', 'storagePath', [
  'That photo could not be saved. Please retake the photo.',
  'לא הצלחנו לשמור את התמונה. צלמו שוב.',
]);
```
Then `npm run shared:build`. No logic change.

## File 6 — `apps/play-web/src/i18n.ts`

- **Add** to `task` in BOTH `he` and `en` (parity enforced by `EN: typeof HE`):
  - HE `takePhoto: 'צלמו תמונה'`, `retakePhoto: 'צלמו שוב'`, `photoSaveRetry: 'לא הצלחנו לשמור את התמונה. צלמו שוב.'`
  - EN `takePhoto: 'Take Photo'`, `retakePhoto: 'Retake'`, `photoSaveRetry: 'That photo could not be saved, please retake it.'`
- **Remove** `pastePhotoUrl` from both `he` (148) and `en` (584) — no longer referenced.

## Gate list (all must pass before done)

- `npm run typecheck`
- `npm test`  (new `scripts/test-image-resize.ts` green)
- `npm run lint`
- `npm run creator:build`
- `npm run play:build`
- `npm run i18n:check`  (PART A hard gate; touched lines add no PART B findings)
- `npm run e2e`  — not strictly required (no callable logic change), but run it once because
  `packages/shared/validation.ts` is on the submitStationPhoto path; expect it to stay green.
- Preview verification: camera-only control, downscaled sub-MB upload, no "own team folder" error,
  HE/EN labels switch.
