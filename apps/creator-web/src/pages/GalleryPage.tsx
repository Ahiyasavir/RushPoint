import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicGame, PublicTask } from '@rushpoint/shared';
import { searchGallery, searchTaskLibrary, duplicateGame, setPublicLike } from '../services/calls';
import { deriveLikeView, applyOptimisticLike, reconcileLike, type LikeView } from '../lib/likeState';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '../components/ui';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import GalleryMap, { type MapPoint } from '../components/GalleryMap';
import { isValidCoord, isPlottablePublicTask } from '@rushpoint/shared';
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
  // Like state per item id, seeded from the search response's `likedIds` so the
  // heart renders correctly on first paint. All arithmetic lives in lib/likeState.
  const [likes, setLikes] = useState<Record<string, LikeView>>({});

  // Both tabs focus a card the same way; only the DOM id prefix differs.
  function focusCard(prefix: 'game' | 'task', id: string) {
    setFocusId(id);
    document.getElementById(`${prefix}-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // A focus ring is scoped to the tab it was set from — otherwise focusing a
  // mission and switching to Games would light up an unrelated card that happens
  // to share the id space.
  useEffect(() => { setFocusId(null); }, [tab]);

  // Marker sets. The DECISION about what may be plotted is not made here: a task
  // is plottable only when the server published an area for it, and a
  // hidden-location task never gets one (change: task-library-map-view). We just
  // ask the shared, unit-tested predicate and read `approxLocation` — never the
  // deprecated exact `coordinates`.
  const gamePoints: MapPoint[] = (games ?? [])
    .filter((g) => g.approxLocation && isValidCoord(g.approxLocation.lat, g.approxLocation.lng))
    .map((g) => ({
      id: g.id,
      lat: g.approxLocation!.lat,
      lng: g.approxLocation!.lng,
      title: g.title,
      subtitle: `${gl.stages(g.stageCount)} · ${gl.plays(g.playCount)}`,
    }));

  const taskPoints: MapPoint[] = (tasks ?? [])
    .filter(isPlottablePublicTask)
    .map((tk) => ({
      id: tk.id,
      lat: tk.approxLocation!.lat,
      lng: tk.approxLocation!.lng,
      title: tk.title,
      subtitle: `${TASK_TYPE_LABEL[tk.type] ?? tk.type} · ${gl.metaPts(tk.pointValue)}`,
    }));

  // Show the loading skeleton whenever a query is in flight (search-as-you-type).
  const [searching, setSearching] = useState(false);

  async function run() {
    setSearching(true);
    if (tab === 'games') setGames(null); else setTasks(null);
    try {
      if (tab === 'games') {
        const { games, likedIds } = await searchGallery({ query: q });
        setGames(games);
        setLikes((prev) => ({ ...prev, ...Object.fromEntries(games.map((g) => [g.id, deriveLikeView(g, likedIds)])) }));
      } else {
        const { tasks, likedIds } = await searchTaskLibrary({ query: q });
        setTasks(tasks);
        setLikes((prev) => ({ ...prev, ...Object.fromEntries(tasks.map((tk) => [tk.id, deriveLikeView(tk, likedIds)])) }));
      }
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

  // Optimistic like toggle. The server call is a desired-END-STATE setter, so a
  // double tap is a no-op on both sides; the response is authoritative and
  // replaces the optimistic guess. On failure we roll back to what we had.
  async function toggleLike(arg: { kind: 'game' | 'task'; id: string }) {
    const before = likes[arg.id] ?? { liked: false, likeCount: 0 };
    const next = applyOptimisticLike(before, !before.liked);
    if (next === before) return;
    setLikes((prev) => ({ ...prev, [arg.id]: next }));
    try {
      const res = await setPublicLike({ kind: arg.kind, itemId: arg.id, liked: next.liked });
      setLikes((prev) => ({ ...prev, [arg.id]: reconcileLike(res) }));
    } catch (e) {
      setLikes((prev) => ({ ...prev, [arg.id]: before }));
      toast.error(e instanceof Error ? e.message : gl.likeFailed);
    }
  }
  const likeAction = useAsyncAction(toggleLike, (arg: { id: string }) => arg.id);
  // Bound once here rather than declared inside the render body: a component
  // defined inline is a NEW type on every render and would remount (and drop
  // focus) on every keystroke of the search box.
  const likeProps = (kind: 'game' | 'task', id: string) => ({
    kind, id, gl,
    view: likes[id] ?? { liked: false, likeCount: 0 },
    busy: likeAction.isBusy(id),
    onToggle: () => void likeAction.run({ kind, id }),
  });

  return (
    <div className="max-w-6xl mx-auto animate-fade-up">
      <header className="mb-6">
        <h1 className="font-brand text-3xl font-extrabold tracking-tight text-[--ink-1]">{gl.title}</h1>
        <p className="text-[--ink-3] text-sm mt-1.5 max-w-lg leading-relaxed">{gl.subtitle}</p>
      </header>

      {/* Toolbar: source tabs + list/map view toggle (both tabs) */}
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
        <div className="ms-auto inline-flex gap-1 rounded-xl border border-[--rp-border] bg-[--surface-0]/70 dark:bg-white/[0.03] p-1">
          {(['list', 'map'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                view === v ? 'bg-rp-fire/12 text-rp-fire' : 'text-[--ink-3] hover:text-[--ink-1]'}`}>
              {v === 'list' ? gl.viewList : gl.viewMap}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={gl.searchPlaceholder}
          onKeyDown={(e) => { if (e.key === 'Enter') void searchAction.run(); }} />
        <Button loading={searchAction.busy} onClick={() => void searchAction.run()} className="shrink-0">{gl.searchBtn}</Button>
      </div>

      {/* Tell the creator WHY things are in this order: popularity by default,
          relevance once they type (popularity only breaks ties within a tier). */}
      <p className="text-[11px] text-[--ink-3] mb-4">{q.trim() ? gl.sortedByMatch : gl.sortedByPopular}</p>

      {tab === 'games' && view === 'map' && games && games.length > 0 && (
        <div className="mb-4">
          <GalleryMap points={gamePoints} onSelect={(id) => focusCard('game', id)}
            emptyLabel={gl.noLocatedGames} className="h-72" />
        </div>
      )}

      {/* Mission library map (change: task-library-map-view). Renders whenever the
          tab has results — including when NONE are plottable, so the creator gets
          the explicit "nothing to show" state instead of a blank slot they would
          read as a broken map. */}
      {tab === 'tasks' && view === 'map' && tasks && tasks.length > 0 && (
        <div className="mb-4">
          <GalleryMap points={taskPoints} onSelect={(id) => focusCard('task', id)}
            emptyLabel={gl.noLocatedTasks} notice={gl.approxPinsNote}
            markerColor="#f59e0b" className="h-72" />
        </div>
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
              <div><LikeButton {...likeProps('game', pg.id)} /></div>
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
            <Card key={tk.id} className={`p-4 flex flex-col gap-2.5 scroll-mt-20 transition ${focusId === tk.id ? 'ring-2 ring-rp-fire' : ''}`}>
              <h3 id={`task-${tk.id}`} className="font-brand font-bold text-sm text-[--ink-1] leading-snug">{tk.title}</h3>
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
              <div className="flex items-center justify-between gap-2 mt-auto">
                <span className="text-[11px] text-[--ink-3]">{gl.from(tk.sourceGameTitle ?? '')}</span>
                <LikeButton {...likeProps('task', tk.id)} />
              </div>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Like affordance for one gallery card (change: gallery-popularity-ranking).
 * Presentational only: it renders the `view` it is given and reports taps — all
 * the arithmetic lives in lib/likeState so it can be unit tested.
 */
function LikeButton({ view, busy, gl, onToggle }: {
  kind: 'game' | 'task';
  id: string;
  view: LikeView;
  busy: boolean;
  gl: { likeAdd: string; likeRemove: string; likes: (n: number) => string };
  onToggle: () => void;
}) {
  const label = view.liked ? gl.likeRemove : gl.likeAdd;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={view.liked}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 rounded-full border border-[--rp-border] px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
        view.liked ? 'bg-rp-fire/12 text-rp-fire' : 'text-[--ink-3] hover:text-[--ink-1]'}`}
    >
      <span aria-hidden="true">{view.liked ? '♥' : '♡'}</span>
      <span>{gl.likes(view.likeCount)}</span>
    </button>
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
