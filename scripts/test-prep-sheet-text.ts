// The before-the-game sheet keeps the work in the field and drops "type it here" (found 29.10: the
// sheet printed "תכתבו כאן את המילה" and "תסמנו כאן את הקיר", with no "here" to type into).
import { readFileSync } from 'node:fs';
import { prepSheetText, beforeGameList, codeNeedsSign } from '../apps/creator-web/src/lib/setupFlow';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { isPrepInstruction } from '../apps/creator-web/src/lib/setupFlow';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}
ok('a closing "type it here" sentence is dropped',
  prepSheetText('תלפפו רצועת נייר סביב העמוד ותתלו אותה. תכתבו כאן את המילה.') === 'תלפפו רצועת נייר סביב העמוד ותתלו אותה.');
ok('a "and write here" clause is dropped from its sentence',
  prepSheetText('תחביאו חפץ אחד שלא שייך למקום, ותכתבו כאן רמז אחד בלבד עליו.') === 'תחביאו חפץ אחד שלא שייך למקום.');
ok('"mark the wall here" is dropped', prepSheetText('תדביקו על קיר פתק דביק בגובה 2 מטר. תסמנו כאן את הקיר.') === 'תדביקו על קיר פתק דביק בגובה 2 מטר.');
ok('writing in the field stays (chalk is real work)', prepSheetText('תכתבו בגיר כל ספרה של הקוד במקום אחר.') === 'תכתבו בגיר כל ספרה של הקוד במקום אחר.');
ok('an instruction that is only "type here" is kept rather than emptied', prepSheetText('תכתבו כאן את המילה.') === 'תכתבו כאן את המילה.');
ok('"replace the brackets" is an in-app instruction too',
  prepSheetText('תדביקו מעטפה ליד ציון דרך בנקודה. תחליפו את הסוגריים בציון הדרך.') === 'תדביקו מעטפה ליד ציון דרך בנקודה.');
ok('garbage is empty, never a throw', prepSheetText(undefined as unknown as string) === '');

// Over the real bank: no sheet line still tells the reader to type or mark "here".
const left: string[] = [];
let checked = 0;
for (const e of TASK_BANK) for (const st of e.setup ?? []) {
  if (!isPrepInstruction(st.prompt)) continue;
  checked++;
  const he = String(st.prompt).split('\n\n')[0];
  const out = prepSheetText(he);
  if (/(?:תכתבו|תסמנו|תרשמו)\s+(?:כאן|פה)/.test(out) && out !== he.trim()) left.push(`${e.key}: ${out}`);
  if (/(?:^|[\s,])ו?(?:תכתבו|תסמנו)\s+כאן/.test(out) && out !== he.trim()) left.push(`${e.key}: ${out}`);
}
ok(`no bank preparation keeps a "here" on the sheet (${checked} checked)`, checked > 30 && left.length === 0, left.slice(0, 5));
// Two preparations of one mission are one entry on the sheet (29.10: "תיבת המת" was listed twice).
const item = (stepId: string, instruction: string) => ({ stepId, kind: 'prep', instruction }) as never;
const merged = beforeGameList([
  { taskId: 't1', title: 'תיבת המת', items: [item('a', 'תדביקו מעטפה.'), item('b', 'תתאמו עם מישהו.')] },
  { taskId: 't2', title: 'אחרת', items: [item('c', 'תבנו מגדל.')] },
] as never);
ok('one mission with two preparations is one entry', merged.length === 2 && merged[0].text === 'תדביקו מעטפה. תתאמו עם מישהו.', merged);
// A code sign at the point only when nothing else says how the code reaches the teams (29.10: the
// sheet told the organizer to post "תיבת המת"'s code at its start, which is the answer).
const codeSteps = TASK_BANK.flatMap((e) => (e.setup ?? []).filter((st) => st.field === 'smart.secretCode').map((st) => ({ key: e.key, he: String(st.prompt).split('\n\n')[0] })));
const signed = codeSteps.filter((c) => codeNeedsSign(c.he)).map((c) => c.key);
ok(`no bank code mission gets a sign at its point (${codeSteps.length} checked)`, codeSteps.length >= 5 && signed.length === 0, signed);
ok('a plain station code with no delivery still gets its sign', codeNeedsSign('') && codeNeedsSign('תקבעו קוד לתחנה.'));
const flow = readFileSync('apps/creator-web/src/components/SetupFlow.tsx', 'utf8');
ok('the prep sheet asks codeNeedsSign before adding a sign', /codeNeedsSign\(/.test(flow));
const src = readFileSync('apps/creator-web/src/lib/setupFlow.ts', 'utf8');
ok('beforeGameList uses prepSheetText', /const text = prepSheetText\(i\.instruction\)/.test(src));

console.log(failures === 0 ? '\n✅ prep sheet text: ALL PASS' : `\n❌ prep sheet text: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
