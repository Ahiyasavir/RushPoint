// 3-step task wizard for the slide-in context panel
// (change: v2.1-builder-shell-redesign). Progressive disclosure replaces the old
// flat scroll form: Location -> Details -> Interaction. Fully localized (he/en via
// useT) and compacted so each step fits the panel without scrolling.
import { useState, type ReactNode, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Task, TaskStep, TaskType, TriggerMode, TaskMedia } from '@rushpoint/shared';
import {
  normalizeTriggerMode, defaultRadiusFor, parseYouTubeId, youTubeEmbedUrl,
  validateUnlockGraph, validateAvailabilityWindow,
  validateOrderItems, ORDER_ITEMS_MIN, ORDER_ITEMS_MAX,
  validateSurveyChoices, SURVEY_CHOICES_MIN, SURVEY_CHOICES_MAX,
} from '@rushpoint/shared';
import { Button, Input, Label, Textarea } from './ui';
import { dialog } from './dialog';
import { uploadTaskMedia } from '../services/firebase';
import { useT } from './LanguageContext';
import LocationStep from './LocationStep';
import RichTooltip from './RichTooltip';
import QuizChoicesEditor from './QuizChoicesEditor';
import { BuilderIcon, TRIGGER_ICON_NAME, TYPE_ICON_NAME } from './builderIcons';
import {
  type WizardStep, TYPE_PICKER_ORDER, canGoNext, canGoBack, isTaskLocationValid, isTaskInteractionValid,
} from '../lib/wizardLogic';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// Inline (beside-control / tooltip-trigger) variant of the ui-kit block <Label>.
function InlineLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-[--ink-3] uppercase tracking-wider">{children}</span>;
}

const DIFF_BANDS: { key: string; value: number; test: (d: number) => boolean }[] = [
  { key: 'easy', value: 2, test: (d) => d <= 3 },
  { key: 'mid', value: 5, test: (d) => d >= 4 && d <= 6 },
  { key: 'hard', value: 8, test: (d) => d >= 7 },
];

