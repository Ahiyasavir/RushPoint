// The creator app judges an uploaded picture by the rule its own server uses (found 29.10: on the
// emulator every upload in the setup walk and the mission editor read as failed). See
// apps/creator-web/src/lib/mediaAccept.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptsTaskMedia } from '../apps/creator-web/src/lib/mediaAccept';

let failures = 0;
function ok(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
const EMU = { kind: 'image', url: 'http://127.0.0.1:9199/v0/b/rushpoint-pwa-7daaa.appspot.com/o/gameMedia%2Fu%2Fgames%2Fg%2Fx.png?alt=media&token=t' };
const PROD = { kind: 'image', url: 'https://api.rush-point.com/uploads/gameMedia/u/games/g/x.png' };
const EVIL = { kind: 'image', url: 'https://evil.example/x.png' };

ok('a dev build accepts the Storage emulator URL', acceptsTaskMedia(EMU, { DEV: true }));
ok('a playtest build accepts it too', acceptsTaskMedia(EMU, { DEV: false, MODE: 'playtest' }));
ok('a production build refuses it', !acceptsTaskMedia(EMU, { DEV: false, MODE: 'production' }));
ok('a production URL is accepted everywhere', acceptsTaskMedia(PROD, { DEV: false, MODE: 'production' }) && acceptsTaskMedia(PROD, { DEV: true }));
ok('a foreign URL is refused everywhere', !acceptsTaskMedia(EVIL, { DEV: true }) && !acceptsTaskMedia(EVIL, { DEV: false, MODE: 'production' }));
ok('no env reads as production', !acceptsTaskMedia(EMU, undefined));

for (const f of ['components/SetupFlow.tsx', 'components/TaskWizard.tsx']) {
  const src = readFileSync(join(process.cwd(), 'apps/creator-web/src', f), 'utf8');
  ok(`${f} judges uploads with isAcceptedTaskMedia, never the bare production rule`, src.includes('isAcceptedTaskMedia(') && !/[^.\w]isTaskMediaValid\(/.test(src));
}

console.log(failures === 0 ? '\n✅ media accept: ALL PASS' : `\n❌ media accept: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
