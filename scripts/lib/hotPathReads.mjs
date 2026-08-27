// Which reads on the hot path MUST go through the document cache, and a check that they do.
// (change: hot-path-read-cost)
//
// WHY THIS EXISTS — measured, not theorised. The production op counter showed
// `submitTaskAnswer` costing 10.53 Firestore reads per call and `completeTask` 10.69, while
// their own logic touches three documents. The difference was
// `maybeRefreshLeaderboardSnapshot`, which runs INSIDE those callables on a 20-second throttle
// and did `db.collection(teamsCol(...)).get()` — an uncached read of every team document in the
// run. Its cost is billed to whichever player action happened to trigger it, which is exactly
// why nobody had noticed: no single call site looked expensive.
//
// At 120 teams over 75 minutes that is 225 refreshes x 122 documents = ~27,450 reads, the
// single largest consumer in the product, against a 50,000/day ceiling.
//
// `listRunTeams` had already solved this: it reads the same collection through
// `cachedGetCollection`, which re-reads only documents that were actually written. The
// leaderboard refresh simply never adopted it.
//
// WHY DECLARED RATHER THAN INFERRED. "Should this read be cached?" is a question about whether
// the document can change during a run and whether staleness would be visible — not something a
// regex can decide. A blanket "cache every read" would be wrong: `listRunTeams` deliberately
// re-reads the run document uncached each poll, and the one-off organizer paths (finalize,
// recap, analytics) run once and gain nothing. So the sites are declared here with the reason
// each one is safe to cache, exactly as transactionRetry.mjs and callableHardening.mjs declare
// their surfaces.

/** Hot participant paths whose GAME-document read must be cached. */
export const CACHED_GAME_READS = [
  { fn: 'submitTaskAnswer', why: 'every answer, every team' },
  { fn: 'submitSequenceStep', why: 'every step of every sequence mission' },
  { fn: 'completeTask', why: 'every completion' },
  { fn: 'completeTaskForTeam', why: 'the shared completion path behind several callables' },
  { fn: 'reportArrival', why: 'polled by the client while a hidden mission is sealed' },
  { fn: 'requestTaskHint', why: 'per hint, per team' },
  { fn: 'getRecommendedTasks', why: 'per participant request' },
  { fn: 'revealTaskAnswer', why: 'per participant request' },
  { fn: 'assignNextInActiveStage', why: 'runs on every routing decision' },
  { fn: 'maybeRefreshLeaderboardSnapshot', why: 'fires on a 20s throttle for the whole run' },
];

/**
 * Collection reads that must go through the cached helper, so their cost tracks CHURN rather
 * than participant count.
 */
export const CACHED_COLLECTION_READS = [
  {
    fn: 'maybeRefreshLeaderboardSnapshot',
    collection: 'teamsCol',
    why: 'reads every team in the run on a 20s throttle — ~27,450 reads at 120 teams over a '
       + '75-minute run, the largest single consumer measured in production',
  },
];

/**
 * Per-document reads on the hot path that must be cached, named by the helper each one should
 * use. Separate from the game list because the REASON differs: a game document cannot change
 * mid-run at all, whereas a team document changes often — it is cached because every WRITE to
 * it invalidates the entry, so a cached hit is only ever served while nothing has changed it.
 */
export const CACHED_DOC_READS = [
  {
    fn: 'resolveCallerTeam',
    forbid: /await\s+teamRef\.get\(\)/,
    why: 'every participant callable resolves its team here — ~23,000 reads per run at 120 '
       + 'teams, one per state poll, location ping, arrival, answer and completion',
  },
];

/** Body extraction shared with the transaction guard's idiom. */
export function extractBody(source, fn) {
  if (typeof source !== 'string') return null;
  for (const decl of [
    `export const ${fn} = loggedCallable`,
    `export const ${fn} =`,
    `async function ${fn}(`,
    `function ${fn}(`,
  ]) {
    const start = source.indexOf(decl);
    if (start < 0) continue;
    const rest = source.slice(start + decl.length);
    const next = rest.search(/\nexport (const|async function|function) |\n(async function|function) \w+\(/);
    return next < 0 ? rest : rest.slice(0, next);
  }
  return null;
}

/** True when the body performs NO uncached `db.doc(gamePath(...)).get()`. */
export function gameReadIsCached(body) {
  if (typeof body !== 'string') return false;
  return !/await\s+db\s*\.doc\(\s*gamePath\(/.test(body);
}

/** True when the body performs NO uncached `db.collection(<collection>(...)).get()`. */
export function collectionReadIsCached(body, collection) {
  if (typeof body !== 'string') return false;
  const re = new RegExp(`db\\s*\\.collection\\(\\s*${collection}\\(`);
  return !re.test(body);
}

/**
 * @returns {{fn: string, problem: string}[]} empty when every declared site is cached. A
 * declared site that cannot be FOUND is reported too: a rename that silently stops checking
 * is the failure this guard exists to prevent.
 */
export function findUncachedHotReads(readFile, file = 'functions/src/runs/index.ts') {
  let source;
  try {
    source = readFile(file);
  } catch (e) {
    return [{ fn: '(file)', problem: `could not read ${file}: ${e.message}` }];
  }
  const problems = [];
  for (const site of CACHED_GAME_READS) {
    const body = extractBody(source, site.fn);
    if (body == null) {
      problems.push({ fn: site.fn, problem: `declared function not found in ${file} — renamed or removed?` });
      continue;
    }
    if (!gameReadIsCached(body)) {
      problems.push({ fn: site.fn, problem: `reads the game document uncached (${site.why}) — use cachedGetDoc` });
    }
  }
  for (const site of CACHED_DOC_READS) {
    const body = extractBody(source, site.fn);
    if (body == null) {
      problems.push({ fn: site.fn, problem: `declared function not found in ${file} — renamed or removed?` });
      continue;
    }
    if (site.forbid.test(body)) {
      problems.push({ fn: site.fn, problem: `reads its document uncached — ${site.why}` });
    }
  }
  for (const site of CACHED_COLLECTION_READS) {
    const body = extractBody(source, site.fn);
    if (body == null) {
      problems.push({ fn: site.fn, problem: `declared function not found in ${file} — renamed or removed?` });
      continue;
    }
    if (!collectionReadIsCached(body, site.collection)) {
      problems.push({ fn: site.fn, problem: `reads ${site.collection} uncached — ${site.why}` });
    }
  }
  return problems;
}
