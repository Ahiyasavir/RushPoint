import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { FIRESTORE_PATHS, type PublicTask, type PublicGame } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { checkChallengeAnswer } from '../services/calls';
import { Button, Card, Screen } from '../components/ui';
import { useT } from '../i18nContext';
import { shareChallenge } from '../lib/challengeCard';
import { shareOutcomeFeedback } from '../lib/shareFeedback';

const CREATOR_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5180`
  : ((import.meta.env.VITE_CREATOR_URL as string | undefined) ?? 'https://rushpoint-creator.web.app');

const COUNTDOWN = 30;

/**
 * Standalone viral teaser opened from a `?challenge=<gameId>:<taskId>` deep link.
 * Shows one task's question with a fun (non-scoring) 30s timer; the answer is
 * checked server-side via checkChallengeAnswer (key never leaves the server),
 * then a strong CTA pulls the visitor into joining or building a game.
 */
export default function ChallengeTeaser({
  gameId, taskId, onJoin,
}: { gameId: string; taskId: string; onJoin: () => void }) {
  const { t } = useT();
  const [task, setTask] = useState<PublicTask | null | undefined>(undefined);
  const [gameName, setGameName] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareNote, setShareNote] = useState<'ok' | 'copied' | null>(null);
  const [left, setLeft] = useState(COUNTDOWN);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getDoc(doc(db, FIRESTORE_PATHS.publicTask(`${gameId}_${taskId}`))),
      getDoc(doc(db, FIRESTORE_PATHS.publicGame(gameId))),
    ]).then(([taskSnap, gameSnap]) => {
      if (!alive) return;
      setTask(taskSnap.exists() ? (taskSnap.data() as PublicTask) : null);
      if (gameSnap.exists()) setGameName((gameSnap.data() as PublicGame).title);
    }).catch(() => { if (alive) setTask(null); });
    return () => { alive = false; };
  }, [gameId, taskId]);

  // Fun countdown — purely cosmetic (non-scoring). Stops at zero.
  useEffect(() => {
    if (task == null || result) return;
    timer.current = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { if (timer.current) clearInterval(timer.current); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [task, result]);

  async function submit() {
    // Guard against a late Enter after the countdown expires (defense-in-depth;
    // the input is also disabled once time is up).
    if (!answer.trim() || busy || left === 0) return;
    setBusy(true);
    try {
      const { correct } = await checkChallengeAnswer({ gameId, taskId, answer: answer.trim() });
      setResult(correct ? 'correct' : 'wrong');
      if (timer.current) clearInterval(timer.current);
    } catch {
      setResult('wrong');
    } finally { setBusy(false); }
  }

  async function share() {
    // Busy guard so a double-tap can't fire two share sheets.
    if (busy) return;
    setBusy(true);
    try {
      const result = await shareChallenge({
        gameId, taskId,
        question: task?.title ?? '',
        gameName,
        playBaseUrl: window.location.origin,
        ctaText: t.challenge.shareText({ game: gameName || 'RushPoint' }),
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

  if (task === undefined) {
    return (
      <Screen>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin" />
        </div>
      </Screen>
    );
  }

  if (!task) {
    return (
      <Screen>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 animate-race-in">
          <div className="text-5xl">🧭</div>
          <p className="text-zinc-500 text-sm">{t.challenge.notFound}</p>
          <Button className="mt-2" onClick={onJoin}>{t.challenge.ctaJoin}</Button>
        </div>
      </Screen>
    );
  }

  const timesUp = left === 0 && !result;

  return (
    <Screen>
      <div className="flex-1 flex flex-col animate-race-in gap-4">
        <div className="text-center">
          <div className="inline-block text-[11px] font-semibold uppercase tracking-widest text-ink-fire bg-rp-fire/10 rounded-full px-3 py-1">
            {t.challenge.badge}
          </div>
          <p className="text-zinc-500 text-sm mt-2">{t.challenge.tagline}</p>
        </div>

        {/* Timer ring */}
        {!result && (
          <div className="flex items-center justify-center">
            <div className={`text-3xl font-brand font-extrabold ${left <= 5 ? 'text-ink-fire' : 'text-zinc-300'}`}>
              {timesUp ? t.challenge.timesUp : t.challenge.timeLeft({ sec: left })}
            </div>
          </div>
        )}

        {/* The question */}
        <Card className="p-5">
          <h1 dir="auto" className="font-brand text-xl font-extrabold text-zinc-100">{task.title}</h1>
          {task.description && (
            <p dir="auto" className="text-sm text-zinc-400 mt-2 whitespace-pre-wrap">{task.description}</p>
          )}
        </Card>

        {result == null ? (
          <Card className="p-4">
            <input
              dir="auto"
              value={answer}
              disabled={timesUp}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder={t.challenge.yourAnswer}
              className="w-full bg-app-raised rounded-xl px-4 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-rp-fire/40 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <Button className="mt-3 w-full" disabled={busy || !answer.trim() || timesUp} onClick={submit}>
              {t.challenge.submit}
            </Button>
          </Card>
        ) : (
          <Card className={`p-4 text-center ${result === 'correct' ? 'border-emerald-400/40' : 'border-rp-fire/40'}`}>
            <p className="text-lg font-semibold text-zinc-100">
              {result === 'correct' ? t.challenge.correct : t.challenge.wrong}
            </p>
            {result === 'wrong' && (
              <Button variant="ghost" className="mt-2" onClick={() => { setResult(null); setAnswer(''); }}>
                {t.challenge.tryAgain}
              </Button>
            )}
          </Card>
        )}

        {/* CTA — always present so the teaser converts even mid-attempt */}
        <Card className="p-4 mt-auto text-center">
          <p className="text-sm text-zinc-300 mb-3">{t.challenge.ctaTitle}</p>
          <Button className="w-full" onClick={onJoin}>{t.challenge.ctaJoin}</Button>
          <a href={CREATOR_URL} target="_blank" rel="noreferrer"
            className="block mt-2 text-sm font-semibold text-ink-fire hover:text-ink-amber">
            {t.challenge.ctaBuild}
          </a>
          <button onClick={share} disabled={busy}
            className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50">
            {t.challenge.shareBtn}
          </button>
          {shareNote && (
            <p className="mt-2 text-xs font-semibold text-zinc-400" role="status">
              {shareNote === 'ok' ? t.challenge.shareSaved : t.challenge.shareFailed}
            </p>
          )}
        </Card>
      </div>
    </Screen>
  );
}
