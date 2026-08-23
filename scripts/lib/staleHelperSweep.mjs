// Pure decision logic for the stale-helper sweep in scripts/free-ports.mjs
// (change: emulator-gate-isolation).
//
// WHY this exists
// ---------------
// free-ports.mjs used to kill by COMMAND-LINE PATTERN alone: anything whose command line
// contained `.cache\firebase\emulators`, `emulators:exec`, `functionsEmulatorRuntime` or
// `scripts/emulator-exec.mjs` was taskkill'd. An offset gate run
// (RUSHPOINT_EMULATOR_PORT_OFFSET) matches all four — so every playtest restart destroyed
// an in-flight gate no matter which ports it was on (the supervisor runs free-ports at the
// top of every loop iteration, scripts/playtest-forever.mjs:455). That made the whole
// port-offset feature unreliable by construction.
//
// This module answers only ONE question — given a snapshot of the process table, the
// patterns being swept, this repo's recorded emulator-exec sessions and the PORT BLOCK
// actually being swept, WHICH processes may be terminated. It imports nothing: no `fs`,
// no `child_process`, no `Date.now()`. Same pure-decision / impure-shell split as
// scripts/lib/emulatorReap.mjs + scripts/lib/reapEmulatorExec.mjs, and the shell
// (free-ports.mjs) keeps no `if` about whether a process may die.
//
// WHAT CHANGED vs. the old behaviour, precisely: a pattern match is still NECESSARY but is
// no longer SUFFICIENT. The playtest's own default-block emulators carry `--port 8080` /
// `--port 9099`, have no offset marker and belong to no running exec session, so they are
// still swept exactly as before. Only a DIFFERENT, LIVE port block is spared.
//
// Note the asymmetry with emulatorReap.mjs, and that it is deliberate: the reaper runs
// unattended and keeps anything it cannot attribute. free-ports is an explicit
// "clear the decks so the default stack can relaunch", so an unattributed match still
// dies — otherwise the launcher stops working. The fail-closed rule added here is scoped
// to the new axis only: any POSITIVE sign of a different live port block ⇒ do not kill.

/** Longest ppid chain we will walk; also the cycle backstop. */
const MAX_LINEAGE_DEPTH = 64;

/**
 * Textual proof that a process belongs to an OFFSET port block.
 *
 * The generated config name comes from scripts/emulator-exec.mjs (`--config
 * firebase.emulator-offset.json`); the env-var name comes from
 * scripts/lib/emulatorPorts.mjs. Either appearing in a command line is a positive signal
 * that survives even a missing session record.
 */
export const OFFSET_MARKER_PATTERNS = Object.freeze([
  'firebase.emulator-offset.json',
  'emulator-offset-tmp',
  'RUSHPOINT_EMULATOR_PORT_OFFSET',
]);

/**
 * Command-line substrings identifying a leftover emulator-gate helper, shared by
 * free-ports.mjs (sweeps the whole dev-port list before `dev:all`/`playtest`) and
 * emulator-exec.mjs (change: emulator-exec-port-race — sweeps just THIS boot's
 * ports as a fallback when a port is still busy after waiting). One list so the
 * two callers can never drift: a pattern added for one sweep protects the other
 * for free. See the module header above for why a pattern match alone is not
 * sufficient — `planStaleHelperSweep` still applies the live-port-block carve-outs.
 */
export const STALE_HELPER_PATTERNS = Object.freeze([
  'scripts/emulator-backup.mjs',
  'scripts\\emulator-backup.mjs',
  'scripts/ngrok-tunnel.mjs',
  'scripts\\ngrok-tunnel.mjs',
  'scripts/proxy.mjs',
  'scripts\\proxy.mjs',
  'cloudflared tunnel',
  'functionsEmulatorRuntime',
  'emulators:exec',
  '.cache\\firebase\\emulators',
  '.cache/firebase/emulators',
  'scripts/emulator-exec.mjs',
  'scripts\\emulator-exec.mjs',
  'scripts/simulate-browser-run.mjs',
  'scripts\\simulate-browser-run.mjs',
]);

