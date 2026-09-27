// Pure-logic tests: a participant device uploads into ITS OWN folder
// (change: attached-phone-uploads)
//
// Found 2026-09-25: a phone that joined a team as an extra device and then took control could not
// upload ANY photo, audio or video. The app built `runs/{runId}/teams/{state.team.id}/…`, the TEAM
// id, while all three server gates key on the CALLER:
//   * the VPS upload route, `ownsUploadPath` (functions/uploadRoute.js): parts[3] === uid
//   * `requireStorageUrl` (packages/shared/src/validation.ts): runs/{runId}/teams/{uid}/
//   * storage.rules: request.auth.uid == teamId (the folder segment)
// For the founding phone uid === teamId, which is why it always looked fine.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { participantUploadPath, isFolderRefusal } from '../apps/play-web/src/lib/uploadPath';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../functions/uploadRoute.js') as {
  ownsUploadPath: (kind: string, p: string, uid: string) => boolean;
};

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}

console.log('\n— the path is built from the uploading device\'s own uid —');
const p = participantUploadPath({ runId: 'R1', uid: 'PHONE_B', taskId: 'task-1', ext: 'jpg', nowMs: 1000 });
ok('path is runs/{runId}/teams/{uid}/{task}-{ts}.{ext}', p === 'runs/R1/teams/PHONE_B/task-1-1000.jpg', p);
ok('the upload route accepts it for that uid', route.ownsUploadPath('participant', p, 'PHONE_B'));
ok('the upload route would refuse the TEAM folder for that uid (the bug, pinned)',
  route.ownsUploadPath('participant', 'runs/R1/teams/TEAM_A/task-1-1000.jpg', 'PHONE_B') === false);

console.log('\n— a task id is sanitised into a safe file name —');
const weird = participantUploadPath({ runId: 'R1', uid: 'U', taskId: 'a/b c?..', ext: 'webm', nowMs: 5 });
ok('no slash, space, ? or dot-dot survives from the task id', weird === 'runs/R1/teams/U/a_b_c___-5.webm', weird);

console.log('\n— no call site can pass a team id any more —');
const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'apps/play-web/src/components/TaskRunner.tsx'), 'utf8');
// Every kind now goes through ONE call (change: media-upload-reliability, pendingUpload).
const calls = runner.match(/uploadTaskMedia\([\s\S]{0,300}?\)\s*,/g) ?? [];
ok('TaskRunner calls the upload helper', calls.length >= 1, `found ${calls.length}`);
for (const c of calls) ok(`no teamId passed: ${c.slice(0, 60)}`, !/teamId/.test(c));
const svc = fs.readFileSync(path.join(root, 'apps/play-web/src/services/firebase.ts'), 'utf8');
ok('services/firebase.ts derives the folder in ONE helper built on participantUploadPath + the signed-in uid',
  /participantUploadPath\(\{[^}]*uid: me/.test(svc));
// photo, audio, video, the video's poster and the resumable session (video-upload-speed D4/D7):
// every path a participant upload can take is built by the one helper.
ok('all five upload paths go through that helper',
  (svc.match(/await myUploadPath\(/g) ?? []).length === 5, `found ${(svc.match(/await myUploadPath\(/g) ?? []).length}`);
ok('no upload path is built any other way', (svc.match(/participantUploadPath\(/g) ?? []).length === 1);
ok('services/firebase.ts no longer builds a teams/${p.teamId} path', !/teams\/\$\{p\.teamId\}/.test(svc));

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);
