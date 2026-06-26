// ─── Payments callables (Event Credits model) ────────────────────────────────
// Creators buy whole-event "Event Credits" (packages) or a "Creator Pro"
// subscription via Stripe Checkout. A webhook confirms payment and credits the
// wallet. In emulator mode every purchase is granted directly so local dev +
// e2e work without Stripe keys.

import * as functions from 'firebase-functions';
import { db } from '../firebase';
import * as admin from 'firebase-admin';
import {
  type Wallet,
  type WalletStatus,
  type EventPackageId,
  EVENT_PACKAGES,
  FREE_RUNS_LIFETIME,
  REFERRAL_BONUS_FREE_RUNS,
  PRO_MONTHLY_ILS,
  PRO_ANNUAL_ILS,
  PAYMENTS_ENABLED,
} from '@rushpoint/shared';

const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}

// While payments are off (free mode) every buying path is rejected with a typed,
// bilingual error. The billing code stays present (dark) — flipping the flag
// re-enables it with no other change.
function requirePaymentsEnabled(): void {
  if (!PAYMENTS_ENABLED) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Payments are currently disabled — RushPoint is free. / התשלומים מושבתים כעת — RushPoint חינמי.',
    );
  }
}

function walletRef(uid: string) {
  return db.doc(`wallets/${uid}`);
}

function freshWallet(uid: string): Wallet {
  return {
    uid,
    eventCredits: 0,
    lifetimeFreeRunsUsed: 0,
    bonusFreeRuns: 0,
    plan: 'free',
    proExpiresAt: null,
    stripeSubscriptionId: null,
    updatedAt: new Date().toISOString(),
  };
}

// Reads a wallet, normalizing legacy/missing fields to the Event-Credits shape
// so every caller can rely on the defaults without repeating ?? everywhere.
async function readWallet(uid: string): Promise<Wallet> {
  const snap = await walletRef(uid).get();
  if (!snap.exists) return freshWallet(uid);
  const w = snap.data() as Partial<Wallet>;
  return {
    uid,
    eventCredits: w.eventCredits ?? 0,
    lifetimeFreeRunsUsed: w.lifetimeFreeRunsUsed ?? 0,
    bonusFreeRuns: w.bonusFreeRuns ?? 0,
    plan: w.plan ?? 'free',
    proExpiresAt: w.proExpiresAt ?? null,
    stripeCustomerId: w.stripeCustomerId,
    stripeSubscriptionId: w.stripeSubscriptionId ?? null,
    lastPackageMaxParticipants: w.lastPackageMaxParticipants,
    processedSessions: w.processedSessions,
    updatedAt: w.updatedAt ?? new Date().toISOString(),
    referredBy: w.referredBy,
    referralClaimedAt: w.referralClaimedAt,
    referralCount: w.referralCount,
  };
}

function freeRunsRemaining(w: Wallet): number {
  return Math.max(0, FREE_RUNS_LIFETIME + (w.bonusFreeRuns ?? 0) - w.lifetimeFreeRunsUsed);
}

function stripeClient() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new functions.https.HttpsError('internal', 'Stripe not configured');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require('stripe');
  return new Stripe(stripeKey, { apiVersion: '2023-10-16' });
}

const APP_URL = () => process.env.APP_URL ?? 'http://localhost:5180';


// ─── getWallet ────────────────────────────────────────────────────────────────
// Returns the raw wallet (creating a fresh one on first access). Prefer
// getWalletStatus on the client; this is kept for internal/diagnostic use.

export const getWallet = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await walletRef(uid).get();
  if (!snap.exists) {
    const wallet = freshWallet(uid);
    await walletRef(uid).set(wallet);
    return { wallet };
  }
  return { wallet: await readWallet(uid) };
});


// ─── getWalletStatus ──────────────────────────────────────────────────────────
// Single client-facing snapshot: plan, credits, and free runs left.

export const getWalletStatus = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);
  const w = await readWallet(uid);
  const status: WalletStatus = {
    plan: w.plan,
    proExpiresAt: w.proExpiresAt ?? null,
    eventCredits: w.eventCredits,
    freeRunsRemaining: freeRunsRemaining(w),
    lastPackageMaxParticipants: w.lastPackageMaxParticipants,
    paymentsEnabled: PAYMENTS_ENABLED,
  };
  return status;
});


// ─── purchaseCredits ──────────────────────────────────────────────────────────
// Buy an Event-Credits package. Emulator grants directly; production returns a
// Stripe Checkout URL and the webhook credits the wallet on completion.

