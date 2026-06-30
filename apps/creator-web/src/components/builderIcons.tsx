// Original RushPoint line-icon set for the Builder (change:
// v2.1-builder-shell-redesign). Replaces the stock emoji on trigger-mode and
// task-type chips with a cohesive 24x24 stroke set that inherits `currentColor`
// (so a chip's active/inactive colour drives the icon too). One visual language
// across the wizard + task cards.
import type { ReactNode, SVGProps } from 'react';
import type { TaskType, TriggerMode } from '@rushpoint/shared';

export type BuilderIconName =
  | 'radius' | 'exact' | 'instant' | 'anywhere'
  | 'station' | 'photo' | 'quiz' | 'numeric' | 'field' | 'selfReport' | 'geofence' | 'sequence';

const PATHS: Record<BuilderIconName, ReactNode> = {
  // ── Trigger modes ──
  // Within radius: a pin standing inside a ground ring.
  radius: (
    <>
      <ellipse cx="12" cy="19.5" rx="7" ry="2.4" />
      <path d="M12 16.5c0-.2 4-3.9 4-7a4 4 0 1 0-8 0c0 3.1 4 6.8 4 7z" />
      <circle cx="12" cy="9.2" r="1.5" />
    </>
  ),
  // Exact spot: a crosshair on a point.
  exact: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Instant: a lightning bolt.
  instant: <path d="M13 2.5 5.7 13H11l-1 8.5L18.3 9.5H12.6L13 2.5Z" />,
  // Anywhere / digital: a globe.
  anywhere: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3.2 12h17.6M4.6 7.5h14.8M4.6 16.5h14.8" />
    </>
  ),

  // ── Task types ──
  // Station: a key (find + enter a code on site).
  station: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M11.3 11.3 20 20M17 20l3-3M15 18l3-3" />
    </>
  ),
  // Photo: a camera.
  photo: (
    <>
      <path d="M4 8.5h2.4l1.3-2h8.6l1.3 2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.3" />
    </>
  ),
  // Quiz: a speech bubble with a question mark.
  quiz: (
    <>
      <path d="M4 5h16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 20 15h-9l-4.2 3.6V15H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 5Z" />
      <path d="M9.7 8.6a2.4 2.4 0 0 1 4.3 1.4c0 1.4-2 1.6-2 2.9" />
      <circle cx="12" cy="14.6" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  // Numeric: a hashtag (submit a number).
  numeric: <path d="M9.2 3 7 21M17 3l-2.2 18M4 8.2h16.5M3.5 15.8H20" />,
  // Check in: a pin with a check.
  field: (
    <>
      <path d="M12 21s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" />
      <path d="M9.4 10.6 11.2 12.4 14.7 8.9" />
    </>
  ),
  // Self report: a person.
  selfReport: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.6 20a6.4 6.4 0 0 1 12.8 0" />
    </>
  ),
  // Geofence: a broadcast / auto GPS signal.
  geofence: (
    <>
      <circle cx="12" cy="15.5" r="2" fill="currentColor" stroke="none" />
      <path d="M8.6 12.1a4.8 4.8 0 0 1 6.8 0M6.1 9.6a8.3 8.3 0 0 1 11.8 0" />
    </>
  ),
  // Sequence: an ordered list of steps.
  sequence: (
    <>
      <circle cx="4.6" cy="6.5" r="1.1" />
      <circle cx="4.6" cy="12" r="1.1" />
      <circle cx="4.6" cy="17.5" r="1.1" />
      <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20" />
    </>
  ),
};

export function BuilderIcon({
  name, className = 'w-5 h-5', ...rest
}: { name: BuilderIconName; className?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export const TRIGGER_ICON_NAME: Record<TriggerMode, BuilderIconName> = {
  radius: 'radius', exact: 'exact', instant: 'instant', locationless: 'anywhere',
};

export const TYPE_ICON_NAME: Record<TaskType, BuilderIconName> = {
  smart_station: 'station', photo: 'photo', quiz: 'quiz', numeric: 'numeric',
  field: 'field', self_report: 'selfReport', geofence: 'geofence', sequence: 'sequence',
};
