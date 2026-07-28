// Pure decisions for the lint-coverage guard.
//
// `npm run lint` is `turbo run lint`. Turbo only runs a task in workspaces that
// DECLARE it — a workspace with no `lint` script is skipped silently and turbo
// still prints "Tasks: N successful". So an unlinted app is indistinguishable
// from a clean one in both `npm run verify` and CI.
//
// That is exactly how the "Rendered fewer hooks than expected" crash reached
// production: apps/play-web had neither a lint script nor an .eslintrc, so
// `react-hooks/rules-of-hooks` never ran on the participant app, and a useState
// placed below an early return crashed every player to the ErrorBoundary.
//
// This module is DOM-free and fs-free on purpose: it takes already-read package
// manifests + eslintrc source text and returns problems, so it is unit-testable
// without a repo layout.

/** Workspaces that render React and therefore MUST run the hooks rules. */
export const REACT_WORKSPACES = ['apps/creator-web', 'apps/play-web'];

/** The config every React workspace has to extend for the hooks rules to run. */
export const REQUIRED_EXTENDS = 'plugin:react-hooks/recommended';

/** The rule that names the production crash; must be an error, never a warning. */
export const REQUIRED_ERROR_RULE = 'react-hooks/rules-of-hooks';

/**
 * @param {Array<{dir: string, pkg: object|null, eslintrc: string|null}>} workspaces
 * @returns {Array<{code: string, dir: string, detail: string}>}
 */
export function checkLintCoverage(workspaces) {
  const problems = [];
  const seen = new Set();

  for (const ws of workspaces ?? []) {
    const dir = ws?.dir ?? '(unknown)';
    seen.add(dir);

    if (!ws?.pkg) {
      problems.push({ code: 'missing-package-json', dir, detail: 'no package.json could be read' });
      continue;
    }

    const scripts = ws.pkg.scripts ?? {};
    if (typeof scripts.lint !== 'string' || scripts.lint.trim() === '') {
      // The headline failure: turbo skips this workspace and reports success.
      problems.push({
        code: 'no-lint-script',
        dir,
        detail: 'declares no "lint" script, so `turbo run lint` skips it silently',
      });
    }

    const rc = ws.eslintrc;
    if (rc == null) {
      problems.push({ code: 'no-eslintrc', dir, detail: 'has no ESLint config file' });
      continue;
    }
    if (!rc.includes(REQUIRED_EXTENDS)) {
      problems.push({
        code: 'missing-react-hooks-extends',
        dir,
        detail: `ESLint config does not extend ${REQUIRED_EXTENDS}`,
      });
    }
    // Extending the preset already sets rules-of-hooks to "error"; an explicit
    // downgrade to "warn"/"off" would silently reopen the hole, so reject those.
    const downgraded = new RegExp(
      `['"]${REQUIRED_ERROR_RULE}['"]\\s*:\\s*['"]?(warn|off|0|1)['"]?`,
    ).test(rc);
    if (downgraded) {
      problems.push({
        code: 'rules-of-hooks-downgraded',
        dir,
        detail: `${REQUIRED_ERROR_RULE} is set below "error"`,
      });
    }
  }

  for (const required of REACT_WORKSPACES) {
    if (!seen.has(required)) {
      problems.push({
        code: 'react-workspace-unchecked',
        dir: required,
        detail: 'known React workspace was not inspected',
      });
    }
  }

  return problems;
}

export function formatLintProblems(problems) {
  return (problems ?? []).map((p) => `  ✗ [${p.code}] ${p.dir} — ${p.detail}`).join('\n');
}
