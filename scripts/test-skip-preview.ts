// The skip confirmation is built from the server's dry-run plan (change: skip-keeps-the-stage).
import { skipPreviewLines } from '../packages/shared/src/skipPreview';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
const keys = (l: ReturnType<typeof skipPreviewLines>) => (l ?? []).map((x) => x.key).join(',');

console.log('\n— the 2026-09-22 case: skipping the head of a chain —');
const head = skipPreviewLines({
  taskTitle: 'קומו ונעלה ציון!', stageCompletes: false, requirementLowered: true, requiredTaskCount: 2,
  consolation: 43, dependentsOpened: [{ id: '2b83fd50', title: 'צופן המצפן הסודי' }],
});
ok('names the skipped mission, what opens, that they stay, the new requirement, the consolation',
  keys(head) === 'skips,opens,staysInStage,requirementLowered,consolation', keys(head));
const opens = head?.find((l) => l.key === 'opens');
ok('the opened mission is named', !!opens && opens.key === 'opens' && opens.titles[0] === 'צופן המצפן הסודי');

console.log('\n— a skip that really ends the stage says so —');
const last = skipPreviewLines({ taskTitle: 'x', stageCompletes: true, requirementLowered: true, requiredTaskCount: 1 });
ok('ends the stage, and does not talk about a requirement that no longer matters', keys(last) === 'skips,endsStage', keys(last));

console.log('\n— total: bad input ⇒ null, so the caller shows its generic confirm —');
for (const bad of [null, undefined, {}, { stageCompletes: 'no' }, 'x', 5]) {
  ok(`${JSON.stringify(bad)} ⇒ null`, skipPreviewLines(bad as never) === null);
}
const junk = skipPreviewLines({ stageCompletes: false, dependentsOpened: [null, { title: 5 }, { title: '  ' }], consolation: Number.NaN });
ok('junk titles and a NaN consolation are dropped, not rendered', keys(junk) === 'staysInStage', keys(junk));

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);
