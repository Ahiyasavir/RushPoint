// Local Supabase stack launcher (change: supabase-local-dev).
//
//   node scripts/supabase-dev.mjs            # up + wait for Postgres + apply migrations
//   node scripts/supabase-dev.mjs --down     # stop the stack, KEEP the data
//   node scripts/supabase-dev.mjs --reset    # stop the stack and DESTROY the volumes
//   node scripts/supabase-dev.mjs --status   # what is running, and on which ports
//   node scripts/supabase-dev.mjs --no-migrate
//   node scripts/supabase-dev.mjs --migrate-only
//
// DESIGN NOTES
// ------------
// * All port/URL/validation decisions live in the PURE scripts/lib/supabaseEnv.mjs and
//   are unit-tested by scripts/test-supabase-env.ts. This file only does I/O. Same split
//   as dev-emulator.mjs ↔ emulatorPorts.mjs; keep it that way, or the port-collision
//   proof stops covering the thing that actually chooses the ports.
//
// * DATA IS NEVER DESTROYED WITHOUT AN EXPLICIT FLAG. `--down` runs `compose down`
//   WITHOUT `-v`; only `--reset` passes `-v`, and it additionally requires a typed
//   confirmation unless `--yes` is given. A launcher that resets on a hunch will
//   eventually eat a day of seeded test data.
//
// * WINDOWS-FIRST. The developer is on Windows 11 with Git Bash, so: no shebang
//   reliance (always invoked as `node scripts/...`), no `chmod`, no POSIX-only tools
//   (`pg_isready` and `psql` run INSIDE the db container, so the host needs neither),
//   and every path is built with node:path. Docker CLI lookup goes through
//   `shell: true` so `docker.exe` resolves from PATH the same way it does in cmd.
//
// * MIGRATIONS ARE FED TO psql OVER STDIN inside the container, not by bind-mounting a
//   host directory. A Windows host path inside a Linux container is a well-known source
//   of "file not found" and CRLF grief; stdin sidesteps both. `ON_ERROR_STOP=1` means a
//   broken migration fails the run instead of leaving a half-applied schema.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  PORT_OFFSET_ENV,
  resolveSupabasePortOffset,
  resolveSupabasePorts,
  buildSupabaseUrls,
  buildComposeEnv,
  supabaseProjectName,
  validateSupabaseEnv,
  orderMigrationFiles,
  describeSupabasePorts,
  REQUIRED_ENV,
} from './lib/supabaseEnv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const COMPOSE_FILE = join(repoRoot, 'docker-compose.supabase.yml');
const ENV_FILE = join(repoRoot, '.env.supabase');
const ENV_EXAMPLE = join(repoRoot, '.env.supabase.example');
const MIGRATIONS_DIR = join(repoRoot, 'supabase', 'migrations');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const log = (m = '') => console.log(m);
const info = (m) => log(`${C.cyan}▸${C.reset} ${m}`);
const good = (m) => log(`${C.green}✓${C.reset} ${m}`);
const warn = (m) => log(`${C.yellow}!${C.reset} ${m}`);
const bad = (m) => console.error(`${C.red}✗${C.reset} ${m}`);

function die(message, hints = []) {
  log();
  bad(message);
  for (const h of hints) log(`   ${C.dim}${h}${C.reset}`);
  log();
  process.exit(1);
}

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (...names) => names.some((n) => argv.includes(n));
const MODE = has('--down') ? 'down'
  : has('--reset') ? 'reset'
  : has('--status') ? 'status'
  : has('--migrate-only') ? 'migrate-only'
  : 'up';
const SKIP_MIGRATE = has('--no-migrate');
const ASSUME_YES = has('--yes', '-y');

