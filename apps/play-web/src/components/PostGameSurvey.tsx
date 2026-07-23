import { useEffect, useMemo, useRef, useState } from 'react';
import { FEEDBACK_ISSUES, type FeedbackIssue } from '@rushpoint/shared';
import { submitRunFeedback } from '../services/calls';
import { useT } from '../i18nContext';
import type { Session } from '../store';
import { Button } from './ui';
import { useAsyncAction } from '../hooks/useAsyncAction';

// Post-game feedback (change: post-game-feedback): a playful, tap-only survey on
// the finish screen. One question per screen, auto-advancing, every step
// skippable, shown once per device per run. Submitting is best-effort — the
// server enforces one-response-per-player and rejects a repeat gracefully.

type Answers = Record<string, number>;
const SCALE5 = ['😖', '😕', '😐', '🙂', '🤩'];
const STORE_PREFIX = 'rushpoint.feedback.';

function storeKey(runId: string) { return STORE_PREFIX + runId; }
function alreadyHandled(runId: string): boolean {
  try { return !!localStorage.getItem(storeKey(runId)); } catch { return false; }
}
function remember(runId: string, state: 'done' | 'dismissed') {
  try { localStorage.setItem(storeKey(runId), state); } catch { /* best-effort */ }
}

export default function PostGameSurvey({ session, lang }: { session: Session; lang: string }) {
  const { t } = useT();
  // If this device already answered or dismissed for this run, render nothing.
  const [hidden, setHidden] = useState(() => alreadyHandled(session.runId));
  const [ratings, setRatings] = useState<Answers>({});
  const [issues, setIssues] = useState<FeedbackIssue[]>([]);
  const [comment, setComment] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [phase, setPhase] = useState<'survey' | 'sending' | 'done'>('survey');
  const advanceTimer = useRef<number>();

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  // In-flight guard (change: wave-b/async-action-guard). Declared before the
  // `hidden` early return so the hook order is stable. The server rejects a
  // duplicate response anyway, but a double-tapped send used to fire two
  // submitRunFeedback calls and race the `phase` transition.
  const sendAction = useAsyncAction(send);

  // The step list is dynamic: the "what went wrong" step only appears when the
  // player reports the game did not run perfectly smoothly (smoothness < 3).
  const steps = useMemo(() => {
    const base = ['overall', 'content', 'bonding', 'difficulty', 'smoothness'];
    const withIssues = ratings.smoothness !== undefined && ratings.smoothness < 3 ? ['issues'] : [];
    return [...base, ...withIssues, 'recommend', 'comment'];
  }, [ratings.smoothness]);

  if (hidden) return null;

  const total = steps.length;
  const step = steps[Math.min(stepIdx, total - 1)];

  function advance() {
    setStepIdx((i) => Math.min(i + 1, total));
  }
  function answerRating(key: string, value: number) {
    setRatings((r) => ({ ...r, [key]: value }));
    // brief beat so the tap animation reads before the next question slides in.
    // Clear any pending advance first so a rapid double-tap can't schedule two
    // advances (which would skip a question / over-advance past one).
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(advance, 220);
  }
  function toggleIssue(issue: FeedbackIssue) {
    setIssues((cur) => (cur.includes(issue) ? cur.filter((i) => i !== issue) : [...cur, issue]));
  }
  function dismiss() {
    remember(session.runId, 'dismissed');
    setHidden(true);
  }

  async function send() {
    setPhase('sending');
    try {
      await submitRunFeedback({
        ownerUid: session.ownerUid, gameId: session.gameId, runId: session.runId,
        ratings,
        ...(issues.length ? { issues } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        lang,
      });
    } catch {
      // A rejected/duplicate submit still ends the survey — never trap the player.
    }
    remember(session.runId, 'done');
    setPhase('done');
  }

  if (phase === 'done') {
    return (
      <div className="rounded-2xl bg-app-card border border-glass-border px-5 py-4 my-4 text-center animate-fade-up">
        <p className="text-sm font-semibold text-zinc-200">{t.survey.thanks}</p>
      </div>
    );
  }

  const isLast = stepIdx >= total - 1; // the comment step
  const issueLabels: Record<FeedbackIssue, string> = {
    gps: t.survey.issueGps, photo: t.survey.issuePhoto, station_code: t.survey.issueStationCode,
    task_unclear: t.survey.issueTaskUnclear, slow: t.survey.issueSlow, other: t.survey.issueOther,
  };

  return (
    <div className="rounded-2xl bg-app-card border border-glass-border px-5 pt-4 pb-5 my-4 animate-fade-up">
      {/* header: title + progress + dismiss */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-zinc-200">📝 {t.survey.cardTitle}</span>
        <button onClick={dismiss} className="text-xs text-zinc-500 hover:text-zinc-400">{t.survey.dismiss}</button>
      </div>
      <div className="text-[11px] text-zinc-500 mb-3">
        {t.survey.intro} · {t.survey.progress({ cur: Math.min(stepIdx + 1, total), total })}
      </div>

      {/* progress dots */}
      <div className="flex gap-1 mb-4">
        {steps.map((s, i) => (
          <div key={s} className={`h-1 flex-1 rounded-full ${i <= stepIdx ? 'bg-accent' : 'bg-app-raised'}`} />
        ))}
      </div>

      {/* 1–5 emoji questions */}
      {(step === 'overall' || step === 'content' || step === 'bonding' || step === 'recommend') && (
        <Scale5
          prompt={
            step === 'overall' ? t.survey.qOverall
              : step === 'content' ? t.survey.qContent
                : step === 'bonding' ? t.survey.qBonding
                  : t.survey.qRecommend
          }
          low={t.survey.scaleLow}
          high={t.survey.scaleHigh}
          selected={ratings[step]}
          onPick={(v) => answerRating(step, v)}
        />
      )}

      {/* difficulty 1–3 chips */}
      {step === 'difficulty' && (
        <Chips3
          prompt={t.survey.qDifficulty}
          options={[[1, t.survey.diffEasy], [2, t.survey.diffRight], [3, t.survey.diffHard]]}
          selected={ratings.difficulty}
          onPick={(v) => answerRating('difficulty', v)}
        />
      )}

      {/* smoothness 1–3 chips (3 = perfectly smooth) */}
      {step === 'smoothness' && (
        <Chips3
          prompt={t.survey.qSmoothness}
          options={[[3, t.survey.smoothGood], [2, t.survey.smoothSome], [1, t.survey.smoothBad]]}
          selected={ratings.smoothness}
          onPick={(v) => answerRating('smoothness', v)}
        />
      )}

      {/* what went wrong — multi-select, manual advance */}
      {step === 'issues' && (
        <div>
          <p dir="auto" className="text-base font-semibold text-zinc-100 mb-1">{t.survey.issuesPrompt}</p>
          <p className="text-[11px] text-zinc-500 mb-3">{t.survey.issuesHint}</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {FEEDBACK_ISSUES.map((issue) => (
              <button
                key={issue}
                onClick={() => toggleIssue(issue)}
                className={`rounded-full border px-3 py-1.5 text-sm ${issues.includes(issue)
                  ? 'bg-accent/15 border-accent/50 text-ink-fire font-semibold'
                  : 'bg-app-raised border-glass-border text-zinc-300'}`}
              >
                {issueLabels[issue]}
              </button>
            ))}
          </div>
          <Button onClick={advance}>{t.survey.next}</Button>
        </div>
      )}

      {/* free-text comment — the only typing, last */}
      {step === 'comment' && (
        <div>
          <p dir="auto" className="text-base font-semibold text-zinc-100 mb-3">{t.survey.commentPrompt}</p>
          <textarea
            dir="auto"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t.survey.commentPlaceholder}
            className="w-full rounded-xl bg-white border border-glass-border px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-rp-fire/50 resize-none"
          />
        </div>
      )}

      {/* footer: skip (non-comment) / send (comment) */}
      <div className="flex items-center justify-between mt-4">
        {!isLast ? (
          <button onClick={advance} className="text-sm text-zinc-500 hover:text-zinc-400">{t.survey.skip}</button>
        ) : <span />}
        {isLast && (
          <Button disabled={phase === 'sending'} loading={sendAction.busy} onClick={() => void sendAction.run()}>
            {phase === 'sending' ? t.survey.sending : t.survey.send}
          </Button>
        )}
      </div>
    </div>
  );
}

function Scale5({ prompt, low, high, selected, onPick }: {
  prompt: string; low: string; high: string; selected?: number; onPick: (v: number) => void;
}) {
  return (
    <div>
      <p dir="auto" className="text-base font-semibold text-zinc-100 mb-4 text-center">{prompt}</p>
      <div className="flex justify-between gap-1 mb-2">
        {SCALE5.map((emoji, i) => {
          const value = i + 1;
          return (
            <button
              key={value}
              aria-label={String(value)}
              onClick={() => onPick(value)}
              className={`flex-1 aspect-square rounded-xl text-2xl transition-transform active:scale-90 ${selected === value
                ? 'bg-accent/15 border-2 border-accent scale-105'
                : 'bg-app-raised border border-glass-border'}`}
            >
              {emoji}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-zinc-500 px-1">
        <span>{low}</span><span>{high}</span>
      </div>
    </div>
  );
}

function Chips3({ prompt, options, selected, onPick }: {
  prompt: string; options: [number, string][]; selected?: number; onPick: (v: number) => void;
}) {
  return (
    <div>
      <p dir="auto" className="text-base font-semibold text-zinc-100 mb-4 text-center">{prompt}</p>
      <div className="flex flex-col gap-2">
        {options.map(([value, label]) => (
          <button
            key={value}
            onClick={() => onPick(value)}
            className={`rounded-xl border px-4 py-3 text-sm font-medium transition-transform active:scale-95 ${selected === value
              ? 'bg-accent/15 border-accent text-ink-fire font-semibold'
              : 'bg-app-raised border-glass-border text-zinc-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
