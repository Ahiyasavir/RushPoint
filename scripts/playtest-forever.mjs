// Supervisor: keep `npm run playtest:ngrok` UP forever, independent of any editor
// / agent / Claude-Code process. Launched detached (see scripts/playtest-forever.README),
// it survives the parent that started it and stays up as long as the machine is on.
//
// Behavior:
//   • Single-instance: if a live supervisor is already running (pid file → alive
//     process), this launch exits immediately. That makes it SAFE for the login
//     watchdog to (re)launch this every few minutes — it restarts a dead supervisor
//     (after sleep/hibernate/crash/reboot) and no-ops when one is already up.
//   • Run the full playtest stack; if it exits for ANY reason (crash, ngrok drop
//     that takes the stack down, transient network), free ports and relaunch after
//     a short backoff.
//   • Git auto-update: poll `origin` every few minutes. When new commits land on the
//     tracked branch (i.e. you pushed from another machine), pull them, `npm install`
//     if deps changed, and restart the stack so functions/shared/deps rebuild. The
//     ngrok link is a fixed reserved domain, so it never changes across restarts.
//   • A stop-file (or SIGINT) ends the supervisor cleanly.
//
//   node scripts/playtest-forever.mjs            # run the supervisor loop
//   node scripts/playtest-forever.mjs --stop     # ask a running supervisor to stop
//
// Logs → .firebase/playtest-forever.log  ·  PID → .firebase/playtest-forever.pid
// Stop → create .firebase/playtest-forever.stop (the loop notices and exits)

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canFastForwardApply } from './lib/gitUpdateGuard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.firebase');
const LOG = path.join(STATE_DIR, 'playtest-forever.log');
const PIDF = path.join(STATE_DIR, 'playtest-forever.pid');
const STOPF = path.join(STATE_DIR, 'playtest-forever.stop');
const RESTART_BACKOFF_MS = 4_000;
const GIT_POLL_MS = 3 * 60_000;   // check origin for new commits every 3 minutes
// The stack to serve. Default `playtest:prod` = pre-built + minified static apps
// served via `vite preview` (dramatically faster over the tunnel than the dev
// server). Override with PLAYTEST_TARGET=playtest:ngrok to fall back to dev mode.
const TARGET = process.env.PLAYTEST_TARGET || 'playtest:prod';
const NEEDS_BUILD = TARGET === 'playtest:prod';

fs.mkdirSync(STATE_DIR, { recursive: true });

function log(line) {
  const stamp = new Date().toISOString();
  const msg = `[forever ${stamp}] ${line}\n`;
  try { fs.appendFileSync(LOG, msg); } catch { /* ignore */ }
  process.stdout.write(msg);
}

// --stop: signal a running supervisor to exit.
if (process.argv.includes('--stop')) {
  fs.writeFileSync(STOPF, String(Date.now()));
  log('stop requested (wrote .stop file); the supervisor will exit after the current stack tears down.');
  process.exit(0);
}

// --- single-instance guard -------------------------------------------------
// If a prior supervisor is still alive, don't start a second one. process.kill(pid, 0)
// throws ESRCH when the pid is gone (the normal case after a hard poweroff/hibernate
// kill), and succeeds when it's still running (resume-from-sleep kept it alive).
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
try {
  const prev = Number.parseInt(fs.readFileSync(PIDF, 'utf8').trim(), 10);
  if (pidAlive(prev)) {
    log(`already running (pid ${prev}); this launch exits. (watchdog no-op)`);
    process.exit(0);
  }
} catch { /* no pid file yet — first run */ }

if (fs.existsSync(STOPF)) fs.rmSync(STOPF, { force: true });
fs.writeFileSync(PIDF, String(process.pid));
log(`supervisor up (pid ${process.pid}). Keeping playtest:ngrok alive until --stop / .stop file / SIGINT.`);

let child = null;
let buildChild = null;
let stopping = false;

// --- git auto-update -------------------------------------------------------
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function headSha() { return git(['rev-parse', 'HEAD']).out; }

// Rate-limiter for the "can't fast-forward" log: because the poll runs every few
// minutes, a persistently-blocked update would otherwise log every cycle. We only
// re-log when the (reason, upstreamSha) pair changes.
let lastBlockedKey = null;
function logBlockedOnce(reason, upstreamSha, human) {
  const key = `${reason}@${upstreamSha}`;
  if (key === lastBlockedKey) return;
  lastBlockedKey = key;
  log(human);
}

