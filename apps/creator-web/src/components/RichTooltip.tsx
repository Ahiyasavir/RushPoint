// Reusable rich tooltip for the Builder (change: v2.1-builder-shell-redesign).
// Abstract config concepts (geofence radius, hint penalty, max concurrent teams,
// difficulty routing weight) — and each task type's verification animation — are
// hard to grasp from a label alone, so on hover/focus we show a small card with a
// one-line explanation and an inline SVG diagram.
//
// The card is portalled to <body> and positioned with `position: fixed`, then
// clamped into the viewport (and flipped above↔below when there isn't room). A
// purely CSS-centered card can't know where the window edge is, so a trigger near
// the modal edge would spill the card off-screen — this measures and keeps it in.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './LanguageContext';
import { FLASH_MISSION_TTL_MINUTES } from '../lib/runConsoleActions';

// Builder concepts read their copy from t.builder.*; the Run Console concepts
// (change: run-console-progressive-disclosure) read theirs from t.runConsole.*.
// A concept without a diagram renders text only, which is why `svgs` is partial.
export type TooltipConcept =
  | 'geofence' | 'hint' | 'concurrent' | 'difficulty'
  | 'flashMission' | 'announcementPersistence' | 'hotZone' | 'runBilling';

type ConceptTooltip = { concept: TooltipConcept; title?: never; body?: never; svg?: never };
type DirectTooltip = { concept?: never; title: string; body: string; svg?: ReactNode };
type TooltipProps = (ConceptTooltip | DirectTooltip) & { children?: ReactNode };

// Only the (illustrative, asset-light) SVGs live here; the title + body come from
// i18n so the tooltip is localized. The difficulty diagram's axis labels are
// passed in (easyLabel/hardLabel) so they localize too.
function buildSvgs(easyLabel: string, hardLabel: string): Partial<Record<TooltipConcept, ReactNode>> {
  return {
    geofence: (
        <svg viewBox="0 0 120 60" className="w-full h-14">
          <circle cx="60" cy="30" r="26" fill="#D85A3022" stroke="#D85A30" strokeWidth="1.5" />
          <circle cx="60" cy="30" r="3" fill="#D85A30" />
          <line x1="60" y1="30" x2="86" y2="30" stroke="#D85A30" strokeWidth="1" strokeDasharray="2 2" />
          <text x="73" y="26" fontSize="7" fill="#D85A30">r</text>
          <circle cx="32" cy="44" r="3" fill="#378ADD" />
          <circle cx="92" cy="18" r="3" fill="currentColor" />
        </svg>
      ),
    hint: (
        <svg viewBox="0 0 120 60" className="w-full h-14">
          <text x="20" y="38" fontSize="22">💡</text>
          <text x="56" y="36" fontSize="14" fill="#D85A30">−25</text>
          <text x="92" y="36" fontSize="14">★</text>
        </svg>
      ),
    concurrent: (
        <svg viewBox="0 0 120 60" className="w-full h-14">
          <rect x="44" y="16" width="32" height="28" rx="4" fill="#7F77DD22" stroke="#7F77DD" strokeWidth="1.5" />
          <circle cx="54" cy="30" r="4" fill="#7F77DD" />
          <circle cx="66" cy="30" r="4" fill="#7F77DD" />
          <circle cx="18" cy="30" r="4" fill="currentColor" />
          <circle cx="102" cy="30" r="4" fill="currentColor" />
          <path d="M26 30 H40" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
          <path d="M80 30 H94" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
        </svg>
      ),
    difficulty: (
        <svg viewBox="0 0 120 60" className="w-full h-14">
          <polyline points="12,46 36,40 60,30 84,20 108,10" fill="none" stroke="#FF5722" strokeWidth="2" />
          {[46, 40, 30, 20, 10].map((y, i) => (
            <circle key={i} cx={12 + i * 24} cy={y} r="3" fill="#FF5722" />
          ))}
          <text x="10" y="56" fontSize="6" fill="currentColor">{easyLabel}</text>
          <text x="92" y="56" fontSize="6" fill="currentColor">{hardLabel}</text>
        </svg>
      ),
  };
}

