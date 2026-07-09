// Pure-logic tests for trackable-collectibles pickup/drop rules.
import { canPickUp, canDrop } from '@rushpoint/shared';

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string) { if (cond) passed++; else { failed++; console.error(`  ✗ ${msg}`); } }

// Pickup: only when unheld
ok(canPickUp({ currentHolderTeamId: null }) === true, 'unheld (null) → pickable');
ok(canPickUp({ currentHolderTeamId: undefined }) === true, 'unheld (undefined) → pickable');
ok(canPickUp({ currentHolderTeamId: 'teamA' }) === false, 'held → not pickable');

// Drop: only by the current holder
ok(canDrop({ currentHolderTeamId: 'teamA' }, 'teamA') === true, 'holder can drop');
ok(canDrop({ currentHolderTeamId: 'teamA' }, 'teamB') === false, 'non-holder cannot drop');
ok(canDrop({ currentHolderTeamId: null }, 'teamA') === false, 'nobody holding → cannot drop');

console.log(failed === 0 ? `\n✅ ALL TRACKABLE TESTS PASSED (${passed})` : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
