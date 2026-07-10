import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Game } from '@rushpoint/shared';
import { PAYMENTS_ENABLED, resolvePlayOrigin, validateUnlockGraph } from '@rushpoint/shared';
import { createGame, updateGame, listGames, launchRun, deleteGame, publishGame } from '../services/calls';
import { Badge, Button, Card, Skeleton } from '../components/ui';
import { dialog } from '../components/dialog';
import { ShareSheet } from '../components/ShareSheet';
import { TEMPLATES, type GameTemplate } from '../templates';
import { isTaskInteractionValid, isTaskLocationValid } from '../lib/wizardLogic';
import { useAuth } from '../components/AuthGate';
import { useT } from '../components/LanguageContext';

// Module-level cache so navigating back to dashboard is instant (no spinner).
// Scoped to the owner uid: sign-out doesn't reload the page, so without the uid
// guard this cache would survive an account switch on the same device and leak
// the previous user's game list to the next login for up to the TTL.
let _gamesCache: { uid: string; data: Game[]; ts: number } | null = null;
const CACHE_TTL = 45_000;

function readGamesCache(uid: string | undefined): Game[] | null {
  if (!uid || !_gamesCache || _gamesCache.uid !== uid) return null;
  if (Date.now() - _gamesCache.ts >= CACHE_TTL) return null;
  return _gamesCache.data;
}

const PLAY_URL = import.meta.env.DEV
  ? resolvePlayOrigin(window.location.origin)
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? 'https://rushpoint-play.web.app');

function getAccentBar(g: Game): string {
  if (g.visibility === 'public') return 'from-rp-plasma to-rp-go';
  return 'from-rp-fire to-rp-amber';
}

const TASK_TYPE_EMOJI: Record<string, string> = {
  field: '📍', self_report: '✅', smart_station: '🔢',
  photo: '📷', quiz: '❓', numeric: '#️⃣', geofence: '📡', sequence: '🧩', survey: '🗳️',
};

