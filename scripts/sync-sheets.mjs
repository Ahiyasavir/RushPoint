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
import { db, auth } from './lib/firestore-admin.mjs';
import { fetchRows, usingSheets } from './lib/sheets-source.mjs';
import { DATASETS } from './lib/datasets.mjs';
import { webhookConfigured } from './lib/sheets-writer.mjs';
import { pushStatus } from './lib/mirror-core.mjs';

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

  // Outbound: reflect the live standings back into the sheet's `status` tab (only
  // when the Apps Script webhook is configured — see APPS_SCRIPT_SETUP.md).
  if (webhookConfigured()) {
    try {
      await pushStatus(db);
      console.info('  ↑ status   → Google Sheet (write-back)');
    } catch (e) {
      console.warn(`  ⚠ status write-back failed: ${e.message}`);
    }
  }

  console.info('\n✅ Sync complete.\n');
}

main().catch((err) => { console.error('\n❌ Sync failed:', err); process.exit(1); });