// Card geometry (kept in sync with the classes below so we can measure-free clamp).
const CARD_WIDTH = 224; // w-56
const VIEWPORT_PAD = 8; // keep this much gap from the window edge
const TRIGGER_GAP = 8; // gap between the ? button and the card

type Coords = { top: number; left: number; placement: 'top' | 'bottom' };

export default function RichTooltip({ concept, title: titleProp, body: bodyProp, svg: svgProp, children }: TooltipProps) {
  const id = useId();
  const t = useT();
  const b = t.builder;
  const rc = t.runConsole;
  const TEXT: Record<TooltipConcept, { title: string; body: string }> = {
    geofence: { title: b.tipGeofenceTitle, body: b.tipGeofenceBody },
    hint: { title: b.tipHintTitle, body: b.tipHintBody },
    concurrent: { title: b.tipConcurrentTitle, body: b.tipConcurrentBody },
    difficulty: { title: b.tipDifficultyTitle, body: b.tipDifficultyBody },
    flashMission: { title: rc.tipFlashMissionTitle, body: rc.tipFlashMissionBody({ minutes: FLASH_MISSION_TTL_MINUTES }) },
    announcementPersistence: { title: rc.tipAnnouncementTitle, body: rc.tipAnnouncementBody },
    hotZone: { title: rc.tipHotZoneTitle, body: rc.tipHotZoneBody },
    runBilling: { title: rc.tipBillingTitle, body: rc.tipBillingBody },
  };
  const svgs = buildSvgs(b.diffEasy, b.diffHard);
  const d = concept
    ? { ...TEXT[concept], svg: svgs[concept] }
    : { title: titleProp!, body: bodyProp!, svg: svgProp };

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Position the (already-rendered, still-invisible) card relative to the trigger,
  // clamped inside the viewport. Runs before paint so there is no visible jump.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const cardH = cardRef.current?.offsetHeight ?? 0;

      // Center on the trigger, then clamp so neither edge leaves the window.
      const centerX = r.left + r.width / 2;
      const left = Math.min(
        Math.max(centerX - CARD_WIDTH / 2, VIEWPORT_PAD),
        vw - CARD_WIDTH - VIEWPORT_PAD,
      );

      // Prefer above; flip below when the card wouldn't fit over the trigger.
      const fitsAbove = r.top - TRIGGER_GAP - cardH >= VIEWPORT_PAD;
      const placement: Coords['placement'] = fitsAbove ? 'top' : 'bottom';
      const top = placement === 'top'
        ? Math.max(r.top - TRIGGER_GAP - cardH, VIEWPORT_PAD)
        : Math.min(r.bottom + TRIGGER_GAP, vh - cardH - VIEWPORT_PAD);

      setCoords({ top, left, placement });
    };
    place();
    // Reposition if the page scrolls or resizes while the card is open.
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

  const show = () => setOpen(true);
  const hide = () => { setOpen(false); setCoords(null); };

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={triggerRef}
        type="button"
        aria-label={d.title}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="w-4 h-4 rounded-full bg-[--surface-2] text-[--ink-3] text-[12px] leading-none flex items-center justify-center hover:text-[--ink-1] focus:outline-none focus:ring-1 focus:ring-rp-fire"
      >
        {children ?? '?'}
      </button>
      {open && createPortal(
        <div
          ref={cardRef}
          id={id}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            width: CARD_WIDTH,
            // Keep it out of the way (and unclickable) until we've measured+placed.
            visibility: coords ? 'visible' : 'hidden',
          }}
          className="pointer-events-none z-[60] rounded-xl border border-[--rp-border] bg-[--surface-1] p-3 shadow-soft"
        >
          <div className="text-xs font-semibold text-[--ink-1] mb-1">{d.title}</div>
          {d.svg && <div className="rounded-lg bg-[--surface-2] text-[--ink-2] mb-1.5">{d.svg}</div>}
          <div className="text-[13px] text-[--ink-3] leading-snug">{d.body}</div>
        </div>,
        document.body,
      )}
    </span>
  );
}
