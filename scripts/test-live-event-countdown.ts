/**
 * The RushPoint Live countdown and the application progress bar
 * (change: rushpoint-live-urgency).
 *
 * Both are marketing mechanics, which is exactly why they are gated: a countdown
 * that shows a wrong number is worse than no countdown, because it is the one
 * element on the page whose whole job is to be believed.
 *
 * Pure lane — no browser, no clock of its own. Every case injects `now`.
 */
import {
  LIVE_EVENT_AT,
  LIVE_EVENT_ISO,
  MAX_PLAUSIBLE_LEAD_MS,
  PROGRESS_HEAD_START,
  applicationProgress,
  countdownAt,
} from '../apps/marketing/src/utils/liveEvent.ts';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ── A. The instant itself ────────────────────────────────────────────────────
//
// The date is the single most checkable fact on the page. A visitor who turns up
// on the wrong evening is the worst outcome this whole change can produce.

{
  const d = new Date(LIVE_EVENT_AT);
  check('A1 the event instant parses', Number.isFinite(LIVE_EVENT_AT), LIVE_EVENT_ISO);
  // getUTCDay: 0 = Sunday, so Thursday is 4. Asserted in UTC because 19:00+03:00
  // is 16:00 UTC — the same calendar day, so the weekday is unambiguous.
  check('A2 the event is a Thursday', d.getUTCDay() === 4, `getUTCDay=${d.getUTCDay()}`);
  check('A3 the event is 22 October 2026',
    d.getUTCFullYear() === 2026 && d.getUTCMonth() === 9 && d.getUTCDate() === 22,
    d.toISOString());
  // +03:00 is Israel DAYLIGHT time, in force until 25 October 2026. A "correction"
  // to +02:00 would move the whole countdown by an hour.
  check('A4 the offset is IDT (+03:00), i.e. 16:00 UTC', d.getUTCHours() === 16, `${d.getUTCHours()}:00 UTC`);
  check('A5 the ISO string declares the offset explicitly, never a bare local time',
    /[+-]\d{2}:\d{2}$/.test(LIVE_EVENT_ISO), LIVE_EVENT_ISO);
}

// A viewer in another zone must count to the SAME moment. This is what a bare
// 'YYYY-MM-DDTHH:mm' would break, silently, only for people abroad.
{
  const fromNewYork = Date.parse('2026-10-22T12:00:00-04:00'); // same instant as 19:00+03:00
  check('A6 the instant is absolute, not a local wall time',
    countdownAt(fromNewYork).state === 'started' || LIVE_EVENT_AT === fromNewYork,
    `event=${LIVE_EVENT_AT} ny=${fromNewYork}`);
}

// ── B. Counting down ─────────────────────────────────────────────────────────

{
  const c = countdownAt(LIVE_EVENT_AT - (3 * DAY + 4 * HOUR + 5 * MINUTE + 6 * SECOND));
  check('B1 state is counting', c.state === 'counting');
  check('B2 units are split correctly',
    c.days === 3 && c.hours === 4 && c.minutes === 5 && c.seconds === 6,
    JSON.stringify(c));
}

// Each unit is reduced by the larger ones above it — 25 hours is 1 day 1 hour,
// never "0 days, 25 hours".
{
  const c = countdownAt(LIVE_EVENT_AT - (25 * HOUR));
  check('B3 hours roll into days', c.days === 1 && c.hours === 1, JSON.stringify(c));
}
{
  const c = countdownAt(LIVE_EVENT_AT - (90 * MINUTE));
  check('B4 minutes roll into hours', c.days === 0 && c.hours === 1 && c.minutes === 30, JSON.stringify(c));
}

// One second out is still counting. The boundary is where an off-by-one would
// flip the page into its "it started" state a second early.
{
  const c = countdownAt(LIVE_EVENT_AT - SECOND);
  check('B5 one second before the start still counts',
    c.state === 'counting' && c.seconds === 1 && c.days === 0, JSON.stringify(c));
}

// Sub-second remainders floor rather than round, so the display never shows a
// number larger than the time that is actually left.
{
  const c = countdownAt(LIVE_EVENT_AT - 1999);
  check('B6 partial seconds floor, never round up', c.seconds === 1, JSON.stringify(c));
}

