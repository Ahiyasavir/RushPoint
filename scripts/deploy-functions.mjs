#!/usr/bin/env node
/**
 * scripts/deploy-functions.mjs — the CHEAP, DELIBERATE Cloud Functions deploy.
 *
 * WHY THIS EXISTS (money, not ergonomics):
 * `firebase deploy --only functions` rebuilds EVERY gen-1 function in the project.
 * This repo exports ~96 of them, each costing roughly one Cloud Build minute, and
 * the free tier is 120 build-minutes PER DAY. So one full deploy a day is free, a
 * second one starts billing, and five a day during active iteration is real money
 * on a real credit card. Deploying only what changed is ~1-2 build-minutes.
 *
 * Therefore:
 *   • named functions            → cheap path, just runs
 *   • no arguments               → REFUSES, explains the cost, demands --all
 *   • --all / >20 functions      → needs an explicit confirmation (or --yes)
 *   • --changed                  → SUGGESTS names from git, never deploys
 *   • unknown names              → fail fast (a typo would otherwise deploy nothing)
 *
 * Usage:
 *   node scripts/deploy-functions.mjs launchRun joinRun
 *   node scripts/deploy-functions.mjs --changed
 *   node scripts/deploy-functions.mjs --all --yes
 *   node scripts/deploy-functions.mjs launchRun --dry-run --project rushpoint-pwa-7daaa
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_SRC = path.join(REPO_ROOT, 'functions', 'src');

/** Cloud Build minutes burned per gen-1 function, and the daily free allowance. */
export const BUILD_MINUTES_PER_FUNCTION = 1;
export const FREE_BUILD_MINUTES_PER_DAY = 120;
/** Above this many functions in one deploy, a human has to say yes. */
export const CONFIRM_THRESHOLD = 20;

// ─── Export discovery ─────────────────────────────────────────────────────────
// Same regex idiom as scripts/lib/callableHardening.mjs: the declaration being
// parsed is ONE house-standard shape used ~96 times identically, and the scripts/
// lane has no TS-compiler dependency.

/** `export const NAME = loggedCallable(...` / `= functions.` — a deployable target. */
const FUNCTION_CONST_RE = /^export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(?:loggedCallable\s*\(|functions\b)/gm;
/** `export { a, b } from './x'` — an explicit re-export block. */
const REEXPORT_BLOCK_RE = /^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/gms;
/** `export * from './x/index'` — a whole-module re-export. */
const STAR_EXPORT_RE = /^export\s*\*\s*from\s*['"]([^'"]+)['"]\s*;?/gm;

function readIfExists(file) {
  for (const candidate of [file, `${file}.ts`, path.join(file, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return readFileSync(candidate, 'utf8');
    } catch {
      /* not a readable file — try the next candidate */
    }
  }
  return null;
}

function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  return path.resolve(path.dirname(fromFile), spec);
}

/**
 * The set of names Firebase will actually deploy, resolved from functions/src/index.ts.
 * Includes non-callables that are still deploy targets (stripeWebhook, onRunFinalized,
 * pruneExpiredRunData) — they are legitimate `--only functions:<name>` arguments.
 */
export function discoverDeployableNames(indexFile = path.join(FUNCTIONS_SRC, 'index.ts')) {
  const source = readIfExists(indexFile);
  if (source == null) throw new Error(`Cannot read ${indexFile}`);
  const names = new Set();

  for (const m of source.matchAll(FUNCTION_CONST_RE)) names.add(m[1]);

  // Explicit `export { … } from './mod'` lists are deliberate function re-exports.
  for (const m of source.matchAll(REEXPORT_BLOCK_RE)) {
    for (const raw of m[1].split(',')) {
      const name = raw.replace(/\/\/.*$/g, '').trim().split(/\s+as\s+/).pop();
      if (name && /^[A-Za-z0-9_$]+$/.test(name)) names.add(name);
    }
  }

  // `export *` pulls in helpers too, so take only function-shaped consts from there.
  for (const m of source.matchAll(STAR_EXPORT_RE)) {
    const target = resolveRelative(indexFile, m[1]);
    const modSource = target && readIfExists(target);
    if (!modSource) continue;
    for (const c of modSource.matchAll(FUNCTION_CONST_RE)) names.add(c[1]);
  }

  return names;
}

/** Which deployable names a given functions/src file declares itself. */
export function namesDeclaredIn(absFile) {
  const source = readIfExists(absFile);
  if (source == null) return [];
  return [...source.matchAll(FUNCTION_CONST_RE)].map((m) => m[1]);
}

// ─── Arg parsing (pure) ───────────────────────────────────────────────────────

export function parseArgs(argv) {
  const flags = { all: false, changed: false, dryRun: false, yes: false, help: false };
  const names = [];
  const passthrough = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') flags.all = true;
    else if (a === '--changed') flags.changed = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('-')) {
      // Anything else is for the firebase CLI (e.g. --project x / --project=x).
      passthrough.push(a);
      const next = argv[i + 1];
      if (!a.includes('=') && next && !next.startsWith('-')) {
        passthrough.push(next);
        i += 1;
      }
    } else names.push(a);
  }
  return { flags, names, passthrough };
}

