// The player's game screen on a computer (change: desktop-layouts-play-staff): map and mission
// side by side, the mission in its own scrolling column with no drawer, decided by ONE query.
// Source assertions: play-web has no component test runner.
//   npx tsx scripts/test-wide-layout.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const hook = read('apps/play-web/src/lib/useWideLayout.ts');
ok('one hook, one query', /export const WIDE_LAYOUT_QUERY = '\(min-width: 1024px\)'/.test(hook) && /export function useWideLayout\(\)/.test(hook));

const play = read('apps/play-web/src/screens/PlayScreen.tsx');
ok('the game screen asks the hook', /const wide = useWideLayout\(\)/.test(play));
ok('wide: the mission is a plain scrolling column, not the drawer', /if \(wide\) \{[\s\S]{0,500}data-testid="mission-column"[\s\S]{0,300}\}\s*return locationRelevant/.test(play));
// The mission is what the player reads first, so it sits at the START of the reading direction
// (right in Hebrew, left in English) even though the map pane comes first in the DOM.
ok('wide: the mission column leads the reading direction', /className="order-first [^"]*" data-testid="mission-column"/.test(play));
ok('wide: the map reserves no space for a sheet', /bottomInset=\{wide \? 0 : sheetHeight\}/.test(play));
ok('the game screen is told it is wide', /<GameScreen wide=\{wide\}>/.test(play));

const ui = read('apps/play-web/src/components/ui.tsx');
ok('GameScreen widens only when told, never by a breakpoint', /export function GameScreen\(\{ children, wide = false \}/.test(ui) && !/GameScreen[\s\S]{0,400}lg:max-w/.test(ui));

console.log(failures === 0 ? '\n✅ wide layout: ALL PASS' : `\n❌ wide layout: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
