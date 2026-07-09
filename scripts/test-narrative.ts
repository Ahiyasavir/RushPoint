// Pure-logic tests for narrative-chapters helpers. Run by scripts/run-unit-tests.mjs.
import { localizedBeatBody, beatHasContent, resolveStageNarrative } from '@rushpoint/shared';

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string) { if (cond) passed++; else { failed++; console.error(`  ✗ ${msg}`); } }

// localizedBeatBody
ok(localizedBeatBody({ body: 'Go', bodyHe: 'לך' }, 'he') === 'לך', 'he uses bodyHe');
ok(localizedBeatBody({ body: 'Go', bodyHe: 'לך' }, 'en') === 'Go', 'en uses body');
ok(localizedBeatBody({ body: 'Go' }, 'he') === 'Go', 'he falls back to body when no bodyHe');
ok(localizedBeatBody({ bodyHe: 'לך' }, 'en') === '', 'en with only bodyHe is empty');
ok(localizedBeatBody(undefined, 'he') === '', 'undefined beat → empty');

// beatHasContent
ok(beatHasContent({ title: 'Ch 1' }) === true, 'title counts as content');
ok(beatHasContent({ body: 'x' }) === true, 'body counts');
ok(beatHasContent({ imageUrl: 'https://x/y.jpg' }) === true, 'image counts');
ok(beatHasContent({}) === false, 'empty beat has no content');
ok(beatHasContent({ title: '   ' }) === false, 'whitespace-only is not content');
ok(beatHasContent(undefined) === false, 'undefined has no content');

// resolveStageNarrative
const stage = { narrative: { intro: { body: 'Welcome' }, outro: { body: 'Well done' } } };
ok(resolveStageNarrative(stage, 'active')?.kind === 'intro', 'active → intro');
ok(resolveStageNarrative(stage, 'completed')?.kind === 'outro', 'completed → outro');
ok(resolveStageNarrative(stage, 'locked') === null, 'locked → nothing');
ok(resolveStageNarrative({ narrative: { outro: { body: 'x' } } }, 'active') === null, 'active w/o intro → nothing');
ok(resolveStageNarrative(undefined, 'active') === null, 'no stage → nothing');
ok(resolveStageNarrative({}, 'active') === null, 'no narrative → nothing');

console.log(failed === 0 ? `\n✅ ALL NARRATIVE TESTS PASSED (${passed})` : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
