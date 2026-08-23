// Pure-logic test for the play-web video recorder's own decisions
// (change: video-submission-task). The RANGE arithmetic lives in
// packages/shared/src/videoDuration.ts and is covered by test-video-duration.ts;
// this covers only what the widget adds on top.
//
// The load-bearing rule here is FAIL OPEN. Two of these guards run against data the
// client cannot trust — a <video> element's reported duration (absent or Infinity
// for some containers) and a picker File's declared type (empty on some Android
// pickers). A guard that treats "I could not tell" as "refuse" strands a
// participant who did nothing wrong, on a mission they cannot otherwise complete.
//   npx tsx scripts/test-video-capture.ts
import {
  VIDEO_BITS_PER_SECOND,
  AUDIO_BITS_PER_SECOND,
  videoTypeFromName,
  pickedClipVerdict,
  recordedClipVerdict,
} from '../apps/play-web/src/lib/videoCapture';
import { VIDEO_DURATION_LIMITS } from '../packages/shared/src/videoDuration';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ─── The bitrate is what makes the server's byte cap derivable ────────────────
// MediaRecorder's DEFAULT bitrate is browser-chosen and can be several times this,
// which would put a ceiling-length clip well past MAX_PARTICIPANT_VIDEO_BYTES — the
// player would record for a full minute and only then be refused. Pinning it is
// what turns the cap from a hope into arithmetic.
const MAX_PARTICIPANT_VIDEO_BYTES = 20 * 1024 * 1024;
const worstCaseBytes =
  ((VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND) * VIDEO_DURATION_LIMITS.ceilingSeconds) / 8;
check(
  'a ceiling-length clip at the pinned bitrate fits under the server cap',
  worstCaseBytes < MAX_PARTICIPANT_VIDEO_BYTES,
  `${Math.round(worstCaseBytes / 1024 / 1024)}MB vs ${MAX_PARTICIPANT_VIDEO_BYTES / 1024 / 1024}MB`,
);
check(
  'and it does so with headroom for container overhead, not by a hair',
  worstCaseBytes < MAX_PARTICIPANT_VIDEO_BYTES * 0.85,
  `${Math.round((worstCaseBytes / MAX_PARTICIPANT_VIDEO_BYTES) * 100)}% of the cap`,
);

// ─── videoTypeFromName: only ever produces a type the server accepts ──────────
check('webm → video/webm', videoTypeFromName('clip.webm') === 'video/webm');
check('mp4 → video/mp4', videoTypeFromName('VID_0001.MP4') === 'video/mp4');
check('mov → video/quicktime', videoTypeFromName('IMG_1234.mov') === 'video/quicktime');
check('m4v → video/mp4', videoTypeFromName('movie.m4v') === 'video/mp4');
check('an unknown extension falls back to video/mp4', videoTypeFromName('recording.xyz') === 'video/mp4');
check('no extension at all falls back to video/mp4', videoTypeFromName('recording') === 'video/mp4');
// The fallback must never produce something the server would refuse — that would
// be a dead end WITH EXTRA STEPS: upload succeeds, submission is then rejected.
const ACCEPTED = ['video/webm', 'video/mp4', 'video/quicktime'];
for (const name of ['a.webm', 'a.mp4', 'a.mov', 'a.m4v', 'a.3gp', 'a', 'a.', '.mov', 'A.MOV']) {
  check(`videoTypeFromName(${name}) is server-accepted`, ACCEPTED.includes(videoTypeFromName(name)), videoTypeFromName(name));
}

// ─── pickedClipVerdict: the native-picker minimum check, FAIL OPEN ────────────
// The recorder path enforces the minimum on SUBMIT (recordedClipVerdict below).
// The picker path cannot — the clip already exists — so its duration is read after
// selection instead.
check('a clip comfortably over the minimum is ok', pickedClipVerdict(20, 10) === 'ok');
check('a clip exactly at the minimum is ok', pickedClipVerdict(10, 10) === 'ok');
check('a clip under the minimum is too-short', pickedClipVerdict(4, 10) === 'too-short');
check('no minimum configured accepts anything', pickedClipVerdict(1, 0) === 'ok');

// Unreadable duration ⇒ ALLOW. metadata is genuinely absent for some containers,
// and refusing here punishes the participant for their phone's file format.
for (const d of [undefined, NaN, Infinity, -Infinity, 0, -5, 'twenty' as unknown as number, null as unknown as number]) {
  check(`unreadable duration (${String(d)}) fails OPEN`, pickedClipVerdict(d, 10) === 'ok');
}

let threw = false;
try {
  pickedClipVerdict(undefined, NaN);
  pickedClipVerdict(NaN, Infinity);
  pickedClipVerdict(10, undefined as unknown as number);
} catch { threw = true; }
check('pickedClipVerdict never throws', threw === false);

// ─── recordedClipVerdict: the recorder's own minimum check ───────────────
// This one may be strict — the widget counted the seconds itself — but it exists
// ONLY to gate the SUBMIT button. The stop button must never consult it: gating
// stop is what trapped a player inside a recording they were not allowed to end
// (the grey, unpressable "stop" bug).
check('a take over the minimum is ok', recordedClipVerdict(12, 10) === 'ok');
check('a take exactly at the minimum is ok', recordedClipVerdict(10, 10) === 'ok');
check('a take a tick under the minimum is ok (tick/container slack)', recordedClipVerdict(9.6, 10) === 'ok');
check('a take clearly under the minimum is too-short', recordedClipVerdict(3, 10) === 'too-short');
check('no minimum configured accepts a 1-second take', recordedClipVerdict(1, 0) === 'ok');
for (const e of [undefined, NaN, Infinity, -1, 'ten' as unknown as number, null as unknown as number]) {
  check(`unmeasurable elapsed (${String(e)}) fails OPEN`, recordedClipVerdict(e, 10) === 'ok');
}
for (const m of [undefined as unknown as number, NaN, -5, 0]) {
  check(`a garbage minimum (${String(m)}) gates nothing`, recordedClipVerdict(1, m) === 'ok');
}
let recThrew = false;
try {
  recordedClipVerdict(undefined, NaN);
  recordedClipVerdict(NaN, Infinity);
  recordedClipVerdict(10, undefined as unknown as number);
} catch { recThrew = true; }
check('recordedClipVerdict never throws', recThrew === false);

console.log(`\n${failures === 0 ? 'ALL VIDEO-CAPTURE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
