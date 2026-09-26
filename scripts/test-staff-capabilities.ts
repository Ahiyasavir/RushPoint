// Pure tests for staff capabilities (change: staff-capabilities).
//
// WHAT WAS WRONG. Staff invites carried a `permissions` array that nothing ever read: every staff
// token could call every staff callable, so a marshal handed a PIN to watch one station could also
// add points to any team. The organizer asked for a game default ("block staff from adding points"),
// codes that several people share, each code with its own permissions, and the right to widen them
// during the run. This file pins the arithmetic every gate reads.
//   npx tsx scripts/test-staff-capabilities.ts
import {
  STAFF_CAPABILITIES,
  ALWAYS_GRANTED_CAPABILITIES,
  STAFF_PRESETS,
  STAFF_CAPABILITY_BY_CALLABLE,
  normalizeStaffCapabilities,
  defaultCodeCapabilities,
  resolveStaffAccess,
  staffCan,
  staffRefusal,
  STAFF_REFUSAL_REASON,
  type StaffCapability,
} from '../packages/shared/src/staffCapabilities';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const sorted = (xs: Iterable<string>) => [...xs].sort().join(',');

// ── The vocabulary ────────────────────────────────────────────────────────────
check('safety is always granted', ALWAYS_GRANTED_CAPABILITIES.includes('safety'));
check('the staff channel is always granted', ALWAYS_GRANTED_CAPABILITIES.includes('staffChannel'));
check('mission names are always granted (the staff console cannot work without them)',
  ALWAYS_GRANTED_CAPABILITIES.includes('outline'));
check('score is NOT always granted (the reported case)', !ALWAYS_GRANTED_CAPABILITIES.includes('score'));
for (const c of ALWAYS_GRANTED_CAPABILITIES) check(`always-granted ${c} is a known capability`, STAFF_CAPABILITIES.includes(c));

// ── Presets ───────────────────────────────────────────────────────────────────
check('marshal = chat + hold + locations', sorted(STAFF_PRESETS.marshal) === sorted(['chat', 'hold', 'locations']), sorted(STAFF_PRESETS.marshal));
check('judge = marshal + review', sorted(STAFF_PRESETS.judge) === sorted(['chat', 'hold', 'locations', 'review']), sorted(STAFF_PRESETS.judge));
check('full = every capability', sorted(STAFF_PRESETS.full) === sorted(STAFF_CAPABILITIES));

// ── The declared callable table is total and honest ──────────────────────────
const expected: Record<string, StaffCapability> = {
  acknowledgeAlert: 'safety',
  clearTeamOutOfBounds: 'safety',
  sendStaffChannelMessage: 'staffChannel',
  getRunOutline: 'outline',
  reviewStationSubmission: 'review',
  getRunSurveyResults: 'review',
  adjustTeamScore: 'score',
  skipTaskForTeam: 'route',
  forceAssignTask: 'route',
  returnTeamTo: 'route',
  setTeamHold: 'hold',
  pushAnnouncement: 'broadcast',
  deactivateAnnouncement: 'broadcast',
  pushFlashMission: 'broadcast',
  sendTeamChatMessage: 'chat',
  hideFeedItem: 'feed',
  setRunTaskStatus: 'tasks',
};
for (const [name, cap] of Object.entries(expected)) {
  check(`${name} is gated by ${cap}`, STAFF_CAPABILITY_BY_CALLABLE[name] === cap, String(STAFF_CAPABILITY_BY_CALLABLE[name]));
}
check('the table names no callable beyond the declared set',
  Object.keys(STAFF_CAPABILITY_BY_CALLABLE).every((k) => k in expected),
  Object.keys(STAFF_CAPABILITY_BY_CALLABLE).filter((k) => !(k in expected)).join(','));
for (const cap of Object.values(STAFF_CAPABILITY_BY_CALLABLE)) {
  check(`table value ${cap} is a known capability`, STAFF_CAPABILITIES.includes(cap));
}

// ── Validation (updateGame / importGameFile / inviteStaff / updateStaffCode) ──
check('a clean list is kept, deduped and in canonical order',
  sorted(normalizeStaffCapabilities(['review', 'chat', 'review']) ?? []) === sorted(['review', 'chat']));
