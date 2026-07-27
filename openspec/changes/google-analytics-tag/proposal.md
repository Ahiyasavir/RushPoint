## Why

RushPoint is about to move from an ngrok playtest tunnel to a real domain
(playrushpoint.com), and there is currently **no measurement of any kind** on either
web surface — nobody knows how many people open a join link, how many abandon at the
code gate, or whether a creator who lands on the console ever starts a game. A Google
Analytics 4 property (`G-89TM5X68RR`) already exists and is waiting for a tag.

The reason this needs a spec rather than a paste: the naive "paste the snippet into
`index.html`" has three failure modes that are invisible until they have already done
damage — (a) every developer's `localhost` page view lands in the same property and
permanently pollutes the baseline, (b) play-web is a PWA whose service worker caches
`/index.html` as the offline app shell, so already-installed devices keep serving the
**tagless** shell indefinitely, and (c) the published Privacy Policy currently asserts
the *opposite* of what the tag does, in both languages.

## What Changes

- **Analytics tag on both web surfaces.** `apps/play-web/index.html` and
  `apps/creator-web/index.html` each carry the GA4 tag for `G-89TM5X68RR`, placed
  immediately after `<meta charset>` (the charset declaration must remain inside the
  document's first 1024 bytes, so it cannot be displaced by a script).
- **Analytics is environment-gated, and the gate is a pure function.** A new
  `shouldLoadAnalytics(hostname)` decides whether a given host reports. Local
  development (`localhost`, `127.0.0.1`, `[::1]`) is **excluded**; the playtest tunnel
  (`*.ngrok*`, `*.trycloudflare.com`) and production (`playrushpoint.com`) are
  **included**. The rule is unit-tested, not trusted as inline HTML.
- **Privacy-hardened GA configuration.** `anonymize_ip: true`,
  `allow_google_signals: false`, `allow_ad_personalization_signals: false` — no
  advertising or cross-site identity signals, only aggregate traffic measurement.
- **Service-worker shell version bump.** `apps/play-web/public/sw.js` `CACHE` moves
  `rushpoint-play-v3` → `v4` so devices that already installed the PWA discard the
  cached tagless shell and pick up the tagged one.
- **BREAKING (published legal text): the Privacy Policy's cookie section is corrected.**
  Section 9 currently states, in Hebrew *and* English, that the Service uses
  "essential cookies only" and that "No tracking cookies, advertising analytics,
  retargeting, or advertising network pixels are used". Shipping GA4 — which sets
  `_ga` and `_ga_G-89TM5X68RR` cookies — makes that statement **false as published**.
  Section 9 is rewritten in both languages to disclose Google Analytics, name the
  cookies, state the purpose and the hardening, and point to Google's opt-out. This
  is a user-facing legal correction, not a cosmetic edit.

### Non-goals

- **No cookie-consent banner.** Consent is not collected before the tag loads. This is
  a deliberate, recorded trade-off (see design.md): it is adequate for an Israel-first
  audience under the Protection of Privacy Law, but it is **not** strict GDPR
  compliance for EU visitors, and it does not satisfy a "consent before non-essential
  cookies" reading. Revisiting this is a separate change.
- **No custom event instrumentation.** No `gtag('event', …)` calls for joins,
  completions, launches, or funnel steps. This change ships page-view measurement
  only; a semantic event taxonomy is future work.
- **No Google Tag Manager.** The raw gtag.js tag only.
- **No analytics inside Cloud Functions, and no new callable.** Nothing about the
  server surface changes.
- **No change to what the product stores about a player.** GA is client-side only; no
  Firestore document, no `RunTeam` field, and no participant data is sent to Google
  beyond what gtag.js collects by default.

## Capabilities

### New Capabilities

- `web-analytics`: Where the GA4 tag lives, which hostnames report and which are
  excluded, the privacy-hardening flags it must carry, the PWA shell-cache
  invalidation that makes the tag reach installed devices, and the Privacy Policy
  disclosure that must accompany it in both languages.

### Modified Capabilities

<!-- None. `legal-page-polish` governs how the legal markdown is RENDERED (back-button
     language, no table pipes, HTML escaping) — none of those requirements change. The
     Section 9 body text is new prose governed by the `web-analytics` disclosure
     requirement above, so no existing spec's requirements are altered. -->

## Impact

**Surfaces touched:** `play-web` · `creator-web` · `packages/shared` (or an app-local
`lib/`) for the pure gate · the pure-logic test lane. **No** callable, **no** Firestore
rules, **no** shared type, **no** server change.

- `apps/play-web/index.html` — GA tag after `<meta charset>`.
- `apps/creator-web/index.html` — same tag, same position.
- `apps/play-web/public/sw.js` — `CACHE` version bump (shell invalidation).
- `packages/shared/src/analytics.ts` (new) — `shouldLoadAnalytics()`, `GA_MEASUREMENT_ID`,
  `GA_CONFIG`; pure, dependency-free, no `import.meta`, mirroring the existing
  `packages/shared/src/env.ts` pattern.
- `scripts/test-analytics-gate.ts` (new) — auto-discovered by
  `scripts/run-unit-tests.mjs`; asserts the host rule **and** that both `index.html`
  files actually carry the tag with the hardening flags and the charset ordering, so a
  future edit that silently drops the tag or the flags fails the gate.
- `packages/shared/src/legalContent.ts` — Privacy Policy §9 rewritten, HE and EN.

**Gates:** `npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` ·
`npm run play:build` · `npm run bundle:budget` · `npm run base:check` ·
`npm run i18n:check:strict` (the legal prose is bilingual user-facing text, so the
Hebrew↔English purity gate applies).

**Third-party dependency:** the browser fetches `https://www.googletagmanager.com/gtag/js`
at runtime — a new external origin on the critical path for both apps. It is `async`
and imperative, so it never blocks first paint; a blocked or failed fetch leaves the app
fully functional. The service worker already ignores cross-origin requests
(`sw.js` returns early when `url.origin !== self.location.origin`), so no SW logic
changes are needed beyond the version bump.

**Risk if the disclosure is skipped:** a published privacy policy that materially
misstates tracking practice, on a platform that explicitly serves minors and carries a
GDPR section. That is why the legal edit is in-scope here and not deferred.
