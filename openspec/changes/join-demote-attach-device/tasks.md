# Tasks — join-demote-attach-device

UI lane (play-web has no component test runner). One screen; reuses existing i18n keys.

## Implement

- [x] 1. **Remove the segmented control** — delete the team-mode `create`/`attach` 50/50 toggle
      block in `apps/play-web/src/screens/JoinScreen.tsx`. Keep the `joinMode` state and the
      `joinMode === 'attach' ? … : …` branch. (design.md §The fix steps 1-2)

- [x] 2. **Demote attach to a link** — inside the create branch, after the primary Join button, add
      a secondary `<button type="button">` (min 44px, logical spacing) that runs
      `setJoinMode('attach'); setErr('')` and shows `t.devices.joinModeAttach`. (design.md §The fix
      step 3)

- [x] 3. **Back-to-create link** — inside the attach branch, add a secondary link that runs
      `setJoinMode('create'); setErr('')` and shows `t.devices.joinModeCreate`, so the path is
      reversible. (design.md §The fix step 4)

- [x] 4. Confirm the create form defaults on open (`joinMode` initial `'create'`) and the attach
      form + `attachAction`/`attachCta` are unchanged when reached via the link.

## Verify (build lane — this agent)

- [x] 5. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      i18n:check:strict) — green (i18n parity; zero new PART B; if no new key was added, no i18n
      delta at all).
- [x] 6. `npx openspec validate join-demote-attach-device --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 7. Team-mode Join opens on the create form with no forced toggle; the attach link reveals the
      device-code form; back returns to create; both submit paths still work. Solo mode shows
      neither link.