check('an unknown id refuses the whole list', normalizeStaffCapabilities(['chat', 'godmode']) === null);
check('a non-array refuses', normalizeStaffCapabilities('chat') === null && normalizeStaffCapabilities(null) === null);
check('an empty list is valid (always-granted still apply)', JSON.stringify(normalizeStaffCapabilities([])) === '[]');
check('always-granted ids are accepted but not required', normalizeStaffCapabilities(['safety']) !== null);

// ── Game default → a new code ─────────────────────────────────────────────────
check('no game default = full (today\'s behaviour)', sorted(defaultCodeCapabilities(undefined)) === sorted(STAFF_CAPABILITIES));
check('a game default without score gives a code without score',
  !defaultCodeCapabilities({ capabilities: ['chat', 'review'] }).includes('score'));
check('a malformed stored default falls back to full, never to nothing',
  sorted(defaultCodeCapabilities({ capabilities: ['nope'] as unknown as StaffCapability[] })) === sorted(STAFF_CAPABILITIES));

// ── Resolution: person + code ─────────────────────────────────────────────────
{
  const code = { capabilities: ['chat', 'hold'] as StaffCapability[], disabled: false };
  const grant = { codeId: 'c1', removed: false };
  const a = resolveStaffAccess({ grant, code });
  check('a person on a code may use the code\'s capabilities', staffCan(a, 'chat') && staffCan(a, 'hold'));
  check('and the always-granted ones', staffCan(a, 'safety') && staffCan(a, 'staffChannel') && staffCan(a, 'outline'));
  check('but nothing else (no score)', !staffCan(a, 'score') && !staffCan(a, 'route'));
  check('a person on a code is not legacy', !a.legacy);

  const removed = resolveStaffAccess({ grant: { codeId: 'c1', removed: true }, code });
  check('a removed person may do nothing at all, not even safety', !staffCan(removed, 'safety') && !removed.allowed);

  const disabled = resolveStaffAccess({ grant, code: { ...code, disabled: true } });
  check('a DISABLED code keeps the people already in (it stops new sign-ins only)', staffCan(disabled, 'chat'));

  const noCode = resolveStaffAccess({ grant, code: null });
  check('a grant whose code was deleted grants nothing', !noCode.allowed && !staffCan(noCode, 'safety'));

  const legacy = resolveStaffAccess({ grant: null, code: null });
  check('a staff token from before this change (no grant) is full, and marked legacy',
    legacy.allowed && legacy.legacy && STAFF_CAPABILITIES.every((c) => staffCan(legacy, c)));

  // An invite minted before this change has no `capabilities` field at all. A run in flight at
  // deploy time must not see its staff shrink to "safety only" mid-event.
  const legacyCode = resolveStaffAccess({ grant, code: { disabled: false } });
  check('a code from before this change (no capabilities field) is full, not empty',
    legacyCode.allowed && STAFF_CAPABILITIES.every((c) => staffCan(legacyCode, c)));

  const garbage = resolveStaffAccess({ grant, code: { capabilities: 'score' as unknown as StaffCapability[], disabled: false } });
  check('a malformed stored code list grants only the always-granted set',
    garbage.allowed && staffCan(garbage, 'safety') && !staffCan(garbage, 'score'));
}

// ── The refusal marker (a structured detail, never message text) ──────────────
check('a missing capability is recognised from details',
  staffRefusal({ code: 'functions/permission-denied', details: { reason: STAFF_REFUSAL_REASON.missing, capability: 'score' } }) === 'missing');
check('a removal is recognised from details',
  staffRefusal({ code: 'permission-denied', details: { reason: STAFF_REFUSAL_REASON.removed } }) === 'removed');
check('message text alone is never classified',
  staffRefusal({ code: 'permission-denied', message: 'staff-capability-missing:score' }) === null);
check('junk is total', staffRefusal(null) === null && staffRefusal('x') === null && staffRefusal({ details: 'x' }) === null);

console.log(`\n${failures === 0 ? 'ALL STAFF-CAPABILITY TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
