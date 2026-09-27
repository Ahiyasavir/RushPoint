// Source guard for the viewing phone (change: team-phones-simple, D3).
//
// A phone that was not answering for its team used to render EVERY mission control greyed out
// (`pointer-events-none` over the whole block) plus a banner far below, inside the drawer. The
// field report: "one phone has grey buttons". Now a viewer sees the normal capture controls on a
// media mission (it may send a photo or clip for the team), and on any other mission ONE card that
// says who is answering, with "send from my phone". No component test runner exists, so the rules
// are pinned on the source.
//   npx tsx scripts/test-viewer-phone.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const root = join(__dirname, '..', 'apps', 'play-web', 'src');
const runner = readFileSync(join(root, 'components', 'TaskRunner.tsx'), 'utf8').replace(/\r/g, '');
const play = readFileSync(join(root, 'screens', 'PlayScreen.tsx'), 'utf8').replace(/\r/g, '');

check('TaskRunner takes a role, not a blanket readOnly flag',
  /role\?: 'sender' \| 'viewer'/.test(runner) && !/readOnly = false, onOpenChat/.test(runner));
check('the UI freeze applies only to a viewer on a NON-media mission',
  /const readOnly = isViewer && !isMediaMission/.test(runner));
check('a viewer on a non-media mission gets the ViewerCard in place of the controls',
  /<ViewerCard\b/.test(runner) && /function ViewerCard\(/.test(runner));
check('the ViewerCard offers taking over', /onTakeOver/.test(runner));
check('PlayScreen passes the role', /role=\{isController \? 'sender' : 'viewer'\}/.test(play));
check('the drawer viewer banner is gone', !/viewingBanner/.test(play));
check('routing stays with the answering phone (a viewer never requests the next mission)',
  /if \(isViewer\) return;/.test(runner));

console.log(`\n${failures === 0 ? 'ALL VIEWER-PHONE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
