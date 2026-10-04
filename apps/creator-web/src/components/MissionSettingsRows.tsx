// Step 3's optional settings as value rows (change: mission-editor-value-rows).
//
// Replaces the three "+" chips, which were drawers of unrelated settings that opened to up to 810px
// of controls and paragraphs. Each row is ONE line that says its value; activating it opens only that
// setting beneath it, and opening one closes the others (the editor owns which is open:
// lib/taskOptInGroups `openOnly`). Opening and closing write nothing; only choosing an answer writes,
// through the pure patches in lib/missionSettingsRows. Every row is a direct child `<section>` of the
// step body, so Quick Setup's guided isolation keeps exactly the row that holds its target.
//
// Explanations live behind `?` (RichTooltip), never as always-visible paragraphs.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Task } from '@rushpoint/shared';
import {
  validateUnlockGraph, validateAvailabilityWindow, normalizeTags,
  defaultExpectedDurationMinutes, TASK_DURATION_MAX_MINUTES,
  defaultEstimatedMinutes, TASK_ESTIMATE_MAX_MINUTES,
  TEAM_DEVICE_HARD_CAP, TIME_LIMIT_MAX_MINUTES,
} from '@rushpoint/shared';
import { Input, TagChips, Textarea } from './ui';
import RichTooltip from './RichTooltip';
import { BuilderIcon, type BuilderIconName } from './builderIcons';
import { useLanguage, useT } from './LanguageContext';
import { TAP_CLUSTER } from '../lib/interaction';
import { parseTagsInput } from '../lib/tags';
import { loadPopularTags } from '../services/calls';
import { isoToLocalInput, localInputToIso } from '../lib/timeWindowInput';
import {
  type SettingsRowKey, type RowSummary, type MoreItem,
  scoringRowFor, visibleRows, rowSummary,
  releaseAnswerOf, applyReleaseAnswer, closeAnswerOf, applyCloseAnswer,
  TIME_LIMIT_PRESETS, timeLimitChoiceOf, stepPoints, stepHintCost,
  DEFAULT_POINTS, DEFAULT_HINT_COST, POINTS_MAX,
} from '../lib/missionSettingsRows';

type B = ReturnType<typeof useT>['builder'];
type R = B['rows'];

const DIFF_BANDS = [
  { key: 'difficultyEasy', value: 2, test: (d: number) => d <= 3 },
  { key: 'difficultyMid', value: 5, test: (d: number) => d >= 4 && d <= 6 },
  { key: 'difficultyHard', value: 8, test: (d: number) => d >= 7 },
] as const;

// Drawn icons, never stock emoji (Ahiya, 2026-10-02): components/builderIcons.tsx.
const ROW_ICON: Record<Exclude<SettingsRowKey, 'scoring'>, BuilderIconName> = { hint: 'bulb', opens: 'unlock', timeLimit: 'stopwatch', more: 'tune' };

// Static class strings (Tailwind only sees literals).
const ROW_SECTION = 'rounded-lg border border-[--rp-border] bg-[--surface-1]';
const ROW_BUTTON = 'w-full min-h-[44px] flex items-center gap-2 px-3 text-start rounded-lg hover:bg-[--surface-2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-rp-fire';
const ROW_LABEL = 'text-[13px] font-medium text-[--ink-1] shrink-0';
const ROW_VALUE = 'ms-auto min-w-0 truncate text-[13px] text-[--ink-3]';
const PANEL = 'px-3 pb-3 pt-1 space-y-2';
const CHOICE = 'flex items-center gap-2 min-h-[44px] text-[13px] text-[--ink-1] cursor-pointer';
const LINE = 'flex items-center gap-2 flex-wrap min-h-[44px] text-[13px] text-[--ink-2]';
const STEP_BTN = `${TAP_CLUSTER} shrink-0 rounded-lg border border-[--rp-border] text-[--ink-1] hover:bg-[--surface-2] text-base leading-none`;
const PILL_ON = 'min-h-[44px] px-3 rounded-lg border border-rp-fire bg-rp-fire/10 text-ink-fire text-[13px] font-medium';
const PILL_OFF = 'min-h-[44px] px-3 rounded-lg border border-[--rp-border] text-[--ink-2] text-[13px] hover:bg-[--surface-2]';

