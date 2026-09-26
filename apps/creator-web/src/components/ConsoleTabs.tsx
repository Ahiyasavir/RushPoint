import { useEffect, type ReactNode } from 'react';
import { summaryChips, type GroupSummary, type SectionId } from '../lib/runConsoleLayout';

// The Run Console's primary navigation (change: run-console-tabs-up-front).
//
// Field report 2026-09-25: organizers missed the section tabs entirely. Measured on a
// live run, the old rail started 1,665 px down on a 375 px phone (two full screens,
// below five pinned panels), showed two and a half of its five names, and dropped
// every "something new" badge below `lg`. So the tabs now sit directly under the run
// header, and on a phone they are a FIXED bottom bar: always on screen, all five at
// once, whatever the page is scrolled to.
//
// Presentation only. Which sections exist and what each one reports come from
// `buildRunConsoleSections` / `summaryChips`, so a tab and its pane cannot disagree.

export interface ConsoleTab {
  id: SectionId;
  summary: GroupSummary;
}

export const SECTION_ICON: Record<SectionId, string> = {
  teamsAndScores: '👥',
  moderation: '📥',
  gameMechanics: '🎛️',
  shareAndScreens: '🔗',
  afterTheRun: '📊',
};

/** The one number worth a phone badge: the first chip that asks for action. */
function urgentCount(summary: GroupSummary): number | null {
  const chip = summaryChips(summary).find((c) => c.tone !== 'neutral');
  return chip ? chip.value : null;
}

export default function ConsoleTabs({
  tabs, active, onOpen, longName, shortName, meta, hasNew, newLabel, shortcutTitle, navLabel,
}: {
  tabs: ConsoleTab[];
  active: SectionId | null;
  onOpen: (id: SectionId) => void;
  longName: (id: SectionId) => string;
  shortName: (id: SectionId) => string;
  /** The desktop badge row (the page's translated summary chips). */
  meta: (summary: GroupSummary) => ReactNode;
  hasNew: (id: SectionId) => boolean;
  newLabel: string;
  shortcutTitle: (name: string, key: number) => string;
  navLabel: string;
}) {
  // Desktop shortcuts 1..n. Never while typing: a broadcast or a chat reply must be
  // able to contain a digit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > tabs.length) return;
      onOpen(tabs[n - 1].id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, onOpen]);

  return (
    <>
      {/* Desktop: a sticky bar across the content width. */}
      <nav aria-label={navLabel} data-testid="console-tabs"
        className="hidden lg:flex sticky top-0 z-20 -mx-1 px-1 py-2 gap-2 bg-[--surface-0] border-b border-[--rp-border]">
        {tabs.map((tab, i) => {
          const on = tab.id === active;
          return (
            <button key={tab.id} type="button" onClick={() => onOpen(tab.id)}
              aria-current={on ? 'true' : undefined}
              title={shortcutTitle(longName(tab.id), i + 1)}
              className={`relative flex-1 min-w-0 min-h-[44px] rounded-xl border px-3 py-2 text-start transition-colors ${
                on ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'}`}>
              <span className="flex items-center gap-2 text-sm font-semibold text-[--ink-1]">
                <span aria-hidden="true">{SECTION_ICON[tab.id]}</span>
                <span className="truncate">{longName(tab.id)}</span>
                {!on && hasNew(tab.id) && (
                  <span className="ms-auto h-2.5 w-2.5 shrink-0 rounded-full bg-rp-fire" role="img" aria-label={newLabel} />
                )}
              </span>
              <span className="mt-1 block">{meta(tab.summary)}</span>
            </button>
          );
        })}
      </nav>

      {/* Phone: fixed to the bottom, every section in one row of equal cells. The
          page adds matching bottom padding so nothing hides underneath. */}
      <nav aria-label={navLabel} data-testid="console-tabs-phone"
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-[--rp-border] bg-[--surface-0] shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex">
          {tabs.map((tab) => {
            const on = tab.id === active;
            const count = urgentCount(tab.summary);
            const dot = !on && hasNew(tab.id);
            return (
              <button key={tab.id} type="button" onClick={() => onOpen(tab.id)}
                aria-current={on ? 'true' : undefined}
                aria-label={dot ? `${longName(tab.id)}, ${newLabel}` : longName(tab.id)}
                className={`relative flex-1 min-w-0 min-h-[56px] flex flex-col items-center justify-center gap-0.5 px-0.5 ${
                  on ? 'text-ink-fire' : 'text-[--ink-2]'}`}>
                {on && <span aria-hidden="true" className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-rp-fire" />}
                <span aria-hidden="true" className="relative text-lg leading-none">
                  {SECTION_ICON[tab.id]}
                  {count !== null && (
                    <span className="absolute -top-1.5 -end-3 min-w-[18px] h-[18px] px-1 rounded-full bg-rp-fire text-white text-[11px] font-bold leading-[18px] text-center">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                  {count === null && dot && (
                    <span className="absolute -top-0.5 -end-1.5 h-2.5 w-2.5 rounded-full bg-rp-fire" />
                  )}
                </span>
                <span className={`text-[12px] leading-tight truncate max-w-full ${on ? 'font-bold' : 'font-medium'}`}>
                  {shortName(tab.id)}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
