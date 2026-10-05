// One voice in Hebrew (change: hebrew-one-voice).
//
// The copy spoke in two voices: newer strings address the reader in the plural ("לחצו",
// "שלכם"), older ones address one man ("התחל לבנות", "הקלד את שם המשחק", "בדוק את תיבת הדואר
// שלך", "משחקים שמחקת"). Every Hebrew SENTENCE (four words or more) in both apps now speaks in
// the plural or impersonally; short labels such as a "שמור" button keep their form.
//
// Rendered, not regexed over source: both Hebrew dictionaries are walked and function entries
// CALLED with sample arguments, so the check reads the sentence a person reads.
import { translations as CREATOR } from '../apps/creator-web/src/i18n';
import { translations as PLAY } from '../apps/play-web/src/i18n';

// A masculine-singular imperative at a word start. Not in the list: "עבור" (almost always the
// preposition "for") and "מלא" (almost always the adjective "full").
const SING_VERB = /(^|[\s"'(])(גלה|העתק|לחץ|בחר|הוסף|צור|שמור|ערוך|מחק|גרור|הזן|הקלד|סמן|פתח|שתף|נסה|התחל|הפעל|שלח|חפש|הורד|עדכן|בדוק|המתן|אשר|השתמש|הירשם|היכנס|צא|קרא|ודא|הקש|העלה|ייבא|שחק|תן|קח|בוא|הכנס|הגדר|הצג|הסתר|שנה|כתוב|הסר|נקה|השאר|עצב|הפוך|עיין|אפס|פנה|הגדל|בנה|השק|צפה|הירגע|התכונן|ראה|נהל|טען|עקוב|פדה|קבל|תרוץ|הוספת)(\s|$|[.,:!?])/;
// A singular second person: a possessive or object suffix, or a second-person past. ("הוספת" is
// in SING_VERB instead: on a short button it is the noun "adding", in a sentence it is "you added".)
// Checked at every length, see walk().
const SING_YOU = /(^|[\s"'(])(שלך|עליך|אותך|ממך|בשבילך|חשבונך|שמך|אתה|לך|שכחת|שמחקת|התחברת|הוזמנת|יצרת|בחרת)(\s|$|[.,:!?])/;

/** Hits that are other grammar, by `<app>.<path>`, each with its reason. */
const OTHER_GRAMMAR: Record<string, string> = {
  'creator.runConsole.shareIntro': '"כתוב" here is "is written" (a passive), not an order',
  'creator.runConsole.panel.shareScreens.help': '"כתוב" here is "is written" (a passive), not an order',
  'play.play.forceAssigned': '"הצוות שלח אתכם" is past tense: the staff sent you',
  'creator.builder.completionStoredUnreachable': '"השלב שמור" is "the stage is saved", not an order',
  'creator.adminTemplates.importHint': '"קובץ משחק שמור" is "a saved game file"',
  'creator.adminMissionBank.noCreateHint': '"הוספת משימה" is the noun "adding a mission"',
  'creator.sharedGame.readOnlyHelp': '"היוצר בנה אותו" is past tense: the creator built it',
};

const SAMPLES: unknown[] = [{ n: 2, count: 2, title: 'X', name: 'X', team: 'X', email: 'a@b.c', code: 'X', teams: 'X', label: 'X' }, 2, 'X'];

let examined = 0;
const hits: string[] = [];
const seen = new Set<string>();
function walk(node: unknown, path: string, app: string): void {
  let s: string | null = null;
  if (typeof node === 'string') s = node;
  else if (typeof node === 'function') {
    for (const a of SAMPLES) {
      try { const r = (node as (x: unknown) => unknown)(a); if (typeof r === 'string') { s = r; break; } } catch { /* next */ }
    }
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, app);
    return;
  }
  if (!s) return;
  // A short label may keep a singular verb ("שמור"), but a singular "you" is address at any
  // length: "אין לך חשבון?" and "התגים שלך" are three and two words (found live 2026-10-05).
  const sentence = s.trim().split(/\s+/).length >= 4;
  if (sentence) examined++;
  if (!SING_YOU.test(s) && !(sentence && SING_VERB.test(s))) return;
  const id = `${app}.${path}`;
  if (id in OTHER_GRAMMAR) { seen.add(id); return; }
  hits.push(`${id} → ${s.slice(0, 90)}`);
}

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}\n    ${Array.isArray(detail) ? detail.join('\n    ') : JSON.stringify(detail)}`); }
};

console.log('\nHebrew speaks in one voice');
walk(CREATOR.he, '', 'creator');
walk(PLAY.he, '', 'play');
check(`the dictionaries were really read (${examined} Hebrew sentences)`, examined > 400, examined);
check('no Hebrew sentence addresses one man', hits.length === 0, hits);
const stale = Object.keys(OTHER_GRAMMAR).filter((k) => !seen.has(k));
check('no stale other-grammar exception', stale.length === 0, stale);

console.log(failures === 0 ? '\n✅ hebrew voice: ALL PASS' : `\n❌ hebrew voice: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
