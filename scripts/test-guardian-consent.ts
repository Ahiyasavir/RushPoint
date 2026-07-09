// Pure-logic test for guardian-consent satisfaction (change: guardian-consent-qr).
// A run may require guardian consent before a minor's team can start. The pure
// predicate decides whether a team is cleared to play. No emulator.
//   npx tsx scripts/test-guardian-consent.ts
import { isConsentSatisfied } from '../packages/shared/src/guardianConsent';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

check('run does not require consent → satisfied', isConsentSatisfied({}, {}));
check('explicit not-required → satisfied', isConsentSatisfied({}, { requiresGuardianConsent: false }));
check('required + no record → NOT satisfied', !isConsentSatisfied({}, { requiresGuardianConsent: true }));
check('required + empty consent → NOT satisfied', !isConsentSatisfied({ guardianConsent: {} }, { requiresGuardianConsent: true }));
check('required + granted record → satisfied',
  isConsentSatisfied({ guardianConsent: { grantedAt: '2026-06-27T00:00:00Z', guardianName: 'A. Parent' } }, { requiresGuardianConsent: true }));

console.log(`\n${failures === 0 ? 'ALL GUARDIAN-CONSENT TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
