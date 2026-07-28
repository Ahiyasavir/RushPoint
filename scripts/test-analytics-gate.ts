// Pure-logic tests for google-analytics-tag — WHICH hostnames get the GA4 tag, and
// the guarantee that the copy of that rule living inside each app's index.html cannot
// drift away from the shared function.
//
// Run by scripts/run-unit-tests.mjs via `npm test`, or directly:
//   npx tsx scripts/test-analytics-gate.ts
//
// SAFETY: this file resolves strings and reads repo files. It never opens a socket,
// never contacts Google, and never starts a browser.
//
// WHY THE DRIFT PIN (group 2) EXISTS: an inline classic <script> in index.html cannot
// `import` from @rushpoint/shared — it is not in the module graph. So the host rule is
// PHYSICALLY duplicated between packages/shared/src/analytics.ts and the two HTML
// files. Rather than document that and hope, this file extracts the predicate from the
// shipped HTML and EXECUTES it against the same case table as the shared function. A
// drifted inline rule turns the gate red instead of silently mis-reporting traffic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GA_MEASUREMENT_ID,
  GA_MEASUREMENT_ID_SECONDARY,
  GA_CONFIG,
  LOCAL_ANALYTICS_HOSTS,
  shouldLoadAnalytics,
} from '../packages/shared/src/analytics';
// Deep import: legalContent is deliberately NOT in the shared barrel (it is tens of kB
// of prose that must stay out of the participant entry chunk). Static, not dynamic —
// tsx transforms this file to CJS, where top-level await is unavailable.
import { LEGAL_DOCS } from '../packages/shared/src/legalContent';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── The case table — shared by group 1 (the function) and group 2 (the shipped HTML) ──
// Every row is [hostname, expectedShouldLoad]. Adding a row here strengthens BOTH the
// unit test and the drift pin at once, which is the point.
const CASES: Array<[unknown, boolean]> = [
  // Local development must never reach the production property.
  ['localhost', false],
  ['127.0.0.1', false],
  ['[::1]', false],
  // Normalization: case-insensitive, one trailing dot (the fully-qualified form).
  ['LOCALHOST', false],
  ['LocalHost', false],
  ['localhost.', false],
  ['127.0.0.1.', false],
  // Production.
  ['playrushpoint.com', true],
  ['www.playrushpoint.com', true],
  // The playtest tunnel — the traffic the whole change exists to measure.
  ['abc123.ngrok-free.app', true],
  ['dull-cat-42.trycloudflare.com', true],
  ['rushpoint-play.web.app', true],
  // WHOLE-hostname match, never a substring: a sloppy `includes('localhost')` would
  // silently exclude an attacker-controlled host — and, worse, a legitimate one.
  ['localhost.evil.example.com', true],
  ['my-localhost.com', true],
  ['not-127.0.0.1.example.com', true],
];

// Inputs that are not usable hostnames at all. Kept separate from CASES because the
// HTML predicate is only ever handed `location.hostname` (always a string), whereas the
// exported function is public API and must be total.
const UNUSABLE: unknown[] = [undefined, null, '', '   ', 42, {}, [], true];

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1 — the pure rule
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. shouldLoadAnalytics — the host rule');

for (const [host, expected] of CASES) {
  const actual = shouldLoadAnalytics(host);
  ok(actual === expected, `shouldLoadAnalytics(${JSON.stringify(host)}) => ${actual}, expected ${expected}`);
}

// Fail CLOSED: an environment we cannot identify must not report under an unknown
// identity. Silence is recoverable; polluted data is not.
for (const bad of UNUSABLE) {
  let threw = false;
  let actual: boolean | undefined;
  try { actual = shouldLoadAnalytics(bad); } catch { threw = true; }
  ok(!threw, `shouldLoadAnalytics(${JSON.stringify(bad)}) must not throw`);
  ok(actual === false, `shouldLoadAnalytics(${JSON.stringify(bad)}) must fail closed (false), got ${actual}`);
}

