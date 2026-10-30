// The creator notification model (change: creator-engagement-loop). Pure rules only: what an item's
// id is (so a retried write lands on the same document and a day of likes is one item), how many are
// unread, what the red badge says, which player milestones a join crossed, which countdown an event
// date is at, and the night hours a push must wait out.
import {
  notificationId, unreadCount, badgeLabel, milestonesCrossed, nextMilestone, PLAYER_MILESTONES,
  eventCountdownKind, isQuietHour, israelDayKey, shouldNotifyLike, normalizeEventAt, daysUntilEvent,
} from '../packages/shared/src/creatorNotifications';
import { FIRESTORE_PATHS } from '../packages/shared/src/types';
import { notificationView } from '../apps/creator-web/src/lib/notificationView';

let failures = 0;
function ok(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

// ids
ok('first join id is per run', notificationId('firstJoin', { runId: 'r1' }) === 'firstJoin-r1');
ok('a player milestone id carries the milestone', notificationId('players', { runId: 'r1', milestone: 25 }) === 'players-r1-25');
ok('a like id is per game per Israel day', notificationId('liked', { gameId: 'g1', day: '2026-10-29' }) === 'liked-g1-2026-10-29');
ok('an event id is per threshold', notificationId('eventSoon', { gameId: 'g1', threshold: 'd1' }) === 'eventSoon-g1-d1');
ok('an id never contains a slash', !notificationId('copied', { taskId: 'a/b', day: '2026-10-29' }).includes('/'));
ok('paths', FIRESTORE_PATHS.notifications('u1') === 'users/u1/notifications'
  && FIRESTORE_PATHS.notification('u1', 'n1') === 'users/u1/notifications/n1');

// the Israel day, not the UTC day: 23:30 UTC on the 28th is already the 29th in Jerusalem
ok('day key uses Israel time', israelDayKey('2026-10-28T23:30:00.000Z') === '2026-10-29');
ok('day key of junk is null', israelDayKey('nope') === null);

// unread and the badge
const items = [{ createdAt: '2026-10-29T10:00:00.000Z' }, { createdAt: '2026-10-29T12:00:00.000Z' }, { createdAt: '2026-10-28T09:00:00.000Z' }];
ok('never seen: everything is unread', unreadCount(items, null) === 3);
ok('only newer than the stamp is unread', unreadCount(items, '2026-10-29T11:00:00.000Z') === 1);
ok('a junk stamp counts as never seen', unreadCount(items, 'garbage') === 3);
ok('a junk item is not counted', unreadCount([{ createdAt: 'x' } as { createdAt: string }], null) === 0);
ok('no badge at zero', badgeLabel(0) === null);
ok('badge shows the number', badgeLabel(3) === '3');
ok('badge caps at 9+', badgeLabel(14) === '9+');
ok('badge of junk is none', badgeLabel(Number.NaN) === null);

// milestones: goal gradient, never repeated
ok('milestones are ascending', PLAYER_MILESTONES.every((m, i) => i === 0 || m > PLAYER_MILESTONES[i - 1]));
ok('4 to 5 crosses 5', JSON.stringify(milestonesCrossed(4, 5)) === '[5]');
ok('9 to 26 crosses 10 and 25', JSON.stringify(milestonesCrossed(9, 26)) === '[10,25]');
ok('5 to 6 crosses nothing', milestonesCrossed(5, 6).length === 0);
ok('going down crosses nothing', milestonesCrossed(30, 2).length === 0);
ok('next milestone after 7 is 10', nextMilestone(7) === 10);
ok('next milestone after the last is null', nextMilestone(PLAYER_MILESTONES[PLAYER_MILESTONES.length - 1]) === null);

// countdown, in Israel calendar days
const ev = '2026-11-01T08:00:00.000Z'; // 10:00 in Jerusalem on 1.11
ok('three days before', eventCountdownKind(ev, '2026-10-29T07:00:00.000Z') === 'd3');
ok('the day before', eventCountdownKind(ev, '2026-10-31T19:00:00.000Z') === 'd1');
ok('the day itself', eventCountdownKind(ev, '2026-11-01T05:00:00.000Z') === 'd0');
ok('two days before is nothing', eventCountdownKind(ev, '2026-10-30T09:00:00.000Z') === null);
ok('after the event is nothing', eventCountdownKind(ev, '2026-11-02T09:00:00.000Z') === null);
ok('junk date is nothing', eventCountdownKind('soon', '2026-10-30T09:00:00.000Z') === null);

// quiet hours, Israel time: 22:00 to 08:00
ok('23:00 Israel is quiet', isQuietHour('2026-10-29T21:00:00.000Z'));
ok('07:30 Israel is quiet', isQuietHour('2026-10-29T05:30:00.000Z'));
ok('12:00 Israel is not quiet', !isQuietHour('2026-10-29T10:00:00.000Z'));

// likes
ok('a like from someone else notifies', shouldNotifyLike({ likerUid: 'a', ownerUid: 'b' }));
ok('your own like does not', !shouldNotifyLike({ likerUid: 'a', ownerUid: 'a' }));
ok('an unknown owner does not', !shouldNotifyLike({ likerUid: 'a', ownerUid: '' }));

// the event date: what a save may store, and the countdown the dashboard shows
ok('a real date is stored as ISO', normalizeEventAt('2026-11-01T10:00:00+02:00')?.value === '2026-11-01T08:00:00.000Z');
ok('null clears', normalizeEventAt(null)?.value === null);
ok('empty clears', normalizeEventAt('')?.value === null);
ok('junk is refused', normalizeEventAt('next friday') === null);
ok('a number is refused', normalizeEventAt(12 as unknown) === null);
ok('an absurd year is refused', normalizeEventAt('3026-01-01T10:00:00.000Z') === null && normalizeEventAt('1999-01-01T10:00:00.000Z') === null);
ok('days until, in Israel days', daysUntilEvent(ev, '2026-10-29T07:00:00.000Z') === 3);
ok('today is 0', daysUntilEvent(ev, '2026-11-01T21:00:00.000Z') === 0);
ok('a past event is null', daysUntilEvent(ev, '2026-11-02T08:00:00.000Z') === null);
ok('no event is null', daysUntilEvent(undefined, '2026-11-02T08:00:00.000Z') === null);

// what a row says and where it leads
const copy = {
  firstJoin: (p: { game: string; team: string }) => `first:${p.game}:${p.team}`,
  players: (p: { game: string; n: number }) => `players:${p.game}:${p.n}`,
  finished: (p: { game: string; teams: number }) => `finished:${p.game}:${p.teams}`,
  likedGame: (p: { title: string; n: number }) => `likedGame:${p.title}:${p.n}`,
  likedTask: (p: { title: string; n: number }) => `likedTask:${p.title}:${p.n}`,
  copied: (p: { title: string; n: number }) => `copied:${p.title}:${p.n}`,
  rated: (p: { n: number }) => `rated:${p.n}`,
  eventSoon: (p: { game: string; when: string }) => `event:${p.game}:${p.when}`,
};
const at = '2026-10-29T10:00:00.000Z';
const fj = notificationView({ id: 'a', kind: 'firstJoin', createdAt: at, gameId: 'g', runId: 'r', params: { game: 'G', team: 'T' } }, copy);
ok('first join leads to the live run', fj?.text === 'first:G:T' && fj?.href === '/run/g/r');
const fin = notificationView({ id: 'b', kind: 'finished', createdAt: at, gameId: 'g', runId: 'r', params: { game: 'G', teams: 4 } }, copy);
ok('finished opens the moments feed', fin?.href === '/run/g/r?moments=1' && fin?.text === 'finished:G:4');
ok('a liked task counts the likes', notificationView({ id: 'c', kind: 'liked', createdAt: at, count: 3, params: { title: 'M', item: 'task' } }, copy)?.text === 'likedTask:M:3');
ok('an item missing its name is dropped, not drawn broken', notificationView({ id: 'd', kind: 'players', createdAt: at, params: { n: 5 } }, copy) === null);
ok('an unknown kind is dropped', notificationView({ id: 'e', kind: 'mystery' as never, createdAt: at }, copy) === null);
ok('a junk time is dropped', notificationView({ id: 'f', kind: 'rated', createdAt: 'x' }, copy) === null);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\ncreator notifications: all pass');
