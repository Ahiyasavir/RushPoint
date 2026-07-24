# Tasks — staff-alert-team-name

Single file: `apps/play-web/src/screens/StaffConsole.tsx`. UI lane only (no component test runner).

## Implement

- [x] 1. Lift `nameFor` (currently declared near the chat section, `:541`) to above the component's
      `return`, unchanged — it depends only on `teams`, which is in scope there. (design.md)
      NOTE: the alert card lives in `StaffDashboard` while the existing `nameFor` lives in a separate
      component (`StaffChatSection`), so an identical one-line resolver was added above `StaffDashboard`'s
      `return`; the chat-section copy is unchanged.
- [x] 2. In the SOS/alerts card, replace `{a.teamId.slice(0, 8)}` (`:361`) with `{nameFor(a.teamId)}`,
      keeping the `{t.staff.teamLabel}` prefix and the `truncate` line. Confirm the uid-slice fallback
      still applies for an unresolved team.

## Verify (build lane — this agent)

- [ ] 3. `npm run verify` — green (especially `i18n:check:strict`: no new hardcoded string).
- [x] 4. `npx openspec validate staff-alert-team-name --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 5. Trigger SOS from a named team → the marshal's alert card shows the team name, not "a1b2c3d4".
- [ ] 6. An alert from a team whose roster row has not loaded still shows the uid slice.
