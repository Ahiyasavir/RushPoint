// Pure-logic tests for free mode (change: free-mode-no-payments).
// A single PAYMENTS_ENABLED flag gates ALL billing. When it is false the whole
// app is free: launches never consume a credit/Pro and never refuse, and every
// Pro-gated feature is unlocked. When true, the existing credit/Pro behavior is
// restored unchanged. These two pure resolvers are the TDD lever. No emulator.
//   npx tsx scripts/test-free-mode.ts
import {
  PAYMENTS_ENABLED,
  FREE_MODE_MAX_PARTICIPANTS,
  TEST_DRIVE_MAX_PARTICIPANTS,
  resolveLaunchBilling,
  isFeatureUnlocked,
  FREE_RUNS_LIFETIME,
  PRO_DEFAULT_MAX_PARTICIPANTS,
  MAX_RUN_DEVICES,
} from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── The flag itself ──────────────────────────────────────────────────────────
{
  check('PAYMENTS_ENABLED defaults to false at launch', PAYMENTS_ENABLED === false,
    `value=${PAYMENTS_ENABLED}`);
  check('FREE_MODE_MAX_PARTICIPANTS is a positive number', typeof FREE_MODE_MAX_PARTICIPANTS === 'number' && FREE_MODE_MAX_PARTICIPANTS > 0,
    `value=${FREE_MODE_MAX_PARTICIPANTS}`);
  // The two per-run ceilings count different things (teams vs phones) but joinRun
  // checks the participant cap FIRST — so if it ever drops below the phone
  // ceiling, MAX_RUN_DEVICES becomes unreachable in individual mode (1 player ==
  // 1 team) and raising it would silently do nothing. Pin the ordering.
  check('FREE_MODE_MAX_PARTICIPANTS does not sit below MAX_RUN_DEVICES',
    FREE_MODE_MAX_PARTICIPANTS >= MAX_RUN_DEVICES,
    `participants=${FREE_MODE_MAX_PARTICIPANTS} devices=${MAX_RUN_DEVICES}`);
}

// ── resolveLaunchBilling — payments OFF → always a free launch, no consume ────
{
  // Even a worst-case wallet (free plan, all lifetime free runs used, 0 credits)
  // must launch free with no consumption when payments are off.
  const worst = { plan: 'free' as const, eventCredits: 0, lifetimeFreeRunsUsed: FREE_RUNS_LIFETIME };
  const r = resolveLaunchBilling(false, worst);
  check('payments off → ok', r.ok === true);
  check('payments off → billingType "free"', r.ok && r.billingType === 'free');
  check('payments off → consume "none"', r.ok && r.consume === 'none');
  check('payments off → maxParticipants is FREE_MODE_MAX_PARTICIPANTS',
    r.ok && r.maxParticipants === FREE_MODE_MAX_PARTICIPANTS);

  const empty = resolveLaunchBilling(false, {});
  check('payments off → empty wallet still launches free', empty.ok === true && empty.consume === 'none');
}

// ── resolveLaunchBilling — payments ON → existing pro/free-run/credit/refuse ──
{
  const pro = resolveLaunchBilling(true, { plan: 'pro' });
  check('payments on, pro → billingType "pro"', pro.ok === true && pro.billingType === 'pro');
  check('payments on, pro → maxParticipants PRO_DEFAULT', pro.ok && pro.maxParticipants === PRO_DEFAULT_MAX_PARTICIPANTS);

  const freeRun = resolveLaunchBilling(true, { plan: 'free', lifetimeFreeRunsUsed: 0, eventCredits: 0 });
  check('payments on, lifetime free run available → consume "free_run"',
    freeRun.ok === true && freeRun.consume === 'free_run' && freeRun.billingType === 'free');

  const credit = resolveLaunchBilling(true, { plan: 'free', lifetimeFreeRunsUsed: FREE_RUNS_LIFETIME, eventCredits: 2 });
  check('payments on, no free runs but credits → consume "credit"',
    credit.ok === true && credit.consume === 'credit' && credit.billingType === 'credit');

  const refuse = resolveLaunchBilling(true, { plan: 'free', lifetimeFreeRunsUsed: FREE_RUNS_LIFETIME, eventCredits: 0 });
  check('payments on, no free runs and no credits → refuse', refuse.ok === false);
}

// ── resolveLaunchBilling — testDrive short-circuits FIRST, wallet-independent ──
// (change: test-drive-mode) A test drive is free, capped at 2, consumes nothing,
// and returns the SAME decision regardless of the wallet or the payments flag.
{
  check('TEST_DRIVE_MAX_PARTICIPANTS is 2', TEST_DRIVE_MAX_PARTICIPANTS === 2,
    `value=${TEST_DRIVE_MAX_PARTICIPANTS}`);

  const expectTest = (r: ReturnType<typeof resolveLaunchBilling>, label: string): void => {
    check(`${label} → ok`, r.ok === true);
    check(`${label} → billingType "test"`, r.ok && r.billingType === 'test');
    check(`${label} → consume "none"`, r.ok && r.consume === 'none');
    check(`${label} → maxParticipants 2`, r.ok && r.maxParticipants === TEST_DRIVE_MAX_PARTICIPANTS);
  };

  // (a) payments off + empty wallet
  expectTest(resolveLaunchBilling(false, {}, { testDrive: true }), 'testDrive, payments off, empty wallet');
  // (b) payments on + zero-credit free wallet
  expectTest(
    resolveLaunchBilling(true, { plan: 'free', eventCredits: 0, lifetimeFreeRunsUsed: FREE_RUNS_LIFETIME }, { testDrive: true }),
    'testDrive, payments on, zero-credit wallet',
  );
  // (c) payments on + active-pro wallet
  expectTest(resolveLaunchBilling(true, { plan: 'pro' }, { testDrive: true }), 'testDrive, payments on, pro wallet');

  // testDrive absent/false leaves every existing decision unchanged.
  const proNormal = resolveLaunchBilling(true, { plan: 'pro' });
  const proFalse = resolveLaunchBilling(true, { plan: 'pro' }, { testDrive: false });
  check('testDrive:false is identical to omitting opts (pro)',
    JSON.stringify(proNormal) === JSON.stringify(proFalse));
  const offNormal = resolveLaunchBilling(false, {});
  const offNoOpts = resolveLaunchBilling(false, {}, {});
  check('empty opts is identical to omitting opts (payments off)',
    JSON.stringify(offNormal) === JSON.stringify(offNoOpts));
}

// ── isFeatureUnlocked — off unlocks everything; on restores the Pro gate ──────
{
  const features = ['analytics', 'white_label', 'replay'] as const;
  for (const f of features) {
    check(`payments off → ${f} unlocked for non-Pro`, isFeatureUnlocked(false, { plan: 'free' }, f) === true);
  }
  check('payments on → analytics locked for non-Pro', isFeatureUnlocked(true, { plan: 'free' }, 'analytics') === false);
  check('payments on → analytics unlocked for Pro', isFeatureUnlocked(true, { plan: 'pro' }, 'analytics') === true);
  check('payments on → white_label locked for non-Pro', isFeatureUnlocked(true, { plan: 'free' }, 'white_label') === false);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-free-mode)`);
process.exit(failures === 0 ? 0 : 1);
