import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  FIRESTORE_PATHS, MAX_QUICK_ACTIONS, QUICK_ACTIONS, QUICK_ACTION_IDS, readQuickActions, moveQuickAction, type QuickActionId,
} from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useT } from './LanguageContext';
import { Button } from './ui';
import { TAP_CLUSTER } from '../lib/interaction';
import { searchTeams, type TeamSearchRow } from '../lib/teamSearch';
import { Icon, type IconName } from './Icon';

// The Run Console's quick-actions bar (change: quick-dial-and-actions, D4/D5).
//
// Field report: "I want to choose a quick dial for myself." Up to six shortcuts the organizer
// picks, each mapped by the console to a handler it ALREADY has, so a shortcut can never do
// something the console itself cannot. The choice is saved on the organizer's own profile doc
// (owner-writable) as a NESTED object with merge, never a dotted key (CLAUDE.md footgun), so it
// follows them to any device. A saved id the catalogue no longer has is dropped on read.

export interface QuickActionHandlers {
  run: (id: QuickActionId) => void;
  runWithTeam: (id: QuickActionId, teamId: string) => void;
  /** Whether an action can do anything right now (e.g. "call" needs a published number). */
  available: (id: QuickActionId) => boolean;
}

// Drawn icons per quick action (change: no-stock-emoji).
const QUICK_ACTION_ICON: Record<QuickActionId, IconName> = {
  broadcast: 'megaphone', startTeams: 'play', refreshStandings: 'refresh', photoQueue: 'camera',
  adjustScore: 'plus', findTeam: 'search', callContact: 'phone',
};

export default function QuickActionsBar({ uid, teams, handlers }: {
  uid: string | null;
  teams: TeamSearchRow[];
  handlers: QuickActionHandlers;
}) {
  const t = useT();
  const qa = t.runConsole.quickActions;
  const [chosen, setChosen] = useState<QuickActionId[]>(() => readQuickActions(undefined));
  const [customising, setCustomising] = useState(false);
  const [picking, setPicking] = useState<QuickActionId | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    getDoc(doc(db, FIRESTORE_PATHS.user(uid)))
      .then((snap) => { if (alive) setChosen(readQuickActions((snap.data() as { consolePrefs?: unknown } | undefined)?.consolePrefs as never)); })
      .catch(() => { /* keep the default bar: a preference is never worth an error */ });
    return () => { alive = false; };
  }, [uid]);

  async function save(next: QuickActionId[]) {
    setChosen(next);
    if (!uid) return;
    try {
      await setDoc(doc(db, FIRESTORE_PATHS.user(uid)), { consolePrefs: { quickActions: next } }, { merge: true });
    } catch { /* the bar still works for this session */ }
  }

  function trigger(id: QuickActionId) {
    if (QUICK_ACTIONS[id].needsTeam) { setQuery(''); setPicking(id); return; }
    handlers.run(id);
  }

  const shown = useMemo(() => searchTeams(teams, { query }), [teams, query]);
  const visible = chosen.filter((id) => handlers.available(id));

  return (
    <div className="flex items-center gap-2" data-testid="quick-actions">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 min-w-0">
        {visible.map((id) => (
          <button key={id} type="button" onClick={() => trigger(id)}
            className="shrink-0 inline-flex items-center gap-1.5 min-h-[40px] rounded-full border border-[--rp-border] bg-[--surface-0] px-3 text-[13px] font-semibold text-[--ink-1] hover:bg-[--surface-2]">
            <Icon name={QUICK_ACTION_ICON[id]} className="w-4 h-4" />{qa.label[id]}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setCustomising(true)} aria-label={qa.customise} title={qa.customise}
        className="shrink-0 inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-full border border-dashed border-[--rp-border] text-[--ink-3] hover:bg-[--surface-2]">
        <Icon name="gear" className="w-5 h-5" />
      </button>

      {customising && (
        <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={qa.customise}>
          <div className="w-full max-w-md rounded-2xl bg-[--surface-0] p-4 shadow-xl">
            <h2 className="text-base font-bold text-[--ink-1]">{qa.customise}</h2>
            <p className="text-[13px] text-[--ink-3] mt-1 mb-3">{qa.customiseHelp({ max: MAX_QUICK_ACTIONS })}</p>
            {/* The chosen ones, in bar order, each with up/down (a drag is fiddly on a phone and
                invisible to a screen reader). The rest follow as plain checkboxes. */}
            <ul className="space-y-1">
              {[...chosen, ...QUICK_ACTION_IDS.filter((x) => !chosen.includes(x))].map((id) => {
                const on = chosen.includes(id);
                const full = !on && chosen.length >= MAX_QUICK_ACTIONS;
                return (
                  <li key={id} className="flex items-center gap-2">
                    <label className={`flex flex-1 items-center gap-3 min-h-[44px] rounded-lg px-2 ${full ? 'opacity-50' : 'hover:bg-[--surface-2]'}`}>
                      <input type="checkbox" checked={on} disabled={full}
                        onChange={() => void save(on ? chosen.filter((x) => x !== id) : [...chosen, id])} />
                      <Icon name={QUICK_ACTION_ICON[id]} className="w-4 h-4 shrink-0" />
                      <span className="text-sm text-[--ink-1]">{qa.label[id]}</span>
                    </label>
                    {on && (
                      <span className="inline-flex gap-2 shrink-0">
                        <button type="button" className={`${TAP_CLUSTER} rounded-md border border-[--rp-border] text-[--ink-2] disabled:opacity-30`}
                          disabled={chosen.indexOf(id) === 0} aria-label={qa.moveUp({ name: qa.label[id] })}
                          onClick={() => void save(moveQuickAction(chosen, id, -1))}>▲</button>
                        <button type="button" className={`${TAP_CLUSTER} rounded-md border border-[--rp-border] text-[--ink-2] disabled:opacity-30`}
                          disabled={chosen.indexOf(id) === chosen.length - 1} aria-label={qa.moveDown({ name: qa.label[id] })}
                          onClick={() => void save(moveQuickAction(chosen, id, 1))}>▼</button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => setCustomising(false)}>{qa.done}</Button>
            </div>
          </div>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={qa.pickTeam}>
          <div className="w-full max-w-md rounded-2xl bg-[--surface-0] p-4 shadow-xl max-h-[80vh] flex flex-col">
            <h2 className="text-base font-bold text-[--ink-1]">{qa.pickTeam}</h2>
            <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} dir="auto"
              placeholder={t.runConsole.teamSearchPlaceholder} aria-label={t.runConsole.teamSearchPlaceholder}
              className="mt-2 min-h-[44px] rounded-lg border border-[--rp-border] bg-[--surface-0] px-3 text-sm text-[--ink-1]" />
            <ul className="mt-2 overflow-y-auto space-y-1">
              {shown.length === 0 && <li className="text-sm text-[--ink-3] px-1">{t.runConsole.teamSearchNoMatch}</li>}
              {shown.map((tm) => (
                <li key={tm.id}>
                  <button type="button" onClick={() => { const id = picking; setPicking(null); handlers.runWithTeam(id, tm.id); }}
                    className="w-full text-start min-h-[44px] rounded-lg px-3 hover:bg-[--surface-2] text-sm text-[--ink-1]">
                    <span dir="auto">{tm.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" onClick={() => setPicking(null)}>{t.common.cancel}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
