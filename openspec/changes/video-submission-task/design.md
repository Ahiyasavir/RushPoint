## Context

`audio-tasks` (already shipped — see `packages/shared/src/mediaKinds.ts`,
`SmartStationConfig.captureKind`, `AudioEntry` in `TaskRunner.tsx`) established the pattern
this change follows: a photo-type task's `captureKind` selects a different capture widget
and content-type gate, riding the exact same `submitStationPhoto` → pending/auto-approve →
`completeTaskForTeam` pipeline. No new task type, no new callable.

One thing has changed since `audio-tasks` was designed: media no longer goes through
Firebase Storage / `storage.rules` at all. Per `vps-upload-route`, uploads go client → the
self-hosted IONOS VPS via `PUT /upload` in `functions/server.js`, which enforces its own
`ALLOWED_CONTENT_TYPES` regex and `MAX_PARTICIPANT_BYTES` / `MAX_CREATOR_BYTES` caps, then
writes to local disk. This design targets that real system, not `storage.rules` (which is
effectively unused for these paths now).

This change explicitly depends on `stream-upload-write` having landed: that change makes
`/upload`'s memory use independent of file size, which is required before raising the
participant cap for video (today's `MAX_PARTICIPANT_BYTES = 10MB` is sized for photos/short
audio, not video).

## Goals / Non-Goals

**Goals:**
- A creator can select "Video" as a photo-task's capture kind, exactly like today's
  Photo/Audio choice, and can set a **minimum and maximum clip length** for that mission
  within a fixed platform range.
