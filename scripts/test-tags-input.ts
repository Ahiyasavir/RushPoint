// Pure-logic suite for the Builder game-tags parser (change: tags-input-separators).
// The bug: the tags <Input> was value={tags.join(', ')} with an onChange that
// immediately split+trim+filter, so a comma/space could never survive typing.
// The fix keeps a raw string in the input and derives tags via parseTagsInput.
// DOM-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-tags-input.ts
import { parseTagsInput } from '../apps/creator-web/src/lib/tags';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

check('basic comma+space split', eq(parseTagsInput('chutz, park'), ['chutz', 'park']));
check('no space after comma', eq(parseTagsInput('chutz,park'), ['chutz', 'park']));
check('trailing comma tolerated', eq(parseTagsInput('chutz, park,'), ['chutz', 'park']));
check('trailing space tolerated', eq(parseTagsInput('chutz, park  '), ['chutz', 'park']));
check('leading/inner whitespace trimmed', eq(parseTagsInput('  chutz ,  park '), ['chutz', 'park']));
check('empty string -> []', eq(parseTagsInput(''), []));
check('only commas/spaces -> []', eq(parseTagsInput(' , , '), []));
check('duplicates deduped', eq(parseTagsInput('chutz, chutz, park'), ['chutz', 'park']));
check('Hebrew tags intact', eq(parseTagsInput('חוץ, חידה, משפחה'), ['חוץ', 'חידה', 'משפחה']));
check('multi-word tag keeps inner space', eq(parseTagsInput('night walk, park'), ['night walk', 'park']));

console.log(`\n${failures === 0 ? 'ALL TAGS-INPUT TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
