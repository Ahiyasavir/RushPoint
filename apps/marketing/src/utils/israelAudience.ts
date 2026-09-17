/**
 * Is this visitor plausibly in Israel? (change: rushpoint-live-english)
 *
 * PURE and dependency free, like `i18n.ts` and `liveEvent.ts` beside it, so
 * `scripts/test-israel-audience.ts` can drive every branch without a browser.
 *
 * ── Why this is a heuristic, and why that is acceptable ─────────────────────
 *
 * The event is one evening in Jerusalem, so advertising it on the ENGLISH home
 * page to a reader in Ohio is noise. But this site is static files on a CDN with
 * no server in front of them — Firebase Hosting on the Spark plan cannot route by
 * country, and a real geo lookup would mean a third-party request on every page
 * load, which costs latency, leaks the reader's address to someone else, and is
 * blocked outright by common content blockers. So the decision is made on the
 * device, from signals the browser already has: its TIME ZONE and its LANGUAGES.
 *
 * ── The direction it fails in is the whole design ───────────────────────────
 *
 * The two mistakes are not equally expensive:
 *
 *   • Hiding it from an English-speaking Israeli costs a TEAM, out of ten, in the
 *     exact audience this change exists to reach.
 *   • Showing it to someone abroad costs them reading one band that names a city
 *     and a date, and scrolling past.
 *
 * So this answers "is there positive evidence they are somewhere else?" rather
 * than "can I prove they are in Israel?". Anything unknown, unreadable, blocked
 * or ambiguous resolves to SHOW. A visitor who reads Hebrew is shown it wherever
 * they are, because an Israeli abroad is exactly the person who might fly back
 * for this, and an Israeli with a work laptop set to another zone is common.
 *
 * NOTE this gates a home page BAND only. The page itself is always reachable in
 * both languages: links get shared, and refusing to render a page somebody was
 * deliberately sent is a far worse failure than showing a band too widely.
 */

/** The zones that mean Israel. `Asia/Tel_Aviv` is a real alias some devices report. */
export const ISRAEL_TIME_ZONES = ['Asia/Jerusalem', 'Asia/Tel_Aviv'];

/** The language subtag for Hebrew, in the forms a browser reports it. */
const HEBREW = /^(he|iw)\b/i;

export interface AudienceSignals {
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone`, or undefined if unreadable. */
  readonly timeZone?: string | null;
  /** `navigator.languages`, most preferred first. */
  readonly languages?: readonly string[] | null;
}

/**
 * Should the Israel-only band be shown to this visitor?
 *
 * TOTAL: every input yields a boolean, and a malformed one yields `true` rather
 * than throwing — a crash here would take out whatever else runs in that script.
 */
export function showsIsraelOnlyContent(signals: AudienceSignals | null | undefined): boolean {
  if (!signals) return true;

  const languages = Array.isArray(signals.languages)
    ? signals.languages.filter((tag): tag is string => typeof tag === 'string')
    : [];
  // A Hebrew reader is our audience wherever their device happens to be sitting.
  if (languages.some((tag) => HEBREW.test(tag))) return true;

  const zone = typeof signals.timeZone === 'string' ? signals.timeZone.trim() : '';
  // Unknown, empty or unreadable ⇒ show. This is the fail-open case, and it is
  // the common one for a locked-down or older browser.
  if (zone === '') return true;
  if (ISRAEL_TIME_ZONES.some((tz) => tz.toLowerCase() === zone.toLowerCase())) return true;

  // A readable foreign zone is evidence, but on its own it is not ENOUGH. The
  // language list is the only thing that can identify an Israeli whose device
  // sits in another zone — a work laptop, a trip, a VPN — so when we could not
  // read it at all we have lost the override, not confirmed its absence. Hiding
  // on half the evidence would silently drop exactly the reader this band is for.
  if (languages.length === 0) return true;

  // A readable foreign zone AND a readable language list with no Hebrew in it:
  // the only combination that is complete positive evidence of somewhere else.
  return false;
}

/**
 * Read the signals off a browser. Separated from the verdict so the verdict stays
 * pure and testable, and so every accessor that can throw is contained here.
 *
 * `Intl` throws in a few hardened environments and `navigator.languages` is
 * absent in a few old ones; both are wrapped, and both failures resolve to
 * "unknown", which the verdict above reads as SHOW.
 */
export function readAudienceSignals(): AudienceSignals {
  let timeZone: string | null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timeZone = null;
  }

  let languages: string[];
  try {
    const nav = globalThis.navigator;
    languages = Array.isArray(nav?.languages) && nav.languages.length > 0
      ? [...nav.languages]
      : nav?.language
        ? [nav.language]
        : [];
  } catch {
    languages = [];
  }

  return { timeZone, languages };
}
