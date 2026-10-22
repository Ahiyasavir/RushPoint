# Tasks: signup-quota-fallback

## 1. RED
- [x] 1.1 `scripts/test-signup-fallback.ts`: the pure decision (fall back only on the quota refusal and
      only with a code), the code hint (URL, checked code), and that every fresh sign-in in
      `firebase.ts` goes through the fallback wrapper. Confirmed failing.
- [x] 1.2 `scripts/e2e-verify.mjs`: `startPlayerSession` unauthenticated → token → sign in → joinRun;
      bad code → not-found; finished run refused; rate limit carries `reason: 'rateLimited'`.

## 2. GREEN
- [x] 2.1 `startPlayerSession` + budgets + PUBLIC_CALLABLES entry.
- [x] 2.2 Phone: `signInFreshPlayer()` wraps all three fresh sign-ins; join wrappers record the code.
- [x] 2.3 Staff console reads the `player` claim.

## 3. Verify
- [x] 3.1 `npm run verify` (all but origin:check) + `npm run e2e` (142/142).
- [x] 3.2 Browser (16/16, WebKit + Chromium, both paths, all four loss moments; STRESS_QUOTA=1): a WebKit phone whose anonymous sign-up is refused (the refusal injected at the
      network) still joins through the fallback.
- [ ] 3.3 Production, with approval: >100 sessions from one address in an hour; delete the users after.
