// Static accessibility guard for the participant app (change: play-web-accessibility).
//
// play-web is played OUTDOORS, walking, one handed, in bright sun, usually in
// Hebrew, often by a child or an older relative. It has no component test runner,
// so the only thing that can stop an a11y regression from shipping is a SOURCE
// scan. This is that scan, plus the unit tests that keep it honest.
//
// Three mechanical rules (all decidable from the token text) and one real oracle:
//   1. no physical-direction Tailwind class  — Hebrew is the DEFAULT language;
//   2. no icon-only <button> without an accessible name;
//   3. no onClick on a non-interactive element (mouse/touch only, no keyboard);
//   4. the theme's ink colours still clear WCAG AA against the app's surfaces.
//
// Every rule is tested BOTH ways: fixtures that must flag AND fixtures that must
// NOT. A guard that cries wolf gets disabled, which is worse than no guard.
//
//   npx tsx scripts/test-play-a11y-scan.ts
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPhysicalDirectionClasses,
  findUnlabelledIconButtons,
  findClickableNonInteractive,
  findLowContrastWhiteOnFill,
  contrastRatio,
  parseColorTokens,
  playWebTsxFiles,
} from './lib/playA11yScan';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAY = join(ROOT, 'apps', 'play-web');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) { passed++; console.log(`PASS  ${msg}`); }
  else { failed++; console.log(`FAIL  ${msg}${detail ? ' :: ' + detail : ''}`); }
}

// ── A. Physical-direction classes ─────────────────────────────────────────────
const MUST_FLAG_DIR = [
  '<div className="ml-2" />',
  '<div className="pr-3" />',
  '<p className="text-left">x</p>',
  '<div className="absolute left-2 z-10" />',
  '<div className="border-l border-glass-border" />',
  '<div className="sm:pl-4" />',
  '<div className="hover:mr-1" />',
  '<div className="-right-2" />',
  '<div className="rounded-l" />',
];
for (const src of MUST_FLAG_DIR) {
  ok(findPhysicalDirectionClasses(src, 'fx.tsx').length > 0, `flags physical class in ${src}`);
}

const MUST_NOT_FLAG_DIR = [
  '<div className="ms-2 me-3 ps-1 pe-1 start-2 end-4 text-start text-end" />',
  '<div className="rounded-lg rounded-2xl" />',
  '<div className="overflow-x-auto" />',
  '<div className="grid-rows-2 grid-cols-3" />',
  '<div className="border-rp-alert/30 border" />',
  '<div className="p-4 py-2 px-3 m-1 -mx-1" />',
  '<div className="min-h-[44px] max-w-md" />',
  '<div className="text-lefty" />',
  '<span dir="rtl">x</span>',
  '// the badge used to sit to the left of the title, aligned right',
  '<div className="absolute top-0 left-1/2 -translate-x-1/2 w-96" />',
  '<div className="bg-gradient-to-r from-rp-fire to-rp-amber" />',
];
for (const src of MUST_NOT_FLAG_DIR) {
  const f = findPhysicalDirectionClasses(src, 'fx.tsx');
  ok(f.length === 0, `does NOT flag ${src.slice(0, 56)}`, f.map((x) => x.detail).join(', '));
}
ok(findPhysicalDirectionClasses('\n\n<div className="ml-2" />', 'fx.tsx')[0]?.line === 3,
  'reports a 1-based line number');
ok(findPhysicalDirectionClasses('', 'fx.tsx').length === 0, 'empty source yields no findings');

// ── B. Icon-only buttons with no accessible name ──────────────────────────────
const MUST_FLAG_BTN = [
  '<button onClick={x}>✕</button>',
  '<button className="w-11 h-11">▾</button>',
  '<button onClick={x}>  📷  </button>',
  '<button onClick={x}>↑</button>',
];
for (const src of MUST_FLAG_BTN) {
  ok(findUnlabelledIconButtons(src, 'fx.tsx').length > 0, `flags icon-only button ${src.slice(0, 46)}`);
}

const MUST_NOT_FLAG_BTN = [
  '<button aria-label={t.join.removeMember(m)} onClick={x}>✕</button>',
  '<button aria-labelledby="lbl">▾</button>',
  '<button title="close">✕</button>',
  '<button onClick={x}>📖 {t.play.howToPlay}</button>',
  '<button onClick={x}>Continue</button>',
  '<button onClick={x}>{children}</button>',
  '<Button variant="ghost" onClick={x}>✕</Button>',
  '<button onClick={x}>המשך</button>',
];
for (const src of MUST_NOT_FLAG_BTN) {
  const f = findUnlabelledIconButtons(src, 'fx.tsx');
  ok(f.length === 0, `does NOT flag labelled/worded button ${src.slice(0, 46)}`, f.map((x) => x.detail).join(', '));
}

