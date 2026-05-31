// Builds sheet content from Firestore and pushes it back via the Apps Script
// webhook. Shared by the one-shot push (push-status.mjs) and the live watcher
// (mirror.mjs). The app MIRRORS to the sheet the things it changes — the config
// tabs the Race Builder edits (tasks, basketZones, raceConfig) and a live `status`
// tab — while leaving the pure-input tabs (accessCodes, teams) untouched.
import { replaceTab } from './sheets-writer.mjs';
import { tasksRows, basketZonesRows, raceConfigRows, statusRows } from './sheet-rows.mjs';

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';
const pub = (col) => `artifacts/${APP_ID}/public/data/${col}`;

export async function gatherTeams(db) {
  const [profSnap, gsSnap] = await Promise.all([
    db.collectionGroup('profile').get(),
    db.collectionGroup('gameState').get(),
  ]);
  const gsByUid = {};
  for (const d of gsSnap.docs) {
    const parts = d.ref.path.split('/');
    const uid = parts[parts.indexOf('users') + 1];
    const gs = d.data();
    const slots = gs.slots ?? [];
    const active = slots.find((s) => s.status === 'active');
    gsByUid[uid] = {
      score: gs.score ?? 0,
      completedSlots: slots.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
      stageIndex: active?.index ?? null,
      finished: slots.length > 0 && slots.every((s) => s.status === 'completed' || s.status === 'skipped'),
    };
  }
  const teams = [];
  for (const d of profSnap.docs) {
    if (d.id !== 'team') continue;
    const parts = d.ref.path.split('/');
    const uid = parts[parts.indexOf('users') + 1];
    const p = d.data();
    teams.push({
      teamId: uid, name: p.name, code: p.code, status: p.status,
      ...(gsByUid[uid] ?? { score: 0, completedSlots: 0, stageIndex: null, finished: false }),
    });
  }
  return teams;
}

const docsOf = async (db, col) => (await db.collection(pub(col)).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

export async function pushStatus(db)     { await replaceTab('status', statusRows(await gatherTeams(db))); }
export async function pushTasks(db)      { await replaceTab('tasks', tasksRows(await docsOf(db, 'tasks'))); }
export async function pushZones(db)      { await replaceTab('basketZones', basketZonesRows(await docsOf(db, 'basketZones'))); }
export async function pushRaceConfig(db) {
  const cfg = (await db.doc(`${pub('raceConfig')}/current`).get()).data();
  await replaceTab('raceConfig', raceConfigRows(cfg));
}

export async function pushAll(db) {
  await pushTasks(db);
  await pushZones(db);
  await pushRaceConfig(db);
  await pushStatus(db);
}
