// Grouping editor for mutually exclusive tasks (change: builder-dnd-groups).
//
// It replaces the old inline chip table, which drew one chip per TASK per GROUP
// inside the stage header — height O(groups × tasks), the exact vertical bloat
// the wave C compaction removed, and with no visual link between a chip and the
// card it referred to. The membership now lives on the task cards as a badge;
// this modal is the one focused place where it is EDITED.
//
// Interaction model: one row per task, one `role="radiogroup"` per row.
//   • A task is in AT MOST one group by construction (radio, not checkbox), so
//     the old "disabled because another group took it" concept is gone.
//   • Fully keyboard native with no drag involved — grouping must never depend
//     on a gesture (see docs/wave-d/builder-dnd-groups-plan.md §1.5).
//   • The footer recomputes the completion ceiling LIVE from the same shared
//     `maxAttainableCompletions` the header warning uses, so the creator sees
//     the consequence while editing rather than after closing.
//
// Presentation only: every rule about what a group MEANS lives in
// packages/shared/src/mutualExclusion.ts and is enforced server side.
import { useEffect, useRef } from 'react';
import type { Stage } from '@rushpoint/shared';
import { effectiveExclusiveGroups, maxAttainableCompletions } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { GROUP_STYLES } from './TaskCard';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export default function ExclusiveGroupsModal({ stage, onAssign, onRemoveGroup, onClose }: {
  stage: Stage;
  /** Put `taskId` in `groupId` (or in none when null). `create` makes the group
   *  in the same update so "new group + first member" is one undo step. */
  onAssign: (taskId: string, groupId: string | null, create?: boolean) => void;
  onRemoveGroup: (groupId: string) => void;
  onClose: () => void;
}) {
  const b = useT().builder;
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Focus into the panel on open, restore it to the opener on close, and close
  // on Escape — the modal conventions the rest of creator-web already follows.
  useEffect(() => {
    openerRef.current = document.activeElement;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  // The AUTHORED groups drive the columns (so a 1-member group the creator is
  // mid-way through building still has a column), while the EFFECTIVE groups
  // drive the letters and the "has no effect" note, so nothing here can promise
  // an exclusivity the server would not apply.
  const authored = stage.exclusiveGroups ?? [];
  const effective = effectiveExclusiveGroups(stage);
  const isEffective = (gid: string) => {
    const g = authored.find((x) => x.id === gid);
    return !!g && effective.some((m) => g.taskIds.some((id) => m.includes(id)) && m.length >= 2);
  };
  const letterOf = (gi: number) => b.exclusiveGroupLetter(gi);
  const styleOf = (gi: number) => GROUP_STYLES[gi % GROUP_STYLES.length];
  const groupIdOf = (taskId: string) => authored.find((g) => g.taskIds.includes(taskId))?.id ?? null;
  const atMax = authored.length >= GROUP_STYLES.length;
  const ceiling = maxAttainableCompletions(stage);
  // Task name takes the slack; every option column is a fixed 2rem, so the grid
  // stays inside the panel however many groups exist (capped at GROUP_STYLES).
  const cols = `minmax(0,1fr) repeat(${authored.length + (atMax ? 1 : 2)}, 2rem)`;

  /** A radio rendered as a letter button. Colour is never the only cue: the
   *  letter, the border and the checked ring all carry the same information. */
  function Radio({ label, checked, onSelect, styleClass, title }: {
    label: string; checked: boolean; onSelect: () => void; styleClass?: string; title: string;
  }) {
    return (
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        tabIndex={checked ? 0 : -1}
        title={title}
        aria-label={title}
        onClick={onSelect}
        className={`inline-flex items-center justify-center min-w-[26px] h-[22px] px-1 rounded border text-[13px] font-bold leading-none
          transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60
          ${styleClass ?? 'border-[--rp-border] text-[--ink-3]'}
          ${checked ? 'ring-2 ring-rp-fire/70' : 'opacity-50 hover:opacity-100'}`}
      >{label}</button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={b.exclusiveModalTitle}
        tabIndex={-1}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-[--rp-border] bg-[--surface-1] shadow-2xl focus:outline-none"
      >
        <div className="flex items-start gap-3 px-4 pt-4 pb-2 shrink-0">
          <div className="min-w-0 text-start">
            <h2 className="text-sm font-semibold text-[--ink-1]">{b.exclusiveModalTitle}</h2>
            <p className="mt-1 text-xs text-[--ink-3]">{b.exclusiveModalIntro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={b.exclusiveClose}
            title={b.exclusiveClose}
            className="ms-auto shrink-0 text-[--ink-3] hover:text-[--ink-1]"
          >✕</button>
        </div>

        {/* A CSS grid rather than a <table>: `role="radiogroup"` has to wrap ALL of
            one task's options, and a <tr> cannot carry that role without breaking
            the table semantics. Column widths come from an inline style because a
            Tailwind class cannot be built dynamically. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 text-xs">
          <div
            className="sticky top-0 z-10 grid items-center gap-x-1 bg-[--surface-1] py-1.5 text-[--ink-3]"
            style={{ gridTemplateColumns: cols }}
            aria-hidden
          >
            <span className="text-start">{b.exclusiveTaskColumn}</span>
            <span className="text-center">{b.exclusiveNoGroup}</span>
            {authored.map((g, gi) => <span key={g.id} className="text-center">{letterOf(gi)}</span>)}
            {!atMax && <span className="text-center">＋</span>}
          </div>
          {stage.tasks.map((t, ti) => {
            const cur = groupIdOf(t.id);
            const rowLabel = t.title || `${b.untitledTask} ${ti + 1}`;
            return (
              <div
                key={t.id}
                role="radiogroup"
                aria-label={rowLabel}
                className="grid items-center gap-x-1 border-t border-[--rp-border] py-1.5"
                style={{ gridTemplateColumns: cols }}
              >
                <span className="text-start text-[--ink-1] truncate min-w-0" dir="auto">{rowLabel}</span>
                <span className="text-center">
                  <Radio
                    label="○"
                    title={`${rowLabel}: ${b.exclusiveNoGroup}`}
                    checked={cur === null}
                    onSelect={() => onAssign(t.id, null)}
                  />
                </span>
                {authored.map((g, gi) => (
                  <span key={g.id} className="text-center">
                    <Radio
                      label={letterOf(gi)}
                      title={`${rowLabel}: ${b.exclusiveGroupSummary(letterOf(gi), g.taskIds.length)}`}
                      checked={cur === g.id}
                      styleClass={styleOf(gi).badge}
                      onSelect={() => onAssign(t.id, g.id)}
                    />
                  </span>
                ))}
                {!atMax && (
                  <span className="text-center">
                    <Radio
                      label="＋"
                      title={`${rowLabel}: ${b.exclusiveNewGroup}`}
                      checked={false}
                      onSelect={() => onAssign(t.id, uuid(), true)}
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-[--rp-border] px-4 py-3 space-y-1 text-xs text-[--ink-3] text-start">
          {authored.map((g, gi) => (
            <div key={g.id} className="flex items-center gap-2">
              <span className={isEffective(g.id) ? '' : 'opacity-50'}>
                {b.exclusiveGroupSummary(letterOf(gi), g.taskIds.length)}
                {isEffective(g.id) ? '' : ` · ${b.exclusiveGroupInert}`}
              </span>
              <button
                type="button"
                className="text-neon-red"
                title={b.exclusiveRemoveGroup}
                aria-label={`${b.exclusiveRemoveGroup} ${letterOf(gi)}`}
                onClick={() => onRemoveGroup(g.id)}
              >✕</button>
            </div>
          ))}
          {atMax && <p className="text-amber-400">{b.exclusiveMaxGroups}</p>}
          <p>{b.exclusiveCeiling(ceiling, stage.tasks.length)}</p>
          {/* Same warning as the stage header, echoed here so the consequence is
              visible while editing rather than only after the modal closes. */}
          {typeof stage.requiredTaskCount === 'number' && stage.requiredTaskCount > ceiling && (
            <p className="text-amber-400">⚠ {b.exclusiveUnwinnableWarn}</p>
          )}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[--rp-border] px-3 py-1 hover:text-[--ink-1]"
            >{b.exclusiveDone}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
