## 1. RED — Failing pure-logic test

- [ ] 1.1 Create `scripts/test-registration-fields.ts` importing `resolveRegistrationFields` and
  `resolveDisplayName` from `@rushpoint/shared` (not yet exported). Encode:
  - individual mode drops team-level name field, keeps exactly one member name field + custom fields
  - team mode returns fields unchanged (deep-equal)
  - `resolveDisplayName('individual', {}, ['Dana'])` === `'Dana'`
  - `resolveDisplayName('team', { teamName: 'Reds' }, ['Dana'])` === `'Reds'`
- [ ] 1.2 Run `npm test`; confirm failure ("not exported"/"is not a function") (RED).

## 2. GREEN — Shared helpers

- [ ] 2.1 Create `packages/shared/src/registration.ts` with `isNameField`,
  `resolveRegistrationFields(mode, fields)`, `resolveDisplayName(mode, values, memberNames)`.
- [ ] 2.2 Re-export from `packages/shared/src/index.ts`.
- [ ] 2.3 Run `npm test`; confirm `test-registration-fields.ts` passes (GREEN).

## 3. GREEN — Wire JoinScreen

- [ ] 3.1 In `apps/play-web/src/screens/JoinScreen.tsx`, replace inline `teamFields`/`memberFields`/
  `displayName` logic with the helpers. Individual mode: render one name input (i18n `join.yourName`),
  no member list, no add-member, no team-name field. Team mode unchanged.
- [ ] 3.2 Compute `memberNames`/`displayName` via `resolveDisplayName`; keep the `joinRun` payload shape.

## 4. Verify

- [ ] 4.1 `npm run typecheck` — 0 errors.
- [ ] 4.2 `npm test` — registration test green.
- [ ] 4.3 `npm run e2e` — join lifecycle still green (no callable change).
- [ ] 4.4 Preview: solo game shows one name field; team game shows team-name + member list.
