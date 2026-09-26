// A captured photo must not die with the component (change: photo-survives-a-remount)
//
// FROM A LIVE RUN, not a hypothesis. Run A20PW01e22Uim8p7XEVK, 2026-09-17: the player
// submitted on סחר חליפין, the picture vanished, they were returned to the capture
// screen, and they shot it again. The server tells the rest: the upload SUCCEEDED
// (83KB written at 08:29:41) and NO submitStationPhoto ever followed it. The orphan is
// still on disk with nothing attached to it.
//
// Two faults compounded, and this pins both:
//   1. The capture lived only in PhotoEntry's useState, and TaskRunner early-returns
//      whenever `task` is null (routing has not handed back a mission yet) - which
//      unmounts PhotoEntry and destroys the photo.
//   2. A successful upload was discarded when the submit after it failed, so the retry
//      re-uploaded the same bytes.
//
// There is no component test runner for play-web, so this is a source contract. It is
// deliberately narrow: each assertion names a thing that, if removed, reintroduces a
// defect that actually happened in front of a real group of children.
import { readFileSync } from 'node:fs';

const SRC = 'apps/play-web/src/components/TaskRunner.tsx';
const body = readFileSync(SRC, 'utf8');

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}

console.log('\n— the capture outlives the component —');
ok('a store for captured photos exists OUTSIDE PhotoEntry',
  /capturedRef\s*=\s*useRef<Map<string,\s*\{\s*file:\s*File/.test(body));
ok('PhotoEntry is handed back what was captured for THIS mission',
  /restored=\{capturedRef\.current\.get\(task\.id\)\?\.file/.test(body));
ok('and it seeds its own state from that, rather than always starting empty',
  /useState<File \| null>\(restored\)/.test(body));
ok('a restored photo gets a fresh preview URL (the old blob: was revoked on unmount)',
  /if \(restored\) setPreviewUrl\(URL\.createObjectURL\(restored\)\)/.test(body));
ok('every capture is reported upward', /onCaptured\(compressed\)/.test(body));

console.log('\n— it is keyed per mission, so it cannot cross into the next one —');
// The whole reason PhotoEntry carries key={task.id}: mission B was found holding
// mission A's photo, primed to submit. A store keyed any other way would undo that.
ok('the store is written under the task id', /capturedRef\.current\.set\(task\.id/.test(body));
ok('and read under the task id', /capturedRef\.current\.get\(task\.id\)/.test(body));
ok('PhotoEntry still carries its per-task key', /<PhotoEntry[\s\S]{0,160}key=\{task\.id\}/.test(body));

console.log('\n— a landed upload is never thrown away —');
// The landed upload is held by the capture-time upload store (change: media-upload-reliability):
// send TAKES it, so a failed submit re-sends nothing and a second send reuses the same bytes.
ok('the photo send takes the capture-time upload instead of uploading again',
  /await pending\.take\(taskId, file, 'image\/jpeg'\)/.test(body));
ok('the photo upload starts when the capture exists',
  /pending\.begin\(task\.id, f, 'image\/jpeg'\)/.test(body));
// Order matters: clearing before the submit resolves would drop the photo on failure,
// which is the original bug wearing a new hat.
const submitAt = body.indexOf('await submitStationPhoto(');
// After success the capture is KEPT without its upload url (change: submission-status-truth): if
// the organizer rejects it, the player sees what they sent and a new send uploads afresh, and a
// rejected file is never re-submitted from a stale cached url.
const clearAt = body.indexOf('pending.forget(taskId)', submitAt);
ok('the cached upload url is dropped only AFTER the submit succeeds',
  submitAt >= 0 && clearAt > submitAt, `submit@${submitAt} clear@${clearAt}`);


console.log('');
console.log('- one successful submit cannot be sent again until routing moves on -');
// Live run 2026-09-17: "after I pressed send on the video it DID submit, but it still
// let me submit it again, and that wastes memory." That window was first closed with a
// `sentFor` latch folded into `frozen`; the latch also froze a REJECTED mission and kept
// a fake upload bar on screen for the whole review wait (reproduced 2026-09-25), so
// change submission-status-truth replaced it. The intent is unchanged and pinned here:
// the just-sent submission is remembered per task, it drives the screen until the team
// snapshot carries the server record, and it is cleared when the mission changes.
ok('a per-task record of what was just sent exists', /const \[justSent, setJustSent\] = useState</.test(body));
ok('it feeds the submission record the screen reads',
  /pickSubmissionRecord\([\s\S]{0,200}justSent && justSent\.taskId === task\.id \? justSent : null/.test(body));
ok('while a submission stands the capture controls are replaced by the waiting card',
  /submissionStands\(phase\)/.test(body) && /showWaitingCard \?/.test(body));
ok('it is cleared when the mission changes, so the next one starts ready',
  /setJustSent\(null\);[\s\S]{0,160}\}, \[assignedRec\?\.taskId\]\)/.test(body));
// photo, audio and video all go through it - one drifting is how this class recurs.
const latches = (body.match(/setJustSent\(\{ taskId: task!\.id/g) ?? []).length;
ok(`every media path records what it sent :: ${latches} of 3`, latches === 3, String(latches));

console.log('');
if (failures > 0) {
  console.error(`✗ photo-survives-remount: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ photo-survives-remount: all assertions passed\n');
