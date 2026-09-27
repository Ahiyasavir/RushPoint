// The console shows clips as posters, not as videos (change: video-upload-speed, D7).
// A console of 35 clips with preload="metadata" asks for 35 video byte ranges before anyone
// presses play; a poster is one ~30 KB picture each. One component carries the rule.
//   npx tsx scripts/test-clip-tile.ts
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { clipLengthLabel, clipPreload } from '../apps/creator-web/src/lib/clipTile';
import { buildTeamDossier } from '../apps/creator-web/src/lib/teamDossier';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

check('with a poster nothing is preloaded', clipPreload('https://x/p.jpg') === 'none');
check('without a poster, metadata (the old behaviour, so older clips still show a frame)', clipPreload('') === 'metadata' && clipPreload(undefined) === 'metadata');
check('12.3 s reads 0:12', clipLengthLabel(12.3) === '0:12');
check('65 s reads 1:05', clipLengthLabel(65) === '1:05');
check('0.4 s reads 0:01 (never 0:00 for a real clip)', clipLengthLabel(0.4) === '0:01');
for (const bad of [null, undefined, 0, -3, NaN, Infinity]) check(`no badge for ${String(bad)}`, clipLengthLabel(bad as never) === null);

// Every console surface goes through the component.
for (const f of ['apps/creator-web/src/pages/RunConsolePage.tsx', 'apps/creator-web/src/components/TeamPage.tsx']) {
  const src = readFileSync(join(repo, f), 'utf8');
  const raw = src.match(/<video\b/g) ?? [];
  check(`${f}: no bare <video> (${raw.length} found), every clip is a <ClipTile>`, raw.length === 0);
}
const tile = readFileSync(join(repo, 'apps/creator-web/src/components/ClipTile.tsx'), 'utf8');
check('ClipTile passes the poster and derives preload from it', /poster=\{/.test(tile) && /preload=\{clipPreload\(/.test(tile));

// The team page carries the poster and the length through.
const d = buildTeamDossier({
  taskTitle: (id: string) => id, stageTitle: (n: number) => `S${n}`, nowMs: Date.parse('2026-09-26T10:05:00Z'),
  teamDoc: { id: 't1', displayName: 'Wolves', stages: [], taskSubmissions: { v1: { photoUrl: 'https://api.rush-point.com/uploads/runs/r/teams/t1/v.webm', mediaKind: 'video', posterUrl: 'https://api.rush-point.com/uploads/runs/r/teams/t1/p.jpg', mediaDurationSec: 12.3, status: 'pending', submittedAt: '2026-09-26T10:00:00Z' } } },
} as never);
const m = d?.media?.[0];
check('the dossier media row carries poster and length', m?.posterUrl === 'https://api.rush-point.com/uploads/runs/r/teams/t1/p.jpg' && m?.durationSec === 12.3, JSON.stringify(m));

console.log(failures === 0 ? '\nclip tile: all passed' : `\nclip tile: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
