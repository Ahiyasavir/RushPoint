// RushPoint's drawn icons (change: no-stock-emoji). The drawings live ONCE in
// packages/shared/src/iconPaths.ts; this renders one. Decorative by default (aria-hidden): put the
// meaning in words beside it, or give an icon-only control its own accessible name.
// play-web carries the same component at the same path (packages/shared holds no React).
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