export default function DashboardPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const d = t.dashboard;
  const b = t.builder;
  // Localized task-type chip labels (never show raw English enum values in a
  // Hebrew UI). Mirrors the Builder's TaskCard type labels.
  const TASK_TYPE_LABEL: Record<string, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation,
    photo: b.typePhoto, quiz: b.typeQuiz, numeric: b.typeNumeric,
    geofence: b.typeGeofence, sequence: b.typeSequence, survey: b.typeSurvey,
  };

  const [games, setGames] = useState<Game[] | null>(() => readGamesCache(user?.uid));
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState<Game | null>(null);

  async function load(invalidate = false) {
    if (!invalidate && readGamesCache(user?.uid)) return;
    try {
      const { games } = await listGames();
      if (user?.uid) _gamesCache = { uid: user.uid, data: games, ts: Date.now() };
      setGames(games);
    } catch (e) {
      // Escape the spinner on a first-load failure, but never blank an already-
      // loaded dashboard if a post-mutation refresh fails.
      setGames((prev) => prev ?? []);
      await dialog.alert(e instanceof Error ? e.message : d.loadGamesFailed);
    }
  }
  useEffect(() => { void load(); }, []);

  // Lock background scroll while the (portalled) template picker is open, so the
  // page behind can't scroll under the full-screen overlay.
  useEffect(() => {
    if (!picking) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [picking]);

  async function newGame(tpl: GameTemplate) {
    setBusy(true); setPicking(false);
    try {
      const title = tpl.key === 'blank' ? d.untitledGame : tpl.label;
      const { gameId } = await createGame({ title, mode: tpl.mode, tags: [] });
      const stages = tpl.build().map((s, i) => ({ ...s, order: i }));
      await updateGame({ gameId, stages, scoringPreset: tpl.scoringPreset });
      // Invalidate the games cache — otherwise returning to the dashboard within
      // the TTL serves a stale list that's missing this just-created game.
      _gamesCache = null;
      nav(`/build/${gameId}`);
    } finally { setBusy(false); }
  }

  async function launch(g: Game, opts?: { testDrive?: boolean }) {
    if (g.stages.length === 0) { await dialog.alert(d.emptyBody); return; }
    // Don't launch an unplayable game: a quiz/numeric/station/sequence task missing
    // its answer key can never be completed (updateGame doesn't reject these).
    const badTask = g.stages.flatMap((s) => s.tasks).find((tk) => !isTaskInteractionValid(tk));
    if (badTask) { await dialog.alert(b.taskNotCompletable(badTask.title || b.untitledTask)); return; }
    // Block a located task left at (0,0): a radius/exact task with no real pin would
    // route teams to the null island (Gulf of Guinea) and can never be completed.
    const noPinTask = g.stages.flatMap((s) => s.tasks).find((tk) => !isTaskLocationValid(tk));
    if (noPinTask) { await dialog.alert(b.taskNeedsLocation(noPinTask.title || b.untitledTask)); return; }
    // Block an unwinnable stage: requiredTaskCount higher than the tasks teams can
    // actually complete (the Builder only shows a soft warning; the Dashboard has
    // no stage view at all, so this is the only place it's caught from here).
    const brokenStage = g.stages.find((s) => {
      const r = validateUnlockGraph(s);
      return r.warnings.length > 0 || r.errors.length > 0;
    });
    if (brokenStage) { await dialog.alert(b.stageUnwinnable(brokenStage.title || b.stageTitlePlaceholder)); return; }
    setBusy(true);
    try {
      const { runId } = await launchRun({ gameId: g.id, testDrive: opts?.testDrive });
      nav(`/run/${g.id}/${runId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : d.launchFailed;
      // Out of free runs + credits → route the creator to buy more. In free
      // mode launches never fail for billing, so just surface other errors.
      if (PAYMENTS_ENABLED && /credit|pro/i.test(msg)) {
        if (await dialog.confirm(msg, t.nav.wallet)) nav('/wallet');
      } else {
        await dialog.alert(msg);
      }
    } finally { setBusy(false); }
  }

  async function remove(g: Game) {
    if (!(await dialog.confirm(d.deleteConfirm(g.title), d.deleteBtn, true))) return;
    await deleteGame({ gameId: g.id });
    void load(true);
  }

  async function togglePublish(g: Game) {
    await publishGame({ gameId: g.id, visibility: g.visibility === 'public' ? 'private' : 'public' });
    void load(true);
  }

  if (!games) return <DashboardSkeleton />;

  const totalTasks = games.reduce((s, g) => s + g.stages.reduce((ss, st) => ss + st.tasks.length, 0), 0);
  const firstName = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? d.creatorFallback;

  return (
    <div className="animate-fade-up">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative mb-10 pb-10 border-b border-[--rp-border]">
        <div className="absolute -top-8 -left-8 w-96 h-48 bg-gradient-radial from-rp-fire/8 to-transparent pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div>
            <p className="text-[--ink-3] text-sm font-medium mb-1 uppercase tracking-widest">
              {d.welcomeBack(firstName)}
            </p>
            <h1 className="font-brand text-5xl font-extrabold tracking-tight leading-none bg-gradient-to-r from-rp-fire via-rp-amber to-rp-amber bg-clip-text text-transparent">
              {d.title}
            </h1>
            <p className="text-[--ink-3] mt-3 text-base max-w-sm">{d.subtitle}</p>
          </div>

          <Button
            disabled={busy}
            onClick={() => setPicking(true)}
            className="!px-6 !py-2.5 !text-sm shrink-0 flex items-center gap-2"
          >
            {d.newGame}
          </Button>
        </div>

        {/* Stats row */}
        {games.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
            {[
              { label: d.statGamesBuilt, value: games.length, icon: '🗺️', tint: 'from-rp-fire/12 to-rp-amber/5', ring: 'group-hover:border-rp-fire/30' },
              { label: d.statTotalTasks, value: totalTasks, icon: '✅', tint: 'from-rp-go/12 to-rp-go/5', ring: 'group-hover:border-rp-go/30' },
              { label: d.statPublished, value: games.filter(g => g.visibility === 'public').length, icon: '🌐', tint: 'from-rp-plasma/12 to-rp-plasma/5', ring: 'group-hover:border-rp-plasma/30' },
              { label: d.statTotalPlays, value: games.reduce((s, g) => s + (g.playCount ?? 0), 0), icon: '🏁', tint: 'from-rp-signal/12 to-rp-signal/5', ring: 'group-hover:border-rp-signal/30' },
            ].map((s) => (
              <div key={s.label}
                className={`group relative overflow-hidden rounded-2xl border border-[--rp-border] bg-[--surface-0]/80 dark:bg-white/[0.03] backdrop-blur-sm px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 ${s.ring}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${s.tint} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className="relative flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-[--surface-2] shrink-0">{s.icon}</div>
                  <div className="min-w-0">
                    <div className="font-brand text-2xl font-extrabold text-[--ink-1] leading-none tabular-nums">{s.value}</div>
                    <div className="text-[11px] text-[--ink-3] mt-1 font-medium truncate">{s.label}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {games.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6"
            style={{ background: 'linear-gradient(135deg, rgba(255,87,34,0.15) 0%, rgba(255,179,0,0.10) 100%)', boxShadow: '0 0 40px rgba(255,87,34,0.15)' }}
          >🗺️</div>
          <h3 className="font-brand text-2xl font-bold text-[--ink-1] mb-2">{d.emptyTitle}</h3>
          <p className="text-[--ink-3] text-sm mb-8 max-w-xs leading-relaxed">{d.emptyBody}</p>
          <Button disabled={busy} onClick={() => setPicking(true)} className="!px-8 !py-3 !text-base">
            {d.emptyBtn}
          </Button>
        </div>

      ) : (
        /* ── Game cards ──────────────────────────────────────────────────── */
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {games.map((g, idx) => {
            const taskCount = g.stages.reduce((s, st) => s + st.tasks.length, 0);
            const allTaskTypes = [...new Set(g.stages.flatMap(st => st.tasks.map(tsk => tsk.type)))].slice(0, 4);

            return (
              <div key={g.id} className="animate-fade-up" style={{ animationDelay: `${idx * 60}ms` }}>
                <Card className="p-0 overflow-hidden flex flex-col h-full">
                  <div className={`h-[3px] w-full bg-gradient-to-r ${getAccentBar(g)} flex-shrink-0`} />
                  <div className="p-5 flex flex-col gap-4 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-brand font-bold text-[--ink-1] text-base leading-snug flex-1">{g.title}</h3>
                      <Badge color={g.visibility === 'public' ? 'cyan' : 'zinc'}>
                        {g.visibility === 'public' ? d.visPublic : d.visPrivate}
                      </Badge>
                    </div>

                    <p className="text-xs text-[--ink-3] line-clamp-2 leading-relaxed min-h-[2.5rem]">
                      {g.description || d.noDescription}
                    </p>

                    {allTaskTypes.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {allTaskTypes.map(type => (
                          <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[--surface-2] text-[--ink-3] text-[10px] font-medium">
                            {TASK_TYPE_EMOJI[type] ?? '●'} {TASK_TYPE_LABEL[type] ?? type}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-[--ink-3] font-medium">
                      <span>{d.cardStages(g.stages.length)}</span>
                      <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                      <span>{d.cardTasks(taskCount)}</span>
                      <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                      <span>{d.cardPlays(g.playCount ?? 0)}</span>
                    </div>

                    <div className="flex gap-2 mt-auto">
                      <button
                        onClick={() => nav(`/build/${g.id}`)}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-[--ink-2] bg-[--surface-2] hover:bg-[--rp-border] hover:text-[--ink-1] transition-all duration-150"
                      >
                        {d.cardEdit}
                      </button>
                      <Button className="flex-1 !py-2 !text-xs !font-semibold" disabled={busy} onClick={() => launch(g)}>
                        {d.cardLaunch}
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-1 border-t border-[--rp-border] pt-3 -mb-1">
                      <button
                        className="flex-1 min-w-[calc(50%-0.25rem)] min-h-[36px] px-2 py-2 rounded-lg text-[11px] font-medium text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
                        disabled={busy}
                        title={d.cardTestRunHint}
                        onClick={() => launch(g, { testDrive: true })}
                      >
                        {d.cardTestRun}
                      </button>
                      <button
                        className="flex-1 min-w-[calc(50%-0.25rem)] min-h-[36px] px-2 py-2 rounded-lg text-[11px] font-medium text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
                        onClick={() => togglePublish(g)}
                      >
                        {g.visibility === 'public' ? d.cardUnpublish : d.cardPublish}
                      </button>
                      <button
                        className="flex-1 min-w-[calc(50%-0.25rem)] min-h-[36px] px-2 py-2 rounded-lg text-[11px] font-medium text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/50"
                        onClick={() => setSharing(g)}
                      >
                        {d.cardShare}
                      </button>
                      <button
                        className="flex-1 min-w-[calc(50%-0.25rem)] min-h-[36px] px-2 py-2 rounded-lg text-[11px] font-medium text-rp-alert/60 hover:text-rp-alert hover:bg-rp-alert/8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-alert/40"
                        onClick={() => remove(g)}
                      >
                        {d.cardDelete}
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}

          {/* Persistent create tile */}
          <button
            onClick={() => setPicking(true)}
            disabled={busy}
            className="group animate-fade-up min-h-[220px] rounded-2xl border-2 border-dashed border-[--rp-border] hover:border-rp-fire/50 bg-[--surface-0]/40 dark:bg-white/[0.02] hover:bg-rp-fire/[0.04] transition-all duration-200 flex flex-col items-center justify-center gap-3 text-center px-5"
            style={{ animationDelay: `${games.length * 60}ms` }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl bg-[--surface-2] text-[--ink-2] group-hover:bg-gradient-to-br group-hover:from-rp-fire group-hover:to-rp-amber group-hover:text-white group-hover:scale-105 transition-all duration-200 shadow-sm">
              ＋
            </div>
            <div>
              <div className="font-brand font-bold text-sm text-[--ink-2] group-hover:text-rp-fire transition-colors">{d.newAdventureLabel}</div>
              <div className="text-[11px] text-[--ink-3] mt-0.5">{d.newAdventureSub}</div>
            </div>
          </button>
        </div>
      )}

      {/* ── Explore / next steps ──────────────────────────────────────────── */}
      {games.length > 0 && (
        <div className="mt-12 animate-fade-up" style={{ animationDelay: '120ms' }}>
          {/* Feature banner */}
          <div className="relative overflow-hidden rounded-3xl border border-[--rp-border] bg-gradient-to-br from-rp-fire/10 via-rp-amber/5 to-transparent p-7 sm:p-9 mb-6">
            <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-rp-fire/15 blur-3xl pointer-events-none" />
            <div className="absolute -right-4 -bottom-12 w-48 h-48 rounded-full bg-rp-amber/15 blur-3xl pointer-events-none" />
            <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div className="max-w-lg">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-rp-fire/10 text-rp-fire text-[11px] font-semibold px-2.5 py-1 mb-3">
                  {d.bannerBadge}
                </div>
                <h3 className="font-brand text-2xl font-extrabold text-[--ink-1] leading-tight">{d.bannerTitle}</h3>
                <p className="text-[--ink-2] text-sm mt-2 leading-relaxed">{d.bannerBody}</p>
              </div>
              <div className="flex sm:flex-col gap-2.5 shrink-0">
                <Button className="!px-5 !py-2.5 !text-sm whitespace-nowrap" onClick={() => nav('/gallery')}>{d.bannerCta1}</Button>
                {/* "Invite & earn" routes to the wallet — hidden in free mode. */}
                {PAYMENTS_ENABLED && (
                  <Button variant="ghost" className="!px-5 !py-2.5 !text-sm whitespace-nowrap" onClick={() => nav('/wallet')}>{d.bannerCta2}</Button>
                )}
              </div>
            </div>
          </div>

          {/* Quick actions — the Wallet/Credits card is hidden in free mode
              (PAYMENTS_ENABLED === false), matching the hidden /wallet nav + route. */}
          <div className="grid sm:grid-cols-3 gap-4">
            {d.quickCards
              .map((a, i) => ({ a, target: ['/', '/gallery', '/wallet'][i] ?? '/' }))
              .filter(({ target }) => PAYMENTS_ENABLED || target !== '/wallet')
              .map(({ a, target }, i) => (
                <button key={a.title} onClick={() => nav(target)}
                  className="group text-start rounded-2xl border border-[--rp-border] bg-[--surface-0]/70 dark:bg-white/[0.03] backdrop-blur-sm p-5 hover:-translate-y-1 hover:border-rp-fire/30 hover:shadow-[0_12px_32px_-12px_rgba(255,87,34,0.25)] transition-all duration-200 animate-fade-up"
                  style={{ animationDelay: `${160 + i * 60}ms` }}
                >
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-[--surface-2] mb-3.5 group-hover:scale-105 transition-transform">{a.icon}</div>
                  <div className="font-brand font-bold text-[--ink-1] text-base">{a.title}</div>
                  <p className="text-[13px] text-[--ink-3] mt-1.5 leading-relaxed">{a.body}</p>
                  <div className="text-xs font-semibold text-rp-fire mt-3.5 flex items-center gap-1 group-hover:gap-2 transition-all">{a.cta} <span>→</span></div>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* ── Template picker modal ─────────────────────────────────────────── */}
      {picking && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setPicking(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative glass-card grad-border bg-[--surface-0] dark:bg-[--surface-1]/80 border border-[--rp-border] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — fixed; never scrolls away. */}
            <div className="flex items-start justify-between gap-4 p-5 pb-4 shrink-0 border-b border-[--rp-border]">
              <div>
                <h3 className="font-brand font-bold text-[--ink-1] text-xl">{d.modalTitle}</h3>
                <p className="text-[--ink-3] text-sm mt-0.5">{d.modalSub}</p>
              </div>
              <button onClick={() => setPicking(false)}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[--ink-3] hover:bg-[--surface-2] hover:text-[--ink-1] transition-colors">✕</button>
            </div>
            {/* Body — bounded to the modal; the compact cards fit without scrolling
                on a normal screen, and only this region (never the page) scrolls on
                a very short viewport. */}
            <div className="overflow-y-auto p-5 pt-4">
              <div className="grid sm:grid-cols-2 gap-2.5">
                {TEMPLATES.map((tpl) => (
                  <button key={tpl.key} disabled={busy} onClick={() => newGame(tpl)}
                    className="flex items-start gap-3 text-start rounded-xl border border-[--rp-border] bg-[--surface-1] dark:bg-[--surface-2]/50 p-3 hover:border-rp-fire/40 hover:bg-rp-fire/5 dark:hover:bg-rp-fire/8 transition-all duration-150 disabled:opacity-40 group">
                    <div className="text-2xl leading-none shrink-0 mt-0.5">{tpl.emoji}</div>
                    <div className="min-w-0">
                      <div className="font-brand font-semibold text-[--ink-1] text-sm group-hover:text-rp-fire transition-colors">{tpl.label}</div>
                      <div className="text-[11px] text-[--ink-3] mt-0.5 leading-relaxed line-clamp-2">{tpl.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {sharing && (
        <ShareSheet
          title={d.shareTitle(sharing.title)}
          text={d.shareText(sharing.title)}
          url={`${PLAY_URL}/?game=${sharing.id}`}
          notPublic={sharing.visibility !== 'public'}
          onPublish={async () => {
            await publishGame({ gameId: sharing.id, visibility: 'public' });
            setSharing({ ...sharing, visibility: 'public' });
            void load(true);
          }}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}

// Content-shaped loading placeholder mirroring the hero + stats + card grid, so
// the first paint has the same footprint as the loaded dashboard (no layout jump).
function DashboardSkeleton() {
  return (
    <div className="animate-fade-up">
      <div className="mb-10 pb-10 border-b border-[--rp-border]">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div className="space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-12 w-64" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-2xl" />)}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[--rp-border] p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-2 mt-auto">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 flex-1" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
