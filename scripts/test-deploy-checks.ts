// The deploy checklist format (scripts/lib/deployChecks.mjs). Every production deploy ships one
// PDF in the same template, so the parser is pinned: the four parts in a fixed order, checks and
// tables counted on the cover, an unknown part refused instead of silently dropped.
//   npx tsx scripts/test-deploy-checks.ts
// @ts-expect-error: plain .mjs module without types
import { parseChecks, countChecks, frontMatter, renderHtml, inline } from './lib/deployChecks.mjs';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || detail === undefined ? '' : `  → ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
}

const SRC = `---
title: בדיקות אחרי דיפלויי
deploy: 2026-10-05
commit: abc1234
---
# מה השתנה
- שינוי אחד
# בטלפון
## צילום
- [ ] מצלמה בתוך האפליקציה
  - [ ] החלפה בין קדמית לאחורית
- [x] כבר נבדק
# במחשב
## חובה
| # | בדיקה |
|---|---|
| 1 | מתחברים |
| 2 | מצטרפים |
פסקה ראשונה
שממשיכה כאן.
# בדיקות מיוחדות
- [ ] מצב טיסה
`;

const { meta, body } = frontMatter(SRC);
ok('front matter is read', meta.deploy === '2026-10-05' && meta.commit === 'abc1234', meta);
const parts = parseChecks(body);
ok('parts come out in the template order: computer, phone, special, changes',
  parts.map((p: { id: string }) => p.id).join(',') === 'computer,phone,special,changes', parts.map((p: { id: string }) => p.id));
const phone = parts.find((p: { id: string }) => p.id === 'phone');
const items = phone.sections[0].blocks[0].items;
ok('checks keep their depth', items[0].depth === 0 && items[1].depth === 1 && items[1].check === true);
ok('a ticked check is done', items[2].done === true);
const computer = parts.find((p: { id: string }) => p.id === 'computer');
const table = computer.sections[0].blocks[0];
ok('a table keeps its header and skips the --- row', table.kind === 'table' && table.head.length === 2 && table.rows.length === 2, table);
const para = computer.sections[0].blocks[1];
ok('consecutive lines join into one paragraph', para.kind === 'p' && para.text === 'פסקה ראשונה שממשיכה כאן.', para);
const counts = countChecks(parts);
ok('the cover counts open checks and table rows per part',
  counts.computer === 2 && counts.phone === 2 && counts.special === 1, counts);

let threw = '';
try { parseChecks('# סתם חלק\n- [ ] x\n'); } catch (e) { threw = String(e); }
ok('an unknown part is refused, not dropped', /unknown part/.test(threw), threw);
ok('inline escapes HTML before formatting', inline('<b>**חשוב**</b> `npm`') === '&lt;b&gt;<strong>חשוב</strong>&lt;/b&gt; <code>npm</code>', inline('<b>**חשוב**</b> `npm`'));

const html = renderHtml(SRC);
ok('the document is Hebrew right to left', /<html lang="he" dir="rtl">/.test(html));
ok('each part after the first starts a new page', /\.part \{ break-before: page; \}/.test(html));
ok('the changes report is the last part', html.lastIndexOf('class="part changes"') > html.lastIndexOf('class="part special"'));

console.log(failures === 0 ? '\n✅ deploy checks: ALL PASS' : `\n❌ deploy checks: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