const num = (v: string): number => parseFloat(v);
const posOrUndef = (n: number, max?: number): number | undefined =>
  Number.isFinite(n) && n > 0 ? (max ? Math.min(max, n) : n) : undefined;

export default function MissionSettingsRows({
  task, set, siblings, preset, open, onToggle, located,
}: {
  task: Task;
  set: (p: Partial<Task>) => void;
  /** The other missions of the same stage (prerequisites can only point at these). */
  siblings: Task[];
  /** The game's scoring preset: decides the scoring row and which duration is shown. */
  preset: unknown;
  open: Record<SettingsRowKey, boolean>;
  onToggle: (k: SettingsRowKey) => void;
  /** The mission has a GPS gate (the pause clock then also excludes the walk). */
  located: boolean;
}) {
  const t = useT();
  const b = t.builder;
  const r = b.rows;
  const { lang } = useLanguage();
  const titleOf = (id: string) => siblings.find((s) => s.id === id)?.title ?? '';
  const fmtTime = (iso: string) => {
    try { return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); }
    catch { return iso; }
  };
  const say = (row: SettingsRowKey) => summaryText(rowSummary(row, task, { preset, titleOf }), r, fmtTime);
  const rows = visibleRows(preset);

  return (
    <>
      {rows.includes('scoring') && <ScoringRow task={task} set={set} preset={preset} r={r} />}

      <Row id="hint" label={r.hint} value={say('hint')} open={open.hint} onToggle={() => onToggle('hint')}>
        <div>
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[13px] text-[--ink-2]">{r.hintText}</span>
            <RichTooltip concept="hint" />
          </div>
          <Textarea dense data-qs-field="hint" rows={2} dir="auto" value={task.hint ?? ''} placeholder={b.hintPlaceholder}
            onChange={(e) => set({ hint: e.target.value.trim() === '' ? undefined : e.target.value })} />
        </div>
        <div className={LINE}>
          <span>{r.hintCost}</span>
          <Stepper value={task.hintPenalty ?? DEFAULT_HINT_COST} anchor="hintPenalty"
            downLabel={r.hintCostDown} upLabel={r.hintCostUp}
            onStep={(dir) => set({ hintPenalty: stepHintCost(task.hintPenalty, dir) })}
            onType={(n) => set({ hintPenalty: Number.isFinite(n) ? Math.max(0, Math.min(POINTS_MAX, Math.round(n))) : DEFAULT_HINT_COST })} />
        </div>
      </Row>

      <Row id="opens" label={r.opens} value={say('opens')} open={open.opens} onToggle={() => onToggle('opens')}>
        <OpensPanel task={task} set={set} siblings={siblings} b={b} />
      </Row>

      <Row id="timeLimit" label={r.timeLimit} value={say('timeLimit')} open={open.timeLimit} onToggle={() => onToggle('timeLimit')}>
        <TimeLimitPanel task={task} set={set} r={r} help={b.timeLimitHelp} />
      </Row>

      <Row id="more" label={r.more} value={say('more')} open={open.more} onToggle={() => onToggle('more')}>
        <MorePanel task={task} set={set} siblings={siblings} preset={preset} located={located} b={b} />
      </Row>
    </>
  );
}

/** The words for a row's value. `moreList` joins the named items with a middle dot. */
function summaryText(s: RowSummary, r: R, fmtTime: (iso: string) => string): string {
  if (s.key === 'moreList' && 'items' in s) return s.items.map((it) => moreItemText(it, r)).join(' · ');
  const p = ('params' in s ? s.params : undefined) ?? {};
  switch (s.key) {
    case 'points': return r.pointsValue({ n: Number(p.n) });
    case 'difficultyEasy': return r.difficultyEasy;
    case 'difficultyMid': return r.difficultyMid;
    case 'difficultyHard': return r.difficultyHard;
    case 'hintNone': return r.hintNone;
    case 'hintOn': return r.hintOn({ n: Number(p.n) });
    case 'opensStart': return r.opensStart;
    case 'opensAfterMission': return r.opensAfterMission({ titles: String(p.titles) });
    case 'opensAfterMissions': return r.opensAfterMissions({ n: Number(p.n) });
    case 'opensAfterStart': return r.opensAfterStart({ n: Number(p.n) });
    case 'opensAtTime': return r.opensAtTime({ time: fmtTime(String(p.iso)) });
    case 'opensCombined': return r.opensCombined({ n: Number(p.n) });
    case 'timeLimitNone': return r.timeLimitNone;
    case 'timeLimitMinutes': return r.timeLimitMinutes({ n: Number(p.n) });
    default: return r.moreNone;
  }
}

