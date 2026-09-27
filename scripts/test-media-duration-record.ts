// The clip length a submission may store (change: video-upload-speed, D7).
// A display hint for the organizer's badge, never a gate: anything out of range is DROPPED.
//   npx tsx scripts/test-media-duration-record.ts
import { mediaDurationForRecord, autoApproveLengthVerdict, VIDEO_DURATION_LIMITS } from '../packages/shared/src/videoDuration';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
check('a normal length is kept, to one decimal', mediaDurationForRecord(12.34) === 12.3);
check('the ceiling plus 5 s of slack is kept', mediaDurationForRecord(VIDEO_DURATION_LIMITS.ceilingSeconds + 5) === VIDEO_DURATION_LIMITS.ceilingSeconds + 5);
check('past the slack is dropped', mediaDurationForRecord(VIDEO_DURATION_LIMITS.ceilingSeconds + 5.1) === undefined);
for (const bad of [0, -1, NaN, Infinity, null, undefined, '12', {}]) {
  check(`garbage (${String(bad)}) is dropped, never thrown`, mediaDurationForRecord(bad as never) === undefined);
}
check('a tiny positive length rounds up to 0.1, not to 0', mediaDurationForRecord(0.01) === 0.1);
// Owner (2026-09-26): an AUTO-APPROVED clip must still meet the mission's length range, or it is
// not approved automatically (it goes to the organizers instead). Measured by the recorder in whole
// seconds, so half a second of slack under the minimum and one second over the maximum (the
// recorder's auto-stop lands on it).
{
  const smart = { videoMinSeconds: 10, videoMaxSeconds: 30 };
  check('inside the range is ok', autoApproveLengthVerdict(20, smart) === 'ok');
  check('exactly min and exactly max are ok', autoApproveLengthVerdict(10, smart) === 'ok' && autoApproveLengthVerdict(30, smart) === 'ok');
  check('half a second of slack under the minimum', autoApproveLengthVerdict(9.5, smart) === 'ok' && autoApproveLengthVerdict(9.4, smart) === 'short');
  check('one second of slack over the maximum (auto-stop)', autoApproveLengthVerdict(31, smart) === 'ok' && autoApproveLengthVerdict(31.1, smart) === 'long');
  check('too short', autoApproveLengthVerdict(4, smart) === 'short');
  check('no minimum means any positive length is long enough', autoApproveLengthVerdict(1, { videoMaxSeconds: 30 }) === 'ok');
  check('the platform default max applies when none is set', autoApproveLengthVerdict(VIDEO_DURATION_LIMITS.defaultMaxSeconds + 5, {}) === 'long');
  for (const bad of [undefined, null, NaN, 0, -3, 'x']) {
    check(`an unknown length (${String(bad)}) cannot be proven, so it is not auto-approved`, autoApproveLengthVerdict(bad as never, smart) === 'unknown');
  }
}

console.log(failures === 0 ? '\nmedia duration record: all passed' : `\nmedia duration record: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
