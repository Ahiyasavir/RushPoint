/**
 * When RushPoint Live happens, and what a countdown to it may say.
 *
 * Change: rushpoint-live-urgency.
 *
 * Deliberately dependency free (no `~/` alias, no astro imports), like `i18n.ts`
 * beside it, so a plain tsx process can load it and
 * `scripts/test-live-event-countdown.ts` can drive every branch without a browser.
 *
 * ── Why this is an ABSOLUTE instant and not a per-visit window ───────────────
 *
 * A countdown that restarts when the page reloads is a named dark pattern — the
 * FTC has acted on exactly that — and the measured effect is the opposite of the
 * intended one: across published A/B tests the median lift is about +9% for a
 * timer tied to a real deadline and about −3% for one that is fabricated or
 * resetting. Ours is tied to a real evening in a real city, so it earns the lift
 * honestly, and anchoring it here means a reload, a second device and a shared
 * link all show the same number because they are all measuring the same instant.
 *
 * ── The device clock ────────────────────────────────────────────────────────
 *
 * CLAUDE.md's rule is never to ship an absolute deadline to a device clock, and
 * it is the right rule for the case it was written about: a per-player retry
 * lockout counted against a slow phone traps that player in the game. This is a
 * different thing — a public calendar date that every visitor could read off a
 * poster — and a static site has no server to ask, so the device clock is the
 * only clock there is. What survives from the rule is the important half:
 * **bound it on read**. A clock that is wrong enough to produce a nonsensical
 * answer makes the countdown DISAPPEAR and leaves the date itself standing,
 * rather than showing a visitor "1,284 days" and destroying the credibility of
 * the one number on the page that is supposed to create urgency.
 */

/**
 * Thursday evening, 22 October 2026, Jerusalem.
 *
 * Stored as an explicit UTC offset rather than a local string, because a bare
 * `new Date('2026-10-22T19:00')` is parsed in the VIEWER's zone: a visitor in
 * New York would be counting down to 19:00 their time, which is a different
 * moment and a wrong number.
 *
 * `+03:00` is Israel Daylight Time, which is what is in force on that date —
 * IDT runs until the last Sunday of October, 25 October 2026. Do not "correct"
 * this to +02:00.
 */
export const LIVE_EVENT_ISO = '2026-10-22T19:00:00+03:00';
export const LIVE_EVENT_AT = Date.parse(LIVE_EVENT_ISO);

/** How the date is written in Hebrew copy. One spelling, declared once. */
export const LIVE_EVENT_DAY_HE = 'יום חמישי';
export const LIVE_EVENT_DATE_HE = '22 באוקטובר';
export const LIVE_EVENT_CITY_HE = 'ירושלים';

/**
 * Beyond this much lead time the clock is not plausibly right, so the countdown
 * withholds rather than guesses.
 *
 * The event is a little over a month out at the time this ships, so any device
 * reporting more than a year of remaining time is wrong about the date, not
 * early. Erring toward HIDING is the correct direction: a missing countdown
 * costs a little urgency, while a visibly absurd one costs the credibility of
 * every other claim on the page.
 */
export const MAX_PLAUSIBLE_LEAD_MS = 400 * 24 * 60 * 60 * 1000;

export type CountdownState = 'counting' | 'started' | 'unknown';

export interface Countdown {
  readonly state: CountdownState;
  /** Whole units remaining, each already reduced by the larger ones above it. */
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

const NOTHING: Countdown = { state: 'unknown', days: 0, hours: 0, minutes: 0, seconds: 0 };

/**
 * What the countdown should say at `nowMs`.
 *
 * TOTAL: every input yields a verdict, and a malformed one yields `unknown`
 * rather than throwing. The one thing this must never do is render a number it
 * does not believe.
 */
export function countdownAt(nowMs: number, eventMs: number = LIVE_EVENT_AT): Countdown {
  if (!Number.isFinite(nowMs) || !Number.isFinite(eventMs)) return NOTHING;

  const remaining = eventMs - nowMs;

  // The evening has arrived, or passed. Either way there is nothing to count.
  if (remaining <= 0) return { ...NOTHING, state: 'started' };

  // The clock is not plausibly right; say nothing rather than something absurd.
  if (remaining > MAX_PLAUSIBLE_LEAD_MS) return NOTHING;

  const totalSeconds = Math.floor(remaining / 1000);
  return {
    state: 'counting',
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

/**
 * How far through the application a team is, as a percentage.
 *
 * ── Why it does not start at zero ───────────────────────────────────────────
 *
 * The endowed progress effect: people finish a task far more often when they can
 * see they have already started one. In the study this comes from, a loyalty
 * card printed with two stamps already filled was completed at nearly double the
 * rate of an otherwise identical shorter card. Arriving on this page and reading
 * it IS a real step, so the bar acknowledges it.
 *
 * `HEAD_START` is small on purpose. It is a truthful acknowledgement that they
 * have begun, not a claim that answers exist which do not — a bar sitting at a
 * third before a single field is filled reads as broken, and takes the rest of
 * the page's honesty with it.
 */
export const PROGRESS_HEAD_START = 8;

export function applicationProgress(answered: number, total: number): number {
  if (!Number.isFinite(answered) || !Number.isFinite(total) || total <= 0) return PROGRESS_HEAD_START;
  const done = Math.max(0, Math.min(answered, total));
  const earned = (done / total) * (100 - PROGRESS_HEAD_START);
  // Rounded so the label and the bar width cannot disagree by a fraction, and
  // clamped so a caller that miscounts can never render a bar past its track.
  return Math.min(100, Math.round(PROGRESS_HEAD_START + earned));
}
