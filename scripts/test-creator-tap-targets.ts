// Tap-target guard for the creator console's GLYPH buttons.
//
// The creator console is authored on a phone now, and a UI/UX audit found the
// failure CLAUDE.md already names — "a 44px tap-target fix applied to one control
// does not travel to its siblings" — reproduced across it: two ✕ buttons had a
// real 44x44 box (each with a comment saying why) while fourteen siblings were
// bare glyphs rendering at their line height, ~16-20px. Among them the button that
// DELETES A STAGE, every modal's close, and the toast dismiss.
//
// So the sizes are declared once, in apps/creator-web/src/lib/interaction.ts, and
// this is the gate that keeps the next glyph button from skipping them. It runs
// the real constants against the real source, so shrinking a constant fails here
// too — the guard cannot be satisfied by moving the goalposts.
//
// Both directions are tested, as everywhere else in this repo: fixtures that MUST
// flag and fixtures that MUST NOT. A guard that cries wolf gets disabled, which is
// worse than no guard.
//
//   npx tsx scripts/test-creator-tap-targets.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classTextOf,
  expandAliases,
  findUndersizedGlyphButtons,
} from './lib/glyphTapTargets';
import {
  TAP_CLUSTER, TAP_INLINE, TAP_TARGET,
} from '../apps/creator-web/src/lib/interaction';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CREATOR_SRC = join(ROOT, 'apps', 'creator-web', 'src');
const ALIASES = { TAP_TARGET, TAP_INLINE, TAP_CLUSTER };

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) { passed++; console.log(`PASS  ${msg}`); }
  else { failed++; console.log(`FAIL  ${msg}${detail ? ' :: ' + detail : ''}`); }
}

// ── A. The house constants really are big enough ─────────────────────────────
// Stated as an assertion rather than trusted: everything below rests on them.
ok(/\bw-11\b/.test(TAP_TARGET) && /\bh-11\b/.test(TAP_TARGET),
  'TAP_TARGET is a 44x44 box', TAP_TARGET);
ok(/\bw-11\b/.test(TAP_INLINE) && /\bh-11\b/.test(TAP_INLINE) && /-m-2/.test(TAP_INLINE),
  'TAP_INLINE is a 44x44 box that overflows its slot', TAP_INLINE);
ok(/\bw-9\b/.test(TAP_CLUSTER) && /\bh-9\b/.test(TAP_CLUSTER),
  'TAP_CLUSTER is the documented 36x36 exception', TAP_CLUSTER);

// ── B. Fixtures that MUST flag ───────────────────────────────────────────────
const MUST_FLAG: Array<[string, string]> = [
  ['bare glyph, no class at all', '<button onClick={x}>✕</button>'],
  ['text-styled glyph', '<button className="text-neon-red text-sm">✕</button>'],
  ['24px box (WCAG AA floor, below the house floor)',
    '<button className="w-6 h-6 flex items-center justify-center">✕</button>'],
  ['28px box', '<button className="w-7 h-7 rounded">✕</button>'],
  ['32px box', '<button className="shrink-0 w-8 h-8 rounded-lg">✕</button>'],
  ['height only, no width', '<button className="h-11 rounded">↑</button>'],
  ['width only, no height', '<button className="w-11 rounded">↓</button>'],
  ['arrow glyph in a cluster with no box', '<button className="text-xs">↑</button>'],
  ['h-96 must not be read as h-9', '<button className="w-11 h-96">✕</button>'],
];
for (const [name, src] of MUST_FLAG) {
  ok(findUndersizedGlyphButtons(src, 'fx.tsx', ALIASES).length > 0, `flags: ${name}`, src);
}

// ── C. Fixtures that MUST NOT flag ───────────────────────────────────────────
const MUST_NOT_FLAG: Array<[string, string]> = [
  ['TAP_TARGET', '<button className={`${TAP_TARGET} rounded-lg`}>✕</button>'],
  ['TAP_INLINE', '<button className={`${TAP_INLINE} text-neon-red`}>✕</button>'],
  ['TAP_CLUSTER', '<button className={`${TAP_CLUSTER} rounded`}>↑</button>'],
  ['a text button (its own copy gives it size)',
    '<button className="text-sm">Save</button>'],
  ['a Hebrew text button', '<button className="text-sm">שמור</button>'],
  ['dynamic content is undecidable',
    "<button className=\"text-lg\">{menuOpen ? '✕' : '☰'}</button>"],
  ['an empty button (the unlabelled-icon scanner owns that case)',
    '<button className="text-lg" />'],
  ['a glyph wrapped in an aria-hidden span, correctly sized',
    '<button className={`${TAP_INLINE} rounded`}><span aria-hidden="true">✕</span></button>'],
  ['a segmented-control half sized by padding + min height',
    '<button className="px-3 min-h-9 rounded-md">▲</button>'],
  ['a declared opt-out',
    '<button className="text-xs" /* tap-target-ignore: decorative */>✕</button>'],
  ['a capitalised component is not a <button>',
    '<Button className="text-xs">✕</Button>'],
];
for (const [name, src] of MUST_NOT_FLAG) {
  const found = findUndersizedGlyphButtons(src, 'fx.tsx', ALIASES);
  ok(found.length === 0, `does not flag: ${name}`, found.map((f) => f.detail).join(' | '));
}

// ── D. The helpers, directly ─────────────────────────────────────────────────
ok(classTextOf(' className="a b" onClick={x}') === 'a b', 'classTextOf reads a quoted class');
ok(classTextOf(' className={`a ${X} b`}').includes('${X}'), 'classTextOf keeps template holes');
ok(classTextOf(' onClick={x}') === '', 'classTextOf returns empty when there is no class');
ok(expandAliases('${T} x', { T: 'w-11 h-11' }).includes('w-11'), 'expandAliases substitutes');
ok(expandAliases('${T} x', {}) === '${T} x', 'expandAliases with no aliases is identity');
ok(findUndersizedGlyphButtons('', 'x.tsx', ALIASES).length === 0, 'empty source is total');
// @ts-expect-error — deliberately hostile input: the scanner must not throw.
ok(findUndersizedGlyphButtons(null, 'x.tsx').length === 0, 'null source is total');

// ── E. The real creator-web source ───────────────────────────────────────────
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out.sort();
}

const files = tsxFiles(CREATOR_SRC);
ok(files.length > 20, `scanned ${files.length} creator-web .tsx files`);

const findings: string[] = [];
for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  for (const f of findUndersizedGlyphButtons(readFileSync(file, 'utf8'), rel, ALIASES)) {
    findings.push(`${f.file}:${f.line} ${f.detail}`);
  }
}
// Print the denominator, not just the verdict (CLAUDE.md: a check that examined
// nothing and a check that found nothing print the same line otherwise).
ok(findings.length === 0,
  `0 of ${files.length} creator-web files have an undersized glyph button`,
  '\n  ' + findings.join('\n  '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
