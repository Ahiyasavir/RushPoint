// The new-game template menu, cached and pre-warmed (perf: template-picker-latency).
//
// WHY THIS EXISTS. `listGameTemplates` is a cross-origin callable against the
// self-hosted API: a CORS preflight, then a POST that verifies an ID token, runs
// the rate-limit transaction and a collectionGroup query — roughly a second of
// wall clock from a phone on mobile data. The picker used to start that call at
// the moment it opened and render a
// spinner until it answered, so "press New game" always cost a visible wait even
// though the answer is the SAME short list for every creator and changes maybe
// once a month.
//
// The list is not per-creator (the server returns every admin-authored template
// to any authenticated caller), so it is cacheable across mounts, across routes
// and across reloads. Three layers, each strictly faster than the one below:
//
//   1. an in-flight promise   — two callers (mount prefetch + picker open) share
//                               ONE network call instead of racing two.
//   2. a module-level memo    — instant for the rest of this page's life.
//   3. localStorage           — instant on the FIRST open after a reload, then
//                               revalidated in the background (stale-while-
//                               revalidate), so a creator sees the menu they saw
//                               last time and it corrects itself in place.
//
// Everything that DECIDES is pure and lives at the top of this file
// (`templateCacheVerdict`, `parseStoredTemplates`) — see
// scripts/test-template-cache.ts. Only `loadTemplates()` touches the network.
//
// The import below is TYPE-ONLY on purpose, and the callable is reached through a
// dynamic import inside `fetchTemplates`: a value import of `services/calls` pulls
// in the Firebase SDK and initialises an app at module load, which would make this
// file unimportable by the pure `scripts/test-*.ts` lane.
import type { TemplateGroupEntry } from '../services/calls';

/** A cached menu plus the wall-clock ms it was fetched at. */
export interface CachedTemplates {
  templates: TemplateGroupEntry[];
  ts: number;
}

/**
 * How the cache should be used on this read.
 *  • `fresh` — render it, do not refetch.
 *  • `stale` — render it NOW and refetch in the background (the creator never
 *    waits for a list that is almost certainly still correct).
 *  • `miss`  — nothing usable; the caller must fetch before it can render.
 */
export type CacheVerdict = 'fresh' | 'stale' | 'miss';

/** Younger than this ⇒ don't even revalidate. Templates change rarely. */
export const TEMPLATE_FRESH_MS = 5 * 60_000;
/**
 * Older than this ⇒ treated as a miss rather than shown. A template the admin
 * deleted long ago would otherwise stay pickable, and picking it fails at
 * `createGameFromTemplate` with an error dialog instead of a game. A day bounds
 * that window while still making the common "same creator, next day" open instant
 * after one background revalidation.
 */
export const TEMPLATE_MAX_AGE_MS = 24 * 60 * 60_000;

/** Bumped when the cached SHAPE changes, so an old payload is ignored, not fed
 *  to the picker as half-typed data. */
const STORAGE_KEY = 'rp-templates-v1';

export function templateCacheVerdict(
  entry: CachedTemplates | null,
  nowMs: number,
  freshMs = TEMPLATE_FRESH_MS,
  maxAgeMs = TEMPLATE_MAX_AGE_MS,
): CacheVerdict {
  if (!entry) return 'miss';
  // A timestamp from the future (clock moved back, edited storage) is not
  // evidence of freshness — treat any non-sane age as a miss.
  const age = nowMs - entry.ts;
  if (!Number.isFinite(age) || age < 0) return 'miss';
  if (age < freshMs) return 'fresh';
  if (age < maxAgeMs) return 'stale';
  return 'miss';
}

/**
 * A stored payload, or `null` for anything that is not one. TOTAL: a blocked,
 * truncated or hand-edited store must degrade to "no cache", never throw on the
 * dashboard's first render.
 */
export function parseStoredTemplates(raw: string | null): CachedTemplates | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { templates, ts } = parsed as { templates?: unknown; ts?: unknown };
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
    if (!Array.isArray(templates)) return null;
    // Every entry must carry the two fields the picker dereferences; anything
    // else is a shape we don't recognise and must not render.
    const ok = templates.every((t) => !!t && typeof t === 'object'
      && typeof (t as TemplateGroupEntry).groupKey === 'string'
      && !!(t as TemplateGroupEntry).variants && typeof (t as TemplateGroupEntry).variants === 'object');
    if (!ok) return null;
    return { templates: templates as TemplateGroupEntry[], ts };
  } catch {
    return null;
  }
}

// ─── The impure layer ────────────────────────────────────────────────────────

let memo: CachedTemplates | null = null;
let inFlight: Promise<TemplateGroupEntry[]> | null = null;

function readStorage(): CachedTemplates | null {
  try {
    return parseStoredTemplates(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null; // storage disabled (private mode, blocked cookies)
  }
}

function writeStorage(entry: CachedTemplates): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch { /* quota or storage unavailable — the memo still serves this page */ }
}

/** The best cached menu available right now, memory first, then localStorage. */
export function peekTemplates(nowMs = Date.now()): { entry: CachedTemplates; verdict: CacheVerdict } | null {
  const entry = memo ?? readStorage();
  if (!entry) return null;
  const verdict = templateCacheVerdict(entry, nowMs);
  if (verdict === 'miss') return null;
  if (!memo) memo = entry; // promote the stored copy so later reads skip JSON.parse
  return { entry, verdict };
}

/** The real network call, reached lazily (see the type-only import above). */
async function callListGameTemplates(): Promise<{ templates: TemplateGroupEntry[] }> {
  const { listGameTemplates } = await import('../services/calls');
  return listGameTemplates();
}

/**
 * Fetch the menu, sharing one network call between every concurrent caller and
 * publishing the result to both cache layers. `fetcher` is injected only by the
 * tests; production always uses the callable.
 */
export function fetchTemplates(
  fetcher: () => Promise<{ templates: TemplateGroupEntry[] }> = callListGameTemplates,
): Promise<TemplateGroupEntry[]> {
  if (inFlight) return inFlight;
  inFlight = fetcher()
    .then(({ templates }) => {
      const entry: CachedTemplates = { templates, ts: Date.now() };
      memo = entry;
      writeStorage(entry);
      return templates;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Test seam — the cache as the process currently holds it in memory. */
export function __peekMemoForTests(): CachedTemplates | null {
  return memo;
}

/**
 * Drop the cached menu entirely — memory AND storage.
 *
 * Called by the admin templates console, the one surface that CHANGES what the
 * picker should show. Without it the admin who just authored a template would be
 * the one person still seeing the old menu, for up to the stale window, on the
 * device where they made the change.
 */
export function invalidateTemplateCache(): void {
  memo = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

/** Test seam — drops both in-memory layers (not localStorage). */
export function __resetTemplateCacheForTests(): void {
  memo = null;
  inFlight = null;
}
