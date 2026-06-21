import { useEffect, useState } from 'react';
import type { Wallet } from '@rushpoint/shared';
import { FREE_PARTICIPANTS_PER_RUN, PRICE_ILS_INDIVIDUAL, PRICE_ILS_TEAM } from '@rushpoint/shared';
import { getWallet, topUpWallet } from '../services/calls';
import { Button, Card, Spinner } from '../components/ui';
import { dialog } from '../components/dialog';

const AMOUNTS = [50, 100, 200, 500];

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() { const { wallet } = await getWallet(); setWallet(wallet); }
  useEffect(() => { void load(); }, []);

  async function topUp(amountILS: number) {
    setBusy(true);
    try {
      const res = await topUpWallet({ amountILS });
      if (res.sessionUrl) window.location.href = res.sessionUrl; // Stripe checkout
      else await load(); // emulator mock — credited directly
    } catch (e) { await dialog.alert(e instanceof Error ? e.message : 'Top-up failed'); }
    finally { setBusy(false); }
  }

  if (!wallet) return <Spinner label="Loading wallet…" />;

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-1">Wallet</h1>
      <p className="text-zinc-500 text-sm mb-5">One balance for all your runs. Building is always free.</p>

      <Card className="p-6 mb-5 text-center">
        <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Balance</div>
        <div className="text-4xl font-bold text-neon-green">₪{wallet.balanceILS.toFixed(0)}</div>
      </Card>

      <Card className="p-5 mb-5">
        <div className="text-sm font-medium mb-3">Add credit</div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {AMOUNTS.map((a) => (
            <Button key={a} variant="subtle" disabled={busy} onClick={() => topUp(a)}>₪{a}</Button>
          ))}
        </div>
        <p className="text-xs text-zinc-600">Secure checkout via Stripe. In local dev, credit is applied instantly.</p>
      </Card>

      <Card className="p-5 text-sm text-zinc-400 space-y-1">
        <div className="font-medium text-zinc-200 mb-1">Pricing</div>
        <div>First <b>{FREE_PARTICIPANTS_PER_RUN}</b> participants/teams per run — free.</div>
        <div>Each extra participant (individual mode): <b>₪{PRICE_ILS_INDIVIDUAL}</b></div>
        <div>Each extra team (team mode): <b>₪{PRICE_ILS_TEAM}</b></div>
      </Card>
    </div>
  );
}
