// Pure-logic test for normalizeAccessCode (Wave 1, Fix 1).
// Access codes come straight from client payloads and are interpolated into a
// Firestore doc path (accessCodes/{CODE}). A non-string code makes `.trim()` a
// TypeError, and a code containing `/` builds an odd-segment path that db.doc()
// rejects — both re-thrown as opaque INTERNAL/500. This helper rejects every such
// input as a typed ValidationError (→ invalid-argument) BEFORE any doc path is
// built. No emulator.
//   npx tsx scripts/test-access-code.ts
import { normalizeAccessCode, ValidationError, MAX_CODE_LEN } from '../packages/shared/src/validation';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function rejected(fn: () => unknown): boolean {
  try { fn(); return false; } catch (e) { return e instanceof ValidationError; }
}

// ── Happy path: trims + upper-cases ──────────────────────────────────────────
check("normalizes 'abc123' → 'ABC123'", normalizeAccessCode('abc123') === 'ABC123');
check("trims + upper-cases '  wolf7 ' → 'WOLF7'", normalizeAccessCode('  wolf7 ') === 'WOLF7');
check('leaves an already-canonical code unchanged', normalizeAccessCode('ABC123') === 'ABC123');

// ── Rejections ───────────────────────────────────────────────────────────────
check('rejects empty string', rejected(() => normalizeAccessCode('')));
check('rejects whitespace-only string', rejected(() => normalizeAccessCode('   ')));
check('rejects a number', rejected(() => normalizeAccessCode(123)));
check('rejects a boolean', rejected(() => normalizeAccessCode(true)));
check('rejects null', rejected(() => normalizeAccessCode(null)));
check('rejects undefined', rejected(() => normalizeAccessCode(undefined)));
check('rejects an object', rejected(() => normalizeAccessCode({})));
check('rejects a slash (odd-segment path)', rejected(() => normalizeAccessCode('A/B')));
check('rejects an embedded space', rejected(() => normalizeAccessCode('A B')));
check('rejects a non-ASCII code', rejected(() => normalizeAccessCode('café')));
check('rejects a code longer than MAX_CODE_LEN', rejected(() => normalizeAccessCode('A'.repeat(MAX_CODE_LEN + 1))));

// The failure is a typed ValidationError on the 'code' field.
try {
  normalizeAccessCode('A/B');
} catch (e) {
  check('failure is a ValidationError on field "code"', e instanceof ValidationError && (e as ValidationError).field === 'code');
}

console.log(`\n${failures === 0 ? 'ALL ACCESS-CODE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
