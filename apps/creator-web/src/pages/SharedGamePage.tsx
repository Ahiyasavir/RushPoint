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
import { hasMappedMission } from '@rushpoint/shared';
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
  // A whole game can be locationless. Rendering a full-height map with an apology
  // inside it spends the most expensive space on the page saying "nothing here".
  const showRoute = hasMappedMission(game);

  return (
    <div className="max-w-3xl mx-auto pb-16">
      {/* \u2500\u2500 Header \u2500\u2500 */}
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge>{g.readOnly}</Badge>
          {game.answersRevealed && <Badge color="red">{g.answersShown}</Badge>}
        </div>
        <h1 className="text-2xl font-bold mb-1" dir="auto">{game.title}</h1>
        {game.description && <p className="text-sm text-[--ink-2] mb-2" dir="auto">{game.description}</p>}
        <p className="text-xs text-[--ink-3]">
          {g.stagesLabel({ n: game.stageCount })} \u00b7 {g.missionsLabel({ n: game.taskCount })}
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

      {/* \u2500\u2500 The route \u2500\u2500 rendered only when there is something to plot. */}
      {showRoute && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-[--ink-2] mb-2">{g.route}</h2>
          <Suspense fallback={<div className="h-64 rounded-xl bg-[--surface-2]" />}>
            <RoutePreviewMap stages={stages} className="h-64" />
          </Suspense>
        </section>
      )}

      {/* \u2500\u2500 The game itself, top to bottom \u2500\u2500
          Everything is on the page. There is no selection state and nothing to
          click: this is a document somebody was sent to READ (and often to
          print), and a game with 34 missions behind a detail panel is 34 clicks
          that nobody makes \u2014 which is exactly how a link that DOES carry the
          station codes reads as one that does not. */}
      {stages.map((stage, i) => (
        <StageSection key={stage.id} stage={stage} index={i} revealed={game.answersRevealed} />
      ))}

      <footer className="mt-10 text-center text-xs text-[--ink-3]">{g.poweredBy}</footer>
    </div>
  );
}

function StageSection({ stage, index, revealed }: {
  stage: SharedStageView;
  index: number;
  revealed: boolean;
}) {
  const g = useT().sharedGame;
  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <span className="text-xs font-medium text-[--ink-3]">{g.stage({ n: index + 1 })}</span>
        <h2 className="text-lg font-semibold" dir="auto">{stage.title}</h2>
        {stage.isFinal && <Badge>{g.finalStage}</Badge>}
      </div>
      {typeof stage.requiredTaskCount === 'number' && (
        <p className="text-xs text-[--ink-3] mb-2">{g.requiredTaskCount({ n: stage.requiredTaskCount })}</p>
      )}
      {stage.narrative?.intro?.body && (
        <p className="text-sm text-[--ink-2] mb-3 border-s-2 border-[--rp-border] ps-3" dir="auto">
          {stage.narrative.intro.body}
        </p>
      )}
      {stage.tasks.length === 0 && <p className="text-sm text-[--ink-3]">{g.noMissions}</p>}
      <div className="space-y-3">
        {stage.tasks.map((task, n) => (
          <MissionCard key={task.id} task={task} index={n} revealed={revealed} />
        ))}
      </div>
    </section>
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

/**
 * Does this mission type have an answer the creator was supposed to author?
 *
 * Used ONLY to decide whether a revealing link says "not set" instead of drawing
 * nothing. A silently missing row cannot be told apart from a withheld one, and
 * that ambiguity is what made a link which really did carry every station code
 * read as a link that carried none.
 */
function expectsAnswer(task: SharedTaskView): boolean {
  return task.type === 'quiz' || task.type === 'numeric' || task.type === 'sequence';
}

function MissionCard({ task, index, revealed }: {
  task: SharedTaskView;
  index: number;
  revealed: boolean;
}) {
  const g = useT().sharedGame;
  const answerText = task.answers?.length
    ? task.answers.join(' · ')
    : (typeof task.numericAnswer === 'number' ? String(task.numericAnswer) : null);
  return (
    <article className="rounded-xl border border-[--rp-border] p-4">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xs text-[--ink-3]">{index + 1}</span>
        <h3 className="font-semibold" dir="auto">{task.title}</h3>
      </div>
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
      {/* On a revealing link the answer and the station code are stated even when
          the creator left them blank — an unfinished mission is exactly what a
          reviewer is looking for, and a blank row says so out loud. */}
      {answerText !== null && <Row label={g.fieldAnswer}>{answerText}</Row>}
      {answerText === null && revealed && expectsAnswer(task) && (
        <Row label={g.fieldAnswer}><span className="text-[--ink-3]">{g.notSet}</span></Row>
      )}
      {task.secretCode && <Row label={g.fieldCode}>{task.secretCode}</Row>}
      {!task.secretCode && revealed && task.type === 'smart_station' && (
        <Row label={g.fieldCode}><span className="text-[--ink-3]">{g.notSet}</span></Row>
      )}

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
    </article>
  );
}
