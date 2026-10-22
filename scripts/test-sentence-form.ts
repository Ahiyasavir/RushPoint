// Fill-in-the-sentence setup (change: composer-v2-sentence-setup).
//
// The founder: "שזה ישאל אותו ממש תשלים את המשפט". 17 bank missions asked the creator to edit a text
// holding "[הוראות ליוצר: ...]". Now the editor shows the sentence the players will read, with a blank
// where the bracket was and the bracket's own words as the example in it. The pure half: parse a
// template into text and blanks, fill it, and read the blanks back out of an edited text.
//   npx tsx scripts/test-sentence-form.ts
import {
  parseSentence, hasOpenSlots, fillTemplate, extractSlotValues, generateCode,
} from '../apps/creator-web/src/lib/sentenceForm';
import { isPlaceholderValue } from '@rushpoint/shared';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const T = 'תנווטו למקום ש[הוראות ליוצר: הרמז, בלי שם המקום].';
const parts = parseSentence(T);
ok('a template splits into text and one blank', parts.length === 3 && parts[0].kind === 'text' && parts[1].kind === 'slot' && parts[2].kind === 'text');
ok('the blank carries the bracket\'s own words as its example', parts[1].kind === 'slot' && parts[1].hint === 'הרמז, בלי שם המקום');
ok('the text around it is kept exactly', parts[0].kind === 'text' && parts[0].text === 'תנווטו למקום ש' && parts[2].kind === 'text' && parts[2].text === '.');
ok('open slots are detected', hasOpenSlots(T) && !hasOpenSlots('תנווטו למקום שיש בו מזרקה.'));

const filled = fillTemplate(T, ['יש בו מזרקה עם שלושה דגים']);
ok('filling writes the sentence players read', filled === 'תנווטו למקום שיש בו מזרקה עם שלושה דגים.');
ok('a filled sentence is no longer a placeholder for Quick Setup', !isPlaceholderValue(filled) && isPlaceholderValue(T));
ok('an empty value keeps the bracket, so the step stays open', fillTemplate(T, ['']) === T && fillTemplate(T, []) === T);
ok('values are read back out of the edited text', JSON.stringify(extractSlotValues(T, filled)) === JSON.stringify(['יש בו מזרקה עם שלושה דגים']));
ok('an untouched template reads back as empty', JSON.stringify(extractSlotValues(T, T)) === JSON.stringify(['']));
ok('a text rewritten by hand no longer matches (the form steps aside)', extractSlotValues(T, 'משהו אחר לגמרי') === null);

const TWO = 'בכיכר הזאת מסתובב הסוכן שלנו: [הוראות ליוצר: שלושה סימנים מזהים]. תגידו לו "[הוראות ליוצר: הסיסמה]".';
const two = fillTemplate(TWO, ['כובע ירוק וספר ביד', 'הציפור עפה בחצות']);
ok('two blanks fill in order', two === 'בכיכר הזאת מסתובב הסוכן שלנו: כובע ירוק וספר ביד. תגידו לו "הציפור עפה בחצות".');
ok('two blanks read back in order', JSON.stringify(extractSlotValues(TWO, two)) === JSON.stringify(['כובע ירוק וספר ביד', 'הציפור עפה בחצות']));
ok('one filled, one open', JSON.stringify(extractSlotValues(TWO, fillTemplate(TWO, ['כובע', '']))) === JSON.stringify(['כובע', '']));
ok('regex characters in the text are literal', JSON.stringify(extractSlotValues('מה (1+1)? [הוראות ליוצר: x]', 'מה (1+1)? 2')) === JSON.stringify(['2']));
ok('organizer brackets are blanks too', hasOpenSlots('המארגן ב[הוראות למארגן: איפה בערך].'));
ok('a plain bracket that is not addressed to the creator is text', !hasOpenSlots('תמונה [1] מתוך 3'));
ok('garbage never throws', [null, undefined, 42, {}].every((g) => {
  try { return parseSentence(g as never).length === 0 && !hasOpenSlots(g as never) && extractSlotValues(g as never, g as never) === null; } catch { return false; }
}));

// Every bank mission that asks the creator to complete its text uses the one grammar.
const bracketed = TASK_BANK.map((e) => { try { return e.build(); } catch { return null; } })
  .filter((t): t is NonNullable<typeof t> => !!t && typeof t.description === 'string' && /\[[^\]]+\]/.test(t.description));
const stray = bracketed.filter((t) => !hasOpenSlots(t.description!));
ok('every bracket in a bank description is a creator blank', stray.length === 0, stray.map((t) => t.title).join(', '));
ok('the bank has sentence-form missions to fill', bracketed.length >= 10, `${bracketed.length}`);

// Codes.
const codes = Array.from({ length: 200 }, (_, i) => generateCode(() => ((i * 7919) % 1000) / 1000));
ok('a generated code is four digits', codes.every((c) => /^\d{4}$/.test(c)));
ok('a generated code is never a guessable one', codes.every((c) => !['0000', '1111', '1234', '4321', '1212'].includes(c) && new Set(c).size >= 3));
ok('garbage rng still yields a code', /^\d{4}$/.test(generateCode(() => NaN)));

console.log(failures === 0 ? '\n✅ sentence form: ALL PASS' : `\n❌ sentence form: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
