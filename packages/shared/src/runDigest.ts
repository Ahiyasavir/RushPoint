// The daily run digest (change: run-email-scope-and-digest). Pure: no Firestore,
// no mailer, no ambient clock, no ambient timezone. The cron entrypoint supplies
// the rows and the instant; every decision below is a function of its arguments,
// so the quiet-day rule and the tenant-isolation rule are unit-testable without
// sending a single email.
//
// TIMEZONE IS AN ARGUMENT, NEVER INHERITED. A Docker container's local time is
// UTC even when the host is Asia/Jerusalem, so reading the ambient clock would
// silently shift the day boundary by 2-3 hours and split an evening's runs
// across two digests. `previousLocalDayBounds` takes an explicit IANA zone.

/** One finished run in the covered window, as read from Firestore. */
export interface DigestRunRow {
  runId: string;
  ownerUid: string;
  gameTitle: string;
  selfGuided: boolean;
  isTestDrive: boolean;
  teamCount: number;
  /** Participant DISPLAY names. Never email addresses — see the note on RunDigest. */
  playerNames: string[];
}

export interface DigestDemoRun {
  runId: string;
  gameTitle: string;
  playerNames: string[];
}

export interface DigestRealRun {
  runId: string;
  gameTitle: string;
  teamCount: number;
}

/**
 * The digest payload, or `null` for a quiet day.
 *
 * Deliberately carries NO email address and NO `registrationData` value for any
 * participant. Participants authenticate anonymously and `FieldType` has no
 * `email` variant, so a participant address does not exist anywhere in the
 * system — an `email` key here could only ever hold a placeholder. Registration
 * answers (phone numbers, custom per-game questions) are excluded because they
 * are participant PII, possibly a minor's, and an inbox lives outside the
 * 90-day retention prune.
 *
 * `ownerUid` is likewise absent from the itemized entries: the digest recipient
 * is the platform operator, and a collection-group query spans every tenant.
 */
export interface RunDigest {
  /** Platform-wide count of demo runs — a bare integer, not identifying. */
  demoCount: number;
  /** Itemized demo runs, operator-owned only. */
  demoRuns: DigestDemoRun[];
  /** Itemized real runs, operator-owned only. */
  realRuns: DigestRealRun[];
  /** Other creators' real runs as a bare count — no titles, no uids. */
  otherOwnerRunCount: number;
}

export interface LocalDayBounds {
  /** Inclusive start of the day, as an ISO instant. */
  startIso: string;
  /** Exclusive end of the day, as an ISO instant. */
  endIso: string;
  /** The local calendar day covered, `YYYY-MM-DD`. */
  label: string;
}

// The offset of `timeZone` at a given instant, in ms. Derived by formatting the
// instant in that zone and reading the wall-clock back as if it were UTC — the
// standard trick, and the only one available without a tz database dependency.
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23', // never emit "24" for midnight
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'),
  );
  return asUtc - instant.getTime();
}

