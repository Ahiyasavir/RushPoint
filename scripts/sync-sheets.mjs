// ─────────────────────────────────────────────────────────────────────────────
// sync-sheets — pull the event's config data from Google Sheets (or the bundled
// local CSVs) into the Firestore emulator. Runs on every `npm run dev:all` boot,
// so editing a sheet/CSV and re-running updates the app automatically.
//
// Source of truth & schema:  scripts/data/sheets/  +  scripts/lib/datasets.mjs
// Google Sheets hookup:       scripts/data/sheets/README.md  (set RUSHPOINT_SHEETS_ID)
//
// Idempotent: config is upserted (merge); runtime fields (live counters, claimed
// codes, team scores/progress) are preserved across runs — never clobbered.
// ─────────────────────────────────────────────────────────────────────────────
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchRows, usingSheets } from './lib/sheets-source.mjs';
import { DATASETS } from './lib/datasets.mjs';

// Tiny .env loader (no dependency): loads scripts/.env then repo-root .env so you
// can drop RUSHPOINT_SHEETS_ID in a file instead of exporting it each time.
function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [path.join(here, '.env'), path.join(here, '..', '.env')]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
loadEnv();

const PROJECT_ID = process.env.RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';
process.env.FIRESTORE_EMULATOR_HOST     ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

async function applyCollection(ds, rows) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const { id, data } = ds.toDoc(row);
    if (!id) continue;
    const ref = db.doc(`${ds.path}/${id}`);
    const exists = (await ref.get()).exists;
    const payload = { ...data };
    if (exists && ds.createOnly) for (const f of ds.createOnly) delete payload[f];
    await ref.set(payload, { merge: true });
    exists ? updated++ : created++;
  }
  return `${created} created, ${updated} updated`;
}

async function applySingleton(ds, rows) {
  await db.doc(ds.doc).set(ds.fromRows(rows), { merge: true });
  return 'written';
}

async function main() {
  console.info('\n🔄 Syncing event data → Firestore');
  console.info(`   Source: ${usingSheets() ? 'Google Sheets (RUSHPOINT_SHEETS_ID set) with local CSV fallback' : 'local CSV files (set RUSHPOINT_SHEETS_ID to use Google Sheets)'}`);
  console.info(`   Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}\n`);

  for (const ds of DATASETS) {
    let rows = [];
    try {
      rows = await fetchRows(ds.tab);
    } catch (e) {
      console.warn(`  ⚠ ${ds.name}: no source found (${e.message}) — skipped`);
      continue;
    }
    try {
      let summary;
      if (ds.kind === 'singleton')      summary = await applySingleton(ds, rows);
      else if (ds.kind === 'custom')    summary = `${await ds.apply({ db, auth }, rows)} applied`;
      else                              summary = await applyCollection(ds, rows);
      console.info(`  ✅ ${ds.name.padEnd(12)} ${summary}`);
    } catch (e) {
      console.error(`  ❌ ${ds.name}: ${e.message}`);
      throw e;
    }
  }

  console.info('\n✅ Sync complete.\n');
}

main().catch((err) => { console.error('\n❌ Sync failed:', err); process.exit(1); });
