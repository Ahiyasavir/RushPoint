// Build first, sign up at launch (change: creator-acquisition-and-return).
import assert from 'node:assert/strict';
import {
  isGuest, defaultAuthMode, accountGateFor, guestSaveMoment, GUEST_FREE_EDITS, startIntentOpensWizard,
} from '../apps/creator-web/src/lib/guestCreator';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; void name; };

ok('a guest is an anonymous Firebase user, nobody else', () => {
  assert.equal(isGuest({ isAnonymous: true }), true);
  assert.equal(isGuest({ isAnonymous: false }), false);
  assert.equal(isGuest(null), false);
  assert.equal(isGuest(undefined), false);
  assert.equal(isGuest({}), false);
});

ok('a stranger lands on sign UP, a returning browser on sign in', () => {
  assert.equal(defaultAuthMode(false), 'up');
  assert.equal(defaultAuthMode(true), 'in');
});

ok('only launch and publish ask a guest to save; a test drive never does', () => {
  assert.equal(accountGateFor('launch', true), 'needsAccount');
  assert.equal(accountGateFor('publish', true), 'needsAccount');
  assert.equal(accountGateFor('testDrive', true), 'go');
  assert.equal(accountGateFor('launch', false), 'go');
  assert.equal(accountGateFor('publish', false), 'go');
});

ok('a guest is asked softly once, then must save after the free edits', () => {
  assert.equal(GUEST_FREE_EDITS, 3);
  assert.equal(guestSaveMoment({ guest: true, edits: 0, softSeen: false }), 'soft');
  assert.equal(guestSaveMoment({ guest: true, edits: 2, softSeen: true }), 'none');
  assert.equal(guestSaveMoment({ guest: true, edits: 3, softSeen: true }), 'required');
  assert.equal(guestSaveMoment({ guest: true, edits: 3, softSeen: false }), 'required', 'required wins over soft');
  assert.equal(guestSaveMoment({ guest: false, edits: 99, softSeen: false }), 'none', 'an account is never asked');
  assert.equal(guestSaveMoment({ guest: true, edits: 'x', softSeen: true }), 'none', 'garbage counts as no edits');
});

ok('the site CTA never buries an existing game under the wizard', () => {
  assert.equal(startIntentOpensWizard(0), true);
  assert.equal(startIntentOpensWizard(1), false);
});

console.log(`test-guest-creator: ${n} passed`);
