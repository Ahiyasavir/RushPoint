import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicGame, PublicTask } from '@rushpoint/shared';
import { searchGallery, searchTaskLibrary, duplicateGame } from '../services/calls';
import { Badge, Button, Card, Input, Spinner } from '../components/ui';
import { dialog } from '../components/dialog';
import GalleryMap from '../components/GalleryMap';

export default function GalleryPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'games' | 'tasks'>('games');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [q, setQ] = useState('');
  const [games, setGames] = useState<PublicGame[] | null>(null);
  const [tasks, setTasks] = useState<PublicTask[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  function focusGame(id: string) {
    setFocusId(id);
    document.getElementById(`game-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function run() {
    if (tab === 'games') { const { games } = await searchGallery({ query: q }); setGames(games); }
    else { const { tasks } = await searchTaskLibrary({ query: q }); setTasks(tasks); }
  }
  useEffect(() => { run(); /* eslint-disable-next-line */ }, [tab]);

  async function copy(g: PublicGame) {
    setBusy(true);
    try {
      const { gameId } = await duplicateGame({ gameId: g.id, sourceOwnerUid: g.ownerUid });
      nav(`/build/${gameId}`);
    } catch (e) { await dialog.alert(e instanceof Error ? e.message : 'Copy failed'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Gallery</h1>
      <p className="text-zinc-500 text-sm mb-5">Discover public adventures and reusable tasks. Copy any into your account.</p>

      <div className="flex gap-2 mb-4 items-center">
        {(['games', 'tasks'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? 'bg-app-raised text-zinc-100' : 'text-zinc-400'}`}>
            {t === 'games' ? 'Public games' : 'Task library'}
          </button>
        ))}
        {tab === 'games' && (
          <div className="ms-auto flex gap-1 bg-app-raised rounded-lg p-0.5">
            {(['list', 'map'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md text-xs capitalize ${view === v ? 'bg-neon-green/15 text-neon-green' : 'text-zinc-400'}`}>
                {v}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or tag…" onKeyDown={(e) => e.key === 'Enter' && run()} />
        <Button onClick={run}>Search</Button>
      </div>

      {tab === 'games' && view === 'map' && games && games.length > 0 && (
        <div className="mb-4"><GalleryMap games={games} onSelect={focusGame} className="h-72" /></div>
      )}

      {tab === 'games' && (!games ? <Spinner /> : games.length === 0 ? <Empty /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((g) => (
            <Card key={g.id} className={`p-4 flex flex-col gap-2 scroll-mt-20 transition ${focusId === g.id ? 'ring-2 ring-neon-green' : ''}`}>
              <div id={`game-${g.id}`} className="flex items-start justify-between">
                <h3 className="font-semibold">{g.title}</h3>
                <Badge color="cyan">{g.mode}</Badge>
              </div>
              <p className="text-xs text-zinc-500 line-clamp-2 min-h-[2rem]">{g.description}</p>
              <div className="flex gap-2 text-[11px] text-zinc-500">
                <span>{g.stageCount} stages</span>·<span>{g.taskCount} tasks</span>·<span>~{g.estimatedTotalMinutes}m</span>·<span>{g.playCount} plays</span>
              </div>
              {g.approxLocation?.label && <span className="text-[11px] text-zinc-600">📍 {g.approxLocation.label}</span>}
              <Button disabled={busy} className="mt-1" onClick={() => copy(g)}>Copy to my games</Button>
            </Card>
          ))}
        </div>
      ))}

      {tab === 'tasks' && (!tasks ? <Spinner /> : tasks.length === 0 ? <Empty /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((t) => (
            <Card key={t.id} className="p-4 flex flex-col gap-2">
              <h3 className="font-semibold text-sm">{t.title}</h3>
              <p className="text-xs text-zinc-500 line-clamp-2 min-h-[2rem]">{t.description}</p>
              <div className="flex gap-2 text-[11px] text-zinc-500">
                <span>{t.type}</span>·<span>diff {t.difficulty}</span>·<span>{t.pointValue} pts</span>·<span>{t.copyCount} copies</span>
              </div>
              <span className="text-[11px] text-zinc-600">from {t.sourceGameTitle}</span>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return <Card className="p-12 text-center text-zinc-500">Nothing here yet. Publish a game to seed the gallery.</Card>;
}
