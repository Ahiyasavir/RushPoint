// Pure helper for the pre-boot port wait (change: emulator-exec-port-race).
//
// `emulator-exec.mjs` is invoked FRESH per gauntlet phase (`verify:emulator`
// chains several `node scripts/emulator-exec.mjs "..."` calls with `&&`). Each
// invocation is a new process with no memory of the previous one — so nothing
// upstream of it can guarantee the OS has actually released a port between one
// phase's JVM receiving SIGINT and the next phase's CLI trying to bind it.
// Observed directly: a clean, unmodified `simulate-run.mjs` boot, run seconds
// after a prior boot's clean shutdown, failed with "Port 8080 is not open …
// could not start Firestore Emulator" — not a code bug, a shutdown/startup race.
//
// `portsToAwait(only, ports)` is the pure decision: which of this boot's actual
// port numbers are worth waiting on, given its `--only=<list>` selection. Kept
// separate from the network polling (in emulator-exec.mjs) so the MAPPING is
// unit-tested without spinning up real sockets.
export function portsToAwait(only, ports) {
  const selected = String(only ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const name of selected) {
    const port = ports?.[name];
    if (typeof port !== 'number' || !Number.isFinite(port) || seen.has(port)) continue;
    seen.add(port);
    result.push(port);
  }
  return result;
}
