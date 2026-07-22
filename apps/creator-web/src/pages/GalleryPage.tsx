import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicGame, PublicTask } from '@rushpoint/shared';
import { searchGallery, searchTaskLibrary, duplicateGame } from '../services/calls';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '../components/ui';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import GalleryMap from '../components/GalleryMap';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useT } from '../components/LanguageContext';

export default function GalleryPage() {
  const nav = useNavigate();
  const t = useT();
  const gl = t.gallery;
  const b = t.builder;
  // Localized labels so gallery cards never surface raw English enum values in a
  // Hebrew UI (mode + task type mirror the Builder's own labels).
  const MODE_LABEL: Record<string, string> = { individual: b.modeIndividual, team: b.modeTeam };
  const TASK_TYPE_LABEL: Record<string, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation,
    photo: b.typePhoto, quiz: b.typeQuiz, numeric: b.typeNumeric,
    geofence: b.typeGeofence, sequence: b.typeSequence, survey: b.typeSurvey,
  };
  const [tab, setTab] = useState<'games' | 'tasks'>('games');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [q, setQ] = useState('');
  const [games, setGames] = useState<PublicGame[] | null>(null);
  const [tasks, setTasks] = useState<PublicTask[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  function focusGame(id: string) {
    setFocusId(id);
    document.getElementById(`game-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Show the loading skeleton whenever a query is in flight (search-as-you-type).
  const [searching, setSearching] = useState(false);

  async function run() {
    setSearching(true);
    if (tab === 'games') setGames(null); else setTasks(null);
    try {
      if (tab === 'games') { const { games } = await searchGallery({ query: q }); setGames(games); }
      else { const { tasks } = await searchTaskLibrary({ query: q }); setTasks(tasks); }
    } catch (e) {
      // A failed search must not hang the gallery on an eternal spinner: surface
      // the error and settle to an empty result the user can retry from.
      await dialog.alert(e instanceof Error ? e.message : t.gallery.searchFailed);
      if (tab === 'games') setGames([]); else setTasks([]);
    } finally { setSearching(false); }
  }
  // Re-entrancy guard (change: wave-b/async-action-guard) for the explicit search
  // button / Enter key, so hammering them can't stack overlapping searchGallery
  // calls whose results then land out of order.
  // The debounce effect below deliberately keeps calling the RAW `run`: a guard
  // there would silently drop the newest query whenever a slow search was still in
  // flight, leaving the results stale behind what the user typed.
  const searchAction = useAsyncAction(run);
  const runRef = useRef(run);
  runRef.current = run;

  // Reload when the tab changes AND debounce search-as-you-type on the query.
  // A single 350ms debounce covers both first mount and every keystroke, so we
  // never double-fetch; Enter / the button still fire immediately via run().
  useEffect(() => {
    const id = setTimeout(() => void runRef.current(), 350);
    return () => clearTimeout(id);
  }, [q, tab]);

  async function copy(g: PublicGame) {
    try {
      const { gameId } = await duplicateGame({ gameId: g.id, sourceOwnerUid: g.ownerUid });
      nav(`/build/${gameId}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : gl.copyFailed); }
  }
  // Keyed by game id: copying one gallery card must not block a different card.
  const copyAction = useAsyncAction(copy, (g: PublicGame) => g.id);

  return (
    <div className="max-w-6xl mx-auto animate-fade-up">
      <header className="mb-6">
        <h1 className="font-brand text-3xl font-extrabold tracking-tight text-[--ink-1]">{gl.title}</h1>
        <p className="text-[--ink-3] text-sm mt-1.5 max-w-lg leading-relaxed">{gl.subtitle}</p>
      </header>

      {/* Toolbar: source tabs + (games only) list/map view toggle */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex gap-1 rounded-xl border border-[--rp-border] bg-[--surface-0]/70 dark:bg-white/[0.03] p-1">
          {(['games', 'tasks'] as const).map((tb) => (
            <button key={tb} onClick={() => setTab(tb)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                tab === tb ? 'bg-rp-fire/12 text-rp-fire' : 'text-[--ink-3] hover:text-[--ink-1]'}`}>
              {tb === 'games' ? gl.tabGames : gl.tabTasks}
            </button>
          ))}
        </div>
        {tab === 'games' && (
          <div className="ms-auto inline-flex gap-1 rounded-xl border border-[--rp-border] bg-[--surface-0]/70 dark:bg-white/[0.03] p-1">
            {(['list', 'map'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  view === v ? 'bg-rp-fire/12 text-rp-fire' : 'text-[--ink-3] hover:text-[--ink-1]'}`}>
                {v === 'list' ? gl.viewList : gl.viewMap}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={gl.searchPlaceholder}
          onKeyDown={(e) => { if (e.key === 'Enter') void searchAction.run(); }} />
        <Button loading={searchAction.busy} onClick={() => void searchAction.run()} className="shrink-0">{gl.searchBtn}</Button>
      </div>

      {tab === 'games' && view === 'map' && games && games.length > 0 && (
        <div className="mb-4"><GalleryMap games={games} onSelect={focusGame} className="h-72" /></div>
      )}

      {tab === 'games' && ((!games || searching) ? <CardSkeletonGrid /> : games.length === 0 ? (
        <EmptyState icon="🔭" title={gl.emptyTitle} body={gl.emptyText}
          action={q ? <Button variant="ghost" onClick={() => setQ('')}>{gl.clearSearch}</Button> : undefined} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((pg) => (
            <Card key={pg.id} className={`p-4 flex flex-col gap-2.5 scroll-mt-20 transition ${focusId === pg.id ? 'ring-2 ring-rp-fire' : ''}`}>
              <div id={`game-${pg.id}`} className="flex items-start justify-between gap-2">
                <h3 className="font-brand font-bold text-[--ink-1] leading-snug flex-1">{pg.title}</h3>
                <Badge color="cyan">{MODE_LABEL[pg.mode] ?? pg.mode}</Badge>
              </div>
              <p className="text-xs text-[--ink-3] line-clamp-2 min-h-[2rem] leading-relaxed">{pg.description}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[--ink-3] font-medium">
                <span>{gl.stages(pg.stageCount)}</span>
                <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                <span>{gl.tasks(pg.taskCount)}</span>
                <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                <span>~{pg.estimatedTotalMinutes}m</span>
                <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                <span>{gl.plays(pg.playCount)}</span>
              </div>
              {pg.approxLocation?.label && <span className="text-[11px] text-[--ink-3]">📍 {pg.approxLocation.label}</span>}
              <Button disabled={copyAction.busy} loading={copyAction.isBusy(pg.id)} className="mt-auto !py-2 !text-xs !font-semibold" onClick={() => void copyAction.run(pg)}>{gl.copyBtn}</Button>
            </Card>
          ))}
        </div>
      ))}

      {tab === 'tasks' && ((!tasks || searching) ? <CardSkeletonGrid /> : tasks.length === 0 ? (
        <EmptyState icon="🔭" title={gl.emptyTitle} body={gl.emptyText}
          action={q ? <Button variant="ghost" onClick={() => setQ('')}>{gl.clearSearch}</Button> : undefined} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((tk) => (
            <Card key={tk.id} className="p-4 flex flex-col gap-2.5">
              <h3 className="font-brand font-bold text-sm text-[--ink-1] leading-snug">{tk.title}</h3>
              <p className="text-xs text-[--ink-3] line-clamp-2 min-h-[2rem] leading-relaxed">{tk.description}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[--ink-3] font-medium">
                <span>{TASK_TYPE_LABEL[tk.type] ?? tk.type}</span>
                <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                <span>{gl.metaDiff(tk.difficulty)}</span>
                <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                <span>{gl.metaPts(tk.pointValue)}</span>
                <span className="w-1 h-1 rounded-full bg-[--rp-border] inline-block" />
                <span>{gl.metaCopies(tk.copyCount)}</span>
              </div>
              <span className="text-[11px] text-[--ink-3] mt-auto">{gl.from(tk.sourceGameTitle ?? '')}</span>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

function CardSkeletonGrid() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-12" />
          </div>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-9 w-full mt-1" />
        </Card>
      ))}
    </div>
  );
}
