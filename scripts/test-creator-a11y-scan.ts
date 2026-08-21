// Accessibility + contrast source scan for the CREATOR app.
// (change: creator-contrast-guard)
//
// play-web has had `scripts/test-play-a11y-scan.ts` for a while. creator-web —
// more than twice the size, and the app a creator lives in for hours while
// building a game — had no equivalent, so two whole defect classes could ship and
// then quietly come back:
//
//   1. The reversed zinc scale (see scripts/lib/creatorContrastScan.ts). This one
//      is not hypothetical: the logged-out landing page's phone mockup rendered
//      its two bold labels at ~1.1:1, and every confirm/alert dialog's message
//      body was near-black on near-black for creators whose OS is set to dark —
//      which is the DEFAULT, not an opt-in.
//   2. The generic markup invariants play-web already guards: an icon-only button
//      with no accessible name, and an `onClick` on a non-interactive element.
//
// (2) is scanned with the SAME functions play-web uses, deliberately, so the two
// apps cannot drift on what the rule means. Its baseline is a declared allowlist
// of counts rather than zero: creator-web has a real backlog here, and a gate that
// starts red is a gate people delete. The counts may only go DOWN.
//
// No emulator, no DOM.
//   npx tsx scripts/test-creator-a11y-scan.ts
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  playWebTsxFiles,
  findUnlabelledIconButtons,
  findClickableNonInteractive,
} from './lib/playA11yScan';
import {
  findReversedZincText, ALLOWED_FILES,
  findOverlayWithoutEscape, NO_ESCAPE_NEEDED,
  parseThemeTokens, CHECKED_SURFACES, INK_MINIMUMS,
  overlayZIndexes,
} from './lib/creatorContrastScan';
import { contrastRatio } from './lib/playA11yScan';

/** Indented newline for multi-line failure detail. */
const NL = '\n    ';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── unit: the scanner itself ─────────────────────────────────────────────────
console.log('\n── findReversedZincText ──');

const hit = findReversedZincText('<p className="text-sm text-zinc-700">x</p>', 'pages/X.tsx');
check('a bare text-zinc-700 is reported', hit.length === 1, JSON.stringify(hit));

check('a text-zinc class beside a static-light bg in the SAME literal is allowed',
  findReversedZincText('<span className="bg-app-bg/80 text-zinc-400">x</span>', 'pages/X.tsx').length === 0);

check('the opacity suffix on the bg is tolerated',
  findReversedZincText('<span className="bg-app-card/90 text-zinc-500">x</span>', 'pages/X.tsx').length === 0);

check('bg-glass-bg counts as static-light too',
  findReversedZincText('<b className="bg-glass-bg text-zinc-300">x</b>', 'pages/X.tsx').length === 0);

check('a THEMED surface in the same literal is NOT an escape',
  findReversedZincText('<b className="bg-[--surface-0] text-zinc-200">x</b>', 'pages/X.tsx').length === 1);

check('a hover: variant is caught',
  findReversedZincText('<b className="hover:text-zinc-800">x</b>', 'pages/X.tsx').length === 1);

check('a mention in a line comment is not a finding',
  findReversedZincText('// never use text-zinc-700 here\nconst a = 1;', 'pages/X.tsx').length === 0);

check('a mention in a block comment is not a finding',
  findReversedZincText('/* text-zinc-700 is reversed */\nconst a = 1;', 'pages/X.tsx').length === 0);

check('an allowlisted file is skipped',
  findReversedZincText('<b className="text-zinc-100">x</b>', 'apps/creator-web/src/components/ErrorBoundary.tsx').length === 0);

check('the allowlist matches on Windows separators too',
  findReversedZincText('<b className="text-zinc-100">x</b>', 'apps\\creator-web\\src\\components\\ShareSheet.tsx').length === 0);

check('two classes in one literal report twice',
  findReversedZincText('<b className="text-zinc-500 hover:text-zinc-200">x</b>', 'pages/X.tsx').length === 2);

check('bg-zinc-* is not a TEXT finding (a different call decides those)',
  findReversedZincText('<b className="bg-zinc-950">x</b>', 'pages/X.tsx').length === 0);

let threw = '';
for (const bad of ['', null, undefined, '"', '`${', '/*', "'unterminated"]) {
  try { findReversedZincText(bad as string, 'x.tsx'); } catch (e) { threw = `${JSON.stringify(bad)}: ${e}`; }
}
check('never throws on malformed source', threw === '', threw);

check('every allowlist entry states WHY it is allowed',
  Object.values(ALLOWED_FILES).every((r) => typeof r === 'string' && r.trim().length > 10),
  JSON.stringify(ALLOWED_FILES));

// ── the live scan over apps/creator-web ──────────────────────────────────────
console.log('\n── apps/creator-web ──');

