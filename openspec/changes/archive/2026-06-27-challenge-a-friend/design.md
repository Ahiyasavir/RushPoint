# Design — Challenge a friend

## Current behavior

- `sanitizeTaskForParticipant` (`functions/src/runs/index.ts` L1096) strips answer keys before sending
  a task to a client. Answer matching lives in the same module (`answerMatches`).
- Public games are denormalized to `publicGames/{gameId}` / `publicTasks/{taskId}` (public read).
- play-web routes are query-param based in `App.tsx`.

## Approach

### Pure helper → `packages/shared/src`

```ts
parseChallengeParam(raw): { gameId, taskId } | null   // "gameId:taskId" → object; null if malformed
```

### Callable → `checkChallengeAnswer` (`functions/src/games/index.ts`)

Auth: `requireAuth` (anonymous ok). Reads the task (from `publicTasks` if published, else the owner's
game when the caller is the owner). Returns `{ correct: boolean }` using the existing answer-match
logic. The task's answer key never leaves the server.

### play-web teaser

`?challenge=<gameId>:<taskId>` → `ChallengeTeaser`: fetches the sanitized task (question + choices,
no answer) via a thin read, shows a 30 s timer, submits to `checkChallengeAnswer`, shows result +
CTAs (build / join). The shared image uses the `share-branding` stamp.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-challenge.ts`: `parseChallengeParam` valid/malformed/empty.
- **e2e** → `checkChallengeAnswer`: correct answer → `{correct:true}`; wrong → `{correct:false}`;
  the response never includes the answer key; an unpublished task by a non-owner is refused.
- **UI (preview):** challenge link opens the teaser; timer runs; correct/incorrect shown; CTAs route.

## Conventions

- New callable in `functions/src/games/index.ts` + re-export + wrappers. Answer key server-secret.
- Reuses existing answer-matching — no duplicate logic.
