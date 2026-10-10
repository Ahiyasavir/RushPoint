// ═══════════════════════════════════════════════════════════════════════════════
// Load the VPS API with a MULTI-PHONE race, against an ISOLATED emulator backend.
//
//   node scripts/load-vps.mjs --api=http://127.0.0.1:18080 --auth=http://127.0.0.1:19099 \
//        --game=game.json --teams=70 --phones=6
//
// WHY THIS EXISTS (change: race-multi-phone-capacity). simulate-prod.mjs models ONE phone
// per team and spends real Firebase quota. The question here is different: does the VPS
// itself (CPU, memory, event loop, upload disk) hold a race where every team carries several
// phones? That is answered by running the real API image on the real VPS, pointed at a
// Firestore + Auth EMULATOR, so nothing here can touch production data or quota. The
// emulator runs on the same box, which makes the measurement STRICTER, not looser.
//
// What one phone does is copied from play-web, not invented:
//   - every phone polls getMyTeamState every 60s (PlayScreen.tsx fallback poll)
//   - every phone refreshes when its team document changes (the onSnapshot trigger)
//   - only the controller pings location and acts on missions
// Identities come from the Auth emulator (no per-IP sign-up quota there).
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] ?? d;
const API = arg('api', 'http://127.0.0.1:18080');
const AUTH = arg('auth', 'http://127.0.0.1:19099');
const GAME = JSON.parse(readFileSync(arg('game', 'game.json'), 'utf8'));
const TEAMS = Number(arg('teams', '70'));
const PHONES = Number(arg('phones', '6'));
const CONSOLES = Number(arg('consoles', '2'));
const POLL_MS = Number(arg('poll-ms', '60000'));
const PING_MS = Number(arg('ping-ms', '20000'));
const THINK_MS = Number(arg('think-ms', '30000'));
const JOIN_WINDOW_MS = Number(arg('join-window-ms', '60000'));
const VIDEO_MB = Number(arg('video-mb', '8'));
const PHOTO_KB = Number(arg('photo-kb', '600'));
const MAX_MIN = Number(arg('max-minutes', '30'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const latency = new Map();
const errors = new Map();
let calls = 0;
const t0 = Date.now();
let stop = false;

async function signUp() {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`signUp failed: ${JSON.stringify(j).slice(0, 200)}`);
  return { uid: j.localId, token: j.idToken };
}

function party({ uid, token }) {
  return {
    uid, token,
    async call(fn, data) {
      const s = Date.now();
      calls++;
      try {
        const res = await fetch(`${API}/${fn}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ data: data ?? {} }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.error) {
          const e = new Error(json.error.message); e.code = String(json.error.status ?? 'unknown').toLowerCase(); throw e;
        }
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.code = `http-${res.status}`; throw e; }
        return json.result;
      } catch (e) {
        const k = `${fn}:${e.code ?? e.cause?.code ?? 'network'}`;
        errors.set(k, (errors.get(k) ?? 0) + 1);
        throw e;
      } finally {
        if (!latency.has(fn)) latency.set(fn, []);
        latency.get(fn).push(Date.now() - s);
      }
    },
  };
}

async function upload(p, path, kind) {
  const bytes = kind === 'video' ? VIDEO_MB * 1024 * 1024 : PHOTO_KB * 1024;
  const body = Buffer.alloc(bytes, 0x20);
  body.write('\xff\xd8\xff\xe0', 0, 'latin1');
  const s = Date.now();
  const res = await fetch(`${API}/upload?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${p.token}`, 'Content-Type': kind === 'video' ? 'video/mp4' : 'image/jpeg' },
    body,
  });
  const key = kind === 'video' ? 'upload(video)' : 'upload(photo)';
  if (!latency.has(key)) latency.set(key, []);
  latency.get(key).push(Date.now() - s);
  if (!res.ok) { errors.set(`${key}:http-${res.status}`, (errors.get(`${key}:http-${res.status}`) ?? 0) + 1); throw new Error(`upload ${res.status}`); }
  const j = await res.json().catch(() => ({}));
  return j.url ?? j.downloadURL;
}

const reviewQueue = [];
const TASKS = new Map();
for (const s of GAME.stages) for (const t of s.tasks) TASKS.set(t.id, t);
const PHOTO_IDS = [...TASKS.values()].filter((t) => t.type === 'photo').map((t) => t.id);
const center = GAME.stages[0].tasks.find((t) => t.coordinates)?.coordinates ?? { lat: 31.805, lng: 35.185 };
const near = (p, m) => ({ lat: p.lat + rnd(-m, m) / 111320, lng: p.lng + rnd(-m, m) / 94000 });

async function act(team, ctx, rec, here) {
  const t = TASKS.get(rec.taskId);
  // play-web sends the current fix with every submission; a presence mission refuses without it.
  const C = { ...ctx, taskId: t.id, lat: here.lat, lng: here.lng, accuracyMeters: 8 };
  if (t.coordinates) {
    try { await team.call('reportArrival', { ...C, lat: here.lat, lng: here.lng, accuracyMeters: 8 }); } catch { /* server decides */ }
  }
  switch (t.type) {
    case 'quiz':
      if (t.orderItems?.length) return team.call('submitTaskAnswer', { ...C, orderedAnswer: [...t.orderItems] });
      if (t.answers?.length) return team.call('submitTaskAnswer', { ...C, answer: t.answers[0] });
      for (const [i, st] of (t.steps ?? []).entries()) await team.call('submitSequenceStep', { ...C, stepIndex: i, answer: st.answer });
      return;
    case 'smart_station':
      // A station either has a secret code or scored answer outcomes (answerOutcomes.accepts).
      return team.call('verifyStationCode', { ...C, teamId: team.uid, code: t.smart?.secretCode ?? t.secretCode ?? t.answerOutcomes?.[0]?.accepts?.[0] });
    case 'photo': {
      const kind = t.smart?.captureKind ?? 'photo';
      const url = await upload(team, `runs/${ctx.runId}/teams/${team.uid}/${t.id}.${kind === 'video' ? 'mp4' : 'jpg'}`, kind);
      const extra = kind === 'video' ? { mediaDurationSeconds: 20 } : {};
      return team.call('submitStationPhoto', { ...C, teamId: team.uid, photoUrl: url, contentType: kind === 'video' ? 'video/mp4' : 'image/jpeg', ...extra });
    }
    default:
      return team.call('completeTask', { ...C, lat: here.lat, lng: here.lng, accuracyMeters: 8 });
  }
}

/** Every attached phone: the 60s fallback poll plus a refresh on each team-doc change. */
async function viewerLoop(v, ctx, bus) {
  const refresh = () => v.call('getMyTeamState', ctx).catch(() => {});
  bus.on('change', () => { setTimeout(refresh, rnd(150, 1500)); });
  await sleep(rnd(0, POLL_MS));
  while (!stop) { await refresh(); await sleep(POLL_MS); }
}

async function controllerLoop(team, ctx, bus, stats) {
  let pos = near(center, 100);
  let lastPing = 0;
  let lastPoll = 0;
  const changed = () => bus.emit('change');
  const submitted = new Set();
  // The controller's own fallback poll + ping cadence run alongside play.
  (async () => {
    while (!stop) {
      if (Date.now() - lastPing >= PING_MS) {
        lastPing = Date.now();
        team.call('updateLocation', { ...ctx, lat: pos.lat, lng: pos.lng, accuracyMeters: 10 }).catch(() => {});
      }
      if (Date.now() - lastPoll >= POLL_MS) { lastPoll = Date.now(); team.call('getMyTeamState', ctx).catch(() => {}); }
      await sleep(1000);
    }
  })();
  while (!stop) {
    let state;
    try { state = await team.call('getMyTeamState', ctx); } catch { await sleep(2000); continue; }
    if (state?.team?.status === 'finished') { stats.finished++; return; }
    const recs = (state?.team?.stages ?? []).filter((s) => s.status === 'active').flatMap((s) => s.tasks ?? []);
    const assigned = recs.find((r) => r.status === 'assigned');
    // A submitted photo waits for a human. The phone shows "waiting for approval" and never
    // re-submits; the participant projection does not carry the submission, so remember it here.
    if (assigned && submitted.has(assigned.taskId)) { await sleep(3000); continue; }
    if (!assigned) {
      const r = await team.call('requestNextTask', { ...ctx, lat: pos.lat, lng: pos.lng }).catch(() => null);
      if (r?.reason) stats.holds.set(r.reason, (stats.holds.get(r.reason) ?? 0) + 1);
      changed();
      await sleep(1500);
      continue;
    }
    const dest = TASKS.get(assigned.taskId)?.coordinates;
    if (dest) pos = near(dest, 4);
    await sleep(rnd(THINK_MS * 0.5, THINK_MS * 1.5));
    try {
      await act(team, ctx, assigned, pos); stats.acts++;
      if (TASKS.get(assigned.taskId)?.type === 'photo') {
        submitted.add(assigned.taskId);
        // The console lists exactly the submissions that exist; the reviewer approves those.
        reviewQueue.push({ teamId: team.uid, taskId: assigned.taskId });
      }
    } catch (e) { stats.actErrors.push(`${TASKS.get(assigned.taskId)?.title}: ${e.code} ${e.message}`); }
    changed();
  }
}

async function consoleLoop(owner, ctx, stats) {
  let lastBoard = 0;
  while (!stop) {
    try {
      await owner.call('listRunTeams', { gameId: ctx.gameId, runId: ctx.runId });
      while (reviewQueue.length) {
        const { teamId, taskId } = reviewQueue.shift();
        await owner.call('reviewStationSubmission', { ...ctx, teamId, taskId, approved: true }).then(() => stats.reviews++, () => {});
      }
      if (Date.now() - lastBoard > 20000) { lastBoard = Date.now(); await owner.call('refreshLeaderboard', { gameId: ctx.gameId, runId: ctx.runId }).catch(() => {}); }
    } catch { /* tallied */ }
    await sleep(5000);
  }
}

async function main() {
  const owner = party(await signUp());
  const { gameId } = await owner.call('importGameFile', { file: { format: 'rushpoint.game', schemaVersion: 1, exportedAt: new Date().toISOString(), game: GAME } });
  // Re-read the imported game so task ids match what the server stored.
  const stored = await owner.call('getGame', { gameId });
  const g = stored?.game ?? stored;
  TASKS.clear(); PHOTO_IDS.length = 0;
  for (const s of g.stages) for (const t of s.tasks) { TASKS.set(t.id, t); if (t.type === 'photo') PHOTO_IDS.push(t.id); }
  const { runId, accessCode } = await owner.call('launchRun', { gameId });
  const ctx = { ownerUid: owner.uid, gameId, runId };
  console.log(`game=${gameId} run=${runId} code=${accessCode}  teams=${TEAMS} phones/team=${PHONES} (=${TEAMS * PHONES} phones)`);

  // Identities: minted before the clock starts, so the join burst below is pure API load.
  const ids = [];
  for (let i = 0; i < TEAMS * PHONES; i += 25) {
    ids.push(...await Promise.all(Array.from({ length: Math.min(25, TEAMS * PHONES - i) }, signUp)));
  }
  console.log(`identities: ${ids.length}`);

  const regFields = (g.registrationFields ?? []).filter((f) => f.level === 'team');
  const stats = { finished: 0, acts: 0, actErrors: [], holds: new Map(), reviews: 0, joinFail: [], attachFail: [] };
  const teams = [];
  const joinStart = Date.now();
  await Promise.all(Array.from({ length: TEAMS }, async (_, i) => {
    await sleep(rnd(0, JOIN_WINDOW_MS * 0.6));
    const ctl = party(ids[i * PHONES]);
    const registrationData = Object.fromEntries(regFields.map((f) => [f.id, f.type === 'phone' ? '0501234567' : `סים ${i}`]));
    try {
      await ctl.call('joinRun', { code: accessCode, displayName: `קבוצה ${i + 1}`, registrationData, memberNames: Array.from({ length: PHONES }, (_, k) => `תלמיד ${k + 1}`) });
    } catch (e) { stats.joinFail.push(`team ${i + 1}: ${e.code} ${e.message}`); return; }
    const st = await ctl.call('getMyTeamState', ctx);
    const teamCode = st?.team?.deviceJoinCode;
    const viewers = [];
    await Promise.all(Array.from({ length: PHONES - 1 }, async (__, k) => {
      await sleep(rnd(0, JOIN_WINDOW_MS * 0.4));
      const v = party(ids[i * PHONES + k + 1]);
      try { await v.call('joinTeamAsDevice', { code: accessCode, teamCode, memberName: `תלמיד ${k + 2}` }); viewers.push(v); }
      catch (e) { stats.attachFail.push(`team ${i + 1} phone ${k + 2}: ${e.code} ${e.message}`); }
    }));
    teams.push({ ctl, viewers, bus: new EventEmitter().setMaxListeners(50) });
  }));
  const joinSec = ((Date.now() - joinStart) / 1000).toFixed(0);
  console.log(`joined ${teams.length}/${TEAMS} teams, ${teams.reduce((n, t) => n + 1 + t.viewers.length, 0)}/${TEAMS * PHONES} phones in ${joinSec}s`);

  await owner.call('startTeams', { gameId, runId });
  const consoles = Array.from({ length: CONSOLES }, () => consoleLoop(owner, ctx, stats));
  for (const t of teams) for (const v of t.viewers) viewerLoop(v, ctx, t.bus);
  const deadline = sleep(MAX_MIN * 60000).then(() => { stop = true; });
  const tick = setInterval(() => {
    const min = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`[${min}m] calls=${calls} finished=${stats.finished}/${teams.length} acts=${stats.acts} errors=${[...errors.values()].reduce((a, b) => a + b, 0)}`);
  }, 30000);
  await Promise.race([Promise.all(teams.map((t) => controllerLoop(t.ctl, ctx, t.bus, stats))), deadline]);
  stop = true;
  clearInterval(tick);
  await Promise.allSettled(consoles);

  const wall = (Date.now() - t0) / 1000;
  console.log(`\n══ RESULT ══\nwall ${(wall / 60).toFixed(1)} min · ${calls} callables · ${(calls / wall).toFixed(1)}/s average`);
  console.log(`teams finished ${stats.finished}/${teams.length} · mission actions ${stats.acts} · reviews ${stats.reviews}`);
  if (stats.joinFail.length) console.log(`JOIN FAILURES ${stats.joinFail.length}:\n  ${stats.joinFail.slice(0, 10).join('\n  ')}`);
  if (stats.attachFail.length) console.log(`ATTACH FAILURES ${stats.attachFail.length}:\n  ${stats.attachFail.slice(0, 10).join('\n  ')}`);
  if (stats.holds.size) console.log(`holds: ${JSON.stringify(Object.fromEntries(stats.holds))}`);
  if (errors.size) { console.log('errors:'); for (const [k, v] of [...errors].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(48)} ${v}`); }
  if (stats.actErrors.length) console.log(`first action errors:\n  ${stats.actErrors.slice(0, 12).join('\n  ')}`);
  console.log('\nlatency (ms):');
  for (const [fn, arr] of [...latency].sort((a, b) => b[1].length - a[1].length)) {
    const s = [...arr].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    console.log(`  ${fn.padEnd(24)} n=${String(s.length).padStart(6)} p50=${String(q(0.5)).padStart(6)} p95=${String(q(0.95)).padStart(6)} p99=${String(q(0.99)).padStart(6)} max=${String(s[s.length - 1]).padStart(6)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
