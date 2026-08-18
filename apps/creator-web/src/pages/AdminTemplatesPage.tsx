// Admin-managed game templates (change: admin-manage-game-templates).
//
// A template is an ORDINARY Game the admin owns, flagged isTemplate: true — so it
// is edited with the exact same Builder every creator uses (Edit below just
// navigates to /build/:gameId). This page only manages the picker-only metadata
// (emoji, order, template flag itself) that the Builder has no field for.
//
// Not in the primary nav (same treatment as /admin/users): reachable only by
// direct URL, gated on the signed-in user's `admin` custom claim. The REAL
// boundary is server-side — setGameTemplateFlag re-checks the claim itself.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/firebase';
import { createGame, listAdminTemplates, setGameTemplateFlag, deleteGame, importGameFile } from '../services/calls';
import type { Game, GameFile } from '@rushpoint/shared';
// The SAME pure parser the server runs, so an obviously bad file fails instantly
// with the real reason instead of a round trip (mirrors BuilderPage/DashboardPage).
import { parseGameFile } from '@rushpoint/shared';
import { isAdminClaim } from '../lib/adminGate';
import { EmptyState, Skeleton, Button, Input } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { useT } from '../components/LanguageContext';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';

type GateState = 'checking' | 'denied' | 'allowed';

