import { useEffect, useState } from 'react';
import {
  MAX_QUICK_ACTIONS, STAFF_QUICK_ACTIONS, STAFF_QUICK_ACTION_IDS, moveQuickAction, readStaffQuickActions,
  type StaffQuickActionId,
} from '@rushpoint/shared';
import { useT } from '../i18nContext';
import { Button } from './ui';
import { TAP_TARGET } from '../lib/interaction';
import { Icon, type IconName } from './Icon';

// The staff console's quick bar (change: quick-dial-and-actions 2.6). One tap to the section a
// marshal needs on a long scroll: the photo queue, the teams, the chat. Only sections this person's
// code allows (a shortcut to a hidden section would jump nowhere). The choice is per device, in
// localStorage, which may be blocked: then the default bar still works for this session.

// Drawn icons per quick action (change: no-stock-emoji).
const STAFF_QUICK_ICON: Record<StaffQuickActionId, IconName> = {
  alerts: 'sos', review: 'camera', teams: 'users', chat: 'chat', map: 'map', staffChannel: 'radio', broadcast: 'megaphone',
};
const storageKey = (runId: string) => `rp-staff-quick:${runId}`;

// Two whole static strings (Tailwind only sees static class strings, and the contrast scan reads each
// literal as one surface): red for an SOS or an overdue submission, calm otherwise.
const BADGE_URGENT = 'ms-0.5 inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold bg-ink-alert text-white';
const BADGE_CALM = 'ms-0.5 inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold bg-app-raised text-zinc-100';

function load(runId: string): unknown {
  try {
    const raw = window.localStorage.getItem(storageKey(runId));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export default function StaffQuickBar({ runId, can, badges }: {
  runId: string;
  can: (capability: string) => boolean;
  /** How many things wait behind a chip (staffQuickBadges): the marshal's "now" at a glance. */
  badges?: Partial<Record<StaffQuickActionId, { count: number; urgent: boolean }>>;
}) {
  const { t } = useT();
  const q = t.staff.quick;
  const [saved, setSaved] = useState<unknown>(() => load(runId));
  const [customising, setCustomising] = useState(false);
  useEffect(() => { setSaved(load(runId)); }, [runId]);

  const chosen = readStaffQuickActions(saved, can);
  const allowed = STAFF_QUICK_ACTION_IDS.filter((id) => {
    const cap = STAFF_QUICK_ACTIONS[id].capability;
    return !cap || can(cap);
  });

  function save(next: StaffQuickActionId[]) {
    setSaved(next);
    try { window.localStorage.setItem(storageKey(runId), JSON.stringify(next)); } catch { /* this session only */ }
  }

  function jump(id: StaffQuickActionId) {
    const el = document.getElementById(STAFF_QUICK_ACTIONS[id].section);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="mb-4" data-testid="staff-quick-bar">
      <div className="flex items-center gap-2">
       <div className="flex items-center gap-2 overflow-x-auto pb-1 min-w-0 flex-1">
        {chosen.map((id) => (
          <button key={id} type="button" onClick={() => jump(id)}
            className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] rounded-full border border-glass-border bg-app-card px-3 text-[13px] font-semibold text-zinc-100">
            <Icon name={STAFF_QUICK_ICON[id]} className="w-4 h-4" />{q.label[id]}
            {badges?.[id] && (
              <span data-testid={`staff-quick-badge-${id}`}
                className={badges[id]!.urgent ? BADGE_URGENT : BADGE_CALM}>
                <span aria-hidden="true">{badges[id]!.count}</span>
                <span className="sr-only">{q.waiting({ n: badges[id]!.count })}</span>
              </span>
            )}
          </button>
        ))}
       </div>
        {/* Outside the scrolling row, so it is always on screen. */}
        <button type="button" onClick={() => setCustomising(true)} aria-label={q.customise} title={q.customise}
          className={`${TAP_TARGET} shrink-0 inline-flex items-center justify-center rounded-full border border-dashed border-glass-border text-zinc-400`}>
          <Icon name="gear" className="w-5 h-5" />
        </button>
      </div>

      {customising && (
        <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={q.customise}>
          <div className="w-full max-w-md rounded-2xl bg-app-card p-4 shadow-xl">
            <h2 className="text-base font-bold text-zinc-100">{q.customise}</h2>
            <p className="text-[13px] text-zinc-400 mt-1 mb-3">{q.customiseHelp({ max: MAX_QUICK_ACTIONS })}</p>
            <ul className="space-y-1">
              {[...chosen, ...allowed.filter((x) => !chosen.includes(x))].map((id) => {
                const on = chosen.includes(id);
                const full = !on && chosen.length >= MAX_QUICK_ACTIONS;
                return (
                  <li key={id} className="flex items-center gap-2">
                    <label className={`flex flex-1 items-center gap-3 min-h-[44px] rounded-lg px-2 ${full ? 'opacity-50' : ''}`}>
                      <input type="checkbox" checked={on} disabled={full}
                        onChange={() => save(on ? chosen.filter((x) => x !== id) : [...chosen, id])} />
                      <Icon name={STAFF_QUICK_ICON[id]} className="w-4 h-4 shrink-0" />
                      <span className="text-sm text-zinc-100">{q.label[id]}</span>
                    </label>
                    {on && (
                      <span className="inline-flex gap-2 shrink-0">
                        <button type="button" disabled={chosen.indexOf(id) === 0} onClick={() => save(moveQuickAction(chosen, id, -1))}
                          aria-label={q.moveUp({ name: q.label[id] })}
                          className={`${TAP_TARGET} rounded-md border border-glass-border text-zinc-300 disabled:opacity-30`}>▲</button>
                        <button type="button" disabled={chosen.indexOf(id) === chosen.length - 1} onClick={() => save(moveQuickAction(chosen, id, 1))}
                          aria-label={q.moveDown({ name: q.label[id] })}
                          className={`${TAP_TARGET} rounded-md border border-glass-border text-zinc-300 disabled:opacity-30`}>▼</button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => setCustomising(false)}>{q.done}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