// ── C. onClick on a non-interactive element ───────────────────────────────────
const MUST_FLAG_CLICK = [
  '<div className="cursor-pointer" onClick={advance}>x</div>',
  '<span onClick={go} className="x">y</span>',
  '<li onClick={go}>y</li>',
];
for (const src of MUST_FLAG_CLICK) {
  ok(findClickableNonInteractive(src, 'fx.tsx').length > 0, `flags click handler on ${src.slice(0, 40)}`);
}
const MUST_NOT_FLAG_CLICK = [
  '<button onClick={go}>go</button>',
  '<a onClick={go} href="#">go</a>',
  '<Card onClick={go}>go</Card>',
  '<div role="button" tabIndex={0} onClick={go} onKeyDown={k}>go</div>',
  '<input onChange={go} />',
  '<div className="x">plain</div>',
];
for (const src of MUST_NOT_FLAG_CLICK) {
  const f = findClickableNonInteractive(src, 'fx.tsx');
  ok(f.length === 0, `does NOT flag ${src.slice(0, 46)}`, f.map((x) => x.detail).join(', '));
}

// ── D. Contrast arithmetic + the ink-token oracle ─────────────────────────────
ok(Math.round(contrastRatio('#000000', '#ffffff')) === 21, 'black on white is 21:1');
ok(contrastRatio('#123456', '#123456') === 1, 'a colour against itself is 1:1');
ok(contrastRatio('#FF5722', '#FFFFFF') === contrastRatio('#FFFFFF', '#FF5722'), 'the ratio is symmetric');
ok(Number.isNaN(contrastRatio('nope', '#fff')), 'an unparseable colour yields NaN, never a false pass');
// The two numbers this whole change exists because of. If these move, the formula moved.
ok(contrastRatio('#FF5722', '#FFFFFF').toFixed(2) === '3.16',
  'regression pin: brand fire on white is 3.16:1 (below AA)', contrastRatio('#FF5722', '#FFFFFF').toFixed(2));
ok(contrastRatio('#FFB300', '#FFF0E6').toFixed(2) === '1.61',
  'regression pin: brand amber on the raised surface is 1.61:1', contrastRatio('#FFB300', '#FFF0E6').toFixed(2));

// The app's three text surfaces, from tailwind.config.js / index.css.
const SURFACES: Record<string, string> = { 'app-surface': '#FFFFFF', 'app-bg': '#FFFCF7', 'app-raised': '#FFF0E6' };
const AA = 4.5;
const tw = readFileSync(join(PLAY, 'tailwind.config.js'), 'utf8');
const tokens = parseColorTokens(tw);
const INK = ['ink-fire', 'ink-warm', 'ink-amber', 'ink-alert', 'ink-go'];
for (const name of INK) {
  const hex = tokens[name];
  ok(typeof hex === 'string', `tailwind.config.js defines "${name}"`);
  if (!hex) continue;
  for (const [sname, shex] of Object.entries(SURFACES)) {
    const r = contrastRatio(hex, shex);
    ok(r >= AA, `${name} (${hex}) clears AA on ${sname}`, `${r.toFixed(2)}:1`);
  }
}