export const purchaseCredits = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  requirePaymentsEnabled();
  const { packageId } = data as { packageId: EventPackageId };
  const pkg = EVENT_PACKAGES[packageId];
  if (!pkg) throw new functions.https.HttpsError('invalid-argument', 'Unknown package');

  if (EMULATOR) {
    const now = new Date().toISOString();
    const txRef = walletRef(uid).collection('transactions').doc();
    await db.runTransaction(async (t) => {
      t.set(walletRef(uid), {
        uid,
        eventCredits: admin.firestore.FieldValue.increment(pkg.credits),
        lastPackageMaxParticipants: pkg.maxParticipants,
        updatedAt: now,
      }, { merge: true });
      t.set(txRef, {
        id: txRef.id, type: 'topup_credits', credits: pkg.credits,
        maxParticipantsPerRun: pkg.maxParticipants, packageId, priceILS: pkg.priceILS,
        description: `Bought ${pkg.credits} Event Credit${pkg.credits > 1 ? 's' : ''} (${packageId})`,
        stripePaymentIntentId: `mock_${txRef.id}`, createdAt: now,
      });
    });
    return { checkoutUrl: null, mock: true, credits: pkg.credits };
  }

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'ils',
        unit_amount: pkg.priceILS * 100,
        product_data: { name: `RushPoint Event Credits — ${packageId}` },
      },
    }],
    success_url: `${APP_URL()}/wallet?purchase=success`,
    cancel_url: `${APP_URL()}/wallet?purchase=cancel`,
    metadata: {
      uid, type: 'event_credits', packageId,
      credits: String(pkg.credits),
      maxParticipantsPerRun: String(pkg.maxParticipants),
    },
  });
  return { checkoutUrl: session.url };
});


// ─── subscribePro ─────────────────────────────────────────────────────────────
// Start a Creator Pro subscription (monthly/annual). Emulator activates it
// directly; production returns a Stripe subscription Checkout URL.

export const subscribePro = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  requirePaymentsEnabled();
  const interval = (data as { interval?: string })?.interval === 'year' ? 'year' : 'month';
  const priceILS = interval === 'year' ? PRO_ANNUAL_ILS : PRO_MONTHLY_ILS;

  if (EMULATOR) {
    const start = new Date();
    const expires = new Date(start);
    if (interval === 'year') expires.setFullYear(expires.getFullYear() + 1);
    else expires.setMonth(expires.getMonth() + 1);
    const now = start.toISOString();
    const txRef = walletRef(uid).collection('transactions').doc();
    await db.runTransaction(async (t) => {
      t.set(walletRef(uid), {
        uid, plan: 'pro', proExpiresAt: expires.toISOString(),
        stripeSubscriptionId: `mock_sub_${uid}`, updatedAt: now,
      }, { merge: true });
      t.set(txRef, {
        id: txRef.id, type: 'pro_subscription', priceILS,
        description: `Creator Pro — ${interval === 'year' ? 'annual' : 'monthly'}`,
        stripePaymentIntentId: `mock_${txRef.id}`, createdAt: now,
      });
    });
    return { checkoutUrl: null, mock: true, plan: 'pro' };
  }

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'ils',
        unit_amount: priceILS * 100,
        recurring: { interval },
        product_data: { name: `RushPoint Creator Pro (${interval}ly)` },
      },
    }],
    subscription_data: { metadata: { uid } },
    success_url: `${APP_URL()}/wallet?pro=success`,
    cancel_url: `${APP_URL()}/wallet?pro=cancel`,
    metadata: { uid, type: 'pro_subscription', interval },
  });
  return { checkoutUrl: session.url };
});


// ─── claimReferral ────────────────────────────────────────────────────────────
// Called once, right after a new creator signs up via an invite link
// (creator-web stores ?ref=<uid> and replays it post-auth). Grants BOTH the
// inviter and the newcomer one extra lifetime free run. Idempotent per account:
// the `referredBy` flag blocks a second claim; a self-referral is rejected.

