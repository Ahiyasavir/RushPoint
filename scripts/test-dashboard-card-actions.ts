// Pure-logic test for the Dashboard game card's inline-vs-overflow action split
// (change: dashboard-card-actions-overflow).
//
// Each game card used to render SIX flat controls (Edit + Launch primary, then a
// flex-wrap row of Test run / Publish-or-Unpublish / Share / Delete at equal
// weight, one hairline from the destructive Delete). The card was doing a context
// menu's job inline. The Run Console already solved this shape: a small inline set
// plus a "⋯" overflow menu, split by a pure function (`teamRowActions`).
//
// `dashboardCardActions` mirrors that: Edit + Launch stay inline; the four
// secondary actions collapse into the overflow, Delete last as the destructive
// one, publish vs unpublish resolved from the game's visibility. It is a pure,
// total function so no action can ever be silently dropped. No emulator.
//   npx tsx scripts/test-dashboard-card-actions.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dashboardCardActions,
  type DashboardCardActionId,
} from '../apps/creator-web/src/lib/dashboardCardActions';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function eq<T>(label: string, got: T, want: T): void {
  check(label, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const ALL_SEVEN: DashboardCardActionId[] = ['edit', 'launch', 'testRun', 'history', 'share', 'shareLink', 'delete'];
// (publish|unpublish counts as the remaining one; asserted per-case below.)

// ── inline is always Edit + Launch ───────────────────────────────────────────
console.log('\n── inline ──');
for (const g of [undefined, null, {}, { visibility: 'public' }, { visibility: 'private' }]) {
  eq(`inline is ['edit','launch'] for ${JSON.stringify(g)}`,
    dashboardCardActions(g as never).inline, ['edit', 'launch']);
}

// ── overflow order + visibility ──────────────────────────────────────────────
console.log('\n── overflow ──');
// `history` (change: post-run-player-report) sits with the other post-launch
// verbs and BEFORE share/delete: it is a read, not a publication or a destruction.
// `shareLink` (change: game-share-link) sits beside `share` — both are reads
// that hand somebody a URL — and before `delete`, which stays last.
eq('a private game overflows [testRun, history, publish, share, shareLink, delete]',
  dashboardCardActions({ visibility: 'private' }).overflow,
  ['testRun', 'history', 'publish', 'share', 'shareLink', 'delete']);
eq('a game with no visibility overflows the publish variant',
  dashboardCardActions({}).overflow,
  ['testRun', 'history', 'publish', 'share', 'shareLink', 'delete']);
eq('a public game overflows [testRun, history, unpublish, share, shareLink, delete]',
  dashboardCardActions({ visibility: 'public' }).overflow,
  ['testRun', 'history', 'unpublish', 'share', 'shareLink', 'delete']);

// ── delete is always last ────────────────────────────────────────────────────
console.log('\n── delete last ──');
for (const g of [{}, { visibility: 'public' }, { visibility: 'private' }, { visibility: 'unlisted' }]) {
  const of = dashboardCardActions(g).overflow;
  check(`delete is the final overflow entry for ${JSON.stringify(g)}`,
    of[of.length - 1] === 'delete', of.join(','));
}

// ── coverage: every underlying action appears exactly once ───────────────────
console.log('\n── coverage ──');
function coverageOk(g: unknown): boolean {
  const { inline, overflow } = dashboardCardActions(g as never);
  const all = [...inline, ...overflow];
  // Normalize the publish/unpublish slot to a single "publishToggle" bucket so
  // the six actions can be counted regardless of visibility.
  const norm = all.map((id) => (id === 'publish' || id === 'unpublish' ? 'publishToggle' : id));
  const want = ['edit', 'launch', 'testRun', 'history', 'publishToggle', 'share', 'shareLink', 'delete'];
  if (norm.length !== want.length) return false;
  return want.every((id) => norm.filter((x) => x === id).length === 1);
}
for (const g of [{}, { visibility: 'public' }, { visibility: 'private' }]) {
  check(`each action appears exactly once for ${JSON.stringify(g)}`, coverageOk(g));
}
void ALL_SEVEN;

// ── totality: garbage never throws, always well formed ───────────────────────
console.log('\n── totality ──');
const garbage: unknown[] = [null, undefined, {}, 42, 'x', [], true, { visibility: 42 }, NaN];
for (const g of garbage) {
  let threw = false;
  let wellFormed = false;
  try {
    const r = dashboardCardActions(g as never);
    wellFormed = Array.isArray(r.inline) && Array.isArray(r.overflow)
      && JSON.stringify(r.inline) === JSON.stringify(['edit', 'launch'])
      && r.overflow.length === 6 && r.overflow[r.overflow.length - 1] === 'delete'
      && coverageOk(g);
  } catch { threw = true; }
  check(`${JSON.stringify(g)} does not throw and is well formed`, !threw && wellFormed);
}

// ── Wiring guards (source scan) ──────────────────────────────────────────────
// The shared OverflowMenu must be a real component consumed by BOTH surfaces,
// and the menu trigger's aria-label must exist in both language maps.
console.log('\n── wiring ──');
const root = process.cwd();
const i18n = readFileSync(join(root, 'apps/creator-web/src/i18n.ts'), 'utf8');
const moreActions = i18n.match(/cardMoreActions:\s*'[^']*'/g) ?? [];
check('cardMoreActions is defined in BOTH language maps', moreActions.length === 2,
  `${moreActions.length} found`);
check('the Hebrew cardMoreActions copy is Hebrew', /[֐-׿]/.test(moreActions[0] ?? ''));
check('no em-dash in the new copy', !moreActions.some((m) => m.includes('—')));

const overflowPath = join(root, 'apps/creator-web/src/components/OverflowMenu.tsx');
let overflowSrc = '';
try { overflowSrc = readFileSync(overflowPath, 'utf8'); } catch { /* RED until created */ }
check('components/OverflowMenu.tsx exists', overflowSrc.length > 0);
check('OverflowMenu is exported', /export function OverflowMenu|export \{[^}]*OverflowMenu/.test(overflowSrc));

const dash = readFileSync(join(root, 'apps/creator-web/src/pages/DashboardPage.tsx'), 'utf8');
const runc = readFileSync(join(root, 'apps/creator-web/src/pages/RunConsolePage.tsx'), 'utf8');
check('DashboardPage imports the shared OverflowMenu',
  /import\s+\{[^}]*OverflowMenu[^}]*\}\s+from\s+'\.\.\/components\/OverflowMenu'/.test(dash));
check('RunConsolePage imports the shared OverflowMenu',
  /import\s+\{[^}]*OverflowMenu[^}]*\}\s+from\s+'\.\.\/components\/OverflowMenu'/.test(runc));
check('RunConsolePage no longer declares a local OverflowMenu',
  !/function OverflowMenu\(/.test(runc));
check('DashboardPage uses the dashboardCardActions helper',
  /dashboardCardActions\(/.test(dash));

console.log(`\n${failures === 0 ? 'ALL DASHBOARD-CARD-ACTIONS TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