export default function TaskWizard({ task, onChange, onRemove, onDone, onClose, closeLabel, gameId, siblings }: {
  task: Task; onChange: (t: Task) => void; onRemove?: () => void; onDone: () => void;
  onClose: () => void; closeLabel: string; gameId?: string;
  // The other tasks of the SAME stage (change: unlockable-tasks) — the
  // prerequisite multi-select offers exactly these, so cross-stage/unknown ids
  // can't even be authored from the UI.
  siblings?: Task[];
}) {
  const t = useT();
  const b = t.builder;
  const [step, setStep] = useState<WizardStep>(1);

  const set = (p: Partial<Task>) => onChange({ ...task, ...p });
  const setSmart = (p: Record<string, unknown>) =>
    onChange({ ...task, smart: { enabled: true, verificationType: task.smart?.verificationType ?? 'code_verification', ...task.smart, ...p } });

  const mode = normalizeTriggerMode(task);
  const located = mode === 'radius' || mode === 'exact';
  const setMode = (m: TriggerMode) => set({
    triggerMode: m,
    locationless: m === 'locationless',
    geofenceRadiusMeters: (m === 'radius' || m === 'exact') ? (task.geofenceRadiusMeters ?? defaultRadiusFor(m)) : task.geofenceRadiusMeters,
  });

  const STEP_LABEL: Record<WizardStep, string> = { 1: b.stepLocation, 2: b.stepDetails, 3: b.stepInteraction };
  const stepValid = step === 1 ? isTaskLocationValid(task) : true;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Step tabs (single line) + close — one compact row, no separate title bar. */}
      <div className="flex items-center gap-1.5 pb-2 shrink-0">
        <div role="tablist" className="flex gap-1.5 flex-1 min-w-0">
        {([1, 2, 3] as WizardStep[]).map((s) => {
          const active = s === step; const done = s < step;
          return (
            <button key={s} role="tab" aria-selected={active} onClick={() => setStep(s)}
              className={`flex-1 min-w-0 rounded-lg border px-2 py-1.5 flex items-center justify-center gap-1.5 transition-colors ${
                active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire'
                  : done ? 'border-rp-go/40 text-rp-go' : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
              <span className="text-[10px] font-semibold shrink-0">{done ? '✓' : s}</span>
              <span className="text-[12px] font-medium truncate">{STEP_LABEL[s]}</span>
            </button>
          );
        })}
        </div>
        <button onClick={onClose} aria-label={closeLabel}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none">
          ✕
        </button>
      </div>

      {/* Step body. Pure flexbox column (no height:100% hops) so step 1's map can
          grow to fill; steps 2 & 3 scroll only inside themselves if ever needed. */}
      <div className="flex-1 min-h-0 pe-0.5 flex flex-col">
        {step === 1 && <LocationStepBody task={task} mode={mode} located={located} setMode={setMode} set={set} b={b} />}
        {step === 2 && <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5"><DetailsStepBody task={task} set={set} b={b} gameId={gameId} siblings={siblings} /></div>}
        {step === 3 && <div className="flex-1 min-h-0 overflow-y-auto space-y-2"><InteractionStepBody task={task} set={set} setSmart={setSmart} b={b} /></div>}
      </div>

      {/* Footer */}
      {step === 3 && !isTaskInteractionValid(task) && (
        <p className="text-[11px] text-rp-fire leading-snug pt-1 shrink-0">{b.interactionIncomplete}</p>
      )}
      <div className="flex items-center gap-2 pt-2 shrink-0 border-t border-[--rp-border] mt-2">
        {canGoBack(step) ? (
          <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as WizardStep)}>← {b.back}</Button>
        ) : <span />}
        {onRemove && <button onClick={onRemove} className="text-neon-red text-xs hover:underline">{b.deleteTask}</button>}
        <div className="ms-auto">
          {step < 3 ? (
            <Button disabled={!canGoNext(step, task) || !stepValid} onClick={() => setStep((s) => (s + 1) as WizardStep)}>{b.next} →</Button>
          ) : (
            <Button disabled={!isTaskInteractionValid(task)} onClick={onDone}>{b.done}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

type B = ReturnType<typeof useT>['builder'];

// ── Step 1: Location ──
function LocationStepBody({ task, mode, located, setMode, set, b }: {
  task: Task; mode: TriggerMode; located: boolean; setMode: (m: TriggerMode) => void; set: (p: Partial<Task>) => void; b: B;
}) {
  const [expanded, setExpanded] = useState(false);
  const MODES: { mode: TriggerMode; label: string }[] = [
    { mode: 'radius', label: b.fireRadius },
    { mode: 'exact', label: b.fireExact },
    { mode: 'instant', label: b.fireInstant },
    { mode: 'locationless', label: b.fireAnywhere },
  ];
  const MODE_DESC: Record<TriggerMode, string> = {
    radius: b.fireRadiusDesc, exact: b.fireExactDesc, instant: b.fireInstantDesc, locationless: b.fireAnywhereDesc,
  };
  const onChange = (lat: number, lng: number) => set({ coordinates: { lat, lng } });
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="shrink-0">
        <Label>{b.fireQuestion}</Label>
        {/* Four options in one row: icon + label. The active mode's explanation
            shows below — keeps the chooser tight while keeping the guidance. */}
        <div className="grid grid-cols-4 gap-1.5">
          {MODES.map((tm) => {
            const active = mode === tm.mode;
            return (
              <button key={tm.mode} type="button" onClick={() => setMode(tm.mode)}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-1.5 px-1 transition-colors ${
                  active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire' : 'border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2]'}`}>
                <BuilderIcon name={TRIGGER_ICON_NAME[tm.mode]} className="w-[18px] h-[18px]" />
                <span className="text-[10px] font-medium leading-tight text-center">{tm.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-[--ink-3] leading-snug mt-1.5">{MODE_DESC[mode]}</p>
      </div>

      {located ? (
        // Map fills the remaining height; an "enlarge" control opens a big modal map.
        <div className="flex-1 min-h-0 flex flex-col relative">
          <button type="button" onClick={() => setExpanded(true)}
            className="absolute z-10 top-12 end-2 flex items-center gap-1 rounded-lg border border-[--rp-border] bg-[--surface-1]/90 backdrop-blur px-2 py-1 text-[11px] text-[--ink-2] hover:text-[--ink-1] shadow-soft">
            <span className="text-sm leading-none">⛶</span> {b.enlargeMap}
          </button>
          <LocationStep coordinates={task.coordinates} onChange={onChange} fill />
        </div>
      ) : (
        <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2 shrink-0">
          {mode === 'instant' ? b.instantInfo : b.anywhereInfo}
        </p>
      )}

      {/* Rendered via a portal to document.body: an ancestor's `transform`
          (the sliding panel) would otherwise trap this `position: fixed` modal. */}
      {expanded && located && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 sm:p-8" onClick={() => setExpanded(false)}>
          <div className="bg-[--surface-1] rounded-2xl border border-[--rp-border] shadow-soft w-[92vw] h-[86vh] max-w-5xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 shrink-0 border-b border-[--rp-border]">
              <span className="font-medium text-sm text-[--ink-1]">{b.mapModalTitle}</span>
              <button onClick={() => setExpanded(false)} aria-label={b.closePanel}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <LocationStep coordinates={task.coordinates} onChange={onChange} fill />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Quiz grading mode (change: quiz-ordering) ──
// One grading mode per quiz task: classic (choices / typed answers) OR ordering
// (players arrange 3 to 10 items). Switching modes clears the OTHER mode's
// fields behind a confirm, so a task can never carry both answer keys at once
// (updateGame rejects the mix server-side).
function QuizModeSection({ task, set, b }: { task: Task; set: (p: Partial<Task>) => void; b: B }) {
  const [ordering, setOrdering] = useState(!!task.orderItems && task.orderItems.length > 0);

  const switchMode = async (toOrdering: boolean) => {
    if (toOrdering === ordering) return;
    const losing = toOrdering
      ? (task.choices?.length ?? 0) > 0 || (task.answers?.length ?? 0) > 0
      : (task.orderItems?.length ?? 0) > 0;
    if (losing && !(await dialog.confirm(b.orderingModeSwitchConfirm))) return;
    setOrdering(toOrdering);
    set(toOrdering ? { choices: undefined, answers: undefined } : { orderItems: undefined });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5" role="tablist">
        {([false, true] as const).map((mode) => (
          <button key={String(mode)} role="tab" aria-selected={ordering === mode}
            onClick={() => void switchMode(mode)}
            className={`flex-1 rounded-lg border py-1.5 text-xs transition-colors ${
              ordering === mode
                ? 'border-rp-fire bg-rp-fire/10 text-rp-fire font-medium'
                : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
            {mode ? b.quizModeOrdering : b.quizModeChoices}
          </button>
        ))}
      </div>
      {ordering
        ? <OrderingItemsEditor task={task} set={set} b={b} />
        : <QuizChoicesEditor task={task} onChange={(p) => set(p)} />}
    </div>
  );
}

// Ordering list editor: rows are local UI state (a cleared field never vanishes
// mid-typing); only a VALID cleaned list (3 to 10 distinct non-empty items, in
// the authored = correct order) is pushed up as `orderItems` — an invalid
// transient state pushes undefined so the debounced auto-save (updateGame
// validates server-side) is never wedged, and the Done gate stays closed.
function OrderingItemsEditor({ task, set, b }: { task: Task; set: (p: Partial<Task>) => void; b: B }) {
  const [rows, setRows] = useState<{ id: string; text: string }[]>(() => {
    const initial = (task.orderItems ?? []).map((text) => ({ id: uuid(), text }));
    while (initial.length < ORDER_ITEMS_MIN) initial.push({ id: uuid(), text: '' });
    return initial;
  });

  const apply = (next: { id: string; text: string }[]) => {
    setRows(next);
    const clean = next.map((r) => r.text).filter((t2) => t2.trim() !== '');
    if (clean.length >= ORDER_ITEMS_MIN && validateOrderItems(clean) === null) {
      set({ orderItems: clean, choices: undefined, answers: undefined });
    } else {
      set({ orderItems: undefined, choices: undefined, answers: undefined });
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    apply(next);
  };

  const clean = rows.map((r) => r.text).filter((t2) => t2.trim() !== '');
  const error =
    clean.length < ORDER_ITEMS_MIN || clean.length > ORDER_ITEMS_MAX
      ? b.orderingCountError
      : validateOrderItems(clean) !== null
        ? b.orderingDuplicateError
        : null;

  return (
    <div className="space-y-1.5">
      <Label>{b.orderingItemsLead}</Label>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-1.5">
            <span className="text-[11px] text-[--ink-3] w-4 text-end shrink-0">{i + 1}.</span>
            <Input value={row.text} dir="auto" className="flex-1 min-w-0"
              onChange={(e) => apply(rows.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)))} />
            <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${b.mediaMoveUp} ${i + 1}`}
              className="text-[--ink-3] hover:text-[--ink-1] disabled:opacity-30 shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-[--surface-2] text-xs">↑</button>
            <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`${b.mediaMoveDown} ${i + 1}`}
              className="text-[--ink-3] hover:text-[--ink-1] disabled:opacity-30 shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-[--surface-2] text-xs">↓</button>
            <button onClick={() => apply(rows.filter((r) => r.id !== row.id))} disabled={rows.length <= 1}
              aria-label={`${b.deleteTask} ${i + 1}`}
              className="text-neon-red shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-neon-red/10 disabled:opacity-30 disabled:hover:bg-transparent text-xs">✕</button>
          </div>
        ))}
      </div>
      <Button variant="ghost" className="text-xs" disabled={rows.length >= ORDER_ITEMS_MAX}
        onClick={() => apply([...rows, { id: uuid(), text: '' }])}>
        + {b.orderingAddItem}
      </Button>
      <span className="text-[11px] text-[--ink-3] ms-2">{clean.length}/{ORDER_ITEMS_MAX}</span>
      {error && <p className="text-[11px] text-rp-amber">{error}</p>}
    </div>
  );
}

// ── Survey (change: survey-tasks) — optional choices editor ──
// A survey has NO right answer. Leaving the list empty makes it a FREE-TEXT
// survey; adding 2–8 options makes it a single-pick poll. Rows are local UI
// state; only a VALID 2–8 non-empty list is pushed as `surveyChoices` (an
// invalid/partial transient state pushes undefined ⇒ free-text, mirroring the
// ordering editor and the server-side validateSurveyChoices gate).
function SurveyChoicesSection({ task, set, b }: { task: Task; set: (p: Partial<Task>) => void; b: B }) {
  const [choices, setChoices] = useState(!!task.surveyChoices && task.surveyChoices.length > 0);
  const [rows, setRows] = useState<{ id: string; text: string }[]>(() => {
    const initial = (task.surveyChoices ?? []).map((text) => ({ id: uuid(), text }));
    while (initial.length < SURVEY_CHOICES_MIN) initial.push({ id: uuid(), text: '' });
    return initial;
  });

  const apply = (next: { id: string; text: string }[]) => {
    setRows(next);
    const clean = next.map((r) => r.text.trim()).filter((t2) => t2 !== '');
    set({ surveyChoices: validateSurveyChoices(clean) === null ? clean : undefined });
  };

  const clean = rows.map((r) => r.text.trim()).filter((t2) => t2 !== '');
  const error = choices ? validateSurveyChoices(clean) : null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[--ink-3] leading-snug">{b.surveyLead}</p>
      <div className="flex gap-1.5" role="tablist">
        {([false, true] as const).map((mode) => (
          <button key={String(mode)} role="tab" aria-selected={choices === mode}
            onClick={() => {
              setChoices(mode);
              if (!mode) set({ surveyChoices: undefined });
              else apply(rows);
            }}
            className={`flex-1 rounded-lg border py-1.5 text-xs transition-colors ${
              choices === mode
                ? 'border-rp-fire bg-rp-fire/10 text-rp-fire font-medium'
                : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
            {mode ? b.surveyModeChoices : b.surveyModeText}
          </button>
        ))}
      </div>
      {choices && (
        <div className="space-y-1.5">
          <Label>{b.surveyChoicesLead}</Label>
          <div className="space-y-1">
            {rows.map((row, i) => (
              <div key={row.id} className="flex items-center gap-1.5">
                <span className="text-[11px] text-[--ink-3] w-4 text-end shrink-0">{i + 1}.</span>
                <Input value={row.text} dir="auto" className="flex-1 min-w-0"
                  placeholder={b.surveyChoicePlaceholder(i + 1)}
                  onChange={(e) => apply(rows.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)))} />
                <button onClick={() => apply(rows.filter((r) => r.id !== row.id))} disabled={rows.length <= SURVEY_CHOICES_MIN}
                  aria-label={`${b.deleteTask} ${i + 1}`}
                  className="text-neon-red shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-neon-red/10 disabled:opacity-30 disabled:hover:bg-transparent text-xs">✕</button>
              </div>
            ))}
          </div>
          <Button variant="ghost" className="text-xs" disabled={rows.length >= SURVEY_CHOICES_MAX}
            onClick={() => apply([...rows, { id: uuid(), text: '' }])}>
            + {b.surveyAddChoice}
          </Button>
          <span className="text-[11px] text-[--ink-3] ms-2">{clean.length}/{SURVEY_CHOICES_MAX}</span>
          {error && <p className="text-[11px] text-rp-amber">{b.surveyChoicesError}</p>}
        </div>
      )}
    </div>
  );
}

// ── Step 2: Details ──
function DetailsStepBody({ task, set, b, gameId, siblings }: {
  task: Task; set: (p: Partial<Task>) => void; b: B; gameId?: string; siblings?: Task[];
}) {
  const DIFF_LABEL: Record<string, string> = { easy: b.easy, mid: b.mid, hard: b.hard };
  // Optional hint collapses behind a toggle so the common (no-hint) form is short
  // enough to never scroll, even on small laptops.
  const [showHint, setShowHint] = useState(!!task.hint);
  return (
    <>
      <div>
        <Label>{b.titleField}</Label>
        <Input value={task.title} onChange={(e) => set({ title: e.target.value })} placeholder={b.titlePlaceholder} dir="auto" autoFocus />
      </div>
      <div>
        <Label>{b.descriptionField}</Label>
        <Textarea value={task.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder={b.descriptionPlaceholder} rows={2} dir="auto" />
      </div>
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <InlineLabel>{b.difficulty}</InlineLabel>
          <RichTooltip concept="difficulty" />
        </div>
        <div className="flex gap-1.5">
          {DIFF_BANDS.map((d) => {
            const active = d.test(task.difficulty);
            return (
              <button key={d.key} onClick={() => set({ difficulty: d.value })}
                className={`flex-1 rounded-lg border py-1.5 text-sm transition-colors ${
                  active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire font-medium' : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
                {DIFF_LABEL[d.key]}
              </button>
            );
          })}
        </div>
      </div>

      {showHint ? (
        <div className="rounded-lg border border-[--rp-border] p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <InlineLabel>{b.hintField}</InlineLabel>
              <RichTooltip concept="hint" />
            </div>
            <button className="text-[11px] text-[--ink-3] hover:text-neon-red"
              onClick={() => {
                setShowHint(false);
                set({ hint: undefined, hintPenalty: undefined, hintAutoRevealMinutes: undefined, hintAutoRevealAttempts: undefined });
              }}>
              {b.removeHint}
            </button>
          </div>
          <Textarea value={task.hint ?? ''} onChange={(e) => set({ hint: e.target.value })} placeholder={b.hintPlaceholder} rows={2} dir="auto" />
          <div className="flex items-center gap-2">
            <InlineLabel>{b.hintCost}</InlineLabel>
            <Input type="number" min={0} className="w-24" value={task.hintPenalty ?? 25}
              onChange={(e) => set({ hintPenalty: Math.max(0, parseInt(e.target.value) || 0) })} />
          </div>
          {/* Hint auto escalation (change: hint-auto-escalation): optional free
              thresholds — the hint stops costing points once the team has held
              the task N minutes OR burned N wrong attempts. 0/empty = off. */}
          <p className="text-[11px] text-[--ink-3] leading-snug">{b.hintEscalationLead}</p>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} step="0.5" className="w-20" value={task.hintAutoRevealMinutes ?? ''}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                set({ hintAutoRevealMinutes: Number.isFinite(v) && v > 0 ? v : undefined });
              }} />
            <InlineLabel>{b.hintFreeAfterMinutes}</InlineLabel>
          </div>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} className="w-20" value={task.hintAutoRevealAttempts ?? ''}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                set({ hintAutoRevealAttempts: Number.isInteger(v) && v > 0 ? v : undefined });
              }} />
            <InlineLabel>{b.hintFreeAfterAttempts}</InlineLabel>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowHint(true)}
          className="self-start text-xs text-rp-fire hover:underline">
          + {b.addHint}
        </button>
      )}

      <UnlockSection task={task} siblings={siblings ?? []} set={set} b={b} />

      <MediaSection task={task} set={set} b={b} gameId={gameId} />
    </>
  );
}

