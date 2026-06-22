import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { FIRESTORE_PATHS, type PublicGame } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { Button, Card, Screen } from '../components/ui';

// The creator app — where the viral "build your own" CTA points.
const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

// Public game promo / teaser page (`?game=<id>`). A creator shares this link/QR
// to recruit players *before* the event — it reads the public gallery snapshot
// (publicGames/{id}, world-readable) and shows what the adventure is, then lets
// the visitor enter a code once the host goes live, or build their own.
export default function GamePromoScreen({ gameId, onPlay }: { gameId: string; onPlay: () => void }) {
  const [game, setGame] = useState<PublicGame | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getDoc(doc(db, FIRESTORE_PATHS.publicGame(gameId)))
      .then((snap) => { if (alive) setGame(snap.exists() ? (snap.data() as PublicGame) : null); })
      .catch(() => { if (alive) setGame(null); });
    return () => { alive = false; };
  }, [gameId]);

  if (game === undefined) {
    return (
      <Screen>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
        </div>
      </Screen>
    );
  }

  // Unknown / unpublished game → fall back to the normal join flow.
  if (!game) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <div className="text-5xl">🧭</div>
          <h1 className="font-brand text-2xl font-extrabold text-accent">Adventure not found</h1>
          <p className="text-zinc-500 text-sm">This game isn&apos;t public (yet). Got an access code?</p>
          <Button className="mt-2" onClick={onPlay}>Enter a code</Button>
        </div>
      </Screen>
    );
  }

  const mins = game.estimatedTotalMinutes;
  return (
    <Screen>
      <div className="flex-1 flex flex-col">
        <div className="text-center mb-6">
          <div className="text-xs uppercase tracking-widest text-zinc-500">RushPoint race adventure</div>
          <h1 dir="auto" className="font-brand text-3xl font-extrabold text-accent mt-1 leading-tight">{game.title}</h1>
          {game.ownerDisplayName && <p className="text-zinc-500 text-sm mt-1">by {game.ownerDisplayName}</p>}
        </div>

        {game.coverImage && (
          <img src={game.coverImage} alt="" className="w-full h-40 object-cover rounded-2xl mb-5" />
        )}

        {game.description && (
          <p dir="auto" className="text-zinc-300 text-center mb-6">{game.description}</p>
        )}

        <div className="grid grid-cols-3 gap-3 mb-6">
          <Stat label="Stages" value={String(game.stageCount)} />
          <Stat label="Tasks" value={String(game.taskCount)} />
          <Stat label="Time" value={mins ? `~${mins}m` : '—'} />
        </div>

        {game.approxLocation?.label && (
          <Card className="p-3 text-center text-sm text-zinc-400 mb-6">📍 {game.approxLocation.label}</Card>
        )}

        <Card className="p-4 text-center">
          <div className="text-sm text-zinc-300 mb-1">Playing in this event?</div>
          <p className="text-xs text-zinc-500 mb-3">Your host will share an access code when the race goes live.</p>
          <Button onClick={onPlay}>I have a code →</Button>
        </Card>
      </div>

      <a href={CREATOR_URL} target="_blank" rel="noreferrer"
        className="block text-center text-sm text-accent font-medium py-4 hover:underline">
        ✨ Want to run your own? Build a race adventure →
      </a>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-app-card border border-glass-border rounded-xl px-2 py-3 text-center">
      <div className="text-lg font-bold text-zinc-100">{value}</div>
      <div className="text-[11px] text-zinc-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
