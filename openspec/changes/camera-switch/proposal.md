## Why

Field report 2026-09-25: *"there is no button to flip the camera when filming video or taking a
photo"*. Selfie missions ("צלמו סלפי מנצח", the seeded demo's own last mission) need the front
camera, and a group filming itself needs to flip before it starts.

- **Video**: the in-app viewfinder opens `getUserMedia({ video: CAPTURE_VIDEO_CONSTRAINTS })` with
  `facingMode: { ideal: 'environment' }` (`apps/play-web/src/lib/videoCapture.ts`) and renders no
  switch control (`TaskRunner.tsx`, `VideoEntry`, camera mode).
- **Photo**: a hidden `<input type="file" accept="image/*" capture="environment">` hands off to the
  phone's camera app (`PhotoEntry`). The obvious fix, a front/back toggle setting
  `capture="user"`, **does not work on Chromium for Android**: those browsers do not honour the
  capture value when choosing a camera (MDN browser-compat-data issue #19603), and Chrome/Edge on
  Android 14–15 have further known quirks around the camera option of file inputs (Addpipe, "Android
  14 & 15 file inputs"). The camera app may or may not show its own flip button in intent mode, which
  is outside our control and matches "there is no button".

## What Changes

- Photo missions open the SAME in-app viewfinder video missions use, with a shutter that takes a
  still, a camera-switch button, and a preview with retake. The phone's own camera app remains
  available as "use the phone's camera" and as the automatic fallback wherever the in-app camera
  cannot open.
- Video missions get the camera-switch button in the viewfinder before recording starts.
- The front camera's preview is mirrored like every phone camera; the saved picture and clip are
  not.
- A creator can mark a mission "selfie" so it opens on the front camera.
- The last camera a player chose is remembered on that phone for the rest of the run.

## Non-goals

- Switching cameras DURING a recording (MediaRecorder cannot follow a replaced track; would need
  canvas re-encoding, rejected for battery and heat).
- Gallery upload for photo missions (unchanged decision of `fix-photo-camera-capture`).
- Zoom, torch, filters.

## Surfaces

- play-web: `components/TaskRunner.tsx` (PhotoEntry, VideoEntry, a shared `CameraViewfinder`), `lib/videoCapture.ts`, new pure `lib/cameraChoice.ts`, `i18n.ts`.
- shared types: `TaskSmartConfig.preferredCamera?: 'rear' | 'front'`; the participant sanitizer passes it through (not secret); `scripts/e2e-verify.mjs` `ALLOWED_SMART_KEYS` gains it.
- creator-web: the photo/video mission editor gets a "selfie (front camera)" toggle; i18n.
