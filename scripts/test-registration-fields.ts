// Pure-logic tests for solo-mode registration (change: solo-mode-registration).
// In individual/solo mode the join form must collect a single name, not both a
// team name and a player name. Team mode is unchanged. No emulator.
//   npx tsx scripts/test-registration-fields.ts
import {
  resolveRegistrationFields,
  resolveDisplayName,
  validateRequiredFields,
  type RegistrationField,
} from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const teamName: RegistrationField = { id: 'teamName', label: 'Team name', type: 'text', required: true, level: 'team' };
const memberName: RegistrationField = { id: 'name', label: 'Name', type: 'text', required: true, level: 'member' };
const age: RegistrationField = { id: 'age', label: 'Age', type: 'number', required: false, level: 'member' };
const fields = [teamName, memberName, age];

// ── individual mode collapses to a single name field ─────────────────────────
const solo = resolveRegistrationFields('individual', fields);
const soloNameFields = solo.filter((f) => f.id === 'name' || f.id === 'teamName');
check('individual: exactly one name field', soloNameFields.length === 1, `got ${soloNameFields.length}`);
check('individual: no team-level name field', !solo.some((f) => f.id === 'teamName'));
check('individual: keeps the custom (age) field', solo.some((f) => f.id === 'age'));

// ── team mode is unchanged ───────────────────────────────────────────────────
const team = resolveRegistrationFields('team', fields);
check('team: fields returned unchanged', JSON.stringify(team) === JSON.stringify(fields));

// ── display name resolution ──────────────────────────────────────────────────
check('individual display name is the single player name',
  resolveDisplayName('individual', {}, ['Dana']) === 'Dana');
check('individual falls back to values.name',
  resolveDisplayName('individual', { name: 'Noa' }, []) === 'Noa');
check('team display name prefers teamName',
  resolveDisplayName('team', { teamName: 'Reds' }, ['Dana']) === 'Reds');
check('team falls back to first member then default',
  resolveDisplayName('team', {}, ['Dana']) === 'Dana');

// ── edge: default fields (single member name) ────────────────────────────────
const defaultsOnly = resolveRegistrationFields('individual', [memberName]);
check('individual with only member name → one field', defaultsOnly.length === 1);

// ── validateRequiredFields (change: prelaunch-critical-fixes, M5) ────────────
// Returns the set of field ids that are required but empty (so JoinScreen can
// highlight them client-side before calling joinRun).
{
  const phoneReq: RegistrationField = { id: 'phone', label: 'Phone', type: 'phone', required: true, level: 'member' };
  const noteOpt: RegistrationField = { id: 'note', label: 'Note', type: 'text', required: false, level: 'member' };
  const consentReq: RegistrationField = { id: 'consent', label: 'Consent', type: 'checkbox', required: true, level: 'member' };

  check('all filled → no errors', validateRequiredFields([phoneReq], { phone: '0501234567' }).size === 0);
  check('required field empty → in error set', validateRequiredFields([phoneReq], { phone: '' }).has('phone'));
  check('required whitespace-only → in error set', validateRequiredFields([phoneReq], { phone: '   ' }).has('phone'));
  check('optional field empty → NOT in error set', validateRequiredFields([noteOpt], {}).size === 0);
  check('checkbox required + "false" → invalid', validateRequiredFields([consentReq], { consent: 'false' }).has('consent'));
  check('checkbox required + "true" → valid', validateRequiredFields([consentReq], { consent: 'true' }).size === 0);
}

console.log(`\n${failures === 0 ? 'ALL REGISTRATION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
