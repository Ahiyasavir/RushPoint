# Proposal — Challenge a friend (shareable single-task teaser)

## Why

Every task in a game is a self-contained mini-puzzle — a perfect viral hook. "Can you answer this in
30 seconds? 😏" shared to a friend pulls a brand-new person into the app from outside, with zero
context needed. It is the lowest-friction acquisition surface the game already contains.

## What Changes

> Observable behavior. A new shareable deep-link + a standalone teaser screen; no scoring impact.

- From a completed task, a participant can tap **"Challenge a friend"** → shares a link
  `?challenge=<gameId>:<taskId>` plus a branded teaser image.
- Opening that link shows a **standalone teaser**: the task's question with a 30-second timer (a
  fun, non-scoring quiz). The answer key is **never** in the link — answers are checked via a new
  `checkChallengeAnswer` callable that returns only correct/incorrect.
- The teaser ends with a strong CTA: "Liked it? Build your own race adventure" → the creator landing,
  and "Join a live game" → the join screen.

## Capabilities

### New Capabilities
- `challenge-a-friend`: a shareable single-task teaser (deep link + branded image + a server-checked,
  non-scoring answer) that converts external viewers into players/creators.

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **Callable:** new `checkChallengeAnswer(gameId, taskId, answer)` in `functions/src/games/index.ts`
  — reads the task from the (public or owner) game, returns `{ correct }` only; never leaks the key.
  Reuses the existing answer-matching logic.
- **play-web:** `?challenge=<gameId>:<taskId>` route → `ChallengeTeaser` screen (timer + answer +
  CTA). Pure `parseChallengeParam(raw)` helper.
- **share-branding:** the teaser image uses the shared stamp (logo + link + QR).
- **Tests:** `scripts/test-challenge.ts` (param parse + answer-match reuse); e2e for the callable.

## Non-goals

- No scoring or leaderboard impact — purely a teaser.
- No requirement that the challenged task belongs to a public game beyond what the existing
  publish/visibility rules already allow (private game challenge requires the owner's share link).
- No multi-task challenge chains — single task only.
