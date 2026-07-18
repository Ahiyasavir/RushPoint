# Design: fix-nonfinite-callable-payload

## Files touched

- `packages/shared/src/sanitizeFinite.ts` (new) — pure, dependency-free:
  ```ts
  export function sanitizeFinite<T>(value: T): T {
    if (typeof value === 'number') {
      return (Number.isFinite(value) ? value : null) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => sanitizeFinite(v)) as unknown as T;
    }
    if (value && typeof value === 'object') {
      // Preserve non-plain objects (Date, etc.) as-is; only walk plain records.
      const proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = sanitizeFinite(v);
        }
        return out as T;
      }
    }
    return value;
  }
  ```
  Non-finite → `null`; finite numbers, strings, booleans, `null`/`undefined`, and non-plain objects
  pass through. Returns new arrays/objects (no mutation of shared refs).
- `packages/shared/src/index.ts` — `export * from './sanitizeFinite'`.
- `functions/src/obs/log.ts` — in `loggedCallable`, wrap the handler result:
  `async () => sanitizeFinite(await handler(data, context))`. Callable bodies are unchanged.
- `functions/src/runs/index.ts` — in `buildRankings`, replace lines ~908-909:
  ```ts
  const durSec = durationSeconds(team.startedAt, team.finishedAt ?? now);
  const durFinite = Number.isFinite(durSec) ? durSec : undefined;
  // ...
  durationSeconds: durFinite,
  totalMinutes: durFinite != null ? durFinite / 60 : undefined,
  ```
  The two sort comparators already coalesce with `?? Infinity`, so omitting the fields keeps ordering
  identical (an unstarted team still sorts to the bottom).

## Test strategy

- **Pure helper (`scripts/test-sanitize-finite.ts`, tsx, no emulator, auto-run by `npm test`):**
  `Infinity`/`-Infinity`/`NaN` → `null` at top level, inside arrays, and at nested-object depth;
  finite numbers, strings, booleans, `null`, and `undefined` are preserved; a `Date` is not walked
  into `null`s; the whole result JSON-encodes without throwing. RED before the helper exists.
- **`buildRankings` unit (co-located vitest `functions/src/runs/buildRankings.test.ts`, no emulator):**
  a run with one started+finished team and one **joined-but-not-started** team (no `startedAt`) →
  every entry's `durationSeconds`/`totalMinutes` is finite-or-undefined (never `Infinity`), the whole
  array `JSON.stringify`s without throwing, and ranking order is unchanged vs. the all-started case.
  RED before the buildRankings guard.
- **E2E (`scripts/e2e-verify.mjs`, `npm run e2e`):** a scenario that joins a second team and does
  NOT start it, then asserts `refreshLeaderboard` and `getMyTeamState` both resolve (not
  `invalid-argument`/crash) and carry no non-finite number. Guards the integration seam that the unit
  tests can't (the JSON-encode boundary the emulator enforces).

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run e2e`.
