// Which Firestore transactions MUST be retry-wrapped, and a static check that they are.
// (change: contended-transaction-retry)
//
// WHY THIS EXISTS — a measured production failure, not a theory. A 120-team load simulation
// against api.rush-point.com died during the JOIN phase with:
//
//   10 ABORTED: Aborted due to cross-transaction contention. This occurs when multiple
//   transactions attempt to access the same data, requiring Firestore to abort at least one
//   in order to enforce serializability.
//   note: 'Exception occurred in retry method that was not classified as transient'
//
// It reached the participant as an opaque `functions/internal`. `joinRun` enforces the run's
// capacity cap inside a transaction that reads AND writes the ONE run document, so every
// simultaneous join queues on the same lock — and an event begins with everybody scanning the
// same QR code at the same moment. The routing paths were wrapped in `withLockRetry` back when
// this bug class was found in `completeTask`; joinRun was simply missed.
//
// WHY A DECLARED LIST RATHER THAN "WRAP EVERY TRANSACTION". Most of the ~45 transactions in
// functions/ touch a document only one caller can be holding — a team's own record, a wallet, a
// game template — and wrapping those would trade a fast honest failure for eight retries of a
// conflict that will never resolve. Contention is a property of WHICH DOCUMENT is touched under
// WHAT CONCURRENCY, which no regex can infer. So the sites are declared here, with the reason
// each one contends, exactly as callableHardening.mjs declares its auth and audit surfaces.
//
// Adding a transaction that many participants can enter at once ⇒ add it here AND wrap it.

/**
 * Transactions on a document that many participants can hit simultaneously.
 * `fn` is the exported callable; `why` states what is shared.
 */
export const CONTENDED_TRANSACTIONS = [
  {
    fn: 'joinRun',
    file: 'functions/src/runs/index.ts',
    why: 'reads and writes the run document to enforce the capacity cap; every participant '
       + 'joins the same run, and an event starts with all of them scanning at once',
  },
  {
    fn: 'joinTeamAsDevice',
    file: 'functions/src/runs/index.ts',
    why: 'increments the run-wide device counter, so every additional phone contends on the '
       + 'same run document as every other',
  },
  {
    fn: 'startTeams',
    file: 'functions/src/runs/index.ts',
    why: 'flips the whole field to started in one pass while late joiners are still writing '
       + 'the same run document',
  },
];

/** Source-order scan: does `body` call runTransaction without a withLockRetry above it? */
export function transactionIsWrapped(body) {
  if (typeof body !== 'string') return false;
  const txIndex = body.search(/\.runTransaction\s*[<(]/);
  if (txIndex < 0) return true; // no transaction at all ⇒ nothing to wrap
  // `withLockRetry(() => db.runTransaction(...))` — the wrapper must appear before it.
  const head = body.slice(0, txIndex);
  return /withLockRetry\s*\(/.test(head);
}

/**
 * Extract a callable's body from a module source, from `export const <fn> = ` to the start of
 * the next top-level `export const`. Deliberately crude: it only has to be good enough to see
 * whether a retry wrapper precedes a transaction, and a miss fails the check loudly rather
 * than passing it silently.
 */
export function extractCallableBody(source, fn) {
  if (typeof source !== 'string') return null;
  const start = source.indexOf(`export const ${fn} =`);
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const nextExport = rest.search(/\nexport (const|async function|function) /);
  return nextExport < 0 ? rest : rest.slice(0, nextExport);
}

/**
 * @returns {{fn: string, file: string, problem: string}[]} empty when every declared site is
 * wrapped. A declared site that cannot be FOUND is a problem too — a rename that silently
 * stops checking is the failure mode this guard exists to prevent.
 */
export function findUnwrappedTransactions(readFile) {
  const problems = [];
  for (const site of CONTENDED_TRANSACTIONS) {
    let source;
    try {
      source = readFile(site.file);
    } catch (e) {
      problems.push({ ...site, problem: `could not read ${site.file}: ${e.message}` });
      continue;
    }
    const body = extractCallableBody(source, site.fn);
    if (body == null) {
      problems.push({ ...site, problem: `declared callable "${site.fn}" not found in ${site.file} — renamed or removed?` });
      continue;
    }
    if (!transactionIsWrapped(body)) {
      problems.push({ ...site, problem: `runTransaction is NOT wrapped in withLockRetry — ${site.why}` });
    }
  }
  return problems;
}