// Fetch origin and assess whether the tracked upstream can be FAST-FORWARDED cleanly
// onto the working tree — the branch is strictly behind (not diverged) AND no file the
// incoming commits change is locally modified. This is consulted BEFORE any stack
// teardown so we never collapse for an update that would then fail to pull. Returns
// { assessed, ok, reason, behind, upstreamRef, upstreamSha }. `assessed` is false when
// we couldn't even evaluate (offline / no upstream) — treat as "do nothing".
function assessUpdate() {
  const f = git(['fetch', '--quiet', 'origin']);
  if (f.code !== 0) { log(`git fetch failed (offline?): ${f.err || f.out}`); return { assessed: false }; }

  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstream.code !== 0) { log('no upstream tracking branch configured — skipping auto-update.'); return { assessed: false }; }
  const upstreamRef = upstream.out;
  const upstreamSha = git(['rev-parse', upstreamRef]).out;

  const counts = git(['rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`]);
  const [aheadStr, behindStr] = counts.out.split(/\s+/);
  const ahead = Number.parseInt(aheadStr || '0', 10);
  const behind = Number.parseInt(behindStr || '0', 10);

  // Files the incoming commits change, vs. locally-modified TRACKED files. `status
  // --porcelain` XY codes: skip untracked ('??') — they can't block a fast-forward.
  const changedUpstreamFiles = behind > 0
    ? git(['diff', '--name-only', `HEAD..${upstreamRef}`]).out.split(/\r?\n/).filter(Boolean)
    : [];
  const dirtyFiles = git(['status', '--porcelain'])
    .out.split(/\r?\n/)
    .filter((l) => l && !l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);

  const { ok, reason } = canFastForwardApply({ ahead, behind, changedUpstreamFiles, dirtyFiles });
  return { assessed: true, ok, reason, behind, ahead, upstreamRef, upstreamSha };
}

// Perform the pull ONLY when a fast-forward is safe. Returns true if HEAD actually
// moved (→ stack should rebuild). A blocked update logs once (rate-limited) and keeps
// serving the current build rather than failing a pull every relaunch.
function updateFromGit() {
  const before = headSha();
  const a = assessUpdate();
  if (!a.assessed) return false;
  if (!a.ok) {
    if (a.reason !== 'up-to-date') {
      logBlockedOnce(a.reason, a.upstreamSha,
        a.reason === 'diverged'
          ? `update on ${a.upstreamRef} can't fast-forward: local branch has diverged (${a.ahead} commit(s) ahead). Serving current build.`
          : `update on ${a.upstreamRef} can't fast-forward: local changes to ${a.reason.slice('dirty-conflict:'.length)} would be overwritten. Commit/stash to apply. Serving current build.`);
    }
    return false;
  }

  log(`update available: ${a.behind} new commit(s) on ${a.upstreamRef} — pulling…`);
  const pull = git(['pull', '--ff-only']);
  if (pull.code !== 0) {
    // Guard said it was safe but the pull still failed — surface it and keep serving.
    log(`git pull --ff-only failed unexpectedly: ${pull.err || pull.out}. Serving current build.`);
    return false;
  }
  const after = headSha();
  if (after === before) return false;

  log(`updated ${before.slice(0, 8)} → ${after.slice(0, 8)}.`);
  lastBlockedKey = null; // moved forward — clear any prior blocked state
  // Reinstall deps only if the lockfile/manifests changed in the pulled range. Use
  // `npm ci` (installs from the lockfile, never rewrites it) so a dependency update
  // can't leave package-lock.json dirty and block the NEXT fast-forward.
  const changed = git(['diff', '--name-only', `${before}`, `${after}`]).out;
  if (/(^|\n)(package(-lock)?\.json|.*\/package\.json)(\n|$)/.test(changed)) {
    log('dependency manifests changed — running npm ci…');
    const ni = spawnSync('npm', ['ci'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
    log(ni.status === 0 ? 'npm ci ok.' : `npm ci exited ${ni.status} — serving current build.`);
  }
  return true;
}

function freePorts() {
  return new Promise((resolve) => {
    const p = spawn('node', ['scripts/free-ports.mjs'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
    p.on('exit', () => resolve());
    p.on('error', () => resolve());
  });
}

// True once both apps have a production build on disk that `vite preview` can serve.
function distReady() {
  return fs.existsSync(path.join(ROOT, 'apps', 'creator-web', 'dist', 'index.html'))
    && fs.existsSync(path.join(ROOT, 'apps', 'play-web', 'dist', 'index.html'));
}

// Build the production bundles the prod stack serves. Runs once at boot and again
// after each git update. Resolves TRUE only on a clean build — the caller keeps
// needBuild armed on failure so it retries next loop instead of crash-looping on a
// missing/stale dist (a fresh host has no dist until the first build succeeds).
function buildProd() {
  return new Promise((resolve) => {
    log('building production bundles: npm run playtest:build…');
    buildChild = spawn('npm', ['run', 'playtest:build'], {
      cwd: ROOT,
      stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
      shell: process.platform === 'win32',
    });
    buildChild.on('exit', (code) => {
      log(`playtest:build finished (code=${code}).`);
      buildChild = null;
      resolve(code === 0);
    });
    buildChild.on('error', (err) => {
      log(`playtest:build failed to spawn: ${err.message} — will retry.`);
      buildChild = null;
      resolve(false);
    });
  });
}

function runOnce() {
  return new Promise((resolve) => {
    log(`launching: npm run ${TARGET}`);
    child = spawn('npm', ['run', TARGET], {
      cwd: ROOT,
      stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
      shell: process.platform === 'win32',
    });
    child.on('exit', (code, signal) => {
      log(`${TARGET} exited (code=${code}, signal=${signal}).`);
      child = null;
      resolve();
    });
    child.on('error', (err) => {
      log(`failed to spawn ${TARGET}: ${err.message}`);
      child = null;
      resolve();
    });
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  log('stopping supervisor…');
  if (gitTimer) clearInterval(gitTimer);
  if (child) { try { child.kill(); } catch { /* ignore */ } }
  if (buildChild) { try { buildChild.kill(); } catch { /* ignore */ } }
  await freePorts();
  try { fs.rmSync(PIDF, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(STOPF, { force: true }); } catch { /* ignore */ }
  log('supervisor stopped.');
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Background poll: while the stack is up, watch origin. When a push lands that can
// actually FAST-FORWARD, kill the running stack — the loop below then pulls and
// relaunches. Critically, we assess ff-safety BEFORE killing: a dirty tree or a
// diverged branch means the pull would fail, so we keep serving instead of collapsing
// the stack every few minutes (the old thrash-restart loop). Guarded so only one
// check runs at a time and none runs mid-teardown; blocked updates log once.
let gitTimer = null;
let checking = false;
gitTimer = setInterval(() => {
  if (stopping || checking || !child) return;
  checking = true;
  try {
    const a = assessUpdate();
    if (!a.assessed) return;
    if (a.ok) {
      log(`poll: ${a.behind} new commit(s) upstream (fast-forward safe) — restarting stack to apply.`);
      try { child.kill(); } catch { /* the exit handler resolves runOnce */ }
    } else if (a.reason !== 'up-to-date') {
      logBlockedOnce(a.reason, a.upstreamSha,
        a.reason === 'diverged'
          ? `poll: ${a.behind} new commit(s) upstream but local branch diverged (${a.ahead} ahead) — keeping stack up.`
          : `poll: ${a.behind} new commit(s) upstream but local changes to ${a.reason.slice('dirty-conflict:'.length)} block a fast-forward — keeping stack up. Commit/stash to apply.`);
    }
  } finally { checking = false; }
}, GIT_POLL_MS);

// Supervisor loop: pull latest, (re)build for prod when the code changed, run the
// stack, and whenever it dies, clean ports, re-pull (in case the poll above
// triggered the exit), and relaunch. A plain crash restart skips the rebuild for
// fast recovery; only a fresh boot or a real git update rebuilds.
let needBuild = NEEDS_BUILD;          // build once before the first prod launch
while (!stopping) {
  if (fs.existsSync(STOPF)) { await stop(); break; }
  if (updateFromGit()) needBuild = NEEDS_BUILD;   // new code pulled → rebuild (prod only)
  await freePorts();                  // start each attempt from clean ports (kills orphan Java)
  // Build before serving prod. On a build failure: if a previous good dist exists,
  // serve THAT (availability first — a broken push never blacks out the site) but
  // keep needBuild armed to retry on the next restart/update; if there's no dist at
  // all yet (fresh host), retry the build after a backoff instead of crash-looping
  // vite-preview on a missing dist.
  if (needBuild) {
    const built = await buildProd();
    needBuild = !built;
    if (!distReady()) {
      log('no serveable build yet (build failed, no dist) — retrying build after backoff.');
      await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
      continue;
    }
    if (!built) log('build failed — serving the previous good build; will retry on next restart/update.');
  }
  await runOnce();                    // blocks until the stack exits
  if (fs.existsSync(STOPF) || stopping) { await stop(); break; }
  log(`restarting in ${RESTART_BACKOFF_MS / 1000}s…`);
  await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
}