export function estimateBuildMinutes(count) {
  return count * BUILD_MINUTES_PER_FUNCTION;
}

export function buildDeployArgs(names, passthrough) {
  const only = names.length ? `functions:${names.join(',functions:')}` : 'functions';
  return ['deploy', '--only', only, ...passthrough];
}

// ─── Output helpers ───────────────────────────────────────────────────────────

const log = (...a) => console.log(...a);
const RULE = '─'.repeat(72);

function printCost(count, label) {
  const minutes = estimateBuildMinutes(count);
  const pct = Math.round((minutes / FREE_BUILD_MINUTES_PER_DAY) * 100);
  log(RULE);
  log(`  ${label}: ${count} function(s)`);
  log(`  Estimated Cloud Build: ~${minutes} build-minute(s)`);
  log(`  That is ~${pct}% of the ${FREE_BUILD_MINUTES_PER_DAY}-minute DAILY free tier.`);
  log(RULE);
}

function printHelp() {
  log(`
RushPoint — cheap Cloud Functions deploy

  node scripts/deploy-functions.mjs <fnName> [...]   deploy just these (CHEAP)
  node scripts/deploy-functions.mjs --changed        suggest names from git diff
  node scripts/deploy-functions.mjs --all            FULL deploy (expensive)

Flags:
  --dry-run   print the firebase command, run nothing
  --yes, -y   skip the confirmation prompt (needed when stdin is not a TTY)
  --help      this text
  anything else (e.g. --project <id>) is passed through to the firebase CLI

Cost model: ~${BUILD_MINUTES_PER_FUNCTION} Cloud Build minute per function;
${FREE_BUILD_MINUTES_PER_DAY} free build-minutes per DAY. A full deploy of this repo
consumes essentially the whole daily allowance, so a SECOND one costs money.
`);
}

