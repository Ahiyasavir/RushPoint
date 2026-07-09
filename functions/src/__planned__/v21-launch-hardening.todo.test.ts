// ⚠️ RED-PHASE BLUEPRINT — NOT COVERAGE. The test.todo() lines below are the
// intended future RED tests for the mapped Appendix B roadmap rows; they assert
// nothing yet. Do not read this file's existence as test coverage. When a row is
// started, convert its todos into real failing tests first (see openspec/config.yaml).
// ───────────────────────────────────────────────────────────────────────────
// LAUNCH-READINESS BLUEPRINT — production hardening, trust & compliance
// ───────────────────────────────────────────────────────────────────────────
// These close the gap between "feature-complete" and "safe to put in front of
// the public". One item already SHIPS as a real test (security rules —
// scripts/test-rules.mjs, run via `npm run test:rules`); the rest are RED
// targets. See v21-data-and-scalability.todo.test.ts for how to flip a todo into
// a real test. Maps to TECH_SPEC.md §26 + Appendix B rows 26–36.
import { describe, test } from 'vitest';

describe('Appendix B #26 — security & storage rules verification suite [§26] ✅ SHIPPED', () => {
  // Implemented for real in scripts/test-rules.mjs (`npm run test:rules`, emulator-bound,
  // like e2e). Listed here for traceability. Remaining work is the wiring todo below.
  test.todo('[ops] run `npm run test:rules` in CI / pre-deploy so a rules regression blocks release');
});

describe('Appendix B #27 — App Check on every callable + Storage [§26]', () => {
  test.todo('[pure] callable wrapper rejects requests without a valid App Check token (enforce: true)');
  test.todo('[e2e] a request from outside the real apps (no attestation) is denied before any logic runs');
  test.todo('[ui] creator-web (reCAPTCHA v3) + play-web initialize App Check at startup');
  test.todo('[e2e] App Check pairs with rate-limit (#19): scripted joinRun/completeTask abuse is blocked');
  test.todo('[ops] Storage uploads also require App Check (no raw bucket writes from a script)');
});

describe('Appendix B #28 — production observability (errors, logs, alerts, backups) [§26]', () => {
  test.todo('[ui] the telemetry seam (setCrashReporter) is wired to a real sink (Sentry) at startup in prod');
  test.todo('[pure] CF errors emit structured logs with run/owner context (no PII) and a severity');
  test.todo('[ops] an alert fires when CF error rate or stripeWebhook failures exceed a threshold');
  test.todo('[ops] scheduled daily Firestore export (backup) runs; restore procedure is documented (DR)');
  test.todo('[ui] uptime/health monitoring pings a public health endpoint and pages on outage');
});

describe('Appendix B #29 — transactional email (receipts, reset, run summaries) [§26]', () => {
  test.todo('[pure] provider adapter (e.g. SendGrid) is server-only; key in functions/.env, never client');
  test.todo('[e2e] a successful purchase/Pro charge emails a receipt/invoice (Israeli tax compliance)');
  test.todo('[e2e] finalizeRun can email the creator a run summary (results + share links)');
  test.todo('[pure] every email is idempotent (no duplicate sends on webhook/retry) and logs a delivery record');
  test.todo('[ui] password-reset email flow works for email/password creators');
});

describe('Appendix B #30 — operator mailing-list export [§26.A] (export ✅ shipped; consent capture 🔭)', () => {
  // NOT an in-app sender. scripts/export-emails.mjs (`npm run emails:export`) prints comma-separated
  // lists to paste into a normal email BCC. The export + its pure segmentation SHIP and are covered
  // for real in scripts/test-email-export.ts (`npm test`); the todos below are the consent data
  // model + capture UI + unsubscribe that feed it correctly.
  test('[pure] segmentation behaviors ✅ SHIPPED in scripts/test-email-export.ts', () => {
    // 3 lists (marketing / updates-only / combined = 1 ∪ 2); comma-separated + de-duped + sorted;
    // no-consent + no-email + minors EXCLUDED and counted. Asserted there, run by the unit aggregator.
  });
  test.todo('[ui] signup/Settings captures marketingConsent + updatesConsent (both default OFF, opt-IN)');
  test.todo('[e2e] an unsubscribe path flips the flags off so the next export drops that address (idempotent)');
  test.todo('[ops] --prod path requires a service-account key; emulator is the default target');
});

describe('Appendix B #31 — minors & guardian consent + age gate [§26]', () => {
  // Launch wedges (bar-mitzvah, youth groups) skew under-18 — a real legal gate in IL.
  test.todo('[pure] join registration captures age band / guardian-consent flag where required by the game');
  test.todo('[e2e] a run flagged "may include minors" requires guardian consent before a participant can play');
  test.todo('[pure] minors\' PII gets the same 90-day prune + is excluded from marketing broadcasts entirely');
  test.todo('[ui] privacy policy + terms cover minors; consent copy is age-appropriate and bilingual');
});

describe('Appendix B #32 — accessibility (WCAG 2.1 AA) [§26]', () => {
  test.todo('[ui] axe automated scan of Join/Play/Final/Dashboard/Builder reports 0 critical violations');
  test.todo('[ui] color contrast ≥ 4.5:1 for text; brand-color surfaces keep a contrast-safe foreground');
  test.todo('[ui] full keyboard nav + visible focus order; tap targets ≥ 44px');
  test.todo('[ui] screen-reader labels on icons/controls; live-ops banners use aria-live');
  test.todo('[ui] honors prefers-reduced-motion (shared with the game-juice work)');
});

describe('Appendix B #33 — load / concurrency soak test [§26]', () => {
  test.todo('[e2e] 50+ teams concurrently completeTask/requestNextTask: no lost updates, no contention errors');
  test.todo('[e2e] scores/leaderboard remain consistent under concurrent finalize/refresh');
  test.todo('[e2e] validates the taskStates subcollection (#1) removes the stages-array write contention under load');
  test.todo('[ops] p95 callable latency stays within budget at target concurrency');
});

describe('Appendix B #34 — launch smoke + health-check + kill-switch + flags [§26]', () => {
  test.todo('[e2e] getHealth callable returns ok (auth reachable, Firestore reachable, version stamp)');
  test.todo('[ops] post-deploy smoke script verifies staging: callables reachable + rules deployed');
  test.todo('[e2e] a maintenance kill-switch flag puts the app in read-only/maintenance mode gracefully');
  test.todo('[pure] feature flags gate risky launches (self-paced, vision, push) for safe staged rollout');
});

describe('Appendix B #35 — creator onboarding / empty states / first-run [§26]', () => {
  test.todo('[ui] a brand-new creator sees a guided first-run (create from template → launch) not a blank dashboard');
  test.todo('[ui] every list (games, gallery, wallet, teams) has a helpful empty state with a next action');
  test.todo('[ui] the first launch explains free-run credits and what happens next');
});

describe('Appendix B #36 — SEO, sitemap, cookie consent, in-app feedback [§26]', () => {
  test.todo('[ui] marketing routes (landing, ?game=, ?board=) have correct title/description/OG + canonical');
  test.todo('[ui] a sitemap + robots are served; public game promo pages are indexable');
  test.todo('[ui] a cookie/consent banner gates any non-essential analytics (consent-first)');
  test.todo('[ui] an in-app feedback/support entry point routes messages to the operator');
});
