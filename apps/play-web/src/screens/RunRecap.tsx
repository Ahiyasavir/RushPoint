import { useEffect, useState } from 'react';
import { getRunRecap, type RunRecapResult } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { shareRecap } from '../lib/recapCollage';
import { Spinner } from '../components/Spinner';
import { shareOutcomeFeedback } from '../lib/shareFeedback';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

const MEDALS = ['🥇', '🥈', '🥉'];

function fmtTime(sec?: number): string {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/**
 * Public run recap (`?recap=<accessCode>`): standings + everyone's photo montage,
 * with a "Share recap" action that produces a single branded collage. Gated to
 * published runs server-side (non-owners get permission-denied → "not available").
 */
export default function RunRecap({ code, onJoin }: { code: string; onJoin: () => void }) {
  const { t } = useT();
  const [data, setData] = useState<RunRecapResult | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [shareNote, setShareNote] = useState<'ok' | 'copied' | null>(null);

  useEffect(() => {
    let alive = true;
    getRunRecap({ code })
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [code]);

  async function share() {
    if (!data) return;
    setBusy(true);
    try {
      const result = await shareRecap(data.photos, {
        title: data.title,
        ctaUrl: window.location.href,
        text: t.recap.shareText({ game: data.title }),
      });
      const verdict = shareOutcomeFeedback(result);
      if (verdict === 'confirm') {
        setShareNote('ok');
        setTimeout(() => setShareNote(null), 2500);
      } else if (verdict === 'fallback') {
        try { await navigator.clipboard.writeText(window.location.href); } catch { /* still show the notice */ }
        setShareNote('copied');
        setTimeout(() => setShareNote(null), 2500);
      }
      // 'silent' (user cancelled): no feedback.
    } finally { setBusy(false); }
  }

  if (data === undefined) {
    return (
      <Screen>
        <div className="flex-1 flex items-center justify-center">
          <Spinner />
        </div>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 animate-race-in">
          <div className="text-5xl">🏁</div>
          <p className="text-zinc-500 text-sm">{t.recap.notAvailable}</p>
          <Button className="mt-2" onClick={onJoin}>{t.recap.enterCode}</Button>
        </div>
      </Screen>
    );
  }

  const accent = data.branding?.primaryColor ?? '#FF5722';

  return (
    <Screen>
      <div className="flex-1 flex flex-col animate-race-in gap-4">
        <div className="text-center">
          <div className="text-5xl mb-1">🏁</div>
          <h1 dir="auto" className="font-brand text-3xl font-extrabold" style={{ color: accent }}>{data.title}</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {t.recap.summary({ teams: data.stats.teamCount, photos: data.stats.photoCount })}
          </p>
          {data.stats.winnerName && (
            <p dir="auto" className="text-sm font-semibold mt-1" style={{ color: accent }}>
              {t.recap.winner({ name: data.stats.winnerName })}
            </p>
          )}
        </div>

        {/* Photo montage */}
        {data.photos.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {data.photos.slice(0, 12).map((p, i) => (
              <img key={i} src={p.photoUrl} alt="" loading="lazy"
                className="w-full aspect-square object-cover rounded-lg" />
            ))}
          </div>
        )}

        {/* Standings */}
        <Card className="p-4">
          <div className="text-sm font-semibold text-zinc-300 mb-3 text-start">🏅 {t.recap.standings}</div>
          <div className="space-y-1.5">
            {data.standings.slice(0, 12).map((s, i) => (
              <div key={s.teamId} className="flex items-center gap-3 text-sm px-2 py-1.5 rounded-lg">
                <span className="w-6 text-center">{MEDALS[i] ?? <span className="text-zinc-500 text-xs">{s.rank}</span>}</span>
                <span dir="auto" className="flex-1 text-start font-medium text-zinc-200">{s.teamName}</span>
                {s.totalSeconds != null && <span className="text-xs text-zinc-500 font-mono">{fmtTime(s.totalSeconds)}</span>}
                <span className="font-mono text-xs font-semibold" style={{ color: accent }}>{s.score}</span>
              </div>
            ))}
          </div>
        </Card>

        <Button disabled={busy} onClick={share}>{busy ? t.recap.creating : t.recap.shareBtn}</Button>
        {shareNote && (
          <p className="text-center text-sm font-semibold text-zinc-400" role="status">
            {shareNote === 'ok' ? t.recap.shareSaved : t.recap.shareFailed}
          </p>
        )}
        <a href={CREATOR_URL} target="_blank" rel="noreferrer"
          className="block text-center text-sm font-semibold text-ink-fire hover:text-ink-amber">
          {t.recap.buildOwn}
        </a>
      </div>
    </Screen>
  );
}
