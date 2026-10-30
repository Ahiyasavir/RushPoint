// Creators stay to the end of the build (change: creator-stays-to-the-end).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pickHighlights, buildMsLeft, BUILD_MS, MAX_HIGHLIGHTS } from '../apps/creator-web/src/lib/quickStart';
import { walkEnding, calendarUrl } from '../apps/creator-web/src/lib/walkEnding';
import { FUNNEL_EVENTS } from '../apps/creator-web/src/lib/track';

// The feed: first and last always, in order, at most five, and a small game shows everything.
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);
assert.deepEqual(pickHighlights(ids(3)), ids(3));
assert.deepEqual(pickHighlights(ids(5)), ids(5));
const h = pickHighlights(ids(16));
assert.equal(h.length, MAX_HIGHLIGHTS);
assert.equal(h[0], 'm0');
assert.equal(h[h.length - 1], 'm15');
assert.equal(new Set(h).size, h.length);
assert.deepEqual(h, [...h].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
assert.deepEqual(pickHighlights([]), []);

// The building moment is one moment: time already shown counts, and a bad clock never stalls it.
assert.equal(buildMsLeft(1000, 1000), BUILD_MS);
assert.equal(buildMsLeft(1000, 1500), BUILD_MS - 500);
assert.equal(buildMsLeft(1000, 1000 + BUILD_MS + 5), 0);
assert.equal(buildMsLeft(undefined, 1000), BUILD_MS);
assert.equal(buildMsLeft(9000, 1000), BUILD_MS, 'a clock that moved back shows the whole moment');
assert.equal(buildMsLeft('x', 1000), BUILD_MS);

// The ending follows the date, by calendar day.
const now = '2026-11-01T09:00:00.000Z';
assert.equal(walkEnding(undefined, now), 'noDate');
assert.equal(walkEnding(null, now), 'noDate');
assert.equal(walkEnding('garbage', now), 'noDate');
assert.equal(walkEnding('2026-11-01T10:00:00.000Z', now), 'today');
assert.equal(walkEnding('2026-10-20T10:00:00.000Z', now), 'now', 'a date that passed launches like today');
assert.equal(walkEnding('2026-11-02T10:00:00.000Z', now), 'later');
assert.equal(walkEnding('2026-12-20T10:00:00.000Z', now), 'later');

// The calendar entry is a whole day, the end date exclusive, everything escaped.
const url = new URL(calendarUrl({ title: 'יום הולדת & חברים', eventAt: '2026-11-20T10:00:00.000Z', details: 'https://x.test/p/a' })!);
assert.equal(url.hostname, 'calendar.google.com');
assert.equal(url.searchParams.get('text'), 'יום הולדת & חברים');
assert.equal(url.searchParams.get('dates'), '20261120/20261121');
assert.equal(url.searchParams.get('details'), 'https://x.test/p/a');
assert.equal(calendarUrl({ title: 'x', eventAt: 'nope', details: '' }), null);
const monthEnd = new URL(calendarUrl({ title: 'x', eventAt: '2026-12-31T10:00:00.000Z', details: '' })!);
assert.equal(monthEnd.searchParams.get('dates'), '20261231/20270101');

// A declared event nobody fires is a hole in the funnel that looks like a zero.
const SRC = join(import.meta.dirname, '../apps/creator-web/src');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
const all = walk(SRC).filter((f) => !f.endsWith('track.ts')).map((f) => readFileSync(f, 'utf8')).join('\n');
for (const e of FUNNEL_EVENTS) if (e !== 'screen_left') assert.ok(all.includes(`track('${e}'`), `never fired: ${e}`);
assert.ok(all.includes('trackLeaving('), 'nothing reports where a person left');

// The gap: the wizard's last answer raises the moment before any network call.
const dash = readFileSync(join(SRC, 'pages/DashboardPage.tsx'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(dash.indexOf('setBuildingAt(') < dash.indexOf('await loadMissionBank()'), 'the moment starts before the wait');

console.log('ALL CREATOR STAYS TESTS PASSED');
