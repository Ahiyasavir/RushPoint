import { daysUntilEvent } from '@rushpoint/shared';
import type { Game } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { walkEnding } from '../lib/walkEnding';

/** When the game is (change: creator-engagement-loop): a real date is a real reason to come back, and it
 *  drives the dashboard countdown and the day-before reminder. Asked once, in the plan, never required. */
export function EventDateRow({ game, onGameChange }: { game: Game; onGameChange: (g: Game) => void }) {
  const sf = useT().setupFlow;
  const toDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  };
  // A cleared date is sent as null (an explicit clear), never undefined, which the save would not send.
  const when = walkEnding(game.eventAt, new Date().toISOString());
  const days = daysUntilEvent(game.eventAt ?? null, new Date().toISOString());
  const hint = when === 'today' ? sf.eventHintToday : when === 'now' ? sf.eventHintPast : when === 'later' && days !== null ? sf.readyDays({ n: days }) : sf.eventHint;
  const set = (v: string) => onGameChange({ ...game, eventAt: v ? new Date(`${v}T10:00:00`).toISOString() : (null as unknown as undefined) });
  return (
    <label className="mt-3 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[--rp-border] bg-[--surface-0] px-3.5 py-2.5 [@media(max-height:560px)]:py-1.5">
      <span className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-rp-fire/10 text-ink-fire"><Icon name="calendar" className="w-5 h-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold leading-tight">{sf.eventQ}</span>
        <span className="block text-[13px] sm:text-[14px] text-[--ink-2] leading-snug [@media(max-height:560px)]:hidden">{hint}</span>
      </span>
      <input type="date" value={toDate(game.eventAt)} onChange={(e) => set(e.target.value)}
        className="shrink-0 min-h-[44px] rounded-xl border border-[--rp-border] bg-[--surface-1] px-3 text-[16px] text-[--ink-1]" />
    </label>
  );
}
