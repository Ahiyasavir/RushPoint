## Context

`BuilderPage` holds Quick Setup state in `qsState` and two effects: a LOAD effect
that reads `rp-quick-setup:<uid>:<gameId>` once per game and decides whether to
auto-invite (`shouldAutoOpenQuickSetup`), and a PERSIST effect that writes `qsState`
back on every change. The load effect skips the invitation on the landing from the
new-game wizard (`justCreated`) and returns without setting state, so `qsState`
stays at `INITIAL_QUICK_SETUP_STATE` (`idle`). The persist effect then writes that
`idle` state, and from the next visit on `hasRecord: rec !== null` is true forever.

## Decisions

### D1 — "Is this a decision?" is one pure predicate, used on both sides

`isQuickSetupDecision(record)` in `lib/quickSetup.ts`: true when status is not
`idle`, or `deferred` is non-empty, or `index > 0`. The load effect passes
`hasRecord: isQuickSetupDecision(rec)`; the persist effect skips the write when the
state is not a decision (and removes a stale non-decision key, best-effort).

Reading through the same predicate is what heals creators who already carry a
stored `idle` record: no migration, their next visit simply sees "no decision".

Rejected: only stopping the persist on the `justCreated` mount. It fixes new games
but leaves every already-affected game stuck, and it puts the rule in the
component instead of in a tested function.

### D2 — The phone entry dispatches the existing `resume` action

The menu item calls the same `dispatchQs({ type: 'resume' })` the desktop pill
calls, and renders only when `qsSteps.length > 0`. No new reducer state.

### D3 — Grouping is a pure function over `ReadinessIssue[]`

`groupReadinessIssues(issues)` returns `{ code, count, first, issues }[]` in order
of first appearance. A group of one renders exactly like today's row (code label +
location). A group of more renders the counted label and no single location, and
activating it navigates to `first`. `computeGameReadiness` itself is unchanged, so
`canLaunchGame`, the launch refusal and every other consumer are untouched.

### D4 — The reveal's line comes from the same groups

`DashboardPage` already has the composed `stages`. It runs `computeGameReadiness`
on them and passes the groups to `SmartBuildReveal`, which renders one short line
per group with a counted, action-worded label ("לסמן 6 נקודות על המפה"). Empty
groups ⇒ no line.

## Risks / Trade-offs

- A grouped row hides WHICH missions are affected. Mitigated: activating it opens
  the first, and fixing it shrinks the count, so the list still walks the creator
  through all of them.
- `localStorage.removeItem` of a stale key is best-effort; failure only means the
  key is read as a non-decision anyway (D1), so it is harmless.

## Test strategy

Pure lane only (`scripts/test-*.ts`): the predicate's truth table and the
load/persist contract in `test-quick-setup-flow.ts`; grouping order, counts and
singleton passthrough in a new `test-readiness-grouping.ts`; the phone menu entry
and the accessible names in a source scan, since there is no component runner. UI
verified in the browser at 375px.