// ── D2. White text on a brand fill ────────────────────────────────────────────
// The mirror of D: D fixed coloured text on a light surface, this catches white
// text on a saturated fill. Both fixtures directions, because the tint idiom
// (`bg-accent/15 text-ink-fire`) and the darkened gradient (`from-[#C2410C]`)
// are everywhere in this app and must never be flagged.
const MUST_FLAG_FILL = [
  '<button className="bg-rp-alert text-white font-semibold">go</button>',
  '<button className="rounded-full bg-accent px-4 py-2 text-white">send</button>',
  '<span className="bg-rp-amber text-white">x</span>',
  '<span className="bg-rp-go text-white">x</span>',
];
for (const src of MUST_FLAG_FILL) {
  ok(findLowContrastWhiteOnFill(src, tokens, 'fx.tsx').length > 0,
    `flags white-on-fill in ${src.slice(0, 52)}`);
}
const MUST_NOT_FLAG_FILL = [
  // The darkened variants this change introduced.
  '<button className="bg-ink-alert text-white">go</button>',
  '<button className="bg-ink-fire text-white">go</button>',
  '<button className="bg-ink-warm text-white">go</button>',
  // A translucent tint is never a white-text surface.
  '<span className="bg-accent/15 text-ink-fire border border-accent/30">x</span>',
  '<span className="bg-rp-alert/10 text-ink-alert">x</span>',
  // The primary Button: a gradient whose real colours are in from-/to-.
  '<button className="bg-gradient-to-r from-[#C2410C] to-[#B45309] text-white">go</button>',
  // No white text at all.
  '<div className="bg-accent text-zinc-100">x</div>',
  // An unknown token is skipped, never guessed.
  '<div className="bg-not-a-token text-white">x</div>',
  '<div className="text-white">x</div>',
];
for (const src of MUST_NOT_FLAG_FILL) {
  const f = findLowContrastWhiteOnFill(src, tokens, 'fx.tsx');
  ok(f.length === 0, `does NOT flag ${src.slice(0, 52)}`, f.map((x) => x.detail).join(', '));
}
ok(findLowContrastWhiteOnFill('<div className="bg-rp-alert text-white" />', {}, 'fx.tsx').length === 0,
  'an empty token map yields no findings rather than a guess');
// The two numbers that motivated this rule.
ok(contrastRatio('#EF4444', '#FFFFFF').toFixed(2) === '3.76',
  'regression pin: white on brand alert is 3.76:1 (below AA)', contrastRatio('#EF4444', '#FFFFFF').toFixed(2));
ok(contrastRatio('#C21414', '#FFFFFF').toFixed(2) === '6.17',
  'regression pin: white on ink-alert is 6.17:1 (clears AA)', contrastRatio('#C21414', '#FFFFFF').toFixed(2));

// ── E. The guard doing its actual job, over the real app ──────────────────────
const files = playWebTsxFiles(join(PLAY, 'src'));
ok(files.length > 20, `found play-web components to scan`, String(files.length));
const dirFindings = files.flatMap((f) => findPhysicalDirectionClasses(readFileSync(f, 'utf8'), relative(ROOT, f)));
ok(dirFindings.length === 0, 'no physical-direction classes in apps/play-web/src',
  dirFindings.map((f) => `${f.file}:${f.line} ${f.detail}`).join(' | '));
const btnFindings = files.flatMap((f) => findUnlabelledIconButtons(readFileSync(f, 'utf8'), relative(ROOT, f)));
ok(btnFindings.length === 0, 'no icon-only buttons without a name in apps/play-web/src',
  btnFindings.map((f) => `${f.file}:${f.line} ${f.detail}`).join(' | '));
const clickFindings = files.flatMap((f) => findClickableNonInteractive(readFileSync(f, 'utf8'), relative(ROOT, f)));
ok(clickFindings.length === 0, 'no onClick on non-interactive elements in apps/play-web/src',
  clickFindings.map((f) => `${f.file}:${f.line} ${f.detail}`).join(' | '));
const fillFindings = files.flatMap((f) => findLowContrastWhiteOnFill(readFileSync(f, 'utf8'), tokens, relative(ROOT, f)));
ok(fillFindings.length === 0, 'no white text on a sub-AA brand fill in apps/play-web/src',
  fillFindings.map((f) => `${f.file}:${f.line} ${f.detail}`).join(' | '));

// Safe area + zoom: the PWA opts into the display cutout, so it must handle it.
const css = readFileSync(join(PLAY, 'src', 'index.css'), 'utf8');
ok(css.includes('env(safe-area-inset-bottom'), 'index.css pads the page end by the bottom safe-area inset');
ok(css.includes('env(safe-area-inset-top'), 'index.css offsets fixed top chrome by the top safe-area inset');
const html = readFileSync(join(PLAY, 'index.html'), 'utf8');
const viewport = /<meta[^>]*name="viewport"[^>]*>/.exec(html)?.[0] ?? '';
ok(viewport.includes('viewport-fit=cover'), 'the viewport still opts into the display cutout');
ok(!/maximum-scale|user-scalable\s*=\s*no/.test(viewport),
  'the viewport does not block pinch zoom (WCAG 1.4.4)', viewport);

console.log(`\n${failed === 0 ? `ALL PLAY-WEB A11Y SCAN TESTS PASSED (${passed})` : `${failed} FAILED, ${passed} passed`}`);
process.exit(failed === 0 ? 0 : 1);