const ROOT = join(process.cwd(), 'apps', 'creator-web', 'src');
const files = playWebTsxFiles(ROOT);
check('the scan actually found the creator sources', files.length > 20, `${files.length} .tsx files`);

const zinc: string[] = [];
const noEscape: string[] = [];
let iconButtons = 0;
const clickable: string[] = [];
for (const abs of files) {
  const rel = relative(process.cwd(), abs).split(sep).join('/');
  const src = readFileSync(abs, 'utf8');
  for (const f of findReversedZincText(src, rel)) zinc.push(`${f.file}:${f.line} ${f.detail}`);
  for (const f of findOverlayWithoutEscape(src, rel)) noEscape.push(`${f.file}:${f.line} ${f.detail}`);
  iconButtons += findUnlabelledIconButtons(src, rel).length;
  for (const f of findClickableNonInteractive(src, rel)) clickable.push(`${f.file}:${f.line} ${f.detail}`);
}

check('no reversed-zinc text outside the declared allowlist',
  zinc.length === 0, zinc.length ? '\n    ' + zinc.join('\n    ') : '');

check('no icon-only button without an accessible name', iconButtons === 0, String(iconButtons));

check('every dismissible overlay also closes on Escape',
  noEscape.length === 0, noEscape.length ? NL + noEscape.join(NL) : '');

check('every no-Escape exemption states why',
  Object.values(NO_ESCAPE_NEEDED).every((r) => typeof r === 'string' && r.trim().length > 10),
  JSON.stringify(NO_ESCAPE_NEEDED));


// ── Theme tokens clear their contrast bar, in BOTH themes ────────────────────
// Read from the shipping stylesheet, not from a copy: the whole reason --ink-3
// drifted to 3.79:1 light / 2.42:1 dark is that nothing ever read this file.
console.log('\n── theme tokens ──');
const themeCss = readFileSync(join(ROOT, 'index.css'), 'utf8');
const themes = parseThemeTokens(themeCss);

check('both theme blocks were parsed',
  Object.keys(themes.light).length > 5 && Object.keys(themes.dark).length > 5,
  `light=${Object.keys(themes.light).length} dark=${Object.keys(themes.dark).length}`);

check('light and dark are actually DIFFERENT palettes (the split really split)',
  themes.light['--ink-1'] !== themes.dark['--ink-1'],
  `${themes.light['--ink-1']} vs ${themes.dark['--ink-1']}`);

for (const [mode, tokens] of [['light', themes.light], ['dark', themes.dark]] as const) {
  for (const [ink, min] of Object.entries(INK_MINIMUMS)) {
    const fg = tokens[ink];
    check(`${mode} ${ink} is defined`, typeof fg === 'string', String(fg));
    if (!fg) continue;
    for (const surface of CHECKED_SURFACES) {
      const bg = tokens[surface];
      if (!bg) continue;
      const r = contrastRatio(fg, bg);
      check(`${mode} ${ink} on ${surface} clears ${min}:1`,
        Number.isFinite(r) && r >= min, `${r.toFixed(2)}:1 (${fg} on ${bg})`);
    }
  }
}

// ── The blocking dialog outranks every other overlay ─────────────────────────
console.log('\n── overlay stacking ──');
{
  let dialogZ = 0;
  let otherMax = 0;
  let otherMaxFile = '';
  for (const abs of files) {
    const rel = relative(process.cwd(), abs).split(sep).join('/');
    const zs = overlayZIndexes(readFileSync(abs, 'utf8'));
    if (!zs.length) continue;
    if (rel.endsWith('components/dialog.tsx')) dialogZ = Math.max(...zs);
    else if (Math.max(...zs) > otherMax) { otherMax = Math.max(...zs); otherMaxFile = rel; }
  }
  check('the blocking dialog declares a z-index at all', dialogZ > 0, String(dialogZ));
  check('the blocking dialog outranks every other full-screen overlay',
    dialogZ > otherMax, `dialog=${dialogZ}, highest other=${otherMax} (${otherMaxFile})`);
}

// Declared baseline, ratcheting DOWN only. Most of these are modal backdrops
// (a click-to-dismiss overlay whose real control is the Esc handler and the
// labelled close button next to it); the rest are queued as a follow-up. Lower
// this number when you fix one — never raise it.
const CLICKABLE_BASELINE = 25;
check(`clickable non-interactive elements do not grow past ${CLICKABLE_BASELINE}`,
  clickable.length <= CLICKABLE_BASELINE, `${clickable.length} found`);
if (clickable.length < CLICKABLE_BASELINE) {
  console.log(`NOTE  baseline can be tightened to ${clickable.length} in scripts/test-creator-a11y-scan.ts`);
}

console.log(`\n${failures === 0 ? 'ALL CREATOR A11Y TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
