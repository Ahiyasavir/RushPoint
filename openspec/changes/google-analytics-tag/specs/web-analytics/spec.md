## ADDED Requirements

### Requirement: Analytics loads only on hostnames that are not local development

The system SHALL expose a pure function `shouldLoadAnalytics(hostname)` that decides
whether the Google Analytics tag runs for a given hostname. It SHALL return `false` for
the local development hosts `localhost`, `127.0.0.1`, and `[::1]`, so that a developer's
own page views never enter the production analytics property. It SHALL return `true` for
every other hostname, including the playtest tunnel hosts and the production domain.

The function SHALL be total: any input that is not a non-empty string (`undefined`,
`null`, `''`, a non-string) SHALL return `false` rather than throw, so that an
unresolvable environment fails CLOSED (no tracking) rather than reporting under an
unknown identity.

Hostname comparison SHALL be case-insensitive, and a trailing dot (the fully-qualified
form, e.g. `localhost.`) SHALL be treated as the same host.

#### Scenario: localhost is excluded

- **WHEN** `shouldLoadAnalytics('localhost')` is called
- **THEN** it returns `false`

#### Scenario: IPv4 and IPv6 loopback are excluded

- **WHEN** `shouldLoadAnalytics('127.0.0.1')` is called
- **THEN** it returns `false`
- **WHEN** `shouldLoadAnalytics('[::1]')` is called
- **THEN** it returns `false`

#### Scenario: the production domain reports

- **WHEN** `shouldLoadAnalytics('playrushpoint.com')` is called
- **THEN** it returns `true`
- **WHEN** `shouldLoadAnalytics('www.playrushpoint.com')` is called
- **THEN** it returns `true`

#### Scenario: playtest tunnel hosts report

- **WHEN** `shouldLoadAnalytics` is called with an ngrok host such as
  `abc123.ngrok-free.app`
- **THEN** it returns `true`
- **WHEN** `shouldLoadAnalytics` is called with a cloudflare host such as
  `dull-cat-42.trycloudflare.com`
- **THEN** it returns `true`

#### Scenario: comparison ignores case and a trailing dot

- **WHEN** `shouldLoadAnalytics('LOCALHOST')` is called
- **THEN** it returns `false`
- **WHEN** `shouldLoadAnalytics('localhost.')` is called
- **THEN** it returns `false`

#### Scenario: an unusable hostname fails closed

- **WHEN** `shouldLoadAnalytics` is called with `undefined`, `null`, `''`, or a
  non-string value
- **THEN** it returns `false` and does not throw

#### Scenario: a host that merely contains a local name still reports

- **WHEN** `shouldLoadAnalytics('localhost.evil.example.com')` is called
- **THEN** it returns `true`, because the exclusion matches the WHOLE hostname and is
  not a substring test

### Requirement: Both web apps carry the GA4 tag with the hardening flags

Both `apps/play-web/index.html` and `apps/creator-web/index.html` SHALL contain the
Google Analytics 4 tag for measurement id `G-89TM5X68RR`.

The tag SHALL configure GA with `anonymize_ip: true`, `allow_google_signals: false`,
and `allow_ad_personalization_signals: false`, so that no advertising or cross-site
identity signal is collected.

The tag SHALL apply the `shouldLoadAnalytics` host rule before requesting
`googletagmanager.com`, so that on an excluded host **no network request to Google is
made at all** — it is not sufficient to load the script and suppress the event.

The gtag script SHALL be loaded asynchronously so it never blocks first paint, and a
failure to load it SHALL leave the application fully functional.

#### Scenario: the measurement id is present in both apps

- **WHEN** the contents of `apps/play-web/index.html` and
  `apps/creator-web/index.html` are read
- **THEN** each contains the string `G-89TM5X68RR`

#### Scenario: the hardening flags are present in both apps

- **WHEN** the contents of either app's `index.html` are read
- **THEN** each contains `anonymize_ip`, `allow_google_signals`, and
  `allow_ad_personalization_signals`

#### Scenario: an excluded host issues no request to Google

- **WHEN** the page is served from `localhost`
- **THEN** no request to `www.googletagmanager.com` is issued

#### Scenario: the app survives a blocked tag

- **WHEN** the request to `www.googletagmanager.com` fails or is blocked by the browser
- **THEN** the application continues to render and function normally

### Requirement: The charset declaration stays within the first 1024 bytes

In both apps' `index.html`, the `<meta charset>` declaration SHALL appear BEFORE the
analytics tag, so that the character-set declaration remains inside the document's
first 1024 bytes as required for reliable encoding detection.

#### Scenario: charset precedes the analytics tag

- **WHEN** either app's `index.html` is read
- **THEN** the byte offset of `<meta charset` is less than the byte offset of the
  analytics tag

#### Scenario: charset is early enough to be honoured

- **WHEN** either app's `index.html` is read
- **THEN** the `<meta charset` declaration begins within the first 1024 bytes of the
  document

### Requirement: Installed PWA devices receive the tagged app shell

The `CACHE` constant in `apps/play-web/public/sw.js` SHALL be bumped to a new version as
part of this change, so that already-installed devices discard the cached tagless shell
instead of serving it indefinitely.

`apps/play-web` is an installable PWA whose service worker caches `/index.html` as the
offline app shell and deletes every cache whose key differs from the current `CACHE`
constant on activation, so an HTML-only change is invisible to installed devices until
the cache key changes.

#### Scenario: the shell cache key changes

- **WHEN** `apps/play-web/public/sw.js` is read after this change
- **THEN** the `CACHE` constant is not `rushpoint-play-v3`

#### Scenario: an installed device picks up the tagged shell

- **WHEN** a device that installed the PWA under the previous cache version loads the
  app after this change is deployed
- **THEN** the previous cache is deleted on service-worker activation and the shell
  served thereafter contains the analytics tag

### Requirement: The Privacy Policy discloses Google Analytics in both languages

The Privacy Policy's cookies-and-tracking section SHALL accurately describe the analytics
in use, in `packages/shared/src/legalContent.ts`. It SHALL NOT claim that only essential
cookies are used, and SHALL NOT claim that no analytics are used, because both statements
become false when this change ships.

The section SHALL, in **both** the Hebrew and English documents: name Google Analytics
as the analytics provider; state that it sets analytics cookies (`_ga`,
`_ga_G-89TM5X68RR`); state the purpose (aggregate usage measurement); state the
hardening applied (IP anonymization on, advertising and personalization signals off);
and tell the reader how to opt out.

The two language versions SHALL remain equivalent in substance, and the existing
markdown structure and section numbering SHALL be preserved. The Hebrew body SHALL
remain Hebrew and the English body SHALL remain English, per the repository's
bilingual purity gate.

#### Scenario: the false "essential cookies only" claim is gone — English

- **WHEN** the English privacy policy body is read
- **THEN** it does NOT contain the claim that no tracking cookies or analytics are used
- **THEN** it names Google Analytics

#### Scenario: the false claim is gone — Hebrew

- **WHEN** the Hebrew privacy policy body is read
- **THEN** it does NOT contain the equivalent Hebrew claim that no tracking/analytics
  cookies are used
- **THEN** it names Google Analytics

#### Scenario: the cookie names are disclosed in both languages

- **WHEN** either language's privacy policy body is read
- **THEN** it contains the analytics cookie name `_ga`

#### Scenario: bilingual purity is preserved

- **WHEN** `npm run i18n:check:strict` is run after the edit
- **THEN** it reports no PART A error and no new PART B warning
