## 1. RED — failing rules assertions first

- [x] 1.1 Extend the `firebase/firestore` import in `scripts/test-rules.mjs` with `deleteDoc`,
      `updateDoc` and `deleteField`, keeping the existing import shape.
- [x] 1.2 Add the trash-lifecycle block, reusing the existing `TRASHED-GAME` fixture: owner CANNOT
      hard-delete a live game, owner CANNOT hard-delete a trashed game, owner CANNOT change
      `deletedBy`, owner CANNOT remove `deletedBy` while keeping `deletedAt`, owner CANNOT clear
      `deletedAt` via `deleteField()`, owner CANNOT move `deletedAt` forward. Four of these are
      operations the CURRENT rules ALLOW — they are the RED.
- [x] 1.3 Add the positive counterpart — owner CAN edit an ordinary field of a trashed game — so the
      tombstone guard can never silently become "a trashed game is read-only".
- [x] 1.4 Add the tenant-isolation cases for the trash: non-owner CANNOT read the trashed game,
      non-owner CANNOT list another creator's games collection, owner CAN list their own.
- [x] 1.5 Add the public-gallery cases: anon CAN read a `publicTasks` document; a client CANNOT write
      `approxLocation` on one; a non-owner CANNOT write another creator's `publicGames` row.
- [x] 1.6 Add the staff-scope case for a token minted for a DIFFERENT owner, alongside the existing
      different-run case.
- [x] 1.7 Add the delete-verb class assertion under a run (owner CANNOT delete a team document).
- [x] 1.8 `node --check scripts/test-rules.mjs` — syntax only. Record explicitly that this proves
      nothing about rule semantics and that the suite is NOT run (the emulator is owned by a live
      playtest stack).

## 2. GREEN — close the confirmed gaps in `firestore.rules`

- [x] 2.1 Change the game document's `allow delete: if isOwner(uid);` to `allow delete: if false;`
      with a comment stating why destruction is a server-only, five-system act (D1).
- [x] 2.2 Rewrite `tombstoneUnchanged()` to compare BOTH `deletedAt` and `deletedBy` using
      `get(field, null)` so absence is a value and the rule stays total (D2). Leave `hasTombstone()`
      unchanged.
- [x] 2.3 Update the block comment above `match /games/{gameId}` so it describes the rule as
      written — deletion of the document itself is denied, and the whole deletion record is
      immutable, not just its timestamp.

## 3. REFACTOR — keep the audit's reasoning where the next auditor will find it

- [x] 3.1 Record in `firestore.rules`, at the `publicTasks` match, that coordinate privacy is NOT
      and CANNOT be a rules guarantee (documents, not fields; Admin-SDK writes never evaluate rules)
      and that it is enforced at the write path in `publishGame` plus the backfill — so a future
      audit does not re-open it as a rules finding (D3).
- [x] 3.2 Re-read the whole rules file top to bottom for any other `allow` verb that is broader than
      its comment claims, now that `write` has been split into verbs in one place.

## 4. GATE — NOT DONE, requires a free emulator

- [ ] 4.1 With no live playtest stack running, `npm run test:rules` and confirm every new assertion
      passes and no existing assertion regressed. **Nobody may archive this change before this task
      is ticked.** If any new assertion fails, fix the RULES — never weaken a rule to make an
      assertion pass.
- [ ] 4.2 `npm run verify:emulator` (which includes the rules lane) to prove the narrowed rules break
      no e2e or simulation path.
