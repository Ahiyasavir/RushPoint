// ─────────────────────────────────────────────────────────────────────────────
// play-web dictionary invariants (change: play-web-i18n-invariants).
//
// play-web is the PARTICIPANT app: Hebrew-first, used in the field, on a phone,
// often on a thin connection. A missing key or a wrong-language string here is
// worse than the same defect in the creator console — the player cannot switch
// to a laptop and work around it.
//
// `apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts` pins these same
// invariants for the creator console in vitest. play-web has NO vitest wiring
// (no `vitest` devDependency, no `vitest.config.ts`, no `test` script), so this
// suite is a `scripts/test-*.ts` tsx assertion script instead — automatically
// discovered by `scripts/run-unit-tests.mjs` and therefore by `npm test`, with
// ZERO new configuration and no new test framework. Same invariants, same
// helpers, same detector self-checks; house style of the neighbouring scripts.
//
// What already exists, and what this adds:
//   scripts/check-i18n.ts     A1–A4 for both apps — but PART A is a *script*,
//                             and it is the same program that owns the rules,
//                             so nothing in `npm test` fails when it regresses.
//   scripts/test-i18n-parity.ts  key parity + English-in-HE — but its
//                             `leafStrings()` returns [] for a FUNCTION, so
//                             every function-valued entry (roughly a third of
//                             this dictionary) is invisible to it.
//
// Pinned here:
//   A1  identical recursive key sets HE↔EN
//   A2  identical leaf TYPE per key, and identical ARITY for function entries
//   A3  no English word in any HE leaf — INCLUDING function output
//   A4  no Hebrew letter in any EN leaf — INCLUDING function output
//   A5  function entries are EXERCISED (called, output asserted, throws = fail)
//   A6  no empty / whitespace-only leaf
//   A7  brand vocabulary: the retired "מירוץ הרפתקה" never returns
//   A8  interpolation safety: no raw {placeholder} / undefined / NaN /
//       [object Object] in any produced message, and an argument-taking entry
//       actually consumes its argument
//   +   detector self-checks, over LOCAL FIXTURES — never by mutating i18n.ts
//
// The helpers are re-derived rather than imported from check-i18n.ts on purpose:
// that script is a top-level program that runs its whole scan and calls
// process.exit() at import time, and a test that imports its subject only proves
// the subject agrees with itself. The cost is a duplicated whitelist — accepted,
// because duplication makes this suite the STRICTER of the two, which fails safe.
//
// No emulator, no DOM, no network.
//   npx tsx scripts/test-play-web-i18n-dictionary.ts
// ─────────────────────────────────────────────────────────────────────────────
import { translations } from '../apps/play-web/src/i18n';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}${detail ? '\n        ' + detail : ''}`);
  }
}
function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}
// Assert a derived list is empty, printing the offenders (which key, not a count).
function okEmpty(list: string[], msg: string): void {
  ok(list.length === 0, msg, list.slice(0, 8).join('\n        '));
}
function okEqual(actual: string[], expected: string[], msg: string): void {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    msg,
    `got [${actual.join(', ')}] want [${expected.join(', ')}]`,
  );
}

const HEBREW = /[֐-׿]/;

// Brand names / units / acronyms that may legitimately stay Latin inside Hebrew
// copy, the language-toggle label, and the structural direction values.
// Kept in sync with scripts/check-i18n.ts (the authoritative gate).
const LATIN_WHITELIST = [
  'RushPoint', 'Creator Pro', 'Pro', 'QR', 'SOS', 'GPS', 'Google', 'YouTube', 'PWA',
  'English', 'rtl', 'ltr', '₪',
];
// Hebrew allowed inside English copy: a language's own name in the toggle.
const HEBREW_WHITELIST = ['עברית'];

// The pre-rebrand wording for the product. The brand is now a "field game" /
// "משחק שדה". Only the COMPLETE retired phrase is banned — the bare noun
// "הרפתקה" is an ordinary Hebrew word and legitimate copy may use it.
const RETIRED_BRAND_HE = 'מירוץ הרפתקה';
const RETIRED_BRAND_EN = /race adventure/i;

function stripAll(s: string, words: string[]): string {
  let out = s;
  for (const w of words) out = out.split(w).join('');
  return out;
}
// A "Latin English word" = 2+ consecutive ASCII letters left after whitelisting.
// Tokens containing a digit (sample codes/ids like "FOX42") are not copy.
function hasEnglishWord(s: string): boolean {
  const noCodes = stripAll(s, LATIN_WHITELIST).replace(/[A-Za-z]*\d[A-Za-z\d]*/g, '');
  return /[A-Za-z]{2,}/.test(noCodes);
}
function hasHebrew(s: string): boolean {
  return HEBREW.test(stripAll(s, HEBREW_WHITELIST));
}

// ── Universal sample argument ────────────────────────────────────────────────
// play-web entries take either positional primitives — (name: string), (n:
// number) — or a single destructured object — ({ done, total }), ({ dist,
// radius }). One Proxy satisfies every shape: it coerces to `token` and answers
// any property access with `token`. `Symbol.iterator` is left undefined so an
// array-expecting entry throws loudly (a real Hebrew-mode crash) instead of
// hanging. Two distinct tokens let A8 prove the argument is actually consumed.
function sampleArg(token: number): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return (hint: string) => (hint === 'string' ? String(token) : token);
      if (prop === 'toString') return () => String(token);
      if (prop === 'valueOf') return () => token;
      if (prop === Symbol.iterator) return undefined;
      return token;
    },
  });
}
const TOKEN_A = 7;
const TOKEN_B = 4242;

type Leaf = { path: string; value: string };
type ThrowingLeaf = { path: string; error: string };
type Walk = { leaves: Leaf[]; threw: ThrowingLeaf[]; fnPaths: string[] };

// Every rendered message, with function entries CALLED. `threw` collects the
// entries that failed — a formatter that explodes on plausible arguments is a
// defect, not something to skip. `fnPaths` records which leaves were functions
// so A5 can prove they were reached.
function walkLeaves(obj: unknown, token = TOKEN_A): Walk {
  const leaves: Leaf[] = [];
  const threw: ThrowingLeaf[] = [];
  const fnPaths: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (typeof node === 'string') { leaves.push({ path, value: node }); return; }
    if (typeof node === 'function') {
      fnPaths.push(path);
      try {
        const a = sampleArg(token);
        const out = (node as (...x: unknown[]) => unknown)(a, a, a);
        if (typeof out === 'string') leaves.push({ path, value: out });
      } catch (e) {
        threw.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      visit(v, path ? `${path}.${k}` : k);
    }
  };
  visit(obj, '');
  return { leaves, threw, fnPaths };
}

// A function is a LEAF, not a namespace: its own properties (length, name) are
// not dictionary keys. Matches check-i18n.ts exactly.
function keysDeep(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...keysDeep(v, prefix ? `${prefix}.${k}` : k));
  }
  return out.sort();
}

function leafTypes(obj: unknown, prefix = '', acc: Record<string, string> = {}): Record<string, string> {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') {
    acc[prefix] = typeof obj;
    return acc;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    leafTypes(v, prefix ? `${prefix}.${k}` : k, acc);
  }
  return acc;
}

// Declared parameter count of every function leaf, by key path. A HE formatter
// taking ({done,total}) whose EN twin takes nothing renders a half-built string.
function leafArities(obj: unknown, prefix = '', acc: Record<string, number> = {}): Record<string, number> {
  if (typeof obj === 'function') { acc[prefix] = (obj as { length: number }).length; return acc; }
  if (obj === null || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    leafArities(v, prefix ? `${prefix}.${k}` : k, acc);
  }
  return acc;
}

// A8 detectors. `{name}` / `%s` / `$1` surviving into the output means the
// message was templated with the wrong syntax; `undefined` / `NaN` /
// `[object Object]` mean an argument was destructured under the wrong shape.
const RAW_PLACEHOLDER = /\{\s*[A-Za-z_]\w*\s*\}|%[sd]\b|\$\{/;
function interpolationDefect(value: string): string | null {
  if (RAW_PLACEHOLDER.test(value)) return 'raw placeholder';
  if (/\bundefined\b/.test(value)) return 'undefined';
  if (/\bNaN\b/.test(value)) return 'NaN';
  if (value.includes('[object Object]')) return '[object Object]';
  return null;
}

const he = translations.he;
const en = translations.en;
const LANGS = [['he', he], ['en', en]] as const;

console.log('\n\x1b[1m🌐 play-web i18n dictionary invariants\x1b[0m');

// ── A1 · structural parity ───────────────────────────────────────────────────
section('A1 — identical recursive key sets');
{
  const heKeys = keysDeep(he);
  const enKeys = keysDeep(en);
  const heSet = new Set(heKeys);
  const enSet = new Set(enKeys);
  ok(heKeys.length > 0, `the dictionary is non-empty (${heKeys.length} keys)`);
  okEmpty(heKeys.filter((k) => !enSet.has(k)), 'every HE key exists in EN');
  okEmpty(enKeys.filter((k) => !heSet.has(k)), 'every EN key exists in HE');
}

// ── A2 · leaf type + arity parity ────────────────────────────────────────────
section('A2 — identical leaf type and arity per key');
{
  const heTypes = leafTypes(he);
  const enTypes = leafTypes(en);
  // Type drift renders "function (n) { … }" on screen in one language, or
  // throws when the UI calls a plain string. User-visible, one language only.
  okEmpty(
    Object.keys(heTypes)
      .filter((k) => k in enTypes && heTypes[k] !== enTypes[k])
      .map((k) => `${k}: he=${heTypes[k]} en=${enTypes[k]}`),
    'no leaf-type drift between languages',
  );

  const heAr = leafArities(he);
  const enAr = leafArities(en);
  okEmpty(
    Object.keys(heAr)
      .filter((k) => k in enAr && heAr[k] !== enAr[k])
      .map((k) => `${k}: he takes ${heAr[k]} arg(s), en takes ${enAr[k]}`),
    'every function entry declares the same arity in both languages',
  );
}

// ── A6 · no empty leaf ───────────────────────────────────────────────────────
section('A6 — no empty or whitespace-only message');
for (const [lang, dict] of LANGS) {
  const { leaves } = walkLeaves(dict);
  okEmpty(
    leaves.filter((l) => l.value.trim() === '').map((l) => `${lang}.${l.path}`),
    `${lang}: every message renders visible text`,
  );
}

// ── A3 / A4 · language purity, over strings AND function output ──────────────
section('A3/A4 — each language is genuinely that language');
{
  const heWalk = walkLeaves(he);
  okEmpty(
    heWalk.leaves.filter((l) => hasEnglishWord(l.value)).map((l) => `${l.path}="${l.value}"`),
    'he: no English word in any Hebrew message',
  );

  const enWalk = walkLeaves(en);
  // No pure-logic coverage of this direction existed for play-web before.
  okEmpty(
    enWalk.leaves.filter((l) => hasHebrew(l.value)).map((l) => `${l.path}="${l.value}"`),
    'en: no Hebrew letter in any English message',
  );

  // The whitelist is the one place this suite could rot into a rubber stamp: if
  // no Hebrew copy actually relies on a whitelisted term, it is dead weight that
  // only weakens the purity rule, and it should be narrowed instead.
  ok(
    LATIN_WHITELIST.some((w) => heWalk.leaves.some((l) => l.value.includes(w))),
    'the Latin whitelist stays load-bearing (some HE copy really uses it)',
  );
}

// ── A5 · function entries are EXERCISED (the parity-script blind spot) ───────
section('A5 — function-valued entries are called, not skipped');
for (const [lang, dict] of LANGS) {
  const walk = walkLeaves(dict);
  const fnCount = Object.values(leafTypes(dict)).filter((t) => t === 'function').length;
  ok(fnCount > 0, `${lang}: the dictionary really has function entries (${fnCount})`);
  ok(
    walk.fnPaths.length === fnCount,
    `${lang}: every one of the ${fnCount} function entries was reached and called`,
    `reached ${walk.fnPaths.length}`,
  );
  okEmpty(
    walk.threw.map((t) => `${lang}.${t.path}: ${t.error}`),
    `${lang}: no function entry throws on plausible arguments`,
  );
  okEmpty(
    walk.fnPaths.filter((p) => !walk.leaves.some((l) => l.path === p)).map((p) => `${lang}.${p}`),
    `${lang}: every function entry returns a string message`,
  );
}

// ── A8 · interpolation safety ────────────────────────────────────────────────
section('A8 — interpolation is consumed, nothing raw leaks out');
for (const [lang, dict] of LANGS) {
  const walkA = walkLeaves(dict, TOKEN_A);
  const walkB = walkLeaves(dict, TOKEN_B);
  okEmpty(
    walkA.leaves
      .map((l) => ({ l, defect: interpolationDefect(l.value) }))
      .filter((x) => x.defect)
      .map((x) => `${lang}.${x.l.path}: ${x.defect} in "${x.l.value}"`),
    `${lang}: no raw placeholder / undefined / NaN / [object Object] in any message`,
  );

  // An argument-taking entry whose message is byte-identical for two very
  // different arguments never used them — the interpolation was dropped.
  const arities = leafArities(dict);
  const byPathB = new Map(walkB.leaves.map((l) => [l.path, l.value]));
  okEmpty(
    walkA.leaves
      .filter((l) => (arities[l.path] ?? 0) > 0 && byPathB.get(l.path) === l.value)
      .map((l) => `${lang}.${l.path}="${l.value}"`),
    `${lang}: every argument-taking entry actually consumes its argument`,
  );
}

// ── A7 · brand vocabulary ────────────────────────────────────────────────────
section('A7 — current brand vocabulary (field game / משחק שדה)');
{
  okEmpty(
    walkLeaves(he).leaves.filter((l) => l.value.includes(RETIRED_BRAND_HE)).map((l) => l.path),
    'he: the retired "מירוץ הרפתקה" wording never returns',
  );
  okEmpty(
    walkLeaves(en).leaves.filter((l) => RETIRED_BRAND_EN.test(l.value)).map((l) => l.path),
    'en: the retired "race adventure" wording never returns',
  );
  // Only the COMPLETE retired phrase is banned; the everyday words it was built
  // from stay available to ordinary copy.
  ok(!'פרק 1: ההרפתקה מתחילה'.includes(RETIRED_BRAND_HE), 'the bare noun "הרפתקה" is still allowed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Detector self-check.
//
// Every assertion above passes today, which on its own proves nothing: a broken
// detector also reports "no problems". These cases feed each rule a LOCAL
// FIXTURE dictionary that is deliberately defective and require it to notice.
// The real i18n.ts is never mutated — it is a shared file that other lanes are
// editing concurrently, and mutating it to demonstrate a red is a needless risk.
// ─────────────────────────────────────────────────────────────────────────────
section('Detector self-check — each rule is proven able to go red');
{
  // A1 — a key present in only one language.
  const a1he = { join: { code: 'קוד', staff: 'צוות' } };
  const a1en = { join: { code: 'Code' } };
  const a1enSet = new Set(keysDeep(a1en));
  okEqual(keysDeep(a1he).filter((k) => !a1enSet.has(k)), ['join.staff'], 'A1 detects a key missing on one side');

  // A2 — leaf type drift, and arity drift.
  const a2he = { task: { stopOf: ({ n }: { n: number }) => `עצור ${n}` } };
  const a2en = { task: { stopOf: 'Stop' } };
  const a2ht = leafTypes(a2he);
  const a2et = leafTypes(a2en);
  okEqual(
    Object.keys(a2ht).filter((k) => k in a2et && a2ht[k] !== a2et[k]),
    ['task.stopOf'],
    'A2 detects leaf-type drift',
  );
  const a2arHe = leafArities({ final: { rank: (r: number) => `מקום ${r}` } });
  const a2arEn = leafArities({ final: { rank: () => 'Rank' } });
  okEqual(
    Object.keys(a2arHe).filter((k) => k in a2arEn && a2arHe[k] !== a2arEn[k]),
    ['final.rank'],
    'A2 detects arity drift between languages',
  );

  // A6 — empty leaf.
  okEqual(
    walkLeaves({ join: { code: 'קוד', staff: '   ' } }).leaves
      .filter((l) => l.value.trim() === '').map((l) => l.path),
    ['join.staff'],
    'A6 detects a whitespace-only message',
  );

  // A3 — English inside a HE FUNCTION entry. This is the exact blind spot of
  // scripts/test-i18n-parity.ts, whose leafStrings() returns [] for a function.
  okEqual(
    walkLeaves({ task: { stopOf: ({ n }: { n: number }) => `Stop number ${n}` } }).leaves
      .filter((l) => hasEnglishWord(l.value)).map((l) => l.path),
    ['task.stopOf'],
    'A3 detects English inside a Hebrew FUNCTION entry (the parity-script blind spot)',
  );

  // A4 — Hebrew inside an EN entry, string and function.
  okEqual(
    walkLeaves({ join: { staff: 'צוות' }, final: { rank: (r: number) => `מקום ${r}` } }).leaves
      .filter((l) => hasHebrew(l.value)).map((l) => l.path).sort(),
    ['final.rank', 'join.staff'],
    'A4 detects Hebrew inside an English entry, including a function entry',
  );

  // Negative cases — the whitelist must not become a rubber stamp, and must not
  // over-fire on brand terms, sample access codes, or the toggle label.
  ok(!hasEnglishWord('פתחו את RushPoint וסרקו את קוד ה־QR'), 'A3 does not flag whitelisted brand terms');
  ok(!hasEnglishWord('קוד הגישה: FOX42'), 'A3 does not flag a sample access code');
  ok(!hasHebrew('Switch to עברית'), 'A4 does not flag the language-toggle label');

  // A5 — a formatter that throws is recorded, never silently dropped.
  const a5 = walkLeaves({ board: { names: (rows: string[]) => rows.join(', ') } });
  okEqual(a5.leaves.map((l) => l.path), [], 'A5 drops nothing silently: the throwing entry yields no leaf');
  okEqual(a5.threw.map((t) => t.path), ['board.names'], 'A5 records a function entry that throws');

  // A8 — raw placeholder / undefined / NaN, and an ignored argument.
  ok(interpolationDefect('שלב {step} מתוך 3') === 'raw placeholder', 'A8 detects a raw {placeholder}');
  ok(interpolationDefect('Stop %s of 3') === 'raw placeholder', 'A8 detects a printf-style placeholder');
  ok(interpolationDefect('נותרו undefined שניות') === 'undefined', 'A8 detects a leaked undefined');
  ok(interpolationDefect('NaN נקודות') === 'NaN', 'A8 detects a leaked NaN');
  ok(interpolationDefect('בידי [object Object]') === '[object Object]', 'A8 detects a stringified object');
  ok(interpolationDefect('עצור 7 מתוך 7') === null, 'A8 does not flag a correctly rendered message');

  const a8fixture = { task: { stopOf: (_n: number) => 'עצור' } };
  const a8arity = leafArities(a8fixture);
  const a8a = walkLeaves(a8fixture, TOKEN_A).leaves;
  const a8b = new Map(walkLeaves(a8fixture, TOKEN_B).leaves.map((l) => [l.path, l.value]));
  okEqual(
    a8a.filter((l) => (a8arity[l.path] ?? 0) > 0 && a8b.get(l.path) === l.value).map((l) => l.path),
    ['task.stopOf'],
    'A8 detects an argument-taking entry that ignores its argument',
  );

  // A7 — retired brand wording, both languages.
  okEqual(
    walkLeaves({ join: { subtitle: 'הצטרפו למירוץ הרפתקה' } }).leaves
      .filter((l) => l.value.includes(RETIRED_BRAND_HE)).map((l) => l.path),
    ['join.subtitle'],
    'A7 detects the retired Hebrew brand phrase',
  );
  okEqual(
    walkLeaves({ join: { subtitle: 'Join the race adventure' } }).leaves
      .filter((l) => RETIRED_BRAND_EN.test(l.value)).map((l) => l.path),
    ['join.subtitle'],
    'A7 detects the retired English brand phrase',
  );
}

console.log(
  `\n${failed === 0 ? `\x1b[32m✓ ALL ${passed} PLAY-WEB I18N DICTIONARY ASSERTIONS PASSED\x1b[0m` : `\x1b[31m✗ ${failed} of ${passed + failed} ASSERTION(S) FAILED\x1b[0m`}\n`,
);
process.exit(failed === 0 ? 0 : 1);
