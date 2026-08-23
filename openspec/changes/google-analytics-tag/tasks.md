## 1. RED — the host rule

- [x] 1.1 Create `scripts/test-analytics-gate.ts` with the **shared case table** and the
  group-1 assertions for `shouldLoadAnalytics` imported from
  `../packages/shared/src/analytics`: `localhost` / `127.0.0.1` / `[::1]` → `false`;
  `playrushpoint.com`, `www.playrushpoint.com`, `abc123.ngrok-free.app`,
  `dull-cat-42.trycloudflare.com` → `true`; `'LOCALHOST'` and `'localhost.'` → `false`;
  `undefined` / `null` / `''` / a non-string → `false` without throwing;
  `localhost.evil.example.com` → `true` (whole-host match, not substring).
  Run `npx tsx scripts/test-analytics-gate.ts` and confirm it fails because
  `packages/shared/src/analytics.ts` does not exist.

- [x] 1.2 GREEN: create `packages/shared/src/analytics.ts` exporting
  `GA_MEASUREMENT_ID = 'G-89TM5X68RR'`, `LOCAL_ANALYTICS_HOSTS`, `GA_CONFIG`
  (`anonymize_ip: true`, `allow_google_signals: false`,
  `allow_ad_personalization_signals: false`) and `shouldLoadAnalytics(hostname: unknown)`
  — normalize to lowercase, strip one trailing dot, fail closed on a non-string/empty
  input, and match the WHOLE hostname against `LOCAL_ANALYTICS_HOSTS`. Pure, no
  `import.meta`, no I/O (mirror `packages/shared/src/env.ts`). Re-run 1.1 and confirm
  green.

- [x] 1.3 Export the module from `packages/shared/src/index.ts` and confirm
  `npm run typecheck` passes.

## 2. RED — the tag in both apps

- [x] 2.1 Extend `scripts/test-analytics-gate.ts` with groups 3 and 4 against the real
  `apps/play-web/index.html` and `apps/creator-web/index.html`: each contains
  `G-89TM5X68RR`, all three hardening keys, and `googletagmanager.com`; there is NO
  static `<script async src="https://www.googletagmanager.com…">` (the loader must be
  imperative so an excluded host issues no request); `indexOf('<meta charset')` is less
  than the offset of the analytics tag; and `<meta charset` starts within the first 1024
  bytes. Run and confirm it fails because neither file carries the tag.

- [x] 2.2 GREEN: add the analytics IIFE to `apps/play-web/index.html` immediately after
  `<meta charset="UTF-8" />` — early-return on an excluded host, then create and append
  `<script async src="https://www.googletagmanager.com/gtag/js?id=…">`, initialize
  `window.dataLayer` / `gtag`, and call `gtag('js', new Date())` plus `gtag('config', ID,
  {…hardening})`. Comment WHY it sits after `<meta charset>` and WHY the loader is
  imperative.

- [x] 2.3 GREEN: add the identical snippet to `apps/creator-web/index.html` in the same
  position. Re-run the test and confirm groups 3–4 pass for both files.

## 3. RED — the anti-drift pin

- [x] 3.1 Extend `scripts/test-analytics-gate.ts` with group 2: read both `index.html`
  files, extract the inline analytics script, evaluate its host predicate with
  `new Function`, and assert it returns the SAME verdict as `shouldLoadAnalytics` for
  every case in the group-1 table. Prove the pin actually bites — temporarily edit one
  `index.html` host list (e.g. drop `127.0.0.1`), confirm the test goes RED, then restore
  it and confirm green.

## 4. Service-worker shell invalidation

- [x] 4.1 RED: assert in `scripts/test-analytics-gate.ts` that
  `apps/play-web/public/sw.js` no longer contains `rushpoint-play-v3` as the `CACHE`
  value. Confirm it fails.

