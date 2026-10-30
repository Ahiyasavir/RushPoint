// How loudly the console asks the host to end the run (change: creator-acquisition-and-return).
import assert from 'node:assert/strict';
import { endRunCall } from '../apps/creator-web/src/lib/endRunCall';

assert.equal(endRunCall({ status: 'live', started: 4, finished: 4 }), 'ready');
assert.equal(endRunCall({ status: 'live', started: 5, finished: 3 }), 'mostly');
assert.equal(endRunCall({ status: 'live', started: 5, finished: 2 }), 'none');
assert.equal(endRunCall({ status: 'live', started: 0, finished: 0 }), 'none', 'nobody played: nothing to reveal');
assert.equal(endRunCall({ status: 'finished', started: 4, finished: 4 }), 'none', 'already ended');
// Malformed input can only make it quieter, never louder.
assert.equal(endRunCall({ status: 'live', started: 'x', finished: 3 }), 'none');
assert.equal(endRunCall({ status: 'live', started: 3, finished: 9 }), 'ready', 'finished is capped at started');
assert.equal(endRunCall({ status: 'live', started: NaN, finished: NaN }), 'none');
assert.equal(endRunCall(null), 'none');
console.log('test-end-run-call: passed');
