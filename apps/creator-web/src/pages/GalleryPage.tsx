import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicGame, PublicTask } from '@rushpoint/shared';
import { searchGallery, searchTaskLibrary, duplicateGame } from '../services/calls';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '../components/ui';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import GalleryMap from '../components/GalleryMap';
import { useT } from '../components/LanguageContext';

export default function GalleryPage() {
  const nav = useNavigate();
  const t = useT();
  const gl = t.gallery;
  const [tab, setTab] = useState<'games' | 'tasks'>('games');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [q, setQ] = useState('');
  const [games, setGames] = useState<PublicGame[] | null>(null);
  const [tasks, setTasks] = useState<PublicTask[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
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
      await dialog.alert(e instanceof Error ? e.message : 'Search failed');
      if (tab === 'games') setGames([]); else setTasks([]);
    } finally { setSearching(false); }
  }
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
    setBusy(true);
    setCopyingId(g.id);
    try {
      const { gameId } = await duplicateGame({ gameId: g.id, sourceOwnerUid: g.ownerUid });
      nav(`/build/${gameId}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : gl.copyFailed); }
    finally { setBusy(false); setCopyingId(null); }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{gl.title}</h1>
      <p className="text-zinc-500 text-sm mb-5">{gl.subtitle}</p>

      <div className="flex gap-2 mb-4 items-center">
        {(['games', 'tasks'] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === tb ? 'bg-app-raised text-zinc-100' : 'text-zinc-400'}`}>
            {tb === 'games' ? gl.tabGames : gl.tabTasks}
          </button>
        ))}
        {tab === 'games' && (
          <div className="ms-auto flex gap-1 bg-app-raised rounded-lg p-0.5">
            {(['list', 'map'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md text-xs ${view === v ? 'bg-neon-green/15 text-neon-green' : 'text-zinc-400'}`}>
                {v === 'list' ? gl.viewList : gl.viewMap}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={gl.searchPlaceholder}
          onKeyDown={(e) => e.key === 'Enter' && run()} />
        <Button onClick={run}>{gl.searchBtn}</Button>
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
            <Card key={pg.id} className={`p-4 flex flex-col gap-2 scroll-mt-20 transition ${focusId === pg.id ? 'ring-2 ring-neon-green' : ''}`}>
              <div id={`game-${pg.id}`} className="flex items-start justify-between">
                <h3 className="font-semibold">{pg.title}</h3>
                <Badge color="cyan">{pg.mode}</Badge>
              </div>
              <p className="text-xs text-zinc-500 line-clamp-2 min-h-[2rem]">{pg.description}</p>
              <div className="flex gap-2 text-[11px] text-zinc-500">
                <span>{gl.stages(pg.stageCount)}</span>·<span>{gl.tasks(pg.taskCount)}</span>·<span>~{pg.estimatedTotalMinutes}m</span>·<span>{gl.plays(pg.playCount)}</span>
              </div>
              {pg.approxLocation?.label && <span className="text-[11px] text-zinc-600">📍 {pg.approxLocation.label}</span>}
              <Button disabled={busy} loading={copyingId === pg.id} className="mt-1" onClick={() => copy(pg)}>{gl.copyBtn}</Button>
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
            <Card key={tk.id} className="p-4 flex flex-col gap-2">
              <h3 className="font-semibold text-sm">{tk.title}</h3>
              <p className="text-xs text-zinc-500 line-clamp-2 min-h-[2rem]">{tk.description}</p>
              <div className="flex gap-2 text-[11px] text-zinc-500">
                <span>{tk.type}</span>·<span>{gl.metaDiff(tk.difficulty)}</span>·<span>{gl.metaPts(tk.pointValue)}</span>·<span>{gl.metaCopies(tk.copyCount)}</span>
              </div>
              <span className="text-[11px] text-zinc-600">{gl.from(tk.sourceGameTitle ?? '')}</span>
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