async function confirm(question, { yes, dryRun }) {
  if (yes || dryRun) return true;
  if (!process.stdin.isTTY) {
    log('\n✖ Refusing: stdin is not a TTY, so I cannot ask for confirmation.');
    log('  Re-run with --yes if you really mean it.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(`${question} [y/N] `, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// ─── --changed ────────────────────────────────────────────────────────────────

function changedFunctionFiles() {
  // `git diff HEAD` covers modified tracked files; a BRAND NEW callable lives in an
  // untracked file, which that command never reports — so ask for both.
  const commands = [
    ['diff', '--name-only', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  const out = [];
  for (const args of commands) {
    const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
    if (res.status !== 0) return null;
    out.push(res.stdout);
  }
  const seen = new Set(out.join('\n').split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('functions/src/') && s.endsWith('.ts')));
  return [...seen].sort();
}

function reportChanged() {
  const files = changedFunctionFiles();
  if (files == null) {
    log('✖ Could not run `git diff --name-only HEAD`. Name the functions explicitly.');
    return 1;
  }
  if (files.length === 0) {
    log('No uncommitted changes under functions/src/. Nothing to suggest.');
    log('(--changed only compares the WORKING TREE against HEAD.)');
    return 0;
  }
  log('Changed files under functions/src/:');
  for (const f of files) log(`  • ${f}`);

  const deployable = discoverDeployableNames();
  const suggested = new Set();
  for (const f of files) {
    for (const n of namesDeclaredIn(path.join(REPO_ROOT, f))) {
      if (deployable.has(n)) suggested.add(n);
    }
  }

  log('');
  if (suggested.size === 0) {
    log('None of those files declare a deployable function directly.');
    log('They are shared helpers — every function importing them is affected.');
  } else {
    log('Functions DECLARED in those files (a starting point, not an answer):');
    log(`  ${[...suggested].sort().join(' ')}`);
    log('');
    log(`  node scripts/deploy-functions.mjs ${[...suggested].sort().join(' ')}`);
  }
  log('');
  log('⚠ This is a SUGGESTION only — nothing was deployed.');
  log('  A change to a shared helper (obs/log.ts, batchUtil.ts, packages/shared,');
  log('  a type file) changes the bundle for functions NOT listed above. Read the');
  log('  diff and decide; do not trust this list blindly.');
  return 0;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(argv) {
  const { flags, names, passthrough } = parseArgs(argv);

  if (flags.help) { printHelp(); return 0; }
  if (flags.changed) return reportChanged();

  const deployable = discoverDeployableNames();
  if (deployable.size < 20) {
    log(`✖ Only found ${deployable.size} exported functions in functions/src/index.ts.`);
    log('  That is implausibly few — the export scan is probably broken. Refusing.');
    return 1;
  }

  let targets = names;

  if (names.length === 0) {
    if (!flags.all) {
      log('');
      log('✖ No function names given — refusing to run a FULL deploy by accident.');
      log('');
      printCost(deployable.size, 'A full deploy would rebuild');
      log('  A full deploy uses up essentially the ENTIRE daily free allowance, so a');
      log('  SECOND deploy on the same day is billed to your card.');
      log('');
      log('  Deploy only what you changed instead (usually ~1-2 build-minutes):');
      log('    npm run deploy:fn -- <fnName> [<fnName>...]');
      log('    npm run deploy:fn -- --changed     # suggest names from your git diff');
      log('');
      log('  If you really do want everything:');
      log('    npm run deploy:fn -- --all');
      log('');
      return 1;
    }
    targets = [];   // full deploy: `--only functions`
  } else {
    const unknown = names.filter((n) => !deployable.has(n));
    if (unknown.length) {
      log(`✖ Unknown function name(s): ${unknown.join(', ')}`);
      const all = [...deployable].sort();
      for (const u of unknown) {
        const near = all.filter((n) => n.toLowerCase().includes(u.toLowerCase().slice(0, 5)));
        if (near.length) log(`   did you mean: ${near.slice(0, 6).join(', ')}?`);
      }
      log(`\n  ${all.length} deployable names are exported from functions/src/index.ts.`);
      log('  Nothing was deployed (a typo would otherwise deploy NOTHING, silently).');
      return 1;
    }
  }

  const count = targets.length || deployable.size;
  printCost(count, targets.length ? 'Deploying' : 'FULL DEPLOY — rebuilding');

  const args = buildDeployArgs(targets, passthrough);
  const cmd = `firebase ${args.join(' ')}`;

  if (count > CONFIRM_THRESHOLD) {
    log(`⚠ ${count} functions is over the ${CONFIRM_THRESHOLD}-function confirmation threshold.`);
    const ok = await confirm(`Run: ${cmd}\nProceed?`, flags);
    if (!ok) { log('Aborted. Nothing was deployed.'); return 1; }
  }

  if (flags.dryRun) {
    log(`[dry-run] would run: ${cmd}`);
    log('[dry-run] nothing was deployed.');
    return 0;
  }

  log(`→ ${cmd}\n`);
  const res = spawnSync('firebase', args, {
    cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32',
  });
  return res.status ?? 1;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
