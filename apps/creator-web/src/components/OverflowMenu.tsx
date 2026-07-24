import { useState, type ReactNode } from 'react';
import { Button } from './ui';

// A row's secondary controls, behind one affordance (change: run-console-clarity;
// promoted to a shared primitive by change: dashboard-card-actions-overflow so the
// Run Console team row and the Dashboard game card use ONE menu).
//
// The team row already carried a name, a status line, up to two state lines, an
// attention badge, a rescue button and a score before a single action button, and
// the per task skip made it four buttons wide. Which control sits where is decided
// by a pure split (`teamRowActions` / `dashboardCardActions`), never here.
export function OverflowMenu({ label, ariaLabel, children, triggerClassName = 'min-h-0 px-2.5 py-1 text-[11px] rounded-lg' }: {
  label: string; ariaLabel: string; children: ReactNode;
  // Optional trigger styling. Defaults to the dense row style the Dashboard card
  // and Run Console team row use, so those callers stay byte-identical; the
  // Builder's "File" menu (change: builder-file-menu) passes a header-styled,
  // 44px tap-target class instead.
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open && (
        <>
          {/* Click anywhere else to dismiss, without trapping focus mid event. */}
          <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute z-20 mt-1 end-0 min-w-[11rem] rounded-xl border border-[--rp-border] bg-[--surface-0] dark:bg-app-card p-1.5 shadow-lg flex flex-col gap-1"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
