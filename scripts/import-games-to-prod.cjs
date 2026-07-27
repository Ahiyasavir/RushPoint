// One-off recovery import: write the bundle from scripts/export-tunnel-games.cjs
// into the REAL Firebase project, remapping owner UIDs.
//
// WHY THE REMAP MATTERS. Games live at `users/{ownerUid}/games/{gameId}`, and the
// emulator minted different UIDs than production for the same person — e.g.
// spendora.tracker@gmail.com is Ub8dt0H1… in the emulator but wTYDwnEZ… in the real
// project. Copying a game across verbatim would file it under a UID that nobody can
// sign in as, so the creator would never see it. Every ownerUid — the document PATH,
// the game's own `ownerUid` field, and the denormalised copies on
// publicGames/publicTasks — has to be rewritten together or the game is orphaned.
//
// RUNS ON THE VPS, which already holds the service-account credential. Admin SDK
// writes bypass security rules, which is required: run/score/gallery docs are
// server-write-only by design.
//
// SAFE BY DEFAULT: dry-run unless --execute is passed. Never deletes anything; a
// game that already exists is overwritten only with --execute (and reported).
//
//   node import-games-to-prod.cjs <bundle.json> [--execute]
const fs = require('node:fs');
const admin = require('firebase-admin');

const BUNDLE = process.argv[2];
const EXECUTE = process.argv.includes('--execute');
if (!BUNDLE) {
  console.error('usage: node import-games-to-prod.cjs <bundle.json> [--execute]');
  process.exit(1);
}

// ── What to import, and who ends up owning it ────────────────────────────────
// Emulator UID -> production UID. Anything not listed keeps its own id, which is
// correct for the seeded demo/template creators (demo-creator, qa-creator, …):
// those ids are literal strings, not generated UIDs, so they mean the same thing
// in both places.
const OWNER_REMAP = {
  // spendora.tracker@gmail.com — the human creator.
  Ub8dt0H1cMwjAbXcyqTSJavdYapu: 'wTYDwnEZP6MhGyaGINbumaYqKem1',
};

// Only these game ids are imported. Everything else in the bundle (deleted copies,
// and games authored by other testers) is deliberately left behind.
const IMPORT_GAMES = new Set([
  'LOx9ZKpoLWlQnRWXStYI', // משחק שדה לסניף בני עקיבא רמות — the creator's real game
  'demo-instant-spy', // אקדמיית הסוכנים 🕵️ — the flagship instant-play demo (homepage)
  'demo-game-oldcity', // seeded template
  'qa-playground', // seeded QA template
  'sansana-treasure-map', // seeded template
]);

// Profile details for a production owner whose `users/{uid}` doc must be created
// (production Firestore was empty, so the human creator has no profile doc yet).
const PROFILE_OVERRIDES = {
  wTYDwnEZP6MhGyaGINbumaYqKem1: {
    uid: 'wTYDwnEZP6MhGyaGINbumaYqKem1',
    email: 'spendora.tracker@gmail.com',
    displayName: 'אחיה סביר',
  },
};

const remap = (uid) => OWNER_REMAP[uid] || uid;

/** Undo the export's typed-value markers and drop `undefined` (Firestore rejects it). */
function revive(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(revive);
  if (typeof v === 'object') {
    if (v.__ts) return admin.firestore.Timestamp.fromDate(new Date(v.__ts));
    if (v.__geo) return new admin.firestore.GeoPoint(Number(v.__geo.latitude || 0), Number(v.__geo.longitude || 0));
    if (v.__bytes) return Buffer.from(v.__bytes, 'base64');
    if (v.__ref) return String(v.__ref);
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      out[k] = revive(val);
    }
    return out;
  }
  return v;
}

(async () => {
  const bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const games = bundle.games.filter((g) => IMPORT_GAMES.has(g.gameId) && !g.data.deletedAt);
  const skipped = bundle.games.filter((g) => !games.includes(g));

  console.log(`${EXECUTE ? 'EXECUTING' : 'DRY RUN (pass --execute to write)'}\n`);
  console.log(`Importing ${games.length} game(s); skipping ${skipped.length}.\n`);

  const writes = [];
  const owners = new Set();

  for (const g of games) {
    const owner = remap(g.ownerUid);
    owners.add(owner);
    const data = revive({ ...g.data, ownerUid: owner });
    writes.push({ path: `users/${owner}/games/${g.gameId}`, data, label: `game "${g.data.title}"` });
  }

  // Creator profile + wallet for every resulting owner.
  for (const owner of owners) {
    const src = Object.entries(bundle.users).find(([uid]) => remap(uid) === owner);
    const profile = PROFILE_OVERRIDES[owner]
      || (src && src[1] ? { ...revive(src[1]), uid: owner } : { uid: owner });
    writes.push({ path: `users/${owner}`, data: { ...profile, uid: owner }, label: 'creator profile', merge: true });

    const wsrc = Object.entries(bundle.wallets).find(([uid]) => remap(uid) === owner);
    const wallet = wsrc && wsrc[1]
      ? { ...revive(wsrc[1]), uid: owner }
      : { uid: owner, eventCredits: 10, lifetimeFreeRunsUsed: 0, bonusFreeRuns: 0, plan: 'free', proExpiresAt: null, stripeSubscriptionId: null };
    writes.push({ path: `wallets/${owner}`, data: wallet, label: 'wallet', merge: true });
  }

  // Gallery projections for the imported games only.
  for (const pg of bundle.publicGames) {
    if (!IMPORT_GAMES.has(pg.id)) continue;
    const owner = remap(pg.data.ownerUid);
    writes.push({ path: `publicGames/${pg.id}`, data: revive({ ...pg.data, ownerUid: owner }), label: `publicGame "${pg.data.title}"` });
  }
  for (const pt of bundle.publicTasks) {
    if (!IMPORT_GAMES.has(pt.data.sourceGameId)) continue;
    const owner = remap(pt.data.ownerUid);
    writes.push({ path: `publicTasks/${pt.id}`, data: revive({ ...pt.data, ownerUid: owner }), label: 'publicTask' });
  }

  console.log('Planned writes:');
  const byKind = {};
  for (const w of writes) {
    const kind = w.path.split('/')[0] + (w.path.includes('/games/') ? '/games' : '');
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  for (const [k, n] of Object.entries(byKind)) console.log(`   ${k}: ${n}`);
  console.log();
  for (const g of games) {
    console.log(`   ${g.gameId}  "${g.data.title}"\n      ${g.ownerUid} -> ${remap(g.ownerUid)}${remap(g.ownerUid) !== g.ownerUid ? '   [REMAPPED]' : ''}`);
  }
  console.log('\nSkipped:');
  for (const s of skipped) console.log(`   ${s.gameId} "${s.data.title}"${s.data.deletedAt ? ' [deleted]' : ' [not in import list]'}`);

  if (!EXECUTE) {
    console.log('\nDry run complete — nothing was written.');
    return;
  }

  let done = 0;
  for (const w of writes) {
    await db.doc(w.path).set(w.data, w.merge ? { merge: true } : {});
    done++;
  }
  console.log(`\nWrote ${done} document(s) to production.`);
})().catch((e) => {
  console.error('IMPORT FAILED:', e.message);
  process.exit(1);
});
