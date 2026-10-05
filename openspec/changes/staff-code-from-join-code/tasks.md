## 1. RED

- [ ] 1.1 `scripts/test-staff-code.ts`: `makeStaffCode` shape and alphabet, the join code is a
  subsequence, `candidateJoinCodes` contains it and has at most 28 distinct entries, a wrong length
  gives none, `normalizeStaffCode` folds spaces, dashes and case, the measured code count for one join
  code is above 20,000. Run it and watch it fail.
- [ ] 1.2 `scripts/e2e-verify.mjs`: a code-only sign-in scenario (succeeds, returns the address), a
  wrong planted code counts against the run, a code on no join code is `not-found`.

## 2. GREEN

- [ ] 2.1 `packages/shared/src/staffCode.ts` + barrel export.
- [ ] 2.2 `createRunStaffInvite` mints from the run's join code (legacy 6 digits only if the run has
  none).
- [ ] 2.3 `staffSignIn`: address optional; resolve from the code (D2); return the address.
- [ ] 2.4 play-web `StaffSignIn`: name + code only, answering button, session from the result;
  `calls.ts` types; i18n HE + EN.
- [ ] 2.5 creator-web: the staff link note says the link is optional.

## 3. Verify

- [ ] 3.1 Browser: the staff screen with and without a link shows two fields.
- [ ] 3.2 Gates: `npm run verify` green, `npm run e2e` green, `npm run i18n:check:strict` clean.
