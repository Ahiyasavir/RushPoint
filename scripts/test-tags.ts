// Pure-logic suite for the SHARED tag normalizer (change: game-task-tags).
//
// One definition of "what a tag list is", used by creator-web, play-web and
// functions/ — see openspec/changes/game-task-tags/design.md (D2–D6). The
// creator-web `parseTagsInput` now delegates here; scripts/test-tags-input.ts
// stays as the Builder's raw-string regression guard.
// DOM-free, emulator-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-tags.ts
import { normalizeTags, MAX_TAGS, MAX_TAG_LEN } from '../packages/shared/src/tags';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Every input this suite exercises, so the invariants below can sweep them all.
type AnyIn = Parameters<typeof normalizeTags>[0];
const seen: AnyIn[] = [];
function norm(input: AnyIn): string[] {
  seen.push(input);
  return normalizeTags(input);
}

// ── Splitting (D3) ───────────────────────────────────────────────────────────
check('comma + space split', eq(norm('a, b, c'), ['a', 'b', 'c']));
check('comma, no space', eq(norm('a,b,c'), ['a', 'b', 'c']));
check('Arabic comma U+060C splits', eq(norm('a، b'), ['a', 'b']));
check('fullwidth comma U+FF0C splits', eq(norm('a，b'), ['a', 'b']));
check('newline splits', eq(norm('a\nb'), ['a', 'b']));
check('CRLF splits', eq(norm('a\r\nb'), ['a', 'b']));
check('mixed separators in one string', eq(norm('a, b،c\nd，e'), ['a', 'b', 'c', 'd', 'e']));
check('semicolon is NOT a separator', eq(norm('a; b'), ['a; b']));

// ── Trimming / empties (D4) ──────────────────────────────────────────────────
check('surrounding whitespace trimmed', eq(norm('  a ,  b '), ['a', 'b']));
check('consecutive separators drop empties', eq(norm('a,,b'), ['a', 'b']));
check('trailing comma tolerated', eq(norm('a,b,'), ['a', 'b']));
check('leading comma tolerated', eq(norm(',a'), ['a']));
check('empty string -> []', eq(norm(''), []));
check('whitespace-only -> []', eq(norm('   '), []));
check('separators only -> []', eq(norm(' , , '), []));
check('undefined -> []', eq(norm(undefined), []));
check('null -> []', eq(norm(null), []));
check('internal whitespace collapsed', eq(norm('old   city'), ['old city']));
check('multi-word tag kept whole', eq(norm('old city, park'), ['old city', 'park']));
check('tab treated as whitespace', eq(norm('old\tcity'), ['old city']));
check('zero-width space stripped', eq(norm('pa​rk'), ['park']));
check('bidi override stripped', eq(norm('‮park'), ['park']));
check('emoji tag intact', eq(norm('🏛️ old city'), ['🏛️ old city']));
check('ZWJ emoji sequence intact', eq(norm('👨‍👩‍👧'), ['👨‍👩‍👧']));

// ── De-duplication (D5) ──────────────────────────────────────────────────────
check('exact duplicates deduped', eq(norm('a, a, b'), ['a', 'b']));
check('case-insensitive dedupe, first casing wins', eq(norm('Park, park, PARK'), ['Park']));
check('lowercase first wins too', eq(norm('park, Park'), ['park']));
check('whitespace-differing duplicates deduped', eq(norm('Park , park'), ['Park']));

// ── Hebrew / mixed direction ─────────────────────────────────────────────────
check('Hebrew tags intact', eq(norm('חוץ, חידה, משפחה'), ['חוץ', 'חידה', 'משפחה']));
check('multi-word Hebrew kept whole', eq(norm('העיר העתיקה, ירושלים'), ['העיר העתיקה', 'ירושלים']));
check('mixed Hebrew/English', eq(norm('ירושלים, Jerusalem, טיול'), ['ירושלים', 'Jerusalem', 'טיול']));
check('Hebrew niqqud preserved', eq(norm('שָׁלוֹם'), ['שָׁלוֹם']));
{
  const once = norm('ירושלים, Jerusalem, טיול');
  check('Hebrew round-trips through join(", ")', eq(normalizeTags(once.join(', ')), once));
}

