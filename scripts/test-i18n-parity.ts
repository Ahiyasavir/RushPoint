// Language-state rendering guard (change: play-web-i18n-hebrew).
// Ensures BOTH apps' translation maps have identical recursive key sets (so no
// key is ever missing in Hebrew mode → no English fallback) and that no Hebrew
// leaf string leaks Latin-script English (outside a small brand/units whitelist).
// No emulator.
//   npx tsx scripts/test-i18n-parity.ts
import { readFileSync } from 'node:fs';
import { translations as creatorT } from '../apps/creator-web/src/i18n';
import { translations as playT } from '../apps/play-web/src/i18n';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Recursive set of dotted key paths. Leaf = string OR function (function-valued
// i18n entries are allowed). Objects/arrays recurse; arrays use index keys.
function keysDeep(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...keysDeep(v, prefix ? `${prefix}.${k}` : k));
  }
  return out.sort();
}

// Brand names / units / acronyms that legitimately stay Latin inside Hebrew copy,
// plus the language-toggle label (a language's own name) and the structural
// direction values ('rtl'/'ltr', which are not user-facing copy).
const WHITELIST = ['RushPoint', 'Creator Pro', 'Pro', 'QR', 'SOS', 'GPS', 'Google', 'YouTube', 'PWA', '₪', 'English', 'rtl', 'ltr'];

function stripWhitelist(s: string): string {
  let out = s;
  for (const w of WHITELIST) out = out.split(w).join('');
  return out;
}
// A "Latin English word" = 2+ consecutive ASCII letters left after whitelisting.
// Tokens that contain a digit (sample codes / ids like "FOX42", "ABC123") are not
// English copy — strip them first so an example code in Hebrew copy isn't flagged.
// (Kept in sync with scripts/check-i18n.ts, the authoritative i18n gate.)
function hasEnglish(s: string): boolean {
  // `{placeholder}` tokens are structure, not copy — substituted at runtime, never
  // shown to a user. Kept in sync with scripts/check-i18n.ts `hasEnglishWord`.
  const noPlaceholders = s.replace(/\{[A-Za-z0-9_]+\}/g, '');
  const noCodes = stripWhitelist(noPlaceholders).replace(/[A-Za-z]*\d[A-Za-z\d]*/g, '');
  return /[A-Za-z]{2,}/.test(noCodes);
}

function leafStrings(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (obj === null || typeof obj !== 'object') return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...leafStrings(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

for (const [app, t] of [['creator-web', creatorT], ['play-web', playT]] as const) {
  const heKeys = keysDeep(t.he);
  const enKeys = keysDeep(t.en);
  check(`${app}: HE/EN key sets are identical`,
    JSON.stringify(heKeys) === JSON.stringify(enKeys),
    `he=${heKeys.length} en=${enKeys.length}`);

  const leaks = leafStrings(t.he).filter(([, v]) => hasEnglish(v));
  check(`${app}: no English leakage in HE leaf strings`,
    leaks.length === 0,
    leaks.slice(0, 5).map(([k, v]) => `${k}="${v}"`).join(' | '));
}

// ── task + final namespaces (change: prelaunch-critical-fixes, M1/M2) ────────
{
  const TASK_KEYS = ['routing','routingError','retryRouting','yourTask','routedTask','stopOf','markComplete','imHere','verify','wrongCode','yourAnswer','submitAnswer','enterNumber','submit','uploadingPhoto','approved','pendingReview','submitPhoto','working','takePhoto','retakePhoto','photoSaveRetry','hintStuck','stepOf','stepAnswer','submitStep','findingLocation','youreHere','walkCloser','gpsWarning','gpsUnavailable','gpsContactHost'];
  const FINAL_KEYS = ['title','subtitle','scoreLabel','rankLabel','recapTitle','statTotalTime','statStages','statFastest','statHints','shareBtn','shareCreating','shareSaved','leaderboardTitle','waitingFinalize','poweredBy','buildOwn','leave','shareText','shareRankPart','shareTimePart'];
  const FN_KEYS = { task: ['stopOf','hintStuck','stepOf','walkCloser'], final: ['subtitle','rankLabel','shareText','shareRankPart','shareTimePart'] };

  for (const [lang, t] of [['he', playT.he], ['en', playT.en]] as const) {
    const task = (t as Record<string, Record<string, unknown>>).task;
    const final = (t as Record<string, Record<string, unknown>>).final;
    check(`play-web.${lang}: t.task namespace exists`, !!task);
    check(`play-web.${lang}: t.final namespace exists`, !!final);
    check(`play-web.${lang}: t.task has all ${TASK_KEYS.length} keys`,
      TASK_KEYS.every((k) => k in (task ?? {})), TASK_KEYS.filter((k) => !(k in (task ?? {}))).join(','));
    check(`play-web.${lang}: t.final has all ${FINAL_KEYS.length} keys`,
      FINAL_KEYS.every((k) => k in (final ?? {})), FINAL_KEYS.filter((k) => !(k in (final ?? {}))).join(','));
    check(`play-web.${lang}: t.task fn keys are functions`,
      FN_KEYS.task.every((k) => typeof task?.[k] === 'function'));
    check(`play-web.${lang}: t.final fn keys are functions`,
      FN_KEYS.final.every((k) => typeof final?.[k] === 'function'));
  }
}

// ── P9 regression guard (change: prelaunch-polish) ───────────────────────────
// JoinScreen must evaluate the ?code= link param at component mount, not at
// module-parse time — so no module-level access to window.location.
{
  const src = readFileSync(new URL('../apps/play-web/src/screens/JoinScreen.tsx', import.meta.url), 'utf8');
  const moduleScope = src.split('export default function')[0];
  check('JoinScreen: no module-level window.location access (P9)',
    !/window\.location/.test(moduleScope));
}

console.log(`\n${failures === 0 ? 'ALL I18N PARITY TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
