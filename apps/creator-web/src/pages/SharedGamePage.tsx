// The page a share link opens (change: game-share-link).
//
// Someone was handed a URL to a game that is NOT in the gallery. They may have no
// account at all — AuthGate serves this route without one — so everything here
// has to work read-only and explain itself: what this is, who can do what with
// it, and how to take a copy.
//
// It renders the Builder's shape (stage rail → mission list → mission detail →
// route map) deliberately, so the recipient sees the game the way its author
// does. It does NOT reuse BuilderPage: that component owns autosave, an unload
// guard, undo history and launch, and a `readOnly` flag threaded through it would
// be one missed branch away from a stranger writing to somebody else's game. The
// only data it can even hold is SharedGameView — a projection with no answer keys
// in it — so there is nothing here to write back with.
import { Suspense, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SharedGameView, SharedStageView, SharedTaskView } from '@rushpoint/shared';
import { Button, Spinner, Badge } from '../components/ui';
import { toast } from '../components/toast';
import { useT } from '../components/LanguageContext';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { getSharedGame, duplicateGame } from '../services/calls';
import { SHARE_RETURN_KEY } from '../lib/publicCreatorPath';

const RoutePreviewMap = lazyWithRetry('sharedRouteMap', () => import('../components/RoutePreviewMap'));

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; game: SharedGameView; allowCopy: boolean }
  | { phase: 'gone'; reason: 'not-found' | 'revoked' | 'expired' };

/**
 * The server answers every dead link with `not-found` + a machine-readable reason
 * (`share-link:revoked`). Saying WHICH is safe — the person already holds the
 * link — and it is the difference between "you were sent a dud" and "this was
 * turned off, ask for a new one".
 */
function reasonFrom(error: unknown): 'not-found' | 'revoked' | 'expired' {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('share-link:revoked')) return 'revoked';
  if (message.includes('share-link:expired')) return 'expired';
  return 'not-found';
}

