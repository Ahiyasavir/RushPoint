// 3-step task wizard for the slide-in context panel
// (change: v2.1-builder-shell-redesign). Progressive disclosure replaces the old
// flat scroll form: Location -> Details -> Interaction. Fully localized (he/en via
// useT) and compacted so each step fits the panel without scrolling.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Task, TaskStep, TaskType, TriggerMode } from '@rushpoint/shared';
import { normalizeTriggerMode, defaultRadiusFor } from '@rushpoint/shared';
import { Button, Input, Label, Textarea } from './ui';
import { useT } from './LanguageContext';
import LocationStep from './LocationStep';
import RichTooltip from './RichTooltip';
import QuizChoicesEditor from './QuizChoicesEditor';
import {
  type WizardStep, TYPE_PICKER_ORDER, canGoNext, canGoBack, isTaskLocationValid,
} from '../lib/wizardLogic';
import { TASK_SAMPLES, applySample } from '../lib/taskTemplates';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// Inline (beside-control / tooltip-trigger) variant of the ui-kit block <Label>.
function InlineLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-[--ink-3] uppercase tracking-wider">{children}</span>;
}

const TRIGGER_ICON: Record<TriggerMode, string> = { radius: '📍', exact: '🎯', instant: '⚡', locationless: '🌐' };
const DIFF_BANDS: { key: string; value: number; test: (d: number) => boolean }[] = [
  { key: 'easy', value: 2, test: (d) => d <= 3 },
  { key: 'mid', value: 5, test: (d) => d >= 4 && d <= 6 },
  { key: 'hard', value: 8, test: (d) => d >= 7 },
];

