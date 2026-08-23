import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { WalletStatus, WalletTransaction, EventPackageId } from '@rushpoint/shared';
import { EVENT_PACKAGES, PRO_MONTHLY_ILS, PRO_ANNUAL_ILS } from '@rushpoint/shared';
import { getWalletStatus, purchaseCredits, subscribePro } from '../services/calls';
import { db } from '../services/firebase';
import { Button, Card, Skeleton } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { dialog } from '../components/dialog';
import { ShareSheet } from '../components/ShareSheet';
import { useAuth } from '../components/AuthGate';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { classifyBillingError } from '../lib/callErrors';
import { formatTxDate } from '../lib/formatTxDate';
import { useT } from '../components/LanguageContext';

const PACKAGE_ORDER: EventPackageId[] = ['starter', 'standard', 'pro_pack'];

export default function WalletPage() {
  const { user } = useAuth();
  const t = useT();
  const w = t.wallet;

  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [inviting, setInviting] = useState(false);
  // A failed getWalletStatus used to leave `status` null forever, and `!status`
  // renders a Spinner — a PERMANENT spinner on the page where a creator pays
  // (change: play-no-silent-failures). Same shape DashboardPage already uses:
  // escape the loading state, log the real error, show localized copy.
  const [statusErr, setStatusErr] = useState(false);

  async function loadStatus() {
    try {
      setStatusErr(false);
      setStatus(await getWalletStatus());
    } catch (e) {
      console.error('[wallet] getWalletStatus failed:', e);
      setStatusErr(true);
    }
  }
  useEffect(() => { void loadStatus(); }, []);

  // Transactions are owner-readable directly (firestore.rules) — live list.
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, `wallets/${user.uid}/transactions`),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    return onSnapshot(q, (snap) => setTxns(snap.docs.map((d) => d.data() as WalletTransaction)), () => undefined);
  }, [user]);

  async function buy(packageId: EventPackageId) {
    try {
      const res = await purchaseCredits({ packageId });
      if (res.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      await loadStatus(); // emulator grants instantly
    } catch (e) {
      // Never render a raw English server message at the moment money is
      // involved: map by error code, log the original.
      console.error('[wallet] purchaseCredits failed:', e);
      await dialog.alert(w[classifyBillingError(e)]);
    }
  }

  async function goPro(interval: 'month' | 'year') {
    try {
      const res = await subscribePro({ interval });
      if (res.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      await loadStatus();
    } catch (e) {
      console.error('[wallet] subscribePro failed:', e);
      await dialog.alert(w[classifyBillingError(e)]);
    }
  }

  // These MOVE MONEY, so a second click in the same React batch (which a
  // `useState` busy flag can't stop — setState is async) would double-charge.
  // The guard is held for the whole callable (change: wave-b/async-action-guard).
  const buyAction = useAsyncAction(buy, (packageId: EventPackageId) => packageId);
  const proAction = useAsyncAction(goPro, (interval: 'month' | 'year') => `pro-${interval}`);
  // Same shape the JSX already used: the in-flight key, or null when idle.
  const busy: string | null = buyAction.busyKeys[0] ?? proAction.busyKeys[0] ?? null;

  if (!status) {
    if (!statusErr) {
      // Content-shaped skeleton mirroring the loaded layout (status card +
      // package grid), the same idiom every other creator page uses on initial
      // load instead of a bare spinner. Text-free (Skeleton is aria-hidden).
      return (
        <div className="max-w-2xl mx-auto animate-fade-up">
          <LoadingState messages={w.loadingBilling} className="!py-6" />
          <Card className="p-6 mb-5">
            <div className="flex items-center justify-between mb-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
          <div className="grid sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4 flex flex-col gap-3">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-9 w-full mt-1" />
              </Card>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-2xl mx-auto animate-fade-up">
        <Card className="p-8 text-center">
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-sm text-[--ink-2] mb-4">{w.statusFailed}</p>
          <Button onClick={() => void loadStatus()}>{w.retry}</Button>
        </Card>
      </div>
    );
  }

  const isPro = status.plan === 'pro';

  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <h1 className="font-brand text-2xl font-bold mb-1">{w.title}</h1>
      <p className="text-[--ink-3] text-sm mb-5">{w.subtitle}</p>

      {/* ── Status card ─────────────────────────────────────────────────────── */}
      <Card className="p-6 mb-5">
        <div className="flex items-center justify-between mb-5">
          <div className="text-xs text-[--ink-3] uppercase tracking-widest">{w.planLabel}</div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            isPro ? 'bg-rp-signal/15 text-rp-signal' : 'bg-[--surface-2] text-[--ink-2]'}`}>
            {isPro ? w.planPro : w.planFree}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-brand text-4xl font-extrabold text-rp-fire tabular-nums">{status.eventCredits}</div>
            <div className="text-xs text-[--ink-3] mt-1">{w.creditsLabel}</div>
            <div className="text-[11px] text-[--ink-3] mt-0.5">{w.creditsHint}</div>
          </div>
          <div>
            <div className="font-brand text-4xl font-extrabold text-[--ink-1] tabular-nums">{status.freeRunsRemaining}</div>
            <div className="text-xs text-[--ink-3] mt-1">{w.freeRunsLabel}</div>
            <div className="text-[11px] text-[--ink-3] mt-0.5">{w.freeRunsValue(status.freeRunsRemaining)}</div>
          </div>
        </div>
        {isPro && status.proExpiresAt && (
          <div className="mt-4 text-xs text-rp-signal">
            {w.proUntil(new Date(status.proExpiresAt).toLocaleDateString())}
          </div>
        )}
      </Card>

      {/* ── Credit packages ─────────────────────────────────────────────────── */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-brand font-bold text-[--ink-1]">{w.packagesTitle}</h2>
        </div>
        <p className="text-xs text-[--ink-3] mb-3">{w.packagesSub}</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {PACKAGE_ORDER.map((id) => {
            const pkg = EVENT_PACKAGES[id];
            return (
              <Card key={id} className={`p-4 flex flex-col relative ${pkg.popular ? 'ring-2 ring-rp-fire/40' : ''}`}>
                {pkg.popular && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rp-fire text-white whitespace-nowrap">
                    {w.packagePopular}
                  </span>
                )}
                <div className="font-brand text-xl font-extrabold text-[--ink-1]">{w.packageCredits(pkg.credits)}</div>
                <div className="text-[11px] text-[--ink-3] mt-0.5 flex-1">{w.packageMaxP(pkg.maxParticipants)}</div>
                <div className="font-brand text-2xl font-bold text-rp-fire mt-3">₪{pkg.priceILS}</div>
                <Button className="!py-2 !text-sm mt-3" disabled={busy !== null} loading={busy === id} onClick={() => void buyAction.run(id)}>
                  {busy === id ? w.purchasing : w.packageBuy}
                </Button>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ── Creator Pro ─────────────────────────────────────────────────────── */}
      <Card className="p-5 mb-5 bg-gradient-to-br from-rp-signal/8 to-transparent border-rp-signal/20">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-brand font-bold text-[--ink-1]">{w.proTitle}</h2>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rp-signal/15 text-rp-signal">PRO</span> {/* i18n-ignore brand */}
        </div>
        <p className="text-sm text-[--ink-3] mb-4">{w.proSubtitle}</p>
        {isPro ? (
          <p className="text-sm text-rp-signal font-medium">{w.proActiveNote}</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button variant="ghost" className="flex-1 !py-2.5 !flex-col !gap-0.5" disabled={busy !== null} loading={busy === 'pro-month'} onClick={() => void proAction.run('month')}>
              {busy === 'pro-month' ? w.purchasing : (
                <>
                  <span>{w.proCtaMonthly}</span>
                  <span className="text-[11px] font-normal text-[--ink-3]">{w.proMonthly(PRO_MONTHLY_ILS)}</span>
                </>
              )}
            </Button>
            <Button className="flex-1 !py-2.5 !flex-col !gap-0.5" disabled={busy !== null} loading={busy === 'pro-year'} onClick={() => void proAction.run('year')}>
              {busy === 'pro-year' ? w.purchasing : (
                <>
                  <span>{w.proCtaAnnual}</span>
                  <span className="text-[11px] font-normal text-[--ink-3]">{w.proAnnual(PRO_ANNUAL_ILS)}</span>
                </>
              )}
            </Button>
          </div>
        )}
      </Card>

      {/* ── Referral ────────────────────────────────────────────────────────── */}
      <Card className="p-5 mb-5">
        <div className="text-sm font-medium text-[--ink-1] mb-1">{w.inviteTitle}</div>
        <p className="text-xs text-[--ink-3] mb-3">{w.inviteBody}</p>
        <Button variant="ghost" disabled={!user} onClick={() => setInviting(true)}>{w.inviteBtn}</Button>
      </Card>

      {/* ── Transaction history ─────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="font-brand font-bold text-[--ink-1] mb-3">{w.historyTitle}</div>
        {txns.length === 0 ? (
          <p className="text-sm text-[--ink-3]">{w.historyEmpty}</p>
        ) : (
          <div className="divide-y divide-[--rp-border]">
            {txns.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="text-[--ink-1] font-medium truncate">{txLabel(tx, w)}</div>
                  <div className="text-[11px] text-[--ink-3]">{formatTxDate(tx.createdAt)}</div>
                </div>
                <div className="text-[--ink-2] font-mono text-xs whitespace-nowrap ps-3">{txAmount(tx)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {inviting && user && (
        <ShareSheet
          title={w.inviteTitle}
          text={w.inviteBody}
          url={`${window.location.origin}/?ref=${user.uid}`}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}

function txLabel(tx: WalletTransaction, w: ReturnType<typeof useT>['wallet']): string {
  switch (tx.type) {
    case 'topup_credits':     return tx.gameTitle ?? w.txTopupCredits;
    case 'charge_event':      return tx.gameTitle ?? w.txChargeEvent;
    case 'free_run_consumed': return tx.gameTitle ?? w.txFreeRun;
    case 'pro_subscription':  return w.txProSub;
    case 'referral':          return w.txReferral;
    default:                  return tx.description;
  }
}

function txAmount(tx: WalletTransaction): string {
  if (tx.type === 'topup_credits' && tx.credits) return `+${tx.credits} 🎟️`;
  if (tx.type === 'charge_event') return `−${tx.creditCost ?? 1} 🎟️`;
  if (tx.type === 'free_run_consumed') return '🆓';
  if (tx.type === 'referral') return '+🆓';
  if (tx.priceILS != null) return `₪${tx.priceILS}`;
  if (tx.amountILS != null) return `₪${tx.amountILS}`;
  return '';
}
