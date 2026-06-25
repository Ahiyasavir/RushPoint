// Language-state rendering guard (change: play-web-i18n-hebrew).
// Ensures BOTH apps' translation maps have identical recursive key sets (so no
// key is ever missing in Hebrew mode → no English fallback) and that no Hebrew
// leaf string leaks Latin-script English (outside a small brand/units whitelist).
// No emulator.
//   npx tsx scripts/test-i18n-parity.ts
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
const WHITELIST = ['RushPoint', 'Creator Pro', 'Pro', 'QR', 'SOS', 'GPS', 'Google', 'PWA', '₪', 'English', 'rtl', 'ltr'];

function stripWhitelist(s: string): string {
  let out = s;
  for (const w of WHITELIST) out = out.split(w).join('');
  return out;
}
// A "Latin English word" = 2+ consecutive ASCII letters left after whitelisting.
function hasEnglish(s: string): boolean {
  return /[A-Za-z]{2,}/.test(stripWhitelist(s));
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

console.log(`\n${failures === 0 ? 'ALL I18N PARITY TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