// ── Unlockable tasks (change: unlockable-tasks) — prerequisite multi-select ──
// A collapsible "Unlocks only after…" section (like the hint toggle) with a
// checkbox per sibling task of the SAME stage. Only sibling ids are offered
// (self excluded), so self-reference / cross-stage / unknown ids can't be
// authored; an option whose checking would create a dependency CYCLE is
// disabled with an explanation — validateUnlockGraph is the single source of
// truth, so the Builder can never produce a graph the server would reject.
function UnlockSection({ task, siblings, set, b }: {
  task: Task; siblings: Task[]; set: (p: Partial<Task>) => void; b: B;
}) {
  const selected = task.unlockAfterTaskIds ?? [];
  const [show, setShow] = useState(selected.length > 0);
  const others = siblings.filter((s) => s.id !== task.id);

  // Would checking `id` make the stage graph invalid (i.e. create a cycle)?
  const wouldBreak = (id: string): boolean => {
    const hypothetical = siblings.map((s) =>
      s.id === task.id ? { ...task, unlockAfterTaskIds: [...selected, id] } : s,
    );
    return validateUnlockGraph({ tasks: hypothetical }).errors.length > 0;
  };

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    set({ unlockAfterTaskIds: next.length > 0 ? next : undefined });
  };

  if (!show) {
    return (
      <button onClick={() => setShow(true)} className="self-start text-xs text-rp-fire hover:underline">
        + {b.unlockAfterLead}
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-[--rp-border] p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <InlineLabel>🔒 {b.unlockAfterLead}</InlineLabel>
        <button aria-label={b.closePanel} className="text-[11px] text-[--ink-3] hover:text-neon-red"
          onClick={() => { setShow(false); set({ unlockAfterTaskIds: undefined }); }}>
          ✕
        </button>
      </div>
      <p className="text-[11px] text-[--ink-3] leading-snug">{b.unlockAfterHint}</p>
      {others.length === 0 ? (
        <p className="text-[11px] text-[--ink-3]">{b.unlockAfterNone}</p>
      ) : (
        <div className="space-y-1">
          {others.map((s) => {
            const checked = selected.includes(s.id);
            const blocked = !checked && wouldBreak(s.id);
            return (
              <label key={s.id}
                className={`flex items-start gap-2 text-sm ${blocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer text-[--ink-1]'}`}
                title={blocked ? b.unlockCycleError : undefined}>
                <input type="checkbox" className="mt-0.5" checked={checked} disabled={blocked}
                  onChange={(e) => toggle(s.id, e.target.checked)} />
                <span dir="auto" className="min-w-0 truncate">
                  <span className="text-[--ink-3] me-1">{siblings.indexOf(s) + 1}.</span>
                  {s.title || b.untitledTask}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Task media (images / videos / YouTube) — change: task-media-attachments ──
// Upload image/video files from the computer (→ Firebase Storage) or paste a
// YouTube link (→ canonical embed). Each entry has an optional caption and can be
// reordered / removed. Client-side validation mirrors the server (normalizeTaskMedia).
function MediaSection({ task, set, b, gameId }: { task: Task; set: (p: Partial<Task>) => void; b: B; gameId?: string }) {
  const media = task.media ?? [];
  const [ytUrl, setYtUrl] = useState('');
  const [ytError, setYtError] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState(false);

  const commit = (next: TaskMedia[]) => set({ media: next.length ? next : undefined });

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadError(false);
    setUploadPct(0);
    try {
      const { url, kind } = await uploadTaskMedia(file, { gameId: gameId ?? 'draft', taskId: task.id }, setUploadPct);
      commit([...media, { id: uuid(), kind, url }]);
    } catch {
      setUploadError(true);
    } finally {
      setUploadPct(null);
    }
  };

  const addYouTube = () => {
    const id = parseYouTubeId(ytUrl);
    if (!id) { setYtError(true); return; }
    commit([...media, { id: uuid(), kind: 'youtube', url: youTubeEmbedUrl(id) }]);
    setYtUrl('');
    setYtError(false);
  };

  const removeAt = (i: number) => commit(media.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= media.length) return;
    const next = [...media];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const setCaption = (i: number, caption: string) =>
    commit(media.map((m, idx) => (idx === i ? { ...m, caption: caption || undefined } : m)));

  return (
    <div className="rounded-lg border border-[--rp-border] p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <InlineLabel>{b.mediaField}</InlineLabel>
      </div>

      {media.length > 0 && (
        <ul className="space-y-2">
          {media.map((m, i) => (
            <li key={m.id} className="flex gap-2 items-start rounded-lg border border-[--rp-border] p-2">
              <div className="w-16 h-16 shrink-0 rounded-md overflow-hidden bg-[--surface-2] flex items-center justify-center">
                {m.kind === 'image'
                  ? <img src={m.url} alt="" className="w-full h-full object-cover" />
                  : m.kind === 'video'
                    ? <video src={m.url} className="w-full h-full object-cover" muted />
                    : <span className="text-2xl" aria-hidden>▶</span>}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-[11px] text-[--ink-3] truncate">
                  {m.kind === 'youtube' ? b.mediaKindYouTube : m.kind === 'video' ? b.mediaKindVideo : b.mediaKindImage}
                </div>
                <Input value={m.caption ?? ''} onChange={(e) => setCaption(i, e.target.value)}
                  placeholder={b.mediaCaptionPlaceholder} dir="auto" className="text-sm" />
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={b.mediaMoveUp}
                  className="text-[--ink-3] hover:text-[--ink-1] disabled:opacity-30 text-xs">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === media.length - 1} aria-label={b.mediaMoveDown}
                  className="text-[--ink-3] hover:text-[--ink-1] disabled:opacity-30 text-xs">↓</button>
                <button onClick={() => removeAt(i)} aria-label={b.mediaRemove}
                  className="text-neon-red hover:opacity-70 text-xs">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Upload from computer */}
      <div className="flex items-center gap-2">
        <label className="cursor-pointer self-start text-xs text-rp-fire hover:underline">
          + {b.mediaUpload}
          <input type="file" accept="image/*,video/*" className="hidden" onChange={onPickFile} disabled={uploadPct !== null} />
        </label>
        {uploadPct !== null && <span className="text-[11px] text-[--ink-3]">{uploadPct}%</span>}
        {uploadError && <span className="text-[11px] text-neon-red">{b.mediaUploadError}</span>}
      </div>

      {/* YouTube link */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Input value={ytUrl} onChange={(e) => { setYtUrl(e.target.value); setYtError(false); }}
            placeholder={b.mediaYouTubePlaceholder} dir="ltr" className="text-sm flex-1" />
          <Button variant="ghost" onClick={addYouTube} disabled={!ytUrl.trim()}>{b.mediaAddYouTube}</Button>
        </div>
        {ytError && <span className="text-[11px] text-neon-red">{b.mediaYouTubeError}</span>}
      </div>
    </div>
  );
}

// Lightweight animated SVGs — one per task type, shown inside the ? tooltip.
const TYPE_ANIM: Record<TaskType, ReactNode> = {
  field: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <circle cx="60" cy="26" r="8" fill="#D85A30" />
      <polygon points="54,30 66,30 60,43" fill="#D85A30" />
      <circle cx="60" cy="26" r="8" fill="none" stroke="#D85A30" strokeWidth="1.5">
        <animate attributeName="r" values="8;26" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;0" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="26" r="8" fill="none" stroke="#D85A30" strokeWidth="1.5">
        <animate attributeName="r" values="8;26" dur="1.5s" begin="0.55s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;0" dur="1.5s" begin="0.55s" repeatCount="indefinite" />
      </circle>
    </svg>
  ),
  photo: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <rect x="24" y="19" width="72" height="32" rx="5" fill="#7F77DD22" stroke="#7F77DD" strokeWidth="1.5" />
      <rect x="45" y="13" width="30" height="10" rx="3" fill="#7F77DD22" stroke="#7F77DD" strokeWidth="1.5" />
      <circle cx="60" cy="35" r="9" fill="none" stroke="#7F77DD" strokeWidth="1.5" />
      <circle cx="60" cy="35" r="4" fill="#7F77DD">
        <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="80" y="25" fontSize="10" fill="#FFD700" opacity="0">✦
        <animate attributeName="opacity" values="0;1;0" dur="2s" begin="0.4s" repeatCount="indefinite" />
      </text>
    </svg>
  ),
  quiz: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <rect x="16" y="7" width="88" height="13" rx="4" fill="#88888815" stroke="#888" strokeWidth="1" />
      <rect x="16" y="24" width="88" height="13" rx="4" fill="#D85A3022" stroke="#D85A30" strokeWidth="1.5" />
      <rect x="16" y="41" width="88" height="13" rx="4" fill="#88888815" stroke="#888" strokeWidth="1" />
      <text x="97" y="35" fontSize="9" fill="#D85A30" opacity="0">✓
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.35;0.55;1" dur="2s" repeatCount="indefinite" />
      </text>
    </svg>
  ),
  numeric: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <rect x="22" y="14" width="76" height="30" rx="5" fill="#7F77DD22" stroke="#7F77DD" strokeWidth="1.5" />
      <text x="55" y="35" textAnchor="middle" fontSize="16" fill="currentColor" fontWeight="600">42</text>
      <line x1="72" y1="22" x2="72" y2="38" stroke="#7F77DD" strokeWidth="2">
        <animate attributeName="opacity" values="1;0;1" dur="0.9s" repeatCount="indefinite" />
      </line>
    </svg>
  ),
  smart_station: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <rect x="11" y="18" width="17" height="22" rx="3" fill="#D85A3022" stroke="#D85A30" strokeWidth="1.5" />
      <rect x="33" y="18" width="17" height="22" rx="3" fill="#D85A3022" stroke="#D85A30" strokeWidth="1.5" />
      <rect x="55" y="18" width="17" height="22" rx="3" fill="#D85A3022" stroke="#D85A30" strokeWidth="1.5" />
      <rect x="77" y="18" width="17" height="22" rx="3" fill="#D85A3022" stroke="#D85A30" strokeWidth="1.5" />
      <text x="19" y="34" textAnchor="middle" fontSize="11" fill="#D85A30" fontWeight="600" opacity="0">R
        <animate attributeName="opacity" values="0;1;1" keyTimes="0;0.1;1" dur="2s" repeatCount="indefinite" />
      </text>
      <text x="41" y="34" textAnchor="middle" fontSize="11" fill="#D85A30" fontWeight="600" opacity="0">P
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.25;0.38;1" dur="2s" repeatCount="indefinite" />
      </text>
      <text x="63" y="34" textAnchor="middle" fontSize="11" fill="#D85A30" fontWeight="600" opacity="0">2
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.45;0.58;1" dur="2s" repeatCount="indefinite" />
      </text>
      <text x="85" y="34" textAnchor="middle" fontSize="11" fill="#D85A30" fontWeight="600" opacity="0">4
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.62;0.75;1" dur="2s" repeatCount="indefinite" />
      </text>
      <text x="103" y="35" fontSize="13" fill="#4CAF50" opacity="0">✓
        <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.82;0.9" dur="2s" repeatCount="indefinite" />
      </text>
    </svg>
  ),
  self_report: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <text x="5" y="42" fontSize="20" fill="#FFD700">★</text>
      <text x="25" y="42" fontSize="20" fill="#FFD700">★</text>
      <text x="45" y="42" fontSize="20" fill="#FFD700">★</text>
      <text x="65" y="42" fontSize="20" fill="#888888">★
        <animate attributeName="fill" values="#888888;#888888;#FFD700;#FFD700" keyTimes="0;0.45;0.6;1" dur="2s" repeatCount="indefinite" />
      </text>
      <text x="85" y="42" fontSize="20" fill="#888888">★
        <animate attributeName="fill" values="#888888;#888888;#888888;#FFD700;#FFD700" keyTimes="0;0.6;0.75;0.85;1" dur="2s" repeatCount="indefinite" />
      </text>
    </svg>
  ),
  geofence: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <circle cx="60" cy="30" r="4" fill="#D85A30" />
      <circle cx="60" cy="30" fill="none" stroke="#D85A30" strokeWidth="1.5">
        <animate attributeName="r" values="4;24" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;0" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="30" fill="none" stroke="#D85A30" strokeWidth="1.5">
        <animate attributeName="r" values="4;24" dur="2s" begin="0.65s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0" dur="2s" begin="0.65s" repeatCount="indefinite" />
      </circle>
      <circle cx="35" cy="46" r="4" fill="#378ADD">
        <animateMotion path="M0,0 L25,-16" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  ),
  sequence: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <circle cx="20" cy="30" r="11" fill="#D85A30" opacity="0.3">
        <animate attributeName="opacity" values="0.3;1;1;0.3" keyTimes="0;0.1;0.35;0.45" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="20" y="34" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">1</text>
      <line x1="32" y1="30" x2="48" y2="30" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <polygon points="46,27 50,30 46,33" fill="currentColor" opacity="0.35" />
      <circle cx="60" cy="30" r="11" fill="#D85A30" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.3;1;1;0.3" keyTimes="0;0.35;0.45;0.68;0.78" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="60" y="34" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">2</text>
      <line x1="72" y1="30" x2="88" y2="30" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <polygon points="86,27 90,30 86,33" fill="currentColor" opacity="0.35" />
      <circle cx="100" cy="30" r="11" fill="#D85A30" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.3;0.3;1;1;0.3" keyTimes="0;0.65;0.75;0.85;0.95;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <text x="100" y="34" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">3</text>
    </svg>
  ),
  survey: (
    <svg viewBox="0 0 120 60" className="w-full h-14">
      <rect x="20" y="9" width="80" height="12" rx="3" fill="#88888815" stroke="#888" strokeWidth="1" />
      <rect x="20" y="25" width="80" height="12" rx="3" fill="#378ADD22" stroke="#378ADD" strokeWidth="1.5" />
      <rect x="20" y="41" width="80" height="12" rx="3" fill="#88888815" stroke="#888" strokeWidth="1" />
      <circle cx="27" cy="15" r="2.5" fill="none" stroke="#888" strokeWidth="1" />
      <circle cx="27" cy="31" r="2.5" fill="#378ADD">
        <animate attributeName="opacity" values="0;1;1" keyTimes="0;0.4;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="27" cy="47" r="2.5" fill="none" stroke="#888" strokeWidth="1" />
    </svg>
  ),
};

// ── Step 3: Interaction ──
function InteractionStepBody({ task, set, setSmart, b }: {
  task: Task; set: (p: Partial<Task>) => void; setSmart: (p: Record<string, unknown>) => void; b: B;
}) {
  const TYPE_META: Record<TaskType, { label: string; desc: string }> = {
    smart_station: { label: b.typeStation, desc: b.typeStationDesc },
    photo: { label: b.typePhoto, desc: b.typePhotoDesc },
    quiz: { label: b.typeQuiz, desc: b.typeQuizDesc },
    numeric: { label: b.typeNumeric, desc: b.typeNumericDesc },
    field: { label: b.typeField, desc: b.typeFieldDesc },
    self_report: { label: b.typeSelfReport, desc: b.typeSelfReportDesc },
    geofence: { label: b.typeGeofence, desc: b.typeGeofenceDesc },
    sequence: { label: b.typeSequence, desc: b.typeSequenceDesc },
    survey: { label: b.typeSurvey, desc: b.typeSurveyDesc },
  };
  return (
    <>
      <div>
        <Label>{b.howComplete}</Label>
        {/* Compact type picker: original icon + label grid, with a one-line
            description for the active type below — keeps the step short. */}
        <div className="grid grid-cols-3 gap-1.5">
          {TYPE_PICKER_ORDER.map((ty) => {
            const active = task.type === ty;
            return (
              <div key={ty} className="relative">
                <button onClick={() => set(
                    // survey (change: survey-tasks): pure data collection defaults
                    // to 0 points (only when leaving the blank-task default of 100).
                    ty === 'survey' && task.type !== 'survey' && task.pointValue === 100
                      ? { type: ty, pointValue: 0 }
                      : { type: ty },
                  )}
                  className={`w-full flex items-center gap-1.5 rounded-lg border px-2 pe-5 py-1.5 text-start transition-colors ${
                    active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire' : 'border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2]'}`}>
                  <BuilderIcon name={TYPE_ICON_NAME[ty]} className="w-4 h-4 shrink-0" />
                  <span className="text-[11px] font-medium truncate">{TYPE_META[ty].label}</span>
                </button>
                <span className="absolute top-0.5 end-0.5 z-10">
                  <RichTooltip title={TYPE_META[ty].label} body={TYPE_META[ty].desc} svg={TYPE_ANIM[ty]} />
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-[--ink-3] leading-snug mt-1.5">{TYPE_META[task.type].desc}</p>
      </div>

      <div className="space-y-2">
        {task.type === 'smart_station' && (
          <div>
            <Label>{b.secretCode}</Label>
            <Input value={task.smart?.secretCode ?? ''} placeholder={b.secretCodePlaceholder} dir="auto"
              onChange={(e) => setSmart({ verificationType: 'code_verification', secretCode: e.target.value, hasCode: true })} />
          </div>
        )}
        {task.type === 'photo' && (
          <div className="space-y-2">
            {/* audio-tasks: capture a photo (default) or an audio clip. Writes to
                task.smart.captureKind (never top-level). */}
            <div>
              <Label>{b.captureKindLabel}</Label>
              <div className="flex gap-2">
                {(['photo', 'audio'] as const).map((k) => {
                  const active = (task.smart?.captureKind ?? 'photo') === k;
                  return (
                    <button key={k} type="button"
                      onClick={() => setSmart({ verificationType: 'photo_upload', captureKind: k })}
                      className={`px-3 py-1.5 rounded-lg text-sm border ${active ? 'bg-[--accent] text-white border-transparent' : 'border-[--line] text-[--ink-2]'}`}>
                      {k === 'photo' ? `📷 ${b.captureKindPhoto}` : `🎙️ ${b.captureKindAudio}`}
                    </button>
                  );
                })}
              </div>
              {(task.smart?.captureKind ?? 'photo') === 'audio' && (
                <p className="text-xs text-[--ink-3] mt-1">{b.captureKindAudioHint}</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-[--ink-2]">
              <input type="checkbox" checked={task.smart?.autoApprove ?? false}
                onChange={(e) => setSmart({ verificationType: 'photo_upload', autoApprove: e.target.checked })} />
              {b.autoApprove}
            </label>
          </div>
        )}
        {task.type === 'quiz' && <QuizModeSection task={task} set={set} b={b} />}
        {task.type === 'numeric' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{b.correctNumber}</Label>
              <Input type="number" value={task.numericAnswer ?? ''}
                onChange={(e) => set({ numericAnswer: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
            </div>
            <div>
              <Label>{b.tolerance}</Label>
              <Input type="number" min={0} value={task.numericTolerance ?? 0}
                onChange={(e) => set({ numericTolerance: Math.max(0, parseFloat(e.target.value) || 0) })} />
            </div>
          </div>
        )}
        {task.type === 'sequence' && <StepsEditor steps={task.steps ?? []} onChange={(steps) => set({ steps })} b={b} />}
        {task.type === 'survey' && <SurveyChoicesSection task={task} set={set} b={b} />}
        {(task.type === 'smart_station' || task.type === 'photo') && (
          <div>
            <Label>{b.extendedInstructions}</Label>
            <Textarea value={task.smart?.longInstructions ?? ''} rows={2} placeholder={b.extendedPlaceholder} dir="auto"
              onChange={(e) => setSmart({ longInstructions: e.target.value })} />
          </div>
        )}
        {(task.type === 'field' || task.type === 'self_report' || task.type === 'geofence') && (
          <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2">{b.noConfigNote(TYPE_META[task.type].desc)}</p>
        )}
      </div>

      {/* Hidden-location (treasure hunt): only for located tasks (radius/exact).
          Hides the map pin from participants — they reach the spot from the clue. */}
      {(() => {
        const m = normalizeTriggerMode(task);
        if (m !== 'radius' && m !== 'exact') return null;
        return (
          <div className="rounded-lg border border-[--rp-border] bg-[--surface-2] px-3 py-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!task.hideLocation}
                onChange={(e) => set(e.target.checked
                  ? { hideLocation: true }
                  : { hideLocation: undefined, locationClue: undefined, locationClueHe: undefined })} />
              <span>
                <span className="text-sm font-medium text-[--ink-1]">{b.hideLocation}</span>
                <span className="block text-[11px] text-[--ink-3] leading-snug">{b.hideLocationDesc}</span>
              </span>
            </label>
            {task.hideLocation && (
              <div className="mt-2">
                <Label>{b.locationClueField}</Label>
                <Textarea value={task.locationClue ?? ''} onChange={(e) => set({ locationClue: e.target.value })}
                  placeholder={b.locationCluePlaceholder} rows={2} dir="auto" />
                {!isTaskLocationValid(task) ? (
                  // A hidden task is still a located task — Step 1's place-a-pin gate
                  // (isTaskLocationValid) is what guarantees real coordinates exist.
                  <p className="text-[11px] text-rp-fire mt-1">{b.hideLocationNeedsCoords}</p>
                ) : !task.locationClue?.trim() && (
                  <p className="text-[11px] text-[--ink-3] mt-1">{b.hideLocationNeedsClue}</p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <details className="rounded-lg border border-[--rp-border] px-3 py-2">
        <summary className="text-xs font-medium text-[--ink-2] cursor-pointer select-none">{b.advanced}</summary>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div>
            <Label>{b.points}</Label>
            <Input type="number" value={task.pointValue} onChange={(e) => set({ pointValue: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <Label>{b.estMin}</Label>
            <Input type="number" value={task.estimatedMinutes} onChange={(e) => set({ estimatedMinutes: parseInt(e.target.value) || 1 })} />
          </div>
          <div>
            <div className="flex items-center gap-1 mb-1">
              <InlineLabel>{b.maxTeams}</InlineLabel>
              <RichTooltip concept="concurrent" />
            </div>
            <Input type="number" value={task.maxConcurrentTeams} onChange={(e) => set({ maxConcurrentTeams: parseInt(e.target.value) || 1 })} />
          </div>
          {(() => {
            const m = normalizeTriggerMode(task);
            if (m !== 'radius' && m !== 'exact') return null;
            return (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <InlineLabel>{b.triggerRadius}</InlineLabel>
                  <RichTooltip concept="geofence" />
                </div>
                <Input type="number" min={1} value={task.geofenceRadiusMeters ?? defaultRadiusFor(m)}
                  onChange={(e) => set({ geofenceRadiusMeters: Math.max(1, parseInt(e.target.value) || defaultRadiusFor(m)) })} />
              </div>
            );
          })()}
        </div>
        {/* Task expiry (change: task-expiry): the task closes N minutes after the
            run starts — dropped from routing, refused on completion, auto-skipped
            when in flight. Empty/0 = never expires. */}
        <div className="mt-2">
          <div className="flex items-center gap-2 flex-wrap text-xs text-[--ink-3]">
            <InlineLabel>⏳ {b.expiryLead}</InlineLabel>
            <Input type="number" min={0} className="w-24 py-1" value={task.expiresAfterMinutes ?? ''}
              placeholder="0"
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                set({ expiresAfterMinutes: Number.isFinite(n) && n > 0 ? n : undefined });
              }} />
            <span>{b.expiryAfterUnit}</span>
          </div>
          {validateAvailabilityWindow(task) !== null ? (
            <p className="text-[11px] text-rp-fire mt-1">{b.expiryWindowError}</p>
          ) : task.releaseAt && task.expiresAfterMinutes ? (
            <p className="text-[11px] text-[--ink-3] mt-1">⚠ {b.expiryReleaseAtWarn}</p>
          ) : null}
        </div>
      </details>
    </>
  );
}

function StepsEditor({ steps, onChange, b }: { steps: TaskStep[]; onChange: (s: TaskStep[]) => void; b: B }) {
  const update = (i: number, p: Partial<TaskStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="space-y-2">
      <Label>{b.orderedSteps}</Label>
      {steps.map((s, i) => (
        <div key={s.id} className="flex gap-2 items-start">
          <span className="text-xs text-[--ink-3] mt-2.5 w-3">{i + 1}</span>
          <div className="flex-1 space-y-1">
            <Input value={s.prompt} onChange={(e) => update(i, { prompt: e.target.value })} placeholder={b.stepPrompt} dir="auto" />
            <Input value={s.answer ?? ''} onChange={(e) => update(i, { answer: e.target.value })} placeholder={b.stepAnswer} dir="auto" />
          </div>
          <button className="text-neon-red text-sm mt-2.5" onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <Button variant="ghost" className="text-xs" onClick={() => onChange([...steps, { id: uuid(), prompt: '', answer: '' }])}>
        + {b.addStep}
      </Button>
    </div>
  );
}
