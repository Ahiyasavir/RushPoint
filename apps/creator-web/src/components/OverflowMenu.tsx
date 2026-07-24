import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui';

// A row's secondary controls, behind one affordance (change: run-console-clarity;
// promoted to a shared primitive by change: dashboard-card-actions-overflow so the
// Run Console team row and the Dashboard game card use ONE menu).
//
// The team row already carried a name, a status line, up to two state lines, an
// attention badge, a rescue button and a score before a single action button, and
// the per task skip made it four buttons wide. Which control sits where is decided
// by a pure split (`teamRowActions` / `dashboardCardActions`), never here.
//
// The popup is PORTALLED to <body> and positioned with `position: fixed` from the
// trigger's bounding rect (mirroring RichTooltip). An in-flow `absolute` menu was
// cropped by the Dashboard card's `overflow-hidden` (rounded-corner clip) and its
// `animate-fade-up` transform ancestor — the same class of bug that forced
// GalleryTaskDetailModal to portal. A portal escapes both, and the anchor edge and
// viewport clamp keep it on-screen in RTL and LTR alike.
const VIEWPORT_PAD = 8; // keep this much gap from the window edge
const TRIGGER_GAP = 4; // gap between the trigger and the menu (was mt-1)

type Coords = { top: number; left: number };

export function OverflowMenu({ label, ariaLabel, children, triggerClassName = 'min-h-0 px-2.5 py-1 text-[11px] rounded-lg' }: {
  label: string; ariaLabel: string; children: ReactNode;
  // Optional trigger styling. Defaults to the dense row style the Dashboard card
  // and Run Console team row use, so those callers stay byte-identical; the
  // Builder's "File" menu (change: builder-file-menu) passes a header-styled,
  // 44px tap-target class instead.
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the (already-rendered, still-invisible) menu below the trigger,
  // aligning its inline-end edge to the trigger's inline-end edge (matching text
  // direction so RTL and LTR both hang the menu inside the row), then clamp into
  // the viewport and flip above when there isn't room below. Runs before paint so
  // there is no visible jump.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const menuW = menu?.offsetWidth ?? 0;
      const menuH = menu?.offsetHeight ?? 0;
      const rtl = getComputedStyle(anchor).direction === 'rtl';

      // Anchor the menu's inline-end edge to the trigger's inline-end edge.
      // LTR end = right → right edges align; RTL end = left → left edges align.
      const rawLeft = rtl ? r.left : r.right - menuW;
      const left = Math.min(
        Math.max(rawLeft, VIEWPORT_PAD),
        Math.max(vw - menuW - VIEWPORT_PAD, VIEWPORT_PAD),
      );

      // Prefer below the trigger; flip above when the menu wouldn't fit under it.
      const fitsBelow = r.bottom + TRIGGER_GAP + menuH <= vh - VIEWPORT_PAD;
      const top = fitsBelow
        ? r.bottom + TRIGGER_GAP
        : Math.max(r.top - TRIGGER_GAP - menuH, VIEWPORT_PAD);

      setCoords({ top, left });
    };
    place();
    // Reposition if the page scrolls or resizes while the menu is open.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Dismiss on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => { setOpen(false); setCoords(null); };

  return (
    <div ref={anchorRef} className="relative">
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
      {open && createPortal(
        <>
          {/* Click anywhere else to dismiss, without trapping focus mid event. */}
          <div className="fixed inset-0 z-[55]" aria-hidden="true" onClick={close} />
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: coords?.top ?? 0,
              left: coords?.left ?? 0,
              // Keep it out of the way (and unclickable) until we've measured+placed.
              visibility: coords ? 'visible' : 'hidden',
            }}
            className="z-[60] min-w-[11rem] rounded-xl border border-[--rp-border] bg-[--surface-0] dark:bg-app-card p-1.5 shadow-lg flex flex-col gap-1"
            onClick={close}
          >
            {children}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
