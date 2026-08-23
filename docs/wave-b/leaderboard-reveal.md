# Wave B / Task 4 — manual leaderboard reveal

## Why

Today the final standings become visible to every participant the instant the creator
presses "finalize". Hosts who want a ceremony (or who fix a score adjustment first)
have no way to hold the result back. The user asked for a game setting that hides the
rankings from players at the end of the race until the creator reveals them.

## What already exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| `Game.manualLeaderboardReveal?: boolean` | `packages/shared/src/types/index.ts` ~L510-517 | DONE (schema only) |
| `refreshLeaderboard({ publish })` callable | `functions/src/runs/index.ts` ~L1573 | DONE, `publish` already staged-reveal aware |
| `getPublicLeaderboard` published gate | `functions/src/runs/index.ts` ~L1618 | DONE, returns `rankings: []` unless published |
| Live board publish toggle (mid run) | `apps/creator-web/src/pages/RunConsolePage.tsx` ~L319 | DONE (live block only) |
| `PublicLeaderboardScreen` unpublished state | `apps/play-web/src/screens/PublicLeaderboardScreen.tsx` ~L129 | DONE (`t.board.notPublished`) |
| `CeremonyScreen` unpublished holding screen | `apps/play-web/src/screens/CeremonyScreen.tsx` ~L104 | DONE (polls until published) |
| `TvLeaderboard` | `apps/play-web/src/screens/TvLeaderboard.tsx` | DONE (same server gate) |
| `LiveOps` peek | `apps/play-web/src/components/LiveOps.tsx` L105 | DONE (`leaderboard?.published`) |

## The three real defects

1. **`finalizeRun` hardcodes `published: true`** (`functions/src/runs/index.ts` L1436) so the
   flag can never take effect. LOCKED FILE — patch spec below.
2. **`FinalScreen` ignores `published` entirely.** It renders `run.leaderboard.rankings`
   (board, my rank, my final score, the top-3 podium + podium share card) whenever the
   object exists. Before this change an unpublished final board was fully visible to the
   player — the ONLY reason nobody noticed is that finalize always published. Fixed here.
3. **`updateGame` drops `manualLeaderboardReveal`** — no way to persist the setting. Fixed here.

## Decisions

- Default `undefined`/`false` ⇒ auto publish. Every existing game keeps today's behaviour.
- NOT denormalized into `publicGames` — it is an organizer control, not gallery data.
- Organizers always see the standings (they read the run doc directly); the flag gates only
  the participant surfaces.
- `createGame` deliberately does not set the field (absent ⇒ auto publish). No change needed.
- The play client keeps the `published` check even if the server later stops sending an
  unpublished board (defence in depth, and `getMyTeamState` currently DOES send it).

---

## Patch spec for `functions/src/runs/index.ts` — DO NOT APPLY, orchestrator only

### Patch A (required, one line)

`finalizeRun`, in the `await runRef.update({ ... })` block. The game doc is ALREADY loaded a
few lines above as `const game = parseStored(() => parseGame(gameSnap.data()));` — reuse it,
do not add a read. `parseGame` preserves unknown/optional fields (it returns `doc as Game`,
no whitelist copy), so `game.manualLeaderboardReveal` is populated.

Anchor (currently L1430-1436, inside `finalizeRun`):

```ts
  // Finalizing always publishes the final standings to participants.
  await runRef.update({
    status: 'finished',
    finishedAt: now,
    // WO Fix 3: freeze the FINAL board so the throttled auto-snapshot
    // (maybeRefreshLeaderboardSnapshot bails on frozen) can never recompute and
    // overwrite the published final standings after finalize. An organizer can
    // still explicitly un-freeze via refreshLeaderboard if they intend to.
    leaderboard: { rankings, frozen: true, published: true, updatedAt: now },
```

Replacement:

```ts
  // Finalizing publishes the final standings to participants UNLESS the game opts
  // into a staged reveal (change: manual-leaderboard-reveal) — then the board is
  // written frozen but UNPUBLISHED and the creator reveals it explicitly via
  // refreshLeaderboard({ publish: true }). Absent flag ⇒ today's auto-publish.
  await runRef.update({
    status: 'finished',
    finishedAt: now,
    // WO Fix 3: freeze the FINAL board so the throttled auto-snapshot
    // (maybeRefreshLeaderboardSnapshot bails on frozen) can never recompute and
    // overwrite the published final standings after finalize. An organizer can
    // still explicitly un-freeze via refreshLeaderboard if they intend to.
    leaderboard: { rankings, frozen: true, published: !game.manualLeaderboardReveal, updatedAt: now },
```

