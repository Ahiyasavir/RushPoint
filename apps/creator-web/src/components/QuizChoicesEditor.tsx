// Dynamic Quiz answer editor (change: v2.1-builder-shell-redesign).
//
// Replaces the two newline-split textareas with a list of isolated choice rows —
// each its own text input, with a "correct" checkbox and a delete button, plus an
// Add choice action. Maps to the unchanged `Task.choices` / `Task.answers` arrays
// via the pure helpers in lib/quizFields.ts, so the on-disk schema is identical
// and the change is fully backward-compatible.
//
// Local row state (seeded once from the task) is the source of truth for the UI so
// clearing a field to retype it never makes the row vanish; the cleaned model is
// pushed to the parent on every change for the existing debounced auto-save.
import { useState } from 'react';
import type { Task } from '@rushpoint/shared';
import {
  type QuizChoice,
  choicesFromTask,
  choicesToTask,
  addChoice,
  removeChoice,
  setChoiceText,
  toggleCorrect,
} from '../lib/quizFields';
import { Button, Input, Label } from './ui';

export default function QuizChoicesEditor({
  task,
  onChange,
}: {
  task: Task;
  onChange: (p: Pick<Task, 'choices' | 'answers'>) => void;
}) {
  const [rows, setRows] = useState<QuizChoice[]>(() => {
    const initial = choicesFromTask(task);
    // Always show at least two empty rows to invite multiple-choice authoring.
    if (initial.length === 0) return [addChoice([])[0], addChoice([])[0]];
    return initial;
  });

  // Update local UI state, then flush the cleaned model up for auto-save.
  const apply = (next: QuizChoice[]) => {
    setRows(next);
    onChange(choicesToTask(next));
  };

  const anyCorrect = rows.some((r) => r.correct && r.text.trim() !== '');

  return (
    <div className="space-y-2">
      <Label>Answer choices</Label>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-2">
            <label
              className="flex items-center gap-1 text-[11px] text-zinc-400 shrink-0 cursor-pointer select-none"
              title="Mark this choice as a correct answer"
            >
              <input
                type="checkbox"
                className="w-3.5 h-3.5 shrink-0"
                checked={row.correct}
                onChange={() => apply(toggleCorrect(rows, row.id))}
                aria-label={`Mark choice ${i + 1} correct`}
              />
              correct
            </label>
            <Input
              value={row.text}
              onChange={(e) => apply(setChoiceText(rows, row.id, e.target.value))}
              placeholder={`Choice ${i + 1}`}
              className="flex-1 min-w-0"
            />
            <button
              type="button"
              onClick={() => apply(removeChoice(rows, row.id))}
              className="text-neon-red shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-neon-red/10 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={`Delete choice ${i + 1}`}
              disabled={rows.length <= 1}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <Button variant="ghost" className="text-xs" onClick={() => apply(addChoice(rows))}>
        + Add choice
      </Button>

      {!anyCorrect && (
        <p className="text-[11px] text-rp-amber">
          Tick at least one choice as correct, or teams cannot complete this quiz.
        </p>
      )}
    </div>
  );
}
