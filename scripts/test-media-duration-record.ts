// The clip length a submission may store (change: video-upload-speed, D7).
// A display hint for the organizer's badge, never a gate: anything out of range is DROPPED.
//   npx tsx scripts/test-media-duration-record.ts
import { mediaDurationForRecord, VIDEO_DURATION_LIMITS } from '../packages/shared/src/videoDuration';

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
console.log(failures === 0 ? '\nmedia duration record: all passed' : `\nmedia duration record: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
