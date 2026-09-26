## Decisions

### D1: one viewfinder for photo and video

Extract `VideoEntry`'s fullscreen camera mode into `CameraViewfinder({ mode: 'photo' | 'video', … })`.
Photo mode: the shutter grabs a frame from the live `<video>` into a canvas at the track's native
size (`ImageCapture.takePhoto()` where available, canvas fallback) and hands the blob to the EXISTING
`compressImageWithReport` pipeline, so size caps and the 1280 px edge are unchanged. Quality is not
lost in practice: every photo is already downscaled to 1280 px before upload
(`lib/imageResize.ts`, `PHOTO_MAX_EDGE`), and the viewfinder asks for `ideal` 1920×1080.

The native input stays, reachable as a secondary "use the phone's camera" and as the automatic path
when `getUserMedia` is missing, refused, or does not answer within the camera-open deadline
(`media-upload-reliability` D5).

### D2: switching

`lib/cameraChoice.ts` (pure): given `enumerateDevices()` output and the current track settings,
decide whether a switch is possible (≥ 2 `videoinput`) and what to request next:
- if labels are available and identify front/back, request that `deviceId`;
- else request `facingMode: { exact: next }` first, and on `OverconstrainedError` fall back to cycling
  `deviceId`s. (`exact` is used only for the switch, because a switch that silently returns the same
  camera is a dead button; the initial open stays `ideal`.)
Before requesting the new stream, stop the old tracks: iOS allows one camera at a time.
The switch button is shown only when a switch is possible, and hidden (not disabled) while
recording.

### D3: mirroring

Front camera (`track.getSettings().facingMode === 'user'`, or the choice from D2): the preview
`<video>` gets `-scale-x-100` (static class). The captured still is drawn unmirrored, and the
recorded clip is the raw track; players see themselves as in a mirror and send what others see,
the same behaviour as the system camera.

### D4: the creator's default and the player's memory

`smart.preferredCamera` (`'front'` for selfie missions) sets the initial facing; absent means rear.
The player's last explicit choice is kept in `sessionStorage` per run (try/catch, fail to default)
and wins over the default for later missions, because a group that turned the camera around for
themselves usually keeps doing so.

Builder: a toggle "selfie (opens the front camera)" on photo and video missions. It is inside
`stages`, which the Builder saves wholesale, so `BUILDER_EDITABLE_FIELDS` is unaffected; confirm a
cleared toggle is sent ABSENT, not `null` (the `buildSavePayload` undefined rule).

## Test strategy

- Pure (`scripts/test-camera-choice.ts`): switch possible/impossible, labelled vs unlabelled devices,
  the `exact`→cycle fallback plan, mirroring verdict, preference precedence (explicit choice >
  task default > rear), storage unavailable.
- Source guard: `PhotoEntry` renders `CameraViewfinder` as the primary path and keeps the native
  input as a fallback; the switch button is not rendered while `recording`.
- e2e: the sanitizer passes `smart.preferredCamera` through (update `ALLOWED_SMART_KEYS`), and
  `updateGame` accepts/clears it.
- UI via preview on a laptop with two cameras (or Chrome's fake devices:
  `--use-fake-device-for-media-stream`), then on a real Android and a real iPhone: switch before a
  video, take a selfie photo, confirm the saved photo is not mirrored.