function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * The port an emulator process was launched on, or null.
 *
 * The Firestore emulator JVM is spawned with `--host <h> --port <n>` (firebase-tools
 * lib/emulator/downloadableEmulators.js), so this is a direct, per-process statement of
 * which block it belongs to — the one signal that needs no session record and no lineage.
 * Anything unparseable, absent or out of the legal TCP range yields null ⇒ undecided, and
 * the caller falls through to the remaining rules.
 */
export function commandLinePort(commandLine) {
  const cmd = typeof commandLine === 'string' ? commandLine : '';
  const m = cmd.match(/--port[=\s]+(\d{1,5})\b/);
  if (!m) return null;
  const port = Number(m[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * Upper bound on how long an unfinished session record may keep protecting processes.
 *
 * `endedAt` is stamped by scripts/emulator-exec.mjs's exit handler. A run killed by a
 * power cut, a closed terminal or a SIGKILL never stamps it, so its record stays
 * "running" FOREVER — and without this bound its debris would become permanently
 * unkillable by free-ports, which is precisely the wedge free-ports exists to clear.
 * Six hours is far longer than any gate (the full verify:emulator gauntlet is minutes)
 * and far shorter than "forever". Beyond it the record is ignored and the old, blunt
 * verdict applies again.
 */
export const MAX_RUNNING_SESSION_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Is this recorded exec session still running?
 *
 * The `endedAt == null` half is the exact inverse of isFinishedSession() in
 * scripts/lib/emulatorReap.mjs, kept as its own exported predicate so the two modules can
 * never disagree about whether a session is live.
 *
 * The age half is opt-in: with no `nowMs` there is no clock (this module never reads one)
 * and no session ever expires, which is the conservative reading. The caller supplies the
 * time exactly as reapEmulatorExec.mjs does.
 */
export function isRunningSession(session, { nowMs, maxAgeMs = MAX_RUNNING_SESSION_AGE_MS } = {}) {
  if (!session || session.endedAt != null) return false;
  if (!Number.isFinite(Number(session.rootPid))) return false;
  const now = Number(nowMs);
  const started = Number(session.startedAt);
  if (!Number.isFinite(now)) return true;               // no clock supplied ⇒ no expiry
  if (!Number.isFinite(started)) return true;           // no start time ⇒ cannot age it out
  const age = now - started;
  return age <= Number(maxAgeMs);                       // a future-dated record stays live
}

function matchesAny(commandLine, patterns) {
  const cmd = lower(commandLine);
  if (cmd === '') return false;
  return patterns.some((p) => {
    const needle = lower(p);
    return needle !== '' && cmd.includes(needle);
  });
}

/**
 * THE decision. Given a process snapshot, the sweep patterns, the recorded sessions, the
 * port block being swept and the caller's identity, return an explicit verdict for EVERY
 * process:
 *
 *   { kill: [{ pid, commandLine }], keep: [{ pid, reason }] }
 *
 * Total and non-overlapping by construction: keep ∪ kill === input, keep ∩ kill === ∅.
 *
 * `nowMs` is optional and is used only to age out an unfinished session record (see
 * MAX_RUNNING_SESSION_AGE_MS). Omitting it means no record ever expires.
 *
 * Verdict order — every protection is evaluated BEFORE the kill rule, so none of them can
 * be overridden by a later match:
 *   self → self-ancestor → explicitly protected
 *   → matches no sweep pattern
 *   → lineage reaches a RUNNING exec session (root, ancestor of a root, or descendant)
 *   → command line carries an offset marker
 *   → bound to a --port outside the block being swept
 *   → KILL
 *
 * Descendants of protected pids are deliberately NOT protected (unlike
 * planEmulatorExecReap's protectedClosure): free-ports is spawned BY the playtest
 * supervisor, so protecting its ancestors' descendant closure would protect the entire
 * playtest stack and make the sweep a no-op — the opposite of its purpose.
 */
export function planStaleHelperSweep(input) {
  const args = input && typeof input === 'object' ? input : {};
  const list = (Array.isArray(args.processes) ? args.processes : [])
    .filter((p) => p && Number.isFinite(Number(p.pid)))
    .map((p) => ({ pid: Number(p.pid), ppid: Number(p.ppid), commandLine: String(p.commandLine ?? '') }));

  const plan = { kill: [], keep: [] };
  if (list.length === 0) return plan;

  const patterns = (Array.isArray(args.patterns) ? args.patterns : []).filter((p) => typeof p === 'string');
  const sweptPorts = new Set(
    (Array.isArray(args.sweptPorts) ? args.sweptPorts : []).map(Number).filter(Number.isFinite),
  );
  const sessionAgeOpts = { nowMs: args.nowMs, maxAgeMs: args.maxRunningSessionAgeMs ?? MAX_RUNNING_SESSION_AGE_MS };
  const runningRootPids = new Set(
    (Array.isArray(args.sessions) ? args.sessions : [])
      .filter((s) => isRunningSession(s, sessionAgeOpts))
      .map((s) => Number(s.rootPid)),
  );

  const byPid = new Map();
  for (const p of list) byPid.set(p.pid, p);

  // ── Protection sets ────────────────────────────────────────────────────────
  const selfPid = Number.isFinite(Number(args.selfPid)) ? Number(args.selfPid) : undefined;
  const selfAncestors = new Set();
  if (selfPid !== undefined) {
    let cur = byPid.get(selfPid);
    for (let depth = 0; cur && depth < MAX_LINEAGE_DEPTH; depth++) {
      const parent = byPid.get(Number(cur.ppid));
      if (!parent || parent.pid === cur.pid || selfAncestors.has(parent.pid)) break;
      selfAncestors.add(parent.pid);
      cur = parent;
    }
  }
  const explicitProtected = new Set(
    (Array.isArray(args.protectedPids) ? args.protectedPids : []).map(Number).filter(Number.isFinite),
  );

  // Ancestors of every RUNNING session root: `node scripts/emulator-exec.mjs …` matches a
  // sweep pattern but is the session root's PARENT, so a downward-only walk would miss it.
  const liveRootAncestors = new Set();
  for (const rootPid of runningRootPids) {
    let cur = byPid.get(rootPid);
    for (let depth = 0; cur && depth < MAX_LINEAGE_DEPTH; depth++) {
      const parent = byPid.get(Number(cur.ppid));
      if (!parent || parent.pid === cur.pid || liveRootAncestors.has(parent.pid)) break;
      liveRootAncestors.add(parent.pid);
      cur = parent;
    }
  }

  /**
   * Does this process's ancestry reach a running exec session root?
   *
   * Two attribution paths, matching the two shapes a gate process takes:
   *   1. in-snapshot ancestry — the chain reaches a pid that IS a running session root;
   *   2. absent-root ancestry — the chain reaches a ppid MISSING from the snapshot (on
   *      Windows an orphan keeps naming its dead parent) that is a running session root.
   * Depth-capped and cycle-guarded: a ppid cycle terminates and attributes nothing.
   */
  function reachesRunningSession(proc) {
    const seen = new Set();
    let cur = proc;
    for (let depth = 0; cur && depth < MAX_LINEAGE_DEPTH; depth++) {
      if (seen.has(cur.pid)) return false;          // cycle → attribute nothing
      seen.add(cur.pid);
      if (runningRootPids.has(cur.pid)) return true;
      const ppid = Number(cur.ppid);
      if (!Number.isFinite(ppid)) return false;
      const parent = byPid.get(ppid);
      if (!parent) return runningRootPids.has(ppid); // the chain left the snapshot
      cur = parent;
    }
    return false;
  }

  for (const proc of list) {
    const { pid } = proc;
    const keep = (reason) => plan.keep.push({ pid, reason });

    if (selfPid !== undefined && pid === selfPid) { keep('self'); continue; }
    if (selfAncestors.has(pid)) { keep('self-ancestor'); continue; }
    if (explicitProtected.has(pid)) { keep('protected'); continue; }

    if (!matchesAny(proc.commandLine, patterns)) { keep('no-pattern-match'); continue; }

    if (runningRootPids.has(pid) || liveRootAncestors.has(pid) || reachesRunningSession(proc)) {
      keep('live-exec-session');
      continue;
    }
    if (matchesAny(proc.commandLine, OFFSET_MARKER_PATTERNS)) { keep('offset-port-block'); continue; }

    const port = commandLinePort(proc.commandLine);
    if (port !== null && sweptPorts.size > 0 && !sweptPorts.has(port)) { keep('foreign-port-block'); continue; }

    plan.kill.push({ pid, commandLine: proc.commandLine });
  }

  plan.kill.sort((a, b) => a.pid - b.pid);
  return plan;
}
