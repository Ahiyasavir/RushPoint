## Context

Two Vite SPAs (`apps/play-web`, `apps/creator-web`) currently ship with zero
measurement. A GA4 property `G-89TM5X68RR` exists and needs a tag. The product is
about to acquire a real domain (playrushpoint.com) while continuing to run through an
ngrok/cloudflare playtest tunnel, so the tag must work on both without configuration.

Three properties of this codebase shape the design far more than the GA snippet does:

1. **`index.html` is not part of the module graph for a plain inline script.** Vite
   transforms `<script type="module">`, but the analytics tag must be a classic inline
   script that runs before the app boots and without a bundler round-trip. It therefore
   **cannot `import` from `@rushpoint/shared`**. Any rule it applies is, physically, a
   copy. This is the central design problem — everything below follows from it.
2. **play-web is a PWA with an app-shell service worker.** `public/sw.js` caches
   `/index.html` and, on `activate`, deletes every cache key that is not the current
   `CACHE` constant. An HTML-only change is therefore invisible to installed devices
   until the cache key changes.
3. **The Privacy Policy is a shipped artifact, not a doc.** `legalContent.ts` is
   rendered at `/privacy` on both origins and currently asserts the opposite of what
   this change does.

Current relevant state: `packages/shared/src/env.ts` establishes the house pattern for
a pure, `import.meta`-free build-environment predicate that a unit test can pin.
`scripts/run-unit-tests.mjs` auto-discovers every `scripts/test-*.ts` and runs it under
`tsx`, and such scripts already import both `scripts/lib/*.mjs` and
`packages/shared/src/*` directly.

## Goals / Non-Goals

**Goals:**

- GA4 page-view measurement live on both apps, on the tunnel and on production.
- Local development contributes **zero** events and issues **zero** requests to Google.
- The host rule is a pure, unit-tested function — not untested inline HTML.
- The inline copy in `index.html` cannot silently drift from that function.
- Installed PWA devices actually receive the tagged shell.
- The published Privacy Policy is true in both languages after this ships.

**Non-Goals:**

- Cookie-consent banner / consent-mode gating (recorded trade-off below).
- Custom `gtag('event', …)` instrumentation or a funnel taxonomy.
- Google Tag Manager.
- Any server, callable, Firestore rule, index, or shared-type change.
- Routing SPA "virtual page views" on `history.replaceState` (play-web has no router).

## Decisions

### D1. The host rule lives in `packages/shared/src/analytics.ts`, and the inline copy is pinned to it by a test that executes the shipped HTML

**Decision.** Export from a new pure module:

```ts
export const GA_MEASUREMENT_ID = 'G-89TM5X68RR';
export const LOCAL_ANALYTICS_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;
export const GA_CONFIG = {
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
} as const;
export function shouldLoadAnalytics(hostname: unknown): boolean;
```

`shouldLoadAnalytics` normalizes (lowercase, strip one trailing dot), returns `false`
for a non-string / empty input (**fail closed** — an unresolvable environment must not
report), and otherwise returns `!LOCAL_ANALYTICS_HOSTS.includes(host)`. Matching is on
the **whole** hostname, never a substring, so `localhost.evil.example.com` correctly
reports rather than being silently excluded by a sloppy `includes()`.

`index.html` carries a hand-written equivalent inline.

**Why the duplication is acceptable here, when the repo elsewhere forbids it** (cf.
`scripts/lib/i18nLeak.ts`, which exists *because* a duplicated predicate drifted): the
duplication is forced by constraint (1) — there is no import path into an inline classic
script. So instead of pretending it is single-sourced, the design makes drift
**detectable**: `scripts/test-analytics-gate.ts` reads the real `index.html`, extracts
the inline predicate, evaluates it with `new Function`, and asserts it agrees with
`shouldLoadAnalytics` on **every** case in a shared table. The test runs the actual
shipped bytes, so a drifted inline rule fails the gate rather than quietly mis-reporting.

**Alternatives considered.**
- *A Vite plugin / `transformIndexHtml` that injects the snippet from the shared module.*
  Genuinely single-sourced, and the "right" answer at larger scale. Rejected for this
  change: it puts the tag behind build-time codegen in two separate Vite configs that
  already carry delicate `--mode playtest` base/outDir logic (a documented source of
  live-site breakage), for a nine-line snippet. The executed-HTML test buys the same
  guarantee at a fraction of the blast radius. Worth revisiting if the tag grows.
- *Put the tag in `main.tsx` instead of `index.html`.* Single-sourced and importable —
  but it then loads after the JS bundle parses and executes, losing early page views and
  bounces, which is precisely the population worth measuring. Rejected.
- *Env var (`VITE_GA_ID`) instead of a literal.* A GA measurement id is a public,
  non-secret identifier that must be identical everywhere; an env var adds a way for a
  deploy to silently ship untagged. Rejected — hardcode it, and let the test assert it.

