// Original RushPoint icons for the mission countdown (change: mission-countdown-fuse).
//
// Ahiya, 2026-10-02: "the fire icon should be something you make, not a regular emoji; in general no
// regular emoji in the app's text." Same visual language as creator-web's builderIcons: a 24x24
// drawing that takes the surrounding colour, so the phase colour drives the icon too. The flame is the
// one drawn in full colour (a two-tone gradient that flickers), because it IS the fuse.
// Decorative everywhere it is used: the phase label beside it carries the meaning (aria-hidden).
import { useId } from 'react';

type IconProps = { className?: string };

const STROKE = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
};

/** Calm: a stopwatch with its crown and a single hand. */
export function StopwatchIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg {...STROKE} className={className}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M10 2.75h4M12 2.75v3.25M18.4 6.6l1.4-1.4M12 13.5V9.5" />
      <circle cx="12" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Hurry: the fuse's flame. Drawn, not typed: an outer tongue in fire orange and an inner one in amber
 * to white, swaying slightly (`.rp-flame` in index.css, off under reduced motion).
 */
export function FlameIcon({ className = 'w-5 h-5' }: IconProps) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`rp-flame ${className}`}>
      <defs>
        <linearGradient id={`${id}-o`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#E64A19" />
          <stop offset="1" stopColor="#FF8A00" />
        </linearGradient>
        <linearGradient id={`${id}-i`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#FFB300" />
          <stop offset="1" stopColor="#FFF3C4" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}-o)`}
        d="M12.2 1.8c.5 3-1.6 4.6-3.2 6.5C7.3 10.3 5.6 12.4 5.6 15.2c0 3.9 3 7 6.4 7s6.4-2.8 6.4-6.7c0-2.6-1.3-4.2-2.4-5.6-.2 1.4-.9 2.4-1.9 2.9.4-3.9-.7-7.6-1.9-11z" />
      <path fill={`url(#${id}-i)`}
        d="M12.3 11.2c.2 1.7-.9 2.6-1.7 3.6-.6.8-1.1 1.6-1.1 2.7 0 1.9 1.2 3.2 2.6 3.2s2.6-1.2 2.6-3c0-1.4-.7-2.2-1.3-2.9-.1.7-.5 1.2-1 1.4.2-1.8-.1-3.4-.1-5z" />
    </svg>
  );
}

/** Critical: a lightning bolt. */
export function BoltIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg {...STROKE} className={className}>
      <path d="M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6l1.5-8z" fill="currentColor" fillOpacity={0.18} />
    </svg>
  );
}

/** Time up: an hourglass run empty. */
export function HourglassIcon({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg {...STROKE} className={className}>
      <path d="M6.5 2.75h11M6.5 21.25h11M7.5 2.75c0 5 4.5 6.2 4.5 9.25S7.5 16.25 7.5 21.25M16.5 2.75c0 5-4.5 6.2-4.5 9.25s4.5 4.25 4.5 9.25" />
      <path d="M9.2 19.6c.8-1.6 2-2.2 2.8-2.2s2 .6 2.8 2.2z" fill="currentColor" stroke="none" />
    </svg>
  );
}
