// 3-step task wizard for the slide-in context panel
// (change: v2.1-builder-shell-redesign). Progressive disclosure replaces the old
// flat scroll form. Fully localized (he/en via useT) and compacted so each step
// fits the panel without scrolling.
//
// Step order is Details -> Interaction -> Placement (change:
// builder-first-task-flow): naming is the first thing asked and the only forward
// gate, placement is last and never blocks. Validation messages are withheld
// until the creator dirties the field group they concern or presses the finish
// control, so a brand new task is never greeted by its own errors.
import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Task, TaskStep, TaskType, TaskMedia } from '@rushpoint/shared';
import {
  normalizeTriggerMode, parseYouTubeId, youTubeEmbedUrl, isTaskMediaValid,
  validateUnlockGraph, validateAvailabilityWindow,
  validateOrderItems, ORDER_ITEMS_MIN, ORDER_ITEMS_MAX,
  validateSurveyChoices, SURVEY_CHOICES_MIN, SURVEY_CHOICES_MAX,
  locationLeakWarnings,
  // task-duration-defaults: the per-interaction derived estimate the editor suggests.
  defaultExpectedDurationMinutes, TASK_DURATION_MAX_MINUTES,
  // visible-time-estimates: the WALK INCLUSIVE estimate the scoring sigmoid reads.
  defaultEstimatedMinutes, TASK_ESTIMATE_MAX_MINUTES,
  normalizeTags,
} from '@rushpoint/shared';
import { Button, Input, Label, TagChips, Textarea } from './ui';
import { parseTagsInput } from '../lib/tags';
import { loadPopularTags } from '../services/calls';
import { dialog } from './dialog';
import { uploadTaskMedia } from '../services/firebase';
import { useT } from './LanguageContext';
import LocationStep from './LocationStep';
import RichTooltip from './RichTooltip';
import QuizChoicesEditor from './QuizChoicesEditor';
import { BuilderIcon, TRIGGER_ICON_NAME, TYPE_ICON_NAME } from './builderIcons';
import {
  type WizardStep, type WizardStepKey, WIZARD_STEP_ORDER, TYPE_PICKER_ORDER,
  stepKeyAt, stepIndexOf, canGoNext, canGoBack, taskPlacementState, isTaskInteractionValid,
} from '../lib/wizardLogic';
// The modular opt-in groups that replaced the five collapsible sections
// (change: task-editor-progressive-disclosure).
import {
  type OptInGroupKey, OPT_IN_GROUP_KEYS,
  defaultActiveGroups, groupApplies, groupSummary, foldGroupAway,
} from '../lib/taskOptInGroups';
import {
  type RevealState, type ValidationField,
  initialRevealState, markTouched, shouldReveal, nextFinishAction, taskRevealBlockers,
} from '../lib/taskValidationGating';
import {
  type TaskSample, type SampleOverwriteField, applySample, samplesForType, sampleWouldOverwrite,
} from '../lib/taskTemplates';
// The 2-option location picker's pure decisions (change: task-location-mode-consolidation).
import {
  type LocationChoice, TIGHT_RADIUS_M, DEFAULT_RADIUS_M, CHOICE_ICON_MODE,
  locationChoiceOf, skipsGpsCheck, locationChoicePatch, radiusPatch, skipGpsPatch,
} from '../lib/locationPicker';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// Inline (beside-control / tooltip-trigger) variant of the ui-kit block <Label>.
function InlineLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-[--ink-3] uppercase tracking-wider">{children}</span>;
}

// A lightweight subheading that breaks the Advanced mega-section into labelled
// groups (change: advanced-subheadings). Reuses InlineLabel; the hairline + spacing
// are the only added markup, so it separates without inventing a new visual style.
function AdvGroup({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 mb-1 pt-2 border-t border-[--rp-border] first:mt-0 first:pt-0 first:border-0">
      <InlineLabel>{children}</InlineLabel>
    </div>
  );
}

const DIFF_BANDS: { key: string; value: number; test: (d: number) => boolean }[] = [
  { key: 'easy', value: 2, test: (d) => d <= 3 },
  { key: 'mid', value: 5, test: (d) => d >= 4 && d <= 6 },
  { key: 'hard', value: 8, test: (d) => d >= 7 },
];

