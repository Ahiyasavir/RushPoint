# photo-capture-ux Specification (delta)

## ADDED Requirements

### Requirement: Photo missions capture from the device camera only
A photo task's capture control SHALL open the device camera directly and MUST NOT offer a gallery/file
picker or a URL/link entry as a means of submitting the image. The participant sees a single "Take
Photo" (or "Retake") action wired to a hidden `<input type="file" accept="image/*"
capture="environment">`; there is no visible file-chooser affordance and no free-text URL field.

#### Scenario: The photo task shows only a camera control
- **WHEN** a participant opens a photo mission in play-web
- **THEN** the only capture affordance is a Take Photo button that requests the camera, and no gallery
  file-picker button or "paste a photo URL" field is present

#### Scenario: A pasted external link can no longer be submitted
- **WHEN** a participant tries to supply a photo for a mission
- **THEN** the client accepts only an image captured through the camera control and provides no path to
  submit an arbitrary URL, so the caller-scoped storage-path check is never reached by a foreign link

### Requirement: Captured photos are downscaled and compressed before upload
The client SHALL downscale a captured image so its longest edge is at most 1280 px (never upscaling) and
re-encode it as JPEG at approximately 0.7 quality before uploading, so a multi-megabyte phone photo is
reduced to a small upload suitable for mobile data. The resize dimension math MUST preserve aspect ratio.

#### Scenario: A large landscape capture is scaled down
- **WHEN** a 4000×3000 image is captured
- **THEN** the uploaded image is drawn at 1280×960 (longest edge clamped to 1280, aspect ratio preserved)
  and encoded as a compressed JPEG

#### Scenario: A small capture is never upscaled
- **WHEN** an image whose longest edge is already at or below 1280 px is captured
- **THEN** its dimensions are left unchanged (the resize never enlarges the image)

### Requirement: Players never see a developer-oriented storage-path error
The photo-submission flow SHALL NOT surface the internal "own team folder" storage-path phrasing to a
participant. The caller-scoped storage-path validation remains as an anti-cheat backstop, but its message
MUST be plain player-facing copy and, in play-web, degrade to a friendly retry prompt.

#### Scenario: A normal capture completes without the confusing error
- **WHEN** a participant captures and submits a photo through the camera control
- **THEN** the image uploads to the team's own folder and the submission succeeds without ever showing a
  "must be uploaded to your own team folder" message

#### Scenario: A backstop failure reads as plain language
- **WHEN** the storage-path backstop rejects a submission
- **THEN** the participant sees a plain retry message (e.g. "That photo could not be saved, please retake
  it") rather than the developer-oriented storage-path text
