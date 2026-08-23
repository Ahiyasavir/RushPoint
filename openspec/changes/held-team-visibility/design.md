# Design — held-team visibility

## Context

`startTeams` already computes a partition. The `held` side is currently reduced to `held.length` and
then discarded. Everything below is about carrying that same verdict to two screens; no new decision
about consent is made anywhere in this change.

## D1. Where the verdict is computed

Server-side, in both read paths, using `isConsentSatisfied` from
`packages/shared/src/guardianConsent.ts` — the SAME predicate `partitionTeamsByConsent` delegates to.
There is exactly one definition of "consented" in the codebase and this change does not add a second.

Rejected: deriving the hold on the client from `game.requiresGuardianConsent` +
`team.guardianConsent`. That needs a new game flag on the participant wire, duplicates the predicate
in a place that can drift from the launch path, and puts a child-safety decision in a client.

## D2. The wire shape: a reason, not a record

`getMyTeamState` returns `holdReason: 'guardian_consent' | null` at the top level of the response
(not inside a task payload, so `ALLOWED_TASK_KEYS` / the participant sanitizer contract is
untouched).

A string reason rather than a boolean, because the next hold reason the product adds (age gate,
payment, waiver) must be able to say which one it is without another wire change, and because a
boolean cannot be degraded safely by an old client — a `true` with no reason is exactly the
uninformative screen this change exists to remove.

`null` — not omitted-vs-false, not an object — whenever the team is not held. Runs that do not
require consent therefore ship a payload identical in every field to today's plus one `null`.

**No PII.** `guardianName` is deliberately not read by this change. The team doc echo already carries
`team.guardianConsent` (pre-existing, out of scope), but nothing added here reads or forwards a name,
and the organizer projection carries a boolean only.

## D3. The pure function

`heldNotice(input?: { launched?: boolean; holdReason?: unknown }): HeldNotice` in
`apps/play-web/src/lib/holdNotice.ts`.

```ts
type HeldKind = 'none' | 'guardian_consent' | 'unknown';
interface HeldNotice {
  kind: HeldKind;
  held: boolean;      // kind !== 'none'
  blameless: true;    // no hold is ever the participant's fault to state
  offerHelp: boolean; // true exactly when held: the host is the only route out
}
```

Rules, in order:

1. `launched === true` → `none`. **The launch wins over the reason.** A payload in flight when the
   organizer clears the hold, or a stale cached response, must never leave a now-playing team
   staring at a hold notice. This is the "was held, now released" case.
2. `holdReason` not a non-empty string → `none`. This is the older-client / older-server case: no
   information is not evidence of a hold, and the ordinary "waiting for the host to start" copy that
   already renders is a correct thing to show when nothing is known.
3. `'guardian_consent'` → `guardian_consent`.
4. anything else → `unknown`, which renders the generic held copy.

Total, no clock, no I/O, no throw — the same contract as `stuckGuards.ts`, and for the same reason:
it renders on a screen a participant is stuck on, where a throw is a blank phone.

The one asymmetry with `stuckGuards` is deliberate. Those guards **fail open** (let the player reach
the server). This one **fails closed on the claim, open on the copy**: an unrecognized reason never
asserts a cause it was not told, but it also never renders nothing. A held team seeing the generic
message is inconvenienced; a held team seeing "waiting for the host to start" is lied to.

## D4. What the participant screen says

Rendered inside the existing `!team.launched` branch of `PlayScreen.tsx`, above the existing
`HowToPlayCard`, replacing the `waitingStart` line when `held` is true (that line is false for a held
team, so it must not remain). The SOS button already on that screen is the host affordance and is
reused as-is; no new control, and specifically no control that changes the hold.

Copy obligations: say they are not waiting on the start; say it is not something they did; say the
host can clear it. Three sentences, one card, no dead end.

## D5. The organizer side

