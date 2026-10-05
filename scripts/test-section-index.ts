// The run console's section index (change: console-section-index). Ahiya, 2026-10-05: the
// "שיתוף והגדרות" tab "goes to the regular QR and not to the right thing". The section held the join
// code, the event's phone numbers, the station QR sheet, the screens and the staff codes, and opened
// on the first with nothing saying the rest existed. A section of 3+ panels now starts with an index.
//   npx tsx scripts/test-section-index.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sectionIndexPanels, SECTION_INDEX_MIN_PANELS } from '../apps/creator-web/src/lib/runConsoleLayout';
import { translations } from '../apps/creator-web/src/i18n';

let failures = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || detail === undefined ? '' : `  → ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
};

ok('three or more panels get an index', SECTION_INDEX_MIN_PANELS === 3);
ok('the index keeps the drawn order', JSON.stringify(sectionIndexPanels(['joinShare', 'stationQr', 'shareScreens', 'staffInvite'])) === JSON.stringify(['joinShare', 'stationQr', 'shareScreens', 'staffInvite']));
ok('two panels: no index', sectionIndexPanels(['joinShare', 'staffInvite']).length === 0);
ok('nothing: no index, no throw', sectionIndexPanels(undefined).length === 0 && sectionIndexPanels(null).length === 0);

const page = readFileSync(path.resolve(__dirname, '../apps/creator-web/src/pages/RunConsolePage.tsx'), 'utf8');
ok('the section pane renders the index and each entry goes to its panel',
  /sectionIndexPanels\(sectionPanels\)/.test(page) && /onClick=\{\(\) => goToPanel\(p\)\}/.test(page));
ok('the tab no longer promises settings it does not hold',
  translations.he.runConsole.groupShare === 'שיתוף וצוות' && translations.en.runConsole.groupShare === 'Sharing and staff',
  [translations.he.runConsole.groupShare, translations.en.runConsole.groupShare]);

console.log(failures === 0 ? '\n✅ section index: ALL PASS' : `\n❌ section index: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
