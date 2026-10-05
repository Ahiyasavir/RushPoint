// Where each staff app section goes (change: desktop-layouts-play-staff).
//
// One table for both layouts, so a section added to the staff app has to be placed in both and
// none can be dropped from one or drawn twice (scripts/test-staff-layout.ts). The phone order is the
// order the staff app always had. On a computer: "עכשיו" (what needs a marshal now), the teams (the
// main working list), and map and communication.

export const STAFF_SECTIONS = [
  'quickBar', 'followed', 'contacts', 'alerts', 'review', 'teams', 'flash', 'map', 'staffChannel', 'chat', 'feed', 'broadcast',
] as const;
export type StaffSection = (typeof STAFF_SECTIONS)[number];

/** Phone: one column, in this order. */
export const STAFF_PHONE_ORDER: readonly StaffSection[] = STAFF_SECTIONS;

/**
 * Computer: three columns. The quick bar is a phone's jump list to sections below the fold; with
 * every section on screen it has nothing to jump to.
 */
export function staffDesktopColumns(): StaffSection[][] {
  return [
    ['followed', 'alerts', 'review', 'flash'],
    ['teams'],
    ['contacts', 'map', 'staffChannel', 'chat', 'feed', 'broadcast'],
  ];
}