`listRunTeams` gains `heldForConsent: boolean`, computed from the same predicate. It needs the game
doc, which that handler does not currently read: one added `db.doc(gamePath(...)).get()`, already
behind the owner check, wrapped so a failed read degrades every row to `false` (silence) rather than
failing the organizer's only view of the field — the same bias `listRunTeams`' other best-effort
reads take.

The console renders it as its own `text-[11px]` line on the team row, next to `outOfBoundsBadge`,
rather than as an `attentionReason`. It is not an attention *classification*: it is not time-based,
not derived from the field's median pace, and it applies to unlaunched teams, which
`classifyTeamAttention` suppresses by design (`!team.launched → OK`). Folding it into
`teamAttention.ts` would mean weakening that suppression gate for one non-temporal signal.

`RunConsolePage.tsx` is under concurrent edit by another lane; this change adds one self-contained
JSX block and one i18n key, and reverts nothing.

## Test Strategy

Lane: pure logic, no emulator. `scripts/test-held-team-notice.ts`, house style (`check(label, cond,
detail)`), picked up by `scripts/run-unit-tests.mjs` via the `scripts/test-*.ts` glob, run by
`npm test`. A separate file rather than an extension of `test-stuck-player-guards.ts`: that suite's
stated contract is "guards that FAIL OPEN and take no clock" and asserts it over every fixture, and
this function fails closed on the claim (D3).

Fixtures, all five mandated cases plus the invariants:

| # | input | expected |
|---|---|---|
| 1 | `{ launched: false, holdReason: null }` | `none`, `held: false`, `offerHelp: false` |
| 2 | `{ launched: false, holdReason: 'guardian_consent' }` | `guardian_consent`, `held`, `offerHelp` |
| 3 | `{ launched: false, holdReason: 'age_gate' }` (future/unknown) | `unknown`, `held`, `offerHelp` |
| 4 | `{ launched: true, holdReason: 'guardian_consent' }` (released) | `none` |
| 5 | `undefined`, `{}`, `{ holdReason: undefined }` (old client) | `none` |

Plus: non-string reasons (`0`, `1`, `true`, `{}`, `[]`, `NaN`), empty and whitespace-only strings,
`launched` absent/`undefined`/truthy-non-boolean, and a sweep asserting over EVERY fixture that
`held === (kind !== 'none')`, `offerHelp === held`, `blameless === true`, and that the returned kind
is one of the three. The whole suite re-runs under a stubbed `Date.now` (±6 h) to prove no clock.

Wiring guards, because play-web has no component test runner and a pure function nobody calls fixes
nothing — source assertions over `PlayScreen.tsx`: it imports `../lib/holdNotice`, calls
`heldNotice(`, the held branch does not render `t.play.waitingStart`, and it renders no control that
could clear the hold. Plus a guard over `functions/src/runs/index.ts` that `holdReason` is on the
`getMyTeamState` response and `heldForConsent` on the `listRunTeams` row, and a guard over
`i18n.ts` that the new keys exist in both languages.

e2e (`scripts/e2e-verify.mjs`) is NOT edited by this change (the file is owned by another lane); the
assertions that belong there are reported instead.

## What was deliberately NOT built, and why

- **A consent flow.** No UI to request, grant, upload or attest consent. Who may grant it, what it
  says, and what age triggers it are unanswered product/legal questions; building a flow now would
  encode an answer nobody has given.
- **Any self-clear.** No participant-side control changes `guardianConsent`, `launched`, or the
  hold. The card's only affordance is the existing host alert. A "I have permission" button would
  make the gate decorative.
- **Guardian identity on the participant or organizer wire.** No name, contact or token is added.
  The organizer gets a boolean; the participant gets a reason string.
- **A consent-hold entry in `teamAttention.ts`.** See D5: it is not a temporal attention signal and
  would require weakening that module's unlaunched-team suppression.
- **Backfilling the `startTeams` toast with names.** The toast is a moment; the row badge persists
  and is where an organizer actually looks when walking the field. Adding names to a transient toast
  would duplicate the signal in the less useful place.
