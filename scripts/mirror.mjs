// Live write-back watcher — keeps the Google Sheet in sync with Firestore in
// near-real-time. Subscribes to the config collections + game state and pushes the
// relevant tab back whenever something changes (debounced to respect Sheets quota).
// Runs as the MIRROR pane of `npm run dev:all`. No-ops (and exits) if the Apps
// Script webhook isn't configured yet.
import { db } from './lib/firestore-admin.mjs';
import { webhookConfigured } from './lib/sheets-writer.mjs';
import { pushStatus, pushTasks, pushZones, pushRaceConfig } from './lib/mirror-core.mjs';

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
const pub = (col) => `artifacts/${APP_ID}/public/data/${col}`;

if (!webhookConfigured()) {
  console.info('[mirror] Write-back disabled (RUSHPOINT_SHEETS_WEBHOOK not set).');
  console.info('[mirror] Deploy the Apps Script web app to enable it — see scripts/data/sheets/APPS_SCRIPT_SETUP.md');
  process.exit(0);
}

// Debounce so a burst of changes collapses into a single sheet write.
function debounce(fn, label, ms = 4000) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn(db).then(() => console.info(`[mirror] ${label} → sheet`))
            .catch((e) => console.warn(`[mirror] ${label} push failed: ${e.message}`));
    }, ms);
  };
}

const onStatus = debounce(pushStatus, 'status');
const onTasks  = debounce(pushTasks, 'tasks');
const onZones  = debounce(pushZones, 'basketZones');
const onCfg    = debounce(pushRaceConfig, 'raceConfig');

const warn = (what) => (e) => console.warn(`[mirror] ${what} listener error: ${e.message}`);

// Standings: any team profile or game-state change refreshes the status tab.
db.collectionGroup('gameState').onSnapshot(onStatus, warn('gameState'));
db.collectionGroup('profile').onSnapshot(onStatus, warn('profile'));
// Config tabs the app edits (e.g. via the Race Builder) mirror straight back.
db.collection(pub('tasks')).onSnapshot(onTasks, warn('tasks'));
db.collection(pub('basketZones')).onSnapshot(onZones, warn('basketZones'));
db.doc(`${pub('raceConfig')}/current`).onSnapshot(onCfg, warn('raceConfig'));

console.info('[mirror] Live write-back active — watching Firestore → Google Sheet.');
