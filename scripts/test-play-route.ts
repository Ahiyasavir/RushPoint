// Pure-logic tests for the play-web deep-link resolver (wave-e / task 12).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// Two bugs live here and must never come back:
//  1. A STAFF deep link resolving to the PLAYER view. The old link shape used a
//     bare `?staff` flag plus `&game=<gameId>` — the same `game` key the public
//     promo route uses — so any dropped flag (or any moment `staffMode` state
//     flipped false) re-resolved the identical URL as GamePromoScreen, which
//     offers instant play and silently turns a marshal into a participant.
//  2. A PLAYER deep link losing to a stale localStorage session — scanning a new
//     game's QR reopened the previous run.
//
// The resolver is therefore the single authority: URL beats persisted state.
import {
  resolvePlayRoute,
  resumeOrJoin,
  parseStaffParam,
  buildStaffParam,
  stripStaffParams,
  type SessionRef,
} from '../apps/play-web/src/lib/playRoute';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const sess = (code: string): SessionRef => ({ code });

// ── parseStaffParam / buildStaffParam ────────────────────────────────────────
{
  const ctx = parseStaffParam('own1.game1.run1');
  ok(ctx?.ownerUid === 'own1' && ctx?.gameId === 'game1' && ctx?.runId === 'run1', 'staff triple parses');
  ok(buildStaffParam('o', 'g', 'r') === 'o.g.r', 'staff param builds as a dotted triple');
  const rt = parseStaffParam(buildStaffParam('ab-CD_1', 'g_2-x', 'r3'));
  ok(rt?.ownerUid === 'ab-CD_1' && rt?.gameId === 'g_2-x' && rt?.runId === 'r3', 'round-trips ids with - and _');
  ok(parseStaffParam('') === null, 'empty staff value → null ctx');
  ok(parseStaffParam(null) === null, 'null staff value → null ctx');
  ok(parseStaffParam('o.g') === null, 'too few segments → null ctx');
  ok(parseStaffParam('o.g.r.x') === null, 'too many segments → null ctx');
  ok(parseStaffParam('o..r') === null, 'empty middle segment → null ctx');
  ok(parseStaffParam('  o.g.r  ') !== null, 'surrounding whitespace tolerated');
}

// ── Staff routing: the reported bug ──────────────────────────────────────────
{
  const r = resolvePlayRoute({ search: '?staff=o.g.r', session: null });
  ok(r.route.kind === 'staff', 'new single-param staff link → staff');
  ok(r.route.kind === 'staff' && r.route.ctx?.runId === 'r', 'staff ctx carried from the link');
  ok(r.clearSession === false, 'staff route never clears a player session');
}
{
  const r = resolvePlayRoute({ search: '?staff&owner=o&game=g&run=r', session: null });
  ok(r.route.kind === 'staff', 'LEGACY staff link still routes to staff (printed QRs in the wild)');
  ok(r.route.kind === 'staff' && r.route.ctx?.ownerUid === 'o' && r.route.ctx?.gameId === 'g' && r.route.ctx?.runId === 'r',
    'legacy staff ctx assembled from owner/game/run');
}
{
  // THE regression guard: `game` must never be read as a promo id on a staff route.
  const a = resolvePlayRoute({ search: '?staff&game=g', session: null });
  ok(a.route.kind === 'staff', 'partial legacy staff link → staff, NOT promo (no session)');
  const b = resolvePlayRoute({ search: '?staff&game=g', session: sess('ABC123') });
  ok(b.route.kind === 'staff', 'partial legacy staff link → staff, NOT promo (with session)');
  const c = resolvePlayRoute({ search: '?staff&owner=o&game=g&run=r', session: sess('ABC123') });
  ok(c.route.kind === 'staff', 'a leftover player session never beats a staff link');
  ok(c.clearSession === false, 'a staff link does not wipe the player session');
}
{
  const r = resolvePlayRoute({ search: '?staff=broken', session: null });
  ok(r.route.kind === 'staff' && r.route.ctx === null, 'malformed staff value → staff manual entry, never a player route');
}
{
  const r = resolvePlayRoute({ search: '', session: null, hasStaffSession: true });
  ok(r.route.kind === 'staff', 'a stored staff session boots into staff mode with no params');
  ok(r.route.kind === 'staff' && r.route.ctx === null, 'stored staff session carries no URL ctx');
}
// ── A stored staff session must NOT hijack an explicit ?code= player link ─────
// The reported P0: a tester signs into the staff console once (staff session
// persists in localStorage until an explicit logout), then scans ANY player/test
// QR (`?code=`). The URL is authoritative — a player-join link must land on the
// code-prefilled JoinScreen, NOT the staff console. Only a `?staff=` PARAM (a real
// staff intent in the URL) may outrank the code; a mere stored session may not.
{
  const r = resolvePlayRoute({ search: '?code=NEW999', session: null, hasStaffSession: true });
  ok(r.route.kind === 'join', 'an explicit ?code= link BEATS a stored staff session (URL is authoritative)');
  ok(r.route.kind === 'join' && r.route.code === 'NEW999', 'and it carries the code so JoinScreen prefills it');
}
{
  // Whitespace/case survives the staff-session override for prefill.
  const r = resolvePlayRoute({ search: '?code=+play01+', session: null, hasStaffSession: true });
  ok(r.route.kind === 'join' && r.route.code === 'PLAY01', 'code is normalised (trim+upper) even past a stored staff session');
}
{
  // A stored staff session + a code + a leftover player session for a DIFFERENT run:
  // still a player join carrying the code, and the stale player session is cleared.
  const r = resolvePlayRoute({ search: '?code=NEW999', session: sess('OLD111'), hasStaffSession: true });
  ok(r.route.kind === 'join' && r.route.code === 'NEW999', 'code link past a staff session + stale player session → join with code');
  ok(r.clearSession === true, 'and the stale player session is still cleared');
}
{
  // A real staff PARAM in the URL still outranks a code (unchanged) — staff intent
  // lives in the link, not just in storage.
  const r = resolvePlayRoute({ search: '?staff=o.g.r&code=C', session: null, hasStaffSession: true });
  ok(r.route.kind === 'staff', 'a ?staff= PARAM still beats a code, even with a stored staff session');
}
{
  // No code → a stored staff session still boots to staff (the non-join case is unchanged).
  const r = resolvePlayRoute({ search: '?tv=T', session: null, hasStaffSession: true });
  ok(r.route.kind === 'staff', 'without a code link, a stored staff session still outranks other params');
}

