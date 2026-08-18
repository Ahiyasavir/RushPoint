// The panel copy contract (change: run-console-clarity).
//
// Twenty four panels, and no two of them agreed on what a panel is. Titles were
// ad hoc inline strings; SEVEN panels (`alerts`, `teams`, `liveStandings`,
// `finalStandings`, `liveMap`, `feed`, `chat`) had no explanation at all; five
// rendered a bare grey <div> where an empty state belongs, so "nothing here" and
// "this failed to load" looked identical to an organizer mid event; and the
// icons were baked INSIDE translated values ('🔥 אזור חם'), which is not
// translatable content and made a title impossible to assert as copy.
//
// This module owns the STRUCTURE (which panel has an icon, an explanation, an
// empty state) keyed by the closed PanelId union, so a panel cannot ship unnamed
// or unexplained. The WORDS live in one nested dictionary block,
// `runConsole.panel.<panelId>.{title, help, empty}`, in both languages, which
// the recursive dictionary parity suite already walks.
//
// Pure: no React, no i18n, no Firebase.
import type { PanelId } from './runConsoleLayout';

export type PanelCopy = {
  /** Rendered decoratively beside the title, never inside the translated text. */
  icon: string;
  /** Every panel has an explanation. There is no opt out, on purpose. */
  hasHelp: true;
  /** Does this panel have a state where it legitimately holds nothing? */
  hasEmpty: boolean;
};

export const PANEL_COPY: Record<PanelId, PanelCopy> = {
  // ── Always on screen ──
  joinShare: { icon: '🔑', hasHelp: true, hasEmpty: false },
  startTeams: { icon: '🚦', hasHelp: true, hasEmpty: false },
  alerts: { icon: '🆘', hasHelp: true, hasEmpty: false },
  broadcast: { icon: '📢', hasHelp: true, hasEmpty: false },
  liveMap: { icon: '📍', hasHelp: true, hasEmpty: false },

  // ── Teams and standings ──
  teams: { icon: '👥', hasHelp: true, hasEmpty: true },
  liveStandings: { icon: '📊', hasHelp: true, hasEmpty: false },
  finalStandings: { icon: '🏁', hasHelp: true, hasEmpty: false },

  // ── Game systems ──
  hotZone: { icon: '🔥', hasHelp: true, hasEmpty: false },
  flashMission: { icon: '⚡', hasHelp: true, hasEmpty: false },
  trackables: { icon: '🎒', hasHelp: true, hasEmpty: true },
  zones: { icon: '🚩', hasHelp: true, hasEmpty: true },
  taskAvailability: { icon: '⏸️', hasHelp: true, hasEmpty: true },

  // ── From the field ──
  photoReview: { icon: '📷', hasHelp: true, hasEmpty: true },
  feed: { icon: '📸', hasHelp: true, hasEmpty: true },
  mediaGallery: { icon: '🖼️', hasHelp: true, hasEmpty: true },
  chat: { icon: '💬', hasHelp: true, hasEmpty: true },
  // The organizer's end of the staff↔admin channel (staff-console-field-ops).
  staffChannel: { icon: '📻', hasHelp: true, hasEmpty: true },

  // ── Share and screens ──
  shareScreens: { icon: '🔗', hasHelp: true, hasEmpty: false },
  stationQr: { icon: '🖨️', hasHelp: true, hasEmpty: false },
  staffInvite: { icon: '🧑‍✈️', hasHelp: true, hasEmpty: false },

  // ── Reports ──
  runSummary: { icon: '🧾', hasHelp: true, hasEmpty: true },
  analytics: { icon: '📈', hasHelp: true, hasEmpty: true },
  heatmap: { icon: '🗺️', hasHelp: true, hasEmpty: true },
  feedback: { icon: '⭐', hasHelp: true, hasEmpty: true },
  survey: { icon: '🗳️', hasHelp: true, hasEmpty: true },
};

export function panelCopy(id: PanelId): PanelCopy {
  return PANEL_COPY[id];
}

/** The panels that can legitimately render nothing and must say so out loud. */
export const PANELS_WITH_EMPTY_STATE = (Object.keys(PANEL_COPY) as PanelId[])
  .filter((id) => PANEL_COPY[id].hasEmpty);