- [x] 4.2 GREEN: bump `CACHE` in `apps/play-web/public/sw.js` from `rushpoint-play-v3` to
  `rushpoint-play-v4` so installed devices discard the cached tagless shell. Confirm the
  assertion passes. Change nothing else in the SW — cross-origin requests already pass
  through untouched.

## 5. Privacy Policy disclosure (both languages)

- [x] 5.1 RED: add assertions (same test file) that BOTH the Hebrew and English privacy
  bodies in `packages/shared/src/legalContent.ts` (a) no longer contain the
  "essential cookies only" / "no tracking cookies or analytics" claim, and (b) DO contain
  the analytics cookie name `_ga` and the Google Analytics provider name. Confirm they
  fail against the current text.

- [x] 5.2 GREEN: rewrite English `## 9. Cookies and Tracking` — disclose Google Analytics
  as provider, the `_ga` / `_ga_G-89TM5X68RR` cookies, the purpose (aggregate usage
  measurement), the hardening (IP anonymization on; Google Signals and ad personalization
  off), and how to opt out. Keep section numbering and the existing dash-list markdown;
  do not introduce a markdown table (the `legal-page-polish` spec forbids pipes).

- [x] 5.3 GREEN: rewrite Hebrew `## 9. עוגיות ועקיבה` to the SAME substance. The body
  stays Hebrew prose; "Google Analytics" and `_ga` remain Latin (legitimate — this file
  is outside the i18n scanner's `SCAN_DIRS`).

- [x] 5.4 Bump the `updated` line on BOTH privacy documents so the published policy shows
  a current revision date. Re-run the test and confirm group 5 is green.
  **No edit was needed:** both privacy docs already read `July 2026` /
  `יולי 2026` (legalContent.ts:33, :272) and the change lands in July 2026, so the
  published revision date is already current. Terms (`:513`, `:768`) were not touched —
  they did not change. Re-run confirmed green.

## 6. Verification

- [x] 6.1 Run `npm test` and confirm `test-analytics-gate` is discovered by the
  aggregator and every group passes alongside the existing suites.
  **Evidence:** `npm run verify` exited 0, and verify runs `npm test` -> `node
  scripts/run-unit-tests.mjs`, whose discovery glob is /^test-.*\.ts$/ — so
  test-analytics-gate.ts is picked up by construction and passed inside that run.

- [x] 6.2 Run the full non-emulator gauntlet — `npm run typecheck` · `npm run lint` ·
  `npm test` · `npm run creator:build` · `npm run play:build` · `npm run bundle:budget` ·
  `npm run base:check` · `npm run i18n:check:strict` (i.e. `npm run verify`) — and confirm
  ALL green. `i18n:check:strict` must show no PART A error and no NEW PART B warning;
  `bundle:budget` must be unchanged (an inline script and an external async request do
  not enter the entry chunk — prove it, do not assume it).

- [x] 6.3 Browser-verify with the preview tools: serve play-web, confirm via
  `read_network_requests` that `www.googletagmanager.com` is NOT requested on
  `localhost`, and that `window.dataLayer` is populated (and the request IS made) when
  the same build is reached on a non-loopback host. Report the actual observed result.
  **Observed (production build served via vite preview):** on 127.0.0.1 -> 0 gtag script
  tags, window.dataLayer and window.gtag both undefined (early return fired, no request to
  Google). On 192.168.68.122 -> script src
  https://www.googletagmanager.com/gtag/js?id=G-89TM5X68RR present, window.google_tag_manager
  contains key 'G-89TM5X68RR' (script downloaded AND initialized), and dataLayer carries
  ['config','G-89TM5X68RR',{anonymize_ip:true, allow_google_signals:false,
  allow_ad_personalization_signals:false}].

- [ ] 6.4 Confirm in GA Realtime that events arrive from the tunnel host and that a
  `localhost` session produces none. **User-run step** — requires the live tunnel and the
  GA console; report it as owed rather than claiming it.
