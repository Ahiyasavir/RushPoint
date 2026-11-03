// The tour invitation (change: tour-invitation). Ahiya, 3.11: a new user gets a notification right
// away that offers the tour. Who is offered it, and where the offer lives after "later".
import {
  tourInviteVerdict, readTourInviteLater, tourInviteKey, tourStorageKey, TOUR_VERSION,
  TOUR_INVITE_MAX_AGE_DAYS,
} from '../apps/creator-web/src/lib/creatorOnboarding';
import { GUIDANCE_PRIORITY, GUIDANCE_SURFACES, activeGuidance } from '../apps/creator-web/src/lib/builderGuidance';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failed++; };

const DAY = 86_400_000;
const now = Date.parse('2026-11-03T12:00:00.000Z');
const fresh = now - 2 * 60_000;
const v = (o: Partial<Parameters<typeof tourInviteVerdict>[0]>) =>
  tourInviteVerdict({ record: null, later: false, accountCreatedMs: fresh, nowMs: now, ...o });

ok(v({}) === 'card', 'a brand new account (a guest too) is offered the tour on a card');
ok(v({ later: true }) === 'bell', '"later" moves the offer into the bell');
ok(v({ record: { version: TOUR_VERSION, status: 'completed' } }) === 'none', 'a finished tour is never offered again');
ok(v({ record: { version: TOUR_VERSION, status: 'skipped' }, later: true }) === 'none', 'a skipped tour leaves the bell too');
ok(v({ accountCreatedMs: now - (TOUR_INVITE_MAX_AGE_DAYS + 1) * DAY }) === 'none', 'an older account is never interrupted');
ok(v({ accountCreatedMs: now - (TOUR_INVITE_MAX_AGE_DAYS - 1) * DAY }) === 'card', 'a creator in their first days still gets it');
ok(v({ accountCreatedMs: NaN }) === 'none', 'an unknown account age offers nothing (fail closed)');
ok(v({ accountCreatedMs: now + DAY }) === 'none', 'a creation time in the future offers nothing');
ok(tourInviteVerdict(undefined as never) === 'none', 'a malformed call offers nothing and does not throw');

ok(readTourInviteLater('later') === true, 'the stored "later" reads back');
for (const bad of [null, undefined, '', 'yes', '1', '{}']) ok(readTourInviteLater(bad as never) === false, `an unreadable value is not "later": ${JSON.stringify(bad)}`);
ok(tourInviteKey('u1') !== tourInviteKey('u2') && tourInviteKey('u1') !== tourStorageKey('u1'), 'the key is per creator and apart from the tour record');

ok(GUIDANCE_SURFACES.includes('tour-invite') && GUIDANCE_PRIORITY.includes('tour-invite'), 'the card is a ranked guidance surface');
ok(activeGuidance(new Set(['tour-invite', 'quick-setup'])) === 'quick-setup', 'Quick Setup keeps the screen');
ok(activeGuidance(new Set(['tour-invite', 'tour'])) === 'tour', 'the running tour hides its own invitation');
ok(activeGuidance(new Set(['tour-invite', 'spotlight'])) === 'tour-invite', 'the invitation comes before the Builder spotlight');

console.log(failed ? `\n❌ tour invite: ${failed} FAILED` : '\n✅ tour invite: ALL PASS');
process.exit(failed ? 1 : 0);
