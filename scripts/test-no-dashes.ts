// UI text standard guard (change: ui-no-dashes). User-facing copy must not use
// em-dash (—), en-dash (–), or a spaced hyphen ( - ) as a sentence separator —
// commas / periods / line breaks instead. Scans both apps' translation maps and
// fails on any offending string leaf, locking the standard in as a copy lint.
//   npx tsx scripts/test-no-dashes.ts
import { translations as creatorT } from '../apps/creator-web/src/i18n';
import { translations as playT } from '../apps/play-web/src/i18n';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Collect [dottedKey, value] for every STRING leaf (function-valued i18n entries
// are skipped — they can't be statically inspected here).
function leafStrings(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (obj === null || typeof obj !== 'object') return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...leafStrings(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

// Em-dash, en-dash, or a spaced hyphen used as a separator.
const DASH = /—|–| - /;

for (const [app, t] of [['creator-web', creatorT], ['play-web', playT]] as const) {
  for (const [lang, map] of [['he', t.he], ['en', t.en]] as const) {
    const offenders = leafStrings(map).filter(([, v]) => DASH.test(v));
    check(`${app}.${lang}: no dash separators in copy`,
      offenders.length === 0,
      offenders.slice(0, 8).map(([k, v]) => `${k}="${v}"`).join(' | '));
  }
}

console.log(`\n${failures === 0 ? 'ALL NO-DASHES TESTS PASSED' : failures + ' FILE(S) WITH DASHES'}`);
process.exit(failures === 0 ? 0 : 1);
