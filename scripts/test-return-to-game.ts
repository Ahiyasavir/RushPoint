// change: return-to-game (Ahiya, 15.10). At המירוץ לציון players who left the game to search Google
// did not know how to get back. Rescanning the same code already resumes; nobody was told. This pins:
//   - the search link: one pure URL, opened from the play menu in a NEW tab (the game's tab stays);
//   - the waiting screen tip, in both languages;
//   - the printed join sign's "scan this code again" line.
// UI has no component runner here, so the markup half is a source check, the house pattern
// (scripts/test-task-entry-keying.ts).
//   npx tsx scripts/test-return-to-game.ts
import { readFileSync, existsSync } from 'node:fs';
import { translations as playT } from '../apps/play-web/src/i18n';
import { translations as creatorT } from '../apps/creator-web/src/i18n';

let failures = 0;
let checks = 0;
function check(label: string, cond: boolean, detail = ''): void {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── The URL ───────────────────────────────────────────────────────────────────
const helperPath = new URL('../apps/play-web/src/lib/webSearch.ts', import.meta.url);
check('lib/webSearch.ts exists', existsSync(helperPath));
if (existsSync(helperPath)) {
  // require, not import: a missing module must fail ONE check here, not the whole file at load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webSearchHref } = require('../apps/play-web/src/lib/webSearch') as { webSearchHref: (lang: 'he' | 'en') => string };
  const he = webSearchHref('he');
  const en = webSearchHref('en');
  check('the Hebrew search page is https and in Hebrew', /^https:\/\/www\.google\.com\/\?hl=he$/.test(he), he);
  check('the English search page is https and in English', /^https:\/\/www\.google\.com\/\?hl=en$/.test(en), en);
  check('an unknown language falls back to Hebrew', webSearchHref('xx' as never) === he);
}

// ── The menu item ─────────────────────────────────────────────────────────────
const play = readFileSync(new URL('../apps/play-web/src/screens/PlayScreen.tsx', import.meta.url), 'utf8');
const menuStart = play.indexOf('function LeaveMenu(');
const menu = menuStart >= 0 ? play.slice(menuStart, play.indexOf('\nfunction ', menuStart + 10)) : '';
const anchor = /<a\b[^>]*data-testid="web-search"[^>]*>/s.exec(menu)?.[0] ?? '';
check('the play menu has a web search link', anchor !== '');
check('it opens in a NEW tab', /target="_blank"/.test(anchor), anchor.slice(0, 160));
check('the new tab gets no handle on the game (noopener)', /rel="[^"]*noopener[^"]*"/.test(anchor));
check('its address comes from webSearchHref', /href=\{webSearchHref\(/.test(anchor));
check('it is a menu item for assistive technology', /role="menuitem"/.test(anchor));

// ── The waiting screen tip ────────────────────────────────────────────────────
const waitingStart = play.indexOf('if (!team.launched) {');
const waiting = waitingStart >= 0 ? play.slice(waitingStart, waitingStart + 6000) : '';
check('the waiting screen renders the return tip title', /t\.play\.returnTipTitle/.test(waiting));
check('the waiting screen renders the return tip body', /t\.play\.returnTipBody/.test(waiting));

// ── The copy, both languages ──────────────────────────────────────────────────
for (const lang of ['he', 'en'] as const) {
  const p = playT[lang].play as Record<string, unknown>;
  check(`${lang}: play.webSearch exists`, typeof p.webSearch === 'string' && (p.webSearch as string).length > 0);
  check(`${lang}: play.returnTipTitle exists`, typeof p.returnTipTitle === 'string' && (p.returnTipTitle as string).length > 0);
  check(`${lang}: play.returnTipBody exists`, typeof p.returnTipBody === 'string' && (p.returnTipBody as string).length > 0);
  const h = creatorT[lang].hostSheet as Record<string, unknown>;
  check(`${lang}: hostSheet.joinSignReturn exists`, typeof h.joinSignReturn === 'string' && (h.joinSignReturn as string).length > 0);
}
const heBody = String((playT.he.play as Record<string, unknown>).returnTipBody ?? '');
check('Hebrew tip says to scan again', /סרקו שוב/.test(heBody), heBody);
// Ahiya, 16.10: the tip is ONLY the way back; the search lives in the menu, unannounced.
check('Hebrew tip is one short sentence', heBody.split('.').filter((x) => x.trim()).length === 1, heBody);
check('Hebrew sign says to scan again', /סרקו שוב/.test(String((creatorT.he.hostSheet as Record<string, unknown>).joinSignReturn ?? '')));

// ── The printed sign ──────────────────────────────────────────────────────────
const sheet = readFileSync(new URL('../apps/creator-web/src/pages/HostSheetPage.tsx', import.meta.url), 'utf8');
const joinStart = sheet.indexOf('const joinDoc =');
const joinDoc = joinStart >= 0 ? sheet.slice(joinStart, sheet.indexOf('\n  return (', joinStart)) : '';
check('the join sign renders the return line', /h\.joinSignReturn/.test(joinDoc));

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} :: ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
