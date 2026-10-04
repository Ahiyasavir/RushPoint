// A count of ONE must read as one (found playing the Run Console, 2026-10-03).
//
// "1 קבוצות תקועות" sat at the top of the console's "needs you now" strip, and the
// same shape was everywhere a count is printed: "1 שלבים" on a dashboard card,
// "עוד 1 ריצות", "1 teams", "1 missions". Most strings were written as
// `${n} <plural>` with no singular, and in a small run ONE is the most common
// count there is.
//
// Rendered, not regexed: every function in BOTH apps' dictionaries is CALLED with
// a count of 1 (as `1`, `{ n: 1 }` and `{ count: 1 }`) in both languages, so the
// check sees the sentence a person reads. Exceptions are DECLARED with a reason,
// and a stale exception fails, so the list can only shrink.
import { translations as CREATOR } from '../apps/creator-web/src/i18n';
import { translations as PLAY } from '../apps/play-web/src/i18n';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`); }
};

// Hebrew: a bare "1" right before a Hebrew word ("1 קבוצות"). The house style
// is the word ("קבוצה אחת"), so any 1-then-word is flagged unless declared.
const HE_ONE_THEN_WORD = /(^|\s|\+)1 [֐-׿]/;
// English: a plural noun within two words of the 1 ("1 teams", "1 new chats").
// Verbs ending in s (is, has, needs) and -ss words (distress) are not plurals.
const EN_PLURAL_AFTER_ONE = /\b1 (?:[a-z]+ )?(?!(?:is|has|was|does|needs|requires|comes)\b)[a-z]*[^s\W]s\b/i;

/** Declared exceptions: `<app>.<lang>.<path>` → why it is fine at 1. */
const ALLOWED: Record<string, string> = {
  'creator.he.adminLive.cameraLabel': 'a rating, "1 מתוך 5"',
  'creator.he.builder.difficultyAriaLabel': 'a rating, "קושי 1 מתוך 10"',
  'creator.he.gallery.valDiff': 'a rating, "1 מתוך 10"',
  'creator.he.wallet.freeRunsValue': 'a fraction, "1 מתוך 3"',
  'creator.he.adminUsers.truncatedNotice': 'shown only when the list is cut at its page size, never 1',
  'creator.he.runHistory.truncated': 'shown only when the list is cut at its page size, never 1',
  'creator.he.builder.dndCancelled': 'the argument is a mission title, not a count',
  'creator.he.builder.dndDropped': 'the argument is a mission title, not a count',
  'creator.he.builder.noConfigNote': 'the argument is a task type label, not a count',
  'creator.he.settings.addPasswordDesc': 'the argument is an e-mail address',
  'creator.he.settings.linkGoogleDesc': 'the argument is an e-mail address',
  'creator.he.builder.pacingAriaLabel': 'already singular ("לאורך 1 משימה" reads as one mission)',
  'creator.he.builder.moreTags': '"+1 תגית" is already singular',
  'creator.he.gallery.moreTags': '"+1 תגית" is already singular',
  'play.he.promo.moreTags': '"+1 תגית" is already singular',
  'creator.he.builder.rows.hintOn': 'an abbreviation, "נק׳"',
  'creator.en.builder.rows.hintOn': 'an abbreviation, "pts"',
  'creator.he.builder.rows.pointsValue': 'an abbreviation, "נק׳"',
  'creator.en.builder.rows.pointsValue': 'an abbreviation, "pts"',
  'creator.he.builder.rows.moreDurationItem': 'an abbreviation, "דק׳"',
  'creator.he.builder.rows.opensAfterStart': 'an abbreviation, "דק׳"',
  'creator.he.builder.rows.timeLimitMinutes': 'an abbreviation, "דק׳"',
  'creator.he.dashboard.wizard.minutesShort': 'an abbreviation, "דק׳"',
  'creator.he.gallery.metaPts': 'an abbreviation, "נק׳"',
  'creator.en.gallery.metaPts': 'an abbreviation, "pts"',
  'creator.he.runConsole.flashV2.minutesLeft': 'an abbreviation, "דק׳"',
  'creator.he.runConsole.inbox.hours': 'an abbreviation, "שע׳"',
  'creator.he.runReport.minutes': 'an abbreviation, "דק׳"',
  'creator.he.runReport.points': 'an abbreviation, "נק׳"',
  'creator.en.runReport.points': 'an abbreviation, "pts"',
  'creator.he.sharedGame.minutes': 'an abbreviation, "דק׳"',
  'play.he.task.choicePoints': 'an abbreviation, "נק׳"',
  'play.en.task.choicePoints': 'an abbreviation, "pts"',
  'creator.he.hostSheet.radius': '"ברדיוס 1 מטר" reads naturally and a 1 m radius is never authored',
  'creator.he.builder.safeZoneRadiusInvalid': 'the argument is the maximum radius, thousands of metres',
  'creator.en.builder.safeZoneRadiusInvalid': 'the argument is the maximum radius, thousands of metres',
  'creator.he.dashboard.deleteDialogRecoverable': 'the argument is the 30 day trash window',
  'creator.en.dashboard.deleteDialogRecoverable': 'the argument is the 30 day trash window',
  'creator.he.trash.subtitle': 'the argument is the 30 day trash window',
  'creator.en.trash.subtitle': 'the argument is the 30 day trash window',
  'creator.he.dashboard.wizard.longerThanAsked': 'shown only when the game runs LONGER than asked, many minutes',
  'creator.en.dashboard.wizard.longerThanAsked': 'shown only when the game runs LONGER than asked, many minutes',
  'creator.he.landing.trustFreePlayers': 'the argument is the free tier cap, never 1',
  'creator.en.landing.trustFreePlayers': 'the argument is the free tier cap, never 1',
  'creator.he.wallet.packageMaxP': 'the argument is a package size, never 1',
  'creator.en.wallet.packageMaxP': 'the argument is a package size, never 1',
  'play.he.play.streak': 'shown from a streak of 2 up',
};

const seen = new Set<string>();
const offenders: string[] = [];
let rendered = 0;
function walk(node: unknown, path: string, app: string, lang: 'he' | 'en'): void {
  if (typeof node === 'function') {
    for (const arg of [1, { n: 1 }, { count: 1 }]) {
      let out = '';
      try { out = String((node as (a: unknown) => unknown)(arg)); } catch { continue; }
      if (out.includes('[object') || out.includes('undefined')) continue;
      rendered++;
      const bad = lang === 'he' ? HE_ONE_THEN_WORD.test(out) : EN_PLURAL_AFTER_ONE.test(out);
      const id = `${app}.${lang}.${path}`;
      if (bad) {
        if (id in ALLOWED) seen.add(id);
        else offenders.push(`${id} → ${out.slice(0, 80)}`);
      }
      return;
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, app, lang);
  }
}

console.log('\ncounts read right at one');
for (const lang of ['he', 'en'] as const) {
  walk(CREATOR[lang], '', 'creator', lang);
  walk(PLAY[lang], '', 'play', lang);
}
check(`the dictionaries were really rendered (${rendered} functions)`, rendered > 300, rendered);
check('no count reads as a plural at one', offenders.length === 0, offenders);
const stale = Object.keys(ALLOWED).filter((k) => !seen.has(k));
check('no stale exception', stale.length === 0, stale);

console.log(failures === 0 ? '\n✅ counts at one: ALL PASS' : `\n❌ counts at one: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
