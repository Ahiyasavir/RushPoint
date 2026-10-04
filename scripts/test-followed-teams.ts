// "הקבוצות שלי": teams a person follows in the run console and the staff app (change: followed-teams).
//
// Ahiya, 2026-09-30: the counsellors and the operator follow a few teams they choose, with quick access
// and control, very simple, and see them on the map in a different colour. The list, the one status a
// card shows, and the one action it offers are pure here so both apps render the same verdicts.
import {
  MAX_FOLLOWED, readFollowed, toggleFollowed, neighbourFollowed,
  followedTeamStatus, followedTeamAction, sortFollowedFirst, teamMarkerLook, FOLLOWED_MARKER_COLOR,
} from '../packages/shared/src/followedTeams';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}
const j = (x: unknown) => JSON.stringify(x);

// ── the list ────────────────────────────────────────────────────────────────
const known = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
check('reads a stored list, keeping only teams still in the run', j(readFollowed('["a","zz","b"]', known)) === j(['a', 'b']));
check('drops duplicates and non-strings', j(readFollowed('["a","a",3,null,"c"]', known)) === j(['a', 'c']));
check(`caps at ${MAX_FOLLOWED}`, readFollowed(JSON.stringify(known), known).length === MAX_FOLLOWED && MAX_FOLLOWED === 8);
check('junk storage reads as empty', j(readFollowed('{oops', known)) === '[]' && j(readFollowed(null, known)) === '[]');
check('an unknown roster keeps the stored ids (teams not loaded yet)', j(readFollowed('["a","zz"]', null)) === j(['a', 'zz']));

check('toggle adds a team', j(toggleFollowed(['a'], 'b')) === j({ list: ['a', 'b'] }));
check('toggle removes a followed team', j(toggleFollowed(['a', 'b'], 'a')) === j({ list: ['b'] }));
const full = known.slice(0, 8);
check('a full list refuses a ninth team and says why', j(toggleFollowed(full, 'i')) === j({ list: full, refused: 'full' }));
check('a full list still lets a team be removed', toggleFollowed(full, 'a').list.length === 7);

check('next followed team', neighbourFollowed(['a', 'b', 'c'], 'a', 1) === 'b');
check('previous wraps around', neighbourFollowed(['a', 'b', 'c'], 'a', -1) === 'c');
check('next wraps around', neighbourFollowed(['a', 'b', 'c'], 'c', 1) === 'a');
check('no neighbour for a team not followed, or a list of one', neighbourFollowed(['a', 'b'], 'x', 1) === null && neighbourFollowed(['a'], 'a', 1) === null);

check('followed teams first, in follow order, the rest keep their order',
  j(sortFollowedFirst([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], ['c', 'a']).map((t) => t.id)) === j(['c', 'a', 'b', 'd']));

