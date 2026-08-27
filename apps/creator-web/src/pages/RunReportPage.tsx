import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ReportAnswerRow, ReportPlayerRow, RunPlayerReport } from '@rushpoint/shared';
import { Badge, Button, Card, EmptyState, Skeleton } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { toast } from '../components/toast';
import { useLanguage, useT } from '../components/LanguageContext';
import { getRunPlayerReport } from '../services/calls';
import { downloadReportWorkbook, type ReportExportLabels } from '../lib/runReportExport';

// The post-run analysis (change: post-run-player-report).
//
// One page answering the question a creator actually has after an event: who
// played, how each of them did, and — mission by mission — what they answered.
//
// THE DESIGN RULE HERE IS THE SAME ONE THE EXPORT FOLLOWS: an empty answer must
// never be ambiguous. A mission with no answer channel, a mission the player never
// answered, and an answer that was never recorded look different on screen and
// read differently, because a creator would act differently on each — and showing
// all three as blank would tell a teacher their class answered nothing.
//
// The workbook library is NOT imported at module scope. `downloadReportWorkbook`
// dynamic-imports it, so `write-excel-file` never enters the console's entry
// chunk to serve one button on one route.
export default function RunReportPage() {
  const nav = useNavigate();
  const t = useT();
  const { lang } = useLanguage();
  const r = t.runReport;
  const { gameId = '', runId = '' } = useParams();

  const [report, setReport] = useState<RunPlayerReport | null>(null);
  const [errored, setErrored] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrored(false);
    try {
      setReport(await getRunPlayerReport({ gameId, runId }));
    } catch {
      setErrored(true);
    }
  }, [gameId, runId]);

  useEffect(() => { void load(); }, [load]);

  // Every string the workbook shows comes from the dictionary, so the exported
  // file is in the creator's own language rather than in whatever the code was
  // written in.
  const exportLabels: ReportExportLabels = useMemo(() => ({
    sheetPlayers: r.sheetPlayers,
    sheetAnswers: r.sheetAnswers,
    sheetMissions: r.sheetMissions,
    notRecorded: r.notRecorded,
    noAnswerNeeded: '—',
    notAnswered: r.notAnswered,
    correct: r.correct,
    wrong: r.wrong,
    yes: r.yes,
    no: r.no,
    columns: {
      player: r.player, members: r.colMembers, rank: r.rank, score: r.score,
      penalty: r.penalty, status: r.colStatus, started: r.colStarted,
      finished: r.colFinished, durationMinutes: r.colDuration,
      missionsDone: r.colMissionsDone, missionsSkipped: r.colMissionsSkipped,
      hints: r.hints, wrongAnswers: r.wrongAnswers, media: r.media,
      stage: r.colStage, mission: r.colMission, type: r.colType,
      question: r.question, expected: r.expected, theirAnswer: r.theirAnswer,
      verdict: r.colVerdict, attempts: r.colAttempts, points: r.colPointsEarned,
      minutes: r.colDuration, mediaLink: r.colMediaLink,
      players: r.players, completed: r.colCompleted, skipped: r.colSkipped,
      completionRate: r.colCompletionRate, medianMinutes: r.colMedianMinutes,
    },
  }), [r]);

  async function onExport() {
    if (!report) return;
    setExporting(true);
    try {
      await downloadReportWorkbook(report, exportLabels, { rightToLeft: lang === 'he' });
      toast.success(r.exportDone);
    } catch {
      // A failed export must say so. The dynamic import can fail on a flaky
      // connection, and a button that silently does nothing reads as a broken app.
      toast.error(r.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  if (!report && !errored) {
    return (
      <div className="max-w-4xl mx-auto">
        <Skeleton className="h-8 w-56 mb-2" />
        <Skeleton className="h-4 w-80 mb-5" />
        <LoadingState messages={r.loading} className="!py-6" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      </div>
    );
  }

  if (errored || !report) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="p-0">
          <EmptyState
            icon="📊"
            title={r.loadError}
            body=""
            action={<Button onClick={() => void load()}>{r.retry}</Button>}
          />
        </Card>
      </div>
    );
  }

  const { meta, players, answers } = report;
  const completion = meta.missionCount > 0 && players.length > 0
    ? players.reduce((n, p) => n + p.missionsCompleted, 0)
      / (players.length * meta.missionCount)
    : 0;

  return (
    <div className="max-w-4xl mx-auto">
      <button
        type="button"
        onClick={() => nav(`/history?game=${encodeURIComponent(meta.gameId)}`)}
        className="text-xs text-[--ink-3] hover:text-ink-fire mb-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
      >
        ← {r.back}
      </button>

      <h1 className="font-brand text-2xl font-extrabold tracking-tight text-[--ink-1] mb-1" dir="auto">
        {meta.gameTitle}
      </h1>
      <p className="text-sm text-[--ink-3] mb-4">{r.title}</p>

      {/* At-a-glance numbers. Six tiles, not a paragraph: this is the first thing
          a creator looks at and it has to be readable in one glance. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <Stat label={r.played} value={formatDate(meta.finishedAt || meta.launchedAt)} />
        <Stat label={r.duration} value={formatDuration(meta.launchedAt, meta.finishedAt)} />
        <Stat label={r.players} value={String(meta.playerCount)} />
        <Stat label={r.missions} value={String(meta.missionCount)} />
        <Stat label={r.completion} value={`${Math.round(completion * 100)}%`} />
        <Stat label={r.code} value={meta.accessCode || '—'} mono />
      </div>

      {meta.rankingProvisional && (
        <p className="text-xs text-ink-amber mb-3">⚠︎ {r.provisional}</p>
      )}

      {/* Export. Given its own card rather than tucked into a toolbar: it is the
          thing most creators came here for. */}
      <Card className="p-4 mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[14rem]">
          <div className="font-semibold text-[--ink-1] text-sm">{r.exportTitle}</div>
          <p className="text-xs text-[--ink-3] mt-0.5">{r.exportHelp}</p>
        </div>
        <Button onClick={() => void onExport()} loading={exporting} className="shrink-0">
          {exporting ? r.exporting : r.exportCta}
        </Button>
      </Card>

      {/* The retention promise, stated where the data is. A creator planning to
          keep this needs to know the answers disappear at 30 days BEFORE they
          decide not to download the file. */}
      <p className="text-xs text-[--ink-3] mb-6">
        🔒 {r.retentionNotice({ days: meta.answerRetentionDays })}
      </p>

      {players.length === 0 ? (
        <Card className="p-0">
          <EmptyState icon="👥" title={r.standings} body={r.noMissions} />
        </Card>
      ) : (
        <>
          <h2 className="font-brand text-lg font-bold text-[--ink-1] mb-2">{r.standings}</h2>
          <Card className="p-0 mb-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[13px] uppercase tracking-wide text-[--ink-3] border-b border-[--rp-border]">
                  <th className="text-start font-semibold px-3 py-2">{r.rank}</th>
                  <th className="text-start font-semibold px-3 py-2">{r.player}</th>
                  <th className="text-end font-semibold px-3 py-2">{r.score}</th>
                  <th className="text-end font-semibold px-3 py-2">{r.done}</th>
                  <th className="text-end font-semibold px-3 py-2">{r.time}</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.teamId} className="border-b border-[--rp-border] last:border-0">
                    <td className="px-3 py-2 tabular-nums text-[--ink-2]">{medal(p.rank)}</td>
                    <td className="px-3 py-2 text-[--ink-1] font-medium" dir="auto">{p.playerName}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-[--ink-1] font-semibold">{p.score}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-[--ink-2]">{p.missionsCompleted}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-[--ink-3]">
                      {p.durationMinutes === null ? '—' : r.minutes({ n: Math.round(p.durationMinutes) })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <h2 className="font-brand text-lg font-bold text-[--ink-1] mb-2">{r.perPlayer}</h2>
          <div className="space-y-3">
            {players.map((p) => (
              <PlayerCard
                key={p.teamId}
                player={p}
                rows={answers.filter((a) => a.teamId === p.teamId)}
                open={openPlayer === p.teamId}
                onToggle={() => setOpenPlayer(openPlayer === p.teamId ? null : p.teamId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-[--rp-border] bg-[--surface-1] px-3 py-2">
      <div className={`text-[--ink-1] font-semibold text-sm truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
      <div className="text-[12px] text-[--ink-3] mt-0.5 truncate">{label}</div>
    </div>
  );
}

/** One player, collapsed to a summary until asked to show every answer. */
function PlayerCard({ player, rows, open, onToggle }: {
  player: ReportPlayerRow;
  rows: ReportAnswerRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const r = t.runReport;
  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-start px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
      >
        <span className="text-[--ink-3] tabular-nums text-sm w-8 shrink-0">{medal(player.rank)}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-[--ink-1] truncate" dir="auto">{player.playerName}</span>
          {player.memberNames.length > 0 && (
            <span className="block text-xs text-[--ink-3] truncate" dir="auto">
              {player.memberNames.join(' · ')}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 flex-wrap shrink-0">
          <Badge color="green">{r.points({ n: player.score })}</Badge>
          <Badge color="zinc">{`${player.missionsCompleted}/${player.missionsAssigned}`}</Badge>
          {player.wrongAnswers > 0 && (
            <Badge color="red">{`${r.wrongAnswers}: ${player.wrongAnswers}`}</Badge>
          )}
          {player.hintsUsed > 0 && <Badge color="gold">{`${r.hints}: ${player.hintsUsed}`}</Badge>}
          {player.mediaCount > 0 && <Badge color="cyan">{`📷 ${player.mediaCount}`}</Badge>}
        </span>
        <span className="text-xs text-[--ink-3] shrink-0">{open ? r.collapse : r.expand}</span>
      </button>

      {open && (
        <div className="border-t border-[--rp-border] divide-y divide-[--rp-border]">
          {rows.length === 0 && (
            <p className="px-4 py-4 text-sm text-[--ink-3]">{r.noMissions}</p>
          )}
          {rows.map((row) => <MissionRow key={`${row.taskId}-${row.stageOrder}`} row={row} />)}
        </div>
      )}
    </Card>
  );
}

/** One mission for one player — the answer, the verdict, and why a cell is empty. */
function MissionRow({ row }: { row: ReportAnswerRow }) {
  const t = useT();
  const r = t.runReport;
  const noChannel = row.answerChannel === 'none' || row.answerChannel === 'media';

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[--ink-1] text-sm truncate" dir="auto">{row.taskTitle}</div>
          {row.question && (
            <p className="text-xs text-[--ink-3] mt-0.5 line-clamp-2" dir="auto">{row.question}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[--ink-3] tabular-nums">{r.points({ n: row.earnedScore })}</span>
          <StatusChip status={row.status} />
        </div>
      </div>

      <div className="mt-2 ps-1 border-s-2 border-[--rp-border]">
        {noChannel ? (
          <p className="text-xs text-[--ink-3] ps-3">{r.noAnswerNeeded}</p>
        ) : row.answers.length > 0 ? (
          <ul className="ps-3 space-y-1">
            {row.answers.map((a, i) => (
              <li key={`${a.at}-${i}`} className="text-sm flex items-baseline gap-2 flex-wrap">
                {a.stepIndex >= 0 && (
                  <span className="text-[12px] text-[--ink-3] shrink-0">
                    {r.stepLabel({ n: a.stepIndex + 1 })}
                  </span>
                )}
                <span
                  dir="auto"
                  className={a.correct === false ? 'text-[--ink-3] line-through' : 'text-[--ink-1]'}
                >
                  {a.answer}
                </span>
                {a.correct === true && <span className="text-ink-go text-xs">✓ {r.correct}</span>}
                {a.correct === false && <span className="text-ink-alert text-xs">✗ {r.wrong}</span>}
              </li>
            ))}
          </ul>
        ) : row.finalAnswer ? (
          <p className="text-sm text-[--ink-1] ps-3" dir="auto">{row.finalAnswer}</p>
        ) : row.answersUnavailable ? (
          // The distinction this whole feature turns on: the answer is gone, which
          // is NOT the same as the player having answered nothing.
          <p className="text-xs text-[--ink-3] ps-3" title={r.notRecordedHelp}>
            🕓 {r.notRecorded}
          </p>
        ) : (
          <p className="text-xs text-[--ink-3] ps-3">{r.notAnswered}</p>
        )}

        {row.expectedAnswer && !noChannel && (
          <p className="text-[13px] text-[--ink-3] ps-3 mt-1" dir="auto">
            {r.expected}: {row.expectedAnswer}
          </p>
        )}

        {row.mediaUrl && (
          <a
            href={row.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block ps-3 mt-1 text-xs text-ink-plasma hover:underline"
          >
            📷 {r.viewMedia}
          </a>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const t = useT();
  const r = t.runReport;
  if (status === 'completed') return <Badge color="green">{r.statusCompleted}</Badge>;
  if (status === 'skipped') return <Badge color="gold">{r.statusSkipped}</Badge>;
  return <Badge color="zinc">{r.statusPending}</Badge>;
}

// ── Formatting (locale-driven, so no date copy lives in the dictionaries) ────

function medal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return rank > 0 ? String(rank) : '—';
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDuration(from: string, to: string): string {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  const minutes = Math.round((b - a) / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
