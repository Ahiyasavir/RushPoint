// "הקבוצות שלי" strip in the staff app, right under the quick bar (change: followed-teams).
//
// One compact card per followed team: its name, one line, and at most one action, the one that team
// needs now and this person may take. Colour only when something is wrong (red: SOS / out of bounds;
// amber: waiting / stuck / paused). The dashboard decides status and action (pure, @rushpoint/shared).
import type { FollowedStatus } from '@rushpoint/shared';
import { useT } from '../i18nContext';
import { Icon } from './Icon';

export interface StaffFollowedCard {
  id: string;
  name: string;
  status: FollowedStatus;
  line: string;
  action: { label: string; run: () => void; busy?: boolean } | null;
}

// Whole static strings per tone (Tailwind only sees static class strings).
const CARD_ALERT = 'rounded-xl border-2 border-danger bg-danger/10 p-2.5 w-[10.5rem] shrink-0 flex flex-col gap-1.5';
const CARD_WARN = 'rounded-xl border-2 border-amber-500 bg-amber-500/10 p-2.5 w-[10.5rem] shrink-0 flex flex-col gap-1.5';
const CARD_CALM = 'rounded-xl border border-glass-border bg-app-card p-2.5 w-[10.5rem] shrink-0 flex flex-col gap-1.5';
const LINE_ALERT = 'block text-[13px] font-semibold text-ink-alert truncate';
const LINE_WARN = 'block text-[13px] font-semibold text-ink-amber truncate';
const LINE_CALM = 'block text-[13px] text-zinc-400 truncate';

export default function StaffFollowedStrip({ cards, mineOnly, onMineOnly, onOpen }: {
  cards: StaffFollowedCard[];
  mineOnly: boolean;
  onMineOnly: (on: boolean) => void;
  onOpen: (teamId: string) => void;
}) {
  const { t } = useT();
  const f = t.staff.follow;
  return (
    <section aria-label={f.title} data-testid="staff-followed" className="mb-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-1.5"><Icon name="star" className="w-4 h-4 fill-current text-indigo-600" />{f.title}</h2>
        {cards.length > 0 && (
          <label className="inline-flex items-center gap-2 min-h-[44px] text-[13px] text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={mineOnly} onChange={(e) => onMineOnly(e.target.checked)} data-testid="staff-followed-mine-only" />
            {f.mineOnly}
          </label>
        )}
      </div>
      {cards.length === 0 ? (
        <p className="text-[13px] text-zinc-500" data-testid="staff-followed-empty">{f.empty}</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {cards.map((c) => {
            const tone = c.status.tone;
            return (
              <div key={c.id} data-testid="staff-followed-card" data-tone={tone}
                className={tone === 'alert' ? CARD_ALERT : tone === 'warn' ? CARD_WARN : CARD_CALM}>
                <button type="button" onClick={() => onOpen(c.id)} className="text-start min-h-[44px]">
                  <span dir="auto" className="block text-sm font-bold text-zinc-100 truncate">{c.name}</span>
                  <span dir="auto" className={tone === 'alert' ? LINE_ALERT : tone === 'warn' ? LINE_WARN : LINE_CALM}>{c.line}</span>
                </button>
                {c.action && (
                  <button type="button" onClick={c.action.run} disabled={c.action.busy} data-testid="staff-followed-action"
                    className="min-h-[44px] rounded-lg bg-accent px-2 text-sm font-semibold text-black disabled:opacity-40">
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