- A participant records a video clip whose length is bounded by that task's configured
  min/max (client-enforced, mirroring the audio widget's cap pattern) and submits it
  through the existing review/auto-approve flow.
- The server independently validates content-type and enforces a video-specific size cap —
  never trusts a client-declared kind/type without checking actual bytes against the
  allowlist.
- Staff can play back a video submission in the review queue.

**Non-Goals:**
- No transcoding, thumbnailing, or verification of the *submitted clip's actual* duration
  server-side (matches audio: duration is client-enforced, the server bounds bytes not
  seconds). The server DOES validate that the creator's configured range is sane — that is
  authoring validation, not media inspection.
- No live-feed integration for video (matches audio's feed-skip).
- Not re-deriving or duplicating `stream-upload-write`'s memory-safety proof — this change
  assumes that endpoint behavior and adds a new content-type/size branch to it.
- Not building a new upload transport or endpoint — reuses `PUT /upload` as-is.

## Decisions

**1. Extend `MediaKind`/`captureKind` to a third value (`'video'`) rather than introduce a
separate task type or field.**
Rationale: identical to the audio-tasks precedent's own reasoning — the only thing that
differs per kind is the capture widget and the content-type/size gate; the task lifecycle
(pending → review/auto-approve → complete) is kind-agnostic. Keeping one field with three
values avoids duplicating the entire submission pipeline.
Alternative considered: a dedicated `video` task type — rejected, same reasoning
audio-tasks already rejected it (more surface area, a new callable, new e2e coverage
requirement, for no behavioral gain).

**2. A separate, higher size cap for video (`MAX_PARTICIPANT_VIDEO_BYTES`), not a blanket
raise of `MAX_PARTICIPANT_BYTES`.**
Rationale: raising the shared participant cap would also let a "photo" upload balloon to
20MB, which is never legitimate (a compressed phone photo is well under 1MB) — that only
weakens the existing size guard for no benefit. A kind-specific cap keeps photo/audio tight
while giving video the room it actually needs.
Alternative considered: one raised shared cap — rejected for the reason above; also makes
the burst-memory math worse across ALL upload types, not just video, for no reason.

**3. Creator-configurable min/max duration inside a fixed platform range; ~20MB size cap
(final number confirmed during implementation against real recorded-clip sizes).**
The creator authors `smart.videoMinSeconds` / `smart.videoMaxSeconds`; the platform bounds
them via `VIDEO_DURATION_LIMITS` (proposed floor 5s, ceiling 60s, defaults min 0 / max 40).
Rationale: the byte cap must stay sized for the WORST allowed clip, so the platform ceiling
— not the per-task max — is what determines burst risk. Capping the ceiling at 60s keeps a
100-concurrent-upload burst within what the streaming-write fix absorbs comfortably on the
4GB VPS, while letting a creator ask for "10-20 seconds" when that's what their mission
wants. A creator lowering the max below the ceiling only ever reduces load.
Alternative considered: one global hardcoded 40s cap — rejected, that was the original plan
but it can't express "at least 10 seconds" missions (a creator asking for a 15-second team
chant has no way to reject a 1-second clip), and the min-length half is the part with no
workaround.
Alternative considered: unbounded creator-chosen duration — rejected, an unbounded max
makes the byte cap unsizable and reopens exactly the burst-memory question this change
sequence exists to close.

**3a. The duration contract lives in ONE pure shared module
(`packages/shared/src/videoDuration.ts`), read by the Builder, the server's save/import
validation, and the participant recorder.**
`resolveVideoDuration(smart)` is total and clamping (absent/garbage/inverted values resolve
to sane in-range defaults rather than throwing) because it runs on the participant hot path
where a bad value must never break a recorder mid-mission — fail-open, matching the
`stuckGuards` / `safeZone` precedent. `videoDurationProblem(min, max)` is the strict
authoring verdict (used by the Builder's inline validation and the server's `updateGame` /
`importGameFile` guards) so an invalid range is refused at authoring time rather than
silently coerced. This mirrors `requiredTaskCountProblem` / `maxCompletableTasks` — one
ceiling function read by both the Builder and the server, never two drifting copies.

**4. `VIDEO_CONTENT_TYPES` covers both `MediaRecorder`'s real output and native-picker
fallback outputs, mirroring `audio-recorder-fallback`.**
Rationale: `MediaRecorder` typically emits `video/webm` (`video/webm;codecs=vp8,opus` or
similar); Safari/iOS often can't record video via `MediaRecorder` at all, so the fallback
path is `<input type="file" accept="video/*" capture>`, which hands back whatever the
device's native camera app produces — `video/mp4` (iOS/most Android) or `video/quicktime`
(older iOS `.mov`). All are allowlisted; anything else is rejected.
Alternative considered: `MediaRecorder`-only, no fallback — rejected because iOS Safari
support for video `MediaRecorder` is inconsistent enough that this would silently exclude a
large share of real participants, exactly the gap `audio-recorder-fallback` already closed
for audio.

**5. Widen `functions/server.js`'s `ALLOWED_CONTENT_TYPES` regex and add the video cap
branch there directly, rather than introducing a separate route.**
Rationale: `/upload` is already kind-agnostic at the transport layer (it just validates
content-type + size against a path-derived participant/creator distinction); video is one
more content-type family with its own cap, not a different transport concern.

## Risks / Trade-offs

- **[Risk] A 20MB video cap is 2x today's participant cap — even with streaming writes,
  a very large synchronized burst (100 groups) still moves meaningfully more total bytes
  than photo/audio alone.**
  → Mitigation: this is exactly why the change is sequenced after `stream-upload-write` —
  with that fix, total bytes moved is a bandwidth/disk question (both ample per the earlier
  capacity analysis: 1 Gbit/s VPS link, 120GB NVMe), not a RAM question. Verified by this
  change's own e2e concurrent-upload scenario at a representative scale.
- **[Risk] `MediaRecorder` video support varies more than audio support across
  browsers/devices (some capture video without audio, some don't support video recording
  at all).**
  → Mitigation: the fallback path (native picker) exists specifically for this; the
  recorder attempts video+audio, and the widget surfaces a clear "use your camera app
  instead" affordance when the recorder constructor throws or isn't supported, matching the
  audio widget's fail-open UX.
- **[Trade-off] No server-side duration check means a malicious/misbehaving client could
  submit a video crafted to be under the byte cap but claim (via metadata alone) to be
  something else** — this is unchanged risk posture from audio/photo (server never trusted
  client-declared duration or kind beyond content-type matching) and is out of scope to
  change here.
- **[Risk] The native-picker fallback path cannot enforce a minimum during capture** — a
  participant on a browser without video `MediaRecorder` picks an already-recorded file, so
  the recorder's "keep going, Xs more" affordance never runs.
  → Mitigation: read the picked file's duration client-side via a `<video>` element's
  `loadedmetadata` event and refuse a below-minimum file with a clear message before upload.
  This is best-effort by nature (metadata can be absent//unreliable for some containers) —
  when duration is unreadable, **fail open and allow the submission** rather than blocking a
  participant who did nothing wrong, consistent with the repo's "every client-side blocking
  flag must fail OPEN" rule.
- **[Risk] A creator sets a min so close to the max that recording is fiddly (e.g. min 39s /
  max 40s), or sets a min above what participants can realistically hit.**
  → Mitigation: `videoDurationProblem()` enforces a sane minimum spread between the two and
  the Builder surfaces the platform range as helper text; beyond that this is a creator
  authoring choice, not a correctness issue.

## Open Questions — RESOLVED during implementation

**`MAX_PARTICIPANT_VIDEO_BYTES` = 20MB, and the recorder now PINS its bitrate.**
The proposed 20MB was kept, but the way it is justified changed, because measuring real
clips exposed a hole in the original reasoning. `MediaRecorder`'s default video bitrate is
browser-chosen and commonly lands several times higher than assumed — at a browser default
a ceiling-length (60s) clip can exceed 20MB outright, so the player would film for a full
minute and be refused only at upload. The fix is to stop treating the bitrate as
environmental: the recorder passes explicit `videoBitsPerSecond: 2_000_000` +
`audioBitsPerSecond: 96_000`, which makes the worst allowed clip
`(2_096_000 bits/s × 60s) / 8 ≈ 15.7MB` — ~79% of the cap, leaving headroom for container
overhead and encoder overshoot. That arithmetic is asserted, not assumed, by
`scripts/test-video-upload-parity.ts`, which fails if the ceiling is raised without
re-deriving the cap.

**The native-picker fallback cannot be bitrate-controlled, so it is size-checked BEFORE
upload.** A device camera app at default settings (iOS 1080p30 is ~17 Mbps) will blow past
20MB well inside 60s, and nothing in the browser can constrain it. Rather than let a
~100MB upload run to completion and be refused, `VideoEntry` compares `file.size` against
the same cap and refuses locally with "film a shorter clip". This is deliberately NOT a
violation of the repo's "client-side blocking guards must fail OPEN" rule: that rule
governs guards that might be WRONG (`navigator.onLine`, GPS accuracy). A byte count is
exact and the server's refusal is certain, so refusing early is strictly kinder. The
*duration* check on the same path — which genuinely can be wrong — does fail open.

**`VIDEO_DURATION_LIMITS` = floor 5s / ceiling 60s / defaults min 0, max 40s; minimum
spread 5s.** As proposed. `0` is preserved as a distinct value meaning "no minimum" (not
"below the floor"), so a creator can leave the minimum off entirely.

**An inverted range resolves by dropping the MINIMUM, never by raising the max.** Not
previously specified. `resolveVideoDuration` is the participant hot path and must fail
open; a player can always satisfy "no minimum", whereas a minimum they cannot reach leaves
the submit button permanently dead with nothing they can do about it.

**Server-side duration validation is gated on `captureKind === 'video'`.** Validating
whenever the fields are merely PRESENT would have recreated the cleared-optional-field
trap: a creator who authored a bad range and then switched the task back to Photo would
have every subsequent autosave refused, with the offending control no longer on screen.

**Review-queue `<video>` needs no extra a11y handling** beyond the `aria-label` the
`<audio>` element already carries — confirmed by `scripts/test-play-a11y-scan.ts` (95
assertions, green).
