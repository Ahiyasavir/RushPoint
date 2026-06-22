// ─── Payments callables ───────────────────────────────────────────────────────
// Wallet top-up via Stripe Checkout + webhook handler to confirm payment.
// In emulator mode, topUpWallet returns a mock session without hitting Stripe.

import * as functions from 'firebase-functions';
import { db } from '../firebase';
import * as admin from 'firebase-admin';
import { type Wallet, REFERRAL_BONUS_ILS } from '@rushpoint/shared';

const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}

function walletRef(uid: string) {
  return db.doc(`wallets/${uid}`);
}

// ─── getWallet ────────────────────────────────────────────────────────────────

export const getWallet = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await walletRef(uid).get();
  if (!snap.exists) {
    const wallet: Wallet = { uid, balanceILS: 0, updatedAt: new Date().toISOString() };
    await walletRef(uid).set(wallet);
    return { wallet };
  }
  return { wallet: snap.data() as Wallet };
});


// ─── topUpWallet ──────────────────────────────────────────────────────────────
// Returns a Stripe Checkout session URL (or null in emulator mode, where the
// balance is credited directly so local dev works without Stripe keys).

export const topUpWallet = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { amountILS } = data as { amountILS: number };

  if (!amountILS || amountILS < 10 || amountILS > 10_000) {
    throw new functions.https.HttpsError('invalid-argument', 'amountILS must be 10–10,000');
  }

  if (EMULATOR) {
    const now = new Date().toISOString();
    await walletRef(uid).set(
      {
        uid,
        balanceILS: admin.firestore.FieldValue.increment(amountILS),
        updatedAt: now,
      },
      { merge: true },
    );
    const txRef = walletRef(uid).collection('transactions').doc();
    await txRef.set({
      id: txRef.id,
      type: 'topup',
      amountILS,
      description: `Top-up ₪${amountILS} (emulator)`,
      stripePaymentIntentId: `mock_${txRef.id}`,
      createdAt: now,
    });
    return { sessionUrl: null, mock: true, amountILS };
  }

  // ── Production Stripe path ──
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new functions.https.HttpsError('internal', 'Stripe not configured');
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require('stripe');
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

  const appUrl  = process.env.APP_URL ?? 'http://localhost:3000';
  const now     = new Date().toISOString();
  const txRef   = walletRef(uid).collection('transactions').doc();

  await txRef.set({
    id: txRef.id,
    type: 'topup',
    amountILS,
    description: `Top-up ₪${amountILS}`,
    status: 'pending', // → 'paid' exactly once, by the webhook
    createdAt: now,
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'ils',
          unit_amount: amountILS * 100,
          product_data: { name: `RushPoint Wallet — ₪${amountILS}` },
        },
      },
    ],
    success_url: `${appUrl}/wallet?topup=success`,
    cancel_url:  `${appUrl}/wallet?topup=cancel`,
    metadata: { uid, txId: txRef.id, amountILS: String(amountILS) },
  });

  await txRef.update({ stripePaymentIntentId: session.payment_intent ?? session.id });

  return { sessionUrl: session.url };
});


// ─── claimReferral ────────────────────────────────────────────────────────────
// Called once, right after a new creator signs up via an invite link
// (creator-web stores ?ref=<uid> and replays it post-auth). Credits BOTH the
// inviter and the newcomer with a fixed bonus. Idempotent per account: the
// `referredBy` flag on the claimer's wallet blocks a second claim, and a
// self-referral is rejected.

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

  const result = await db.runTransaction(async (t) => {
    const meSnap = await t.get(meRef);
    const me = meSnap.exists ? (meSnap.data() as Wallet) : null;
    if (me?.referredBy) return { already: true as const };

    // Credit the newcomer.
    t.set(meRef, {
      uid,
      balanceILS: admin.firestore.FieldValue.increment(REFERRAL_BONUS_ILS),
      referredBy: referrer,
      referralClaimedAt: now,
      updatedAt: now,
    }, { merge: true });
    const meTx = meRef.collection('transactions').doc();
    t.set(meTx, {
      id: meTx.id, type: 'referral', amountILS: REFERRAL_BONUS_ILS,
      description: 'Welcome referral bonus', createdAt: now,
    });

    // Credit the inviter.
    t.set(themRef, {
      uid: referrer,
      balanceILS: admin.firestore.FieldValue.increment(REFERRAL_BONUS_ILS),
      referralCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    }, { merge: true });
    const themTx = themRef.collection('transactions').doc();
    t.set(themTx, {
      id: themTx.id, type: 'referral', amountILS: REFERRAL_BONUS_ILS,
      description: 'Referral bonus — a creator you invited joined', createdAt: now,
    });

    return { already: false as const };
  });

  return { ok: true, alreadyClaimed: result.already, bonusILS: result.already ? 0 : REFERRAL_BONUS_ILS };
});


// ─── stripeWebhook ────────────────────────────────────────────────────────────
// HTTP handler (not callable) that Stripe calls on checkout.session.completed.

export const stripeWebhook = functions.https.onRequest(async (req, res) => {
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

  if (event.type === 'checkout.session.completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session: any = event.data.object;
    const { uid, txId, amountILS } = session.metadata ?? {};

    if (uid && txId && amountILS) {
      const amount = parseInt(amountILS, 10);
      const now    = new Date().toISOString();
      const txDoc  = walletRef(uid).collection('transactions').doc(txId);

      // Idempotent credit: Stripe delivers events at-least-once, so guard against
      // crediting the same top-up twice on a retry. Only credit if not yet 'paid'.
      await db.runTransaction(async (t) => {
        const txSnap = await t.get(txDoc);
        if (txSnap.exists && (txSnap.data() as { status?: string }).status === 'paid') return;
        t.set(
          walletRef(uid),
          { uid, balanceILS: admin.firestore.FieldValue.increment(amount), updatedAt: now },
          { merge: true },
        );
        t.set(
          txDoc,
          { status: 'paid', stripePaymentIntentId: session.payment_intent ?? session.id, paidAt: now },
          { merge: true },
        );
      });
    }
  }

  res.json({ received: true });
});