export default function SharedGamePage({ token: tokenProp, signedIn = true }: {
  /** Passed by AuthGate for a signed-out visitor; the route supplies it via params. */
  token?: string;
  signedIn?: boolean;
}) {
  const params = useParams<{ token?: string }>();
  const token = tokenProp ?? params.token ?? '';
  const t = useT();
  const g = t.sharedGame;
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [openStage, setOpenStage] = useState(0);
  const [openTask, setOpenTask] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    getSharedGame({ token })
      .then(({ game, allowCopy }) => { if (alive) setState({ phase: 'ready', game, allowCopy }); })
      .catch((e) => { if (alive) setState({ phase: 'gone', reason: reasonFrom(e) }); });
    return () => { alive = false; };
  }, [token]);

  const copy = useAsyncAction(async () => {
    if (!signedIn) {
      // Come back here after the login screen instead of dumping them on a
      // dashboard with no idea what they just signed up for.
      try { sessionStorage.setItem(SHARE_RETURN_KEY, token); } catch { /* private mode */ }
      window.location.assign(import.meta.env.BASE_URL || '/');
      return;
    }
    try {
      const { gameId } = await duplicateGame({ shareToken: token });
      toast.success(g.copyDone);
      navigate(`/build/${gameId}`);
    } catch {
      toast.error(g.copyError);
    }
  });

  if (state.phase === 'loading') {
    return <div className="py-20"><Spinner label={g.loading[0]} /></div>;
  }

  if (state.phase === 'gone') {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">🔗</div>
        <h1 className="text-lg font-semibold mb-2">{g.notFoundTitle}</h1>
        <p className="text-sm text-[--ink-3]">
          {state.reason === 'revoked' ? g.revoked : state.reason === 'expired' ? g.expired : g.notFound}
        </p>
      </div>
    );
  }

  const { game, allowCopy } = state;
  const stages = [...game.stages].sort((a, b) => a.order - b.order);
  const stage: SharedStageView | undefined = stages[Math.min(openStage, stages.length - 1)];
  const task = stage?.tasks.find((x) => x.id === openTask) ?? null;

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* ── Header ── */}
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge>{g.readOnly}</Badge>
          {game.answersRevealed && <Badge color="red">{g.answersShown}</Badge>}
        </div>
        <h1 className="text-2xl font-bold mb-1" dir="auto">{game.title}</h1>
        {game.description && <p className="text-sm text-[--ink-2] mb-2" dir="auto">{game.description}</p>}
        <p className="text-xs text-[--ink-3]">
          {g.stagesLabel({ n: game.stageCount })} · {g.missionsLabel({ n: game.taskCount })}
        </p>
        <p className="text-xs text-[--ink-3] mt-1">{g.readOnlyHelp}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {allowCopy ? (
            <Button onClick={() => void copy.run()} loading={copy.busy}>
              {copy.busy ? g.copying : signedIn ? g.copyCta : g.signInToCopy}
            </Button>
          ) : (
            <span className="text-xs text-[--ink-3]">{g.copyDisabled}</span>
          )}
          {allowCopy && !signedIn && <span className="text-xs text-[--ink-3]">{g.signInHint}</span>}
        </div>
      </header>

      {/* ── The route ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-[--ink-2] mb-2">{g.route}</h2>
        <Suspense fallback={<div className="h-64 rounded-xl bg-[--surface-2]" />}>
          <RoutePreviewMap stages={stages} className="h-64" />
        </Suspense>
      </section>

      {/* ── Stages → missions → detail ── */}
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
        <div>
          {/* Stage rail */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {stages.map((st, i) => (
              <button
                key={st.id}
                onClick={() => { setOpenStage(i); setOpenTask(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  i === openStage
                    ? 'border-rp-fire/60 bg-rp-fire/10 text-ink-fire'
                    : 'border-[--rp-border] text-[--ink-3] hover:text-[--ink-1]'
                }`}
              >
                {st.title || g.stage({ n: i + 1 })}
              </button>
            ))}
          </div>

          {stage && (
            <>
              {stage.isFinal && <div className="text-xs text-[--ink-3] mb-2">{g.finalStage}</div>}
              {typeof stage.requiredTaskCount === 'number' && (
                <div className="text-xs text-[--ink-3] mb-2">
                  {g.requiredTaskCount({ n: stage.requiredTaskCount })}
                </div>
              )}
              {stage.tasks.length === 0 && <p className="text-sm text-[--ink-3]">{g.noMissions}</p>}
              <ul className="space-y-1.5">
                {stage.tasks.map((tk, i) => (
                  <li key={tk.id}>
                    <button
                      onClick={() => setOpenTask(tk.id === openTask ? null : tk.id)}
                      className={`w-full text-start px-3 py-2 rounded-xl border transition-colors ${
                        tk.id === openTask
                          ? 'border-rp-fire/60 bg-rp-fire/5'
                          : 'border-[--rp-border] hover:bg-[--surface-2]'
                      }`}
                    >
                      <span className="text-xs text-[--ink-3] me-2">{i + 1}</span>
                      <span className="text-sm" dir="auto">{tk.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="rounded-xl border border-[--rp-border] p-4 min-h-[200px]">
          {task ? <MissionDetail task={task} /> : <p className="text-sm text-[--ink-3]">{g.selectMission}</p>}
        </div>
      </div>

      <footer className="mt-10 text-center text-xs text-[--ink-3]">{g.poweredBy}</footer>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm py-1 border-b border-[--rp-border] last:border-0">
      <span className="text-[--ink-3] shrink-0">{label}</span>
      <span className="text-[--ink-1] break-words" dir="auto">{children}</span>
    </div>
  );
}

function MissionDetail({ task }: { task: SharedTaskView }) {
  const g = useT().sharedGame;
  return (
    <div>
      <h3 className="font-semibold mb-1" dir="auto">{task.title}</h3>
      {task.description && <p className="text-sm text-[--ink-2] mb-3" dir="auto">{task.description}</p>}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {task.locationless && <Badge>{g.locationless}</Badge>}
        {task.hideLocation && <Badge>{g.hiddenLocation}</Badge>}
        {!task.locationless && !task.coordinates && <Badge>{g.noLocation}</Badge>}
      </div>

      <Row label={g.fieldType}>{g.types[task.type as keyof typeof g.types] ?? g.types.other}</Row>
      {typeof task.pointValue === 'number' && <Row label={g.fieldPoints}>{task.pointValue}</Row>}
      {typeof task.difficulty === 'number' && <Row label={g.fieldDifficulty}>{task.difficulty}</Row>}
      {typeof task.estimatedMinutes === 'number' && (
        <Row label={g.fieldMinutes}>{g.minutes({ n: task.estimatedMinutes })}</Row>
      )}
      {task.locationClue && <Row label={g.fieldClue}>{task.locationClue}</Row>}
      {task.choices && task.choices.length > 0 && <Row label={g.fieldChoices}>{task.choices.join(' · ')}</Row>}

      {/* The hint: its EXISTENCE and its cost always, its text only when the link
          reveals answers (the projection simply does not carry it otherwise). */}
      {task.hasHint && (
        <Row label={g.fieldHint}>
          {task.hint ?? g.hintHidden}
          {typeof task.hintPenalty === 'number' && (
            <span className="text-[--ink-3] ms-2">({g.hintCost({ n: task.hintPenalty })})</span>
          )}
        </Row>
      )}
      {task.answers && task.answers.length > 0 && <Row label={g.fieldAnswer}>{task.answers.join(' · ')}</Row>}
      {typeof task.numericAnswer === 'number' && <Row label={g.fieldAnswer}>{task.numericAnswer}</Row>}
      {task.secretCode && <Row label={g.fieldCode}>{task.secretCode}</Row>}

      {task.steps && task.steps.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-[--ink-3] mb-1">{g.fieldSteps}</div>
          <ol className="list-decimal ms-5 text-sm space-y-1">
            {task.steps.map((s) => (
              <li key={s.id} dir="auto">
                {s.prompt}
                {s.answer && <span className="text-[--ink-3] ms-2">→ {s.answer}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {task.media && task.media.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-[--ink-3] mb-1">{g.fieldMedia}</div>
          <div className="flex flex-wrap gap-2">
            {task.media.map((m) => (
              m.kind === 'image'
                ? <img key={m.id} src={m.url} alt={m.caption ?? ''} className="h-24 rounded-lg object-cover" />
                : <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="text-xs underline text-ink-fire">{m.url}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
