// The colour of an ordinary team's dot on every live map (the run console and the staff app).
//
// Both maps used to carry their own copy of an 8-colour palette that included red, orange, yellow,
// pink and purple. On an ops map red and amber are the ALARM colours (SOS, out of bounds, waiting for
// you; ISA-101), so a healthy team drawn red read as a team in trouble; and purple is the "followed
// team" colour (FOLLOWED_MARKER_COLOR), so a purple stranger read as one of mine. Ordinary teams now
// draw only from calm hues, declared once here. scripts/test-team-marker-color.ts pins the rule.

export const TEAM_MARKER_COLORS = [
  '#16a34a', // green
  '#2563eb', // blue
  '#0d9488', // teal
  '#0891b2', // cyan
  '#65a30d', // lime
  '#475569', // slate
  '#78716c', // stone
] as const;

/** A stable calm colour per team id (the same team keeps its colour across reloads and apps). */
export function teamMarkerColor(teamId: string): string {
  const id = typeof teamId === 'string' ? teamId : '';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TEAM_MARKER_COLORS[Math.abs(h) % TEAM_MARKER_COLORS.length];
}
