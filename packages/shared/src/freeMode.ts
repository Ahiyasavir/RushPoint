// Free mode — a single flag that gates ALL billing (change: free-mode-no-payments).
//
// When PAYMENTS_ENABLED is false (the launch default) the whole app is free:
// every launch is a free run with no wallet consumption and no refusal, and every
// Pro-gated feature is unlocked for everyone. Flipping the flag to true restores
// the existing credit / Pro behavior with NO other code change — nothing here is
// deleted, only short-circuited. Both resolvers are pure so they can be unit
// tested with no emulator (scripts/test-free-mode.ts).
import {
  FREE_RUNS_LIFETIME,
  FREE_PARTICIPANTS_PER_FREE_RUN,
  PRO_DEFAULT_MAX_PARTICIPANTS,
  EVENT_PACKAGES,
} from './types';

/** Master switch. Default false for launch; set true to restore billing. */
export const PAYMENTS_ENABLED = false;

/** Per-run participant ceiling while the whole app is free. */
export const FREE_MODE_MAX_PARTICIPANTS = 50;

/** The subset of a wallet that launch-billing depends on. */
export interface LaunchBillingWallet {
  plan?: 'free' | 'pro';
  eventCredits?: number;
  lifetimeFreeRunsUsed?: number;
  bonusFreeRuns?: number;
  lastPackageMaxParticipants?: number;
}

/** Discriminated launch-billing outcome. `consume` tells the server what (if
 *  anything) to decrement; `ok:false` means refuse for billing reasons. */
export type LaunchBilling =
  | {
      ok: true;
      billingType: 'free' | 'credit' | 'pro';
      maxParticipants: number;
      consume: 'none' | 'free_run' | 'credit';
    }
  | { ok: false; reason: 'no_credits' };

/**
 * Decide how a run is billed. Payments off → always a free launch with no
 * consumption. Payments on → the existing pro → free-run → credit → refuse
 * ladder (mirrors functions/src/runs/index.ts launchRun).
 */
export function resolveLaunchBilling(
  paymentsEnabled: boolean,
  wallet: LaunchBillingWallet,
): LaunchBilling {
  if (!paymentsEnabled) {
    return { ok: true, billingType: 'free', maxParticipants: FREE_MODE_MAX_PARTICIPANTS, consume: 'none' };
  }

  const plan = wallet.plan ?? 'free';
  const lifetimeUsed = wallet.lifetimeFreeRunsUsed ?? 0;
  const freeCap = FREE_RUNS_LIFETIME + (wallet.bonusFreeRuns ?? 0);
  const credits = wallet.eventCredits ?? 0;

  if (plan === 'pro') {
    return { ok: true, billingType: 'pro', maxParticipants: PRO_DEFAULT_MAX_PARTICIPANTS, consume: 'none' };
  }
  if (lifetimeUsed < freeCap) {
    return { ok: true, billingType: 'free', maxParticipants: FREE_PARTICIPANTS_PER_FREE_RUN, consume: 'free_run' };
  }
  if (credits > 0) {
    const maxParticipants = wallet.lastPackageMaxParticipants ?? EVENT_PACKAGES.starter.maxParticipants;
    return { ok: true, billingType: 'credit', maxParticipants, consume: 'credit' };
  }
  return { ok: false, reason: 'no_credits' };
}

/** Features that are Pro-gated when payments are on. */
export type GatedFeature = 'analytics' | 'white_label' | 'replay';

/**
 * Whether a Pro-gated feature is available. Payments off → everything is
 * unlocked for everyone. Payments on → the normal Pro check (plan === 'pro').
 */
export function isFeatureUnlocked(
  paymentsEnabled: boolean,
  wallet: { plan?: string; proExpiresAt?: string | null },
  _feature: GatedFeature,
): boolean {
  if (!paymentsEnabled) return true;
  return wallet.plan === 'pro';
}
