// Pure tests for "add a phone" with one scan (change: team-phones-simple, D1).
//
// A second phone used to need TWO codes typed by hand (the run code and the team's device code),
// in a car park, by someone who had not seen either before. The team phone now shows a QR / link
// `?code=<RUN>&join=<DEVICECODE>`; this file pins how that link is parsed and built.
//   npx tsx scripts/test-device-deep-link.ts
import { resolvePlayRoute } from '../apps/play-web/src/lib/playRoute';
import { buildDeviceJoinLink, normalizeDeviceCode } from '../apps/play-web/src/lib/deviceJoinLink';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const route = (search: string, session: { code?: string } | null = null) =>
  resolvePlayRoute({ search, session: session as never, hasStaffSession: false, pathname: '/' });

// ── parse ─────────────────────────────────────────────────────────────────────
{
  const r = route('?code=ABC123&join=xy7k2p');
  check('a device link routes to join with the device code, normalised',
    r.route.kind === 'join' && r.route.code === 'ABC123' && r.route.deviceCode === 'XY7K2P', JSON.stringify(r.route));
  const plain = route('?code=ABC123');
  check('a plain run link carries no device code', plain.route.kind === 'join' && plain.route.deviceCode === undefined,
    JSON.stringify(plain.route));
  const junk = route('?code=ABC123&join=%20%E2%80%8F-!!');
  check('a device code that normalises to nothing is ignored, the run code still works',
    junk.route.kind === 'join' && junk.route.deviceCode === undefined && junk.route.code === 'ABC123', JSON.stringify(junk.route));
  const alone = route('?join=XY7K2P');
  check('a device code WITHOUT a run code means nothing (no route change)', alone.route.kind === 'join' && alone.route.code === null
    && alone.route.deviceCode === undefined, JSON.stringify(alone.route));
  const resume = route('?code=ABC123&join=XY7K2P', { code: 'ABC123' });
  check('a phone already in THIS run resumes instead of re-joining (re-scanning never costs progress)',
    resume.route.kind === 'play' && resume.clearSession === false, JSON.stringify(resume));
  const other = route('?code=NEW999&join=XY7K2P', { code: 'ABC123' });
  check('a phone in ANOTHER run follows the link', other.route.kind === 'join' && other.route.deviceCode === 'XY7K2P' && other.clearSession === true,
    JSON.stringify(other));
}

// ── normalise ─────────────────────────────────────────────────────────────────
check('normalise uppercases and strips noise', normalizeDeviceCode(' xy-7k 2p ') === 'XY7K2P', normalizeDeviceCode(' xy-7k 2p '));
check('normalise refuses non-strings', normalizeDeviceCode(undefined) === '' && normalizeDeviceCode(42) === '');
check('normalise caps the length', normalizeDeviceCode('A'.repeat(40)).length <= 12);

// ── build ─────────────────────────────────────────────────────────────────────
{
  const link = buildDeviceJoinLink('https://player.rush-point.com', 'abc123', 'xy7k2p');
  check('the link carries both codes, normalised', link === 'https://player.rush-point.com/?code=ABC123&join=XY7K2P', link);
  const round = new URL(link);
  const back = route(round.search);
  check('a built link parses back to the same codes', back.route.kind === 'join' && back.route.code === 'ABC123' && back.route.deviceCode === 'XY7K2P');
  check('a trailing slash on the origin is not doubled', buildDeviceJoinLink('https://x.test/', 'A', 'B') === 'https://x.test/?code=A&join=B');
}

console.log(`\n${failures === 0 ? 'ALL DEVICE-DEEP-LINK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