// ── stripStaffParams — the exit path that used to land on the promo ──────────
{
  ok(stripStaffParams('?staff=o.g.r') === '', 'exit strips the single staff param');
  ok(stripStaffParams('?staff&owner=o&game=g&run=r') === '', 'exit strips EVERY legacy staff param incl. game');
  ok(stripStaffParams('?staff&owner=o&game=g&run=r&code=ABC') === '?code=ABC', 'exit keeps unrelated params');
  ok(stripStaffParams('') === '', 'exit on a clean URL is a no-op');
  // The whole point: what is left must not re-resolve to the player promo.
  const left = stripStaffParams('?staff&owner=o&game=g&run=r');
  ok(resolvePlayRoute({ search: left, session: null }).route.kind === 'join',
    'after staff exit the URL resolves to join, NOT the promo/instant-play screen');
}

// ── Stale session vs a player deep link (issue 3) ────────────────────────────
{
  const r = resolvePlayRoute({ search: '?code=NEW999', session: sess('OLD111') });
  ok(r.clearSession === true, 'a DIFFERENT code in the URL clears the stale session');
  ok(r.route.kind === 'join' && r.route.code === 'NEW999', 'and routes to join with the new code');
}
{
  const r = resolvePlayRoute({ search: '?code=SAME01', session: sess('SAME01') });
  ok(r.clearSession === false, 'the SAME code is a no-op resume — in-progress runs are never dropped');
  ok(r.route.kind === 'play', 'same code resumes straight into play');
}
{
  const r = resolvePlayRoute({ search: '?code=same01', session: sess('  SAME01 ') });
  ok(r.clearSession === false && r.route.kind === 'play', 'code match is case/whitespace insensitive');
}
{
  const r = resolvePlayRoute({ search: '', session: sess('OLD111') });
  ok(r.clearSession === false && r.route.kind === 'play', 'no code in the URL → the stored session resumes');
}
{
  const r = resolvePlayRoute({ search: '?code=NEW999', session: null });
  ok(r.clearSession === false && r.route.kind === 'join' && r.route.code === 'NEW999', 'code with no session → prefilled join');
}
{
  const r = resolvePlayRoute({ search: '?code=NEW999', session: { code: 'OLD111', runFinished: true } });
  ok(r.clearSession === true && r.route.kind === 'join', 'a finished stale run is cleared by a new code');
}
{
  const r = resolvePlayRoute({ search: '?code=SAME01', session: { code: 'SAME01', runFinished: true } });
  ok(r.clearSession === false && r.route.kind === 'play',
    'a FINISHED run with the same code still resumes — the player keeps their result screen');
}
{
  const r = resolvePlayRoute({ search: '?code=', session: sess('OLD111') });
  ok(r.clearSession === false && r.route.kind === 'play', 'an empty code param is not a join intent');
}
{
  // A player QR must beat the promo when both are present.
  const r = resolvePlayRoute({ search: '?game=G1&code=NEW999', session: null });
  ok(r.route.kind === 'join' && r.route.code === 'NEW999', 'explicit code beats the promo param');
}