// ── C. The start, and after it ───────────────────────────────────────────────

for (const [label, now] of [
  ['exactly at the start', LIVE_EVENT_AT],
  ['a second after', LIVE_EVENT_AT + SECOND],
  ['a year after', LIVE_EVENT_AT + 365 * DAY],
] as Array<[string, number]>) {
  const c = countdownAt(now);
  check(`C1 ${label} reads as started`, c.state === 'started', JSON.stringify(c));
  check(`C2 ${label} carries no leftover units`,
    c.days === 0 && c.hours === 0 && c.minutes === 0 && c.seconds === 0, JSON.stringify(c));
}

// ── D. A wrong device clock withholds rather than guesses ────────────────────
//
// This is the bounded-on-read half of CLAUDE.md's rule about absolute deadlines.
// A phone whose clock is years off must not be shown "1,284 days", which would
// discredit every other number on the page.

{
  const c = countdownAt(LIVE_EVENT_AT - (MAX_PLAUSIBLE_LEAD_MS + DAY));
  check('D1 an implausibly early clock says nothing', c.state === 'unknown', JSON.stringify(c));
}
{
  const c = countdownAt(LIVE_EVENT_AT - MAX_PLAUSIBLE_LEAD_MS);
  check('D2 exactly at the plausibility bound still counts', c.state === 'counting', JSON.stringify(c));
}
for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  check(`D3 ${String(bad)} yields unknown rather than throwing`, countdownAt(bad).state === 'unknown');
}
check('D4 a malformed EVENT is unknown too', countdownAt(Date.now(), Number.NaN).state === 'unknown');

// ── E. The countdown is anchored, not per visit ──────────────────────────────
//
// The property that separates an honest timer from the dark pattern: two reads
// of the same clock give the same answer, so a reload cannot restart it.

{
  const now = LIVE_EVENT_AT - (2 * DAY);
  const a = countdownAt(now);
  const b = countdownAt(now);
  check('E1 the same instant always yields the same countdown',
    JSON.stringify(a) === JSON.stringify(b), JSON.stringify({ a, b }));
}
{
  // And it only ever decreases as time passes.
  const first = countdownAt(LIVE_EVENT_AT - (2 * DAY));
  const later = countdownAt(LIVE_EVENT_AT - (2 * DAY) + HOUR);
  check('E2 a later read is strictly nearer the event',
    later.days * 24 + later.hours < first.days * 24 + first.hours,
    JSON.stringify({ first, later }));
}

// ── F. Endowed progress ──────────────────────────────────────────────────────

check('F1 an untouched form already shows progress', applicationProgress(0, 10) === PROGRESS_HEAD_START,
  String(applicationProgress(0, 10)));
check('F2 the head start is honest, not a third of the bar', PROGRESS_HEAD_START > 0 && PROGRESS_HEAD_START <= 15,
  String(PROGRESS_HEAD_START));
check('F3 a complete form reads 100', applicationProgress(10, 10) === 100, String(applicationProgress(10, 10)));
check('F4 progress rises monotonically', (() => {
  let prev = -1;
  for (let i = 0; i <= 10; i += 1) {
    const p = applicationProgress(i, 10);
    if (p < prev) return false;
    prev = p;
  }
  return true;
})());

// Total and clamped: a caller that miscounts must not render a bar past its track.
check('F5 over-counting clamps to 100', applicationProgress(99, 10) === 100);
check('F6 a negative count falls back to the head start', applicationProgress(-5, 10) === PROGRESS_HEAD_START);
check('F7 a zero total does not divide by zero', applicationProgress(3, 0) === PROGRESS_HEAD_START);
for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
  check(`F8 ${String(bad)} answered falls back rather than throwing`,
    applicationProgress(bad, 10) === PROGRESS_HEAD_START);
}
check('F9 every value stays inside the track', (() => {
  for (let i = -3; i <= 14; i += 1) {
    const p = applicationProgress(i, 10);
    if (p < 0 || p > 100) return false;
  }
  return true;
})());

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} :: ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