function moreItemText(it: MoreItem, r: R): string {
  const n = it.n ?? 0;
  switch (it.key) {
    case 'closes': return r.moreClosesItem;
    case 'capacity': return r.moreCapacityItem({ n });
    case 'contributors': return r.moreContributorsItem({ n });
    case 'presence': return r.morePresenceItem;
    case 'pauseClock': return r.morePauseClockItem;
    case 'duration': return r.moreDurationItem({ n });
    case 'hintFree': return r.moreHintFreeItem;
    case 'tags': return r.moreTagsItem({ n });
    default: return '';
  }
}

// ── the row primitive ────────────────────────────────────────────────────────
function Row({ id, label, value, open, onToggle, children }: {
  id: SettingsRowKey; label: string; value: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const panelId = useId();
  // An opened row below the fold brings itself into view; a row the creator just opened and cannot
  // see reads as a button that did nothing.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  // Esc closes THIS row only; it must not also close the whole editor sheet.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); onToggle(); }
  };
  return (
    <section ref={ref} data-settings-row={id} className={ROW_SECTION} onKeyDown={onKeyDown}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className={ROW_BUTTON}>
        <BuilderIcon name={ROW_ICON[id as Exclude<SettingsRowKey, 'scoring'>]} className="w-5 h-5 shrink-0 text-[--ink-3]" />
        <span className={ROW_LABEL}>{label}</span>
        <span dir="auto" className={ROW_VALUE}>{value}</span>
        <span aria-hidden className="shrink-0 text-[--ink-3] text-xs">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div id={panelId} className={PANEL}>{children}</div>}
    </section>
  );
}

// ── − value + ────────────────────────────────────────────────────────────────
function Stepper({ value, anchor, downLabel, upLabel, onStep, onType }: {
  value: number; anchor: string; downLabel: string; upLabel: string;
  onStep: (dir: 1 | -1) => void; onType: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={STEP_BTN} aria-label={downLabel} title={downLabel} onClick={() => onStep(-1)}>−</button>
      <Input dense type="number" min={0} max={POINTS_MAX} className="w-16 text-center" data-qs-field={anchor}
        value={value} aria-label={anchor} onChange={(e) => onType(num(e.target.value))} />
      <button type="button" className={STEP_BTN} aria-label={upLabel} title={upLabel} onClick={() => onStep(1)}>+</button>
    </div>
  );
}

// ── scoring: an always-visible control, not a disclosure ─────────────────────
function ScoringRow({ task, set, preset, r }: { task: Task; set: (p: Partial<Task>) => void; preset: unknown; r: R }) {
  const kind = scoringRowFor(preset);
  return (
    <section data-settings-row="scoring" className={`${ROW_SECTION} flex items-center gap-2 px-3 min-h-[44px] flex-wrap`}>
      <BuilderIcon name={kind === 'difficulty' ? 'bars' : 'star'} className="w-5 h-5 shrink-0 text-[--ink-3]" />
      <span className={ROW_LABEL}>{kind === 'difficulty' ? r.difficulty : r.points}</span>
      {kind === 'difficulty' ? (
        <div className="ms-auto flex gap-1.5" role="group" aria-label={r.difficulty} data-qs-field="difficulty">
          {DIFF_BANDS.map((d) => {
            const on = d.test(typeof task.difficulty === 'number' ? task.difficulty : 5);
            return (
              <button key={d.key} type="button" aria-pressed={on} onClick={() => set({ difficulty: d.value })}
                className={on ? PILL_ON : PILL_OFF}>{r[d.key]}</button>
            );
          })}
        </div>
      ) : (
        <div className="ms-auto">
          <Stepper value={typeof task.pointValue === 'number' ? task.pointValue : DEFAULT_POINTS} anchor="pointValue"
            downLabel={r.pointsDown} upLabel={r.pointsUp}
            onStep={(dir) => set({ pointValue: stepPoints(task.pointValue, dir) })}
            onType={(n) => set({ pointValue: Number.isFinite(n) ? Math.max(0, Math.min(POINTS_MAX, Math.round(n))) : DEFAULT_POINTS })} />
        </div>
      )}
    </section>
  );
}