// The constants the HTML is pinned against.
ok(GA_MEASUREMENT_ID === 'G-89TM5X68RR', `GA_MEASUREMENT_ID is ${GA_MEASUREMENT_ID}`);
ok(
  GA_MEASUREMENT_ID_SECONDARY === 'G-4LELMBZWPZ',
  `GA_MEASUREMENT_ID_SECONDARY is ${GA_MEASUREMENT_ID_SECONDARY}`,
);
ok(GA_CONFIG.anonymize_ip === true, 'GA_CONFIG.anonymize_ip must be true');
ok(GA_CONFIG.allow_google_signals === false, 'GA_CONFIG.allow_google_signals must be false');
ok(
  GA_CONFIG.allow_ad_personalization_signals === false,
  'GA_CONFIG.allow_ad_personalization_signals must be false',
);
ok(LOCAL_ANALYTICS_HOSTS.length >= 3, 'LOCAL_ANALYTICS_HOSTS must cover localhost + both loopbacks');

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2 — the drift pin: execute the rule that actually ships
// ─────────────────────────────────────────────────────────────────────────────
console.log('2. index.html inline rule agrees with the shared function');

const APPS = [
  {
    name: 'play-web',
    html: join(ROOT, 'apps', 'play-web', 'index.html'),
    // Firebase default hosts that must bounce to the canonical domain, and where to.
    canonical: 'rush-point.com',
    defaultHosts: ['rushpoint-play.web.app', 'rushpoint-play.firebaseapp.com'],
  },
  {
    name: 'creator-web',
    html: join(ROOT, 'apps', 'creator-web', 'index.html'),
    canonical: 'creator.rush-point.com',
    defaultHosts: ['rushpoint-creator.web.app', 'rushpoint-creator.firebaseapp.com'],
  },
];

/** The inline analytics <script> body, identified by the marker comment above it. */
function analyticsScriptBody(html: string): string | null {
  const marker = html.indexOf('Google tag (gtag.js)');
  if (marker === -1) return null;
  const open = html.indexOf('<script>', marker);
  if (open === -1) return null;
  const close = html.indexOf('</script>', open);
  if (close === -1) return null;
  return html.slice(open + '<script>'.length, close);
}

/**
 * Recover the host predicate from the shipped snippet and run it for real.
 *
 * The snippet returns EARLY when analytics must NOT load, so the extracted regex
 * literal is the "is excluded" test and the verdict is its negation. We evaluate the
 * regex the HTML actually contains — not a re-typed copy — which is what makes this a
 * pin rather than a second opinion.
 */
