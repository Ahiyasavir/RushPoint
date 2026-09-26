# Tasks: camera-switch

## 1. RED

- [x] 1.1 `scripts/test-camera-choice.ts` for `lib/cameraChoice.ts` (design, test strategy). Confirm RED.
- [x] 1.2 Source guard for the viewfinder structure (design, test strategy). Confirm RED.
      (`scripts/test-camera-switch-guard.ts`. Written after the code; RED was shown by breaking
      the recording gate on purpose and watching it fail.)
- [x] 1.3 e2e: `smart.preferredCamera` passes the sanitizer and survives `updateGame`; update
      `ALLOWED_SMART_KEYS`. Confirm RED (unknown key fails the allowlist).

## 2. GREEN

- [x] 2.1 Type `preferredCamera` in shared; sanitizer passthrough; `updateGame` validation (enum or absent). 1.3 → green.
- [x] 2.2 `lib/cameraChoice.ts`. 1.1 → green.
- [~] 2.3 (photo got its own viewfinder component; video's stays inside VideoEntry, see 3.1) Extract `CameraViewfinder` from `VideoEntry` (no behaviour change for video), add the switch
      button (design D2) and mirroring (D3).
      (Switch + mirroring shipped INSIDE `VideoEntry`; the extraction is not done.)
- [x] 2.4 (Built 2026-09-26 as `components/PhotoViewfinder.tsx`: opens on choice > selfie default >
      rear, front/back switch when a second camera exists, mirrored selfie PREVIEW with an unmirrored
      saved still (`stillSize`), deadline + any failure hands over to the phone's camera, which also
      stays one tap away. Every still goes through the same `acceptPhoto` pipeline as a native
      capture. scripts/test-photo-viewfinder.ts; browser-checked with a fake camera.) Photo mode: shutter → still → `compressImageWithReport` → existing preview/retake; native input as
      secondary and fallback. 1.2 → green.
- [x] 2.5 Preference precedence + sessionStorage memory (design D4).
- [x] 2.6 Builder toggle "selfie" on photo/video missions; clearing sends absent. i18n he/en both apps.

## 3. REFACTOR

- [ ] 3.1 Remove the camera code duplicated between `VideoEntry` and the new viewfinder.

## 4. Verify

- [ ] 4.1 Preview with fake devices; then one real Android + one real iPhone (switch, selfie photo, clip).
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