// ── when it opens ────────────────────────────────────────────────────────────
type OpenChoice = 'start' | 'afterMission' | 'afterStart' | 'atTime';

function OpensPanel({ task, set, siblings, b }: { task: Task; set: (p: Partial<Task>) => void; siblings: Task[]; b: B }) {
  const r = b.rows;
  const derived = releaseAnswerOf(task);
  // A choice that still needs its value (which mission, how many minutes, what time) is held here,
  // so selecting it writes nothing until the value exists.
  const [pending, setPending] = useState<OpenChoice | null>(null);
  const choice = pending ?? (derived === 'combined' ? null : derived);
  const others = siblings.filter((s) => s.id !== task.id);
  const name = useId();
  const options: [OpenChoice, string][] = [
    ['start', r.answerStart],
    ...(others.length > 0 ? [['afterMission', r.answerAfterMission] as [OpenChoice, string]] : []),
    ['afterStart', r.answerAfterStart],
    ['atTime', r.answerAtTime],
  ];
  const pick = (c: OpenChoice) => {
    if (c === 'start') { setPending(null); set(applyReleaseAnswer('start')); return; }
    setPending(c);
  };
  const write = (p: Partial<Task>) => { if (Object.keys(p).length) setPending(null); set(p); };
  const showMission = choice === 'afterMission' || (derived === 'combined' && (task.unlockAfterTaskIds?.length ?? 0) > 0);
  const showMinutes = choice === 'afterStart' || (derived === 'combined' && (task.releaseAfterMinutes ?? 0) > 0);
  const showTime = choice === 'atTime' || (derived === 'combined' && !!task.releaseAt);
  return (
    <>
      {derived === 'combined' && <p className="text-[13px] text-ink-amber" dir="auto">{r.combinedNote}</p>}
      <div role="radiogroup" aria-label={r.opens}>
        {options.map(([c, label]) => (
          <label key={c} className={CHOICE}>
            <input type="radio" name={name} checked={choice === c} onChange={() => pick(c)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {showMission && (
        <div data-qs-field="unlockAfterTaskIds" className="ps-6">
          <UnlockSection task={task} siblings={siblings} b={b}
            set={(p) => (derived === 'combined'
              ? set(p)
              : write(p.unlockAfterTaskIds?.length ? applyReleaseAnswer('afterMission', p.unlockAfterTaskIds) : { unlockAfterTaskIds: undefined }))} />
        </div>
      )}
      {showMinutes && (
        <div className={`${LINE} ps-6`}>
          <Input dense type="number" min={1} className="w-20" value={task.releaseAfterMinutes ?? ''} aria-label={r.minutesAfterStart}
            onChange={(e) => {
              const n = posOrUndef(num(e.target.value));
              if (derived === 'combined') set({ releaseAfterMinutes: n });
              else write(n ? applyReleaseAnswer('afterStart', n) : { releaseAfterMinutes: undefined });
            }} />
          <span>{r.minutesAfterStart}</span>
        </div>
      )}
      {showTime && (
        <div className={`${LINE} ps-6`}>
          <Input dense type="datetime-local" className="w-auto" value={isoToLocalInput(task.releaseAt)} aria-label={r.answerAtTime}
            data-testid="task-opens-at"
            onChange={(e) => {
              const iso = localInputToIso(e.target.value);
              if (derived === 'combined') set({ releaseAt: iso });
              else write(iso ? applyReleaseAnswer('atTime', iso) : { releaseAt: undefined });
            }} />
        </div>
      )}
    </>
  );
}

// Prerequisite picker (moved from TaskWizard; change: unlockable-tasks). A sibling that would create a
// dependency cycle is disabled with an explanation; validateUnlockGraph is the single source of truth.
function UnlockSection({ task, siblings, set, b }: {
  task: Task; siblings: Task[]; set: (p: Partial<Task>) => void; b: B;
}) {
  const selected = task.unlockAfterTaskIds ?? [];
  const others = siblings.filter((s) => s.id !== task.id);
  const wouldBreak = (id: string): boolean => {
    const hypothetical = siblings.map((s) => (s.id === task.id ? { ...task, unlockAfterTaskIds: [...selected, id] } : s));
    return validateUnlockGraph({ tasks: hypothetical }).errors.length > 0;
  };
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    set({ unlockAfterTaskIds: next.length > 0 ? next : undefined });
  };
  return (
    <div className="space-y-0.5">
      {others.map((s) => {
        const checked = selected.includes(s.id);
        const blocked = !checked && wouldBreak(s.id);
        return (
          <label key={s.id} title={blocked ? b.unlockCycleError : undefined}
            className={`flex items-center gap-2 min-h-[44px] text-[13px] ${blocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer text-[--ink-1]'}`}>
            <input type="checkbox" checked={checked} disabled={blocked} onChange={(e) => toggle(s.id, e.target.checked)} />
            <span dir="auto" className="min-w-0 truncate">
              <span className="text-[--ink-3] me-1">{siblings.indexOf(s) + 1}.</span>
              {s.title || b.untitledTask}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ── time per team ────────────────────────────────────────────────────────────
function TimeLimitPanel({ task, set, r, help }: { task: Task; set: (p: Partial<Task>) => void; r: R; help: string }) {
  const stored = timeLimitChoiceOf(task);
  const [other, setOther] = useState(stored === 'other');
  const choice = other ? 'other' : stored;
  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={r.timeLimit}>
        <button type="button" aria-pressed={choice === 'none'} className={choice === 'none' ? PILL_ON : PILL_OFF}
          onClick={() => { setOther(false); set({ timeLimitMinutes: undefined }); }}>{r.timeNoLimit}</button>
        {TIME_LIMIT_PRESETS.map((m) => (
          <button key={m} type="button" aria-pressed={choice === m} className={choice === m ? PILL_ON : PILL_OFF}
            onClick={() => { setOther(false); set({ timeLimitMinutes: m }); }}>{r.timeLimitMinutes({ n: m })}</button>
        ))}
        <button type="button" aria-pressed={choice === 'other'} className={choice === 'other' ? PILL_ON : PILL_OFF}
          onClick={() => setOther(true)}>{r.timeOther}</button>
        <RichTooltip title={r.timeLimit} body={help} />
      </div>
      {choice === 'other' && (
        <div className={LINE}>
          <Input dense type="number" min={0} max={TIME_LIMIT_MAX_MINUTES} step="0.5" className="w-20" data-testid="task-time-limit"
            data-qs-field="timeLimitMinutes" value={task.timeLimitMinutes ?? ''} aria-label={r.timeLimit}
            onChange={(e) => set({ timeLimitMinutes: posOrUndef(num(e.target.value), TIME_LIMIT_MAX_MINUTES) })} />
          <span>{r.minutesUnit}</span>
        </div>
      )}
    </>
  );
}

// ── "עוד הגדרות": the only second level ──────────────────────────────────────
function MorePanel({ task, set, siblings, preset, located, b }: {
  task: Task; set: (p: Partial<Task>) => void; siblings: Task[]; preset: unknown; located: boolean; b: B;
}) {
  const r = b.rows;
  const close = closeAnswerOf(task);
  const [pendingClose, setPendingClose] = useState<'afterStart' | 'atTime' | null>(null);
  const closeChoice = pendingClose ?? (close === 'combined' ? null : close);
  const closeName = useId();
  const isAnswerTask = task.type === 'quiz' || task.type === 'numeric' || task.type === 'survey';
  const scoring = scoringRowFor(preset);
  const fmt = (n: number) => String(Number(n.toFixed(2)));
  const writeClose = (p: Partial<Task>) => { if (Object.keys(p).length) setPendingClose(null); set(p); };
  return (
    <div className="divide-y divide-[--rp-border]">
      {/* מתי נסגרת */}
      <div className="py-1">
        <div className="text-[13px] font-medium text-[--ink-1] min-h-[32px] flex items-center">{r.closes}</div>
        <div role="radiogroup" aria-label={r.closes} className="flex flex-wrap gap-x-4">
          {([['never', r.answerNever], ['afterStart', r.answerAfterStart], ['atTime', r.answerAtTime]] as const).map(([c, label]) => (
            <label key={c} className={CHOICE}>
              <input type="radio" name={closeName} checked={closeChoice === c}
                onChange={() => { if (c === 'never') { setPendingClose(null); set(applyCloseAnswer('never')); } else setPendingClose(c); }} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {(closeChoice === 'afterStart' || (close === 'combined' && (task.expiresAfterMinutes ?? 0) > 0)) && (
          <div className={LINE}>
            <Input dense type="number" min={1} className="w-20" value={task.expiresAfterMinutes ?? ''} aria-label={r.minutesAfterStart}
              onChange={(e) => {
                const n = posOrUndef(num(e.target.value));
                if (close === 'combined') set({ expiresAfterMinutes: n });
                else writeClose(n ? applyCloseAnswer('afterStart', n) : { expiresAfterMinutes: undefined });
              }} />
            <span>{r.minutesAfterStart}</span>
          </div>
        )}
        {(closeChoice === 'atTime' || (close === 'combined' && !!task.expiresAt)) && (
          <div className={LINE}>
            <Input dense type="datetime-local" className="w-auto" value={isoToLocalInput(task.expiresAt)} aria-label={r.answerAtTime}
              data-testid="task-closes-at"
              onChange={(e) => {
                const iso = localInputToIso(e.target.value);
                if (close === 'combined') set({ expiresAt: iso });
                else writeClose(iso ? applyCloseAnswer('atTime', iso) : { expiresAt: undefined });
              }} />
          </div>
        )}
        {validateAvailabilityWindow(task) !== null && <p className="text-[13px] text-ink-fire">{b.expiryWindowError}</p>}
      </div>

      {/* כמה קבוצות בו זמנית */}
      <div className={LINE}>
        <span className="flex-1 min-w-0">{r.capacity}</span>
        <RichTooltip concept="concurrent" />
        <Input dense type="number" min={1} className="w-20" data-qs-field="maxConcurrentTeams" aria-label={r.capacity}
          value={task.maxConcurrentTeams} onChange={(e) => set({ maxConcurrentTeams: Math.max(1, parseInt(e.target.value) || 1) })} />
      </div>

      {/* כמה חייבים להשתתף */}
      <div className={LINE}>
        <span className="flex-1 min-w-0">{r.contributors}</span>
        <RichTooltip title={r.contributors} body={b.requiredContributorsHelp} />
        <Input dense type="number" min={0} max={TEAM_DEVICE_HARD_CAP} className="w-20" data-qs-field="requiredContributors"
          placeholder="0" aria-label={r.contributors} value={task.requiredContributors ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            set({ requiredContributors: Number.isFinite(n) && n > 1 ? Math.min(TEAM_DEVICE_HARD_CAP, n) : undefined });
          }} />
      </div>

      {isAnswerTask && (
        <label className={`${LINE} cursor-pointer`}>
          <input type="checkbox" checked={!!task.requirePresence} onChange={(e) => set({ requirePresence: e.target.checked || undefined })} />
          <span className="flex-1 min-w-0">{r.presence}</span>
          <RichTooltip title={r.presence} body={b.requirePresenceDesc} />
        </label>
      )}

      <div>
        <label className={`${LINE} cursor-pointer`}>
          <input type="checkbox" checked={!!task.pausesTimer} onChange={(e) => set({ pausesTimer: e.target.checked || undefined })} />
          <span className="flex-1 min-w-0">{r.pauseClock}</span>
          <RichTooltip title={r.pauseClock} body={b.pauseClockDesc} />
        </label>
        {task.pausesTimer && located && <p className="text-[13px] text-ink-amber ms-6 pb-1">{b.pauseClockLocatedWarn}</p>}
      </div>

      {/* The one duration this game's scoring reads (none in a speed race). */}
      {scoring === 'points' && (() => {
        const suggested = defaultExpectedDurationMinutes(task);
        return (
          <div className={LINE}>
            <span className="flex-1 min-w-0">{r.durationStop}</span>
            <RichTooltip title={r.durationStop} body={b.durationHelp} />
            <Input dense type="number" min={0} max={TASK_DURATION_MAX_MINUTES} className="w-20" data-qs-field="expectedDurationMinutes"
              placeholder={fmt(suggested)} aria-label={r.durationStop} value={task.expectedDurationMinutes ?? ''}
              onChange={(e) => set({ expectedDurationMinutes: posOrUndef(num(e.target.value), TASK_DURATION_MAX_MINUTES) })} />
          </div>
        );
      })()}
      {scoring === 'difficulty' && (() => {
        const suggested = defaultEstimatedMinutes(task, siblings);
        return (
          <div className={LINE}>
            <span className="flex-1 min-w-0">{r.durationTotal}</span>
            <RichTooltip title={r.durationTotal} body={b.estimateHelp} />
            {task.estimatedMinutes !== suggested && (
              <button type="button" className="min-h-[44px] underline text-[--ink-2]" onClick={() => set({ estimatedMinutes: suggested })}>
                {r.useSuggested({ n: String(suggested) })}
              </button>
            )}
            <Input dense type="number" min={1} max={TASK_ESTIMATE_MAX_MINUTES} className="w-20" aria-label={r.durationTotal}
              value={task.estimatedMinutes}
              onChange={(e) => set({ estimatedMinutes: Math.min(TASK_ESTIMATE_MAX_MINUTES, Math.max(1, parseInt(e.target.value) || 1)) })} />
          </div>
        );
      })()}

      {(task.hint ?? '').trim() !== '' && (
        <div className={LINE}>
          <span>{r.hintFree}</span>
          <Input dense type="number" min={0} step="0.5" className="w-16" aria-label={r.hintFreeMinutes} value={task.hintAutoRevealMinutes ?? ''}
            onChange={(e) => set({ hintAutoRevealMinutes: posOrUndef(num(e.target.value)) })} />
          <span>{r.hintFreeMinutes}</span>
          <Input dense type="number" min={0} className="w-16" aria-label={r.hintFreeAttempts} value={task.hintAutoRevealAttempts ?? ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set({ hintAutoRevealAttempts: Number.isInteger(n) && n > 0 ? n : undefined });
            }} />
          <span>{r.hintFreeAttempts}</span>
          <RichTooltip title={r.hintFree} body={b.hintEscalationLead} />
        </div>
      )}

      <TagsLine task={task} set={set} b={b} />
    </div>
  );
}

// Gallery tags (change: game-task-tags). Suggestions appear only while the field is focused and are
// filtered by what is being typed, instead of a dozen chips always on screen.
function TagsLine({ task, set, b }: { task: Task; set: (p: Partial<Task>) => void; b: B }) {
  const r = b.rows;
  const [raw, setRaw] = useState((task.tags ?? []).join(', '));
  const [focused, setFocused] = useState(false);
  const [popular, setPopular] = useState<string[]>([]);
  useEffect(() => {
    if (!focused || popular.length) return undefined;
    let live = true;
    void loadPopularTags().then((list) => { if (live) setPopular(list); });
    return () => { live = false; };
  }, [focused, popular.length]);
  // Resync only when the stored tags diverge from what the raw string would produce (undo, task switch).
  useEffect(() => {
    if (JSON.stringify(parseTagsInput(raw)) !== JSON.stringify(task.tags ?? [])) setRaw((task.tags ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.tags]);
  const current = task.tags ?? [];
  const have = new Set(current.map((x) => x.toLowerCase()));
  const typing = (raw.split(',').pop() ?? '').trim().toLowerCase();
  const suggestions = focused
    ? popular.filter((x) => !have.has(x.toLowerCase()) && (typing === '' || x.toLowerCase().includes(typing))).slice(0, 6)
    : [];
  return (
    <div className="py-1">
      <div className="flex items-center gap-1 min-h-[32px] text-[13px] text-[--ink-2]">
        <span>{r.tags}</span>
        <RichTooltip title={r.tags} body={r.tagsHelp} />
      </div>
      <div data-qs-field="tags">
        <Input dense value={raw} placeholder={b.taskTagsPlaceholder} dir="auto" aria-label={r.tags}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onChange={(e) => { setRaw(e.target.value); set({ tags: parseTagsInput(e.target.value) }); }} />
        <TagChips tags={task.tags} className="mt-1.5" more={b.moreTags} max={20} />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {suggestions.map((tag) => (
              <button key={tag} type="button" dir="auto"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { const next = normalizeTags([...current, tag]); set({ tags: next }); setRaw(next.join(', ')); }}
                className="inline-flex items-center min-h-[32px] max-w-full truncate px-2 rounded-full text-[13px] font-medium border border-dashed border-rp-fire/40 bg-rp-fire/5 text-ink-fire hover:bg-rp-fire/10">
                + {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
