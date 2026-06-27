// Reusable rich tooltip for the Builder (change: v2.1-builder-shell-redesign).
// Abstract config concepts (geofence radius, hint penalty, max concurrent teams,
// difficulty routing weight) are hard to grasp from a label alone, so on hover/
// focus we show a small card with a one-line explanation and an asset-light inline
// SVG diagram. CSS-only show/hide (no portal, no JS positioning) keeps it cheap.
import { useId, type ReactNode } from 'react';

export type TooltipConcept = 'geofence' | 'hint' | 'concurrent' | 'difficulty';

const DIAGRAMS: Record<TooltipConcept, { title: string; body: string; svg: ReactNode }> = {
  geofence: {
    title: 'Geofence radius',
    body: 'Players auto check in when they get within this many metres of the pin.',
    svg: (
      <svg viewBox="0 0 120 60" className="w-full h-14">
        <circle cx="60" cy="30" r="26" fill="#D85A3022" stroke="#D85A30" strokeWidth="1.5" />
        <circle cx="60" cy="30" r="3" fill="#D85A30" />
        <line x1="60" y1="30" x2="86" y2="30" stroke="#D85A30" strokeWidth="1" strokeDasharray="2 2" />
        <text x="73" y="26" fontSize="7" fill="#D85A30">r</text>
        <circle cx="32" cy="44" r="3" fill="#378ADD" />
        <circle cx="92" cy="18" r="3" fill="#9AA2AD" />
      </svg>
    ),
  },
  hint: {
    title: 'Hint penalty',
    body: 'Revealing the hint costs the team this many points, once per task.',
    svg: (
      <svg viewBox="0 0 120 60" className="w-full h-14">
        <text x="20" y="38" fontSize="22">💡</text>
        <text x="56" y="36" fontSize="14" fill="#D85A30">−25</text>
        <text x="92" y="36" fontSize="14">★</text>
      </svg>
    ),
  },
  concurrent: {
    title: 'Max concurrent teams',
    body: 'How many teams may occupy this task at once before routing sends others elsewhere.',
    svg: (
      <svg viewBox="0 0 120 60" className="w-full h-14">
        <rect x="44" y="16" width="32" height="28" rx="4" fill="#7F77DD22" stroke="#7F77DD" strokeWidth="1.5" />
        <circle cx="54" cy="30" r="4" fill="#7F77DD" />
        <circle cx="66" cy="30" r="4" fill="#7F77DD" />
        <circle cx="18" cy="30" r="4" fill="#9AA2AD" />
        <circle cx="102" cy="30" r="4" fill="#9AA2AD" />
        <path d="M26 30 H40" stroke="#9AA2AD" strokeWidth="1" strokeDasharray="2 2" />
        <path d="M80 30 H94" stroke="#9AA2AD" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    ),
  },
  difficulty: {
    title: 'Difficulty routing weight',
    body: 'Smart routing sends harder tasks to teams moving at a faster pace.',
    svg: (
      <svg viewBox="0 0 120 60" className="w-full h-14">
        <polyline points="12,46 36,40 60,30 84,20 108,10" fill="none" stroke="#FF5722" strokeWidth="2" />
        {[46, 40, 30, 20, 10].map((y, i) => (
          <circle key={i} cx={12 + i * 24} cy={y} r="3" fill="#FF5722" />
        ))}
        <text x="10" y="56" fontSize="6" fill="#9AA2AD">easy</text>
        <text x="92" y="56" fontSize="6" fill="#9AA2AD">hard</text>
      </svg>
    ),
  },
};

export default function RichTooltip({ concept, children }: { concept: TooltipConcept; children?: ReactNode }) {
  const id = useId();
  const d = DIAGRAMS[concept];
  return (
    <span className="relative inline-flex group align-middle">
      <button
        type="button"
        aria-label={d.title}
        aria-describedby={id}
        className="w-4 h-4 rounded-full bg-[--surface-2] text-[--ink-3] text-[10px] leading-none flex items-center justify-center hover:text-[--ink-1] focus:outline-none focus:ring-1 focus:ring-rp-fire"
      >
        {children ?? '?'}
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute z-50 bottom-full mb-2 start-1/2 -translate-x-1/2 w-56
          rounded-xl border border-[--rp-border] bg-[--surface-1] p-3 shadow-soft
          opacity-0 invisible transition-opacity duration-150
          group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible"
      >
        <div className="text-xs font-semibold text-[--ink-1] mb-1">{d.title}</div>
        <div className="rounded-lg bg-[--surface-2] mb-1.5">{d.svg}</div>
        <div className="text-[11px] text-[--ink-3] leading-snug">{d.body}</div>
      </span>
    </span>
  );
}
