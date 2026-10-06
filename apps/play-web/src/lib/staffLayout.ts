// Where each staff app section goes (change: desktop-layouts-play-staff; redesigned for issue 39).
//
// One table for both layouts, so a section added to the staff app has to be placed in both and
// none can be dropped from one or drawn twice (scripts/test-staff-layout.ts). The phone order is the
// order the staff app always had.
//
// On a computer (issue 39, Ahiya 2026-10-06: "העיצוב של הממשק צוות במחשב, פשוט אל הפנים") the
// first attempt only rearranged the phone's sections into three columns. Dispatch and support
// consoles solve the same problem with ONE pattern: a queue of what needs a person, the main working
// list, and one side panel that shows a single tool at a time. So:
//   needsYou — help calls, photos to check, flash missions, my followed teams (the queue);
//   main     — the teams, the list a marshal works from;
//   sideTop  — the event's phone numbers, always visible;
//   sideTabs — map, team chat, the organizer channel, the photo feed, a message to everyone: ONE
//              shown at a time in a tabbed panel, instead of five collapsed boxes stacked up.
// Above all of it, a fixed top bar with the live counts (staffDeskCounts).

export const STAFF_SECTIONS = [
  'quickBar', 'followed', 'contacts', 'alerts', 'review', 'teams', 'flash', 'map', 'staffChannel', 'chat', 'feed', 'broadcast',
] as const;
export type StaffSection = (typeof STAFF_SECTIONS)[number];

/** Phone: one column, in this order. */
export const STAFF_PHONE_ORDER: readonly StaffSection[] = STAFF_SECTIONS;

export interface StaffDesktopLayout {
  needsYou: StaffSection[];
  main: StaffSection[];
  sideTop: StaffSection[];
  sideTabs: StaffSection[];
}

/**
 * Computer. The quick bar is a phone's jump list to sections below the fold; with every section on
 * screen it has nothing to jump to.
 */
export function staffDesktopLayout(): StaffDesktopLayout {
  return {
    needsYou: ['alerts', 'review', 'flash', 'followed'],
    main: ['teams'],
    sideTop: ['contacts'],
    sideTabs: ['map', 'chat', 'staffChannel', 'feed', 'broadcast'],
  };
}

export interface StaffDeskCounts { teams: number; playing: number; held: number; finished: number; waiting: number; sos: number; photos: number }

/** The top bar's live numbers. Total, never throws; a removed team is not counted. */
export function staffDeskCounts(
  teams: ReadonlyArray<{ held?: boolean; launched?: boolean; status?: string; removed?: boolean }> | null | undefined,
  openAlerts: number,
  pendingPhotos: number,
): StaffDeskCounts {
  const rows = (Array.isArray(teams) ? teams : []).filter((t) => t && t.removed !== true);
  const finished = rows.filter((t) => t.status === 'finished').length;
  const held = rows.filter((t) => t.status !== 'finished' && t.held === true).length;
  const playing = rows.filter((t) => t.status !== 'finished' && t.held !== true && t.launched === true).length;
  return {
    teams: rows.length,
    playing,
    held,
    finished,
    waiting: rows.length - finished - held - playing,
    sos: Math.max(0, Math.floor(Number(openAlerts) || 0)),
    photos: Math.max(0, Math.floor(Number(pendingPhotos) || 0)),
  };
}
