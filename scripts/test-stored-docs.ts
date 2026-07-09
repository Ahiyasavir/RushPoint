// Pure-logic test for the stored-document parsers (change: firestore-doc-read-validation).
// Validates that a core stored doc read back from Firestore has its required fields
// present and correctly typed, fails loud on a malformed doc, and tolerates unknown
// extra fields (forward-compat).
//   npx tsx scripts/test-stored-docs.ts
import {
  parseGame, parseRun, parseRunTeam, parseWallet, StoredDocError,
} from '../packages/shared/src/storedDocs';

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Assert that `fn` throws a StoredDocError naming `field`.
function expectReject(label: string, fn: () => unknown, field?: string): void {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (e) {
    const isStored = e instanceof StoredDocError;
    const fieldOk = !field || (isStored && (e as StoredDocError).field === field);
    check(label, isStored && fieldOk, isStored ? `field=${(e as StoredDocError).field}` : `wrong error: ${String(e)}`);
  }
}

// ── Valid fixtures (all required fields, correctly typed) ──────────────────────
const validGame = {
  id: 'g', ownerUid: 'o', title: 'T', mode: 'individual', stages: [],
  scoringPreset: 'time_only', registrationFields: [], visibility: 'private',
  tags: [], playCount: 0, createdAt: 't', updatedAt: 't',
};
const validRun = {
  id: 'r', gameId: 'g', ownerUid: 'o', status: 'live', accessCode: 'ABC',
  billingType: 'free', maxParticipants: 10, participantCount: 0, createdAt: 't', updatedAt: 't',
};
const validTeam = {
  id: 'tm', runId: 'r', gameId: 'g', ownerUid: 'o', displayName: 'D',
  registrationData: {}, status: 'active', stages: [], score: 0, bonusPenalty: 0,
  launched: true, updatedAt: 't',
};
const validWallet = {
  uid: 'u', eventCredits: 3, lifetimeFreeRunsUsed: 1, plan: 'free', updatedAt: 't',
};

const REQUIRED: Record<string, { valid: Record<string, unknown>; parse: (d: unknown) => unknown; fields: string[] }> = {
  Game: { valid: validGame, parse: parseGame, fields: ['id', 'ownerUid', 'title', 'mode', 'stages', 'scoringPreset', 'registrationFields', 'visibility', 'tags', 'playCount', 'createdAt', 'updatedAt'] },
  Run: { valid: validRun, parse: parseRun, fields: ['id', 'gameId', 'ownerUid', 'status', 'accessCode', 'billingType', 'maxParticipants', 'participantCount', 'createdAt', 'updatedAt'] },
  RunTeam: { valid: validTeam, parse: parseRunTeam, fields: ['id', 'runId', 'gameId', 'ownerUid', 'displayName', 'registrationData', 'status', 'stages', 'score', 'bonusPenalty', 'launched', 'updatedAt'] },
  Wallet: { valid: validWallet, parse: parseWallet, fields: ['uid', 'eventCredits', 'lifetimeFreeRunsUsed', 'plan', 'updatedAt'] },
};

// (a) a well-formed doc parses to an object deep-equal to the input.
for (const [name, { valid, parse }] of Object.entries(REQUIRED)) {
  const out = parse(valid) as Record<string, unknown>;
  check(`${name}: valid doc parses unchanged`, JSON.stringify(out) === JSON.stringify(valid));
}

// (b) dropping each required field in turn throws, naming that field.
for (const [name, { valid, parse, fields }] of Object.entries(REQUIRED)) {
  for (const f of fields) {
    const bad = { ...valid };
    delete (bad as Record<string, unknown>)[f];
    expectReject(`${name}: missing "${f}" is rejected`, () => parse(bad), f);
  }
}

// (c) a required field present but wrong-typed throws.
expectReject('Game: stages not an array is rejected', () => parseGame({ ...validGame, stages: {} }), 'stages');
expectReject('Game: playCount not a number is rejected', () => parseGame({ ...validGame, playCount: '0' }), 'playCount');
expectReject('RunTeam: score as a string is rejected', () => parseRunTeam({ ...validTeam, score: '12' }), 'score');
expectReject('Run: maxParticipants NaN is rejected', () => parseRun({ ...validRun, maxParticipants: NaN }), 'maxParticipants');
expectReject('Wallet: eventCredits NaN is rejected', () => parseWallet({ ...validWallet, eventCredits: NaN }), 'eventCredits');

// (d) unknown extra fields are tolerated and survive on the result.
const gExtra = parseGame({ ...validGame, brandNewField: 42 }) as Record<string, unknown>;
check('Game: unknown extra field survives', gExtra.brandNewField === 42);

// (e) undefined / null throw.
expectReject('Game: undefined is rejected', () => parseGame(undefined));
expectReject('Wallet: null is rejected', () => parseWallet(null));

// Forward/legacy compat: a Wallet with legacy balanceILS and no newer optional
// Stripe/referral fields still parses; a Run with a brand-new unknown field parses.
const legacyWallet = parseWallet({ ...validWallet, balanceILS: 99 }) as Record<string, unknown>;
check('Wallet: legacy balanceILS still parses + survives', legacyWallet.balanceILS === 99);
check('Run: brand-new unknown field still parses', (parseRun({ ...validRun, futureFlag: true }) as Record<string, unknown>).futureFlag === true);

console.log(`\n${failures === 0 ? 'ALL STORED-DOC TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
