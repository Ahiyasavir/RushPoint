// The staff app's "send the team back" offers the same two scopes as the console (open gap in the
// 2026-10-06 handoff: staff had only "this mission"). Source pins: no component test runner.
//   npx tsx scripts/test-staff-sendback-scope.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const src = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/StaffConsole.tsx'), 'utf8');
const calls = readFileSync(join(process.cwd(), 'apps/play-web/src/services/calls.ts'), 'utf8');
ok('picking a mission asks "only it" or "from it on"', /data-testid="staff-sendback-scope"/.test(src) && /\['only', 'fromHere'\]/.test(src));
ok('the scope reaches the dry run AND the real call', (src.match(/scope: 'fromHere' as const/g) ?? []).length >= 2);
ok('the preview names what else reopens', /sendBackReopens\(/.test(src));
ok('the client type carries the scope', /returnTeamTo = callable<\s*Ctx & \{[^}]*scope\?: 'only' \| 'fromHere'/.test(calls));
console.log(failures === 0 ? '\n✅ staff send back scope: ALL PASS' : `\n❌ staff send back scope: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
