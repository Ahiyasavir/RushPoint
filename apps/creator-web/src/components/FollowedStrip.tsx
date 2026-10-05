// "הקבוצות שלי" strip at the top of the run console's "עכשיו" screen (change: followed-teams).
//
// One compact card per followed team: its name, one line (the status when something is wrong, the
// current mission otherwise), and at most one action, the one that team needs now. Colour only when
// something is wrong (red: SOS / out of bounds; amber: waiting / stuck / paused), per ISA-101. The
// console decides the status and the action (pure, @rushpoint/shared); this only renders.
import { useState } from 'react';
import type { FollowedStatus } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Icon } from './Icon';

export interface FollowedCard {
  id: string;
  name: string;
  status: FollowedStatus;
  line: string;
  action: { label: string; run: () => void } | null;
}

// Whole static strings per tone (Tailwind only sees static class strings).
const CARD_ALERT = 'rounded-xl border-2 border-rp-alert bg-rp-alert/5 p-3 min-w-[11rem] max-w-[16rem] shrink-0 flex flex-col gap-2';
const CARD_WARN = 'rounded-xl border-2 border-rp-amber bg-rp-amber/10 p-3 min-w-[11rem] max-w-[16rem] shrink-0 flex flex-col gap-2';
const CARD_CALM = 'rounded-xl border border-[--rp-border] bg-[--surface-2] p-3 min-w-[11rem] max-w-[16rem] shrink-0 flex flex-col gap-2';
const LINE_ALERT = 'text-[13px] font-semibold text-ink-alert truncate';
const LINE_WARN = 'text-[13px] font-semibold text-ink-amber truncate';
const LINE_CALM = 'text-[13px] text-[--ink-3] truncate';

/** One row of the team picker: a team that can be starred from this strip. */
export interface PickableTeam { id: string; name: string; followed: boolean }

export default function FollowedStrip({ cards, mineOnly, onMineOnly, onOpen, picker }: {
  cards: FollowedCard[];
  mineOnly: boolean;
  onMineOnly: (on: boolean) => void;
  onOpen: (teamId: string) => void;
  // Starring from HERE (Ahiya, 2026-10-05): before the race this is the screen an organizer is
  // on, and its empty state asked for a star that only existed in the Teams section. The page
  // decides which teams match (teamSearch.ts); this only renders and reports.
  picker?: {
    teams: PickableTeam[];
    total: number;
    query: string;
    onQuery: (q: string) => void;
    onToggle: (teamId: string) => void;
  };
}) {
  const rc = useT().runConsole;
  const f = rc.follow;
  // Open by itself while nothing is followed, so the empty state is never a dead end.
  const [pickOpen, setPickOpen] = useState(false);
  const showPicker = !!picker && picker.total > 0 && (pickOpen || cards.length === 0);
  return (
    <section aria-label={f.title} data-testid="followed-strip" className="mb-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-[--ink-1] flex items-center gap-1.5"><Icon name="star" className="w-4 h-4 fill-current text-[#4f46e5]" />{f.title}</h3>
        <div className="flex items-center gap-3">
          {cards.length > 0 && picker && picker.total > 0 && (
            <button type="button" aria-expanded={showPicker} onClick={() => setPickOpen((v) => !v)}
              data-testid="followed-pick-toggle"
              className="min-h-[44px] px-1 text-[13px] font-semibold text-ink-fire underline underline-offset-4">
              {showPicker ? f.pickClose : f.pickOpen}
            </button>
          )}
          {cards.length > 0 && (
            <label className="inline-flex items-center gap-2 min-h-[44px] text-[13px] text-[--ink-2] cursor-pointer">
              <input type="checkbox" checked={mineOnly} onChange={(e) => onMineOnly(e.target.checked)} data-testid="followed-mine-only" />
              {f.mineOnly}
            </label>
          )}
        </div>
      </div>
      {showPicker && picker && (
        <div className="mb-3 rounded-xl border border-[--rp-border] bg-[--surface-1] p-2" data-testid="followed-picker">
          <input type="search" value={picker.query} onChange={(e) => picker.onQuery(e.target.value)}
            placeholder={rc.teamSearchPlaceholder} aria-label={rc.teamSearchPlaceholder} dir="auto"
            className="w-full min-h-[44px] rounded-lg border border-[--rp-border] bg-[--surface-2] px-3 text-sm text-[--ink-1]" />
          {picker.teams.length === 0 ? (
            <p role="status" className="text-[13px] text-[--ink-3] px-1 pt-2">{rc.teamSearchNoMatch}</p>
          ) : (
            <ul className="mt-1 max-h-72 overflow-y-auto divide-y divide-[--rp-border]">
              {picker.teams.map((tm) => (
                <li key={tm.id}>
                  <button type="button" onClick={() => picker.onToggle(tm.id)} aria-pressed={tm.followed}
                    data-testid="followed-pick-row"
                    aria-label={tm.followed ? f.unfollowAria({ team: tm.name }) : f.followAria({ team: tm.name })}
                    className="flex w-full items-center gap-2 min-h-[44px] px-1 text-start hover:bg-[--surface-2] rounded-lg">
                    <Icon name="star" className={tm.followed ? 'w-5 h-5 shrink-0 fill-current text-[#4f46e5]' : 'w-5 h-5 shrink-0 text-[--ink-3]'} />
                    <span dir="auto" className="text-sm text-[--ink-1] truncate">{tm.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {cards.length === 0 ? (
        <p className="text-[13px] text-[--ink-3]" data-testid="followed-empty">{picker && picker.total > 0 ? f.emptyPick : f.empty}</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {cards.map((c) => {
            const tone = c.status.tone;
            return (
              <div key={c.id} data-testid="followed-card" data-tone={tone}
                className={tone === 'alert' ? CARD_ALERT : tone === 'warn' ? CARD_WARN : CARD_CALM}>
                <button type="button" onClick={() => onOpen(c.id)} className="text-start min-h-[44px]">
                  <span dir="auto" className="block text-sm font-bold text-[--ink-1] truncate">{c.name}</span>
                  <span dir="auto" className={`block ${tone === 'alert' ? LINE_ALERT : tone === 'warn' ? LINE_WARN : LINE_CALM}`}>{c.line}</span>
                </button>
                {c.action && (
                  <button type="button" onClick={c.action.run} data-testid="followed-action"
                    className="min-h-[44px] rounded-lg bg-ink-fire px-3 text-sm font-semibold text-white">
                    {c.action.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
