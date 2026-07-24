import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicGame, PublicTask } from '@rushpoint/shared';
import { searchGallery, searchTaskLibrary, duplicateGame, setPublicLike } from '../services/calls';
import { deriveLikeView, applyOptimisticLike, reconcileLike, type LikeView } from '../lib/likeState';
import { Badge, Button, Card, EmptyState, Input, Skeleton, TagChips } from '../components/ui';
import { dialog } from '../components/dialog';
import { toast } from '../components/toast';
import GalleryMap, { type MapPoint } from '../components/GalleryMap';
import GalleryTaskDetailModal from '../components/GalleryTaskDetailModal';
import GalleryGameDetailModal from '../components/GalleryGameDetailModal';
import { isValidCoord, isPlottablePublicTask, publicTaskMapCoverage, isCoarsePublicPoint } from '@rushpoint/shared';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useT } from '../components/LanguageContext';

// Fetch limits mirror the server HARD_CAPs in functions/src/gallery/index.ts
// (searchTaskLibrary: 100, searchGallery: 50) so the map/list cover as many
// missions/games as the backend will serve instead of the callable defaults.
const TASK_LIBRARY_FETCH_LIMIT = 100;
const GALLERY_FETCH_LIMIT = 50;

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
  // The mission whose full detail is open (change: gallery-mission-detail). The
  // whole sanitized document is already in `tasks`, so pressing a card opens the
  // detail from memory and fetches nothing.
  const [detailTask, setDetailTask] = useState<PublicTask | null>(null);
  // The game whose full detail is open (change: gallery-game-card-preview). The
  // whole sanitized document is already in `games`, so pressing a card opens the
  // detail from memory and fetches nothing — the mission-card pattern, for games.
  const [detailGame, setDetailGame] = useState<PublicGame | null>(null);
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
      // An ordinary task pin is now the EXACT authored point; only a hidden-location
      // pin sits on the coarse ~1 km grid (change: gallery-precise-task-location).
      approximate: isCoarsePublicPoint(tk.approxLocation),
    }));
  // The "approximate area" caption belongs on the tasks map only when at least one
  // pin really is coarse (a hidden-location mission); otherwise every pin is exact
  // and the disclaimer would misdescribe them.
  const anyCoarseTaskPin = taskPoints.some((p) => p.approximate);

  // WHICH empty state applies is a classification, not a length check
  // (change: public-task-area-visibility). A creator hit the case where every
  // result was a document published before the area rule existed: an empty map
  // zoomed to the whole region, under a list full of located missions, saying only
  // "none of these has a published area" — true, unexplained, and unactionable.
  // The classifier shares `isPlottablePublicTask` with the marker filter above, so
  // "none plottable" can never be claimed while a pin is on the map.
  const taskCoverage = publicTaskMapCoverage(tasks ?? []);

  // Show the loading skeleton whenever a query is in flight (search-as-you-type).
  const [searching, setSearching] = useState(false);

  async function run() {
    setSearching(true);
    if (tab === 'games') setGames(null); else setTasks(null);
    try {
      if (tab === 'games') {
        const { games, likedIds } = await searchGallery({ query: q, limit: GALLERY_FETCH_LIMIT });
        setGames(games);
        setLikes((prev) => ({ ...prev, ...Object.fromEntries(games.map((g) => [g.id, deriveLikeView(g, likedIds)])) }));
      } else {
        const { tasks, likedIds } = await searchTaskLibrary({ query: q, limit: TASK_LIBRARY_FETCH_LIMIT });
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
            emptyLabel={gl.noLocatedTasks}
            emptyDetail={taskCoverage === 'none-plottable' ? gl.noLocatedTasksHelp : undefined}
            notice={anyCoarseTaskPin ? gl.approxPinsNote : undefined}
            markerColor="#f59e0b" className="h-72" />
        </div>
      )}

      {tab === 'games' && ((!games || searching) ? <CardSkeletonGrid /> : games.length === 0 ? (
        <EmptyState icon="🔭" title={gl.emptyTitle} body={gl.emptyText}
          action={q ? <Button variant="ghost" onClick={() => setQ('')}>{gl.clearSearch}</Button> : undefined} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((pg) => (
            <Card key={pg.id} className={`scroll-mt-20 transition ${focusId === pg.id ? 'ring-2 ring-rp-fire' : ''}`}>
              {/* Pressing a game card opens its full read-only detail (change:
                  gallery-game-card-preview) — the mission-card affordance, for
                  games. A role="button" div, not a <button>: the card contains the
                  interactive like + Copy controls, and nested interactive content
                  inside a <button> is invalid HTML and keyboard-unreachable. */}
              <div
                role="button"
                tabIndex={0}
                aria-label={pg.title}
                onClick={() => setDetailGame(pg)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailGame(pg); }
                }}
                className="p-4 flex flex-col gap-2.5 h-full cursor-pointer rounded-2xl
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
              >
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
                {/* Tags (change: game-task-tags) — publicGames has carried them since
                    the gallery existed; nothing had ever rendered them. */}
                <TagChips tags={pg.tags} more={gl.moreTags} />
                <div><LikeButton {...likeProps('game', pg.id)} /></div>
                {pg.approxLocation?.label && <span className="text-[11px] text-[--ink-3]">📍 {pg.approxLocation.label}</span>}
                {/* stopPropagation so a Copy tap duplicates the game WITHOUT also
                    opening the detail behind it. */}
                <Button disabled={copyAction.busy} loading={copyAction.isBusy(pg.id)} className="mt-auto !py-2 !text-xs !font-semibold" onClick={(e) => { e.stopPropagation(); void copyAction.run(pg); }}>{gl.copyBtn}</Button>
              </div>
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
            <Card key={tk.id} className={`scroll-mt-20 transition ${focusId === tk.id ? 'ring-2 ring-rp-fire' : ''}`}>
              {/* Pressing a mission opens its full detail (change:
                  gallery-mission-detail). A role="button" div, not a <button>: the
                  card contains the interactive like control, and nested
                  interactive content inside a <button> is invalid HTML and
                  unreachable by keyboard in Safari. */}
              <div
                role="button"
                tabIndex={0}
                aria-label={tk.title}
                onClick={() => setDetailTask(tk)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailTask(tk); }
                }}
                className="p-4 flex flex-col gap-2.5 h-full cursor-pointer rounded-2xl
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
              >
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
                {/* Tags (change: game-task-tags) — searchTaskLibrary already returns
                    them; TaskLibrary only ever copied them into the new task. */}
                <TagChips tags={tk.tags} more={gl.moreTags} />
                <div className="flex items-center justify-between gap-2 mt-auto">
                  <span className="text-[11px] text-[--ink-3]">{gl.from(tk.sourceGameTitle ?? '')}</span>
                  <LikeButton {...likeProps('task', tk.id)} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ))}

      {detailTask && (
        <GalleryTaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} />
      )}

      {detailGame && (
        <GalleryGameDetailModal
          game={detailGame}
          onClose={() => setDetailGame(null)}
          onCopy={() => void copyAction.run(detailGame)}
          copyBusy={copyAction.isBusy(detailGame.id)}
        />
      )}
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
      // The mission card around this button is itself pressable (it opens the
      // detail), so a like must stop here or every heart tap would also open a
      // modal on top of the card the creator was scanning.
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => e.stopPropagation()}
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