export const claimReferral = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { referrerUid } = data as { referrerUid?: string };

  if (!referrerUid?.trim()) throw new functions.https.HttpsError('invalid-argument', 'referrerUid required');
  const referrer = referrerUid.trim();
  if (referrer === uid) throw new functions.https.HttpsError('failed-precondition', 'You cannot refer yourself');

  // The inviter must be a real account (display name comes from Auth, not a doc).
  const referrerUser = await admin.auth().getUser(referrer).catch(() => null);
  if (!referrerUser) throw new functions.https.HttpsError('not-found', 'Unknown inviter');

  const now = new Date().toISOString();
  const meRef = walletRef(uid);
  const themRef = walletRef(referrer);
  const bonus = REFERRAL_BONUS_FREE_RUNS;

  const result = await db.runTransaction(async (t) => {
    const meSnap = await t.get(meRef);
    const me = meSnap.exists ? (meSnap.data() as Wallet) : null;
    if (me?.referredBy) return { already: true as const };

    // Grant the newcomer an extra free run.
    t.set(meRef, {
      uid,
      bonusFreeRuns: admin.firestore.FieldValue.increment(bonus),
      referredBy: referrer,
      referralClaimedAt: now,
      updatedAt: now,
    }, { merge: true });
    const meTx = meRef.collection('transactions').doc();
    t.set(meTx, {
      id: meTx.id, type: 'referral',
      description: 'Welcome bonus — a free run', createdAt: now,
    });

    // Grant the inviter an extra free run.
    t.set(themRef, {
      uid: referrer,
      bonusFreeRuns: admin.firestore.FieldValue.increment(bonus),
      referralCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    }, { merge: true });
    const themTx = themRef.collection('transactions').doc();
    t.set(themTx, {
      id: themTx.id, type: 'referral',
      description: 'Referral bonus — a creator you invited joined', createdAt: now,
    });

    return { already: false as const };
  });

  return { ok: true, alreadyClaimed: result.already, bonusFreeRuns: result.already ? 0 : bonus };
});


// ─── stripeWebhook ────────────────────────────────────────────────────────────
// HTTP handler (not callable) for Stripe checkout/subscription lifecycle events.

export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  // Free mode: the webhook is inert — acknowledge with 200 and mutate nothing.
  if (!PAYMENTS_ENABLED) {
    res.status(200).json({ received: true, paymentsEnabled: false });
    return;
  }
  const stripeKey     = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    res.status(500).json({ error: 'Stripe not configured' });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require('stripe');
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
  const sig    = req.headers['stripe-signature'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: `Webhook error: ${msg}` });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session: any = event.data.object;
        const meta = session.metadata ?? {};
        if (!meta.uid) break;

        if (meta.type === 'event_credits') {
          const credits = Number(meta.credits) || 0;
          const maxP = Number(meta.maxParticipantsPerRun) || 0;
          const now = new Date().toISOString();
          await db.runTransaction(async (t) => {
            const wRef = walletRef(meta.uid);
            const w = (await t.get(wRef)).data() as Wallet | undefined;
            // Idempotency: Stripe delivers at-least-once.
            if (w?.processedSessions?.includes(session.id)) return;
            t.set(wRef, {
              uid: meta.uid,
              eventCredits: admin.firestore.FieldValue.increment(credits),
              lastPackageMaxParticipants: maxP,
              processedSessions: admin.firestore.FieldValue.arrayUnion(session.id),
              stripeCustomerId: session.customer ?? w?.stripeCustomerId,
              updatedAt: now,
            }, { merge: true });
            t.set(wRef.collection('transactions').doc(session.id), {
              id: session.id, type: 'topup_credits', credits,
              maxParticipantsPerRun: maxP, packageId: meta.packageId,
              priceILS: (session.amount_total ?? 0) / 100,
              description: `Bought ${credits} Event Credit${credits > 1 ? 's' : ''} (${meta.packageId})`,
              createdAt: now,
            }, { merge: true });
          });
        } else if (meta.type === 'pro_subscription') {
          await walletRef(meta.uid).set({
            uid: meta.uid, plan: 'pro',
            stripeCustomerId: session.customer ?? undefined,
            stripeSubscriptionId: session.subscription ?? null,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice: any = event.data.object;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        const uid = sub.metadata?.uid;
        if (!uid) break;
        await walletRef(uid).set({
          uid, plan: 'pro',
          proExpiresAt: new Date(sub.current_period_end * 1000).toISOString(),
          stripeSubscriptionId: sub.id,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        break;
      }

      case 'customer.subscription.deleted': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub: any = event.data.object;
        const uid = sub.metadata?.uid;
        if (!uid) break;
        await walletRef(uid).set({
          uid, plan: 'free', stripeSubscriptionId: null, proExpiresAt: null,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    functions.logger.error('stripeWebhook handler failed', err);
    res.status(500).json({ error: 'handler failed' });
    return;
  }

  res.json({ received: true });
});
