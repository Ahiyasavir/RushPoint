// git.mjs — thin git helpers. Guarantees the integration branch only advances via reviewed merges.
import { execFile } from 'node:child_process';

function git(cwd, args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !allowFail) return reject(new Error(`git ${args.join(' ')}: ${stderr || err.message}`));
      resolve({ code: err ? err.code || 1 : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

export async function currentBranch(cwd) {
  const { stdout } = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

export async function branchExists(cwd, name) {
  const { code } = await git(cwd, ['rev-parse', '--verify', '--quiet', name], { allowFail: true });
  return code === 0;
}

export async function isClean(cwd) {
  const { stdout } = await git(cwd, ['status', '--porcelain']);
  return stdout.trim() === '';
}

// Ensure the integration branch exists (created off baseBranch) and is checked out, working tree clean.
export async function ensureIntegrationBranch(cwd, integration, base) {
  if (!(await isClean(cwd))) {
    // Stash stray *tracked* changes so the supervisor starts from a clean tree.
    // NOTE: no `-u` — we must never stash untracked files (that would hide the autopilot/ dir
    // itself before it is committed, breaking prompt/lib reads mid-run).
    await git(cwd, ['stash', 'push', '-m', 'autopilot-autostash'], { allowFail: true });
  }
  if (!(await branchExists(cwd, integration))) {
    const baseRef = (await branchExists(cwd, base)) ? base : await currentBranch(cwd);
    await git(cwd, ['branch', integration, baseRef], { allowFail: true });
  }
  await git(cwd, ['checkout', integration]);
}

export async function createCycleBranch(cwd, integration, name) {
  await git(cwd, ['checkout', integration]);
  if (await branchExists(cwd, name)) await git(cwd, ['branch', '-D', name], { allowFail: true });
  await git(cwd, ['checkout', '-b', name]);
}

// Commit any uncommitted work left in the tree (the implementer may forget, or hit its turn limit
// mid-task). `-e autopilot` is unnecessary here — autopilot/state is gitignored and tooling is
// already committed — but we exclude nothing else so the implementer's app changes are captured.
// Returns true if a commit was made.
export async function commitAllIfDirty(cwd, message) {
  const { stdout } = await git(cwd, ['status', '--porcelain']);
  if (stdout.trim() === '') return false;
  await git(cwd, ['add', '-A']);
  const res = await git(cwd, ['commit', '-m', message], { allowFail: true });
  return res.code === 0;
}

export async function revParse(cwd, ref = 'HEAD') {
  const { stdout } = await git(cwd, ['rev-parse', ref]);
  return stdout.trim();
}

export async function resetHard(cwd, sha) {
  await git(cwd, ['reset', '--hard', sha], { allowFail: true });
  await git(cwd, ['clean', '-fd', '-e', 'autopilot'], { allowFail: true });
}

// Snapshot-and-reset model: work happens directly on the integration branch (no cycle branches,
// which raced with the implementer's own git in a shared worktree). Ensure we're on integration
// and clean, then the caller snapshots HEAD; on failure the caller resets --hard back to it.
export async function ensureOnIntegration(cwd, integration) {
  await git(cwd, ['checkout', integration], { allowFail: true });
  await git(cwd, ['reset', '--hard'], { allowFail: true });
  await git(cwd, ['clean', '-fd', '-e', 'autopilot'], { allowFail: true });
}

// Return to the integration branch after the implementer ran, keeping any uncommitted working-tree
// changes (so they can be committed on integration). If the implementer switched branches, this
// brings us back; uncommitted edits carry across a clean checkout.
export async function checkoutIntegrationKeepingWork(cwd, integration) {
  const cur = await currentBranch(cwd);
  if (cur !== integration) await git(cwd, ['checkout', integration], { allowFail: true });
}

export async function diffAgainst(cwd, ref) {
  const { stdout } = await git(cwd, ['diff', '--stat', ref + '...HEAD'], { allowFail: true });
  return stdout;
}

export async function hasCommitsBeyond(cwd, ref, branch) {
  const { stdout } = await git(cwd, ['rev-list', '--count', `${ref}..${branch}`], { allowFail: true });
  return Number(stdout.trim()) > 0;
}

// Merge the (approved) cycle branch into the integration branch.
export async function mergeCycle(cwd, integration, cycleBranch, message) {
  await git(cwd, ['checkout', integration]);
  await git(cwd, ['merge', '--no-ff', cycleBranch, '-m', message]);
  await git(cwd, ['branch', '-D', cycleBranch], { allowFail: true });
}

// Discard a failed/aborted cycle branch; integration is left untouched.
export async function discardCycle(cwd, integration, cycleBranch) {
  await git(cwd, ['reset', '--hard'], { allowFail: true });
  // `-e autopilot` so the supervisor never deletes its own (possibly untracked) files.
  await git(cwd, ['clean', '-fd', '-e', 'autopilot'], { allowFail: true });
  await git(cwd, ['checkout', integration], { allowFail: true });
  await git(cwd, ['branch', '-D', cycleBranch], { allowFail: true });
}

// On restart, delete any dangling autopilot/cycle-* branches and return to integration.
export async function cleanupDanglingCycleBranches(cwd, integration) {
  const { stdout } = await git(cwd, ['branch', '--list', 'autopilot/cycle-*'], { allowFail: true });
  await git(cwd, ['checkout', integration], { allowFail: true });
  await git(cwd, ['reset', '--hard'], { allowFail: true });
  await git(cwd, ['clean', '-fd', '-e', 'autopilot'], { allowFail: true });
  for (const line of stdout.split('\n')) {
    const name = line.replace('*', '').trim();
    if (name) await git(cwd, ['branch', '-D', name], { allowFail: true });
  }
}
