// Guard: every React workspace is actually linted with the hooks rules.
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// Why this exists: `npm run lint` is `turbo run lint`, and turbo skips a
// workspace that declares no `lint` script WITHOUT failing — it still prints
// "Tasks: N successful". apps/play-web had no lint script and no .eslintrc, so
// the participant app was never linted while every gate looked green, and a
// `useState` below an `if (!task) return` in TaskRunner shipped to production
// and crashed every player to the ErrorBoundary (React #300, "Rendered fewer
// hooks than expected"). `react-hooks/rules-of-hooks` names that exact defect.
//
// Synthetic fixtures cover the DECISIONS; the real repo manifests are then
// checked too — those are source, not build output, so reading them is
// deterministic and is the whole point of the guard.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  REACT_WORKSPACES,
  REQUIRED_EXTENDS,
  checkLintCoverage,
  formatLintProblems,
} from './lib/lintCoverage.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const codes = (problems: Array<{ code: string }>) => problems.map((p) => p.code).sort();

const goodRc = `module.exports = { extends: ['../../.eslintrc.js', '${REQUIRED_EXTENDS}'] };`;

// ── Synthetic: the exact shape that let the crash through ───────────────────
ok(
  codes(checkLintCoverage([
    { dir: 'apps/creator-web', pkg: { scripts: { lint: 'eslint src' } }, eslintrc: goodRc },
    { dir: 'apps/play-web', pkg: { scripts: { typecheck: 'tsc' } }, eslintrc: null },
  ])).join(',') === 'no-eslintrc,no-lint-script',
  'a workspace with no lint script and no eslintrc is caught on both counts',
);

// ── Synthetic: a lint script alone is not enough ────────────────────────────
ok(
  codes(checkLintCoverage([
    { dir: 'apps/creator-web', pkg: { scripts: { lint: 'eslint src' } }, eslintrc: goodRc },
    { dir: 'apps/play-web', pkg: { scripts: { lint: 'eslint src' } }, eslintrc: 'module.exports = {};' },
  ])).join(',') === 'missing-react-hooks-extends',
  'a lint script without the react-hooks preset is still a hole',
);

// ── Synthetic: an explicit downgrade reopens the hole ───────────────────────
ok(
  codes(checkLintCoverage([
    { dir: 'apps/creator-web', pkg: { scripts: { lint: 'eslint src' } }, eslintrc: goodRc },
    {
      dir: 'apps/play-web',
      pkg: { scripts: { lint: 'eslint src' } },
      eslintrc: `${goodRc}\nrules: { 'react-hooks/rules-of-hooks': 'warn' }`,
    },
  ])).join(',') === 'rules-of-hooks-downgraded',
  'downgrading rules-of-hooks below error is rejected',
);

// ── Synthetic: a fully wired pair is clean ──────────────────────────────────
ok(
  checkLintCoverage([
    { dir: 'apps/creator-web', pkg: { scripts: { lint: 'eslint src' } }, eslintrc: goodRc },
    { dir: 'apps/play-web', pkg: { scripts: { lint: 'eslint src' } }, eslintrc: goodRc },
  ]).length === 0,
  'both React workspaces wired ⇒ no problems',
);

// ── Synthetic: a React workspace nobody inspected is itself a failure ───────
ok(
  codes(checkLintCoverage([
    { dir: 'apps/creator-web', pkg: { scripts: { lint: 'eslint src' } }, eslintrc: goodRc },
  ])).join(',') === 'react-workspace-unchecked',
  'omitting a known React workspace fails rather than passing vacuously',
);

// ── The REAL repo ───────────────────────────────────────────────────────────
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const RC_NAMES = ['.eslintrc.cjs', '.eslintrc.js', '.eslintrc.json', 'eslint.config.js', 'eslint.config.mjs'];

const real = REACT_WORKSPACES.map((dir) => {
  const pkgPath = join(repo, dir, 'package.json');
  const rcPath = RC_NAMES.map((n) => join(repo, dir, n)).find((p) => existsSync(p));
  return {
    dir,
    pkg: existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null,
    eslintrc: rcPath ? readFileSync(rcPath, 'utf8') : null,
  };
});

const realProblems = checkLintCoverage(real);
if (realProblems.length > 0) console.error(formatLintProblems(realProblems));
ok(realProblems.length === 0, 'every React workspace in THIS repo declares lint + the hooks rules');

console.log(`lint-coverage: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
