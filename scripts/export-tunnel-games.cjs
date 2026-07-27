// One-off recovery export: pull authored games out of the LIVE playtest tunnel's
// Firestore emulator so they can be imported into the real project.
//
// WHY THIS EXISTS. The playtest stack ran against the local emulator on a second
// machine; every game a creator authored there lives ONLY in that emulator's
// memory/export, and production Firestore was empty. The machine itself is not
// reachable from here, but the tunnel is — and the playtest proxy
// (scripts/proxy.mjs -> resolveProxyTarget) routes any URL containing "/firestore"
// to the Firestore emulator. Appending a harmless `x=/firestore` query param is
// therefore enough to reach the emulator's REST API through the single tunnel
// origin. `Authorization: Bearer owner` is the emulator's documented admin bypass,
// so security rules do not apply (this is an emulator, not the real project).
//
// READ-ONLY. This script never writes to the tunnel. Its output is a plain JSON
// bundle for scripts/import-games-to-prod.cjs, which does the writing (and the
// owner-UID remapping, since emulator UIDs differ from production UIDs).
//
//   node scripts/export-tunnel-games.cjs <tunnel-base-url> <out.json>
const fs = require('node:fs');

const TUNNEL = (process.argv[2] || '').replace(/\/+$/, '');
const OUT = process.argv[3] || 'tunnel-games.json';
if (!TUNNEL) {
  console.error('usage: node scripts/export-tunnel-games.cjs <tunnel-base-url> <out.json>');
  process.exit(1);
}

const PROJECT = 'rushpoint-pwa-7daaa';
const BASE = `${TUNNEL}/v1/projects/${PROJECT}/databases/(default)/documents`;
const HEADERS = {
  // Without this ngrok's free tier serves its interstitial HTML instead of the app.
  'ngrok-skip-browser-warning': '1',
  // Emulator admin bypass — rules do not apply to an owner-token request.
  Authorization: 'Bearer owner',
  'Content-Type': 'application/json',
};
// The proxy routes on substring match; this is what steers the request to :8080.
const ROUTE = 'x=/firestore';

async function api(path, init) {
  const res = await fetch(path, { headers: HEADERS, ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

/** Firestore REST typed value -> plain JS. Total: an unknown wrapper yields null. */
function decode(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return { __ts: v.timestampValue };
  if ('geoPointValue' in v) return { __geo: v.geoPointValue };
  if ('bytesValue' in v) return { __bytes: v.bytesValue };
  if ('referenceValue' in v) return { __ref: v.referenceValue };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decode(v);
  return out;
}

/** Every document of a collection path, following pagination. */
async function listAll(collPath) {
  const out = [];
  let token = null;
  do {
    const url = `${BASE}/${collPath}?pageSize=300${token ? `&pageToken=${token}` : ''}&${ROUTE}`;
    const page = await api(url);
    for (const d of page.documents || []) {
      out.push({ id: d.name.split('/').pop(), data: decodeFields(d.fields) });
    }
    token = page.nextPageToken || null;
  } while (token);
  return out;
}

async function getDoc(docPath) {
  try {
    const d = await api(`${BASE}/${docPath}?${ROUTE}`);
    return decodeFields(d.fields);
  } catch {
    return null; // absent is normal (e.g. a parent user doc that was never written)
  }
}

/** Collection-group query — finds games whose PARENT users/{uid} doc doesn't exist. */
async function allGames() {
  const res = await fetch(`${BASE}:runQuery?${ROUTE}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      structuredQuery: { from: [{ collectionId: 'games', allDescendants: true }], limit: 500 },
    }),
  });
  if (!res.ok) throw new Error(`runQuery ${res.status}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.document)
    .map((r) => {
      const rel = r.document.name.split('/documents/')[1].split('/');
      return { ownerUid: rel[1], gameId: rel[3], data: decodeFields(r.document.fields) };
    });
}

(async () => {
  console.log(`Exporting from ${TUNNEL}`);
  const games = await allGames();
  console.log(`  games (collection group): ${games.length}`);

  const owners = [...new Set(games.map((g) => g.ownerUid))];
  const users = {};
  const wallets = {};
  for (const uid of owners) {
    users[uid] = await getDoc(`users/${uid}`);
    wallets[uid] = await getDoc(`wallets/${uid}`);
  }
  console.log(`  owners: ${owners.length} (${owners.filter((u) => users[u]).length} with a profile doc)`);

  const publicGames = await listAll('publicGames');
  const publicTasks = await listAll('publicTasks');
  console.log(`  publicGames: ${publicGames.length} · publicTasks: ${publicTasks.length}`);

  const bundle = { exportedFrom: TUNNEL, project: PROJECT, games, users, wallets, publicGames, publicTasks };
  fs.writeFileSync(OUT, JSON.stringify(bundle, null, 2), 'utf8');
  console.log(`\nWrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  for (const g of games) {
    console.log(`   ${g.data.deletedAt ? '[del] ' : '      '}${g.gameId}  "${g.data.title || '(untitled)'}"  owner=${g.ownerUid}`);
  }
})().catch((e) => {
  console.error('EXPORT FAILED:', e.message);
  process.exit(1);
});
