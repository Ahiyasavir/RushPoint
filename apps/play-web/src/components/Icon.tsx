// RushPoint's drawn icons (change: no-stock-emoji). The drawings live ONCE in
// packages/shared/src/iconPaths.ts; this renders one. Decorative by default (aria-hidden): put the
// meaning in words beside it, or give an icon-only control its own accessible name.
// creator-web carries the same component at the same path (packages/shared holds no React).
import type { SVGProps } from 'react';
import { ICON_PATHS, type IconName } from '@rushpoint/shared';

export type { IconName };

export function Icon({ name, className = 'w-5 h-5', ...rest }: { name: IconName; className?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>
      {ICON_PATHS[name].map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ? 'currentColor' : undefined} stroke={p.fill ? 'none' : undefined} />
      ))}
    </svg>
  );
}

/** Icon then text, aligned on one line: the common "heading with an icon" shape. */
export function IconLabel({ name, children, className = '', iconClassName = 'w-4 h-4 shrink-0' }: {
  name: IconName; children: React.ReactNode; className?: string; iconClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon name={name} className={iconClassName} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

// ── Medals (podium places) ───────────────────────────────────────────────────────────────────────────
/** Gold, silver and bronze, dark enough to read on the light theme. */
export const MEDAL_TINT: Record<1 | 2 | 3, string> = { 1: '#C99400', 2: '#8A8F98', 3: '#B0662A' };

/** A drawn podium medal with its place inside: replaces the stock first/second/third place emoji. */
export function Medal({ place, className = 'w-6 h-6' }: { place: 1 | 2 | 3; className?: string }) {
  const c = MEDAL_TINT[place];
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M8 2.5l2.5 6M16 2.5l-2.5 6" stroke={c} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <circle cx="12" cy="14.5" r="6.8" fill={c} />
      <text x="12" y="17.7" textAnchor="middle" fontSize="9" fontWeight={800} fill="#fff" fontFamily="system-ui, sans-serif">{place}</text>
    </svg>
  );
}
/** A medal for the top three places, otherwise nothing (callers show the number instead). */
export function medalFor(index0: number, className?: string) {
  const place = index0 + 1;
  return place >= 1 && place <= 3 ? <Medal place={place as 1 | 2 | 3} className={className} /> : null;
}

// ── For DOM built outside React (map markers) ────────────────────────────────────────────────────────
/**
 * The same drawing as SVG markup, for elements MapLibre owns. `color` must be a CSS colour literal.
 * `filled` paints the outline's interior too (a solid star on a marker).
 */
export function iconSvgMarkup(name: IconName, size: number, color: string, filled = false): string {
  const paths = ICON_PATHS[name].map((p) => (p.fill
    ? `<path d="${p.d}" fill="${color}" stroke="none"/>`
    : `<path d="${p.d}"/>`)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${filled ? color : 'none'}" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
