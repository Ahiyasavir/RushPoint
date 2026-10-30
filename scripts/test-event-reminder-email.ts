// The event reminder email (change: creator-stays-to-the-end). A reminder of the creator's OWN date, so it
// has to read as a note from us and never as a campaign: one button, no image to load, a reason it arrived,
// a way to stop. And it must go out once, whatever the cron does.
import assert from 'node:assert/strict';
import { formatEventReminderEmail } from '../packages/shared/src/eventReminderEmail';
import { writeEventReminders } from '../functions/src/eventReminders';
import { returnsToReady } from '../apps/creator-web/src/lib/walkEnding';
import { hasRouteToShow } from '../apps/creator-web/src/lib/setupFlow';

const he = formatEventReminderEmail({ title: 'יום הולדת <b>', when: 'd1', gameId: 'g1' });
assert.match(he.subject, /יום הולדת <b>/);
assert.match(he.html, /dir="rtl"/);
assert.ok(he.html.includes('יום הולדת &lt;b&gt;'), 'a creator title is escaped');
assert.ok(!he.html.includes('<b>'), 'a creator title cannot inject markup');
assert.equal((he.html.match(/<a /g) ?? []).length, 2, 'one button and one way to stop, nothing else to click');
assert.ok(he.html.includes('https://creator.rush-point.com/build/g1'));
assert.ok(he.html.includes('https://creator.rush-point.com/settings'));
assert.ok(!/<img/i.test(he.html), 'no image: a tracking pixel look is what reads as a campaign');
assert.ok(he.text.includes('https://creator.rush-point.com/settings'), 'the plain part can stop it too');
for (const when of ['d3', 'd1', 'd0'] as const) {
  const m = formatEventReminderEmail({ title: 'x', when, gameId: 'g' });
  assert.ok(m.subject.length <= 60, m.subject);
  assert.ok(!/!/.test(m.subject), 'no shouting in a subject');
  assert.ok(!/[–—-]/.test(formatEventReminderEmail({ title: 'יום', when, gameId: 'g' }).text.split('https')[0]), 'no dashes in Hebrew');
}
assert.match(formatEventReminderEmail({ title: 'Big day', when: 'd0', gameId: 'g' }).html, /dir="ltr"/, 'an English game gets English');

// The cron.
function fakeDb(games: Record<string, unknown>[], users: Record<string, unknown> = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  Object.entries(users).forEach(([uid, v]) => docs.set(`users/${uid}`, v as Record<string, unknown>));
  const ref = (path: string) => ({
    get: async () => ({ data: () => docs.get(path) }),
    set: async (v: Record<string, unknown>) => { docs.set(path, { ...(docs.get(path) ?? {}), ...v }); },
  });
  const query = { where: () => query, get: async () => ({ docs: games.map((g, i) => ({ id: `g${i}`, ref: { path: `g${i}` }, data: () => g })) }) };
  return { db: { doc: ref, collectionGroup: () => query } as never, docs };
}
const now = new Date('2026-11-01T01:30:00.000Z');
const game = { ownerUid: 'u1', title: 'יום', eventAt: '2026-11-02T10:00:00.000Z' };
const run = async () => {
  const sent: string[] = [];
  const mail = { emailOf: async () => 'a@b.c', send: async (_: unknown, to: string) => { sent.push(to); return true; } };
  return { sent, mail };
};
async function main() {
{
  const { db } = fakeDb([game]);
  const { sent, mail } = await run();
  await writeEventReminders(db, now, mail);
  await writeEventReminders(db, now, mail);
  assert.equal(sent.length, 1, 'a cron that runs twice sends once');
}
{
  const { db } = fakeDb([game], { u1: { eventEmails: false } });
  const { sent, mail } = await run();
  assert.equal(await writeEventReminders(db, now, mail), 1, 'the in-app item still lands');
  assert.equal(sent.length, 0, 'someone who stopped the emails gets none');
}
{
  const { db } = fakeDb([game]);
  const { sent, mail } = await run();
  await writeEventReminders(db, now, { ...mail, emailOf: async () => null });
  assert.equal(sent.length, 0, 'a guest has no address');
}
{
  const { db } = fakeDb([game]);
  let tries = 0;
  const mail = { emailOf: async () => 'a@b.c', send: async () => { tries++; return tries > 1; } };
  await writeEventReminders(db, now, mail);
  await writeEventReminders(db, now, mail);
  assert.equal(tries, 2, 'a send that did not leave is not stamped, so the next run tries again');
}

}

// Coming back to a game that is waiting for its date.
const base = { eventAt: '2026-12-20T10:00:00.000Z', nowIso: '2026-10-30T10:00:00.000Z', path: '/build/g1', search: '', seen: false };
assert.equal(returnsToReady({ ...base, gameId: 'g1' }), true);
assert.equal(returnsToReady({ ...base, gameId: 'g1', seen: true }), false, 'once a visit: then they came to edit');
assert.equal(returnsToReady({ ...base, gameId: 'g1', path: '/build/g1/task/t1' }), false, 'a link to a mission goes to the mission');
assert.equal(returnsToReady({ ...base, gameId: 'g1', search: '?x=1' }), false);
assert.equal(returnsToReady({ ...base, gameId: 'g1', eventAt: '2026-10-30T10:00:00.000Z' }), true, 'today lands on launching it');
assert.equal(returnsToReady({ ...base, gameId: 'g1', eventAt: '2026-10-01T10:00:00.000Z' }), false, 'a date that passed is an ordinary edit');
assert.equal(returnsToReady({ ...base, gameId: 'g1', eventAt: undefined }), false);

// The finish screen's map.
const placed = { coordinates: { lat: 31.7, lng: 35.2 } };
assert.equal(hasRouteToShow([{ tasks: [placed] }] as never), true);
assert.equal(hasRouteToShow([{ tasks: [{}, { coordinates: { lat: 0, lng: 0 } }] }] as never), false, 'an unplaced 0,0 is no route');
assert.equal(hasRouteToShow([] as never), false);
assert.equal(hasRouteToShow(undefined as never), false);

void main().then(() => console.log('ALL EVENT REMINDER TESTS PASSED'), (e) => { console.error(e); process.exit(1); });
