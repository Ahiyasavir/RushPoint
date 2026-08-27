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
