// How ready a composed game reads (research 29.10, docs/creator-stickiness-2026-10-29.md). The
// composer had already built 16 missions in 3 stages, the walk said "the big part is behind you",
// and the bar beside it said 20%, because the whole build counted as ONE step against four open
// map pins. Endowed progress only works when it is credible, and this one was credible the other
// way round: the work really was done. Every composed mission now counts as a step done, so the
// same game reads 80% and climbs 5 points per pin. It never reads 100% while something is open.
import { setupReadinessPct } from '../apps/creator-web/src/lib/quickSetup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function ok(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

ok('16 composed missions, 4 open pins reads 80%', setupReadinessPct({ missions: 16, done: 0, required: 4 }) === 80);
ok('each placed pin moves it up', setupReadinessPct({ missions: 16, done: 1, required: 4 }) === 85);
ok('one left is still below 100', setupReadinessPct({ missions: 16, done: 3, required: 4 }) === 95);
ok('a big game with one open item never rounds to 100', setupReadinessPct({ missions: 300, done: 0, required: 1 }) === 99);
ok('nothing open is 100', setupReadinessPct({ missions: 16, done: 4, required: 4 }) === 100);
ok('a blank game still starts ahead (the build is one step)', setupReadinessPct({ missions: 0, done: 0, required: 4 }) === 20);
ok('junk input does not throw and stays in range', (() => {
  const v = setupReadinessPct({ missions: Number.NaN, done: -3, required: Number.NaN });
  return v >= 0 && v <= 100;
})());

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
ok('the walk reads the shared rule', /setupReadinessPct\(/.test(src('apps/creator-web/src/components/SetupFlow.tsx')));
ok('the dashboard resume card reads the same rule', /setupReadinessPct\(/.test(src('apps/creator-web/src/lib/quickSetup.ts').split('export function setupResume')[1] ?? ''));

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nsetup readiness: all pass');
