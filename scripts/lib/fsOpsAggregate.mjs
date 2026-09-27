// Aggregate per-invocation Firestore cost records out of a captured log
// (change: spark-tier-location-load). Pure: strings in, tallies out. No fs, no network.
//
// WHY PARSE LOGS INSTEAD OF ASKING THE PROCESS: the Firebase Functions emulator serves
// callables from a RuntimeWorkerPool — several Node processes — so no single process holds
// the whole picture, and a "give me the totals" callable answers from whichever worker took
// the request. Each invocation instead logs its OWN cost (see functions/src/obs/log.ts),
// and totalling happens here, offline, independent of how many processes existed.
//
// The parser is deliberately tolerant. It is reading a human-oriented emulator console, and
// the exact framing around the JSON payload is not a contract we control — so it looks for
// the marker, then for the fields, and IGNORES anything it cannot understand rather than
// throwing. What it must never do is silently under-report: `unparsed` is returned so a
// caller can see whether the denominator is trustworthy.

/** The stable marker written by `logFirestoreCost`. */
export const FSOPS_MARKER = 'fsops';

/**
 * Pull every fsops record out of raw log text.
 *
 * @returns {{ records: Array<{callable: string, reads: number, writes: number}>, unparsed: number }}
 */
export function parseFsOpsRecords(text) {
  const records = [];
  let unparsed = 0;

  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.includes(FSOPS_MARKER)) continue;

    const rec = parseLine(line);
    if (rec) records.push(rec);
    else unparsed += 1;
  }
  return { records, unparsed };
}

function parseLine(line) {
  // Preferred path: a JSON object somewhere on the line.
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(line.slice(start, end + 1));
      const rec = fromObject(obj);
      if (rec) return rec;
    } catch {
      // Fall through to the regex path — the emulator sometimes wraps or truncates.
    }
  }

  // Fallback: field-by-field, order-independent. Each field is matched on its own so a
  // reordered or interleaved payload still yields a record.
  const callable = /"callable"\s*:\s*"([^"]+)"/.exec(line)?.[1];
  const reads = /"reads"\s*:\s*(\d+)/.exec(line)?.[1];
  const writes = /"writes"\s*:\s*(\d+)/.exec(line)?.[1];
  if (callable && reads !== undefined && writes !== undefined) {
    return { callable, reads: Number(reads), writes: Number(writes) };
  }
  return null;
}

function fromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // The marker may be the log message or a nested field depending on the emitter.
  const isFsops = obj.message === FSOPS_MARKER || obj.msg === FSOPS_MARKER;
  const callable = obj.callable;
  if (!isFsops || typeof callable !== 'string') return null;
  const reads = Number(obj.reads);
  const writes = Number(obj.writes);
  if (!Number.isFinite(reads) || !Number.isFinite(writes)) return null;
  return { callable, reads, writes };
}

/**
 * Total parsed records into the `OpTallies` shape from @rushpoint/shared, plus the
 * invocation count per callable — which is the denominator that makes a per-call average
 * meaningful ("450 writes" is useless without "over 225 calls").
 *
 * @returns {{ byCallable: Record<string, {reads:number,writes:number,calls:number}>,
 *             total: {reads:number,writes:number,calls:number} }}
 */
export function aggregateFsOps(records) {
  const byCallable = {};
  const total = { reads: 0, writes: 0, calls: 0 };

  for (const r of records ?? []) {
    const entry = byCallable[r.callable] ?? { reads: 0, writes: 0, calls: 0 };
    entry.reads += r.reads;
    entry.writes += r.writes;
    entry.calls += 1;
    byCallable[r.callable] = entry;
    total.reads += r.reads;
    total.writes += r.writes;
    total.calls += 1;
  }
  return { byCallable, total };
}

/**
 * Render an aggregate as a table, heaviest first, WITH per-call averages and the call
 * count they were divided by. CLAUDE.md's rule applied: a check that counts things prints
 * its denominator, so "2.0 writes/call over 40 calls" is checkable and "2.0 writes" is not.
 */
export function formatFsOps(agg) {
  const rows = Object.entries(agg?.byCallable ?? {})
    .map(([callable, v]) => ({ callable, ...v }))
    .sort((a, b) => (b.reads + b.writes) - (a.reads + a.writes) || a.callable.localeCompare(b.callable));

  const lines = [];
  lines.push(`${'callable'.padEnd(30)} ${'calls'.padStart(6)} ${'reads'.padStart(7)} ${'writes'.padStart(7)}  per-call`);
  lines.push('─'.repeat(78));
  for (const r of rows) {
    const rpc = r.calls > 0 ? (r.reads / r.calls).toFixed(2) : '—';
    const wpc = r.calls > 0 ? (r.writes / r.calls).toFixed(2) : '—';
    lines.push(
      `${r.callable.padEnd(30)} ${String(r.calls).padStart(6)} ${String(r.reads).padStart(7)} ` +
      `${String(r.writes).padStart(7)}  ${rpc}r / ${wpc}w`,
    );
  }
  lines.push('─'.repeat(78));
  lines.push(
    `${'TOTAL'.padEnd(30)} ${String(agg?.total?.calls ?? 0).padStart(6)} ` +
    `${String(agg?.total?.reads ?? 0).padStart(7)} ${String(agg?.total?.writes ?? 0).padStart(7)}`,
  );
  return lines.join('\n');
}
