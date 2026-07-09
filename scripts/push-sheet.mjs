// One-shot write-back: push the current config + live standings from Firestore
// into the Google Sheet. Run manually any time:  npm run push:sheet
import { db } from './lib/firestore-admin.mjs';
import { webhookConfigured } from './lib/sheets-writer.mjs';
import { pushAll } from './lib/mirror-core.mjs';

if (!webhookConfigured()) {
  console.info('[push] RUSHPOINT_SHEETS_WEBHOOK not set — write-back is off.');
  console.info('       Deploy the Apps Script web app and set the URL: see scripts/data/sheets/APPS_SCRIPT_SETUP.md');
  process.exit(0);
}

try {
  await pushAll(db);
  console.info('✅ Pushed tasks, basketZones, raceConfig + live status → Google Sheet.');
  process.exit(0);
} catch (e) {
  console.error('❌ Push failed:', e.message);
  process.exit(1);
}
