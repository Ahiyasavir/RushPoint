## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-bundle-budget.ts` in the house style of
      `scripts/test-emulator-backup.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit`),
      importing `selectAsset`, `evaluateBundleBudget` and `formatBudgetReport` from
      `./lib/bundleBudget.mjs`. Synthetic fixtures only — the test MUST NOT read `dist/`, the
      filesystem, or any real build output.
- [x] 1.2 Encode the asset-selection cases from the design's Test Strategy (1–4): exactly one match,
      no match → `missing`, two matches → `ambiguous`, non-entry assets ignored.
- [x] 1.3 Encode the byte-budget boundary cases (5–9): at limit passes, limit+1 fails with the
      overage reported, limit−1 passes, zero-byte asset passes the budget, and the initial-payload
      sum failing on a CSS-only increase while the JS check passes.
- [x] 1.4 Encode the unknown/malformed cases (10–12): `undefined` gzip size, `NaN` size, negative
      size and an empty asset list all fail — never coerced to zero, never a vacuous pass.
- [x] 1.5 Encode the marker cases (13–16): all zero passes; one positive fails naming dependency and
      chunk; several positive all named; a dependency missing from the input fails as unmeasured.
- [x] 1.6 Encode the totality/report cases (17–18): one check per policy entry,
      `ok === checks.every(c => c.ok)` asserted on EVERY case via a shared invariant helper, and
      `formatBudgetReport` deterministic + naming every check + marking exactly the failing ones.
- [x] 1.7 Run `npx tsx scripts/test-bundle-budget.ts` and confirm it FAILS for the right reason
      (`scripts/lib/bundleBudget.mjs` does not exist yet). Record the failure.

## 2. GREEN — pure decision logic

- [x] 2.1 Create `scripts/lib/bundleBudget.mjs` with `selectAsset(assets, pattern)` returning the
      single match or a typed problem (`missing` / `ambiguous`). No I/O, no clock.
- [x] 2.2 Add `evaluateBundleBudget({ assets, markers, policy })` returning
      `{ ok, checks, report }` with one `{ name, kind, actual, limit, ok, detail }` per policy entry:
      entry-JS gzip, entry-JS raw, initial-payload gzip, and one per forbidden marker.
- [x] 2.3 Implement the size guard: `actual <= limit` passes; a missing / non-numeric / negative
      measurement yields `kind: 'unknown'` and `ok: false`.
- [x] 2.4 Add `formatBudgetReport(result)` — deterministic, sorted, one line per check with measured
      value, limit, headroom (or overage) and a distinct `FAIL` marker.
- [x] 2.5 Re-run `npx tsx scripts/test-bundle-budget.ts` and confirm GREEN.

## 3. GREEN — the runner

- [x] 3.1 Create `scripts/check-bundle-budget.mjs`: read `apps/play-web/dist` (and
      `apps/creator-web/dist` for the informational section), compute raw bytes from disk and gzip
      with `zlib.gzipSync({ level: 9 })`, count the forbidden markers case-insensitively in the
      entry chunk's text, call `evaluateBundleBudget`, print `formatBudgetReport`, exit non-zero on
      failure.
- [x] 3.2 Fail with an actionable message (`run npm run play:build first`) when
      `apps/play-web/dist` is absent — never a vacuous pass.
- [x] 3.3 Encode the D3 policy numbers in ONE place in the runner with a comment carrying the
      measured baseline and the headroom percentage: entry JS gzip 255,000; entry JS raw 975,000;
      initial payload gzip 262,000.
- [x] 3.4 Print the creator-web measurements as an informational section that cannot affect the exit
      status (D7).
- [x] 3.5 Add `"bundle:budget": "node check-bundle-budget.mjs"` to `scripts/package.json`. Do NOT
      touch the root `package.json` — the root alias and the `verify`-chain entry are recommended in
      the final report (D8).

## 4. VERIFY

- [x] 4.1 `npm run play:build` and `npm run creator:build`, then
      `npm run bundle:budget --workspace=@rushpoint/scripts` — must PASS on the current tree, and its
      report must match the measured numbers recorded in `design.md`.
- [x] 4.2 Prove the check is not a no-op: temporarily lower the entry-JS gzip budget below the
      measured value, confirm a non-zero exit naming the asset and the overage, then restore the
      number and re-confirm PASS.
- [x] 4.3 Confirm the marker scan is live: verify the entry chunk currently has 0 hits for
      `maplibre` / `mapbox` / `jsqr` / `qrcode`, and that a synthetic positive count fails through
      the unit test (case 14) rather than only in the runner.
- [x] 4.4 Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
      `npm run creator:build` — all green. `npm run e2e` / `verify:emulator` / `test:rules` are NOT
      run (a live playtest stack is serving from this tree); state that explicitly in the report.

## 5. REFACTOR / HAND-OFF

- [x] 5.1 Re-read `scripts/lib/bundleBudget.mjs` for duplication with the existing `scripts/lib/*`
      helpers; keep it dependency-free (node builtins only) so the pure lane stays buildless.
- [x] 5.2 Report the follow-ups rather than performing them: (a) wire `bundle:budget` into the root
      `package.json` and the `verify` chain; (b) defer `firebase/storage` out of the participant
      entry chunk (D9), with the ~25 KB gzip estimate and the reason it was not done here.
- [x] 5.3 State plainly in the final report what remains unverified: real-device and real-network
      cold-start timing cannot be measured in this environment and is not claimed.
