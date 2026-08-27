/**
 * No stray control characters in source.
 *
 * This exists because of a specific, silent, self inflicted failure. A regex was
 * meant to read `/<img\b[^>]*>/`, and what actually landed in the file was a
 * literal BACKSPACE character (U+0008) where the two characters `\` and `b`
 * belonged. The regex then looked completely normal in every editor and in `git
 * diff`, because a backspace renders as nothing, and it matched nothing, because
 * HTML contains no backspaces.
 *
 * The consequence is the reason this is worth a gate rather than a lesson. The
 * check built on that regex found zero images and therefore reported that zero
 * images were missing alt text. It PASSED. A test that examines nothing and a
 * test that examines everything and finds no problem print exactly the same
 * thing, and this is one of the ways the first disguises itself as the second.
 *
 * It arrives easily: any tool that writes a file through a language where `\b` in
 * a string literal means backspace (Python, Ruby, JavaScript strings, most shell
 * `echo -e`) produces it from source that reads correctly.
 *
 * Scope: the characters that have no legitimate place in source text. Tab,
 * newline and carriage return are excluded, obviously. Test DATA that
 * deliberately contains a control character is legitimate and is declared below
 * rather than pattern matched, so adding one is a decision rather than an
 * accident.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** Where source lives. Deliberately not the whole tree: no build output, no deps. */
const ROOTS = ['scripts', 'packages/shared/src', 'functions/src', 'apps'];

/** Never walked. Build output and vendored bytes are not ours to police. */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-playtest', 'lib', '.astro', '.firebase',
  'coverage', 'build', '.turbo', '.git', 'public',
]);

const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|astro|css|json|md|yaml|yml|rules)$/;

/**
 * Files allowed to contain a control character, with the reason. DECLARED, never
 * inferred: the whole value of this check is that an accidental one fails, and a
 * heuristic that recognised "probably deliberate" would wave through exactly the
 * case it exists to catch.
 */
const ALLOWED: Record<string, string> = {
  // ── The control character IS the test input ────────────────────────────────
  'scripts/e2e-verify.mjs':
    'Sends a BELL character through the chat callable on purpose, asserting that a control '
    + 'character in participant text is sanitised rather than stored. The control character '
    + 'IS the test input.',
  'scripts/test-chat.ts':
    'Feeds a BELL to sanitizeChatText and asserts it is stripped.',
  'scripts/test-payload-validation.ts':
    'Feeds C0 and C1 control characters to requireString and asserts they are stripped.',
  'packages/shared/src/adminNotes.test.ts':
    'Feeds NUL and BELL to normalizeUserNote and asserts they are stripped.',

  // ── The control character IS the subject ───────────────────────────────────
  'packages/shared/src/adminNotes.ts':
    'Its CONTROL_CHARS regex is a literal range, which is the same shape as the mistake this '
    + 'file guards against, and here it is correct: the characters in the class are exactly '
    + 'the characters it means to strip, so they belong in the source.',
  'packages/shared/src/wrongAnswerPenalty.ts':
    'hashAnswerForReplay joins an ordered answer on NUL, deliberately, because NUL is the one '
    + 'separator that cannot occur inside a joined plain string. That is what stops ["a","b"] '
    + 'and "ab" colliding into a false replay, so a different wrong answer is not mistaken for '
    + 'a repeat and left uncharged.',
};

/**
 * Control characters with no legitimate place in source text: everything below
 * U+0020 except tab, newline and carriage return, plus DEL.
 *
 * Built from escape SEQUENCES in a constructed pattern rather than written as a
 * literal range. That is not fussiness: a literal range means typing the very
 * characters this file forbids, so the check would flag itself and there would
 * be no way to express the rule at all.
 */
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (EXTENSIONS.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files: string[] = [];
for (const root of ROOTS) {
  const full = join(ROOT, root);
  try {
    if (statSync(full).isDirectory()) walk(full, files);
  } catch {
    // A root that does not exist is not this check's problem; the reach
    // assertion below is what catches "we scanned nothing".
  }
}

// The reach assertion, first, because every other check here is an absence and
// an absence over an empty file list is a green nobody earned. That is the very
// failure mode this file was written about.
check('the scan reached the source tree', files.length > 300, `${files.length} file(s)`);

const offenders: string[] = [];
const usedAllowances = new Set<string>();

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const hits = text.match(CONTROL);
  if (!hits) continue;

  if (ALLOWED[rel]) {
    usedAllowances.add(rel);
    continue;
  }

  // Name the line, because a character that renders as nothing is otherwise
  // genuinely hard to find.
  const line = text.slice(0, text.search(CONTROL)).split('\n').length;
  offenders.push(`${rel}:${line} (${hits.length}, first is U+${hits[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()})`);
}

check(
  'no source file carries a stray control character',
  offenders.length === 0,
  offenders.slice(0, 5).join(' | ') || `${files.length} file(s) clean`,
);

// A stale allowance is a hole nobody knows is open. If the deliberate control
// character is removed, the entry has to go too.
const stale = Object.keys(ALLOWED).filter((rel) => !usedAllowances.has(rel));
check(
  'no stale entries in the allowed list',
  stale.length === 0,
  stale.join(', ') || `${Object.keys(ALLOWED).length} allowance(s), all still needed`,
);

console.log('');
if (failures > 0) {
  console.log(`CONTROL CHARACTER TESTS FAILED :: ${failures} of ${checks}`);
  console.log('');
  console.log('A control character where a regex escape was intended matches nothing, so the');
  console.log('check built on it passes while examining nothing. Look for `\\b`, `\\f`, `\\v` or');
  console.log('`\\0` that were written through a language where a string escape consumed them.');
  process.exit(1);
}
console.log(`ALL CONTROL CHARACTER TESTS PASSED :: ${checks} checks`);