The single load bearing edit is `published: true` → `published: !game.manualLeaderboardReveal`
on the `leaderboard:` line; the comment rewrite above it is optional.

> ⚠ A concurrent agent is restructuring `finalizeRun` for async / non blocking behaviour, so
> the surrounding lines may have moved or been reordered by the time this is applied. Match on
> the substring `leaderboard: { rankings, frozen: true, published: true, updatedAt: now }`
> INSIDE `finalizeRun` (the `runRef.update` call), not on the line number.

### Patch B (same file, same substring, second occurrence — recommended)

L1545 builds the run-summary email payload from an inline literal that repeats
`leaderboard: { rankings, frozen: true, published: true, updatedAt: now }`. It should mirror
whatever was actually written, otherwise the emailed summary claims the board is published
when it is not. Same replacement (`published: !game.manualLeaderboardReveal`). Cosmetic only
— the summary email does not gate on it today — so it is safe to skip if the concurrent
restructure removed that literal.

Because the substring appears twice, a blind replace-all is fine and gives both patches.

### Patch C (optional hardening, one line, `getMyTeamState`)

`functions/src/runs/index.ts` L3252 returns the raw board to the participant:

```ts
      leaderboard: run.leaderboard ?? null,
```

→

```ts
      // Staged reveal: never ship an unpublished board over the wire to a player
      // (the client gates too, but a devtools reader must not see it either).
      leaderboard: run.leaderboard?.published ? run.leaderboard : null,
```

Safe: every participant consumer already requires `published` — `LiveOps` (L105) and, after
this change, `FinalScreen`. Not required for the feature (the client gate is sufficient for
the UI) but it is the difference between "hidden" and "actually secret".

---

## Builder toggle placement spec — `apps/creator-web/src/pages/BuilderPage.tsx` (owned by another agent)

Place it in the **Settings step / game options block**, immediately after the existing
`photoFeedEnabled` / `powerUpsEnabled` switches (search for `powerUpsEnabled` in
BuilderPage.tsx — it is the same shape of boolean row, same `saveGame`/`updateGame` patch).

```tsx
<Toggle
  checked={!!game.manualLeaderboardReveal}
  onChange={(v) => patch({ manualLeaderboardReveal: v })}
  label={t.builder.manualRevealLabel}
  hint={t.builder.manualRevealHint}
/>
```

i18n keys to add to `apps/creator-web/src/i18n.ts` under the **`builder`** namespace (both
locales; that namespace is owned by the Builder agent, not by me):

| key | HE | EN |
|---|---|---|
| `manualRevealLabel` | `חשיפה ידנית של טבלת הדירוג` | `Manual leaderboard reveal` |
| `manualRevealHint` | `בסיום המשחק הדירוג יישאר מוסתר מהמשתתפים עד שתחשפו אותו מלוח הבקרה של ההרצה` | `When the game ends the standings stay hidden from players until you reveal them from the run console` |

Also add `manualLeaderboardReveal?: boolean;` to `UpdateGamePayload`
(`packages/shared/src/types/index.ts` ~L1157, next to `powerUpsEnabled`) so the typed
`updateGame` wrapper accepts it. The backend already tolerates it without that change
(it reads the field off `data` directly), so the two edits are independent.

## What I changed

- `functions/src/games/index.ts` — `updateGame` now persists `manualLeaderboardReveal`.
  Read off `data` with a local narrow cast instead of the `UpdateGamePayload` destructure,
  because `packages/shared/src/types/index.ts` is out of my scope. Explicitly NOT added to
  the `publicGames` denormalization (both sites).
- `apps/creator-web/src/pages/RunConsolePage.tsx` — the finished-run standings card now shows
  a hidden/visible badge and a "Reveal to players" button calling
  `refreshLeaderboard({ publish: true })`. The creator sees the standings either way.
  Also: copying an audience link (`shareBoard`) no longer auto-publishes a board that the
  game asked to stage manually — that silently defeated the whole feature and broke the
  ceremony flow (the operator is meant to open the TV/ceremony link BEFORE revealing).
- `apps/play-web/src/screens/FinalScreen.tsx` — all ranking-derived UI is gated on
  `run.leaderboard.published`; unpublished shows a friendly "results not revealed yet" card
  instead of the board, the podium and the podium share.
- `apps/creator-web/src/i18n.ts` (`runConsole` only) + `apps/play-web/src/i18n.ts` (`final`).
- `scripts/test-leaderboard-reveal.ts` — pure-logic + source-level guards (RED first).