export default function TaskWizard({ task, onChange, onRemove, onDone }: {
  task: Task; onChange: (t: Task) => void; onRemove?: () => void; onDone: () => void;
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
      {/* Step tabs */}
      <div role="tablist" className="flex gap-1.5 pb-2.5 shrink-0">
        {([1, 2, 3] as WizardStep[]).map((s) => {
          const active = s === step; const done = s < step;
          return (
            <button key={s} role="tab" aria-selected={active} onClick={() => setStep(s)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-center transition-colors ${
                active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire'
                  : done ? 'border-rp-go/40 text-rp-go' : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
              <div className="text-[10px] font-semibold">{done ? '✓' : s}</div>
              <div className="text-[11px] font-medium">{STEP_LABEL[s]}</div>
            </button>
          );
        })}
      </div>

      {/* Step body */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pe-0.5 space-y-2.5">
        {step === 1 && <LocationStepBody task={task} mode={mode} located={located} setMode={setMode} set={set} b={b} />}
        {step === 2 && <DetailsStepBody task={task} set={set} b={b} />}
        {step === 3 && <InteractionStepBody task={task} set={set} setSmart={setSmart} onChange={onChange} b={b} />}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 pt-2.5 shrink-0 border-t border-[--rp-border] mt-2.5">
        {canGoBack(step) ? (
          <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as WizardStep)}>← {b.back}</Button>
        ) : <span />}
        {onRemove && <button onClick={onRemove} className="text-neon-red text-xs hover:underline">{b.deleteTask}</button>}
        <div className="ms-auto">
          {step < 3 ? (
            <Button disabled={!canGoNext(step, task) || !stepValid} onClick={() => setStep((s) => (s + 1) as WizardStep)}>{b.next} →</Button>
          ) : (
            <Button onClick={onDone}>{b.done}</Button>
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
  const MODES: { mode: TriggerMode; label: string; sub: string }[] = [
    { mode: 'radius', label: b.fireRadius, sub: b.fireRadiusSub },
    { mode: 'exact', label: b.fireExact, sub: b.fireExactSub },
    { mode: 'instant', label: b.fireInstant, sub: b.fireInstantSub },
    { mode: 'locationless', label: b.fireAnywhere, sub: b.fireAnywhereSub },
  ];
  return (
    <>
      <div>
        <Label>{b.fireQuestion}</Label>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((tm) => (
            <button key={tm.mode} type="button" onClick={() => setMode(tm.mode)}
              className={`text-start rounded-lg border px-3 py-1.5 transition-colors ${
                mode === tm.mode ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'}`}>
              <div className="text-sm font-medium text-[--ink-1]">{TRIGGER_ICON[tm.mode]} {tm.label}</div>
              <div className="text-[11px] text-[--ink-3]">{tm.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {located && (
        <div className="flex items-center gap-2">
          <InlineLabel>{b.triggerRadius}</InlineLabel>
          <Input type="number" min={1} className="w-24" value={task.geofenceRadiusMeters ?? defaultRadiusFor(mode)}
            onChange={(e) => set({ geofenceRadiusMeters: Math.max(1, parseInt(e.target.value) || defaultRadiusFor(mode)) })} />
        </div>
      )}

      {located ? (
        <LocationStep coordinates={task.coordinates} onChange={(lat, lng) => set({ coordinates: { lat, lng } })} mapClassName="h-56" />
      ) : (
        <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2">
          {mode === 'instant' ? b.instantInfo : b.anywhereInfo}
        </p>
      )}
    </>
  );
}

// ── Step 2: Details ──
function DetailsStepBody({ task, set, b }: { task: Task; set: (p: Partial<Task>) => void; b: B }) {
  const DIFF_LABEL: Record<string, string> = { easy: b.easy, mid: b.mid, hard: b.hard };
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
      <div>
        <Label>{b.hintField}</Label>
        <Textarea value={task.hint ?? ''} onChange={(e) => set({ hint: e.target.value })} placeholder={b.hintPlaceholder} rows={2} dir="auto" />
      </div>
      {task.hint && (
        <div className="flex items-center gap-2">
          <InlineLabel>{b.hintCost}</InlineLabel>
          <RichTooltip concept="hint" />
          <Input type="number" min={0} className="w-24" value={task.hintPenalty ?? 25}
            onChange={(e) => set({ hintPenalty: Math.max(0, parseInt(e.target.value) || 0) })} />
        </div>
      )}
    </>
  );
}

// ── Step 3: Interaction ──
function InteractionStepBody({ task, set, setSmart, onChange, b }: {
  task: Task; set: (p: Partial<Task>) => void; setSmart: (p: Record<string, unknown>) => void; onChange: (t: Task) => void; b: B;
}) {
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const samples = TASK_SAMPLES[task.type] ?? [];
  function loadSample(sample: typeof samples[number]) {
    onChange(applySample(task, sample));
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 600);
  }

  const TYPE_META: Record<TaskType, { label: string; desc: string }> = {
    smart_station: { label: b.typeStation, desc: b.typeStationDesc },
    photo: { label: b.typePhoto, desc: b.typePhotoDesc },
    quiz: { label: b.typeQuiz, desc: b.typeQuizDesc },
    numeric: { label: b.typeNumeric, desc: b.typeNumericDesc },
    field: { label: b.typeField, desc: b.typeFieldDesc },
    self_report: { label: b.typeSelfReport, desc: b.typeSelfReportDesc },
    geofence: { label: b.typeGeofence, desc: b.typeGeofenceDesc },
    sequence: { label: b.typeSequence, desc: b.typeSequenceDesc },
  };
  const TYPE_EMOJI: Record<TaskType, string> = {
    smart_station: '🔑', photo: '📸', quiz: '❓', numeric: '🔢', field: '✅', self_report: '🙋', geofence: '📡', sequence: '📋',
  };

  return (
    <>
      <div>
        <Label>{b.howComplete}</Label>
        {/* Compact type picker: emoji + label grid, with a one-line description
            for the active type below — keeps the step short enough to not scroll. */}
        <div className="grid grid-cols-2 gap-1.5">
          {TYPE_PICKER_ORDER.map((ty) => {
            const active = task.type === ty;
            return (
              <button key={ty} onClick={() => set({ type: ty })}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-start transition-colors ${
                  active ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'}`}>
                <span className="text-base leading-none shrink-0">{TYPE_EMOJI[ty]}</span>
                <span className="text-xs font-medium text-[--ink-1] truncate">{TYPE_META[ty].label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-[--ink-3] leading-snug mt-1.5">{TYPE_META[task.type].desc}</p>
      </div>

      {samples.length > 0 && (
        <div className="rounded-lg border border-rp-fire/30 bg-rp-fire/[0.06] px-3 py-2">
          <div className="text-[11px] font-medium text-rp-fire mb-1.5">{b.loadSampleFor(TYPE_META[task.type].label)}</div>
          <div className="flex flex-wrap gap-1.5">
            {samples.map((s) => (
              <button key={s.label} onClick={() => loadSample(s)} dir="auto"
                className="rounded-md border border-rp-fire/40 bg-[--surface-1] text-rp-fire text-[11px] px-2 py-1 hover:bg-rp-fire/10 transition-colors">
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`space-y-2.5 rounded-lg transition-colors duration-500 ${flash ? 'bg-rp-go/10' : ''}`}>
        {task.type === 'smart_station' && (
          <div>
            <Label>{b.secretCode}</Label>
            <Input value={task.smart?.secretCode ?? ''} placeholder={b.secretCodePlaceholder} dir="auto"
              onChange={(e) => setSmart({ verificationType: 'code_verification', secretCode: e.target.value, hasCode: true })} />
          </div>
        )}
        {task.type === 'photo' && (
          <label className="flex items-center gap-2 text-xs text-[--ink-2]">
            <input type="checkbox" checked={task.smart?.autoApprove ?? false}
              onChange={(e) => setSmart({ verificationType: 'photo_upload', autoApprove: e.target.checked })} />
            {b.autoApprove}
          </label>
        )}
        {task.type === 'quiz' && <QuizChoicesEditor task={task} onChange={(p) => set(p)} />}
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
