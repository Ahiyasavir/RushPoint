// ⚠️ RED-PHASE BLUEPRINT — NOT COVERAGE. The test.todo() lines below are the
// intended future RED tests for the mapped Appendix B roadmap rows; they assert
// nothing yet. Do not read this file's existence as test coverage. When a row is
// started, convert its todos into real failing tests first (see openspec/config.yaml).
// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Free mode (payments & subscriptions off for launch)
// ───────────────────────────────────────────────────────────────────────────
// Each test.todo becomes a real failing test when implemented via /opsx:apply.
// OpenSpec change: openspec/changes/free-mode-no-payments/
// A single PAYMENTS_ENABLED flag (default false) gates ALL billing — nothing is deleted.
// Lane tags: [pure] · [e2e] · [ui]
import { describe, test } from 'vitest';

describe('free-mode-no-payments — PAYMENTS_ENABLED=false makes the whole app free', () => {
  // The flag itself
  test.todo('[pure] PAYMENTS_ENABLED defaults to false at launch');
  test.todo('[pure] flipping PAYMENTS_ENABLED to true restores existing billing with no other code change');

  // resolveLaunchBilling
  test.todo('[pure] resolveLaunchBilling(false, anyWallet) → free launch, consume:"none" (no credit/Pro needed)');
  test.todo('[pure] resolveLaunchBilling(true, proWallet) → billingType "pro"');
  test.todo('[pure] resolveLaunchBilling(true, freeWallet w/ credits) → consumes a credit');
  test.todo('[pure] resolveLaunchBilling(true, freeWallet, 0 credits, no free run) → refuse (existing logic intact)');

  // isFeatureUnlocked
  test.todo('[pure] isFeatureUnlocked(false, anyWallet, "analytics"|"white_label"|"replay") → true (all unlocked)');
  test.todo('[pure] isFeatureUnlocked(true, nonProWallet, "analytics") → false (Pro gate restored)');

  // Launch is always free
  test.todo('[e2e] payments off: a 0-credit free-plan creator launches a run successfully (billingType "free")');
  test.todo('[e2e] payments off: launchRun performs NO wallet read or decrement');

  // Buying disabled
  test.todo('[e2e] payments off: purchaseCredits → failed-precondition "payments_disabled" (bilingual)');
  test.todo('[e2e] payments off: subscribePro → failed-precondition "payments_disabled"');
  test.todo('[e2e] payments off: stripeWebhook is inert (no wallet mutation)');
  test.todo('[e2e] getWalletStatus reports paymentsEnabled:false so clients render free mode');

  // Code retained (not deleted)
  test.todo('[pure] wallet ledger, Stripe webhook, and billing callables still exist behind the flag');

  // UI hidden
  test.todo('[ui] payments off: WalletPage route, pricing, "buy credits", "upgrade to Pro" CTAs are not rendered');
  test.todo('[ui] payments off: participant finish footer renders with no upsell line');
  test.todo('[ui] payments off: analytics / white-label / replay open for every creator with no upsell chip');
});
