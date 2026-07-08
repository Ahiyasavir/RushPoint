// Pure-logic test for the audio-tasks media-kind gate (change: audio-tasks).
// A photo-task submission accepts image/* (and, for legacy clients, an omitted
// content-type); an audio-task submission REQUIRES exactly one of the four
// allowed audio content-types (codec params stripped). Cross submissions are
// rejected both ways. No emulator.
//   npx tsx scripts/test-media-kinds.ts
import {
  AUDIO_CONTENT_TYPES,
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

// The four allowed audio types are exactly the expected set.
check('AUDIO_CONTENT_TYPES is the four expected', AUDIO_CONTENT_TYPES.join(',') === 'audio/webm,audio/mp4,audio/mpeg,audio/ogg');

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

console.log(`\n${failures === 0 ? 'ALL MEDIA-KIND TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
