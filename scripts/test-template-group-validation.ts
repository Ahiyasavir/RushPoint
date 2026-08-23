// Pure-logic test for templateGroupSiblingMatches (change: admin-manage-game-templates).
import { templateGroupSiblingMatches } from '@rushpoint/shared';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.log(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}

check('no group key: always accepted',
  templateGroupSiblingMatches({ templateEmoji: '🎯', templateOrder: 1 }, [{ templateEmoji: '🚫', templateOrder: 99 }]));

check('first in group (no existing siblings): always accepted',
  templateGroupSiblingMatches({ templateGroupKey: 'g1', templateEmoji: '🎯', templateOrder: 1 }, []));

check('matching sibling: accepted',
  templateGroupSiblingMatches(
    { templateGroupKey: 'g1', templateEmoji: '🎯', templateOrder: 1 },
    [{ templateEmoji: '🎯', templateOrder: 1 }],
  ));

check('mismatched emoji: rejected',
  !templateGroupSiblingMatches(
    { templateGroupKey: 'g1', templateEmoji: '🚫', templateOrder: 1 },
    [{ templateEmoji: '🎯', templateOrder: 1 }],
  ));

check('mismatched order: rejected',
  !templateGroupSiblingMatches(
    { templateGroupKey: 'g1', templateEmoji: '🎯', templateOrder: 99 },
    [{ templateEmoji: '🎯', templateOrder: 1 }],
  ));

check('must match EVERY existing sibling, not just one',
  !templateGroupSiblingMatches(
    { templateGroupKey: 'g1', templateEmoji: '🎯', templateOrder: 1 },
    [{ templateEmoji: '🎯', templateOrder: 1 }, { templateEmoji: '🎯', templateOrder: 2 }],
  ));

if (failures > 0) {
  console.error(`\n❌ ${failures} failure(s) in test-template-group-validation.ts`);
  process.exit(1);
} else {
  console.log('\n✅ test-template-group-validation.ts — all checks passed');
}
