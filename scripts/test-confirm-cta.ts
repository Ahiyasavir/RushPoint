// A confirm button must name the action (change: confirm-button-says-what-it-does).
//
// `dialog.confirm(message, confirmLabel, danger)` puts its SECOND argument on the
// confirm button. RunConsolePage wanted a heading and the dialog had no title
// slot, so it passed `rc.confirmTitle` there:
//
//     dialog.confirm(rc.consequence[key], rc.confirmTitle, …)
//
// Every confirmed run action therefore offered a button reading "Before you go
// ahead" / "רגע לפני שממשיכים" — start all teams, publish the standings, reveal
// the standings, end the run. Ten actions, all of them classified by the console
// itself as needing confirmation and most as irreversible, and none of their
// buttons said what pressing it would do. Observed live while launching a run.
//
// The dialog now has a real `title` slot, and the button gets a verb per action.
// This guard keeps the two roles from collapsing back into one string, and fails
// if an action gains `confirm: true` without gaining a verb.
import { RUN_ACTION_IDS, runActionConsequence } from '../apps/creator-web/src/lib/runConsoleActions';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf8');

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

const i18n = read('apps/creator-web/src/i18n.ts');

/** Pull one `confirmCta: { … }` object literal's keys out of the dictionary. */
function ctaKeys(from: number): { keys: string[]; end: number } {
  const start = i18n.indexOf('confirmCta: {', from);
  if (start < 0) return { keys: [], end: -1 };
  const end = i18n.indexOf('},', start);
  const body = i18n.slice(start, end);
  return { keys: [...body.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]!), end };
}

const he = ctaKeys(0);
const en = ctaKeys(he.end + 1);

console.log('\n[confirm CTA] every action that asks for confirmation has a verb');

const needsConfirm = RUN_ACTION_IDS
  .map((id) => runActionConsequence(id))
  .filter((c) => c.confirm)
  .map((c) => c.copyKey);

ok(needsConfirm.length > 0, 'the consequence table really does declare confirming actions');

for (const key of needsConfirm) {
  ok(he.keys.includes(key), `confirmCta.${key} exists in Hebrew`,
    'an action with confirm: true whose button has no verb falls back to a generic label and stops saying what it does');
  ok(en.keys.includes(key), `confirmCta.${key} exists in English`);
}

console.log('\n[confirm CTA] no stale verbs for actions that never confirm');
for (const key of he.keys) {
  ok(needsConfirm.includes(key), `confirmCta.${key} still maps to a confirming action`,
    'remove the entry, or set confirm: true on the action it belongs to');
}
ok(he.keys.length === en.keys.length, 'Hebrew and English declare the same number of verbs',
  `he=${he.keys.length} en=${en.keys.length}`);

console.log('\n[confirm CTA] the heading and the button are separate roles again');
{
  const page = read('apps/creator-web/src/pages/RunConsolePage.tsx');
  ok(/title:\s*rc\.confirmTitle/.test(page),
    'confirmTitle is passed as the dialog TITLE',
    'it used to be the second positional argument, which is the button label');
  ok(!/dialog\.confirm\([^)]*rc\.confirmTitle\s*,/.test(page),
    'and is no longer passed positionally where the button label goes');

  const dlg = read('apps/creator-web/src/components/dialog.tsx');
  ok(/title\?:\s*string/.test(dlg), 'the dialog actually has a title slot to put it in');
  ok(/\{req\.title &&/.test(dlg), 'and renders it');
}

console.log(failures === 0 ? '\n✅ confirm CTA: ALL PASS\n' : `\n❌ confirm CTA: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
