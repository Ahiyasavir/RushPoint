// The setup walk on a short window (Ahiya's zoomed laptop, 1000x457), as found by the deploy checks of
// 29.10: the plan's top was cut off and unreachable, mission cards were cut at the frame, the stage
// toast covered the step's heading, the "what is left" list repeated one mission per missing field,
// and the map credits opened across the map. A source scan cannot measure a rendered height, so these
// pin the structural decisions; the measurements live in scripts/audit-layout.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function ok(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const flow = src('apps/creator-web/src/components/SetupFlow.tsx');

ok('only a map screen or the finish is capped at the window height',
  /const fillsScreen = beat\.kind === 'finish' \|\| \(beat\.kind === 'item' && !!current && FILLS\.has\(current\.item\.fieldPath\)\)/.test(flow)
  && /className=\{`min-h-full flex flex-col \$\{fillsScreen \? 'walk:h-full' : ''\}`\}/.test(flow));
ok('the frame itself is not capped on other screens', /flex-1 \$\{fillsScreen \? 'walk:min-h-0' : ''\}/.test(flow));
ok('no unconditional walk:h-full wrapper is left', !/className="min-h-full walk:h-full flex flex-col"/.test(flow));
ok('the "what is left" list shows a mission once, with a count', /groups\.find\(\(x\) => x\.title === l\.title\)/.test(flow) && flow.includes('finishLeftCount'));
ok('the list is capped, with "and N more"', /groups\.slice\(0, FINISH_LIST_MAX\)/.test(flow) && flow.includes('finishLeftMore'));
ok('the stage toast moves off the heading on a short window', /\[@media\(max-height:560px\)\]:top-1\.5 z-\[80\]/.test(flow));
ok('the card label "במשימה הזאת הקבוצות" folds away on a short window', /text-\[--ink-3\] walk:\[@media\(max-height:560px\)\]:hidden">\{sf\.teamsWill\}/.test(flow));
for (const f of ['LocationPicker', 'RoutePreviewMap']) {
  ok(`${f} keeps the map credits folded`, /keepAttributionFolded\(map\.current\)/.test(src(`apps/creator-web/src/components/${f}.tsx`)));
}

console.log(failures === 0 ? '\n✅ setup walk short window: ALL PASS' : `\n❌ setup walk short window: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
