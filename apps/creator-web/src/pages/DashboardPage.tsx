import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Game } from '@rushpoint/shared';
import { createGame, updateGame, listGames, launchRun, deleteGame, publishGame } from '../services/calls';
import { Badge, Button, Card, Spinner } from '../components/ui';
import { dialog } from '../components/dialog';
import { ShareSheet } from '../components/ShareSheet';
import { TEMPLATES, type GameTemplate } from '../templates';

// Where the participant app lives — promo links point players there (?game=<id>).
const PLAY_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5181`
  : ((import.meta.env.VITE_PLAY_URL as string | undefined) ?? 'https://rushpoint-play.web.app');

export default function DashboardPage() {
  const nav = useNavigate();
  const [games, setGames] = useState<Game[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState<Game | null>(null);

  async function load() {
    const { games } = await listGames();
    setGames(games);
  }
  useEffect(() => { void load(); }, []);

  async function newGame(tpl: GameTemplate) {
    setBusy(true); setPicking(false);
    try {
      const title = tpl.key === 'blank' ? 'Untitled adventure' : tpl.label;
      const { gameId } = await createGame({ title, mode: tpl.mode, tags: [] });
      const stages = tpl.build().map((s, i) => ({ ...s, order: i }));
      await updateGame({ gameId, stages, scoringPreset: tpl.scoringPreset });
      nav(`/build/${gameId}`);
    } finally { setBusy(false); }
  }

  async function launch(g: Game) {
    if (g.stages.length === 0) { await dialog.alert('Add at least one stage before launching.'); return; }
    setBusy(true);
    try {
      const { runId } = await launchRun({ gameId: g.id });
      nav(`/run/${g.id}/${runId}`);
    } catch (e) {
      await dialog.alert(e instanceof Error ? e.message : 'Launch failed');
    } finally { setBusy(false); }
  }

  async function remove(g: Game) {
    if (!(await dialog.confirm(`Delete "${g.title}"? This cannot be undone.`, 'Delete'))) return;
    await deleteGame({ gameId: g.id });
    void load();
  }

  async function togglePublish(g: Game) {
    await publishGame({ gameId: g.id, visibility: g.visibility === 'public' ? 'private' : 'public' });
    void load();
  }

  if (!games) return <Spinner label="Loading your games…" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Games</h1>
          <p className="text-zinc-500 text-sm">Build freely, then launch a live run with friends.</p>
        </div>
        <Button disabled={busy} onClick={() => setPicking(true)}>+ New game</Button>
      </div>

      {games.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-zinc-400 mb-4">You haven&apos;t built anything yet.</p>
          <Button disabled={busy} onClick={() => setPicking(true)}>Create your first game</Button>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((g) => {
            const taskCount = g.stages.reduce((s, st) => s + st.tasks.length, 0);
            return (
              <Card key={g.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{g.title}</h3>
                  <Badge color={g.visibility === 'public' ? 'cyan' : 'zinc'}>{g.visibility}</Badge>
                </div>
                <p className="text-xs text-zinc-500 line-clamp-2 min-h-[2rem]">{g.description || 'No description'}</p>
                <div className="flex gap-2 text-[11px] text-zinc-500">
                  <span>{g.stages.length} stages</span>·
                  <span>{taskCount} tasks</span>·
                  <span>{g.mode}</span>·
                  <span>{g.playCount} plays</span>
                </div>
                <div className="flex gap-2 mt-1">
                  <Button variant="subtle" className="flex-1" onClick={() => nav(`/build/${g.id}`)}>Edit</Button>
                  <Button className="flex-1" disabled={busy} onClick={() => launch(g)}>Launch run</Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 text-xs" onClick={() => togglePublish(g)}>
                    {g.visibility === 'public' ? 'Unpublish' : 'Publish to gallery'}
                  </Button>
                  <Button variant="ghost" className="flex-1 text-xs" onClick={() => setSharing(g)}>Share</Button>
                  <Button variant="ghost" className="text-xs text-neon-red" onClick={() => remove(g)}>Delete</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPicking(false)}>
          <div className="bg-app-card border border-glass-border rounded-2xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Start a new game</h3>
              <button onClick={() => setPicking(false)} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {TEMPLATES.map((t) => (
                <button key={t.key} disabled={busy} onClick={() => newGame(t)}
                  className="text-start rounded-xl border border-glass-border bg-app-bg p-4 hover:border-neon-green/50 hover:bg-glass-hover transition disabled:opacity-40">
                  <div className="text-2xl mb-1">{t.emoji}</div>
                  <div className="font-medium text-zinc-100">{t.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {sharing && (
        <ShareSheet
          title={`Share "${sharing.title}"`}
          text={`Join my RushPoint race adventure: ${sharing.title}`}
          url={`${PLAY_URL}/?game=${sharing.id}`}
          notPublic={sharing.visibility !== 'public'}
          onPublish={async () => {
            await publishGame({ gameId: sharing.id, visibility: 'public' });
            setSharing({ ...sharing, visibility: 'public' });
            void load();
          }}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
