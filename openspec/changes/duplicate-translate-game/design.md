# Design — Duplicate & translate a game

## Current behavior

- `duplicateGame` (`functions/src/games/index.ts`) clones a game. `updateGame` writes it.
- Tasks hold user-facing strings (title, description, question, hint, flavorText) plus server-secret
  answer keys. Secrets stay server-side; the translation runs server-side too.

## Approach

### Pure helpers → `packages/shared/src` (the TDD lever)

```ts
collectTranslatableFields(game): { path: string; text: string }[]
  // enumerates every user-facing string with a stable path (e.g. "stages.0.tasks.1.question")
applyTranslations(game, translated: Record<path, string>): Game
  // returns a deep-cloned game with translated strings re-injected at each path;
  // NON-translatable fields (coordinates, types, numericAnswer, scoring) are copied verbatim.
```

Tested in `scripts/test-translate-fields.ts`: collection finds exactly the user-facing strings (not
coordinates/types); `applyTranslations` re-injects deterministically and leaves non-text fields
untouched; round-trip with an identity map equals the original.

### Callable → `translateGame(gameId, targetLang)`

1. `duplicateGame` internally (or replicate) → new gameId.
2. `collectTranslatableFields` → batch to the translation API (key from `functions/.env`).
3. `applyTranslations` → write the new game via the Admin SDK.
4. Free-text answers: keep the original as an accepted alias in `answers[]` plus the translation.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-translate-fields.ts`: field collection + re-injection + the
  non-text-preservation guarantee.
- **e2e** → `translateGame` with a **mocked** translation API (emulator): a new game exists in the
  target language; coordinates/types/scoring identical; original free-text answer still accepted.
- **UI (preview):** "Duplicate & translate" → language picker → new game appears in the Dashboard.

## Conventions

- Translation API key server-side only (Appendix A rule 14). New callable + re-export + wrappers.
- Answer keys never sent to clients; alias-preservation keeps the original answer working.
- `applyTranslations` deep-clones (no dotted-array writes; whole-object rewrite).
