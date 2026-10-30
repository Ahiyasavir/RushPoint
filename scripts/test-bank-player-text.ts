// What a player reads from a bank mission is player text: one language, and never a note to the
// creator (found 29.10: "המפתח החבוי" sold teams a paid hint that was advice to the creator about
// writing the clue, in Hebrew and English).
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}
// Latin words a player may legitimately read, each with its reason.
const ALLOWED_LATIN: Record<string, string> = {
  'Freeze Frame': 'the name of the format, glossed in Hebrew beside it',
};
const FIELDS = ['title', 'description', 'hint', 'locationClue'] as const;
const latin: string[] = [];
const twoLanguages: string[] = [];
const toCreator: string[] = [];
let checked = 0;
for (const e of TASK_BANK) {
  const t = e.build() as unknown as Record<string, unknown>;
  for (const k of FIELDS) {
    const v = t[k];
    if (typeof v !== 'string' || v.trim() === '') continue;
    checked++;
    let rest = v;
    for (const w of Object.keys(ALLOWED_LATIN)) rest = rest.split(w).join('');
    if (/[A-Za-z]{3,}/.test(rest)) latin.push(`${e.key}.${k}`);
    if (/\n\n(Hint|Note|Write|Tip)\b/.test(v)) twoLanguages.push(`${e.key}.${k}`);
    // A hint speaks to the team; advice on how to WRITE something is for the creator.
    if (k === 'hint' && /(עובדות יותר טוב|כדאי לכתוב|תכתבו רמז|ממשפטים ארוכים)/.test(v)) toCreator.push(`${e.key}.${k}`);
  }
}
ok(`player text checked (${checked} fields)`, checked > 300, checked);
ok('no English in what players read, bar the declared names', latin.length === 0, latin);
ok('no field carries a second language after a blank line', twoLanguages.length === 0, twoLanguages);
ok('no hint is a note to the creator', toCreator.length === 0, toCreator);
const hk = TASK_BANK.find((e) => e.key === 'the-hidden-key')?.build();
ok('the hidden key sells no hint', !!hk && !hk.hint && !hk.hintPenalty);

console.log(failures === 0 ? '\n✅ bank player text: ALL PASS' : `\n❌ bank player text: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