if (has('--help', '-h')) {
  log(`
${C.bold}RushPoint — local Supabase stack${C.reset}

  node scripts/supabase-dev.mjs               up + wait for Postgres + migrate
  node scripts/supabase-dev.mjs --down        stop, KEEP data
  node scripts/supabase-dev.mjs --reset       stop + DESTROY volumes (asks first)
  node scripts/supabase-dev.mjs --status      show container + port status
  node scripts/supabase-dev.mjs --migrate-only  apply migrations to a running stack
  node scripts/supabase-dev.mjs --no-migrate  bring up without applying migrations
  node scripts/supabase-dev.mjs --yes         skip the --reset confirmation

  ${C.dim}${PORT_OFFSET_ENV}=1000   run a SECOND stack beside a live one
  (its own ports, its own compose project and its own volumes)${C.reset}
`);
  process.exit(0);
}

// ── .env.supabase ────────────────────────────────────────────────────────────
/**
 * Minimal dotenv reader. We deliberately do not add a dependency for this (the task
 * forbids installing packages, and the format we control is trivial). Handles
 * `export` prefixes, `#` comments, quoted values and CRLF — the last one matters on
 * Windows, where an unstripped \r ends up INSIDE the JWT secret and every service
 * returns 401 for reasons nothing logs.
 */
function readEnvFile(file) {
  if (!existsSync(file)) return null;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    die(`Could not read ${file}: ${err.message}`);
  }
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// ── docker ───────────────────────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
    ...opts,
  });
}

/**
 * Probe Docker and report ACTIONABLY. Three distinct failures get three distinct
 * messages, because "docker failed" sends a developer to the wrong place:
 *   - the CLI is not installed / not on PATH
 *   - the CLI exists but the daemon is not running (Docker Desktop closed)
 *   - the CLI exists, the daemon runs, but the v2 `compose` subcommand is missing
 */
function requireDocker() {
  const version = run('docker', ['--version']);
  if (version.error || version.status !== 0) {
    die('Docker CLI not found.', [
      'Install Docker Desktop: https://www.docker.com/products/docker-desktop/',
      'On Windows, reopen your terminal after installing so PATH is refreshed.',
      'Verify with:  docker --version',
    ]);
  }

  const ping = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (ping.status !== 0) {
    die('The Docker daemon is not responding (the CLI is installed, the engine is not running).', [
      'Start Docker Desktop and wait for the whale icon to stop animating.',
      'On Windows, Docker Desktop needs WSL2 — check Settings ▸ General.',
      'Verify with:  docker info',
      (ping.stderr || '').trim().split('\n')[0] || '',
    ].filter(Boolean));
  }

  const compose = run('docker', ['compose', 'version']);
  if (compose.status !== 0) {
    die('`docker compose` (v2) is unavailable.', [
      'This project needs Compose v2 — the `docker compose` subcommand, not the old',
      'standalone `docker-compose` binary. Docker Desktop ships it; on Linux install',
      'the docker-compose-plugin package.',
      'Verify with:  docker compose version',
    ]);
  }

  return { docker: (version.stdout || '').trim(), compose: (compose.stdout || '').trim() };
}

function composeArgs(rest) {
  return ['compose', '--file', COMPOSE_FILE, '--env-file', ENV_FILE, ...rest];
}

function composeSync(rest, opts = {}) {
  return run('docker', composeArgs(rest), opts);
}

