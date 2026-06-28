// Pure-logic tests for no-signup-demo (local draft serialize / claim helpers).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  serializeDraft,
  deserializeDraft,
  isDraftClaimable,
  DRAFT_VERSION,
} from '../apps/creator-web/src/lib/demoDraft';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const game = {
  title: 'Old City Hunt',
  description: 'A walk',
  stages: [{ id: 's1', order: 0, title: 'Stage', tasks: [{ id: 't1', title: 'Go', type: 'field' }] }],
} as never;

// ── round-trip ───────────────────────────────────────────────────────────────
const raw = serializeDraft(game);
ok(typeof raw === 'string', 'serializeDraft → string');
ok(JSON.stringify(deserializeDraft(raw)) === JSON.stringify(game), 'serialize → deserialize round-trips');

// ── version mismatch → null ──────────────────────────────────────────────────
const wrongVersion = JSON.stringify({ version: DRAFT_VERSION + 1, game });
ok(deserializeDraft(wrongVersion) === null, 'version mismatch → null');
ok(deserializeDraft('{not json') === null, 'malformed JSON → null');
ok(deserializeDraft('') === null, 'empty string → null');
ok(deserializeDraft(null) === null, 'null → null');
ok(deserializeDraft(JSON.stringify({ version: DRAFT_VERSION })) === null, 'missing game → null');

// ── isDraftClaimable ─────────────────────────────────────────────────────────
ok(isDraftClaimable(game) === true, 'titled game with a task → claimable');
ok(isDraftClaimable({ title: '', stages: game.stages } as never) === false, 'no title → not claimable');
ok(isDraftClaimable({ title: '   ', stages: game.stages } as never) === false, 'blank title → not claimable');
ok(isDraftClaimable({ title: 'X', stages: [] } as never) === false, 'no stages → not claimable');
ok(isDraftClaimable({ title: 'X', stages: [{ tasks: [] }] } as never) === false, 'no tasks → not claimable');
ok(isDraftClaimable(null) === false, 'null → not claimable');
ok(isDraftClaimable({} as never) === false, 'empty object → not claimable');

console.log(failed === 0
  ? `\n✅ ALL DEMO-DRAFT TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