// ── The other routes (marketing surfaces must not regress) ───────────────────
{
  ok(resolvePlayRoute({ search: '?tv=ABC', session: null }).route.kind === 'tv', '?tv → tv');
  ok(resolvePlayRoute({ search: '?recap=ABC', session: null }).route.kind === 'recap', '?recap → recap');
  ok(resolvePlayRoute({ search: '?board=ABC', session: null }).route.kind === 'board', '?board → board');
  ok(resolvePlayRoute({ search: '?board=ABC&ceremony', session: null }).route.kind === 'ceremony', '?board&ceremony → ceremony');
  ok(resolvePlayRoute({ search: '?ceremony', session: null }).route.kind === 'join', 'ceremony without a board is not a route');
  ok(resolvePlayRoute({ search: '?game=G1', session: null }).route.kind === 'promo', '?game → promo');
  ok(resolvePlayRoute({ search: '?game=G1', session: sess('A') }).route.kind === 'play', 'promo yields to an active session');
  ok(resolvePlayRoute({ search: '?challenge=g:t', session: null }).route.kind === 'challenge', '?challenge → challenge');
  ok(resolvePlayRoute({ search: '?challenge=g:t', session: sess('A') }).route.kind === 'play', 'challenge yields to an active session');
  ok(resolvePlayRoute({ search: '?challenge=bogus', session: null }).route.kind === 'join', 'malformed challenge falls through');
  ok(resolvePlayRoute({ search: '', session: null }).route.kind === 'join', 'bare URL → join');
  ok(resolvePlayRoute({ search: '?board=', session: null }).route.kind === 'join', 'empty board value is not a route');
}

// ── resumeOrJoin: an already-joined player dismissing an overlay (finding #1) ──
// A player WITH a session opens a shared ?board=/?recap= link (dropped in team
// chat), taps "join" → the overlay is dismissed but its route.kind stays board/
// recap (the resolver never downgrades those to `play` for a joined device). The
// bottom render must RESUME their game, not strand them on a blank JoinScreen.
{
  const boardRoute = resolvePlayRoute({ search: '?board=ABC', session: sess('MYCODE') }).route;
  ok(boardRoute.kind === 'board', 'a joined player on a ?board= link still resolves to the board overlay');
  ok(resumeOrJoin(boardRoute, true) === 'play',
    'dismissing a board overlay with a live session RESUMES play, not JoinScreen');

  const recapRoute = resolvePlayRoute({ search: '?recap=ABC', session: sess('MYCODE') }).route;
  ok(resumeOrJoin(recapRoute, true) === 'play',
    'dismissing a recap overlay with a live session RESUMES play');

  // The legitimate no-session path must NOT regress: a visitor with no session who
  // dismisses an informational overlay still lands on the join screen.
  ok(resumeOrJoin(resolvePlayRoute({ search: '?board=ABC', session: null }).route, false) === 'join',
    'a visitor with NO session dismissing a board overlay still gets JoinScreen');
  ok(resumeOrJoin({ kind: 'join', code: null }, false) === 'join', 'no session + join route → join');
  ok(resumeOrJoin({ kind: 'play' }, true) === 'play', 'the plain play route always resumes play');
}

// ── Precedence sweep (the table, top to bottom) ──────────────────────────────
{
  const all = 'staff=o.g.r&tv=T&recap=R&board=B&ceremony&challenge=g:t&game=G&code=C';
  const drop = (s: string, key: string) =>
    s.split('&').filter((p) => p.split('=')[0] !== key).join('&');
  let q = all;
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'staff', 'precedence 1: staff');
  q = drop(q, 'staff');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'tv', 'precedence 2: tv');
  q = drop(q, 'tv');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'recap', 'precedence 3: recap');
  q = drop(q, 'recap');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'ceremony', 'precedence 4: ceremony');
  q = drop(q, 'ceremony');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'board', 'precedence 5: board');
  q = drop(q, 'board');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'challenge', 'precedence 6: challenge');
  q = drop(q, 'challenge');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'join', 'precedence 7: join code');
  q = drop(q, 'code');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'promo', 'precedence 8: promo');
  q = drop(q, 'game');
  ok(resolvePlayRoute({ search: `?${q}`, session: null }).route.kind === 'join', 'precedence 9: bare join');
}
// Staff outranks everything even with a live session in play.
ok(resolvePlayRoute({ search: '?staff=o.g.r&tv=T&board=B&game=G&code=C', session: sess('C') }).route.kind === 'staff',
  'staff outranks every other param and an active session');

console.log(failed === 0
  ? `\n✅ ALL PLAY-ROUTE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
