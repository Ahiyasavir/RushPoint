// Guard: no Tailwind utility may name a brand colour token that does not exist.
//
// Tailwind emits nothing for an unknown token — no warning, no build failure —
// so the class survives review looking completely ordinary. `bg-app` (the token
// is `app-card`; plain `app` has never existed) sat on both reorder buttons of
// the ordering task, rendering them as unfilled ghosts on a warm row. See
// lib/brandClassScan.ts for why the scan is scoped to our own namespaces only.
//
// Every rule is exercised BOTH ways — fixtures that must flag and fixtures that
// must not — because a scanner with false positives gets switched off, which is
// worse than having none.
//
//   npx tsx scripts/test-brand-class-scan.ts
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playWebTsxFiles } from './lib/playA11yScan';
import {
  findUnknownBrandColorClasses,
  flattenColorTokens,
  parseBrandColorClass,
} from './lib/brandClassScan';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAY = join(ROOT, 'apps', 'play-web');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) { passed++; console.log(`PASS  ${msg}`); }
  else { failed++; console.log(`FAIL  ${msg}${detail ? ' :: ' + detail : ''}`); }
}

// ── parseBrandColorClass ──────────────────────────────────────────────────────
const parseCases: Array<[string, { utility: string; token: string } | null]> = [
  ['bg-app', { utility: 'bg', token: 'app' }],
  ['bg-app-card', { utility: 'bg', token: 'app-card' }],
  ['bg-accent/15', { utility: 'bg', token: 'accent' }],
  ['hover:bg-app-raised', { utility: 'bg', token: 'app-raised' }],
  ['disabled:text-ink-fire', { utility: 'text', token: 'ink-fire' }],
  ['border-glass-border', { utility: 'border', token: 'glass-border' }],
  ['ring-offset-app-bg', { utility: 'ring-offset', token: 'app-bg' }],
  ['!bg-rp-fire', { utility: 'bg', token: 'rp-fire' }],
  // Not ours: Tailwind's own palette and non-colour utilities must never flag.
  ['text-zinc-100', null],
  ['bg-gradient-to-r', null],
  ['bg-amber-500', null],
  ['border-2', null],
  ['text-center', null],
  ['ring-2', null],
  ['shadow-task-card', null],
  ['from-[#C2410C]', null],
  ['bg-[rgba(0,0,0,0.5)]', null],
  ['flex', null],
];
for (const [input, want] of parseCases) {
  const got = parseBrandColorClass(input);
  ok(JSON.stringify(got) === JSON.stringify(want),
    `parseBrandColorClass(${input}) -> ${want ? want.token : 'null'}`, JSON.stringify(got));
}

// ── flattenColorTokens ────────────────────────────────────────────────────────
const flat = flattenColorTokens({
  'app-bg': '#fff',
  ink: { fire: '#a', DEFAULT: '#b' },
  zinc: { 100: '#c' },
});
ok(flat.has('app-bg'), 'flattenColorTokens keeps a flat key');
ok(flat.has('ink-fire'), 'flattenColorTokens joins a nested key with a dash');
ok(flat.has('ink'), 'flattenColorTokens exposes DEFAULT under the parent name');
ok(flat.has('zinc-100'), 'flattenColorTokens handles numeric shades');

// ── findUnknownBrandColorClasses, both ways ───────────────────────────────────
const known = new Set(['app-card', 'app-raised', 'accent', 'ink-fire', 'glass-border']);
const flagged = findUnknownBrandColorClasses('f.tsx',
  '<button className="rounded-lg bg-app border border-glass-border" />', known);
ok(flagged.length === 1 && flagged[0].token === 'app',
  'flags the real defect: bg-app where no `app` token exists', JSON.stringify(flagged));
ok(findUnknownBrandColorClasses('f.tsx',
  '<button className="bg-app-card border border-glass-border text-ink-fire" />', known).length === 0,
  'does not flag a line where every brand token resolves');
ok(findUnknownBrandColorClasses('f.tsx',
  '<div className="bg-accent/15 hover:bg-app-raised" />', known).length === 0,
  'does not flag an opacity modifier or a variant prefix');
ok(findUnknownBrandColorClasses('f.tsx',
  '// bg-app-raised is the warm row token', known).length === 0,
  'does not flag prose in a comment, where token names are discussed constantly');
ok(findUnknownBrandColorClasses('f.tsx',
  '<div className="bg-zinc-100 text-amber-500 shadow-soft" />', known).length === 0,
  'never reaches outside our own colour namespaces');

// ── The live scan ─────────────────────────────────────────────────────────────
// Tokens come from the app's own tailwind config, never restated here: a guard
// that keeps its own copy of the theme drifts from it, which is the exact failure
// this guard exists to catch.
// The aggregator transforms these files to CJS, which has no top-level await, so
// the dynamic import of the config lives inside a main().
async function main(): Promise<void> {
  const config = (await import(
    new URL('../apps/play-web/tailwind.config.js', import.meta.url).href
  )).default as { theme?: { extend?: { colors?: Record<string, unknown> } } };
  const tokens = flattenColorTokens(config.theme?.extend?.colors ?? {});
  ok(tokens.size > 0, 'read the colour tokens out of apps/play-web/tailwind.config.js');
  ok(tokens.has('app-card') && !tokens.has('app'),
    'regression pin: `app-card` is a token and bare `app` is not');

  const files = playWebTsxFiles(PLAY);
  ok(files.length > 0, 'found play-web components to scan');
  const findings = files.flatMap((file) =>
    findUnknownBrandColorClasses(relative(PLAY, file), readFileSync(file, 'utf8'), tokens));
  ok(findings.length === 0,
    'every brand colour utility in apps/play-web/src names a token that exists',
    findings.map((f) => `${f.file}:${f.line} ${f.className}`).join(', '));

  console.log(`\n${failed === 0 ? 'ALL BRAND CLASS SCAN TESTS PASSED' : 'BRAND CLASS SCAN TESTS FAILED'} (${passed} passed, ${failed} failed)`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
