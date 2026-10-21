## Context

`joinTeamAsDevice` appends the caller to `team.deviceUids` and refuses once the team holds
`teamDeviceAllowance(team)` phones. A phone that lost its sign-in (self-healing-entry) rejoins as a NEW
anonymous identity, and the lost one stays in the list forever.

## Decisions

### D1. Replace, do not append, when the phone names the identity it lost

The phone keeps the uid it joined with (`Session.deviceUid`, saved at join since self-healing-entry).
When that uid is still attached to the team, the server swaps it for the caller's uid IN PLACE. The new
uid takes the same position in `deviceUids` and the same `devices` entry (the name is kept and
`joinedAt` is refreshed), and `controllerUid` moves too if it pointed at the old uid. A swap is net zero,
so the allowance check and the run device counter are skipped.

The decision is a pure function, `planDeviceReplacement(team, callerUid, replacesUid, nowIso)` in
`teamDevices.ts`, unit-tested in `teamDevices.test.ts`. It returns one of these:

- `{ kind: 'replace', deviceUids, devices, controllerUid }`
- `{ kind: 'attach' }`, which falls through to the old path
- `{ kind: 'duplicate' }` or `{ kind: 'refused', reason: 'finished' }`, mirroring `canAttachDevice`

### D2. The trust boundary is the device code, as before

Anyone holding a team's device code can already attach a phone and call `claimController`, which is
full control of the team ("Trust boundary stays at team level"). A replacement gives no more than that.
It needs the device code AND a uid that is on the team, and outside the team the only member uid anyone
sees is the founder's id.

Requiring the replaced phone to be "quiet" was considered and rejected. The phone that lost its sign-in
was polling seconds before it rejoined, so a quiet rule would refuse exactly the case this change exists
for.

### D3. The founder's identity can be replaced

When the lost identity is the founding uid (`team.id`), the team document keeps its id (it cannot
change). Only the device and controller roles move. The dead founder uid still reaches its own team doc
through `resolveCallerTeam`'s fast path, but `resolveDeviceRole` now returns null for it, so it can no
longer change anything. A phone that is genuinely gone loses nothing by this.

### D4. Anything doubtful falls back to the old behaviour

A missing, malformed, unknown or self-referencing `replacesUid` is a normal attach with every existing
guard. An older app version never sends the field, so it is unaffected.

## Risks

- If a replaced identity somehow comes back (recovery normally prevents it), it finds itself a
  non-member, shows the signed-out card and can rejoin the same way. Acceptable.
- The team chat doc mirrors `deviceUids` and re-mirrors it on the next team message. A rejoined phone is
  in the same position as any newly attached phone today, so this change does not alter it.

## Test strategy

- Pure: `planDeviceReplacement` in `functions/src/runs/teamDevices.test.ts` (vitest, `npm test`).
- Callable: an e2e scenario in `scripts/e2e-verify.mjs` covering:
  - a full team, swapped with no new slot and an unchanged `deviceCount`
  - the controller moving, and a founder replacement
  - an unknown `replacesUid` falling back to a normal attach
  - a `replacesUid` from another team never touching that team
- Browser: `scripts/browser-auth-loss.mjs` gains a full-team rejoin, a three-losses rejoin, and a
  founder rejoin that asserts the controller moved.
