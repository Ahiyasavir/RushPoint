// Pure-logic test for the audio-tasks media-kind gate (change: audio-tasks).
// A photo-task submission accepts image/* (and, for legacy clients, an omitted
// content-type); an audio-task submission REQUIRES exactly one of the four
// allowed audio content-types (codec params stripped). Cross submissions are
// rejected both ways. No emulator.
//   npx tsx scripts/test-media-kinds.ts
import {
  AUDIO_CONTENT_TYPES,
  VIDEO_CONTENT_TYPES,
  normalizeContentType,
  isAllowedSubmissionContentType,
} from '../packages/shared/src/mediaKinds';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// normalizeContentType strips codec params + trims + lowercases.
check('normalize strips ;codecs=opus', normalizeContentType('audio/webm;codecs=opus') === 'audio/webm');
check('normalize strips ; params with spaces', normalizeContentType('audio/mp4; codecs="mp4a.40.2"') === 'audio/mp4');
check('normalize lowercases + trims', normalizeContentType('  IMAGE/JPEG  ') === 'image/jpeg');
check('normalize passes a bare type through', normalizeContentType('audio/ogg') === 'audio/ogg');

// The allowed audio types are exactly this set — still PINNED, not loosened, so
// an accidental change is still caught. It grew from four to eight with
// change: audio-recorder-fallback: the first four are what MediaRecorder emits,
// the last four are what the PHONE's own recorder emits (Android 3gpp/amr, iOS
// x-m4a/aac). The fallback hands the file straight to the same callable, so a
// type missing here means the player records, uploads, and is then refused.
// Mirrored by ALLOWED_CONTENT_TYPES in functions/server.js and by storage.rules;
// scripts/test-audio-recorder-guards.ts fails if those three drift apart.
check(
  'AUDIO_CONTENT_TYPES is the expected set',
  AUDIO_CONTENT_TYPES.join(',')
    === 'audio/webm,audio/mp4,audio/mpeg,audio/ogg,audio/aac,audio/x-m4a,audio/3gpp,audio/amr',
);
// The phone-recorder types must really be accepted end to end, not merely listed.
for (const ct of ['audio/aac', 'audio/x-m4a', 'audio/3gpp', 'audio/amr']) {
  check(`audio + ${ct} accepted (phone-recorder fallback)`, isAllowedSubmissionContentType('audio', ct) === true);
}

// Photo kind:
check('photo + image/jpeg accepted', isAllowedSubmissionContentType('photo', 'image/jpeg') === true);
check('photo + image/png accepted', isAllowedSubmissionContentType('photo', 'image/png') === true);
check('photo + undefined accepted (legacy clients)', isAllowedSubmissionContentType('photo', undefined) === true);
check('photo + audio/webm rejected', isAllowedSubmissionContentType('photo', 'audio/webm') === false);
check('photo + junk rejected', isAllowedSubmissionContentType('photo', 'not-a-type') === false);

// Audio kind — each of the four types, bare and with codec params:
for (const ct of AUDIO_CONTENT_TYPES) {
  check(`audio + ${ct} accepted`, isAllowedSubmissionContentType('audio', ct) === true);
  check(`audio + ${ct};codecs=opus accepted`, isAllowedSubmissionContentType('audio', `${ct};codecs=opus`) === true);
}
check('audio + undefined rejected (audio requires a declared type)', isAllowedSubmissionContentType('audio', undefined) === false);
check('audio + image/png rejected', isAllowedSubmissionContentType('audio', 'image/png') === false);
check('audio + audio/wav rejected (not in allowlist)', isAllowedSubmissionContentType('audio', 'audio/wav') === false);
check('audio + junk rejected', isAllowedSubmissionContentType('audio', 'garbage') === false);

// Video kind (change: video-submission-task) — same shape as audio: a declared
// content-type is REQUIRED and must be one of VIDEO_CONTENT_TYPES exactly (codec
// params stripped first). The set covers MediaRecorder's own output (video/webm)
// plus what a NATIVE camera picker hands back on the fallback path — iOS/Android
// give video/mp4, older iOS gives video/quicktime. Missing one means the player
// records, uploads, and is then refused.
check(
  'VIDEO_CONTENT_TYPES is the expected set',
  VIDEO_CONTENT_TYPES.join(',') === 'video/webm,video/mp4,video/quicktime',
);
for (const ct of VIDEO_CONTENT_TYPES) {
  check(`video + ${ct} accepted`, isAllowedSubmissionContentType('video', ct) === true);
  check(
    `video + ${ct};codecs=vp8,opus accepted`,
    isAllowedSubmissionContentType('video', `${ct};codecs=vp8,opus`) === true,
  );
}
check('video + undefined rejected (video requires a declared type)', isAllowedSubmissionContentType('video', undefined) === false);
check('video + image/jpeg rejected', isAllowedSubmissionContentType('video', 'image/jpeg') === false);
check('video + audio/webm rejected', isAllowedSubmissionContentType('video', 'audio/webm') === false);
check('video + video/3gpp rejected (not in allowlist)', isAllowedSubmissionContentType('video', 'video/3gpp') === false);
check('video + junk rejected', isAllowedSubmissionContentType('video', 'garbage') === false);

// Cross-kind submissions are rejected in every direction.
check('photo + video/webm rejected', isAllowedSubmissionContentType('photo', 'video/webm') === false);
check('audio + video/webm rejected', isAllowedSubmissionContentType('audio', 'video/webm') === false);

console.log(`\n${failures === 0 ? 'ALL MEDIA-KIND TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
