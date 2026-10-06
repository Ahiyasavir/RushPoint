## 1. RED

- [ ] 1.1 `scripts/test-flash-missions.ts`: a rejected claim with `retryAllowed` may claim again (also
  while its own team holds `takenBy`); without it the verdict is `rejected`; `flashMyClaimLine` says
  `retry` for a retryable rejection.
- [ ] 1.2 `scripts/e2e-verify.mjs`: reject with retry keeps `takenBy` and lets the team claim again;
  reject without retry frees it for another team and refuses the rejected team.

## 2. GREEN

- [ ] 2.1 shared verdicts. 2.2 `reviewFlashMission` `retry`. 2.3 phone notice + retry button.
- [ ] 2.4 console + staff: reject asks which.

## 3. Verify

- [ ] 3.1 Browser at 375px: reject with retry, the notice, retry, send again.
- [ ] 3.2 Gates: `npm run verify`, `npm run e2e`.
