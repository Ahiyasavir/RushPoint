// Pure unit suite for formatTxDate — RED-first, dependency-free (no @rushpoint/shared).
import { formatTxDate } from '../apps/creator-web/src/lib/formatTxDate';

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok  - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL- ${name}`);
  }
}

function noThrow(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  - ${name} (no throw)`);
  } catch (e) {
    failures++;
    console.error(`  FAIL- ${name} threw: ${(e as Error).message}`);
  }
}

console.log('formatTxDate');

// Total: unparseable inputs yield the empty fallback, never "Invalid Date".
check('undefined -> ""', formatTxDate(undefined) === '');
check('null -> ""', formatTxDate(null) === '');
check("'garbage' -> ''", formatTxDate('garbage') === '');
check('NaN -> ""', formatTxDate(NaN) === '');

// Valid ISO: identical to today's inline expression (locale-agnostic comparison).
const iso = '2026-07-24T10:00:00.000Z';
const expected = new Date(iso).toLocaleDateString();
check('valid ISO equals inline toLocaleDateString()', formatTxDate(iso) === expected);
check('valid ISO is non-empty', formatTxDate(iso).length > 0);

// Never throws for any of the above inputs.
noThrow('undefined', () => formatTxDate(undefined));
noThrow('null', () => formatTxDate(null));
noThrow('garbage', () => formatTxDate('garbage'));
noThrow('NaN', () => formatTxDate(NaN));
noThrow('valid ISO', () => formatTxDate(iso));

if (failures > 0) {
  console.error(`\nformatTxDate: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nformatTxDate: all assertions passed');
