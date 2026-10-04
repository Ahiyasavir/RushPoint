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
import { Icon, type IconName } from '../components/Icon';

export type PanelCopy = {
  /** Rendered decoratively beside the title, never inside the translated text. */
  /** A drawn icon (packages/shared/src/iconPaths.ts), never an emoji (change: no-stock-emoji). */
  icon: IconName;
  /** Every panel has an explanation. There is no opt out, on purpose. */
  hasHelp: true;
  /** Does this panel have a state where it legitimately holds nothing? */
  hasEmpty: boolean;
};

export const PANEL_COPY: Record<PanelId, PanelCopy> = {
  // ── Always on screen ──
  joinShare: { icon: 'key', hasHelp: true, hasEmpty: false },
  startTeams: { icon: 'play', hasHelp: true, hasEmpty: false },
  alerts: { icon: 'sos', hasHelp: true, hasEmpty: false },
  broadcast: { icon: 'megaphone', hasHelp: true, hasEmpty: false },
  liveMap: { icon: 'map', hasHelp: true, hasEmpty: false },

  // ── Teams and standings ──
  teams: { icon: 'users', hasHelp: true, hasEmpty: true },
  liveStandings: { icon: 'chart', hasHelp: true, hasEmpty: false },
  finalStandings: { icon: 'finish', hasHelp: true, hasEmpty: false },

  // ── Game systems ──
  hotZone: { icon: 'flame', hasHelp: true, hasEmpty: false },
  flashMission: { icon: 'bolt', hasHelp: true, hasEmpty: false },
  trackables: { icon: 'backpack', hasHelp: true, hasEmpty: true },
  zones: { icon: 'flag', hasHelp: true, hasEmpty: true },
  taskAvailability: { icon: 'pause', hasHelp: true, hasEmpty: true },

  // ── From the field ──
  // run-console-simplify: "עכשיו", everything waiting for the organizer in one list.
  inbox: { icon: 'bolt', hasHelp: true, hasEmpty: true },
  photoReview: { icon: 'camera', hasHelp: true, hasEmpty: true },
  feed: { icon: 'image', hasHelp: true, hasEmpty: true },
  mediaGallery: { icon: 'image', hasHelp: true, hasEmpty: true },
  chat: { icon: 'chat', hasHelp: true, hasEmpty: true },
  // The organizer's end of the staff↔admin channel (staff-console-field-ops).
  staffChannel: { icon: 'radio', hasHelp: true, hasEmpty: true },

  // ── Share and screens ──
  shareScreens: { icon: 'link', hasHelp: true, hasEmpty: false },
  stationQr: { icon: 'printer', hasHelp: true, hasEmpty: false },
  staffInvite: { icon: 'badge', hasHelp: true, hasEmpty: false },

  // ── Reports ──
  runSummary: { icon: 'receipt', hasHelp: true, hasEmpty: true },
  analytics: { icon: 'trend', hasHelp: true, hasEmpty: true },
  heatmap: { icon: 'map', hasHelp: true, hasEmpty: true },
  feedback: { icon: 'star', hasHelp: true, hasEmpty: true },
  survey: { icon: 'ballot', hasHelp: true, hasEmpty: true },
};

export function panelCopy(id: PanelId): PanelCopy {
  return PANEL_COPY[id];
}

/** The panels that can legitimately render nothing and must say so out loud. */
export const PANELS_WITH_EMPTY_STATE = (Object.keys(PANEL_COPY) as PanelId[])
  .filter((id) => PANEL_COPY[id].hasEmpty);