export default function AdminTemplatesPage() {
  const t = useT();
  const at = t.adminTemplates;
  const nav = useNavigate();

  const [gate, setGate] = useState<GateState>('checking');
  const [games, setGames] = useState<Game[] | null>(null);
  // The REASON, not just "it failed". This page is admin-only, so the raw server
  // message is safe here and is the difference between "the templates tab is
  // broken" and "this query needs an index" — the generic string cost a whole
  // debugging session once already.
  const [failed, setFailed] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingMeta, setEditingMeta] = useState<string | null>(null); // gameId of the open emoji/order editor
  const [emojiDraft, setEmojiDraft] = useState('');
  const [orderDraft, setOrderDraft] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement | null>(null);

  async function load() {
    setFailed(null);
    try {
      // Server-side `isTemplate == true`, uncapped. This used to be
      // `listGames()` filtered client-side, and listGames is
      // orderBy('updatedAt','desc').limit(200) — so past 200 games, editing or
      // importing ORDINARY games pushed real templates out of the window and they
      // disappeared from this tab while still existing everywhere else.
      const { games } = await listAdminTemplates();
      setGames(games);
    } catch (e) {
      console.error('[adminTemplates] listAdminTemplates failed:', e);
      setGames((prev) => prev ?? []);
      setFailed(e instanceof Error && e.message ? e.message : at.loadFailed);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function checkGate() {
      const user = auth.currentUser;
      if (!user) { if (!cancelled) setGate('denied'); return; }
      try {
        const token = await user.getIdTokenResult();
        if (cancelled) return;
        if (isAdminClaim(token.claims)) { setGate('allowed'); void load(); } else setGate('denied');
      } catch {
        if (!cancelled) setGate('denied');
      }
    }
    void checkGate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nextTemplateOrder() {
    return (games ?? []).reduce((max, g) => Math.max(max, g.templateOrder ?? 0), 0) + 1;
  }

  // Import a .rushpoint.json file AS A TEMPLATE.
  //
  // This door exists because the file format deliberately cannot carry
  // `isTemplate` (EXPORTED_GAME_KEYS excludes it, so a hand-edited file can never
  // inject a template into every creator's picker) — which means the Dashboard's
  // import, the only other new-game import door, always produced an ORDINARY game
  // sitting in "my games". An admin importing a template file had no path at all:
  // the flag can only be applied AFTER the game exists, by an admin-only callable,
  // and nothing on this page offered to do it. Same import + flag pair as
  // newTemplate above, including the delete-on-failure cleanup, so a half-imported
  // game is never stranded as a plain game in the admin's own dashboard.
  async function importTemplateFromFile(file: File) {
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      await dialog.alert(at.importNotAFile);
      return;
    }
    const pre = parseGameFile(doc);
    if (pre.errors.length > 0) { await dialog.alert(pre.errors.join(' · ')); return; }

    setImporting(true);
    let importedGameId: string | undefined;
    try {
      const { gameId } = await importGameFile({ file: doc as GameFile });
      importedGameId = gameId;
      await setGameTemplateFlag({ gameId, isTemplate: true, templateEmoji: '✨', templateOrder: nextTemplateOrder() });
      nav(`/build/${gameId}`);
    } catch (e) {
      console.error('[adminTemplates] import failed:', e);
      if (importedGameId) {
        try { await deleteGame({ gameId: importedGameId }); } catch { /* best effort cleanup */ }
      }
      await dialog.alert(e instanceof Error ? e.message : at.importFailed);
    } finally {
      setImporting(false);
    }
  }

  async function newTemplate() {
    setCreating(true);
    let createdGameId: string | undefined;
    try {
      const { gameId } = await createGame({ title: at.newTemplateTitle, mode: 'team', tags: [] });
      createdGameId = gameId;
      await setGameTemplateFlag({ gameId, isTemplate: true, templateEmoji: '✨', templateOrder: nextTemplateOrder() });
      nav(`/build/${gameId}`);
    } catch (e) {
      console.error('[adminTemplates] create failed:', e);
      if (createdGameId) {
        try { await deleteGame({ gameId: createdGameId }); } catch { /* best effort cleanup */ }
      }
      toast.error(at.createFailed);
    } finally {
      setCreating(false);
    }
  }

  function openMetaEditor(g: Game) {
    setEditingMeta(g.id);
    setEmojiDraft(g.templateEmoji ?? '');
    setOrderDraft(String(g.templateOrder ?? ''));
  }

  async function saveMeta(g: Game) {
    setSavingMeta(true);
    try {
      const order = orderDraft.trim() === '' ? undefined : Number(orderDraft);
      await setGameTemplateFlag({
        gameId: g.id, isTemplate: true,
        templateEmoji: emojiDraft.trim() || undefined,
        templateOrder: Number.isFinite(order) ? order : undefined,
      });
      setEditingMeta(null);
      void load();
    } catch (e) {
      console.error('[adminTemplates] setGameTemplateFlag failed:', e);
      toast.error(at.metaSaveFailed);
    } finally {
      setSavingMeta(false);
    }
  }

  async function removeTemplate(g: Game) {
    const ok = await dialog.confirm(at.deleteConfirmBody(g.title), at.deleteConfirmCta, true);
    if (!ok) return;
    setDeletingId(g.id);
    try {
      await deleteGame({ gameId: g.id });
      void load();
    } catch (e) {
      console.error('[adminTemplates] deleteGame failed:', e);
      toast.error(at.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  }

  if (gate === 'checking') {
    return (
      <div className="animate-fade-up space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (gate === 'denied') return <EmptyState icon="🔒" title={at.deniedTitle} body={at.deniedBody} />;
  if (!games) {
    return (
      <div className="animate-fade-up space-y-4">
        <LoadingState messages={at.loading} className="!py-6" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[--ink-1]">{at.title}</h1>
          <p className="text-sm text-[--ink-3]">{at.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Import AS A TEMPLATE. Without this the only import doors created an
              ordinary game, so a template file landed in "my games" instead. */}
          <Button
            variant="ghost"
            loading={importing}
            onClick={() => importInput.current?.click()}
            title={at.importHint}
          >
            {at.importBtn}
          </Button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={at.importBtn}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importTemplateFromFile(f);
            }}
          />
          <Button onClick={() => void newTemplate()} loading={creating}>{at.newTemplateBtn}</Button>
        </div>
      </div>

      <button
        onClick={() => nav('/admin/users')}
        className="text-xs font-medium text-[--ink-3] hover:text-[--ink-1] underline underline-offset-2"
      >
        {at.toUsersLink}
      </button>

      {failed && (
        <p className="text-sm text-rp-alert" role="alert">
          {at.loadFailed}
          <span className="block text-xs opacity-80 break-words" dir="auto">{failed}</span>
        </p>
      )}

      {games.length === 0 ? (
        <EmptyState icon="🧩" title={at.emptyTitle} body={at.emptyBody} />
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {games.map((g) => {
            const stageCount = g.stages?.length ?? 0;
            const taskCount = (g.stages ?? []).reduce((sum, s) => sum + (s.tasks?.length ?? 0), 0);
            return (
              <li key={g.id} className="rounded-xl border border-[--rp-border] bg-[--surface-1] p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="text-2xl leading-none shrink-0">{g.templateEmoji || '🧩'}</div>
                  <div className="min-w-0">
                    <div className="font-medium text-[--ink-1] truncate" dir="auto">{g.title}</div>
                    <div className="text-[11px] text-[--ink-3]">{at.templateMeta(stageCount, taskCount)}</div>
                    {g.templateLang && <div className="text-[10px] text-[--ink-3]">{at.langBadge(g.templateLang)}</div>}
                  </div>
                </div>

                {editingMeta === g.id ? (
                  <div className="space-y-1.5 pt-1 border-t border-[--rp-border]">
                    <Input dense value={emojiDraft} onChange={(e) => setEmojiDraft(e.target.value)} placeholder={at.emojiLabel} aria-label={at.emojiLabel} />
                    <Input dense value={orderDraft} onChange={(e) => setOrderDraft(e.target.value)} placeholder={at.orderLabel} aria-label={at.orderLabel} inputMode="numeric" />
                    <div className="flex gap-2">
                      <Button className="!py-1 !text-xs" onClick={() => void saveMeta(g)} loading={savingMeta}>{at.saveMetaBtn}</Button>
                      <button className="text-xs text-[--ink-3]" onClick={() => setEditingMeta(null)}>{at.cancelBtn}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => nav(`/build/${g.id}`)} className="text-xs px-2 py-1 rounded-lg border border-[--rp-border] text-[--ink-1]">
                      {at.editBtn}
                    </button>
                    <button onClick={() => openMetaEditor(g)} className="text-xs px-2 py-1 rounded-lg border border-[--rp-border] text-[--ink-1]">
                      {at.editMetaBtn}
                    </button>
                    <button
                      onClick={() => void removeTemplate(g)}
                      disabled={deletingId === g.id}
                      className="text-xs px-2 py-1 rounded-lg border border-[--rp-border] text-rp-alert disabled:opacity-40"
                    >
                      {deletingId === g.id ? at.deleting : at.deleteBtn}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
