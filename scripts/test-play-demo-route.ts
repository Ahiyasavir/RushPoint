// Pure-logic tests for the play-web COLD-LAUNCH demo entry (change:
// cold-launch-demo-entry). Run by scripts/run-unit-tests.mjs via `npm test`.
//
// The bug being fixed: play-web has no router and every public entry point is
// URL-driven (`?game=`, `?challenge=`, `?board=`, `?recap=`). A Play Store install
// launches the PWA/TWA with a BARE url, so `resolvePlayRoute` step 10 landed a
// fresh installer on JoinScreen — an access-code prompt with nothing behind it.
// That is a "minimum functionality" rejection risk and a one-star review risk.
//
// The fix adds ONE affordance to that one situation. The invariants pinned here:
//   1. A bare launch (no params, no session) offers the demo.
//   2. A launch WITH a code does NOT — the real join flow is untouched.
//   3. A device already holding a session NEVER sees it (no hijacking a live run).
//   4. Every other public route (promo/board/recap/challenge/tv/staff/legal) is
//      unaffected — the demo is an addition, never a replacement.
import { resolvePlayRoute, type PlayRoute, type SessionRef } from '../apps/play-web/src/lib/playRoute';
import { DEMO_GAME_ID, demoPromoSearch, shouldOfferDemo } from '../apps/play-web/src/lib/demoEntry';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

/** Resolve a URL exactly as App.tsx does, then ask the demo question. */
function offers(search: string, session: SessionRef | null = null, pathname = '/'): boolean {
  const { route } = resolvePlayRoute({ search, session, pathname });
  return shouldOfferDemo(route, !!session);
}

// ── The demo target ──────────────────────────────────────────────────────────
{
  // Must match the FLAGSHIP instant-play demo seeded by
  // scripts/lib/spy-academy-game-def.mjs (GAME_ID) and linked by creator-web's
  // AuthGate. A drift here means the button opens a "game not found" card.
  ok(DEMO_GAME_ID === 'demo-instant-spy', 'demo game id is the flagship instant-play demo');
  ok(demoPromoSearch() === '?game=demo-instant-spy', 'demo search string opens the promo route');
  ok(demoPromoSearch('a b&c') === '?game=a%20b%26c', 'demo search string encodes the game id');
  // The whole design rests on this: the generated search must resolve, through the
  // UNCHANGED resolver, to the existing public promo surface — no new route kind.
  const r = resolvePlayRoute({ search: demoPromoSearch(), session: null });
  ok(r.route.kind === 'promo', 'the demo search resolves to the existing promo route');
  ok(r.route.kind === 'promo' && r.route.gameId === DEMO_GAME_ID, 'promo carries the demo game id');
  ok(r.clearSession === false, 'opening the demo never clears a session');
}

// ── 1. A bare cold launch offers the demo ────────────────────────────────────
{
  ok(offers(''), 'bare launch (empty search) offers the demo');
  ok(offers('?'), 'bare launch (lone ?) offers the demo');
  ok(offers('?utm_source=play_store'), 'a launch carrying only unrelated params still offers the demo');
  ok(offers('?code='), 'an EMPTY code param is still a bare launch');
  ok(offers('?code=%20%20'), 'a whitespace-only code param is still a bare launch');
}

// ── 2. A real join code goes straight to join, with NO demo ──────────────────
{
  ok(!offers('?code=ABC123'), 'a launch WITH a code never offers the demo');
  const { route } = resolvePlayRoute({ search: '?code=ABC123', session: null });
  ok(route.kind === 'join' && route.code === 'ABC123',
    'a launch WITH a code still resolves to join carrying that code (unchanged)');
  ok(!offers('?code=abc123'), 'a lowercase code is a real code, not a bare launch');
}

// ── 3. A device with a session is never offered the demo ─────────────────────
{
  const sess: SessionRef = { code: 'ABC123' };
  ok(!offers('', sess), 'a stored session resumes play — no demo offer');
  ok(!offers('?code=ABC123', sess), 'same-run link resumes play — no demo offer');
  ok(!offers('?code=ZZZ999', sess), 'a DIFFERENT run link rejoins — no demo offer');
  ok(!offers('', { code: 'ABC123', runFinished: true }), 'a finished-run session still blocks the offer');
  // Belt and braces: the decision is false for a `join` route whenever a session
  // exists, even though App only reaches JoinScreen without one.
  ok(!shouldOfferDemo({ kind: 'join', code: null }, true), 'session + bare join route → no offer');
}

// ── 4. Every other public surface is untouched ───────────────────────────────
{
  ok(!offers('?game=some-other-game'), 'a shared promo link shows that game, not the demo offer');
  ok(!offers('?board=ABC123'), 'a public leaderboard link does not offer the demo');
  ok(!offers('?recap=ABC123'), 'a recap link does not offer the demo');
  ok(!offers('?tv=ABC123'), 'a TV board link does not offer the demo');
  ok(!offers('?board=ABC123&ceremony'), 'a ceremony link does not offer the demo');
  ok(!offers('?challenge=g1:t1'), 'a challenge teaser link does not offer the demo');
  ok(!offers('?staff=o.g.r'), 'a staff link never offers a participant demo');
  ok(!offers('', null, '/terms'), 'the terms page does not offer the demo');
  ok(!offers('', null, '/privacy'), 'the privacy page does not offer the demo');

  const kinds: PlayRoute[] = [
    { kind: 'legal', doc: 'terms' },
    { kind: 'staff', ctx: null },
    { kind: 'tv', code: 'C' },
    { kind: 'recap', code: 'C' },
    { kind: 'ceremony', code: 'C' },
    { kind: 'board', code: 'C' },
    { kind: 'challenge', gameId: 'g', taskId: 't' },
    { kind: 'play' },
    { kind: 'promo', gameId: 'g' },
    { kind: 'join', code: 'ABC123' },
  ];
  ok(kinds.every((k) => !shouldOfferDemo(k, false)),
    'the ONLY route that offers the demo is a code-less join');
  ok(shouldOfferDemo({ kind: 'join', code: null }, false), 'code-less join + no session → offer');
}

console.log(failed === 0
  ? `\n✅ ALL PLAY-DEMO-ROUTE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