function composeStream(rest, env) {
  return new Promise((resolvePromise) => {
    const child = spawn('docker', composeArgs(rest), {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true,
      env,
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}

// ── readiness ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for Postgres to ACCEPT CONNECTIONS — not merely for the container to exist.
 * `pg_isready` runs inside the container, so the host needs no Postgres client, and
 * the check is immune to the host's port mapping still settling.
 *
 * The timeout is generous (first boot pulls ~1 GB of images and initdb runs the
 * Supabase role/extension bootstrap), and on expiry we print the db logs rather than
 * just "timed out" — the cause is almost always visible in the last few lines.
 */
async function waitForPostgres(env, timeoutMs = 180_000) {
  const started = Date.now();
  const dbName = env.POSTGRES_DB || 'postgres';
  let dots = 0;
  process.stdout.write(`${C.cyan}▸${C.reset} waiting for Postgres`);
  while (Date.now() - started < timeoutMs) {
    const res = composeSync(
      ['exec', '-T', 'db', 'pg_isready', '-U', 'supabase_admin', '-d', dbName],
      { env },
    );
    if (res.status === 0) {
      process.stdout.write('\n');
      good(`Postgres accepted a connection after ${Math.round((Date.now() - started) / 1000)}s`);
      return true;
    }
    if (dots++ % 4 === 0) process.stdout.write('.');
    await sleep(2000);
  }
  process.stdout.write('\n');
  bad(`Postgres did not accept connections within ${Math.round(timeoutMs / 1000)}s.`);
  const logs = composeSync(['logs', '--tail', '40', 'db'], { env });
  if (logs.stdout) log(`${C.dim}${logs.stdout}${C.reset}`);
  return false;
}

// ── migrations ───────────────────────────────────────────────────────────────
/**
 * Apply supabase/migrations/*.sql in filename order.
 *
 * The directory is owned by another workstream and may not exist yet, may be empty,
 * or may hold a README. NONE of those is an error: a launcher that crashes because a
 * sibling change has not landed makes the two changes artificially serial. Ordering
 * is decided by the pure orderMigrationFiles (byte-wise, NOT localeCompare — this
 * repo's default UI language is Hebrew and a locale-aware sort is a real hazard).
 *
 * This is a plain "run every file, every time" applier — there is no ledger table, so
 * migrations must be idempotent (CREATE ... IF NOT EXISTS / CREATE OR REPLACE) or you
 * re-run against a fresh volume. Deliberate: a bespoke ledger here would compete with
 * whatever the `supabase` CLI does later. Called out because it is a real constraint
 * on the migration author, not an oversight.
 */
function collectMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    return { dirExists: false, files: [] };
  }
  let entries = [];
  try {
    entries = readdirSync(MIGRATIONS_DIR).filter((name) => {
      try { return statSync(join(MIGRATIONS_DIR, name)).isFile(); } catch { return false; }
    });
  } catch (err) {
    warn(`Could not list ${MIGRATIONS_DIR} (${err.message}) — skipping migrations.`);
    return { dirExists: true, files: [] };
  }
  return { dirExists: true, files: orderMigrationFiles(entries) };
}

function applyMigrations(env) {
  const { dirExists, files } = collectMigrations();

  if (!dirExists) {
    warn('supabase/migrations/ does not exist yet — nothing to apply. The stack is still up.');
    return true;
  }
  if (files.length === 0) {
    warn('supabase/migrations/ holds no .sql files yet — nothing to apply. The stack is still up.');
    return true;
  }

  info(`applying ${files.length} migration(s) from supabase/migrations/`);
  const dbName = env.POSTGRES_DB || 'postgres';

  for (const file of files) {
    let sql;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    } catch (err) {
      bad(`  ${file} — could not be read: ${err.message}`);
      return false;
    }
    const res = composeSync(
      ['exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '--quiet',
        '-U', 'supabase_admin', '-d', dbName],
      { env, input: sql },
    );
    if (res.status !== 0) {
      bad(`  ${file} — FAILED`);
      const detail = (res.stderr || res.stdout || '').trim();
      if (detail) log(`${C.dim}${detail}${C.reset}`);
      log();
      bad('Migration failed. The stack is still running so you can inspect it:');
      log(`   ${C.dim}node scripts/supabase-dev.mjs --status${C.reset}`);
      log(`   ${C.dim}docker compose -f docker-compose.supabase.yml logs db${C.reset}`);
      return false;
    }
    good(`  ${file}`);
  }
  return true;
}

// ── banner ───────────────────────────────────────────────────────────────────
function printConnection(fileEnv, ports, offsetInfo) {
  const urls = buildSupabaseUrls(fileEnv);
  const anon = fileEnv.ANON_KEY || '(missing)';
  const service = fileEnv.SERVICE_ROLE_KEY || '(missing)';

  log();
  log(`${C.bold}${C.green}Supabase is up.${C.reset}  ${C.dim}${describeSupabasePorts(ports, offsetInfo)}${C.reset}`);
  log();
  log(`  ${C.bold}Studio${C.reset}        ${C.cyan}${urls.studioUrl}${C.reset}`);
  log(`  ${C.bold}API (Kong)${C.reset}    ${urls.apiUrl}     ${C.dim}← this is SUPABASE_URL${C.reset}`);
  log(`  ${C.bold}Postgres${C.reset}      ${urls.dbUrlRedacted}`);
  log();
  log(`  ${C.dim}direct (debug only):  auth ${urls.authUrl} · rest ${urls.restUrl}`);
  log(`                        realtime ${urls.realtimeUrl} · storage ${urls.storageUrl}${C.reset}`);
  log();
  log(`  ${C.bold}anon key${C.reset}      ${anon.slice(0, 24)}…  ${C.dim}(LOCAL-ONLY demo key)${C.reset}`);
  log(`  ${C.bold}service_role${C.reset}  ${service.slice(0, 24)}…  ${C.dim}(LOCAL-ONLY — bypasses RLS, never ship it)${C.reset}`);
  log();
  log(`  ${C.dim}stop, keep data:  node scripts/supabase-dev.mjs --down`);
  log(`  wipe everything:  node scripts/supabase-dev.mjs --reset${C.reset}`);
  log();
}

// ── confirmation ─────────────────────────────────────────────────────────────
/**
 * Typed confirmation for the only destructive path. Reads stdin directly rather than
 * node:readline/promises so a non-TTY invocation (CI, a spawned gate) hits the
 * `!isTTY` branch and REFUSES instead of hanging forever on a prompt nobody can see.
 */
function confirmDestroy(projectName) {
  if (ASSUME_YES) return true;
  if (!process.stdin.isTTY) {
    bad('--reset destroys data and stdin is not a TTY, so it cannot be confirmed.');
    log(`   ${C.dim}Re-run with --yes if you really mean it.${C.reset}`);
    return false;
  }
  log();
  warn(`--reset will DELETE the database and storage volumes of "${projectName}".`);
  log(`  ${C.dim}Every local game, run, team and uploaded file goes with them.${C.reset}`);
  process.stdout.write(`  Type ${C.bold}reset${C.reset} to confirm: `);

  let answer = '';
  try {
    // Synchronous single-line read from fd 0. Works in Git Bash, cmd and PowerShell,
    // and needs no readline interface (which would keep the event loop alive).
    const buf = Buffer.alloc(1024);
    const bytes = readSync(0, buf, 0, 1024, null);
    answer = buf.subarray(0, bytes).toString('utf8').trim();
  } catch (err) {
    bad(`Could not read confirmation (${err.message}). Re-run with --yes if you are sure.`);
    return false;
  }
  return answer === 'reset';
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  log();
  log(`${C.bold}RushPoint · local Supabase${C.reset}  ${C.dim}(${MODE})${C.reset}`);

  if (!existsSync(COMPOSE_FILE)) {
    die(`docker-compose.supabase.yml is missing at ${COMPOSE_FILE}.`);
  }

  const fileEnv = readEnvFile(ENV_FILE);
  if (!fileEnv) {
    die('.env.supabase is missing.', [
      existsSync(ENV_EXAMPLE)
        ? 'Copy the template:  cp .env.supabase.example .env.supabase'
        : '.env.supabase.example is missing too — restore it from git.',
      'It is gitignored on purpose; the committed example holds LOCAL-ONLY demo keys.',
    ]);
  }

  const validation = validateSupabaseEnv(fileEnv);
  if (!validation.ok) {
    const hints = [];
    if (validation.missing.length) hints.push(`missing: ${validation.missing.join(', ')}`);
    for (const p of validation.problems) hints.push(`${p.key}: ${p.reason}`);
    hints.push(`required keys: ${REQUIRED_ENV.map((r) => r.key).join(', ')}`);
    hints.push('Compare .env.supabase against .env.supabase.example.');
    die('.env.supabase is incomplete.', hints);
  }

  // The offset comes from the PROCESS env (a gate sets it per-invocation), never from
  // .env.supabase — a value committed into a file would silently move a developer's
  // stack forever.
  const offsetInfo = resolveSupabasePortOffset(process.env);
  const ports = resolveSupabasePorts(process.env);
  const projectName = supabaseProjectName(process.env);

  if (offsetInfo.notice === 'invalid') {
    warn(`${PORT_OFFSET_ENV} is not an integer — ignoring it and using the default ports.`);
  } else if (offsetInfo.notice === 'negative') {
    warn(`${PORT_OFFSET_ENV} is negative — ignoring it and using the default ports.`);
  } else if (offsetInfo.notice === 'snapped') {
    warn(`${PORT_OFFSET_ENV}=${offsetInfo.requested} snapped up to ${offsetInfo.offset} (must be a multiple of 1000).`);
  } else if (offsetInfo.notice === 'clamped') {
    warn(`${PORT_OFFSET_ENV}=${offsetInfo.requested} clamped to ${offsetInfo.offset} (port ceiling).`);
  }
  if (offsetInfo.offset !== 0) {
    info(`offset stack: project "${projectName}", its own containers and volumes`);
  }

  const versions = requireDocker();
  log(`${C.dim}  ${versions.docker} · ${versions.compose}${C.reset}`);

  // The environment handed to compose: the process env (so DOCKER_HOST etc. survive),
  // then the .env.supabase values, then the resolved ports LAST so an offset always
  // wins over anything a file happens to define.
  const env = { ...process.env, ...fileEnv, ...buildComposeEnv(process.env) };

  if (MODE === 'status') {
    log();
    info(`compose project: ${projectName}`);
    log(`${C.dim}${describeSupabasePorts(ports, offsetInfo)}${C.reset}`);
    log();
    const code = await composeStream(['ps'], env);
    process.exit(code);
  }

  if (MODE === 'down') {
    // No `-v`. This is the whole point: stopping is not deleting.
    info('stopping the stack (volumes are KEPT)');
    const code = await composeStream(['down', '--remove-orphans'], env);
    if (code === 0) {
      good('Stopped. Data is intact — `node scripts/supabase-dev.mjs` brings it back.');
    }
    process.exit(code);
  }

  if (MODE === 'reset') {
    if (!confirmDestroy(projectName)) {
      log();
      info('Cancelled. Nothing was deleted.');
      process.exit(1);
    }
    info('destroying containers AND volumes');
    const code = await composeStream(['down', '--volumes', '--remove-orphans'], env);
    if (code === 0) good('Reset. The next start builds a fresh database.');
    process.exit(code);
  }

  if (MODE === 'migrate-only') {
    if (!(await waitForPostgres(env, 60_000))) {
      die('Postgres is not reachable — is the stack running? (node scripts/supabase-dev.mjs)');
    }
    process.exit(applyMigrations(env) ? 0 : 1);
  }

  // ── up ──
  info('starting containers (the first run pulls ~1 GB of images — be patient)');
  const upCode = await composeStream(['up', '--detach', '--remove-orphans'], env);
  if (upCode !== 0) {
    die('`docker compose up` failed.', [
      'A port already in use is the usual cause — check with:',
      '  node scripts/supabase-dev.mjs --status',
      `The stack wants ${describeSupabasePorts(ports, offsetInfo)}`,
      `Run a second stack elsewhere with ${PORT_OFFSET_ENV}=1000`,
    ]);
  }

  if (!(await waitForPostgres(env))) {
    die('The stack started but Postgres never became reachable.', [
      'docker compose -f docker-compose.supabase.yml logs db',
      'A corrupt volume from an interrupted first boot is a common cause:',
      '  node scripts/supabase-dev.mjs --reset',
    ]);
  }

  if (!SKIP_MIGRATE) {
    if (!applyMigrations(env)) process.exit(1);
  } else {
    warn('--no-migrate: supabase/migrations/*.sql were NOT applied.');
  }

  printConnection(fileEnv, ports, offsetInfo);
}

main().catch((err) => {
  log();
  bad(`Unexpected failure: ${err && err.stack ? err.stack : String(err)}`);
  process.exit(1);
});
