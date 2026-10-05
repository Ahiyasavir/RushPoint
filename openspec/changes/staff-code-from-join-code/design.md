## Context

Staff codes live in `users/{o}/games/{g}/runs/{r}/staffInvites` (field `pin`), and `staffSignIn`
needed the run address to query them. Players join with a 6-character code from
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` stored at `accessCodes/{CODE}` → `{ownerUid, gameId, runId}`.

## Decisions

**D1. A staff code is the join code plus two planted characters.** Ahiya's design. The two
characters and their positions come from `randomInt`. The alphabet is the join-code alphabet, so a
staff code never has a confusable character and reads like the join code people already know.
Count for one join code: inserting 2 characters from 32 into 6 gives at most 28 × 32² = 28,672
strings, fewer distinct ones because some insertions coincide; the test measures it and requires
more than 20,000.

**D2. Find the run from the code, not from a pointer collection.** Removing two characters from an
8-character code gives at most 28 distinct 6-character strings, one of which is the join code.
`db.getAll` on those `accessCodes` documents is one round trip. A pointer collection
(`staffCodes/{CODE}`) would need its own cleanup in `purgeGameTree`, `deleteMyAccount` and the
retention sweep; this needs none. More than one hit is possible in principle (two live join codes
that differ only where characters were planted); each hit's staff codes are checked and the one that
holds the code wins.

**D3. Throttling stays per run.** A guess built on a real join code resolves to that run, so the
per-caller and run-wide counters are the existing ones, and a correct code still wins under a
run-wide lockout (WO-4). A code that resolves to no run is refused as `not-found` without touching
any counter: there is no run to protect, and anyone who knows no join code is guessing among 32⁸.

**D4. The run address travels back in the sign-in result.** The client used to save the ids it had
typed; now it saves the ids the server returns. A link that carries the address still sends it, and
the server then checks that run only, as before (old printed QR codes, old 6-digit codes).

**D5. The answering button.** The sign-in button is no longer disabled for a blank field; pressing it
says what is missing (CLAUDE.md: prefer an answering button to a disabled one).

## Test strategy

- Pure: `scripts/test-staff-code.ts` (shape, alphabet, the join code is recoverable, candidate set
  size and content, normalisation of spaces, dashes and lower case, measured code count).
- e2e: `inviteStaff` returns a code built on the run's join code; `staffSignIn` with `{pin, name}`
  alone succeeds and returns the run address; a wrong code built on the join code is refused and
  counts toward that run's lockout; a code built on no join code is `not-found`.
- UI: the staff screen in a browser with and without a link.
