import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { FIRESTORE_PATHS, selectGameDescription, type PublicGame } from '@rushpoint/shared';
import { db, ensureAuth, uid } from '../services/firebase';
import { startInstantPlay } from '../services/calls';
import { saveSession, type Session } from '../store';
import { Button, Card, Screen } from '../components/ui';
import { useT } from '../i18nContext';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

export default function GamePromoScreen({ gameId, onPlay, onInstantPlay }: { gameId: string; onPlay: () => void; onInstantPlay: (s: Session) => void }) {
  const { t } = useT();
  const [game, setGame] = useState<PublicGame | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);

  async function playNow() {
    setStarting(true);
    try {
      await ensureAuth();
      const name = t.promo.soloPlayer;
      const res = await startInstantPlay({ gameId, displayName: name });
      const session: Session = {
        ownerUid: res.ownerUid, gameId: res.gameId, runId: res.runId,
        code: res.accessCode, displayName: name, teamId: uid() ?? undefined,
      };
      saveSession(session);
      onInstantPlay(session);
    } catch { setStarting(false); }
  }

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
            {t.promo.notFound}
          </h1>
          <p className="text-zinc-500 text-sm">{t.promo.notPublic}</p>
          <Button className="mt-2" onClick={onPlay}>{t.promo.enterCode}</Button>
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
            {t.promo.badge}
          </div>
        </div>

        <h1 dir="auto" className="font-brand text-3xl font-extrabold leading-tight mb-1 bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent">
          {game.title}
        </h1>
        {game.ownerDisplayName && (
          <p className="text-zinc-500 text-sm mb-3">{t.promo.by(game.ownerDisplayName)}</p>
        )}

        {/* Real description, or a neutral non-demo empty state (change:
            fix-live-launch-demo-text). Never demo placeholder copy. */}
        <p dir="auto" className="text-zinc-400 text-sm mb-3 leading-relaxed">
          {selectGameDescription(game) || t.promo.noDescription}
        </p>

        {/* Accurate GPS requirement derived server-side, when available. */}
        {game.requirement && (
          <div className="inline-flex self-start items-center text-xs font-medium text-zinc-500 bg-app-card border border-glass-border rounded-full px-3 py-1 mb-5">
            {game.requirement === 'gps' ? t.promo.reqGps : t.promo.reqAnywhere}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {[
            { label: t.promo.stages, value: String(game.stageCount), emoji: '📋' },
            { label: t.promo.tasks, value: String(game.taskCount), emoji: '✅' },
            { label: t.promo.time, value: mins ? `~${mins}m` : '?', emoji: '⏱️' },
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
          <div className="text-sm font-semibold text-zinc-200 mb-1">{t.promo.playingTitle}</div>
          <p className="text-xs text-zinc-500 mb-4">{t.promo.playingSub}</p>
          {game.allowInstantPlay && (
            <Button className="mb-2" disabled={starting} onClick={playNow}>
              {starting ? t.promo.starting : t.promo.playNow}
            </Button>
          )}
          <Button variant={game.allowInstantPlay ? 'ghost' : 'primary'} onClick={onPlay}>{t.promo.haveCode}</Button>
        </Card>
      </div>

      <a href={CREATOR_URL} target="_blank" rel="noreferrer"
        className="block text-center text-sm font-semibold py-4 hover:underline bg-gradient-to-r from-rp-fire to-rp-amber bg-clip-text text-transparent"
      >
        {t.promo.buildOwn}
      </a>
    </Screen>
  );
}
