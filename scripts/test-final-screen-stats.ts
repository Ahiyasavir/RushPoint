// The final screen's summary stats when a team did NOT finish (the organizers ended the game first).
// 2026-10-05 replaced a bare "?" (reads as an error) with "Not yet"; on 2026-10-06 that was seen to be
// wrong too: this screen only exists once the game is OVER, so "yet" promises a time that will never
// come. The total time of a team that never crossed the line is "not finished", and a team that
// completed no stage has no fastest stage: two different facts, two different words.
//   npx tsx scripts/test-final-screen-stats.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translations } from '../apps/play-web/src/i18n';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

const screen = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/FinalScreen.tsx'), 'utf8');
ok('no "?" stands in for a missing stat', !/:\s*'\?'\s*\}/.test(screen));
ok('a team that did not finish shows "not finished" for its total time',
  /statTotalTime\}\s*value=\{totalSec != null \? fmtDuration\(totalSec\) : t\.final\.statNotFinished\}/.test(screen));
ok('a team with no completed stage shows "none" for its fastest stage',
  /statFastest\}\s*value=\{fastest \?.*: t\.final\.statNoStage\}/.test(screen));

for (const lang of ['he', 'en'] as const) {
  const f = (translations[lang] as unknown as { final: Record<string, unknown> }).final;
  for (const key of ['statNotFinished', 'statNoStage']) {
    const v = f[key];
    ok(`${lang}: final.${key} exists`, typeof v === 'string' && v.length > 0);
    ok(`${lang}: final.${key} promises nothing ("yet" / "עדיין")`, typeof v === 'string' && !/\byet\b|עדיין/i.test(v));
  }
  ok(`${lang}: the retired final.statNone is gone`, !('statNone' in f));
}

console.log(failures === 0 ? '\n✅ final screen stats: ALL PASS' : `\n❌ final screen stats: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
