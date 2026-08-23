// Pure decision logic for reaping orphaned `firebase emulators:exec` processes
// (change: emulator-exec-orphan-reap).
//
// An emulators:exec run that has FINISHED can leave its firebase-tools parent, its
// emulator JVMs and its functionsEmulatorRuntime workers alive; they hold 8080/9099/
// 5001/4000 and wedge the NEXT gate (observed: a rules run blocked for ~an hour).
//
// This module answers only ONE question — given a snapshot of the process table and a
// record of this repo's exec sessions, WHICH processes are reapable orphans. It imports
// nothing: no `fs`, no `child_process`, no `Date.now()`. Time, the process list and the
// session records are all passed in, exactly like scripts/lib/emulatorBackup.mjs, so the
// kill logic can be tested adversarially without a single real process existing
// (scripts/test-emulator-reap.ts). The impure shell that enumerates and kills lives in
// scripts/lib/reapEmulatorExec.mjs and contains no decisions at all.
//
// FAIL CLOSED is the whole design. A process is reaped ONLY when it is positively
// attributed to a FINISHED emulators:exec session of THIS repository. Matching an
// emulator-ish pattern is necessary but never sufficient — the live dev/playtest stack
// runs the identical firebase-tools, the identical JVM and the identical jar path, so
// pattern matching alone cannot tell a live stack from a corpse. Lineage can.
// Every other outcome — unknown, ambiguous, foreign, young — is KEEP.

/** Longest ppid chain we will walk; also the cycle backstop. */
const MAX_LINEAGE_DEPTH = 64;
/** Slack around a recorded session window, for clock jitter / spawn ordering. */
const SESSION_WINDOW_GRACE_MS = 60_000;
/** Default floor: a process born moments ago is never an "orphan" worth killing. */
const DEFAULT_MIN_AGE_MS = 5_000;

/** A LIVE emulator session (dev / playtest). This lineage is ALWAYS kept. */
const LIVE_ROOT_PATTERNS = [
  'emulators:start',
  'dev-emulator.mjs',
  'playtest-forever.mjs',
  'npm:emulator',
];

/** An `emulators:exec` session root (still needs repo attribution to count). */
const EXEC_ROOT_PATTERNS = [
  'emulators:exec',
  'emulator-exec.mjs',
];

/** Necessary-but-not-sufficient: this process is emulator machinery of some kind. */
const EMULATOR_PATTERNS = [
  '.cache/firebase/emulators',
  '.cache\\firebase\\emulators',
  'functionsemulatorruntime',
  'firebase-tools',
  'cloud-firestore-emulator',
  'firebase-database-emulator',
  'cloud-storage-rules-runtime',
  'firebase-ui-emulator',
];

function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function includesAny(haystack, needles) {
  return needles.some((n) => haystack.includes(lower(n)));
}

/**
 * Does this command line belong to THIS repository? The only textual signal available in
 * a plain process snapshot is the repo root path, in either slash flavour, compared
 * case-insensitively (Windows paths are case-insensitive and CIM reports mixed case).
 * Most exec roots are spawned with RELATIVE script paths and so will NOT match here —
 * that is exactly why session-record attribution exists.
 */