// A wall-clock time in `timeZone` → the UTC instant. Resolved in two passes: the
// first offset guess can be wrong across a DST transition (the offset at the
// guessed instant differs from the offset at the true instant), so we re-read the
// offset at the corrected instant and apply it.
function wallTimeToInstant(
  y: number, m: number, d: number, timeZone: string,
): number {
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  const firstPass = wall - zoneOffsetMs(new Date(wall), timeZone);
  return wall - zoneOffsetMs(new Date(firstPass), timeZone);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The bounds of the PREVIOUS complete local calendar day, relative to `now` in
 * `timeZone`.
 *
 * Why the previous day and not "today": the digest timer fires at 03:30, so
 * "today" is three and a half hours old and would report almost nothing while
 * the day that actually happened went unreported.
 *
 * The window is NOT assumed to be 24 hours. Israel's DST transitions make one
 * local day 23h and another 25h; both endpoints are resolved independently
 * against the zone so a transition day is covered exactly.
 */
export function previousLocalDayBounds(now: Date, timeZone: string): LocalDayBounds {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');

  // The local calendar day containing `now`; its midnight is the EXCLUSIVE end.
  const endY = get('year'), endM = get('month'), endD = get('day');
  // Step back one calendar day using UTC arithmetic on the date parts only (no
  // offset involved yet), so month/year rollover is handled by the Date itself.
  const prev = new Date(Date.UTC(endY, endM - 1, endD));
  prev.setUTCDate(prev.getUTCDate() - 1);
  const startY = prev.getUTCFullYear(), startM = prev.getUTCMonth() + 1, startD = prev.getUTCDate();

  return {
    startIso: new Date(wallTimeToInstant(startY, startM, startD, timeZone)).toISOString(),
    endIso: new Date(wallTimeToInstant(endY, endM, endD, timeZone)).toISOString(),
    label: `${startY}-${pad(startM)}-${pad(startD)}`,
  };
}

/**
 * Fold the day's finished runs into the digest, or `null` when there is nothing
 * to report.
 *
 * Returning `null` for a quiet day is the contract that makes silence
 * meaningful: no email means "no runs finished", never "the job broke". A
 * heartbeat-on-empty would train the reader to ignore it.
 *
 * Test-drive runs (which includes every simulation, since the sim scripts launch
 * with that flag) are dropped entirely — they are not events and must not
 * inflate a count.
 */
export function buildRunDigest(
  rows: DigestRunRow[],
  operatorUids: string | string[],
): RunDigest | null {
  // An ALLOWLIST, not a single uid: the platform's own demo games are owned by
  // seeded accounts (demo-spy-academy, demo-creator, …), not by the operator's
  // personal account. Keying itemization on one uid would have counted demo runs
  // while hiding the player names — defeating the point of the demo report.
  const operators = new Set(
    (Array.isArray(operatorUids) ? operatorUids : operatorUids.split(','))
      .map((u) => u.trim())
      .filter((u) => u.length > 0),
  );
  const isOurs = (r: DigestRunRow): boolean => operators.has(r.ownerUid);

  const real = rows.filter((r) => !r.isTestDrive && !r.selfGuided);
  const demo = rows.filter((r) => !r.isTestDrive && r.selfGuided);

  const digest: RunDigest = {
    demoCount: demo.length,
    demoRuns: demo
      .filter(isOurs)
      .map((r) => ({ runId: r.runId, gameTitle: r.gameTitle, playerNames: r.playerNames })),
    realRuns: real
      .filter(isOurs)
      .map((r) => ({ runId: r.runId, gameTitle: r.gameTitle, teamCount: r.teamCount })),
    otherOwnerRunCount: real.filter((r) => !isOurs(r)).length,
  };

  const nothingHappened =
    digest.demoCount === 0 && digest.realRuns.length === 0 && digest.otherOwnerRunCount === 0;
  return nothingHappened ? null : digest;
}

// Minimal HTML escape — the digest embeds creator-authored game titles and
// participant-entered display names, both untrusted.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Render the digest. Pure and deterministic — the covered day is passed in as
 * `label` rather than read from a clock, so the same digest always renders the
 * same bytes and the function is testable without freezing time.
 */
export function formatRunDigestEmail(
  digest: RunDigest,
  label: string,
): { subject: string; text: string; html: string } {
  const subject = `RushPoint daily digest — ${label}`;
  const lines: string[] = [subject, ''];

  lines.push(`Demo runs played: ${digest.demoCount}`);
  for (const d of digest.demoRuns) {
    const who = d.playerNames.length > 0 ? ` — played by ${d.playerNames.join(', ')}` : '';
    lines.push(`  · ${d.gameTitle}${who}`);
  }
  lines.push('');

  lines.push(`Real runs finished: ${digest.realRuns.length}`);
  if (digest.realRuns.length === 0) {
    lines.push('  (none)');
  } else {
    for (const r of digest.realRuns) {
      lines.push(`  · ${r.gameTitle} — ${r.teamCount} team(s)`);
    }
  }
  if (digest.otherOwnerRunCount > 0) {
    lines.push('');
    lines.push(`+${digest.otherOwnerRunCount} run(s) by other creators`);
  }

  const demoItems = digest.demoRuns.map((d) => {
    const who = d.playerNames.length > 0
      ? ` <span style="color:#9aa4b2;">— played by ${esc(d.playerNames.join(', '))}</span>` : '';
    return `<li style="margin:4px 0;color:#f3f4f6;">${esc(d.gameTitle)}${who}</li>`;
  }).join('');
  const realItems = digest.realRuns.length === 0
    ? `<li style="margin:4px 0;color:#9aa4b2;">None</li>`
    : digest.realRuns.map((r) =>
        `<li style="margin:4px 0;color:#f3f4f6;">${esc(r.gameTitle)} <span style="color:#9aa4b2;">— ${r.teamCount} team(s)</span></li>`,
      ).join('');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#0b0f17;padding:24px 12px;">
  <div style="max-width:600px;margin:0 auto;background:#141a24;border-radius:16px;overflow:hidden;border:1px solid #232c3d;">
    <div style="background:#f97316;padding:20px 24px;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fff7ed;opacity:.85;">RushPoint · Daily Digest</div>
      <div style="font-size:20px;font-weight:700;color:#fff;margin-top:4px;">${esc(label)}</div>
    </div>
    <div style="padding:20px 24px;">
      <div style="font-size:15px;font-weight:700;color:#f3f4f6;">Demo runs played: ${digest.demoCount}</div>
      <ul style="margin:8px 0 18px;padding-inline-start:20px;font-size:14px;">${demoItems}</ul>
      <div style="font-size:15px;font-weight:700;color:#f3f4f6;">Real runs finished: ${digest.realRuns.length}</div>
      <ul style="margin:8px 0 0;padding-inline-start:20px;font-size:14px;">${realItems}</ul>
      ${digest.otherOwnerRunCount > 0
        ? `<div style="margin-top:14px;font-size:13px;color:#9aa4b2;">+${digest.otherOwnerRunCount} run(s) by other creators</div>`
        : ''}
    </div>
  </div>
</div>`;

  return { subject, text: lines.join('\n'), html };
}