### D2. Gate on **hostname**, not on Vite mode

**Decision.** The exclusion keys on `location.hostname`, not on `import.meta.env.DEV`
or `MODE`.

**Why.** `isEmulatorBuild` (`packages/shared/src/env.ts`) is `DEV || MODE === 'playtest'`
— so a mode-based gate would exclude the **playtest tunnel**, which is exactly the
traffic the user wants measured. Hostname is also the only signal available to a classic
inline script (no `import.meta`). Excluding by loopback host, and including everything
else, gives: `dev:all` on localhost → silent; ngrok/cloudflare tunnel → reports;
playrushpoint.com → reports. That matches the requirement exactly.

**Trade-off.** A developer running the dev server bound to their LAN IP
(`192.168.x.x`) or hitting a preview build via a non-loopback host **will** report. Left
deliberately: enumerating private ranges adds rule surface for a rare case, and the
tunnel-must-report requirement means "not localhost ⇒ report" is the honest default.

### D3. Placement: immediately after `<meta charset>`, loaded imperatively

**Decision.** The tag sits directly after `<meta charset="UTF-8" />`, before the
viewport meta — **not** as the literal first child of `<head>` as Google's copy
instructs.

**Why.** The charset declaration must appear within the document's first 1024 bytes or
the browser may mis-detect encoding — a real hazard here, since both documents contain
Hebrew-adjacent content and the play-web app is Hebrew-first. A ~700-byte script placed
above `<meta charset>` risks pushing it out. Google's "immediately after `<head>`" is
guidance for ordinary pages, not a constraint; being one meta tag later has no
measurable effect on collection.

**Loader shape:** an IIFE that returns early on an excluded host and only then creates
and appends `<script async src="…gtag/js?id=…">`. Deliberately **not** the static
`<script async src>` from Google's copy: a static tag fires the network request before
any JS can decide, so localhost would still contact Google. "No request at all on an
excluded host" is a spec requirement, and only the imperative form satisfies it.

### D4. Bump the service-worker cache key

**Decision.** `apps/play-web/public/sw.js`: `CACHE = 'rushpoint-play-v3'` →
`'rushpoint-play-v4'`.

**Why.** The SW caches `/index.html` as the shell and serves it on offline boots; its
own header comment already states that a bump "is what actually pushes a fix out to
devices that already installed the app". Without the bump, every installed device keeps
the tagless shell — the change would appear to work in a fresh browser and silently fail
for exactly the installed-PWA users. No other SW logic changes: `fetch` already returns
early for cross-origin requests (`url.origin !== self.location.origin`), so
googletagmanager traffic passes straight through and is never cached.

### D5. Rewrite Privacy Policy §9 in both languages, in place

