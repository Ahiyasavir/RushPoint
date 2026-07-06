## 1. Shared rules — RED then GREEN (pure)
- [x] 1.1 RED: `scripts/test-player-badges.ts` — `evaluateBadges` thresholds, `mergePlayerResult`
  accumulation + newly-earned diff + negatives floored, `emptyProfile`. Confirm fail.
- [x] 1.2 GREEN: `packages/shared/src/playerProfile.ts` (`PlayerProfile`, `PlayerStats`,
  `BADGES`, `evaluateBadges`, `mergePlayerResult`, `emptyProfile`); export from shared.
  `npm test` → 15 pass.

## 2. functions
- [x] 2.1 `recordPlayerResult` (internal, transactional) writes `players/{uid}` via merge.
- [x] 2.2 Hook in `completeTaskForTeam`: on the first transition to 'finished'
  (`profileRecorded` guard, idempotent) record the result outside the team transaction.
- [x] 2.3 `getMyProfile` callable (own profile only; zeroed if never played). Re-export.

## 3. rules
- [x] 3.1 `players/{uid}` — read if `isOwner(uid)`, write:false (CF-only).

## 4. play-web
- [x] 4.1 `getMyProfile` wrapper in `calls.ts`.
- [x] 4.2 `BadgesCard` on FinalScreen — earned badges with emoji; newly-earned highlighted
  via localStorage seen-set; `badges.*` i18n (title, new, 6 badge labels) EN + HE.

## 5. Tests / gates
- [x] 5.1 e2e: finish a run → `getMyProfile` shows gamesPlayed/tasksCompleted + first_finish
  badge; a new user has a zeroed profile. (Also satisfies the callable-coverage guard.)
- [x] 5.2 typecheck · i18n:check · no-dashes · lint · builds — all green.
- [ ] 5.3 consolidated verify:emulator (e2e + rules + sims — critical: profile hook is in the
  finish path) — in progress.

## Notes
- MVP records for the team's primary uid (uid==teamId). Rank-based badges + attached-device
  players deferred. Cross-device account linking is a separate future change.
