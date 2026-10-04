// RushPoint's drawn icon set (change: no-stock-emoji): the shared drawings are well formed, stay on the
// 24x24 grid, and every stored reaction key has a drawing (so no reaction ever renders as nothing).
import { ICON_PATHS, ICON_NAMES, REACTION_ICON, reactionIcon } from '../packages/shared/src/iconPaths';
import { FEED_EMOJIS } from '../packages/shared/src/feedReactions';
import { REACTION_EMOJI } from '../packages/shared/src/reactions';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

check(`the set has icons (${ICON_NAMES.length})`, ICON_NAMES.length >= 80);
const empty = ICON_NAMES.filter((n) => !Array.isArray(ICON_PATHS[n]) || ICON_PATHS[n].length === 0);
check('every icon has at least one part', empty.length === 0, empty.join(','));

const badSyntax: string[] = [];
const offGrid: string[] = [];
for (const name of ICON_NAMES) {
  for (const part of ICON_PATHS[name]) {
    if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(part.d) || !/^M/.test(part.d)) badSyntax.push(name);
    // Absolute M/L/H/V coordinates must stay on the 24x24 grid (a small margin for round caps).
    for (const m of part.d.matchAll(/([MLHV])([-\d.\s,]+)/g)) {
      const nums = m[2].trim().split(/[\s,]+|(?=-)/).filter(Boolean).map(Number);
      if (nums.some((v) => !Number.isFinite(v) || v < -0.5 || v > 24.5)) offGrid.push(`${name}:${m[0].slice(0, 18)}`);
    }
  }
}
check('every path is valid SVG path syntax starting with a move', badSyntax.length === 0, [...new Set(badSyntax)].join(','));
check('absolute coordinates stay on the 24x24 grid', offGrid.length === 0, offGrid.slice(0, 6).join(' | '));

const allKeys = [...FEED_EMOJIS, ...REACTION_EMOJI] as string[];
const missing = allKeys.filter((k) => !(k in REACTION_ICON));
check(`every stored reaction key has a drawing (${allKeys.length} keys)`, missing.length === 0, missing.join(' '));
check('every reaction drawing exists in the set', Object.values(REACTION_ICON).every((n) => n in ICON_PATHS));
check('an unknown reaction key still draws something', reactionIcon('nonsense') === 'heart');

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
