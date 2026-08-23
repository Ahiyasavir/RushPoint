// Google Analytics 4 wiring (change: google-analytics-tag).
//
// The single source of truth for WHICH hostnames report to the analytics property and
// HOW the tag is configured. Pure (no `import.meta`, no DOM, no I/O) so it can be
// regression-locked by a unit test, exactly like `./env.ts`.
//
// ── The duplication you are about to notice ──────────────────────────────────
// An inline classic <script> in apps/*/index.html CANNOT import this module — it is not
// part of Vite's module graph, and the tag must run before the app bundle parses (a tag
// that loads after the bundle misses precisely the early bounces worth measuring). So
// each index.html carries a hand-written copy of the host rule below.
//
// That copy is not trusted: `scripts/test-analytics-gate.ts` EXTRACTS the predicate from
// the shipped HTML and EXECUTES it against the same case table used to test this file.
// Drift turns `npm test` red rather than silently mis-reporting traffic. If you change
// the rule here, change it in both index.html files — the gate will tell you if you
// forget.
//
// Deliberately NOT keyed on Vite mode: `isEmulatorBuild` (./env.ts) is
// `DEV || MODE === 'playtest'`, so a mode-based gate would exclude the playtest tunnel —
// which is the traffic this change exists to measure. Hostname is also the only signal
// available to a classic inline script.

/** The GA4 measurement id. A public, non-secret identifier — hardcoded on purpose, so a
 *  misconfigured deploy cannot silently ship an untagged bundle. */
export const GA_MEASUREMENT_ID = 'G-89TM5X68RR';

/**
 * A second GA4 property that mirrors the same traffic. One `gtag('js', …)` load feeds
 * BOTH properties via two separate `gtag('config', …)` calls — GA4's supported pattern
 * for reporting to multiple properties without a second script tag. Added alongside
 * GA_MEASUREMENT_ID, not instead of it: the original property keeps collecting.
 */
export const GA_MEASUREMENT_ID_SECONDARY = 'G-4LELMBZWPZ';

/**
 * Hosts that must NEVER reach the production property. Matched against the WHOLE
 * normalized hostname, never as a substring: `localhost.evil.example.com` is a real,
 * routable host and must report, and a substring test would silently swallow it.
 */
export const LOCAL_ANALYTICS_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Privacy hardening applied at `gtag('config', …)`. No advertising signals and no
 * cross-site identity — aggregate traffic measurement only. Disclosed to users in the
 * Privacy Policy §9 (packages/shared/src/legalContent.ts); the two must stay in step,
 * which is why the same test file asserts both.
 */
export const GA_CONFIG = {
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
} as const;

/**
 * Normalize a hostname for comparison: lowercase, and drop ONE trailing dot (the
 * fully-qualified form `localhost.` is the same host as `localhost`).
 * Returns `null` for anything that is not a usable hostname.
 */
function normalizeHostname(hostname: unknown): string | null {
  if (typeof hostname !== 'string') return null;
  const trimmed = hostname.trim();
  if (trimmed === '') return null;
  return trimmed.toLowerCase().replace(/\.$/, '');
}

/**
 * Should the Google Analytics tag load for this hostname?
 *
 * `false` for local development (see LOCAL_ANALYTICS_HOSTS) so a developer's own page
 * views never enter the production property; `true` for everything else — the ngrok /
 * cloudflare playtest tunnel and the production domain alike.
 *
 * TOTAL and FAIL-CLOSED: any input that is not a usable hostname (`undefined`, `null`,
 * `''`, whitespace, a non-string) returns `false` and never throws. An environment we
 * cannot identify must stay silent rather than report under an unknown identity —
 * missing data is recoverable, polluted data is not.
 */
export function shouldLoadAnalytics(hostname: unknown): boolean {
  const host = normalizeHostname(hostname);
  if (host === null) return false;
  return !LOCAL_ANALYTICS_HOSTS.includes(host);
}
