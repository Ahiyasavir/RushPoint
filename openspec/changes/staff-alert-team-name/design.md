## Context

`StaffConsole.tsx` is being edited concurrently by other lanes (`play-sos-header-access` and
others touch the same file). Anchor on content, not line numbers.

## Current state

- The alerts snapshot builds `Alert` rows carrying `teamId` (`StaffConsole.tsx:258-269`).
- The team roster is loaded into `teams` state from the same run's `teams` collection
  (`:210-243`), each row `{ id, displayName, score }`.
- The chat section already resolves an id to a name:
  `const nameFor = (teamId: string) => teams.find((tm) => tm.id === teamId)?.displayName ?? teamId.slice(0, 8);`
  (`:541`).
- The alert card, however, prints the raw slice:
  `<div ...>{t.staff.teamLabel} {a.teamId.slice(0, 8)}</div>` (`:361`).

## The fix

Use the same resolution on the alert card. Because `nameFor` is declared far below the alerts JSX,
the implementer should **lift `nameFor` above the `return`** (it depends only on `teams`, already in
scope there) and call it in both places, so there is a single resolver:

```tsx
// alert card
<div className="text-xs text-zinc-500 truncate">{t.staff.teamLabel} {nameFor(a.teamId)}</div>
```

No change to the fallback contract: `nameFor` already returns `teamId.slice(0, 8)` when the name is
missing, so a team whose roster row has not arrived still renders exactly today's label.

## RTL / i18n notes

- Hebrew is the default language; no em-dash introduced.
- No new dictionary key. `t.staff.teamLabel` is unchanged; the value shown is the creator/participant
  display name, already rendered with the surrounding `dir="auto"`-safe context (team names elsewhere
  in this file use `dir="auto"`; the alert label sits in a `truncate` line — keep it readable, and if
  the implementer wants parity with the chat/score rows they may add `dir="auto"` to the label line,
  optional and non-blocking).
- `npm run i18n:check:strict` must stay clean (no hardcoded string added; the name flows from data).

## Test strategy

play-web has no component test runner (CLAUDE.md), so this is a UI-lane change: `npm run verify`
(typecheck · lint · test · builds · bundle:budget · base:check · i18n:check:strict). No pure module is
extracted — the resolver is a one-line `Array.find` already shipping as `nameFor`. Manual check: a
team that triggers SOS shows its name on the marshal's card; a team with no loaded name still shows
the uid slice.