// ── Caps, at the boundaries (D6) ─────────────────────────────────────────────
const distinct = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
check(`${MAX_TAGS - 1} tags kept`, norm(distinct(MAX_TAGS - 1).join(',')).length === MAX_TAGS - 1);
check(`${MAX_TAGS} tags kept`, norm(distinct(MAX_TAGS).join(',')).length === MAX_TAGS);
check(`${MAX_TAGS + 1} tags clamped`, norm(distinct(MAX_TAGS + 1).join(',')).length === MAX_TAGS);
check('cap keeps the FIRST tags', eq(norm(distinct(MAX_TAGS + 1).join(','))[0], 't0'));

check(`${MAX_TAG_LEN - 1}-char tag untouched`, norm('x'.repeat(MAX_TAG_LEN - 1))[0].length === MAX_TAG_LEN - 1);
check(`${MAX_TAG_LEN}-char tag untouched`, norm('x'.repeat(MAX_TAG_LEN))[0].length === MAX_TAG_LEN);
check(`${MAX_TAG_LEN + 1}-char tag truncated`, norm('x'.repeat(MAX_TAG_LEN + 1))[0].length === MAX_TAG_LEN);
{
  // Truncation must not leave a trailing space: the char at the cut point is a space.
  const raw = 'x'.repeat(MAX_TAG_LEN - 1) + ' ' + 'y'.repeat(10);
  const out = norm(raw)[0];
  check('truncation re-trims (no trailing space)', out === out.trimEnd() && out.length <= MAX_TAG_LEN, JSON.stringify(out));
}
check('duplicates do not consume the count allowance', eq(norm('a,a,a,b'), ['a', 'b']));

// Hostile-client shapes — the array form is what a client actually sends.
{
  const huge = norm(Array.from({ length: 10000 }, (_, i) => `tag${i}`));
  check('10 000-tag array clamped', huge.length === MAX_TAGS);
}
{
  const mega = norm(['x'.repeat(1_000_000)]);
  check('1 MB tag truncated', mega.length === 1 && mega[0].length === MAX_TAG_LEN);
}

// ── Totality over input shapes (D2) ──────────────────────────────────────────
check('array input', eq(norm(['a', 'b']), ['a', 'b']));
check('array member containing a comma is split', eq(norm(['a, b']), ['a', 'b']));
check('non-string members discarded', eq(norm(['a', 1, null, {}, 'b'] as unknown as string[]), ['a', 'b']));
check('empty array -> []', eq(norm([]), []));
check('number input -> []', eq(norm(42 as unknown as string), []));
check('object input -> []', eq(norm({} as unknown as string), []));
check('boolean input -> []', eq(norm(true as unknown as string), []));

// ── Invariants over EVERY input above (idempotence + well-formedness) ────────
let invariantFailures = 0;
for (const input of seen) {
  const out = normalizeTags(input);
  const wellFormed =
    Array.isArray(out)
    && out.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_TAG_LEN)
    && out.length <= MAX_TAGS
    && new Set(out.map((t) => t.toLowerCase())).size === out.length;
  const idempotent = eq(normalizeTags(out), out);
  if (!wellFormed || !idempotent) {
    invariantFailures++;
    console.log(`  ↳ invariant broken for ${JSON.stringify(input)?.slice(0, 80)} -> ${JSON.stringify(out)?.slice(0, 120)}`);
  }
}
check(`invariants hold for all ${seen.length} inputs (well-formed + idempotent)`, invariantFailures === 0);

console.log(`\n${failures === 0 ? 'ALL TAGS TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
