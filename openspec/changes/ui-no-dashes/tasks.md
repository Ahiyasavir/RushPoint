## 1. RED — Failing no-dashes test

- [ ] 1.1 Create `scripts/test-no-dashes.ts` importing `translations` from both apps; walk every
  string leaf and fail on any value matching `/—|–| - /` (em-dash, en-dash, spaced hyphen).
- [ ] 1.2 Run `npm test`; confirm it FAILS, listing the current offending strings (RED).

## 2. GREEN — Sweep the copy

- [ ] 2.1 Rewrite every offending leaf in `apps/creator-web/src/i18n.ts` (HE + EN) to remove the
  separator while preserving meaning (period / comma / line break).
- [ ] 2.2 Rewrite every offending leaf in `apps/play-web/src/i18n.ts`.
- [ ] 2.3 Grep both apps' `.tsx` for `—` and ` - ` in visible text; rewrite JSX literals (or move
  them into i18n) so only exempt matches (comments/paths/classes) remain.
- [ ] 2.4 Run `npm test`; confirm `test-no-dashes.ts` passes (GREEN).

## 3. Document the standard

- [ ] 3.1 Add a "UI text standard: no dashes/hyphens as separators" section to `INSTRUCTIONS.md`
  with the exact rule, the rationale, and a pointer to `scripts/test-no-dashes.ts`.

## 4. Verify

- [ ] 4.1 `npm run typecheck` — 0 errors.
- [ ] 4.2 `npm test` — no-dashes test green.
- [ ] 4.3 `npm run lint` and `npm run creator:build` — pass.
- [ ] 4.4 Preview both apps; spot-check the previously-offending screens read naturally.
