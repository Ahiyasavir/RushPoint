import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18nContext';
import { planMissionActions, type MissionActionId } from '../lib/missionActions';

// The mission card's recovery kit, in one place (change: play-card-simplification).
//
// Navigate, paid hint and "ask the host" used to sit on the card as three
// independent controls next to the submit button — six tappable things for one
// instruction. They share a property: you only want them when the mission is NOT
// going well. So they collapse into one trigger, and `planMissionActions` decides
// what is inside.
//
// Two rules the plan enforces and this renders faithfully:
//   * ONE available action is rendered inline, never as a one-item menu. A menu
//     you must open to find a single button is strictly worse than the button.
//   * a FREE hint never comes here — the server escalated it precisely so a stuck
//     team takes it, and the card keeps showing that one loudly.

export interface MissionExtrasProps {
  hasLocation?: boolean;
  hasHint?: boolean;
  hintFree?: boolean;
  canRequestHelp?: boolean;
  helpSent?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  /** Rendered for the `navigate` action — the existing map/Waze links. */
  navigate?: ReactNode;
  onHint?: () => void;
  onHelp?: () => void;
  hintLabel?: string;
}

export default function MissionExtras(props: MissionExtrasProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const plan = planMissionActions({
    hasLocation: props.hasLocation,
    hasHint: props.hasHint,
    hintFree: props.hintFree,
    canRequestHelp: props.canRequestHelp,
    helpSent: props.helpSent,
    readOnly: props.readOnly,
  });

  // Close on Escape and on an outside click. Both listeners are bound only while
  // the menu is actually open, so a card with a closed menu costs nothing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  // A mission whose menu emptied out (help sent, hint revealed) must not leave a
  // dangling open panel behind.
  useEffect(() => {
    if (plan.overflow.length === 0 && open) setOpen(false);
  }, [plan.overflow.length, open]);

  if (plan.overflow.length === 0) return null;

  const item = (id: MissionActionId): ReactNode => {
    if (id === 'navigate') return <div key="navigate">{props.navigate}</div>;
    if (id === 'hint') {
      return (
        <button key="hint" type="button" disabled={props.disabled}
          onClick={() => { setOpen(false); props.onHint?.(); }}
          data-testid="mission-extra-hint"
          className="w-full text-start inline-flex items-center min-h-[44px] px-3 rounded-lg text-xs text-ink-warm hover:bg-app-raised disabled:opacity-40">
          💡 {props.hintLabel}
        </button>
      );
    }
    return (
      <button key="help" type="button" disabled={props.disabled}
        onClick={() => { setOpen(false); props.onHelp?.(); }}
        data-testid="mission-extra-help"
        className="w-full text-start inline-flex items-center min-h-[44px] px-3 rounded-lg text-xs font-semibold text-ink-alert hover:bg-rp-alert/10 disabled:opacity-40">
        🆘 {t.task.requestHelp}
      </button>
    );
  };

  // Exactly one thing to offer → offer it directly.
  if (plan.soleAction) {
    return <div className="mt-3" data-testid="mission-extras-inline">{item(plan.soleAction)}</div>;
  }

  return (
    <div className="mt-3 relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="mission-extras-trigger"
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 -ms-3 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200"
      >
        ⋯ {t.task.moreOptions}
      </button>
      {open && (
        <div role="menu" data-testid="mission-extras-menu"
          className="absolute z-20 mt-1 min-w-[13rem] rounded-xl border border-glass-border bg-app-card shadow-task-card p-1 space-y-0.5">
          {plan.overflow.map(item)}
        </div>
      )}
    </div>
  );
}
