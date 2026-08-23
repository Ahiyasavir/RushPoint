// Pure fast-forward-safety decision for the always-on playtest supervisor
// (change: fix-playtest-git-poll-collapse). No git, no I/O, no Date.now() — the
// caller computes ahead/behind + the changed/dirty file lists and passes them in,
// so this is fully unit-testable.
//
// The supervisor's git auto-update must only tear the stack down for an update it
// can actually fast-forward. Collapsing first and discovering the pull fails
// (dirty tree / diverged branch) produced an endless thrash-restart loop.

/**
 * Decide whether a pulled upstream update can be fast-forwarded cleanly.
 *
 * @param {object} p
 * @param {number} p.ahead   local commits not on upstream (from `rev-list --left-right --count`)
 * @param {number} p.behind  upstream commits not on local
 * @param {string[]} [p.changedUpstreamFiles] files changed by the incoming commits (`diff --name-only HEAD..@{u}`)
 * @param {string[]} [p.dirtyFiles] locally-modified tracked files (`status --porcelain`, untracked excluded)
 * @returns {{ ok: boolean, reason: string }}
 *   ok=true only when strictly behind (behind>0, ahead===0) AND no incoming file is
 *   locally dirty. reason ∈ 'ff' | 'up-to-date' | 'diverged' | 'dirty-conflict:<file>'.
 */
export function canFastForwardApply({ ahead, behind, changedUpstreamFiles = [], dirtyFiles = [] }) {
  if (!(behind > 0)) return { ok: false, reason: 'up-to-date' };
  if (ahead > 0) return { ok: false, reason: 'diverged' };

  // A `pull --ff-only` is rejected only if a tracked file the incoming commits
  // change is also modified locally. Comparing the two name-lists is a conservative
  // superset of git's own check: it may occasionally decline an update that would
  // have applied, but it never greenlights a kill that then fails the pull.
  const dirty = new Set(dirtyFiles);
  const conflict = changedUpstreamFiles.find((f) => dirty.has(f));
  if (conflict) return { ok: false, reason: `dirty-conflict:${conflict}` };

  return { ok: true, reason: 'ff' };
}
