import type { Task } from '@rushpoint/shared';
import { answerOutcomesProblem, MAX_ANSWER_OUTCOMES } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Button } from './ui';
import { addOutcome, removeOutcome, setOutcome, setRevealPoints } from '../lib/outcomeEditor';

// Rows of [code or answer | points] (change: answer-scored-question, D5). The field example:
// a station whose operator hands out "זעתר" for 50 points or "מרווה" for 100. The same editor
// serves a question graded by answer, where each row's text is also its button.
//
// Validation is the SAME function the server's save guard reads (answerOutcomesProblem), so the
// Builder can never show a list as fine that updateGame will refuse.

export default function OutcomesEditor({ task, replace, kind }: {
  task: Task;
  replace: (t: Task) => void;
  kind: 'codes' | 'answers';
}) {
  const t = useT();
  const o = t.builder.outcomes;
  const rows = task.answerOutcomes ?? [];
  const problem = answerOutcomesProblem(task);

  return (
    <div className="space-y-2" data-qs-field="answerOutcomes">
      <p className="text-xs text-[--ink-3]">{kind === 'codes' ? o.codesHelp : o.answersHelp}</p>
      {rows.map((r, i) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2">
          <input value={r.label ?? ''} onChange={(e) => replace(setOutcome(task, i, { text: e.target.value }))}
            placeholder={kind === 'codes' ? o.codePlaceholder : o.answerPlaceholder}
            aria-label={kind === 'codes' ? o.codePlaceholder : o.answerPlaceholder} dir="auto"
            className="flex-1 min-w-[8rem] min-h-[44px] rounded-lg border border-[--rp-border] bg-[--surface-0] px-2 text-sm text-[--ink-1]" />
          <label className="inline-flex items-center gap-1 text-[13px] text-[--ink-2]">
            <input type="number" inputMode="numeric" min={0} value={r.points}
              onChange={(e) => replace(setOutcome(task, i, { points: Number(e.target.value) }))}
              aria-label={o.pointsLabel}
              className="w-20 min-h-[44px] rounded-lg border border-[--rp-border] bg-[--surface-0] px-2 text-sm text-[--ink-1]" />
            {o.pointsSuffix}
          </label>
          <button type="button" onClick={() => replace(removeOutcome(task, i))} disabled={rows.length <= 2}
            aria-label={o.remove} title={o.remove}
            className="min-h-[44px] min-w-[44px] text-ink-alert disabled:opacity-30">✕</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {rows.length < MAX_ANSWER_OUTCOMES && (
          <Button variant="ghost" onClick={() => replace(addOutcome(task))}>{kind === 'codes' ? o.addCode : o.addAnswer}</Button>
        )}
      </div>
      {kind === 'answers' && (
        <label className="flex items-center gap-2 min-h-[44px] text-[13px] text-[--ink-2]">
          <input type="checkbox" checked={task.revealOutcomePoints === true}
            onChange={(e) => replace(setRevealPoints(task, e.target.checked))} />
          {o.revealPoints}
        </label>
      )}
      {problem && <p className="text-xs text-ink-amber">{o.problem[problem]}</p>}
      <p className="text-[12px] text-[--ink-4]">{o.presetNote}</p>
    </div>
  );
}
