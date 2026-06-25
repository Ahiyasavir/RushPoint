# Design — Run recap

## Current behavior (authoritative refs)

- `functions/src/runs/index.ts` — `getPublicLeaderboard` resolves an access code → run, returns
  standings **only when the run is `published`**; `refreshLeaderboard`/`finalizeRun` share
  `buildRankings()`. No callable returns photos.
- Photos: each team's `TaskState[].photoUrl` (`packages/shared/src/types/index.ts` ≈L425) with a
  `verificationOutcome` of `correct | photo_pending | approved | rejected`. Approved/auto-approved
  photos are the shareable set.
- PII retention: the 90-day prune (§15) clears uploaded photo URLs after a run finishes — the recap
  must treat a missing/cleared `photoUrl` as simply "no photo", never an error.
- Public client routes are query-param based in `apps/play-web/src/App.tsx`: `?game=<id>` (promo),
  `?board=<accessCode>` (public leaderboard). The recap adds `?recap=<accessCode>`.

## Approach

### Pure aggregator + montage layout (the TDD lever) → `packages/shared/src`

```
buildRunRecap(teams, run) → {
  standings: { rank, teamId, displayName, score, totalTime }[],   // reuse buildRankings ordering
  photos:    { teamId, displayName, taskId, photoUrl }[],          // approved/correct only, retention-safe
  stats:     { teamCount, photoCount, winnerName }
}
  // excludes rejected + photo_pending; skips empty/cleared photoUrl (PII-pruned ⇒ photos:[])

computeMontageGrid(photoCount, canvasW, canvasH) → { cols, rows, cells: {x,y,w,h}[] }
  // balanced grid (≈ square aspect), deterministic cell rects; caps at a max tile count with the
  // remaining "+N" overflow indicated to the caller.
```

Unit-tested in `scripts/test-run-recap.ts`: ranking order preserved; rejected/pending photos
excluded; pruned run ⇒ `photos: []` but standings intact; grid cells are non-overlapping, inside
bounds, and balanced for 1/4/9/20+ photos.

### Callable → `getRunRecap` (`functions/src/runs/index.ts`)

Resolve `accessCode` → run (same path as `getPublicLeaderboard`). Read the run's teams, run
`buildRunRecap`. **Authorization:** if the caller is the owner → always allowed; otherwise allowed
**only if `run.published === true`** (identical gate to `getPublicLeaderboard`). Re-export from
`functions/src/index.ts`; typed wrappers in `apps/*/src/services/calls.ts`.

### Client

| File | Change |
|---|---|
| `apps/play-web/src/App.tsx` | Add the `?recap=<accessCode>` public route → recap screen (published-only via the callable's gate). |
| `apps/play-web/src/screens/RunRecap.tsx` (**new**) | Render standings + photo montage; a "Share recap" button builds the branded collage (`computeMontageGrid` + `stampBrand` from `share-branding`) and shares it. |
| `apps/creator-web` RunConsole | Post-finalize "Share recap" action surfacing the `?recap=<accessCode>` link (with copy/QR via the existing ShareSheet). |
| `packages/shared/src/index.ts` | Export `buildRunRecap`, `computeMontageGrid`, the recap result type, and the `?recap=` route key. |

## Test strategy (TDD — proves the change)

- **Pure (RED first)** → `scripts/test-run-recap.ts`: `buildRunRecap` (ranking order, photo
  inclusion/exclusion by outcome, retention-pruned ⇒ empty photos + intact standings) and
  `computeMontageGrid` (balance, bounds, non-overlap, overflow cap).
- **Callable (e2e)** → extend `scripts/e2e-verify.mjs`: after finalize, `getRunRecap` as **owner**
  returns standings + photos; as a **non-owner on an unpublished run** → `permission-denied`/empty;
  after `publish`, a non-owner gets the public recap; rejected photos are absent.
- **UI** → preview tools: the recap screen renders the montage; "Share recap" produces a branded
  collage (logo + link + QR) and the `?recap=` link opens the public page.

## Conventions / footguns respected

- New mutation/read = a **callable** (`getRunRecap`), never a client read of run/team docs; the
  published gate mirrors `getPublicLeaderboard` exactly. Uses `FIRESTORE_PATHS`.
- Answer keys stay server-secret — the recap returns only standings + photo URLs, never task answers.
- Retention-safe: a cleared `photoUrl` is "no photo", never an error (no crash post-prune).
- Montage tiling math is pure (`computeMontageGrid`); the collage image is built client-side and
  branded through `share-branding` (single source of branding). No dotted-array writes (read-only).
