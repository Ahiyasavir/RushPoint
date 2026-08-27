## 1. The ping gate (pure, RED first — this decides whether a fix is sent at all)

- [x] 1.1 RED: write `scripts/test-play-ping-gate.ts` covering: a stationary team inside the
      interval is NOT sent; a significant move IS sent inside the interval; the first fix is
      always sent; the safety floor forces a send even when the verdict suppresses; and the
      totality cases (no previous fix, non-finite coordinates, unusable clock) each resolve to
      SEND and never throw. Run it; confirm it fails because the module does not exist.
- [x] 1.2 GREEN: add `apps/play-web/src/lib/pingGate.ts` — `shouldSendPing()`, pure,
      clock-injected, delegating significance to the shared `shouldWritePin` so the client and
      server cannot drift, and applying the maximum-silence floor on top. Make 1.1 pass.
- [x] 1.3 REFACTOR: name the floor as a declared constant with design D3's reasoning beside it —
      specifically that the floor bounds how late a safe-zone breach can be noticed, so it must
      never be widened to save reads.

## 2. Wire the client

- [x] 2.1 Replace the 20 s inline throttle in `PlayScreen`'s geolocation watcher with
      `shouldSendPing`, keeping the existing controller-only and active-only conditions exactly
      as they are — a viewer device and a finished team must still send nothing.
- [x] 2.2 Change the fallback poll from 12 s to 45 s, and update the comment to state the read
      budget the interval is accountable to (design D1), so the next person to change it knows
      what it costs.
- [x] 2.3 Confirm no callable signature or `services/calls.ts` wrapper changes. If either moved,
      this task is a bug.

## 3. Gates

- [ ] 3.1 `npm run verify` — all nine gates green. This touches play-web UI, so
      `i18n:check:strict` must add ZERO new PART B findings.
- [ ] 3.2 `npm run verify:emulator` — green. No server behaviour changed, so any failure here is
      a real regression, not an expected update.
- [ ] 3.3 Re-measure against production with the op counter and record the new per-team read cost
      beside the projection in design.md. Report honestly if it misses.

## 4. Prove it at the real scale

- [ ] 4.1 Run `scripts/simulate-prod.mjs` at the target team count against the deployed change and
      record measured reads/writes versus both ceilings.
- [ ] 4.2 Record the result in `docs/event-readiness-hamirotz-letzion.md` — including, if the
      figure still misses the ceiling, exactly by how much and what the next lever is.
