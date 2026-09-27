// The creator console's phone-input mechanics (change: creator-mobile-mechanics).
//
// Reported symptom: "building a game on an iPhone is very cumbersome, the site
// keeps getting bigger and smaller, scrolling becomes complicated". Both halves
// have exact causes, both are invisible to every other gate, and both are the
// kind of thing that silently comes back the next time someone tidies a class
// string. See scripts/lib/mobileFormZoom.ts for why each rule is shaped the way
// it is.
//
// No emulator, no DOM.
//   npx tsx scripts/test-mobile-form-zoom.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIN_MOBILE_FONT_PX,
  SCROLL_GUARDED_FILES,
  parseViewportContent,
  viewportZoomLockFindings,
  resizesForKeyboard,
  mediaBlocks,
  hasMobileFormFontFloor,
  findFontSizeTransitions,
  findScrollContainersMissingOverscroll,
} from './lib/mobileFormZoom';

const ROOT = join(import.meta.dirname, '..');
const NL = '\n    ';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ── 1. unit: the viewport parser ────────────────────────────────────────────
console.log('\n── viewport meta ──');
{
  check('the content string is lifted out of the tag',
    parseViewportContent('<meta name="viewport" content="width=device-width, initial-scale=1" />')
      === 'width=device-width, initial-scale=1');

  check('attribute order inside the tag does not matter',
    parseViewportContent('<meta content="width=device-width" name="viewport">') === 'width=device-width');

  check('an unrelated meta is not mistaken for the viewport',
    parseViewportContent('<meta name="theme-color" content="#050508" />') === null);

  check('a document with no viewport meta reports a finding',
    viewportZoomLockFindings(null).length === 1);

  check('an ordinary viewport locks nothing',
    viewportZoomLockFindings('width=device-width, initial-scale=1.0').length === 0);

  check('user-scalable=no is reported',
    viewportZoomLockFindings('width=device-width, user-scalable=no').length === 1);

  check('maximum-scale=1 is reported',
    viewportZoomLockFindings('width=device-width, maximum-scale=1').length === 1);

  check('maximum-scale=5 is fine',
    viewportZoomLockFindings('width=device-width, maximum-scale=5').length === 0);

  check('both shortcuts at once are reported separately',
    viewportZoomLockFindings('user-scalable=no, maximum-scale=1').length === 2);

  check('interactive-widget is detected when present',
    resizesForKeyboard('width=device-width, interactive-widget=resizes-content'));

  check('...and absent when it is not',
    !resizesForKeyboard('width=device-width, initial-scale=1'));
}

// ── 2. unit: the stylesheet floor ───────────────────────────────────────────
console.log('\n── hasMobileFormFontFloor ──');
{
  const good = `
    @media (max-width: 639px) {
      input:not([type='checkbox']), textarea, select { font-size: 16px !important; }
    }`;
  check('a 16px !important floor on all three controls passes', hasMobileFormFontFloor(good).ok);

  check('1rem counts as 16px',
    hasMobileFormFontFloor(`@media (max-width: 639px) { input, textarea, select { font-size: 1rem !important; } }`).ok);

  check('15px is not a floor',
    !hasMobileFormFontFloor(`@media (max-width: 639px) { input, textarea, select { font-size: 15px !important; } }`).ok);

  check('a floor with no !important is refused (Tailwind text-sm would win)',
    !hasMobileFormFontFloor(`@media (max-width: 639px) { input, textarea, select { font-size: 16px; } }`).ok);

  check('...and it says why',
    hasMobileFormFontFloor(`@media (max-width: 639px) { input, textarea, select { font-size: 16px; } }`)
      .reason.includes('!important'));

  check('a floor outside a max-width query is refused',
    !hasMobileFormFontFloor(`input, textarea, select { font-size: 16px !important; }`).ok);

  check('missing <select> is refused',
    !hasMobileFormFontFloor(`@media (max-width: 639px) { input, textarea { font-size: 16px !important; } }`).ok);

  check('a class named .selected does not stand in for the select element',
    !hasMobileFormFontFloor(`@media (max-width: 639px) { input, textarea, .selected { font-size: 16px !important; } }`).ok);

  check('a nested media block does not break brace matching',
    mediaBlocks(`@media (max-width: 639px) { @supports (x: y) { a { b: c } } } @media print { d { e: f } }`).length === 2);

  check('an unbalanced stylesheet yields nothing rather than a wrong answer',
    mediaBlocks(`@media (max-width: 639px) { a { b: c }`).length === 0);
}

