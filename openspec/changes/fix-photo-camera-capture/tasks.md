# Tasks: fix-photo-camera-capture

## 1. RED
- [ ] Add `scripts/test-image-resize.ts` asserting `computeScaledDimensions`: 4000×3000 @1280 → 1280×960;
      3000×4000 → 960×1280; 800×600 unchanged (no upscale); 2000×2000 → 1280×1280; degenerate
      (0/negative/non-finite) inputs never throw and never yield a negative/NaN dimension. Confirm RED
      (helper does not exist yet).

## 2. GREEN
- [ ] Add `apps/play-web/src/lib/imageResize.ts` with `computeScaledDimensions`, `PHOTO_MAX_EDGE=1280`,
      `PHOTO_JPEG_QUALITY=0.7`, and `compressImageFile(file)` (canvas resize → JPEG blob, original-file
      fallback on decode/encode failure). Test goes GREEN.
- [ ] `TaskRunner.tsx` `PhotoEntry`: hide the file input, add a `t.task.takePhoto`/`t.task.retakePhoto`
      Button that clicks it, remove the "paste a photo URL" `<Input>` + all `url` state, run
      `compressImageFile` in `pickFile`, preview + submit the compressed blob. `onSubmit: (file: File)`.
- [ ] `TaskRunner.tsx` `photo()`: narrow to `(file: File)`, delete the URL branch, always upload the
      compressed file; map the storage-path backstop error to `t.task.photoSaveRetry`.
- [ ] `services/firebase.ts` `uploadTaskPhoto`: accept `File | Blob`, force `image/jpeg` + `.jpg` for the
      compressed path (unchanged team-scoped path).
- [ ] `packages/shared/src/validation.ts`: reword the `requireStorageUrl` failure to plain player copy.
      `npm run shared:build`.
- [ ] `apps/play-web/src/i18n.ts`: add `task.takePhoto`, `task.retakePhoto`, `task.photoSaveRetry` (HE+EN);
      remove `task.pastePhotoUrl`.

## 3. VERIFY (gates)
- [ ] `npm run typecheck` green.
- [ ] `npm test` green (image-resize helper passes).
- [ ] `npm run lint` green.
- [ ] `npm run creator:build` green.
- [ ] `npm run play:build` green.
- [ ] `npm run i18n:check` clean (PART A hard gate; no new PART B findings from the touched lines).
- [ ] Preview check: photo task shows only a Take Photo camera control (no gallery button, no URL field),
      captures + compresses to a small JPEG, submits without the "own team folder" error, HE/EN labels switch.
