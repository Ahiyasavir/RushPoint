// A blank written on the admin mission page is a blank (found 23.10).
//
// The founder writes a blank the natural way, as a plain bracket ("מ [נקודה ראשונה] ל [נקודה שניה]").
// Only the marked form ("[הוראות ליוצר: ...]") is a blank to the setup walk and to Quick Setup's
// "done yet?" check, so in production four missions he edited shipped their bracket to players and
// never asked the creator for it. `asCreatorBlanks` marks a plain bracket, and the overlay runs it on
// every admin title and description.
import { asCreatorBlanks, hasOpenSlots } from '../apps/creator-web/src/lib/sentenceForm';
import { applyBankOverrides, normalizeBankOverride } from '../apps/creator-web/src/lib/missionBankOverlay';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { isPlaceholderValue } from '@rushpoint/shared';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}

console.log('\nadmin blanks');
const his = 'כמה צעדים לוקח לכם להגיע מ [נקודה ראשונה] ל [נקודה שניה]';
const marked = asCreatorBlanks(his);
ok('a plain Hebrew bracket becomes a creator blank', marked === 'כמה צעדים לוקח לכם להגיע מ [הוראות ליוצר: נקודה ראשונה] ל [הוראות ליוצר: נקודה שניה]', marked);
ok('the marked text is a sentence to complete', hasOpenSlots(marked));
ok('and Quick Setup counts it as not done yet', isPlaceholderValue(marked));
ok('the plain one was neither (the bug)', !hasOpenSlots(his) && !isPlaceholderValue(his));
ok('an already marked bracket is left exactly as it is', asCreatorBlanks('לכו ל[הוראות ליוצר: הדוכן] עכשיו') === 'לכו ל[הוראות ליוצר: הדוכן] עכשיו');
ok('an English bracket gets the English marker', asCreatorBlanks('Go to [the stall]') === 'Go to [creator: the stall]');
ok('an empty bracket and text with none are untouched', asCreatorBlanks('a [] b') === 'a [] b' && asCreatorBlanks('בלי סוגריים') === 'בלי סוגריים');
ok('junk does not throw', asCreatorBlanks(undefined as never) === undefined);

const row = normalizeBankOverride({ key: 'how-many-steps', description: his, title: 'כמה צעדים' });
ok('the overlay marks an admin description', row?.description === marked, row);

const overlaid = applyBankOverrides(TASK_BANK, [{ key: 'vendor-secret-code', description: 'לכו ל [להכניס את המקום] ובקשו מיץ גזר עם לימון. תקבלו איתו קוד, הקלידו אותו כאן.' }]).entries;
const vendor = overlaid.find((e) => e.key === 'vendor-secret-code')?.build();
ok('the live mission asks the creator for the place', !!vendor && hasOpenSlots(vendor.description), vendor?.description);

// The authored bank itself never uses a bracket meant for players, which is what makes the rule safe.
const bare = TASK_BANK.flatMap((e) => {
  const t = e.build();
  return (['title', 'description', 'hint', 'locationClue'] as const).flatMap((f) =>
    (String((t as unknown as Record<string, unknown>)[f] ?? '').match(/\[[^\]]*\]/g) ?? [])
      .filter((x) => asCreatorBlanks(x) !== x).map((x) => `${e.key}.${f}: ${x}`));
});
ok('no bracket in the authored bank is a plain one', bare.length === 0, bare.slice(0, 5));

console.log(failures === 0 ? '\n✅ admin blanks: ALL PASS' : `\n❌ admin blanks: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