// ── 2b. unit: the font-size transition scan ─────────────────────────────────
console.log('\n── findFontSizeTransitions ──');
{
  const withAll = `export function Input({ x }) { return <input className="text-sm transition-all duration-150" />; }
export function Textarea() { return <textarea className="transition-[border-color] " />; }
export function Select() { return <select className="transition-[border-color]" />; }`;
  check('transition-all on Input is reported', findFontSizeTransitions(withAll).length === 1);
  check('...naming the control', findFontSizeTransitions(withAll)[0].includes('Input'));

  const named = withAll.replace('transition-all duration-150', 'transition-[border-color] duration-150');
  check('an explicit property list is clean', findFontSizeTransitions(named).length === 0);

  check('transition-all on a Button/Card is NOT a finding',
    findFontSizeTransitions(`export function Button() { return <button className="transition-all" />; }\n${named}`).length === 0);

  check('a renamed/removed factory is reported rather than silently passing',
    findFontSizeTransitions('export function Card() { return null; }').length === 3);
}

// ── 3. unit: the scroll scan ────────────────────────────────────────────────
console.log('\n── findScrollContainersMissingOverscroll ──');
{
  check('a bare overflow-y-auto is a finding',
    findScrollContainersMissingOverscroll('<div className="h-full overflow-y-auto">', 'X.tsx').length === 1);

  check('overscroll-contain on the same element clears it',
    findScrollContainersMissingOverscroll('<div className="overflow-y-auto overscroll-contain">', 'X.tsx').length === 0);

  check('overscroll-none also clears it',
    findScrollContainersMissingOverscroll('<div className="overflow-y-auto overscroll-none">', 'X.tsx').length === 0);

  check('a horizontal-only scroller is not a finding',
    findScrollContainersMissingOverscroll('<div className="overflow-x-auto">', 'X.tsx').length === 0);

  check('overflow-auto (both axes) IS a finding',
    findScrollContainersMissingOverscroll('<pre className="overflow-auto max-h-32">', 'X.tsx').length === 1);

  check('the finding carries a 1-based line number',
    findScrollContainersMissingOverscroll('a\nb\n<div className="overflow-y-auto">', 'X.tsx')[0]?.line === 3);

  check('a line comment naming the class is not a container',
    findScrollContainersMissingOverscroll('// `overflow-y-auto` is the safety valve here', 'X.tsx').length === 0);

  check('...nor a continuation line of a block comment',
    findScrollContainersMissingOverscroll(' * uses overflow-y-auto for the map pane', 'X.tsx').length === 0);
}

// ── 4. the real creator-web files ───────────────────────────────────────────
console.log('\n── apps/creator-web ──');
{
  const html = read('apps/creator-web/index.html');
  const content = parseViewportContent(html);

  const locks = viewportZoomLockFindings(content);
  check('the console does NOT buy zoom stability by forbidding zoom', locks.length === 0,
    locks.join(NL));

  check('the viewport asks the browser to resize for the keyboard', resizesForKeyboard(content),
    `content = ${JSON.stringify(content)}`);

  const css = read('apps/creator-web/src/index.css');
  const floor = hasMobileFormFontFloor(css);
  check(`index.css floors form controls at ${MIN_MOBILE_FONT_PX}px on phone widths`, floor.ok, floor.reason);

  check('index.css pins text-size-adjust so iOS does not inflate text on rotation',
    /-webkit-text-size-adjust\s*:\s*100%/.test(css));

  const transitions = findFontSizeTransitions(read('apps/creator-web/src/components/ui.tsx'));
  check('no ui-kit form control animates its font-size', transitions.length === 0,
    transitions.join(NL));

  for (const rel of SCROLL_GUARDED_FILES) {
    const findings = findScrollContainersMissingOverscroll(read(rel), rel);
    check(`${rel} contains no unguarded vertical scroller`, findings.length === 0,
      findings.map((f) => `${f.file}:${f.line}  ${f.snippet}`).join(NL));
  }
}

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
