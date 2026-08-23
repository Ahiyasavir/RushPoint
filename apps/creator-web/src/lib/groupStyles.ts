// Palette for mutually exclusive task groups (change: builder-dnd-groups; calm
// refinement: docs/wave-l/task-card-colour-refine.md).
//
// ⚠ These MUST stay literal, complete class strings. Tailwind scans source text,
// so a computed `bg-${hue}-500/20` would be purged out of the bundle and the cue
// would render colourless. Index into this array, never build the string.
//
// Colour is never the ONLY carrier: the group is shown as a LETTER badge (with a
// border) on each card, a slim leading `accent` edge, and is named in text in the
// stage strip and the modal — so the surface is colourblind safe for everyone with
// no mode switch. Past 6 groups the colour repeats but the letter does not.
//
// Two low-key cues per group (calm, premium look):
//   • `badge` — the small letter chip (letter + soft tint + border). Also read by
//     the Stage-settings group chips (BuilderPage) and the Exclusive-groups modal.
//   • `accent` — a slim inline-start edge (`border-s-*`) shown on grouped task
//     cards only, so an ungrouped task stays a clean neutral card.
export interface GroupStyle {
  /** Letter chip: soft fill + border + legible text. */
  badge: string;
  /** Slim leading-edge accent for a grouped card (paired with `border-s-[3px]`). */
  accent: string;
}

export const GROUP_STYLES: readonly GroupStyle[] = [
  { badge: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/45', accent: 'border-s-cyan-400/55' },
  { badge: 'bg-amber-500/15 text-amber-200 border-amber-400/45', accent: 'border-s-amber-400/55' },
  { badge: 'bg-violet-500/15 text-violet-200 border-violet-400/45', accent: 'border-s-violet-400/55' },
  { badge: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/45', accent: 'border-s-emerald-400/55' },
  { badge: 'bg-pink-500/15 text-pink-200 border-pink-400/45', accent: 'border-s-pink-400/55' },
  { badge: 'bg-orange-500/15 text-orange-200 border-orange-400/45', accent: 'border-s-orange-400/55' },
] as const;
