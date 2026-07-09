# Design — No-signup demo

## Current behavior

- `AuthGate` (creator-web) gates everything behind Firebase Auth; the logged-out view is the landing
  page. Builder pages read/write the creator's game via `services/api.ts` (`callable()`) +
  `services/calls.ts` (`createGame`, `updateGame`).
- New-game flow seeds a template via `updateGame`.

## Approach

### Local draft (the TDD lever) → `apps/creator-web/src/lib/demoDraft.ts`

```ts
serializeDraft(game): string                 // JSON, schema-versioned
deserializeDraft(raw): GameDraft | null      // null on parse/version mismatch
isDraftClaimable(draft): boolean             // has ≥1 stage with ≥1 task, valid shape
```

`localStorage` key `rushpoint:demoDraft`. Pure functions tested in `scripts/test-demo-draft.ts`.

### Flow

1. Landing page "Try the Builder" → routes into the Builder with `demoMode = true` (no auth).
2. Builder, in demo mode, sources its game from `deserializeDraft(localStorage)` or a seeded
   template; every edit calls `serializeDraft → localStorage` instead of `updateGame`.
3. Save / Launch / Publish button → if `!user` → open the auth modal. On auth success → `claimDraft()`:
   `createGame()` then `updateGame(draftContent)`; clear `localStorage`; continue to the real game.
4. On normal signup elsewhere, if a claimable local draft exists → offer "Import your draft?".

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-demo-draft.ts`: round-trip serialize/deserialize; version
  mismatch → null; `isDraftClaimable` true only for a non-empty valid game shape.
- **UI (preview):** logged-out "Try the Builder" → edit a task → refresh (draft persists) → click Save
  → auth modal → after (mock) auth the draft is claimed and the banner clears.

## Conventions

- No server write until authenticated — preserves server-write-only invariants.
- Draft is schema-versioned so a future Builder model change invalidates stale drafts cleanly.