export default function TaskWizard({ task, onChange, onRemove, onDone, onClose, closeLabel, gameId, siblings, revealAll }: {
  task: Task; onChange: (t: Task) => void; onRemove?: () => void; onDone: () => void;
  onClose: () => void; closeLabel: string; gameId?: string;
  // The other tasks of the SAME stage (change: unlockable-tasks) — the
  // prerequisite multi-select offers exactly these, so cross-stage/unknown ids
  // can't even be authored from the UI.
  siblings?: Task[];
  // Set when the editor was opened by following a readiness entry that names this
  // task: the creator arrived by clicking the statement of the problem, so the
  // form must not be silent (change: builder-first-task-flow).
  revealAll?: boolean;
}) {
  const t = useT();
  const b = t.builder;
  const [step, setStep] = useState<WizardStep>(1);
  // Which validation messages may be shown. Lives here and resets on mount (the
  // panel is keyed by task id), because the persistent, game wide record of what
  // is broken is the readiness surface, not this editor.
  const [reveal, setReveal] = useState<RevealState>(() => initialRevealState({ revealAll }));
  // Re-opening the SAME task from a readiness entry does not remount the panel,
  // so honour a late revealAll too.
  useEffect(() => { if (revealAll) setReveal((s) => (s.revealAll ? s : { ...s, revealAll: true })); }, [revealAll]);
  const touch = (f: ValidationField) => setReveal((s) => markTouched(s, f));
  const revealed = (f: ValidationField) => shouldReveal(reveal, f);
  const set = (p: Partial<Task>) => onChange({ ...task, ...p });
  const setSmart = (p: Record<string, unknown>) =>
    onChange({ ...task, smart: { enabled: true, verificationType: task.smart?.verificationType ?? 'code_verification', ...task.smart, ...p } });

  // Which optional field GROUPS are mounted (change:
  // task-editor-progressive-disclosure, revised by
  // builder-nondestructive-disclosure). Held here rather than in the step body so
  // the state survives hopping between steps. Every group mounts COLLAPSED; a
  // populated one advertises itself through its chip's count badge rather than by
  // unfolding — see lib/taskOptInGroups.
  const [active, setActive] = useState<Record<OptInGroupKey, boolean>>(() => defaultActiveGroups(task));
  const openGroup = (k: OptInGroupKey) => setActive((a) => ({ ...a, [k]: true }));
  // Hide folds the group back to a chip and writes NOTHING to the task. The
  // decision lives in lib/taskOptInGroups so "hiding never edits" is unit-tested
  // rather than reviewed by eye; this used to clear the group's fields first,
  // which turned "hide this section" into silent data loss via the autosave.
  const hideGroup = (k: OptInGroupKey) =>
    setActive((a) => foldGroupAway(task, a, k).active);
  const groups = { active, openGroup, hideGroup };

  // Each step body derives the location state it needs for itself: the Location
  // step reasons in the creator's two choices (lib/locationPicker), the
  // interaction step in "does this task have a GPS gate" (for the pause-clock
  // warning). Nothing at this level needs either, so nothing is computed here.

  const STEP_LABEL: Record<WizardStepKey, string> = {
    location: b.stepLocation, details: b.stepDetails, execution: b.stepExecution,
  };
  const stepKey = stepKeyAt(step);
  const lastStep = WIZARD_STEP_ORDER.length;
  // The reveal-gated messages this task would show. The finish control reveals
  // them once and then closes; it is never disabled.
  const blockers = taskRevealBlockers(task);
  const finish = () => {
    if (nextFinishAction(reveal, blockers) === 'reveal') {
      setReveal((s) => blockers.reduce((acc, f) => markTouched(acc, f), s));
      // Every reveal-gated message lives on the interaction step, so landing
      // there IS landing on the first offender.
      setStep(stepIndexOf('execution') as WizardStep);
      return;
    }
    onDone();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Step tabs (single line) + close — one compact row, no separate title bar. */}
      <div className="flex items-center gap-1.5 pb-2 shrink-0">
        <div role="tablist" className="flex gap-1.5 flex-1 min-w-0">
        {/* Tabs and bodies both read WIZARD_STEP_ORDER, so a tab and the body
            under it can never disagree. */}
        {WIZARD_STEP_ORDER.map((key, i) => {
          const s = (i + 1) as WizardStep;
          const active = s === step; const done = s < step;
          return (
            <button key={key} role="tab" aria-selected={active} onClick={() => setStep(s)}
              className={`flex-1 min-w-0 rounded-lg border px-2 py-1.5 flex items-center justify-center gap-1.5 transition-colors ${
                active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire'
                  : done ? 'border-rp-go/40 text-rp-go' : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
              <span className="text-[10px] font-semibold shrink-0">{done ? '✓' : s}</span>
              <span className="text-[12px] font-medium truncate">{STEP_LABEL[key]}</span>
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
          grow to fill; the other steps scroll only inside themselves if ever
          needed. */}
      <div className="flex-1 min-h-0 pe-0.5 flex flex-col">
        {stepKey === 'location' && <LocationStepBody task={task} set={set} b={b} />}
        {stepKey === 'details' && <div className="flex-1 min-h-0 overflow-y-auto space-y-2"><DetailsStepBody task={task} set={set} b={b} replace={onChange} gameId={gameId} /></div>}
        {stepKey === 'execution' && <div className="flex-1 min-h-0 overflow-y-auto space-y-2"><ExecutionStepBody task={task} set={set} setSmart={setSmart} replace={onChange} b={b} groups={groups} revealed={revealed} touch={touch} siblings={siblings} /></div>}
      </div>

      {/* Footer. The "this task cannot be completed" line is a response to an
          edit or to a finish attempt, never a greeting on a brand new task. */}
      {stepKey === 'execution' && !isTaskInteractionValid(task) && blockers.some(revealed) && (
        <p className="text-[11px] text-rp-fire leading-snug pt-1 shrink-0">{b.interactionIncomplete}</p>
      )}
      <div className="flex items-center gap-2 pt-2 shrink-0 border-t border-[--rp-border] mt-2">
        {canGoBack(step) ? (
          <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as WizardStep)}>← {b.back}</Button>
        ) : <span />}
        {onRemove && <button onClick={onRemove} className="text-neon-red text-xs hover:underline">{b.deleteTask}</button>}
        {/* Finish is reachable from EVERY step and is never disabled: the first
            press reveals every unrevealed blocker and keeps the editor open (it
            lands on the offending step), the next one closes. */}
        <div className="ms-auto flex items-center gap-2">
          {step < lastStep && (
            <Button disabled={!canGoNext(stepKey, task)} onClick={() => setStep((s) => (s + 1) as WizardStep)}>{b.next} →</Button>
          )}
          <Button variant={step < lastStep ? 'ghost' : undefined} onClick={finish}>{b.done}</Button>
        </div>
      </div>
    </div>
  );
}

type B = ReturnType<typeof useT>['builder'];

// Opt-in group state, owned by the wizard and shared with step 3.
type Groups = {
  active: Record<OptInGroupKey, boolean>;
  openGroup: (k: OptInGroupKey) => void;
  hideGroup: (k: OptInGroupKey) => void;
};

// ── The modular opt-in primitive (change: task-editor-progressive-disclosure) ──
// Deliberately NOT the ui-kit `Advanced` accordion. An accordion is one trigger
// over one panel, so folding every optional field behind it just relocates the
// wall of controls one click away. Here each group is either a small CHIP or the
// real fields with their own Remove control, so a creator only ever sees the
// groups they asked for.
//
// A group is mounted on load whenever it already holds content
// (lib/taskOptInGroups) — an authored hint is never hidden behind a chip.
function OptInChip({ label, count, onClick, b }: {
  label: string; count: number; onClick: () => void; b: B;
}) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-[--rp-border] px-3 py-1.5 text-[12px] text-[--ink-2] hover:bg-[--surface-2] hover:text-[--ink-1] transition-colors">
      <span aria-hidden className="text-[--ink-3]">+</span>
      <span>{label}</span>
      {count > 0 && (
        <span className="rounded-full bg-rp-fire/10 text-rp-fire px-1.5 py-px text-[10px]">{b.sectionSetCount(count)}</span>
      )}
    </button>
  );
}

// An opted-in group: a titled block whose control folds it back to a chip.
// The control HIDES ONLY — it never clears the fields (change:
// builder-nondestructive-disclosure). Whatever is set here survives the fold and
// keeps showing on the chip's count badge, so a creator can put a section away
// without losing what they typed. Styling is neutral, not `hover:text-neon-red`:
// a danger colour on a non-destructive control is the same lie in reverse.
function OptInGroup({ title, onHide, hideLabel, children }: {
  title: string; onHide: () => void; hideLabel: string; children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[--rp-border] p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[--ink-3] uppercase tracking-wider">{title}</span>
        <button type="button" onClick={onHide} aria-label={hideLabel} title={hideLabel}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] leading-none">
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

// "Hide location" + its clue (change: hidden-location-task), lifted out of the old
// `rules` section so it can live inside the Location step's Advanced panel — it
// only ever applied to a located task (types/index.ts: "layers on any located
// task"), so it belongs beside the control that governs location, not three
// sections away.
//
// Guard: a hidden spot with no GPS check could never be verified as found, so the
// control is withheld (with a reason) while "skip the GPS check" is on rather than
// offering a combination that produces an unfindable task.
// ⚠ This is a CLIENT-ONLY rule. `checkHiddenLocationTask` (packages/shared/src/geo.ts)
// encodes it, but nothing under `functions/src` calls it — only test-hidden-location.ts
// does. A direct `updateGame` call CAN still persist hidden + instant today. Do not
// describe this as server-enforced until a save/launch door actually calls it.
function HideLocationField({ task, set, b }: { task: Task; set: (p: Partial<Task>) => void; b: B }) {
  if (skipsGpsCheck(task)) {
    return <p className="text-[11px] text-[--ink-3] leading-snug">{b.locHideNeedsGps}</p>;
  }
  return (
    <div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={!!task.hideLocation}
          onChange={(e) => set(e.target.checked
            ? { hideLocation: true }
            : { hideLocation: undefined, locationClue: undefined, locationClueHe: undefined })} />
        <span>
          <span className="text-[13px] font-medium text-[--ink-1]">{b.hideLocation}</span>
          <span className="block text-[11px] text-[--ink-3] leading-snug">{b.hideLocationDesc}</span>
        </span>
      </label>
      {task.hideLocation && (
        <div className="mt-1.5">
          <Label dense>{b.locationClueField}</Label>
          <Textarea dense value={task.locationClue ?? ''} onChange={(e) => set({ locationClue: e.target.value })}
            placeholder={b.locationCluePlaceholder} rows={2} dir="auto" />
          {taskPlacementState(task) === 'unplaced' ? (
            // A hidden task is still a located task — the placement step's
            // "not placed yet" state and the readiness surface are what
            // guarantee real coordinates exist before the run launches.
            <p className="text-[11px] text-rp-fire mt-1">{b.hideLocationNeedsCoords}</p>
          ) : !task.locationClue?.trim() && (
            <p className="text-[11px] text-[--ink-3] mt-1">{b.hideLocationNeedsClue}</p>
          )}
          {/* Leak guard (change: hidden-location-leak-guard): title/description
              still ship to players, so warn if they name the place. Advisory only. */}
          {(() => {
            const leaks = locationLeakWarnings(task);
            if (leaks.length === 0) return null;
            return (
              <p className="text-[11px] text-rp-fire mt-1">
                {leaks.length === 2 ? b.hideLocationLeakBoth
                  : leaks[0] === 'title' ? b.hideLocationLeakTitle
                  : b.hideLocationLeakDesc}
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Step 1: Location ──
// TWO top-level choices only (change: task-location-mode-consolidation):
// Anywhere / Specific location. Every technical control — the radius number,
// "skip the GPS check" and "hide location" — lives in ONE Advanced panel nested
// under Specific location, so a creator who touches nothing still gets today's
// 40 m arrival check. The four stored `TriggerMode` values are unchanged: see
// lib/locationPicker for why 'instant' stays a LOCATED task rather than being
// folded into 'anywhere'.
function LocationStepBody({ task, set, b }: {
  task: Task; set: (p: Partial<Task>) => void; b: B;
}) {
  const [expanded, setExpanded] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const choice = locationChoiceOf(task);
  const CHOICES: { choice: LocationChoice; label: string; sub: string; desc: string }[] = [
    { choice: 'anywhere', label: b.locAnywhere, sub: b.locAnywhereSub, desc: b.locAnywhereDesc },
    { choice: 'specific', label: b.locSpecific, sub: b.locSpecificSub, desc: b.locSpecificDesc },
  ];
  const radius = task.geofenceRadiusMeters ?? DEFAULT_RADIUS_M;
  const skipGps = skipsGpsCheck(task);
  const onChange = (lat: number, lng: number) => set({ coordinates: { lat, lng } });
  return (
    // `overflow-y-auto` is the SAFETY VALVE for the map's min-height floor, not the
    // layout strategy: on any normal panel everything fits and no scrollbar appears.
    // It only engages on a viewport too short for a usable map, where scrolling to a
    // real map beats staring at a clipped one.
    <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto">
      <div className="shrink-0">
        <Label>{b.fireQuestion}</Label>
        {/* The two location choices lead (bigger, primary — this is the actual
            decision), with "Advanced options" as a square toggle trailing them
            (change: builder-location-step-polish). It used to be a small gear pill
            squeezed onto the question row, easy to miss and cramped against the
            question text; a full-height square with its own icon and label is both
            more visible and reads as what it is — a secondary, optional control
            beside the primary choice, not a peer of it. `items-stretch` (the flex
            default) makes it match the choice row's height with no fixed number to
            keep in sync. DOM order, not left/right classes, decides which SIDE it
            lands on: RTL puts the first child on the right, so this naturally
            mirrors correctly in LTR too. */}
        <div className="flex items-stretch gap-2 mt-1.5">
          <div className="flex-1 grid grid-cols-2 gap-2">
            {CHOICES.map((c) => {
              const active = choice === c.choice;
              return (
                <button key={c.choice} type="button" onClick={() => set(locationChoicePatch(task, c.choice))}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 py-4 px-2 transition-colors ${
                    active
                      ? 'border-rp-fire bg-rp-fire/10 text-rp-fire shadow-soft'
                      : 'border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2] hover:border-[--ink-3]'}`}>
                  <BuilderIcon name={TRIGGER_ICON_NAME[CHOICE_ICON_MODE[c.choice]]} className="w-7 h-7" />
                  <span className="text-[14px] font-semibold leading-tight text-center">{c.label}</span>
                  <span className="text-[11px] leading-tight text-center opacity-70">{c.sub}</span>
                </button>
              );
            })}
          </div>
          {choice === 'specific' && (
            <button type="button" onClick={() => setAdvOpen((o) => !o)} aria-expanded={advOpen}
              title={b.locAdvanced}
              className={`shrink-0 w-20 sm:w-24 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-1.5 transition-colors ${
                advOpen
                  ? 'border-rp-fire bg-rp-fire/10 text-rp-fire shadow-soft'
                  : 'border-[--rp-border] text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] hover:border-[--ink-3]'}`}>
              <span aria-hidden className="text-xl leading-none">⚙</span>
              <span className="text-[11px] font-medium leading-tight text-center">{b.locAdvancedShort}</span>
            </button>
          )}
        </div>
        <p className="text-[11px] text-[--ink-3] leading-snug mt-1.5">
          {choice === 'anywhere' ? b.locAnywhereDesc : b.locSpecificDesc}
        </p>
      </div>

      {/* Advanced settings: in flow, but ONLY while open (change:
          builder-step1-full-height-map, revised). Collapsed it is not here at all —
          its trigger is the gear on the question row above, so the old always-present
          accordion header is gone. Opening it is a deliberate act, so briefly trading
          map height for the settings the creator just asked for is the expected
          behaviour; capped and scrollable so it can never eat the whole step. The
          previous attempt floated this over the map and made the map unreadable. */}
      {choice === 'specific' && advOpen && (
        <div className="shrink-0 max-h-[45%] overflow-y-auto rounded-lg border border-[--rp-border] bg-[--surface-2] p-2.5">
          <div className="space-y-3">
              <div>
                <Label dense>{b.locRadiusLabel}</Label>
                <div className="flex items-center gap-1.5">
                  <Input dense type="number" min={1} className="w-24" value={radius}
                    onChange={(e) => set(radiusPatch(task, Math.max(1, parseInt(e.target.value) || DEFAULT_RADIUS_M)))} />
                  <span className="text-[11px] text-[--ink-3]">{b.metersShort}</span>
                  {/* The two old top-level buttons, demoted to one-tap presets. */}
                  <div className="flex gap-1 ms-auto">
                    <Button variant="ghost" className="text-[11px] px-2 py-1"
                      onClick={() => set(radiusPatch(task, TIGHT_RADIUS_M))}>{b.locRadiusPresetTight}</Button>
                    <Button variant="ghost" className="text-[11px] px-2 py-1"
                      onClick={() => set(radiusPatch(task, DEFAULT_RADIUS_M))}>{b.locRadiusPresetDefault}</Button>
                  </div>
                </div>
                <p className="text-[11px] text-[--ink-3] leading-snug mt-1">{b.locRadiusHelp}</p>
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={skipGps}
                  onChange={(e) => set(skipGpsPatch(task, e.target.checked))} />
                <span>
                  <span className="text-[13px] font-medium text-[--ink-1]">{b.locSkipGps}</span>
                  <span className="block text-[11px] text-[--ink-3] leading-snug">{b.locSkipGpsDesc}</span>
                </span>
              </label>

            {/* Hide location moved here from the old, disconnected `rules`
                section: it only ever applied to a located task. */}
            <HideLocationField task={task} set={set} b={b} />
          </div>
        </div>
      )}

      {/* "Not placed yet" (change: builder-first-task-flow). A located task that
          still carries the {0,0} sentinel says so plainly, in the same calm
          informational register the mode explanation uses. Deliberately NOT the
          rp-fire error styling: at this point in the flow it is an unfinished step,
          not a mistake. The launch refusal lives on the readiness surface.

          ONE LINE, and no body copy: the explanatory paragraph turned this into a
          card that covered the map when it was floated there, and stole three lines
          when it sat in flow. The title states the situation and the button acts on
          it, which is all this moment needs. */}
      {choice === 'specific' && taskPlacementState(task) === 'unplaced' && (
        <div className="shrink-0 flex items-center gap-2 rounded-lg bg-[--surface-2] px-2.5 py-1.5">
          <span aria-hidden className="text-xs leading-none">📍</span>
          <p className="text-[11px] text-[--ink-2] min-w-0 flex-1 truncate">{b.notPlacedTitle}</p>
          <Button variant="ghost" className="text-[11px] shrink-0 px-2 py-0.5" onClick={() => setExpanded(true)}>{b.notPlacedAction}</Button>
        </div>
      )}

      {/* The map shows for EVERY Specific location task, including one that skips
          the GPS check — such a task still has a pin and is still routed to, which
          is exactly why 'instant' lives on this side of the picker.

          The map is the ONLY flex-1 element here, and the single control floating on
          it is "enlarge" — deliberately one, at a corner. The previous revision put a
          settings chip and a multi-line "not placed" card on top of the map too, and
          on a map this size that hid the very thing the step exists for. */}
      {/* min-h floor: `flex-1` alone let the map shrink to whatever was left after
          the question, the two choice buttons and LocationPicker's own search row —
          on a short panel that was a ~200px strip nobody can place a pin on. A map
          below this size is not a smaller map, it is a broken control, so it holds
          280px and the step scrolls in the rare case that does not fit. Everything
          else on this step was already cut to earn this space. */}
      {choice === 'specific' ? (
        <div className="flex-1 min-h-[280px] flex flex-col relative">
          {/* Handed to the MAP rather than positioned here (change:
              builder-ux-round-2). This wrapper spans LocationPicker's search row AND
              the coordinates field below the tiles, so anchoring to it put the
              button on the search button (top) and then on the coordinates input
              (bottom) — two bugs from the same wrong assumption. `cornerControl`
              places it in the map's own coordinate space, beside MapModeToggle. */}
          <LocationStep coordinates={task.coordinates} onChange={onChange} fill
            cornerControl={(
              <button type="button" onClick={() => setExpanded(true)}
                aria-label={b.enlargeMap} title={b.enlargeMap}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-[--rp-border] bg-[--surface-1]/90 backdrop-blur text-[--ink-2] hover:text-[--ink-1] shadow-soft">
                <span className="text-sm leading-none">⛶</span>
              </button>
            )} />
        </div>
      ) : (
        <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2 shrink-0">
          {b.anywhereInfo}
        </p>
      )}

      {/* Rendered via a portal to document.body: an ancestor's `transform`
          (the sliding panel) would otherwise trap this `position: fixed` modal. */}
      {expanded && choice === 'specific' && createPortal(
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
function QuizModeSection({ task, set, b, revealed, touch }: {
  task: Task; set: (p: Partial<Task>) => void; b: B;
  revealed: (f: ValidationField) => boolean; touch: (f: ValidationField) => void;
}) {
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
        ? <OrderingItemsEditor task={task} set={set} b={b}
            revealError={revealed('quizOrdering')} onTouch={() => touch('quizOrdering')} />
        : <QuizChoicesEditor task={task} onChange={(p) => set(p)}
            revealError={revealed('quizChoices')} onTouch={() => touch('quizChoices')} />}
    </div>
  );
}

// Ordering list editor: rows are local UI state (a cleared field never vanishes
// mid-typing); only a VALID cleaned list (3 to 10 distinct non-empty items, in
// the authored = correct order) is pushed up as `orderItems` — an invalid
// transient state pushes undefined so the debounced auto-save (updateGame
// validates server-side) is never wedged, and the Done gate stays closed.
function OrderingItemsEditor({ task, set, b, revealError, onTouch }: {
  task: Task; set: (p: Partial<Task>) => void; b: B; revealError: boolean; onTouch: () => void;
}) {
  const [rows, setRows] = useState<{ id: string; text: string }[]>(() => {
    const initial = (task.orderItems ?? []).map((text) => ({ id: uuid(), text }));
    while (initial.length < ORDER_ITEMS_MIN) initial.push({ id: uuid(), text: '' });
    return initial;
  });

  const apply = (next: { id: string; text: string }[]) => {
    // The creator engaged with the item list, so its message may speak from now
    // on. The auto padded empty rows above never trigger this.
    onTouch();
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
  const error = !revealError
    ? null
    : clean.length < ORDER_ITEMS_MIN || clean.length > ORDER_ITEMS_MAX
      ? b.orderingCountError
      : validateOrderItems(clean) !== null
        ? b.orderingDuplicateError
        : null;

  return (
    <div className="space-y-1.5">
      <Label dense>{b.orderingItemsLead}</Label>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-1.5">
            <span className="text-[11px] text-[--ink-3] w-4 text-end shrink-0">{i + 1}.</span>
            <Input dense value={row.text} dir="auto" className="flex-1 min-w-0"
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
function SurveyChoicesSection({ task, set, b, revealError, touch }: {
  task: Task; set: (p: Partial<Task>) => void; b: B; revealError: boolean; touch: () => void;
}) {
  const [choices, setChoices] = useState(!!task.surveyChoices && task.surveyChoices.length > 0);
  const [rows, setRows] = useState<{ id: string; text: string }[]>(() => {
    const initial = (task.surveyChoices ?? []).map((text) => ({ id: uuid(), text }));
    while (initial.length < SURVEY_CHOICES_MIN) initial.push({ id: uuid(), text: '' });
    return initial;
  });

  const apply = (next: { id: string; text: string }[]) => {
    touch();
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
          <Label dense>{b.surveyChoicesLead}</Label>
          <div className="space-y-1">
            {rows.map((row, i) => (
              <div key={row.id} className="flex items-center gap-1.5">
                <span className="text-[11px] text-[--ink-3] w-4 text-end shrink-0">{i + 1}.</span>
                <Input dense value={row.text} dir="auto" className="flex-1 min-w-0"
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
          {error && revealError && <p className="text-[11px] text-rp-amber">{b.surveyChoicesError}</p>}
        </div>
      )}
    </div>
  );
}

// The nine task types' label + one-line description, read by both the picker
// (step 2) and the "nothing to configure" note (step 3).
// THREE strings per type, and the difference matters (change: builder-ux-round-2):
//   label — the button
//   short — the CAPTION under the type grid. A caption is glanced at, not read, so
//           it names the interaction in two or three words.
//   desc  — the full sentence, kept for the RichTooltip body and Step 3's
//           `noConfigNote`, where the creator has deliberately asked for detail.
// The caption used to reuse `desc`, which is why one verbose sentence had to serve
// three surfaces at once and read as clutter in the one that needed brevity.
function typeMetaOf(b: B): Record<TaskType, { label: string; short: string; desc: string }> {
  return {
    smart_station: { label: b.typeStation, short: b.typeStationShort, desc: b.typeStationDesc },
    photo: { label: b.typePhoto, short: b.typePhotoShort, desc: b.typePhotoDesc },
    quiz: { label: b.typeQuiz, short: b.typeQuizShort, desc: b.typeQuizDesc },
    numeric: { label: b.typeNumeric, short: b.typeNumericShort, desc: b.typeNumericDesc },
    field: { label: b.typeField, short: b.typeFieldShort, desc: b.typeFieldDesc },
    self_report: { label: b.typeSelfReport, short: b.typeSelfReportShort, desc: b.typeSelfReportDesc },
    geofence: { label: b.typeGeofence, short: b.typeGeofenceShort, desc: b.typeGeofenceDesc },
    sequence: { label: b.typeSequence, short: b.typeSequenceShort, desc: b.typeSequenceDesc },
    survey: { label: b.typeSurvey, short: b.typeSurveyShort, desc: b.typeSurveyDesc },
  };
}

// ── Step 2: Details & type ──
// EXACTLY three controls (change: task-editor-progressive-disclosure): title,
// description, task type. Difficulty moved to the "timer / points" opt-in group
// on step 3, beside the point value it actually interacts with; every other
// optional field became a chip there too. This step is the one a creator must
// answer, so it asks nothing else.
function DetailsStepBody({ task, set, b, replace, gameId }: {
  task: Task; set: (p: Partial<Task>) => void; b: B; replace: (t: Task) => void;
  // Media is authored here now (change: task-media-durability), and the upload path
  // needs the game id to build its storage prefix.
  gameId?: string;
}) {
  // Which type's sample list is open (only for a type that offers more than one).
  const [samplePickerFor, setSamplePickerFor] = useState<TaskType | null>(null);
  const TYPE_META = typeMetaOf(b);

  // ── Inspiration Mode (change: builder-first-task-flow) ──
  // One click turns an empty task into a working, completable example of any
  // type, which the creator then edits instead of authoring from nothing.
  const OVERWRITE_LABEL: Record<SampleOverwriteField, string> = {
    title: b.sampleFieldTitle, description: b.sampleFieldDescription, answerKey: b.sampleFieldAnswerKey,
  };
  const applyTypeSample = async (ty: TaskType, sample: TaskSample) => {
    setSamplePickerFor(null);
    const overwrites = sampleWouldOverwrite(task, sample);
    if (overwrites.length > 0) {
      const names = overwrites.map((f) => OVERWRITE_LABEL[f]).join(', ');
      if (!(await dialog.confirm(b.sampleOverwriteConfirm(names)))) return;
    }
    // Applying a sample marks NOTHING touched: a sample always produces a
    // completable task, so there is no message to reveal.
    replace(applySample({ ...task, type: ty }, sample));
  };
  const onSampleClick = (ty: TaskType) => {
    const samples = samplesForType(ty);
    if (samples.length === 0) return;
    if (samples.length === 1) { void applyTypeSample(ty, samples[0]); return; }
    setSamplePickerFor((cur) => (cur === ty ? null : ty));
  };

  return (
    <>
      <div>
        <Label dense>{b.titleField}</Label>
        <Input dense value={task.title} onChange={(e) => set({ title: e.target.value })} placeholder={b.titlePlaceholder} dir="auto" autoFocus />
        {/* The naming gate is the wizard's ONLY forward gate, so it states its
            reason beside the field. Calm register: this is a hint, not an error. */}
        {task.title.trim() === '' && (
          <p className="text-[11px] text-[--ink-3] leading-snug mt-1">{b.titleRequiredHint}</p>
        )}
      </div>
      <div>
        <Label dense>{b.descriptionField}</Label>
        <Textarea dense value={task.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder={b.descriptionPlaceholder} rows={2} dir="auto" />
      </div>

      {/* A picture belongs WITH the mission description, not three clicks away
          (change: task-media-durability). This used to live at the bottom of step 3
          behind an opt-in chip, so a creator had to reach the last step and then guess
          which chip hid the file picker. It now lives here instead — but folded to a
          single small chip by default (same footprint the step-3 opt-in chip had), so
          a task with no media doesn't pay for a whole upload section's worth of
          vertical space. MediaSection owns its own fold state; see the note there. */}
      <MediaSection task={task} set={set} b={b} gameId={gameId} replace={replace} />

      <div>
        <Label dense>{b.howComplete}</Label>
        {/* Compact type picker: icon + label grid, with a one-line description for
            the active type below. */}
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
                  className={`w-full flex items-center gap-1.5 rounded-lg border px-2 pe-11 py-1.5 text-start transition-colors ${
                    active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire' : 'border-[--rp-border] text-[--ink-2] hover:bg-[--surface-2]'}`}>
                  <BuilderIcon name={TYPE_ICON_NAME[ty]} className="w-4 h-4 shrink-0" />
                  <span className="text-[11px] font-medium truncate">{TYPE_META[ty].label}</span>
                </button>
                <span className="absolute top-1/2 -translate-y-1/2 end-1 z-10 flex items-center gap-0.5">
                  {/* Load an authored, immediately completable example of this
                      type. The accessible name says which type it loads. */}
                  <button type="button" onClick={() => onSampleClick(ty)}
                    aria-label={b.loadSampleFor(TYPE_META[ty].label)} title={b.loadSampleFor(TYPE_META[ty].label)}
                    aria-expanded={samplePickerFor === ty}
                    className="w-4 h-4 rounded-full bg-[--surface-2] text-[--ink-3] text-[10px] leading-none flex items-center justify-center hover:text-rp-fire focus:outline-none focus:ring-1 focus:ring-rp-fire">
                    ✨
                  </button>
                  <RichTooltip title={TYPE_META[ty].label} body={TYPE_META[ty].desc} svg={TYPE_ANIM[ty]} />
                </span>
                {/* A type with several samples offers its labelled list. */}
                {samplePickerFor === ty && (
                  <div className="absolute z-20 top-full mt-1 start-0 min-w-full w-max max-w-[15rem] rounded-lg border border-[--rp-border] bg-[--surface-1] shadow-soft p-1">
                    <p className="px-1.5 py-1 text-[10px] text-[--ink-3]">{b.samplePickTitle(TYPE_META[ty].label)}</p>
                    {samplesForType(ty).map((sample) => (
                      <button key={sample.label} type="button" dir="auto"
                        onClick={() => void applyTypeSample(ty, sample)}
                        className="w-full text-start rounded px-1.5 py-1 text-[11px] text-[--ink-2] hover:bg-[--surface-2] hover:text-[--ink-1] truncate">
                        {sample.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* The CAPTION takes the short form; the tooltip above and Step 3's note
            keep the full sentence (change: builder-ux-round-2). */}
        <p className="text-[11px] text-[--ink-3] leading-snug mt-1.5">{TYPE_META[task.type].short}</p>
      </div>
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

  return (
    <div className="space-y-1.5">
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
function MediaSection({ task, set, b, gameId, replace }: {
  task: Task; set: (p: Partial<Task>) => void; b: B; gameId?: string;
  // Needed for the post-upload commit: `set` patches the task captured by THIS render,
  // which is stale by the time a multi-second upload resolves. See `latest` below.
  replace?: (t: Task) => void;
}) {
  const media = task.media ?? [];
  // Folded to a small chip by default — the SAME footprint the old step-3 opt-in chip
  // had — so a task with no media doesn't pay for a whole upload section's worth of
  // space in the details step. Open whenever the task already carries media: an
  // authored attachment must never hide behind an unclicked chip (same doctrine as
  // `defaultActiveGroups` in taskOptInGroups.ts). This is local, per-mount state —
  // media is no longer a registered opt-in group (change: task-media-durability), so
  // there is no shared `groups.active` to read; the section owns its own fold.
  const [open, setOpen] = useState(media.length > 0);
  const [ytUrl, setYtUrl] = useState('');
  const [ytError, setYtError] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState(false);

  const commit = (next: TaskMedia[]) => set({ media: next.length ? next : undefined });

  // The latest task, readable from an async callback (change: task-media-durability).
  // `set`/`commit` build `{...task, ...patch}` from the render closure, so an upload that
  // takes eight seconds committed a task snapshot from BEFORE it started — silently
  // reverting every edit made while the file was going up, and losing the first of two
  // parallel uploads. A ref is the only thing here that is current at await-resolution.
  const latest = useRef(task);
  latest.current = task;

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadError(false);
    setUploadPct(0);
    try {
      const { url, kind } = await uploadTaskMedia(file, { gameId: gameId ?? 'draft', taskId: task.id }, setUploadPct);
      // The SAME predicate the server enforces. An upload that returns a url the server
      // will not accept used to look like a success and then quietly vanish on the next
      // autosave; the creator finds out now instead.
      if (!isTaskMediaValid({ kind, url })) { setUploadError(true); return; }
      const entry: TaskMedia = { id: uuid(), kind, url };
      const current = latest.current;
      const next = [...(current.media ?? []), entry];
      if (replace) replace({ ...current, media: next });
      else commit(next);
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

  if (!open) {
    return <OptInChip label={b.chipAttachMedia} count={media.length} onClick={() => setOpen(true)} b={b} />;
  }

  return (
    <OptInGroup title={b.mediaField} hideLabel={b.hideSection} onHide={() => setOpen(false)}>
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
                <Input dense value={m.caption ?? ''} onChange={(e) => setCaption(i, e.target.value)}
                  placeholder={b.mediaCaptionPlaceholder} dir="auto" />
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
          <Input dense value={ytUrl} onChange={(e) => { setYtUrl(e.target.value); setYtError(false); }}
            placeholder={b.mediaYouTubePlaceholder} dir="ltr" className="flex-1 min-w-0" />
          <Button variant="ghost" onClick={addYouTube} disabled={!ytUrl.trim()}>{b.mediaAddYouTube}</Button>
        </div>
        {ytError && <span className="text-[11px] text-neon-red">{b.mediaYouTubeError}</span>}
      </div>
    </OptInGroup>
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

// ── Step 3: Execution, verification & enhancements ──
// The REQUIRED, type-conditional verification fields come first and are never
// hideable — a quiz with no answers or a sequence with no steps is not a task,
// so putting either behind a chip would let a creator save something unplayable.
// Everything optional follows as a row of opt-in chips (change:
// task-editor-progressive-disclosure).
function ExecutionStepBody({ task, set, setSmart, replace, b, groups, revealed, touch, siblings }: {
  task: Task; set: (p: Partial<Task>) => void; setSmart: (p: Record<string, unknown>) => void;
  // visible-time-estimates: the other tasks of the SAME stage. Only used to measure
  // the median walking leg behind the suggested estimate.
  siblings?: Task[];
  // The whole-task setter, kept for the editors below that rewrite a task wholesale.
  replace: (t: Task) => void;
  b: B; groups: Groups;
  revealed: (f: ValidationField) => boolean; touch: (f: ValidationField) => void;
}) {
  const located = (() => { const m = normalizeTriggerMode(task); return m === 'radius' || m === 'exact'; })();
  const isAnswerTask = task.type === 'quiz' || task.type === 'numeric' || task.type === 'survey';
  const TYPE_META = typeMetaOf(b);
  const siblingCount = siblings?.length ?? 1;
  const DIFF_LABEL: Record<string, string> = { easy: b.easy, mid: b.mid, hard: b.hard };
  void replace;

  const GROUP_TITLE: Record<OptInGroupKey, string> = {
    hint: b.hintField, timerPoints: b.groupTimerPoints, rules: b.groupRules,
  };
  const CHIP_LABEL: Record<OptInGroupKey, string> = {
    hint: b.chipAddHint, timerPoints: b.chipSetTimerPoints, rules: b.chipRules,
  };
  // A group is shown ONLY when the creator opted in (change:
  // builder-nondestructive-disclosure). This used to also open whenever the task
  // already carried data for the group — the render-time twin of the mount-time
  // rule `defaultActiveGroups` fixes, and the one that actually decides what
  // renders each pass. Content is still discoverable while folded: its chip
  // carries a count badge (`groupSummary`, via `OptInChip` below), same guarantee,
  // one click away instead of forced open.
  const shown = (k: OptInGroupKey) => groups.active[k];
  const chips = OPT_IN_GROUP_KEYS.filter((k) => groupApplies(k, task, siblingCount) && !shown(k));

  return (
    <>
      <div className="space-y-2">
        {task.type === 'smart_station' && (
          <div>
            <Label dense>{b.secretCode}</Label>
            <Input dense value={task.smart?.secretCode ?? ''} placeholder={b.secretCodePlaceholder} dir="auto"
              onChange={(e) => {
                touch('stationCode');
                setSmart({ verificationType: 'code_verification', secretCode: e.target.value, hasCode: true });
              }} />
          </div>
        )}
        {task.type === 'photo' && (
          <div className="space-y-2">
            {/* audio-tasks: capture a photo (default) or an audio clip. Writes to
                task.smart.captureKind (never top-level). */}
            <div>
              <Label dense>{b.captureKindLabel}</Label>
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
            {/* The checkbox was always here; what it never said was the cost of
                leaving it OFF. Every submission then waits for a person during
                the run, and with 15 teams that person is the bottleneck. */}
            <p className="text-xs text-[--ink-3]">{b.autoApproveHint}</p>
          </div>
        )}
        {task.type === 'quiz' && <QuizModeSection task={task} set={set} b={b} revealed={revealed} touch={touch} />}
        {task.type === 'numeric' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label dense>{b.correctNumber}</Label>
              <Input dense type="number" value={task.numericAnswer ?? ''}
                onChange={(e) => {
                  touch('numericAnswer');
                  set({ numericAnswer: e.target.value === '' ? undefined : parseFloat(e.target.value) });
                }} />
            </div>
            <div>
              <Label dense>{b.tolerance}</Label>
              <Input dense type="number" min={0} value={task.numericTolerance ?? 0}
                onChange={(e) => set({ numericTolerance: Math.max(0, parseFloat(e.target.value) || 0) })} />
            </div>
          </div>
        )}
        {task.type === 'sequence' && (
          <StepsEditor steps={task.steps ?? []} b={b}
            onChange={(steps) => { touch('sequenceSteps'); set({ steps }); }} />
        )}
        {task.type === 'survey' && (
          <SurveyChoicesSection task={task} set={set} b={b}
            revealError={revealed('surveyChoices')} touch={() => touch('surveyChoices')} />
        )}
        {(task.type === 'smart_station' || task.type === 'photo') && (
          <div>
            <Label dense>{b.extendedInstructions}</Label>
            <Textarea dense value={task.smart?.longInstructions ?? ''} rows={2} placeholder={b.extendedPlaceholder} dir="auto"
              onChange={(e) => setSmart({ longInstructions: e.target.value })} />
          </div>
        )}
        {(task.type === 'field' || task.type === 'self_report' || task.type === 'geofence') && (
          <p className="text-xs text-[--ink-3] bg-[--surface-2] rounded-lg px-3 py-2">{b.noConfigNote(TYPE_META[task.type].desc)}</p>
        )}
      </div>

      {/* ── The modular opt-in groups ──────────────────────────────────────
          Each optional field group is either a chip or its real fields with a
          Remove control. A group whose data already exists renders expanded
          regardless of what the creator has clicked, so nothing authored is ever
          hidden. */}

      {shown('hint') && (
        <OptInGroup title={GROUP_TITLE.hint} hideLabel={b.hideSection} onHide={() => groups.hideGroup('hint')}>
          <div className="flex items-center gap-2">
            <RichTooltip concept="hint" />
          </div>
          <Textarea dense value={task.hint ?? ''} onChange={(e) => set({ hint: e.target.value })} placeholder={b.hintPlaceholder} rows={2} dir="auto" />
          <div className="flex items-center gap-2">
            <InlineLabel>{b.hintCost}</InlineLabel>
            <Input dense type="number" min={0} className="w-20" value={task.hintPenalty ?? 25}
              onChange={(e) => set({ hintPenalty: Math.max(0, parseInt(e.target.value) || 0) })} />
          </div>
          {/* Hint auto escalation (change: hint-auto-escalation): optional free
              thresholds — the hint stops costing points once the team has held
              the task N minutes OR burned N wrong attempts. 0/empty = off. The
              long explanation is demoted to a tooltip on the row. */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5" title={b.hintEscalationLead}>
            <div className="flex items-center gap-1.5">
              <Input dense type="number" min={0} step="0.5" className="w-16" value={task.hintAutoRevealMinutes ?? ''}
                aria-label={b.hintFreeAfterMinutes}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  set({ hintAutoRevealMinutes: Number.isFinite(v) && v > 0 ? v : undefined });
                }} />
              <InlineLabel>{b.hintFreeAfterMinutes}</InlineLabel>
            </div>
            <div className="flex items-center gap-1.5">
              <Input dense type="number" min={0} className="w-16" value={task.hintAutoRevealAttempts ?? ''}
                aria-label={b.hintFreeAfterAttempts}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  set({ hintAutoRevealAttempts: Number.isInteger(v) && v > 0 ? v : undefined });
                }} />
              <InlineLabel>{b.hintFreeAfterAttempts}</InlineLabel>
            </div>
          </div>
        </OptInGroup>
      )}

      {/* Media moved to the DETAILS step, beside the description it illustrates
          (change: task-media-durability) — it is no longer an opt-in group here. */}
      {shown('rules') && (
        <OptInGroup title={GROUP_TITLE.rules} hideLabel={b.hideSection} onHide={() => groups.hideGroup('rules')}>
          {/* Prerequisites need siblings to point at, so a one-task stage is
              offered the rest of the group without them. */}
          {siblingCount > 1 && (
            <div>
              <InlineLabel>{b.unlockAfterLead}</InlineLabel>
              <UnlockSection task={task} siblings={siblings ?? []} set={set} b={b} />
            </div>
          )}
          {isAnswerTask && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!task.requirePresence}
                onChange={(e) => set({ requirePresence: e.target.checked || undefined })} />
              <span>
                <span className="text-[13px] font-medium text-[--ink-1]">{b.requirePresence}</span>
                <span className="block text-[11px] text-[--ink-3] leading-snug">{b.requirePresenceDesc}</span>
              </span>
            </label>
          )}
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <InlineLabel>{b.maxTeams}</InlineLabel>
              <RichTooltip concept="concurrent" />
            </div>
            <Input dense type="number" min={1} value={task.maxConcurrentTeams} onChange={(e) => set({ maxConcurrentTeams: Math.max(1, parseInt(e.target.value) || 1) })} />
          </div>
          {/* Task tags (change: game-task-tags). `Task.tags` existed and was already
              denormalized into publicTasks and returned by searchTaskLibrary — but the
              ONLY code path that ever wrote it was copying a task OUT of the library,
              so a creator could never tag their own mission. */}
          <div>
            <InlineLabel>{b.advGroupTags}</InlineLabel>
            <TaskTagsField task={task} set={set} b={b} />
          </div>
          {/* "Hide location" used to live here. It moved into the Location step's
              Advanced panel (change: task-location-mode-consolidation), beside the
              radius and skip-GPS controls it belongs with. */}
        </OptInGroup>
      )}

      {shown('timerPoints') && (
        <OptInGroup title={GROUP_TITLE.timerPoints} hideLabel={b.hideSection} onHide={() => groups.hideGroup('timerPoints')}>
        {/* Difficulty on ONE line: the label sits beside its chips instead of above
            them, the same compact strip idiom the stage settings row uses. It lives
            here rather than on the details step because it only means anything next
            to the point value it scales. */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <InlineLabel>{b.difficulty}</InlineLabel>
            <RichTooltip concept="difficulty" />
          </div>
          <div className="flex gap-1.5 flex-1 min-w-0">
            {DIFF_BANDS.map((d) => {
              const active = d.test(task.difficulty);
              return (
                <button key={d.key} onClick={() => set({ difficulty: d.value })}
                  className={`flex-1 min-w-0 rounded-lg border py-1 text-[13px] transition-colors ${
                    active ? 'border-rp-fire bg-rp-fire/10 text-rp-fire font-medium' : 'border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]'}`}>
                  {DIFF_LABEL[d.key]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label dense>{b.points}</Label>
          <Input dense type="number" min={0} value={task.pointValue} onChange={(e) => set({ pointValue: Math.max(0, parseInt(e.target.value) || 0) })} />
        </div>

        <AdvGroup>{b.advGroupTiming}</AdvGroup>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label dense>{b.estMin}</Label>
            {/* visible-time-estimates: this is the OVERRIDE for the derived estimate
                shown just below. Kept where it has always been so the creator is not
                asked to learn a new place for the same number. */}
            <Input dense type="number" min={1} max={TASK_ESTIMATE_MAX_MINUTES}
              value={task.estimatedMinutes}
              onChange={(e) => set({
                estimatedMinutes: Math.min(
                  TASK_ESTIMATE_MAX_MINUTES,
                  Math.max(1, parseInt(e.target.value) || 1),
                ),
              })} />
          </div>
        </div>
        {/* The VISIBLE, SCORED estimate (change: visible-time-estimates). Distinct from
            the per-interaction duration below: the server stamps a task's clock at
            ASSIGNMENT, so this number is measured against WALK + interaction. It is
            derived as the interaction default plus a transit allowance taken from the
            median leg to this task's placed stage siblings. Suggestion only — nothing is
            written until the creator taps apply, so no stored game and no run in flight
            moves by a point. */}
        {(() => {
          const suggestedEstimate = defaultEstimatedMinutes(task, siblings ?? []);
          return (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap text-xs text-[--ink-3]">
                <span dir="auto">🚶 {b.estimateSuggested(String(suggestedEstimate))}</span>
                {task.estimatedMinutes !== suggestedEstimate && (
                  <button type="button" className="underline text-[--ink-2]"
                    onClick={() => set({ estimatedMinutes: suggestedEstimate })}>
                    {b.estimateUseSuggested}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[--ink-3]" dir="auto">{b.estimateHelp}</p>
            </div>
          );
        })()}

        {/* Per-interaction duration (change: task-duration-defaults). Nothing in the
            product ever set `expectedDurationMinutes`, so a 20 second photo snap and a
            10 minute puzzle were estimated identically. Show what THIS interaction
            typically takes at the stop, offer it with one tap, and let the creator
            override it. Nothing is written on its own: only a creator action persists
            a number, so no stored game and no run in flight moves by a point. */}
        {(() => {
          const suggested = defaultExpectedDurationMinutes(task);
          const fmt = (n: number) => String(Number(n.toFixed(2)));
          return (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap text-xs text-[--ink-3]">
                <span dir="auto">⏱ {b.durationSuggested(fmt(suggested))}</span>
                {task.expectedDurationMinutes !== suggested && (
                  <button type="button" className="underline text-[--ink-2]"
                    onClick={() => set({ expectedDurationMinutes: suggested })}>
                    {b.durationUseSuggested}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-[--ink-3]">
                <InlineLabel>{b.durationOverride}</InlineLabel>
                <Input dense type="number" min={0} max={TASK_DURATION_MAX_MINUTES} className="w-20"
                  value={task.expectedDurationMinutes ?? ''}
                  placeholder={fmt(suggested)} aria-label={b.durationOverride}
                  title={b.durationOverridePlaceholder(fmt(suggested))}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    set({
                      expectedDurationMinutes: Number.isFinite(n) && n > 0
                        ? Math.min(TASK_DURATION_MAX_MINUTES, n)
                        : undefined,
                    });
                  }} />
              </div>
              <p className="text-[11px] text-[--ink-3]" dir="auto">{b.durationHelp}</p>
            </div>
          );
        })()}

        {/* Task expiry (change: task-expiry): the task closes N minutes after the
            run starts — dropped from routing, refused on completion, auto-skipped
            when in flight. Empty/0 = never expires. */}
        <div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-[--ink-3]">
            <InlineLabel>⏳ {b.expiryLead}</InlineLabel>
            <Input dense type="number" min={0} className="w-20" value={task.expiresAfterMinutes ?? ''}
              placeholder="0" aria-label={b.expiryLead}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                set({ expiresAfterMinutes: Number.isFinite(n) && n > 0 ? n : undefined });
              }} />
            <span>{b.expiryAfterUnit}</span>
          </div>
          {validateAvailabilityWindow(task) !== null && (
            <p className="text-[11px] text-rp-fire mt-1">{b.expiryWindowError}</p>
          )}
          {/* Scheduled release disclosure (change: builder-first-task-flow).
              `releaseAt` / `releaseAfterMinutes` are honored by the server but the
              Builder has no editor for them; a task can still carry either through
              duplication, import or a seed script. Read only, and unconditional on
              any expiry, so a task is never gated shut at a time nothing in the
              interface mentions. The advanced badge counts them too. */}
          {task.releaseAt && (
            <p className="text-[11px] text-[--ink-3] mt-1">
              🕒 {b.expiryReleaseAtWarn(new Date(task.releaseAt).toLocaleString())}
            </p>
          )}
          {typeof task.releaseAfterMinutes === 'number' && task.releaseAfterMinutes > 0 && (
            <p className="text-[11px] text-[--ink-3] mt-1">🕒 {b.releaseAfterDisclosure(task.releaseAfterMinutes)}</p>
          )}
        </div>

        {/* The pause-clock toggle belongs with the timing it changes (change:
            pause-clock-tasks): offered on EVERY task type, off by default. Written
            as `true` / `undefined` and never `false`, so a game that never touched
            this control stays byte identical. On a located task the excluded span
            also covers the walk to the spot, so say so instead of hiding it. */}
        <div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={!!task.pausesTimer}
              onChange={(e) => set({ pausesTimer: e.target.checked || undefined })} />
            <span>
              <span className="text-[13px] font-medium text-[--ink-1]">{b.pauseClock}</span>
              {/* Small "advanced" marker (change: builder-simplification-round-2):
                  the control already sits below the AdvGroup "Advanced timing"
                  divider, but a scrolled/short group can hide that divider from
                  view, so the control also self-identifies. Reuses InlineLabel's
                  muted/uppercase styling at a smaller size — not a new component. */}
              <span className="ms-1.5 align-middle text-[9px] font-semibold text-[--ink-3] uppercase tracking-wider">
                {b.advancedTag}
              </span>
              <span className="block text-[11px] text-[--ink-3] leading-snug">{b.pauseClockDesc}</span>
            </span>
          </label>
          {task.pausesTimer && located && (
            <p className="text-[11px] text-rp-amber mt-1 ms-6">{b.pauseClockLocatedWarn}</p>
          )}
        </div>
        </OptInGroup>
      )}

      {/* The chip row: one chip per group the creator has NOT opted into and that
          holds no data. An empty row means everything is already on screen. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {chips.map((k) => (
            <OptInChip key={k} label={CHIP_LABEL[k]} count={groupSummary(k, task)} b={b}
              onClick={() => groups.openGroup(k)} />
          ))}
        </div>
      )}
    </>
  );
}

// A mission's library tags (change: game-task-tags). Same raw-string-in-state
// pattern as the game-level TagsField in BuilderPage: the visible input keeps
// exactly what the creator typed so a comma and the space after it survive
// mid-typing, while `Task.tags` is the parsed array. The chips below are the
// feedback that makes the comma rule visible — the reported bug was not a missing
// label, it was that nothing ever showed the tags back.
function TaskTagsField({ task, set, b }: { task: Task; set: (p: Partial<Task>) => void; b: B }) {
  const [raw, setRaw] = useState((task.tags ?? []).join(', '));
  // Popular gallery tags for one-tap "quick add" (change: recommended-tags-quick-add).
  // Shares the memoized fetch with the game-tags field; failure resolves to [].
  const [popular, setPopular] = useState<string[]>([]);
  useEffect(() => { let live = true; void loadPopularTags().then((t) => { if (live) setPopular(t); }); return () => { live = false; }; }, []);
  // Resync only when the persisted tags diverge from what the raw string would
  // produce (task switch / undo), never on the creator's own keystrokes.
  useEffect(() => {
    const derived = parseTagsInput(raw);
    if (JSON.stringify(derived) !== JSON.stringify(task.tags ?? [])) setRaw((task.tags ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.tags]);
  const current = task.tags ?? [];
  const have = new Set(current.map((t) => t.toLowerCase()));
  const suggestions = popular.filter((t) => !have.has(t.toLowerCase())).slice(0, 12);
  return (
    <div>
      <Label dense>{b.taskTagsLabel}</Label>
      <Input dense value={raw} placeholder={b.taskTagsPlaceholder} dir="auto"
        onChange={(e) => { setRaw(e.target.value); set({ tags: parseTagsInput(e.target.value) }); }} />
      <TagChips tags={task.tags} className="mt-1.5" more={b.moreTags} max={20} />
      {suggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] text-[--ink-3] mb-1">{b.popularTags}</p>
          <div className="flex flex-wrap items-center gap-1">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                dir="auto"
                onClick={() => set({ tags: normalizeTags([...current, tag]) })}
                className="inline-flex items-center max-w-full truncate px-2 py-0.5 rounded-full text-[11px] font-medium border border-dashed border-rp-fire/40 bg-rp-fire/5 text-rp-fire hover:bg-rp-fire/10"
              >
                + {tag}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-[--ink-3] mt-1">{b.tagsHelp}</p>
    </div>
  );
}

function StepsEditor({ steps, onChange, b }: { steps: TaskStep[]; onChange: (s: TaskStep[]) => void; b: B }) {
  const update = (i: number, p: Partial<TaskStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="space-y-2">
      <Label dense>{b.orderedSteps}</Label>
      {steps.map((s, i) => (
        <div key={s.id} className="flex gap-2 items-start">
          <span className="text-xs text-[--ink-3] mt-2.5 w-3">{i + 1}</span>
          <div className="flex-1 space-y-1">
            <Input dense value={s.prompt} onChange={(e) => update(i, { prompt: e.target.value })} placeholder={b.stepPrompt} dir="auto" />
            <Input dense value={s.answer ?? ''} onChange={(e) => update(i, { answer: e.target.value })} placeholder={b.stepAnswer} dir="auto" />
          </div>
          <button className="text-neon-red text-sm mt-2.5" aria-label={`${b.deleteTask} ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <Button variant="ghost" className="text-xs" onClick={() => onChange([...steps, { id: uuid(), prompt: '', answer: '' }])}>
        + {b.addStep}
      </Button>
    </div>
  );
}
