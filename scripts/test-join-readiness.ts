// The join form's readiness verdict (change: join-button-never-dead).
//
// The most consequential button in the participant app — a group standing in a
// car park with one phone and a host waiting — used to be `disabled` whenever
// anything required was blank, and a disabled button explains NOTHING. It cannot
// even fire a click, so the submit path that highlights the missing field was
// unreachable by construction. A player who filled the team name and left the
// member row empty tapped the big orange button and it simply did not respond.
//
// The fix is not a better disabled state: it is to keep the button live and make
// it ANSWER. These assertions pin what the answer is.
import { joinReadiness, MEMBER_NAME_FIELD_ID } from '../apps/play-web/src/lib/joinReadiness';

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const base = { isSolo: false, members: [''], teamName: '', emptyFieldIds: [] as string[] };

console.log('\n[join readiness] a complete form is ready');
{
  const v = joinReadiness({ ...base, members: ['דנה'], teamName: 'הנמרים' });
  ok(v.ready, 'team mode with a team name and one member is ready');
  ok(v.missingIds.length === 0 && v.focusId === null && v.reason === null,
    'and reports nothing missing');
  const solo = joinReadiness({ ...base, isSolo: true, members: ['דנה'] });
  ok(solo.ready, 'solo mode needs no team name');
}

console.log('\n[join readiness] whitespace is not an answer');
{
  ok(!joinReadiness({ ...base, members: ['   '], teamName: 'הנמרים' }).ready,
    'a member row of spaces does not count as a name');
  ok(!joinReadiness({ ...base, members: ['דנה'], teamName: '  ' }).ready,
    'a team name of spaces does not count either — the old disabled-button check used the same trim, so this is the state where the button went dead');
}

console.log('\n[join readiness] every missing field is named, not just the first');
{
  const v = joinReadiness({ ...base, emptyFieldIds: ['phone', 'grade'] });
  ok(v.missingIds.includes('teamName'), 'the team name is listed');
  ok(v.missingIds.includes(MEMBER_NAME_FIELD_ID), 'the member name is listed');
  ok(v.missingIds.includes('phone') && v.missingIds.includes('grade'),
    'and so is every empty custom field — the player fixes them in one pass instead of discovering them one tap at a time');
}

console.log('\n[join readiness] focus goes to the FIRST missing field in visual order');
{
  ok(joinReadiness({ ...base, emptyFieldIds: ['phone'] }).focusId === 'teamName',
    'team name first — it is the topmost card');
  ok(joinReadiness({ ...base, teamName: 'הנמרים', emptyFieldIds: ['phone'] }).focusId === MEMBER_NAME_FIELD_ID,
    'then the member name');
  ok(joinReadiness({ ...base, teamName: 'הנמרים', members: ['דנה'], emptyFieldIds: ['phone'] }).focusId === 'phone',
    'then the custom fields — so the focus jump is always forward, never back past something already filled');
}

console.log('\n[join readiness] the reason picks the right sentence');
{
  ok(joinReadiness({ ...base, members: ['דנה'] }).reason === 'teamName',
    'missing team name ⇒ the team-name sentence');
  ok(joinReadiness({ ...base, teamName: 'הנמרים' }).reason === 'memberName',
    'missing member name ⇒ the name sentence');
  ok(joinReadiness({ ...base, teamName: 'הנמרים', members: ['דנה'], emptyFieldIds: ['phone'] }).reason === 'field',
    'only custom fields left ⇒ the required-fields sentence');
  ok(joinReadiness({ ...base, isSolo: true }).reason === 'memberName',
    'solo mode never asks for a team name, even with one blank');
  ok(!joinReadiness({ ...base, isSolo: true }).missingIds.includes('teamName'),
    'and never marks the team-name field, which is not on screen in solo mode');
}

console.log('\n[join readiness] the verdict is total');
{
  const junk = joinReadiness({
    isSolo: false,
    members: [null as unknown as string, undefined as unknown as string],
    teamName: null as unknown as string,
    emptyFieldIds: [null as unknown as string, '', 'ok'],
  });
  ok(junk.ready === false, 'malformed input fails CLOSED — it never lets an incomplete join through');
  ok(junk.missingIds.includes('ok') && !junk.missingIds.includes(''),
    'and it drops junk ids rather than trying to focus an empty selector');
  const noMembers = joinReadiness({ ...base, members: undefined as unknown as string[], teamName: 'x' });
  ok(noMembers.ready === false && noMembers.reason === 'memberName',
    'a missing members array is treated as no names, not as a crash');
  ok(joinReadiness({ ...base, members: ['a'], teamName: 'b', emptyFieldIds: undefined as unknown as string[] }).ready,
    'a missing emptyFieldIds array is treated as nothing missing');
}

console.log('\n[join readiness] no duplicate ids reach the highlight set');
{
  const v = joinReadiness({ ...base, emptyFieldIds: ['phone', 'phone', 'teamName'] });
  const seen = new Set(v.missingIds);
  ok(seen.size === v.missingIds.length,
    'ids are unique — a field listed twice must not be counted twice');
}

console.log(failures === 0 ? '\n✅ join readiness: ALL PASS\n' : `\n❌ join readiness: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
