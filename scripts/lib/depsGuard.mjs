// Pure staleness check for whether `node_modules` matches the current lockfile
// (change: fix-playtest-deps-drift). No fs, no spawn — the caller resolves the two
// mtimes and passes them in, so this stays fully unit-testable.
//
// The supervisor's git auto-update runs `npm ci` when IT detects the pull touched a
// package manifest — but that only covers updates the supervisor itself applied.
// Any code change that lands in the shared working tree another way (a manual
// `git pull`/rebase, a stash restore, a fresh clone) skips that check entirely, so a
// build can silently run against a stale `node_modules` and fail on a genuinely new
// dependency. Comparing mtimes catches all of those paths uniformly, independent of
// *how* the lockfile changed.

/**
 * Whether `npm ci` should run before the next build.
 *
 * @param {object} p
 * @param {number|null|undefined} p.lockMtimeMs    mtime of the root package-lock.json, or null/NaN if absent.
 * @param {number|null|undefined} p.markerMtimeMs  mtime of node_modules/.package-lock.json (npm's own
 *                                                 install-state snapshot), or null/NaN if never installed.
 * @returns {boolean} true when an install is needed: no snapshot yet, or the lockfile is newer.
 */
export function depsNeedInstall({ lockMtimeMs, markerMtimeMs }) {
  if (!Number.isFinite(lockMtimeMs)) return false;     // no lockfile at all — nothing to reconcile
  if (!Number.isFinite(markerMtimeMs)) return true;    // never installed
  return lockMtimeMs > markerMtimeMs;
}