function inlineVerdictFactory(body: string, app: string): (h: string) => boolean {
  const m = body.match(/if\s*\(\s*(\/[^\n]*?\/[gimsuy]*)\s*\.test\(/);
  assert.ok(m, `[${app}] could not locate the host-exclusion regex in the inline snippet`);
  const fn = new Function('h', `return !(${m![1]}).test(String(h).toLowerCase().replace(/\\.$/, ''));`);
  return fn as (h: string) => boolean;
}

for (const app of APPS) {
  let html = '';
  try { html = readFileSync(app.html, 'utf8'); } catch { /* reported below */ }
  ok(html.length > 0, `[${app.name}] index.html must be readable`);
  if (!html) continue;

  const body = analyticsScriptBody(html);
  ok(body !== null, `[${app.name}] index.html must contain the marked analytics <script>`);
  if (!body) continue;

  let verdict: (h: string) => boolean;
  try {
    verdict = inlineVerdictFactory(body, app.name);
  } catch (e) {
    ok(false, `[${app.name}] ${(e as Error).message}`);
    continue;
  }

  for (const [host, expected] of CASES) {
    if (typeof host !== 'string') continue; // location.hostname is always a string
    let actual: boolean | undefined;
    try { actual = verdict(host); } catch { /* falls through to the assertion */ }
    ok(
      actual === expected,
      `[${app.name}] inline rule disagrees for ${JSON.stringify(host)}: got ${actual}, shared says ${expected}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3 — the tag is present, hardened, and loaded imperatively
// ─────────────────────────────────────────────────────────────────────────────
console.log('3. the tag is present and privacy-hardened in both apps');

for (const app of APPS) {
  let html = '';
  try { html = readFileSync(app.html, 'utf8'); } catch { /* reported in group 2 */ }
  if (!html) continue;

  ok(html.includes(GA_MEASUREMENT_ID), `[${app.name}] must carry the measurement id`);
  ok(html.includes(GA_MEASUREMENT_ID_SECONDARY), `[${app.name}] must carry the secondary measurement id`);
  ok(html.includes('googletagmanager.com'), `[${app.name}] must reference googletagmanager.com`);
  for (const key of Object.keys(GA_CONFIG)) {
    ok(html.includes(key), `[${app.name}] must configure ${key}`);
  }
  // The hardening must be ON as written, not merely mentioned.
  ok(/anonymize_ip\s*:\s*true/.test(html), `[${app.name}] anonymize_ip must be true`);
  ok(/allow_google_signals\s*:\s*false/.test(html), `[${app.name}] allow_google_signals must be false`);
  ok(
    /allow_ad_personalization_signals\s*:\s*false/.test(html),
    `[${app.name}] allow_ad_personalization_signals must be false`,
  );

  // THE point of the imperative loader: a static <script async src="…gtag/js"> fires
  // the request before any JS can decide, so an excluded host would still contact
  // Google. "No request at all on localhost" is only achievable this way.
  ok(
    !/<script[^>]*\ssrc=["']https:\/\/www\.googletagmanager\.com/.test(html),
    `[${app.name}] the gtag script must be created imperatively, never a static <script src>`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4 — the charset declaration still wins the first 1024 bytes
// ─────────────────────────────────────────────────────────────────────────────
console.log('4. <meta charset> precedes the tag and stays in the first 1024 bytes');

for (const app of APPS) {
  let html = '';
  try { html = readFileSync(app.html, 'utf8'); } catch { /* reported in group 2 */ }
  if (!html) continue;

  const charsetAt = html.indexOf('<meta charset');
  const tagAt = html.indexOf('Google tag (gtag.js)');
  ok(charsetAt !== -1, `[${app.name}] must declare <meta charset>`);
  ok(tagAt !== -1, `[${app.name}] must contain the analytics tag`);
  if (charsetAt === -1 || tagAt === -1) continue;

  ok(charsetAt < tagAt, `[${app.name}] <meta charset> must come BEFORE the analytics tag`);
  // Byte offset, not character offset — the 1024 limit is bytes, and these files
  // contain non-ASCII.
  const charsetByte = Buffer.byteLength(html.slice(0, charsetAt), 'utf8');
  ok(
    charsetByte < 1024,
    `[${app.name}] <meta charset> must start within the first 1024 bytes (starts at ${charsetByte})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4b — the canonical-host redirect, and that it runs BEFORE analytics
// ─────────────────────────────────────────────────────────────────────────────
console.log('4b. canonical-host redirect precedes the analytics tag');

for (const app of APPS) {
  let html = '';
  try { html = readFileSync(app.html, 'utf8'); } catch { /* reported in group 2 */ }
  if (!html) continue;

  const redirectAt = html.indexOf('Canonical host redirect');
  ok(redirectAt !== -1, `[${app.name}] must carry the canonical-host redirect`);
  if (redirectAt === -1) continue;

  // ORDERING IS THE POINT. A redirect placed after gtag would fire a page_view
  // against the non-canonical hostname before navigating away, which is exactly
  // the split-analytics problem the redirect exists to prevent.
  const tagAt = html.indexOf('Google tag (gtag.js)');
  ok(
    tagAt === -1 || redirectAt < tagAt,
    `[${app.name}] the canonical redirect must run BEFORE the analytics tag, or it records a hit on the wrong host`,
  );

  // Every Firebase default host must be mapped, or that door stays open.
  for (const host of app.defaultHosts) {
    ok(html.includes(`'${host}'`), `[${app.name}] must redirect the default host ${host}`);
  }
  ok(html.includes(`'${app.canonical}'`), `[${app.name}] must target the canonical host ${app.canonical}`);

  // replace(), not assign(): the non-canonical URL must not enter history, or
  // Back bounces the visitor straight back out to it.
  ok(
    /location\.replace\(/.test(html),
    `[${app.name}] the redirect must use location.replace so Back does not bounce`,
  );
  // A deep link (?game=<id>, #signin) must survive the hop.
  ok(
    /location\.pathname\s*\+\s*location\.search\s*\+\s*location\.hash/.test(html),
    `[${app.name}] the redirect must preserve pathname + search + hash`,
  );
  // The canonical host must never map to itself — that is an infinite reload.
  ok(
    !new RegExp(`'${app.canonical.replace(/\./g, '\\.')}'\\s*:`).test(html),
    `[${app.name}] the canonical host must not be a redirect SOURCE (infinite loop)`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5 — the PWA shell cache was invalidated
// ─────────────────────────────────────────────────────────────────────────────
console.log('5. the play-web service-worker shell cache was bumped');

{
  const swPath = join(ROOT, 'apps', 'play-web', 'public', 'sw.js');
  let sw = '';
  try { sw = readFileSync(swPath, 'utf8'); } catch { /* reported below */ }
  ok(sw.length > 0, 'sw.js must be readable');

  if (sw) {
    const m = sw.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
    ok(!!m, 'sw.js must declare a CACHE constant');
    // The SW deletes every cache key !== CACHE on activate, so the bump IS the
    // mechanism that pushes the tagged shell to already-installed devices.
    ok(
      !!m && m[1] !== 'rushpoint-play-v3',
      `sw.js CACHE must be bumped off rushpoint-play-v3 (found ${m?.[1]}) or installed PWAs keep the TAGLESS shell`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6 — the Privacy Policy tells the truth, in both languages
// ─────────────────────────────────────────────────────────────────────────────
console.log('6. the privacy policy discloses Google Analytics (HE + EN)');

{
  const privacy = LEGAL_DOCS.privacy;

  for (const lang of ['he', 'en'] as const) {
    const body = privacy[lang].body;
    ok(body.includes('Google Analytics'), `[${lang}] privacy policy must name Google Analytics`);
    ok(body.includes('_ga'), `[${lang}] privacy policy must disclose the _ga cookie`);
  }

  // The claims that become FALSE the moment the tag ships. These are the whole reason
  // the legal edit is in scope for this change rather than deferred.
  ok(
    !/No tracking cookies, advertising analytics/i.test(privacy.en.body),
    '[en] the "no tracking cookies / no analytics" claim must be gone',
  );
  ok(
    !privacy.en.body.includes('We use **essential cookies only:**'),
    '[en] the "essential cookies only" claim must be gone',
  );
  ok(
    !privacy.he.body.includes('אין שימוש בעוגיות מעקב'),
    '[he] the Hebrew "no tracking cookies" claim must be gone',
  );
  ok(
    !privacy.he.body.includes('אנו משתמשים **בעוגיות חיוניות בלבד:**'),
    '[he] the Hebrew "essential cookies only" claim must be gone',
  );

  // legal-page-polish forbids markdown tables in this document; keep it true.
  for (const lang of ['he', 'en'] as const) {
    const section = privacy[lang].body.split(/^## /m).find((s) => /^9\./.test(s.trim())) ?? '';
    ok(!section.includes('|'), `[${lang}] section 9 must not use markdown table pipes`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '\x1b[32m✓' : '\x1b[31m✗'} analytics gate: ${passed} passed, ${failed} failed\x1b[0m\n`);
if (failed > 0) process.exit(1);
