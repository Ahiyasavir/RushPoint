// Operator utility: dump the mission bank as a reviewable markdown table.
//
// Not a gate (no `test-` prefix, so the unit runner does not pick it up) — this
// exists so a human can read the whole bank in one pass and judge the CONTENT,
// which no assertion can do for them.
//
//   node --import tsx scripts/dump-task-bank.ts            → markdown to stdout
//   node --import tsx scripts/dump-task-bank.ts --csv      → csv instead
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import {
  ACTIVITY_TAG_IDS, AUDIENCE_TAG_IDS, SETTING_TAG_IDS, BOOKEND_TAG_IDS,
} from '../apps/creator-web/src/bankTags';

const asCsv = process.argv.includes('--csv');

/** The bilingual seeds read "Hebrew\n\nEnglish"; show the Hebrew half only. */
const hebrewHalf = (s: string | undefined): string =>
  (s ?? '').split('\n\n')[0].replace(/\s+/g, ' ').trim();

const pick = (tags: readonly string[], from: readonly string[]): string[] =>
  tags.filter((t) => from.includes(t));

interface Row {
  key: string;
  title: string;
  type: string;
  difficulty: number;
  bookend: string;
  activity: string;
  audience: string;
  setting: string;
  needsLocation: string;
  prep: string;
  transit: string;
  source: string;
  minAge: string;
}

const rows: Row[] = TASK_BANK.map((e) => {
  const task = e.build();
  const tags = e.tags ?? [];
  return {
    key: e.key,
    title: hebrewHalf(task.title),
    type: task.type,
    difficulty: e.difficulty ?? task.difficulty,
    bookend: pick(tags, BOOKEND_TAG_IDS).join(' + ') || '—',
    activity: pick(tags, ACTIVITY_TAG_IDS).join(', ') || '—',
    audience: pick(tags, AUDIENCE_TAG_IDS).join(', ') || '—',
    setting: pick(tags, SETTING_TAG_IDS).join(', ') || '—',
    // Both the tag AND what build() actually produces, because a disagreement
    // between them is exactly the kind of drift worth seeing.
    needsLocation: tags.includes('locationBased')
      ? (task.locationless ? 'tag says YES / built NO ⚠' : 'yes')
      : (task.locationless ? 'no' : 'tag says NO / built YES ⚠'),
    transit: e.transitMinutes === undefined ? '0 (none)' : `${e.transitMinutes}m`,
    prep: tags.includes('needsSetup') ? 'needs setup'
      : tags.includes('noPrep') ? 'no prep' : '—',
    source: e.sourceTemplateKey ?? '—',
    minAge: e.minAge === undefined ? '—' : String(e.minAge),
  };
});

const HEADERS = [
  'key', 'title (HE)', 'type', 'diff', 'bookend', 'activity',
  'audience', 'setting', 'needs location', 'transit', 'prep', 'min age', 'from template',
];
const cells = (r: Row): string[] => [
  r.key, r.title, r.type, String(r.difficulty), r.bookend, r.activity,
  r.audience, r.setting, r.needsLocation, r.transit, r.prep, r.minAge, r.source,
];

if (asCsv) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  console.log(HEADERS.map(esc).join(','));
  for (const r of rows) console.log(cells(r).map(esc).join(','));
} else {
  console.log(`# Mission bank — ${rows.length} entries\n`);
  console.log(`| ${HEADERS.join(' | ')} |`);
  console.log(`|${HEADERS.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${cells(r).join(' | ')} |`);

  // ── Summary counts, so the shape of the bank is visible without tallying ──
  const tally = (label: string, ids: readonly string[]) => {
    const counts = ids
      .map((id) => [id, TASK_BANK.filter((e) => (e.tags ?? []).includes(id as never)).length] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    console.log(`\n**${label}:** ${counts.map(([id, n]) => `${id} ${n}`).join(' · ') || '—'}`);
  };

  console.log(`\n---\n`);
  tally('Bookend', BOOKEND_TAG_IDS);
  tally('Activity', ACTIVITY_TAG_IDS);
  tally('Audience', AUDIENCE_TAG_IDS);
  tally('Setting', SETTING_TAG_IDS);
  tally('Prep', ['needsSetup', 'noPrep']);
  tally('Location', ['locationBased', 'fromAnywhere']);

  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  console.log(`\n**Mission type:** ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(' · ')}`);

  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  console.log(`\n**Source template:** ${[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(' · ')}`);

  const withSetup = TASK_BANK.filter((e) => (e.setup?.length ?? 0) > 0);
  console.log(`\n**Carries Quick Setup:** ${withSetup.length} — ${withSetup.map((e) => e.key).join(', ') || '—'}`);
}
