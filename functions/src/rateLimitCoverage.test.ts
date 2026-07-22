// Structural guard: every rate-limit bucket a callable ENFORCES must have a
// BUDGET defined, or the limit silently does nothing.
//
// Why this test exists rather than a code review note: `enforceRateLimit` is
// deliberately fail-open when `RATE_LIMITS[bucket]` is missing (see
// rateLimitStore.ts) — it logs `rateLimit.noBudget` and returns. That is the
// right runtime behaviour (a typo must not break a live game mid-run) but it
// means an unbudgeted bucket is INVISIBLE at the call site: the code reads as
// protected and is not. A snapshot of this drift found 14 such callables at
// once, so the failure mode is systemic, not a one-off slip.
//
// Scanning the source is intentional. A per-callable unit test would have to be
// remembered for each NEW callable — exactly the discipline that already failed.
// This asserts the invariant over the whole tree, so a new unbudgeted bucket
// ships RED without anyone remembering anything.

import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { RATE_LIMITS } from '@rushpoint/shared';

// Resolved from the vitest root (the `functions` workspace) rather than
// `import.meta.url`: this workspace compiles to CommonJS, where `import.meta`
// is a typecheck error even though vitest itself would accept it.
const SRC = path.join(process.cwd(), 'src');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // __planned__ holds test.todo blueprints for unbuilt work — not real call sites.
      if (entry === 'node_modules' || entry === '__planned__') continue;
      tsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Bucket names passed as a string literal to enforceRateLimit(), tree-wide. */
function enforcedBuckets(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of tsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    // enforceRateLimit(<uid expr>, 'bucket'  — the literal is what indexes RATE_LIMITS.
    for (const m of text.matchAll(/enforceRateLimit\(\s*[^,]+,\s*'([a-zA-Z][a-zA-Z0-9_]*)'/g)) {
      const bucket = m[1];
      const where = path.relative(SRC, file).replace(/\\/g, '/');
      const list = found.get(bucket) ?? [];
      if (!list.includes(where)) list.push(where);
      found.set(bucket, list);
    }
  }
  return found;
}

describe('rate-limit budget coverage', () => {
  test('every enforced bucket has a budget in RATE_LIMITS', () => {
    // Guard the path assumption itself — a wrong cwd would make the scan find
    // nothing and turn this whole guard into a no-op that always passes.
    expect(existsSync(SRC), `expected callable sources at ${SRC}`).toBe(true);
    const enforced = enforcedBuckets();
    // Sanity: if the scan finds nothing the regex has rotted and this test is
    // vacuously green — assert it actually sees the known call sites.
    expect(enforced.size).toBeGreaterThan(20);

    const unbudgeted = [...enforced.entries()]
      .filter(([bucket]) => !RATE_LIMITS[bucket])
      .map(([bucket, files]) => `${bucket} (${files.join(', ')})`);

    expect(unbudgeted).toEqual([]);
  });

  test('every budget is a positive cap over a positive window', () => {
    for (const [bucket, budget] of Object.entries(RATE_LIMITS)) {
      expect(budget.max, `${bucket}.max`).toBeGreaterThan(0);
      expect(budget.windowMs, `${bucket}.windowMs`).toBeGreaterThan(0);
    }
  });
});
