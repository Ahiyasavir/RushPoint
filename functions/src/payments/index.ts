// ─── Payments callables ───────────────────────────────────────────────────────
// Wallet top-up via Stripe Checkout + webhook handler to confirm payment.
// In emulator mode, topUpWallet returns a mock session without hitting Stripe.

import * as functions from 'firebase-functions';
import { db } from '../firebase';
import * as admin from 'firebase-admin';
import type { Wallet } from '@rushpoint/shared';

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

      await walletRef(uid).set(
        {
          uid,
          balanceILS: admin.firestore.FieldValue.increment(amount),
          updatedAt: now,
        },
        { merge: true },
      );

      await walletRef(uid)
        .collection('transactions')
        .doc(txId)
        .update({ stripePaymentIntentId: session.payment_intent ?? session.id });
    }
  }

  res.json({ received: true });
});
