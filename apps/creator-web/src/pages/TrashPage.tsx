// Recently deleted games (change: recoverable-game-deletion).
//
// The recovery half of the fix. A creator clicked Delete on a game card and a real
// game, its finished run, its team and their whole history were destroyed
// instantly by db.recursiveDelete, with no undo and no record. Deletion is now a
// tombstone with a 30-day grace period, and this is where a creator sees what is
// in the trash, how long is left, and gets it back.
//
// Every action here goes through a callable (server-write-only state); the page
// never writes Firestore directly.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { daysUntilPurge } from '@rushpoint/shared';
import { listDeletedGames, restoreGame, purgeGameNow, type TrashedGame } from '../services/calls';
import { Button, Card, EmptyState, Input, Label, Skeleton } from '../components/ui';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { LoadingState } from '../components/LoadingState';
import { dialog } from '../components/dialog';
import { matchesGameDeleteConfirmation } from '../lib/deleteConfirm';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useT } from '../components/LanguageContext';

export default function TrashPage() {
  const nav = useNavigate();
  const t = useT();
  const tr = t.trash;

  const [games, setGames] = useState<TrashedGame[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [purging, setPurging] = useState<TrashedGame | null>(null);

  const restoreAction = useAsyncAction(restore, (g: TrashedGame) => g.id);
  const purgeAction = useAsyncAction(purge, (g: TrashedGame) => g.id);

  async function load() {
    try {
      const res = await listDeletedGames();
      setGames(res.games);
      setRetentionDays(res.retentionDays);
    } catch (e) {
      console.error('[trash] listDeletedGames failed:', e);
      setGames((prev) => prev ?? []);
      await dialog.alert(tr.loadFailed);
    }
  }
  useEffect(() => { void load(); }, []);

  async function restore(g: TrashedGame) {
    try {
      await restoreGame({ gameId: g.id });
      await load();
    } catch {
      // The one meaningful failure: the grace period elapsed and the game is
      // already gone. Say so plainly instead of promising a recovery.
      await dialog.alert(tr.restoreFailed);
      await load();
    }
  }

  async function purge(g: TrashedGame) {
    try {
      await purgeGameNow({ gameId: g.id });
      setPurging(null);
      await load();
    } catch {
      setPurging(null);
      await dialog.alert(tr.purgeFailed);
      await load();
    }
  }

  if (!games) {
    return (
      <div className="animate-fade-up space-y-4">
        <LoadingState messages={tr.loading} className="!py-6" />
        <Skeleton className="h-10 w-64" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-8 pb-6 border-b border-[--rp-border]">
        <button
          onClick={() => nav('/')}
          className="text-xs font-medium text-[--ink-3] hover:text-[--ink-1] mb-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
        >
          {tr.back}
        </button>
        <h1 className="font-brand text-3xl font-extrabold tracking-tight text-[--ink-1]">{tr.title}</h1>
        <p className="text-[--ink-3] mt-2 text-sm max-w-xl">{tr.subtitle(retentionDays)}</p>
      </div>

      {games.length === 0 ? (
        <EmptyState icon="🗑️" title={tr.emptyTitle} body={tr.emptyBody} />
      ) : (
        <div className="space-y-3">
          {games.map((g) => {
            const left = daysUntilPurge(g.deletedAt, new Date(), retentionDays);
            return (
              <Card key={g.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-brand font-bold text-[--ink-1] text-base truncate" dir="auto">{g.title}</div>
                  <div className="text-xs text-[--ink-3] mt-1">{tr.deletedOn(formatDate(g.deletedAt))}</div>
                  <div className={`text-xs mt-0.5 font-medium ${left <= 3 ? 'text-rp-alert' : 'text-[--ink-3]'}`}>
                    {tr.daysLeft(left)}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    disabled={restoreAction.isBusy(g.id) || purgeAction.isBusy(g.id)}
                    loading={restoreAction.isBusy(g.id)}
                    onClick={() => void restoreAction.run(g)}
                  >
                    {tr.restoreBtn}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={restoreAction.isBusy(g.id) || purgeAction.isBusy(g.id)}
                    onClick={() => setPurging(g)}
                  >
                    {tr.purgeBtn}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Permanent destruction reuses the SAME type-the-title friction as delete —
          this is the one action in the product with no recovery at all. */}
      {purging && createPortal(
        <PurgeDialog
          game={purging}
          busy={purgeAction.isBusy(purging.id)}
          onCancel={() => setPurging(null)}
          onConfirm={() => void purgeAction.run(purging)}
        />,
        document.body,
      )}
    </div>
  );
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString();
}

function PurgeDialog({ game, busy, onCancel, onConfirm }: {
  game: TrashedGame;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const tr = t.trash;
  const [typed, setTyped] = useState('');
  // Escape cancels — the same thing the backdrop click already does for a mouse.
  // A destructive confirm is the LAST dialog that should be hard to back out of.
  useModalDismiss(onCancel);
  const confirmed = matchesGameDeleteConfirmation(typed, game.title);
  const untitled = (game.title ?? '').trim() === '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-[--surface-0] dark:bg-[--surface-1] border border-rp-alert/30 rounded-2xl w-full max-w-md p-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-brand font-bold text-rp-alert text-lg mb-1">{tr.purgeDialogTitle}</div>
        <p className="text-xs text-[--ink-2] leading-relaxed mb-4">{untitled ? tr.purgeDialogBodyUntitled : tr.purgeDialogBody(game.title)}</p>
        <Label>{untitled ? tr.purgeDialogHintUntitled : tr.purgeDialogHint}</Label>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={untitled ? 'DELETE' : game.title}
          disabled={busy}
          autoFocus
          dir="auto"
        />
        <div className="flex gap-2 mt-4">
          <Button variant="danger" disabled={!confirmed || busy} loading={busy} onClick={onConfirm}>
            {tr.purgeDialogCta}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {tr.purgeDialogCancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
