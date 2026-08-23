// ─── Daily run digest for the self-hosted deployment ─────────────────────────
//
// Reports, once a day, what actually happened: how many DEMO (self-guided) runs
// finished, and a one-line entry per REAL run. Demo runs deliberately do not send
// a per-run email — there can be many a day from the public demo link, and they
// would bury the one email that matters — so this digest is where their volume
// shows up.
//
// SILENCE IS MEANINGFUL. On a day with no demo runs and no real runs this sends
// nothing at all (`buildRunDigest` returns null). No email means "nothing
// happened", never "the job broke" — a heartbeat-on-empty would train the reader
// to ignore it.
//
// It covers the PREVIOUS complete local day, not "today": the timer fires at
// 03:30, so today is three and a half hours old and would report almost nothing.
// The timezone is passed EXPLICITLY (RUN_DIGEST_TIMEZONE, default Asia/Jerusalem)
// and never inherited — a Docker container's local time is UTC even when the host
// is Asia/Jerusalem, which would shift the boundary and split an evening's runs
// across two digests.
//
// Bundled to `lib/digest-cron.js` by `npm run build:cron`. Driven by a daily
// systemd timer (see deploy/rushpoint-digest.service / .timer).
import * as admin from 'firebase-admin';
import {
  previousLocalDayBounds,
  buildRunDigest,
  formatRunDigestEmail,
  type DigestRunRow,
} from '@rushpoint/shared';

const DEFAULT_TZ = 'Asia/Jerusalem';

async function main(): Promise<void> {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const timeZone = process.env.RUN_DIGEST_TIMEZONE || DEFAULT_TZ;
  const operatorUid = process.env.RUN_DIGEST_OWNER_UID || '';
  const { startIso, endIso, label } = previousLocalDayBounds(new Date(), timeZone);

  // Served by the EXISTING `runs` collection-group index on (status, finishedAt)
  // — the same one sweepExpiredRuns uses. No new index is required.
  const snap = await db
    .collectionGroup('runs')
    .where('status', '==', 'finished')
    .where('finishedAt', '>=', startIso)
    .where('finishedAt', '<', endIso)
    .get();

  const rows: DigestRunRow[] = await Promise.all(snap.docs.map(async (d) => {
    const run = d.data() as {
      ownerUid?: string; gameId?: string; selfGuided?: boolean; isTestDrive?: boolean;
      participantCount?: number; leaderboard?: { rankings?: { teamName?: string }[] };
    };
    // The game title is the human-readable half of the report; fall back to the
    // id rather than failing the whole digest over one deleted game.
    let gameTitle = run.gameId ?? d.id;
    try {
      if (run.ownerUid && run.gameId) {
        const g = await db.doc(`users/${run.ownerUid}/games/${run.gameId}`).get();
        const t = (g.data() as { title?: string } | undefined)?.title;
        if (t) gameTitle = t;
      }
    } catch {
      // keep the fallback title
    }
    // Player DISPLAY names only — "which user played the demo". There is no
    // participant email anywhere in the system (anonymous auth, and FieldType has
    // no `email` variant), and registrationData answers are deliberately excluded
    // as participant PII that would outlive the 90-day prune in an inbox.
    const playerNames = (run.leaderboard?.rankings ?? [])
      .map((r) => r.teamName)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    return {
      runId: d.id,
      ownerUid: run.ownerUid ?? '',
      gameTitle,
      selfGuided: run.selfGuided === true,
      isTestDrive: run.isTestDrive === true,
      teamCount: run.participantCount ?? 0,
      playerNames,
    };
  }));

  const digest = buildRunDigest(rows, operatorUid);
  if (!digest) {
    // eslint-disable-next-line no-console
    console.log(`digest-cron: ${label} was quiet (no demo runs, no real runs) — nothing sent`);
    return;
  }

  // Reuse the ONE send seam so provider handling, the enabled flag and the
  // no-credential no-op all behave identically to the per-run email.
  const { sendDigestEmail } = await import('./runs/runSummaryEmail');
  const recipient = process.env.RUN_DIGEST_EMAIL_TO || process.env.RUN_SUMMARY_EMAIL_TO || null;
  await sendDigestEmail(formatRunDigestEmail(digest, label), recipient);
  // eslint-disable-next-line no-console
  console.log(
    `digest-cron: ${label} — ${digest.demoCount} demo run(s), ` +
    `${digest.realRuns.length} real run(s), ${digest.otherOwnerRunCount} other-creator run(s)`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    // eslint-disable-next-line no-console
    console.error('digest-cron: FAILED', e);
    process.exit(1);
  },
);