export function isRepoOwnedCommand(commandLine, repoRoot) {
  const cmd = lower(commandLine);
  const root = lower(repoRoot);
  if (!cmd || !root) return false;
  const back = root.replace(/\//g, '\\');
  const fwd = root.replace(/\\/g, '/');
  return cmd.includes(back) || cmd.includes(fwd);
}

/**
 * Classify one process by its command line alone. Roles are not mutually exclusive; the
 * caller resolves precedence (live ALWAYS wins).
 */
export function classifyProcessRole(commandLine) {
  const cmd = lower(commandLine);
  return {
    live: includesAny(cmd, LIVE_ROOT_PATTERNS),
    execRoot: includesAny(cmd, EXEC_ROOT_PATTERNS),
    emulatorish: includesAny(cmd, EMULATOR_PATTERNS),
  };
}

/**
 * Has this session finished? `endedAt` is `null`/absent while it runs — and `Number(null)`
 * is `0`, which IS finite, so the null check has to come first or a running session reads
 * as "ended at the epoch" and its live children become reap candidates.
 */
export function isFinishedSession(session) {
  if (!session || session.endedAt == null) return false;
  return Number.isFinite(Number(session.endedAt));
}

function bornInSessionWindow(startedAt, session) {
  if (!Number.isFinite(startedAt) || !session) return false;
  const from = Number(session.startedAt);
  if (!Number.isFinite(from)) return false;
  const to = isFinishedSession(session) ? Number(session.endedAt) : Number.POSITIVE_INFINITY;
  return startedAt >= from - SESSION_WINDOW_GRACE_MS && startedAt <= to + SESSION_WINDOW_GRACE_MS;
}

/**
 * Walk a process's ancestry and report what it leads to.
 *
 * Returns `{ live, session, execRootSeen }`:
 *   live         — some ancestor (or the process itself) is a live dev/playtest root.
 *   session      — the recorded exec session this process belongs to, or null.
 *   execRootSeen — an exec root of THIS repo was found in the lineage, even if no session
 *                  record matched it (⇒ treat as a session whose end is unknown).
 *
 * Two attribution paths, matching the two shapes an orphan takes:
 *   1. in-snapshot ancestry — the chain reaches a process that IS an attributable exec root;
 *   2. session-record ancestry — the chain reaches a pid that is ABSENT from the snapshot
 *      (its parent died — on Windows the ppid field still names it) and that pid is a
 *      recorded session root, and the candidate was born inside that session's window.
 *
 * Depth-capped and cycle-guarded: a ppid cycle terminates and attributes nothing.
 */
export function resolveLineage(proc, { byPid, sessionsByRootPid, sessions }) {
  const result = { live: false, session: null, execRootSeen: false };
  if (!proc) return result;
  const startedAt = Number(proc.startedAt);
  const seen = new Set();
  let cur = proc;
  for (let depth = 0; cur && depth < MAX_LINEAGE_DEPTH; depth++) {
    if (seen.has(cur.pid)) break;          // cycle / self-parent → attribute nothing
    seen.add(cur.pid);

    const role = classifyProcessRole(cur.commandLine);
    if (role.live) result.live = true;     // never returns early: live must always win

    const ownSession = sessionsByRootPid.get(cur.pid);
    if (role.execRoot && (ownSession || isRepoOwnedCommand(cur.commandLine, proc.__repoRoot))) {
      result.execRootSeen = true;
      if (!result.session && ownSession) result.session = ownSession;
    }

    const ppid = Number(cur.ppid);
    if (!Number.isFinite(ppid)) break;
    const parent = byPid.get(ppid);
    if (!parent) {
      // The chain leaves the snapshot. If that missing pid is a recorded session root and
      // this process was born during that session, it is one of ours.
      const s = sessionsByRootPid.get(ppid);
      if (s && bornInSessionWindow(startedAt, s)) {
        result.execRootSeen = true;
        if (!result.session) result.session = s;
      }
      break;
    }
    cur = parent;
  }
  // A candidate attributed through an in-snapshot exec root must ALSO have been born in
  // that session's window — the pid-reuse defence, applied uniformly.
  if (result.session && !bornInSessionWindow(startedAt, result.session)) {
    result.session = null;
    result.execRootSeen = false;   // pid reuse: drop the attribution entirely → 'unattributed'
  }
  return result;
}

function collectDescendants(rootPids, childrenByPpid) {
  const out = new Set();
  const queue = [...rootPids];
  while (queue.length > 0 && out.size < 100_000) {
    const pid = queue.shift();
    if (out.has(pid)) continue;
    out.add(pid);
    for (const child of childrenByPpid.get(pid) ?? []) queue.push(child);
  }
  return out;
}

/**
 * THE decision. Given a process snapshot, this repo's recorded exec sessions and the
 * caller's identity, return an explicit verdict for EVERY process:
 *
 *   { reap: [{ pid, reason, commandLine }], keep: [{ pid, reason }] }
 *
 * Total and non-overlapping by construction: keep ∪ reap === input, keep ∩ reap === ∅.
 * A process that falls through every rule is KEPT ('unattributed'), never dropped.
 *
 * Verdict order — live protection is evaluated BEFORE any reaping rule so it can never be
 * overridden by a later match:
 *   self / self-ancestor / protected (+ their descendants)
 *   → live lineage
 *   → not emulator machinery
 *   → unknown start time
 *   → no attribution to an exec session of this repo
 *   → that session is still running
 *   → younger than minAgeMs
 *   → REAP
 */
export function planEmulatorExecReap({
  processes = [],
  repoRoot = '',
  selfPid = undefined,
  protectedPids = [],
  sessions = [],
  nowMs = undefined,
  minAgeMs = DEFAULT_MIN_AGE_MS,
} = {}) {
  const list = Array.isArray(processes) ? processes.filter((p) => p && Number.isFinite(Number(p.pid))) : [];
  const plan = { reap: [], keep: [] };
  if (list.length === 0) return plan;

  const byPid = new Map();
  const childrenByPpid = new Map();
  for (const p of list) {
    const pid = Number(p.pid);
    // __repoRoot rides along so lineage classification can test repo ownership without a
    // second parameter on every helper. Never mutates the caller's objects.
    byPid.set(pid, { ...p, pid, __repoRoot: repoRoot });
  }
  for (const p of byPid.values()) {
    const ppid = Number(p.ppid);
    if (!Number.isFinite(ppid)) continue;
    if (!childrenByPpid.has(ppid)) childrenByPpid.set(ppid, []);
    childrenByPpid.get(ppid).push(p.pid);
  }

  const sessionList = Array.isArray(sessions) ? sessions.filter((s) => s && Number.isFinite(Number(s.rootPid))) : [];
  const sessionsByRootPid = new Map();
  for (const s of sessionList) sessionsByRootPid.set(Number(s.rootPid), s);

  // ── Protection sets ────────────────────────────────────────────────────────
  // The reap runs INSIDE the exec wrapper's own tree at exit, so without this the
  // reaper is a plausible member of its own kill list.
  const selfAncestors = new Set();
  if (Number.isFinite(Number(selfPid))) {
    let cur = byPid.get(Number(selfPid));
    for (let depth = 0; cur && depth < MAX_LINEAGE_DEPTH; depth++) {
      const ppid = Number(cur.ppid);
      if (!Number.isFinite(ppid)) break;
      const parent = byPid.get(ppid);
      if (!parent || selfAncestors.has(parent.pid) || parent.pid === cur.pid) break;
      selfAncestors.add(parent.pid);
      cur = parent;
    }
  }
  const explicitProtected = new Set(
    (Array.isArray(protectedPids) ? protectedPids : []).map(Number).filter(Number.isFinite),
  );
  const protectedRoots = new Set([
    ...(Number.isFinite(Number(selfPid)) ? [Number(selfPid)] : []),
    ...selfAncestors,
    ...explicitProtected,
  ]);
  const protectedClosure = collectDescendants(protectedRoots, childrenByPpid);

  const floor = Number.isFinite(Number(minAgeMs)) ? Number(minAgeMs) : DEFAULT_MIN_AGE_MS;
  const now = Number(nowMs);

  for (const p of list) {
    const pid = Number(p.pid);
    const proc = byPid.get(pid);
    const keep = (reason) => plan.keep.push({ pid, reason });

    if (Number.isFinite(Number(selfPid)) && pid === Number(selfPid)) { keep('self'); continue; }
    if (selfAncestors.has(pid)) { keep('self-ancestor'); continue; }
    if (explicitProtected.has(pid)) { keep('protected'); continue; }
    if (protectedClosure.has(pid)) { keep('protected-descendant'); continue; }

    const role = classifyProcessRole(proc.commandLine);
    const lineage = resolveLineage(proc, { byPid, sessionsByRootPid, sessions: sessionList });

    if (lineage.live || role.live) { keep('live-emulator-session'); continue; }
    if (!role.emulatorish && !role.execRoot) { keep('not-an-emulator-process'); continue; }
    if (!Number.isFinite(Number(proc.startedAt))) { keep('unknown-start-time'); continue; }
    if (!lineage.session && !lineage.execRootSeen) { keep('unattributed'); continue; }
    // An exec root of this repo with NO session record: we cannot know it finished.
    if (!lineage.session) { keep('running-exec-session'); continue; }
    if (!isFinishedSession(lineage.session)) { keep('running-exec-session'); continue; }
    if (Number.isFinite(now) && now - Number(proc.startedAt) < floor) { keep('too-young'); continue; }

    plan.reap.push({ pid, reason: 'orphan-of-finished-exec-session', commandLine: proc.commandLine });
  }

  plan.reap.sort((a, b) => a.pid - b.pid);
  return plan;
}
