// Pure-logic test for the share-link verdicts (change: game-share-link).
//
// A share link decides who may read an UNPUBLISHED game. Everything here is
// therefore checked for the fail-CLOSED property: a link that cannot be
// understood must refuse, never allow. The token shape is checked separately
// because the token is interpolated into a Firestore document path.
//   npx tsx scripts/test-game-share-link.ts
import {
  isValidShareToken, SHARE_TOKEN_PATTERN, SHARE_TOKEN_LENGTH,
  shareLinkRefusal, shareLinkCopyRefusal, shareLinkExpiryIso,
  SHARE_LINK_MAX_EXPIRY_DAYS,
  type GameShareLink,
} from '../packages/shared/src/gameShareLink';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const NOW = '2026-08-29T12:00:00.000Z';
function link(over: Partial<GameShareLink> = {}): GameShareLink {
  return {
    token: 'a'.repeat(SHARE_TOKEN_LENGTH),
    ownerUid: 'owner-1',
    gameId: 'game-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'owner-1',
    allowCopy: true,
    revealAnswers: false,
    viewCount: 0,
    copyCount: 0,
    ...over,
  };
}

// ── Token shape ──────────────────────────────────────────────────────────────
check('accepts a canonical 22-char base64url token', isValidShareToken('Ab3-_xYz0123456789abcd'));
check('canonical length matches the pattern minimum', SHARE_TOKEN_PATTERN.test('a'.repeat(SHARE_TOKEN_LENGTH)));
check('rejects a token with a slash (odd-segment path)', !isValidShareToken('abc/def0123456789abcdef'));
check('rejects a token with a dot', !isValidShareToken('abc.def0123456789abcdef'));
check('rejects a short token', !isValidShareToken('short'));
check('rejects an over-long token', !isValidShareToken('a'.repeat(65)));
check('rejects a non-string', !isValidShareToken(12345678901234567890 as unknown));
check('rejects null', !isValidShareToken(null));
check('rejects undefined', !isValidShareToken(undefined));
check('rejects an object', !isValidShareToken({ token: 'x' }));

// ── Read verdict ─────────────────────────────────────────────────────────────
check('a live link is usable', shareLinkRefusal(link(), NOW) === null);
check('a revoked link refuses as "revoked"', shareLinkRefusal(link({ revokedAt: NOW }), NOW) === 'revoked');
check('an expired link refuses as "expired"',
  shareLinkRefusal(link({ expiresAt: '2026-08-28T00:00:00.000Z' }), NOW) === 'expired');
check('a future expiry is still usable',
  shareLinkRefusal(link({ expiresAt: '2026-09-30T00:00:00.000Z' }), NOW) === null);
check('expiry is inclusive — exactly at the instant it is expired',
  shareLinkRefusal(link({ expiresAt: NOW }), NOW) === 'expired');
check('absent expiresAt means never expires', shareLinkRefusal(link(), '2099-01-01T00:00:00.000Z') === null);

// ── Fail closed on anything unreadable ───────────────────────────────────────
check('undefined document refuses', shareLinkRefusal(undefined, NOW) === 'not-found');
check('null document refuses', shareLinkRefusal(null, NOW) === 'not-found');
check('a string instead of a document refuses', shareLinkRefusal('nope', NOW) === 'not-found');
check('a document with no ownerUid refuses', shareLinkRefusal({ gameId: 'g' }, NOW) === 'not-found');
check('a document with no gameId refuses', shareLinkRefusal({ ownerUid: 'o' }, NOW) === 'not-found');
check('an empty ownerUid refuses', shareLinkRefusal(link({ ownerUid: '   ' }), NOW) === 'not-found');
check('a garbage expiresAt reads as EXPIRED, not as "no expiry"',
  shareLinkRefusal(link({ expiresAt: 'someday' }), NOW) === 'expired');
check('a numeric expiresAt reads as expired',
  shareLinkRefusal(link({ expiresAt: 123 as unknown as string }), NOW) === 'expired');
check('an unparseable "now" reads as expired when the link has an expiry',
  shareLinkRefusal(link({ expiresAt: '2099-01-01T00:00:00.000Z' }), 'not-a-date') === 'expired');
check('revocation is checked BEFORE expiry (the more specific reason wins)',
  shareLinkRefusal(link({ revokedAt: NOW, expiresAt: '2020-01-01T00:00:00.000Z' }), NOW) === 'revoked');

// ── Copy verdict ─────────────────────────────────────────────────────────────
check('a live copyable link allows a copy', shareLinkCopyRefusal(link(), NOW) === null);
check('allowCopy=false refuses with its own reason',
  shareLinkCopyRefusal(link({ allowCopy: false }), NOW) === 'copy-not-allowed');
check('a missing allowCopy field fails closed',
  shareLinkCopyRefusal({ ownerUid: 'o', gameId: 'g' }, NOW) === 'copy-not-allowed');
check('a truthy-but-not-true allowCopy fails closed',
  shareLinkCopyRefusal(link({ allowCopy: 1 as unknown as boolean }), NOW) === 'copy-not-allowed');
check('a revoked link reports "revoked", not "copy-not-allowed"',
  shareLinkCopyRefusal(link({ revokedAt: NOW, allowCopy: true }), NOW) === 'revoked');
check('an expired link reports "expired", not "copy-not-allowed"',
  shareLinkCopyRefusal(link({ expiresAt: '2020-01-01T00:00:00.000Z' }), NOW) === 'expired');
check('an unreadable document reports "not-found" from the copy path too',
  shareLinkCopyRefusal(null, NOW) === 'not-found');

// ── Expiry computation ───────────────────────────────────────────────────────
check('30 days from creation', shareLinkExpiryIso('2026-08-01T00:00:00.000Z', 30) === '2026-08-31T00:00:00.000Z');
check('a fractional day count floors', shareLinkExpiryIso('2026-08-01T00:00:00.000Z', 1.9) === '2026-08-02T00:00:00.000Z');
check('undefined days means never', shareLinkExpiryIso(NOW, undefined) === undefined);
check('zero days means never (never an instant expiry)', shareLinkExpiryIso(NOW, 0) === undefined);
check('a negative day count means never', shareLinkExpiryIso(NOW, -5) === undefined);
check('NaN means never', shareLinkExpiryIso(NOW, Number.NaN) === undefined);
check('a string day count means never', shareLinkExpiryIso(NOW, '30') === undefined);
check('beyond the cap means never (not an unbounded life)',
  shareLinkExpiryIso(NOW, SHARE_LINK_MAX_EXPIRY_DAYS + 1) === undefined);
check('exactly the cap is honored', typeof shareLinkExpiryIso(NOW, SHARE_LINK_MAX_EXPIRY_DAYS) === 'string');
check('an unparseable creation instant means never', shareLinkExpiryIso('whenever', 30) === undefined);

// A link created with an expiry is live the moment it is created.
const created = '2026-08-29T12:00:00.000Z';
const expires = shareLinkExpiryIso(created, 7)!;
check('a freshly created 7-day link is usable now', shareLinkRefusal(link({ expiresAt: expires }), created) === null);
check('...and refuses one instant after it lapses',
  shareLinkRefusal(link({ expiresAt: expires }), '2026-09-05T12:00:00.001Z') === 'expired');

console.log(`\n${failures === 0 ? 'ALL GAME-SHARE-LINK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
