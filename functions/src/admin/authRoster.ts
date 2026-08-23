// Bounding rules for the platform-user Auth scan (change: admin-user-activity-dashboard).
//
// Pure and dependency-free, exactly like the other decision modules in this repo
// (maintenance/runRetention.ts, scripts/lib/publicTaskBackfill.mjs): the callable does
// the I/O, this file makes the two decisions that keep it bounded. Kept honest by
// authRoster.test.ts.

export interface AuthAccountFacts {
  email: string | null;
  /** `providerData.length` — 0 for play-web's anonymous sign-in. */
  providerCount: number;
}

/**
 * Is this Auth account a CREATOR (as opposed to an anonymous participant)?
 *
 * RushPoint has two disjoint uid spaces. creator-web signs in with email or Google, so
 * the account always carries an email, provider data, or both. play-web signs in
 * anonymously (uid == teamId) and carries neither. There is no other kind of account,
 * and no data-model link between the two — which is why a participant can never be
 * folded into this report rather than merely being filtered out of it.
 */
export function isCreatorAccount(a: AuthAccountFacts): boolean {
  return !!a.email || a.providerCount > 0;
}

export interface PageScanState {
  /** Creator accounts found so far, across all pages read. */
  found: number;
  /** The caller's `limit` — how many rows it will actually return. */
  wanted: number;
  /** Pages read so far, including the one just processed. */
  pages: number;
  /** Hard ceiling on pages per invocation. */
  maxPages: number;
  /** Does Auth report a further page (i.e. did it return a pageToken)? */
  hasMorePages: boolean;
}

export interface PageVerdict {
  /** Stop reading pages now. */
  stop: boolean;
  /** Did the scan see everything it needed to, or was it cut short by the cap? */
  complete: boolean;
}

/**
 * Should the Auth scan stop, and is the result complete?
 *
 * Order matters. "Found enough" is checked FIRST so that a scan which already has its
 * answer is never reported as cap-truncated — it is complete by any reasonable reading,
 * and mislabelling it would put a permanent "there may be more" notice on a report that
 * is in fact whole.
 *
 * Stopping at `wanted + 1` rather than `wanted` is deliberate: the caller slices to
 * `wanted`, so one extra row is exactly the evidence needed to set `truncated`, and no
 * further page could change which rows are returned.
 */
export function pageVerdict(s: PageScanState): PageVerdict {
  if (s.found > s.wanted) return { stop: true, complete: true };
  if (!s.hasMorePages) return { stop: true, complete: true };
  if (s.pages >= s.maxPages) return { stop: true, complete: false };
  return { stop: false, complete: true };
}