**Decision.** Replace the "essential cookies only" / "no analytics" claims in both the
Hebrew (`## 9. עוגיות ועקיבה`) and English (`## 9. Cookies and Tracking`) bodies of
`packages/shared/src/legalContent.ts`, preserving section numbering and the existing
dash-list markdown. Disclose: Google Analytics as provider, the `_ga` /
`_ga_G-89TM5X68RR` cookies, the purpose (aggregate usage measurement), the hardening
(IP anonymization on; Google Signals and ad personalization off), and how to opt out
(Google's browser add-on / browser cookie controls). Also bump the `updated` line on
both privacy documents.

**Why in scope.** The statement becomes materially false the moment the tag ships, on a
platform with a GDPR section that explicitly serves minors. Shipping the tag without
this is not a smaller change — it is a compliance defect.

**i18n gate interaction (verified, not assumed).** `scripts/check-i18n.ts` PART A reads
only `apps/*/src/i18n.ts` dictionaries; PART B's `SCAN_DIRS` are `apps/creator-web/src`
and `apps/play-web/src`. `packages/shared/src/legalContent.ts` is in **neither**, so the
Hebrew §9 body may legitimately contain the Latin strings "Google Analytics" and `_ga`
without tripping `hasEnglishWord`. Note `LATIN_WHITELIST` in `scripts/lib/i18nLeak.ts`
contains `'Google'` but **not** `'Analytics'` — recorded here so that if a future change
ever brings legal prose under the scanner, the fix is to whitelist the brand string, not
to mangle the Hebrew.

## Test Strategy

Pure-logic lane only — no emulator, no callable, no component runner. One new
auto-discovered file, `scripts/test-analytics-gate.ts`, with four groups:

1. **The pure rule.** `shouldLoadAnalytics` over the spec's case table: the three local
   hosts `false`; `playrushpoint.com`, `www.playrushpoint.com`, an ngrok host and a
   trycloudflare host `true`; case-insensitivity and trailing dot; `undefined` / `null`
   / `''` / non-string all `false` and non-throwing; `localhost.evil.example.com` →
   `true` (whole-host, not substring).
2. **Drift pin (the important one).** Read both `index.html` files, extract the inline
   analytics script, evaluate its host predicate via `new Function`, and assert it
   returns the **same** verdict as `shouldLoadAnalytics` for every case in group 1. This
   is what makes the unavoidable duplication safe.
3. **Tag presence + hardening.** Both files contain `G-89TM5X68RR`, all three hardening
   keys, and `googletagmanager.com`; and the loader is imperative (no static
   `<script async src="https://www.googletagmanager.com…">`), so an excluded host issues
   no request.
4. **Charset ordering.** In both files `indexOf('<meta charset')` is less than the offset
   of the analytics tag, and `<meta charset` begins within the first 1024 bytes.

Plus, in the same file or `scripts/test-legal-*`: assert the privacy bodies no longer
contain the "no analytics / essential only" claim in either language and do contain
`_ga` and the Google Analytics name.

**RED first:** every one of these fails before implementation — group 1 because the
module does not exist (import error), groups 2–4 because the tag is absent, and the
legal assertions because the old text is still there.

**Gates:** `npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` ·
`npm run play:build` · `npm run bundle:budget` · `npm run base:check` ·
`npm run i18n:check:strict`. (`bundle:budget` measures the built entry chunk; an inline
HTML script and an external async request do not enter it, so the budget is unaffected —
but it is run to prove that, not assumed.)

**Browser verification:** load play-web via the preview tools, confirm via
`read_network_requests` that `googletagmanager.com` is requested on a tunnel/non-local
host and **not** on `localhost`, and that `window.dataLayer` is populated.

## Risks / Trade-offs

- **[No consent banner is not GDPR-compliant for EU visitors]** → Explicitly accepted
  and recorded as a Non-goal in the proposal, with the hardening flags reducing (not
  eliminating) exposure and the policy now disclosing the practice honestly. A consent
  gate is a separate change; this design does not obstruct one — adding it means
  wrapping the same IIFE in a consent check.
- **[The inline rule is a literal duplicate of the shared function]** → Made
  *detectable* rather than merely documented: the test executes the shipped inline code
  against the same table (D1). If someone edits one and not the other, `npm test` is red.
- **[Non-loopback local development reports]** (LAN IP, preview on a device) →
  Accepted (D2). Consequence is a handful of stray sessions, not corrupted attribution.
- **[Ad-blockers / tracking protection block gtag.js]** → Expected and harmless: the
  loader is `async` and its failure is unobserved, so the app is unaffected. It does mean
  reported numbers understate reality — a property of GA, not of this design.
- **[A Content-Security-Policy could silently block gtag.js in production]** → Checked,
  not assumed: the repo defines **no** CSP anywhere. `deploy/Caddyfile` sets only
  `Strict-Transport-Security` and `X-Content-Type-Options` (and it fronts the **API**
  origin — `reverse_proxy 127.0.0.1:8080` — not the static apps), and `firebase.json`
  declares no `headers` block. So no `script-src`/`connect-src` directive stands between
  the page and `googletagmanager.com`. If a CSP is ever introduced, it must allow
  `https://www.googletagmanager.com` (script) and `https://*.google-analytics.com`
  (beacon), or the tag goes dark with no error surfaced to the app.
- **[A future `index.html` edit drops the tag]** → Group 3 of the test fails.
- **[Installed PWAs keep the old shell]** → D4's cache bump; asserted by a test that the
  `CACHE` constant is no longer `rushpoint-play-v3`.
- **[Privacy policy and behavior drift again later]** → The legal assertion lives in the
  same test file as the tag assertions, so removing the tag without fixing the policy
  (or vice versa) is caught in one place.

## Migration Plan

No data migration; the change is additive and client-side.

1. Land the shared module + failing tests (RED), then the HTML/SW/legal edits (GREEN).
2. Deploy both apps normally. The SW cache bump propagates on next activation; installed
   devices pick up the tagged shell one navigation later.
3. Verify in GA Realtime that events arrive from the tunnel host, and that a `localhost`
   session produces none.

**Rollback:** revert the two `index.html` hunks (tag stops immediately on next load).
If rolled back, the Privacy Policy §9 rewrite should be reverted **too** — otherwise the
policy over-discloses, which is harmless but inaccurate. The SW bump needs no rollback.

## Open Questions

- Should creator-web and play-web eventually become **separate GA data streams** rather
  than one property distinguished by hostname/path? Not blocking — one property is
  correct for launch, and splitting later does not invalidate collected data.
- Does the production domain serve creator-web under `/creator/` (as the playtest proxy
  does) or on its own subdomain? Affects only how the two apps are told apart inside GA
  reporting, not this implementation.
