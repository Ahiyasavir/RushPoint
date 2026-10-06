// The Quick Setup step card leads with the action (change: quick-setup-card-clarity).
//
// Ahiya, 2026-10-06: the card was "מפוזר", "מבלבל", and its side text "מתיש". Four pieces of prose
// were glued into one paragraph with the request LAST, behind the mission's name and description,
// so the first two words a reader takes in were never the thing to do. The card now shows the copy
// line's FIRST sentence as its title, one supporting line, and the rest behind a disclosure. This
// file pins the split, the copy (every line must open with its action) and the card's structure.
//   npx tsx scripts/test-quick-setup-card.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitAsk, pickSupportLine } from '../apps/creator-web/src/lib/quickSetupAsk';
import { translations } from '../apps/creator-web/src/i18n';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

// ── splitAsk: title = the first sentence, rest = what follows ──────────────
{
  const a = splitAsk('הניחו סיכה על המפה. כאן הקבוצות יצטרכו להגיע.');
  ok('a Hebrew line splits at its first full stop', a.title === 'הניחו סיכה על המפה.' && a.rest === 'כאן הקבוצות יצטרכו להגיע.');
  const b = splitAsk('איך קוראים למשחק? שם שגורם ללחוץ.');
  ok('a question mark ends the title too', b.title === 'איך קוראים למשחק?' && b.rest === 'שם שגורם ללחוץ.');
  const c = splitAsk('Name this mission. Something that speaks, not "Mission 3".');
  ok('an English line splits the same way', c.title === 'Name this mission.' && c.rest === 'Something that speaks, not "Mission 3".');
  const d = splitAsk('כמה נקודות שווה המשימה הזו?');
  ok('a one-sentence line is all title', d.title === 'כמה נקודות שווה המשימה הזו?' && d.rest === '');
  ok('empty input is total', splitAsk('').title === '' && splitAsk('').rest === '');
  const e = splitAsk('לא "משימה 3". המשך.');
  ok('a stop inside quotes still ends the first sentence', e.title === 'לא "משימה 3".' && e.rest === 'המשך.');
}

// ── pickSupportLine: ONE line under the title ─────────────────────────────────
ok('a short template note wins the support line',
  pickSupportLine({ rest: 'כאן הקבוצות יצטרכו להגיע.', shortNote: 'במרחק הליכה מנקודת המפגש.' }) === 'במרחק הליכה מנקודת המפגש.');
ok('without a note, the rest of the copy line', pickSupportLine({ rest: 'כאן הקבוצות יצטרכו להגיע.', shortNote: '' }) === 'כאן הקבוצות יצטרכו להגיע.');
ok('nothing to say ⇒ no line', pickSupportLine({ rest: '', shortNote: undefined }) === '');

// ── The copy: every line opens with its action ───────────────────────────────
{
  const he = (translations.he as any).quickSetup.copy as Record<string, string>;
  const en = (translations.en as any).quickSetup.copy as Record<string, string>;
  const weakOpenersHe = [/^עכשיו נסמן/, /^ברוכים הבאים/, /^בואו נ/, /^זו משימה/, /^המיקום מוסתר/, /^תמונה אחת שווה/, /^שתי שורות/, /^הוראות ההפעלה/];
  const weakOpenersEn = [/^Now let/i, /^Welcome/i, /^Let'?s /i, /^This is a/i, /^The location is hidden/i, /^A picture is worth/i, /^Two lines/i, /^The full operating/i];
  for (const [k, v] of Object.entries(he)) ok(`he copy.${k} opens with its action`, !weakOpenersHe.some((r) => r.test(v)));
  for (const [k, v] of Object.entries(en)) ok(`en copy.${k} opens with its action`, !weakOpenersEn.some((r) => r.test(v)));
  ok('he and en carry the same copy keys', Object.keys(he).sort().join() === Object.keys(en).sort().join());
  for (const [k, v] of Object.entries(he)) ok(`he copy.${k}: the title is short enough to read at a glance`, splitAsk(v).title.length <= 60);
  const qHe = (translations.he as any).quickSetup, qEn = (translations.en as any).quickSetup;
  ok('the defer link is short (no wrapping sentence)', qHe.defer.split(/\s+/).length <= 3 && qEn.defer.split(/\s+/).length <= 3);
  ok('the defer link does not address one man ("חזור")', !/חזור/.test(qHe.defer));
  ok('the details disclosure has copy in both languages', !!qHe.detailsShow && !!qHe.detailsHide && !!qEn.detailsShow && !!qEn.detailsHide);
}

// ── The card's structure ─────────────────────────────────────────────────────
{
  const src = readFileSync(join(process.cwd(), 'apps/creator-web/src/components/QuickSetup.tsx'), 'utf8');
  const bar = src.slice(src.indexOf('export function QuickSetupBar('), src.indexOf('export function QuickSetupCelebration('));
  ok('the title comes from splitAsk', /splitAsk\(/.test(bar) && /data-testid="qs-title"/.test(bar));
  ok('one support line, chosen by pickSupportLine', /pickSupportLine\(/.test(bar) && /data-testid="qs-support"/.test(bar));
  ok('the details disclosure is collapsed per step', /setDetailsOpen\(false\)/.test(bar) && /aria-expanded=\{detailsOpen\}/.test(bar));
  ok('the close control sits in the header row', /data-testid="qs-header"[\s\S]*aria-label=\{q\.close\}[\s\S]*data-testid="qs-title"/.test(bar));
  ok('exactly one progress indicator (no bar AND dots)', !/h-1 rounded-full bg-\[--surface-2\] overflow-hidden[\s\S]*showDots/.test(src) || !/QuickSetupProgressTrail/.test(bar));
  ok('no side-ruled quote for the note any more', !/border-s-2 border-\[--rp-border\]/.test(bar));
  ok('the mission name no longer opens the ask paragraph', !/q\.introTaskLabel/.test(bar.slice(0, bar.indexOf('data-testid="qs-title"'))));
}

console.log(failures === 0 ? '\n✅ quick setup card: ALL PASS' : `\n❌ quick setup card: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
