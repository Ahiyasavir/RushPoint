// ─── Operator mailing-list export ─────────────────────────────────────────────
// Prints the registered creators' emails as COMMA-SEPARATED lists you can paste
// straight into the BCC field of a normal email (Gmail/Outlook) and send — no
// in-app sending system, nothing for users to see or get confused by.
//
// Three lists, by consent (Israeli anti-spam law: marketing is opt-IN):
//   1. marketing       — consented to ads/promotions      (marketingConsent === true)
//   2. updates-only    — declined ads, OK with important updates only
//   3. combined        — everyone reachable (1 ∪ 2)
// Anyone who consented to neither, has no email, or is a minor is EXCLUDED from
// all lists (and counted so you can see the totals).
//
//   npm run emails:export            # against the local emulator (default)
//   npm run emails:export -- --prod  # against PROD (needs GOOGLE_APPLICATION_CREDENTIALS)
//   npm run emails:export -- --out mylists.txt   # also write to a file
//
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROJECT_ID = 'rushpoint-pwa-7daaa';

// ─── Pure logic (exported + unit-tested in scripts/test-email-export.ts) ───────
// Kept free of firebase-admin so it can be imported and asserted WITHOUT an
// emulator. A `record` is { email?, marketingConsent?, updatesConsent?, isMinor? }
// — the join of an Auth user with its users/{uid} consent doc.
export function segmentEmails(records) {
  const marketing = [];
  const updatesOnly = [];
  let excludedNoEmail = 0;
  let excludedNoConsent = 0;
  let excludedMinor = 0;

  for (const r of records ?? []) {
    if (!r || !r.email) { excludedNoEmail++; continue; }
    if (r.isMinor === true) { excludedMinor++; continue; }
    if (r.marketingConsent === true) marketing.push(r.email);
    else if (r.updatesConsent === true) updatesOnly.push(r.email);
    else excludedNoConsent++;
  }

  return {
    marketing,
    updatesOnly,
    combined: [...marketing, ...updatesOnly], // 1 ∪ 2
    excludedNoEmail,
    excludedNoConsent,
    excludedMinor,
  };
}

// De-duplicated, sorted, comma-separated — paste-ready for a BCC field.
export const csv = (list) => [...new Set(list)].sort().join(', ');

// Full pasteable report from a segmentation result.
export function formatReport({ marketing, updatesOnly, combined }) {
  const block = (title, list) =>
    `\n# ${title} (${new Set(list).size})\n${csv(list) || '(none)'}`;
  return (
    block('MARKETING — consented to ads/promotions', marketing) +
    '\n' + block('UPDATES ONLY — important updates, no ads', updatesOnly) +
    '\n' + block('COMBINED — everyone reachable', combined)
  );
}

// ─── Emulator/prod runner (firebase-admin, side-effecting) ─────────────────────
async function run() {
  const args = process.argv.slice(2);
  const PROD = args.includes('--prod');
  const outIdx = args.indexOf('--out');
  const OUT_FILE = outIdx !== -1 ? args[outIdx + 1] : null;

  if (!PROD) {
    // Local emulator by default (mirrors seed-local.mjs).
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  } else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('--prod requires GOOGLE_APPLICATION_CREDENTIALS (a service-account key) to be set.');
    process.exit(1);
  }

  const { default: admin } = await import('firebase-admin');
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();
  const auth = admin.auth();

  // 1. Pull every auth user (email + uid).
  const users = [];
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) users.push({ uid: u.uid, email: u.email });
    pageToken = res.pageToken;
  } while (pageToken);

  // 2. Fetch their consent docs (users/{uid}) in chunks (getAll is cheap + batched).
  const consent = new Map();
  const uids = users.map((u) => u.uid);
  for (let i = 0; i < uids.length; i += 300) {
    const refs = uids.slice(i, i + 300).map((uid) => db.doc(`users/${uid}`));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) consent.set(s.id, s.exists ? s.data() : {});
  }

  // 3. Join + segment via the pure function, then print.
  const records = users.map((u) => ({ email: u.email, ...(consent.get(u.uid) ?? {}) }));
  const seg = segmentEmails(records);
  const report = formatReport(seg);

  console.log(`Registered auth users: ${users.length}`);
  console.log(
    `Excluded — no email: ${seg.excludedNoEmail} · no consent: ${seg.excludedNoConsent} · minors: ${seg.excludedMinor}`,
  );
  console.log(report);

  if (OUT_FILE) {
    writeFileSync(OUT_FILE, report.trimStart() + '\n', 'utf8');
    console.log(`\nWritten to ${OUT_FILE}`);
  }
  process.exit(0);
}

// Only hit the emulator/prod when invoked directly — importing the pure logic
// (for tests) must have zero side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error('Export failed (is the emulator running, or are prod credentials set?):', e?.message ?? e);
    process.exit(1);
  });
}
