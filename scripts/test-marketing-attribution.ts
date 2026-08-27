/**
 * The marketing workspace is VENDORED third party source, not a dependency. A
 * dependency carries its licence in node_modules and npm can enumerate it; copied
 * in source carries nothing, so the only record is the one we write, and a record
 * nobody checks rots into a record nobody trusts.
 *
 * This asserts the record and the tree agree: the licence text is really present,
 * the record names it, and the strip list in the record is really stripped. It is
 * deliberately small. It is not a licence scanner.
 *
 * Change: marketing-site.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MARKETING = join(ROOT, 'apps', 'marketing');
const RECORD = join(MARKETING, 'THIRD_PARTY.md');
const LICENSE = join(MARKETING, 'LICENSE.md');

let failures = 0;
let checks = 0;

function pass(name: string, detail = ''): void {
  checks += 1;
  console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`);
}

function fail(name: string, detail: string): void {
  checks += 1;
  failures += 1;
  console.log(`FAIL  ${name} :: ${detail}`);
}

function check(name: string, ok: boolean, detail: string): void {
  if (ok) pass(name, detail);
  else fail(name, detail);
}

// ── A. The workspace exists and is the thing we think it is ──────────────────
if (!existsSync(MARKETING)) {
  fail('A · the marketing workspace exists', `${MARKETING} is absent`);
} else {
  pass('A · the marketing workspace exists');
}

// ── B. The licence text is present, not merely referenced ────────────────────
const licenceText = existsSync(LICENSE) ? readFileSync(LICENSE, 'utf8') : '';
check('B · LICENSE.md is present', licenceText.length > 0, LICENSE);
check(
  'B · LICENSE.md is the MIT text, not a stub',
  /MIT License/i.test(licenceText) && /WITHOUT WARRANTY OF ANY KIND/i.test(licenceText),
  `${licenceText.length} chars`,
);

// ── C. The record exists and names the source, its licence and its holder ────
const record = existsSync(RECORD) ? readFileSync(RECORD, 'utf8') : '';
check('C · THIRD_PARTY.md is present', record.length > 0, RECORD);

// The copyright holder in the record must be the one the licence actually names,
// so renaming the upstream account cannot quietly rewrite the attribution.
const holder = (licenceText.match(/Copyright \(c\) \d{4} (.+)/) ?? [])[1]?.trim() ?? '';
check('C · the licence names a copyright holder', holder.length > 0, holder || '(none found)');
check(
  'C · the record names the same holder the licence does',
  holder.length > 0 && record.includes(holder),
  holder,
);
check('C · the record names the licence', /\bMIT\b/.test(record), 'MIT');
check('C · the record names the upstream source', /astrowind/i.test(record), 'AstroWind');

// ── D. The strip list in the record is really stripped ───────────────────────
// A record that lists removals which are still on disk is worse than no record:
// it is a false assurance. In particular the template's own agent instruction
// files must be gone, because this repository auto-loads CLAUDE.md.
const MUST_BE_ABSENT = [
  'CLAUDE.md',
  'AGENTS.md',
  '.agents',
  'netlify.toml',
  'Dockerfile',
  'docker-compose.yml',
  'nginx',
  'vercel.json',
  'src/pages/homes',
  'src/pages/landing',
  'src/pages/pricing.astro',
  'src/pages/services.astro',
  'src/pages/privacy.md',
  'src/pages/terms.md',
];

for (const rel of MUST_BE_ABSENT) {
  check(`D · stripped and stays stripped: ${rel}`, !existsSync(join(MARKETING, rel)), rel);
}

// ── F. The template's BRANDING is gone, not just its licence recorded ────────
// Attribution and branding are different obligations and only one of them is
// satisfied by THIRD_PARTY.md. Keeping the licence is what we owe the author;
// shipping their name, their logo, their promotional artwork or their "star us
// on GitHub" banner is us publishing a page that says it belongs to someone
// else. It is also the failure that is hardest to notice from the inside,
// because a template's own branding looks like a finished site.
//
// The artwork matters twice over: the stock Open Graph image is what every share
// of every page shows, so leaving it in place means the template's picture is
// what a reader sees before they see anything of ours.
const BRAND_RESIDUE: Array<[string, RegExp]> = [
  ['the upstream name in visible source', /astrowind/i],
  ['the upstream author', /onwidget|arthelokyo/i],
  ['a GitHub badge or shield', /img\.shields\.io/i],
];

// The virtual config module is machinery, not branding: `astrowind:config` is
// the integration's own import specifier and renaming it would be a fork of the
// template for no reader-visible gain. Excluded by NAME so the exclusion cannot
// silently widen to cover real branding.
const MACHINERY = /astrowind:config/g;

function sourceFilesOf(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFilesOf(full, out);
    else if (/\.(astro|ts|tsx|js|mjs|md|mdx|yaml|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sources = sourceFilesOf(join(MARKETING, 'src'))
  .concat([join(MARKETING, 'README.md')].filter((f) => existsSync(f)));

let scanned = 0;
for (const [what, pattern] of BRAND_RESIDUE) {
  const hits: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8').replace(MACHINERY, '');
    if (pattern.test(text)) hits.push(file.slice(MARKETING.length + 1).replace(/\\/g, '/'));
  }
  check(`F · no trace of ${what}`, hits.length === 0, hits.slice(0, 6).join(', ') || 'none');
}
scanned = sources.length;

// The stock artwork, by file. Present means it is still what a share renders.
for (const rel of ['src/assets/images/hero-image.png', 'src/assets/images/app-store.png', 'src/assets/images/google-play.png']) {
  check(`F · the template's stock image is gone: ${rel}`, !existsSync(join(MARKETING, rel)), rel);
}

// The reach assertion for part F specifically. Every check above is an absence,
// and an absence over an empty file list is a green nobody earned.
check('F · the brand scan actually read source files', scanned > 20, `${scanned} file(s)`);

// ── E. The scan actually reached something ───────────────────────────────────
// Without this, an empty or missing workspace would sail through every check
// above that is phrased as an absence. Same vacuous-pass class the landing page
// drift check hit.
const topLevel = existsSync(MARKETING) ? readdirSync(MARKETING) : [];
check(
  'E · the workspace scan reached a non empty tree',
  topLevel.length > 3,
  `${topLevel.length} top level entries`,
);

console.log('');
if (failures > 0) {
  console.log(`ATTRIBUTION TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL ATTRIBUTION TESTS PASSED :: ${checks} checks`);