// ── one status per card ─────────────────────────────────────────────────────
const NOW = Date.parse('2026-09-30T10:00:00.000Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const playing = { id: 't', launched: true };
const st = (team: object, extra: object = {}) => followedTeamStatus({ team: team as never, nowMs: NOW, ...extra });

check('a team playing normally is neutral', j(st(playing)) === j({ kind: 'playing', tone: 'neutral' }));
check('an SOS outranks everything and is red', st({ ...playing, held: true, outOfBounds: true }, { sosTeamIds: ['t'] }).kind === 'sos'
  && st(playing, { sosTeamIds: ['t'] }).tone === 'alert');
check('removed comes right after an SOS', st({ ...playing, removed: true, outOfBounds: true }).kind === 'removed');
check('out of bounds is red', j(st({ ...playing, outOfBounds: true })) === j({ kind: 'outOfBounds', tone: 'alert' }));
check('a mission photo waiting for approval is amber, with its age',
  j(st({ ...playing, taskSubmissions: { m1: { status: 'pending', submittedAt: ago(40) } } }))
  === j({ kind: 'waitingReview', tone: 'warn', waiting: { kind: 'task', id: 'm1', ageMs: 40_000 } }));
check('the OLDEST waiting item is the one shown (a flash claim here)',
  j(st({ ...playing, taskSubmissions: { m1: { status: 'pending', submittedAt: ago(10) } }, flashClaims: { f1: { status: 'submitted', submittedAt: ago(90) } } }).waiting)
  === j({ kind: 'flash', id: 'f1', ageMs: 90_000 }));
check('an approved or rejected submission is not waiting', st({ ...playing, taskSubmissions: { m1: { status: 'approved', submittedAt: ago(10) } } }).kind === 'playing');
check('stuck (as the caller judged it) is amber', j(st(playing, { stuck: true })) === j({ kind: 'stuck', tone: 'warn' }));
check('paused is amber', j(st({ ...playing, held: true })) === j({ kind: 'held', tone: 'warn' }));
check('waiting to start is neutral (not a problem)', j(st({ id: 't', launched: false })) === j({ kind: 'notStarted', tone: 'neutral' }));
check('finished is neutral', st({ ...playing, status: 'finished' }).kind === 'finished');
check('junk never throws and reads as playing', st(null as never).kind === 'playing');

// ── one action per card, only if the person may take it ────────────────────
const all = { review: true, route: true, hold: true, start: true, safety: true };
const waiting = st({ ...playing, taskSubmissions: { m1: { status: 'pending', submittedAt: ago(40) } } });
check('waiting for approval ⇒ approve that item', j(followedTeamAction(waiting, all)) === j({ kind: 'approve', item: { kind: 'task', id: 'm1' } }));
check('no review permission ⇒ no approve button', followedTeamAction(waiting, { ...all, review: false }) === null);
check('SOS ⇒ open the alert (safety)', j(followedTeamAction(st(playing, { sosTeamIds: ['t'] }), all)) === j({ kind: 'openAlert' }));
check('paused ⇒ resume (hold)', j(followedTeamAction(st({ ...playing, held: true }), all)) === j({ kind: 'resume' })
  && followedTeamAction(st({ ...playing, held: true }), { ...all, hold: false }) === null);
check('waiting to start ⇒ start (organizer only)', j(followedTeamAction(st({ id: 't', launched: false }), all)) === j({ kind: 'start' })
  && followedTeamAction(st({ id: 't', launched: false }), { ...all, start: false }) === null);
check('a sealed current mission ⇒ let them in (route)',
  j(followedTeamAction(st(playing), all, { sealedTaskId: 'm9' })) === j({ kind: 'letIn', taskId: 'm9' })
  && followedTeamAction(st(playing), { ...all, route: false }, { sealedTaskId: 'm9' }) === null);
check('playing normally ⇒ no action (the card only opens the team page)', followedTeamAction(st(playing), all) === null);
check('removed or finished ⇒ no action', followedTeamAction(st({ ...playing, removed: true }), all) === null
  && followedTeamAction(st({ ...playing, status: 'finished' }), all, { sealedTaskId: 'm9' }) === null);

// ── on the map ─────────────────────────────────────────────────────────────
check('a followed team is drawn as followed, on top', j(teamMarkerLook('a', ['a'], false)) === j({ followed: true, dimmed: false, zIndex: 2 }));
check('others are normal while "mine only" is off', j(teamMarkerLook('b', ['a'], false)) === j({ followed: false, dimmed: false, zIndex: 1 }));
check('"mine only" dims the others, never the followed', teamMarkerLook('b', ['a'], true).dimmed === true && teamMarkerLook('a', ['a'], true).dimmed === false);
check('the followed colour is not a warning colour (no amber/red)', !/^#(f|e|d)[0-9a-f]{2}[0-4]/i.test(FOLLOWED_MARKER_COLOR) && FOLLOWED_MARKER_COLOR === '#4f46e5');

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
