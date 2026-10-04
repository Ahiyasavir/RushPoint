// Ordinary teams on the live maps never wear an alarm colour or the "followed" colour.
//
// Ahiya, 2026-09-30: red means distress on an ops map; a healthy team drawn red (the old palette had
// #ef4444, plus orange, yellow, pink and purple) contradicts that. See packages/shared/src/teamMarkerColor.ts.
import { readFileSync } from 'node:fs';
import { TEAM_MARKER_COLORS, teamMarkerColor } from '../packages/shared/src/teamMarkerColor';
import { FOLLOWED_MARKER_COLOR } from '../packages/shared/src/followedTeams';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

/** Hue in degrees and saturation 0..1 of a #rrggbb colour. */
function hsl(hex: string): { h: number; s: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s };
}

// Alarm hues: red, orange, amber, yellow (0..65) and pink/magenta back to red (300..360).
// Followed hue: indigo/violet (235..300). A near-grey (low saturation) has no hue to confuse.
const bad = TEAM_MARKER_COLORS.filter((c) => {
  const { h, s } = hsl(c);
  if (s < 0.2) return false;
  return h <= 65 || h >= 235;
});
check(`no ordinary team colour is red/orange/yellow/pink/purple (checked ${TEAM_MARKER_COLORS.length} colours)`, bad.length === 0, bad.join(','));
check('no ordinary team colour equals the followed colour', !TEAM_MARKER_COLORS.includes(FOLLOWED_MARKER_COLOR as never));
check('colours are distinct', new Set(TEAM_MARKER_COLORS).size === TEAM_MARKER_COLORS.length);
check('a team keeps its colour', teamMarkerColor('abc') === teamMarkerColor('abc'));
check('every id maps into the palette, junk included',
  ['a', 'NBQWywQJE0kj2cpnSI2MZ7casOSU', '', null as never].every((id) => (TEAM_MARKER_COLORS as readonly string[]).includes(teamMarkerColor(id))));

// Both maps draw from this one palette: neither keeps a private copy (the copy is how red got in).
for (const f of ['apps/creator-web/src/components/LiveTeamMap.tsx', 'apps/play-web/src/components/StaffTeamMap.tsx']) {
  const src = readFileSync(f, 'utf8');
  check(`${f} uses teamMarkerColor`, /teamMarkerColor/.test(src));
  check(`${f} keeps no private team palette`, !/const COLORS\s*=/.test(src));
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
