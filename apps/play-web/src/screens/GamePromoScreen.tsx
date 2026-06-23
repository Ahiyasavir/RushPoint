import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { FIRESTORE_PATHS, type PublicGame } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { Button, Card, Screen } from '../components/ui';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

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
          <div className="w-8 h-8 rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin" />
        </div>
      </Screen>
    );
  }

  if (!game) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 animate-race-in">
          <div className="text-5xl">🧭</div>
          <h1 className="font-brand text-2xl font-extrabold bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent">
            Adventure not found
          </h1>
          <p className="text-zinc-500 text-sm">This game isn&apos;t public (yet). Got an access code?</p>
          <Button className="mt-2" onClick={onPlay}>Enter a code</Button>
        </div>
      </Screen>
    );
  }

  const mins = game.estimatedTotalMinutes;
  const accent = '#FF5722';

  return (
    <Screen>
      <div className="flex-1 flex flex-col animate-race-in">
        {/* Hero */}
        <div className="relative mb-6">
          {game.coverImage ? (
            <img src={game.coverImage} alt="" className="w-full h-44 object-cover rounded-2xl shadow-task-card" />
          ) : (
            <div className="w-full h-44 rounded-2xl bg-gradient-to-br from-rp-fire/20 to-rp-amber/10 flex items-center justify-center">
              <span className="text-6xl">🗺️</span>
            </div>
          )}
          {/* Badge */}
          <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1 rounded-full">
            RushPoint adventure
          </div>
        </div>

        <h1 dir="auto" className="font-brand text-3xl font-extrabold leading-tight mb-1 bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent">
          {game.title}
        </h1>
        {game.ownerDisplayName && (
          <p className="text-zinc-500 text-sm mb-3">by {game.ownerDisplayName}</p>
        )}

        {game.description && (
          <p dir="auto" className="text-zinc-400 text-sm mb-5 leading-relaxed">{game.description}</p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {[
            { label: 'Stages', value: String(game.stageCount), emoji: '📋' },
            { label: 'Tasks', value: String(game.taskCount), emoji: '✅' },
            { label: 'Time', value: mins ? `~${mins}m` : '—', emoji: '⏱️' },
          ].map((s) => (
            <div key={s.label} className="bg-app-card border border-glass-border rounded-xl px-2 py-3 text-center shadow-task-card">
              <div className="text-base mb-0.5">{s.emoji}</div>
              <div className="text-lg font-brand font-bold text-rp-fire">{s.value}</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>

        {game.approxLocation?.label && (
          <Card className="p-3 text-center text-sm text-zinc-400 mb-5">📍 {game.approxLocation.label}</Card>
        )}

        {/* CTA */}
        <Card className="p-5 text-center" style={{ borderColor: `${accent}20` }}>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl mx-auto mb-3"
            style={{ background: `${accent}15` }}
          >
            🏁
          </div>
          <div className="text-sm font-semibold text-zinc-200 mb-1">Playing in this event?</div>
          <p className="text-xs text-zinc-500 mb-4">Your host will share an access code when the race goes live.</p>
          <Button onClick={onPlay}>I have a code →</Button>
        </Card>
      </div>

      <a href={CREATOR_URL} target="_blank" rel="noreferrer"
        className="block text-center text-sm font-semibold py-4 hover:underline bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent"
      >
        ✨ Want to run your own? Build a race →
      </a>
    </Screen>
  );
}
