// Pure-logic tests for the VPS-local GPS movement track store (change: vps-track-storage).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// WHY THIS EXISTS: `spark-tier-location-load` distance-samples the movement track (one point
// per ~100 m) purely to bound its Firestore write cost. On the self-hosted VPS the same process
// that runs `updateLocation` already writes participant media to local disk, where a write costs
// nothing against the Spark ceilings — so the sampling compromise can be dropped entirely and
// every ping retained. This module is where that lands.
//
// THE ASSERTION THAT MATTERS MOST is the concurrency one. Many teams ping the SAME run at the
// same time, so this file is the only place in the change where a point can be silently lost or
// a record corrupted. `fs.appendFile` happens to be atomic below PIPE_BUF on most POSIX
// filesystems, but leaning on a kernel implementation detail rather than stating the invariant
// is exactly the narrower-than-assumed foundation this codebase's own incident history warns
// about — so the store serialises per run, and the test below is what holds it to that.
//
// SECOND: the null-vs-empty contract. `read()` MUST distinguish "no file at all" (⇒ the caller
// falls back to Firestore) from "a file exists and is empty" (⇒ disk mode was active and the run
// genuinely has no points yet). Conflating them would make a fresh disk-mode run look like a
// legacy Firestore run and silently surface the wrong source.
//
// Touches a REAL temp directory, like scripts/test-emulator-gate-isolation.ts. No emulator.
//   npx tsx scripts/test-track-store.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTrackStore, TRACK_DIR_ENV } from '../functions/src/trackStore';
import { shouldRetainTrackPoint } from '../packages/shared/src/locationPingEconomy';
import { buildMovementDensity } from '../packages/shared/src/movementHeatmap';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const REF = { ownerUid: 'owner1', gameId: 'game1', runId: 'run1' };
const REF2 = { ownerUid: 'owner1', gameId: 'game1', runId: 'run2' };

/** A fresh temp root per case, so no test can see another's files. */
function tmpRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rp-track-${label}-`));
}

async function main(): Promise<void> {

// ── Round trip ───────────────────────────────────────────────────────────────
{
  const root = tmpRoot('roundtrip');
  const store = createTrackStore({ root });
  ok(store.enabled === true, 'a store with a root is enabled');

  await store.append(REF, { lat: 31.78, lng: 35.21, teamId: 'teamA' });
  await store.append(REF, { lat: 31.79, lng: 35.22, teamId: 'teamA' });

  const points = await store.read(REF);
  ok(points !== null, 'a written run reads back a non-null array');
  ok(points?.length === 2, `both points come back, got ${points?.length}`);
  ok(points?.[0].lat === 31.78 && points?.[1].lat === 31.79,
    'points come back in the order they were appended');
}

// ── Two runs never share a file ─────────────────────────────────────────────
{
  const root = tmpRoot('isolation');
  const store = createTrackStore({ root });
  await store.append(REF, { lat: 1, lng: 1 });
  await store.append(REF2, { lat: 2, lng: 2 });
  await store.append(REF2, { lat: 3, lng: 3 });

  ok((await store.read(REF))?.length === 1, 'run1 holds only its own point');
  ok((await store.read(REF2))?.length === 2, 'run2 holds only its own points');
  ok((await store.read(REF))?.[0].lat === 1, 'run1 did not pick up run2 data');
}

// ── THE ONE THAT MATTERS: concurrent appends to the SAME run ────────────────
{
  const root = tmpRoot('concurrent');
  const store = createTrackStore({ root });

  // 200 teams appending at once to one run's file, fired without awaiting in between —
  // the real shape of a live run, where every phone pings on its own timer.
  const N = 200;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      store.append(REF, { lat: 31 + i / 10_000, lng: 35, teamId: `team-${i}` })),
  );

  const points = await store.read(REF);
  ok(points?.length === N, `every concurrent append landed: expected ${N}, got ${points?.length}`);

  // Not just the count — every RECORD must be individually intact. A torn or interleaved
  // write would show up as a line that does not parse, or one carrying merged fields.
  const raw = fs.readFileSync(path.join(root, REF.ownerUid, REF.gameId, `${REF.runId}.jsonl`), 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  ok(lines.length === N, `the file holds exactly ${N} lines, got ${lines.length}`);

  let unparseable = 0;
  const seenTeams = new Set<string>();
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (typeof rec.teamId === 'string') seenTeams.add(rec.teamId);
    } catch { unparseable++; }
  }
  ok(unparseable === 0, `every line parses on its own, ${unparseable} did not`);
  ok(seenTeams.size === N, `every distinct team is represented, got ${seenTeams.size}`);
}

// ── Concurrent appends across DIFFERENT runs do not block each other ────────
{
  const root = tmpRoot('multirun');
  const store = createTrackStore({ root });
  const refs = Array.from({ length: 10 }, (_, i) => ({
    ownerUid: 'owner1', gameId: 'game1', runId: `run-${i}`,
  }));
  await Promise.all(refs.flatMap((r) =>
    Array.from({ length: 20 }, (_, i) => store.append(r, { lat: i, lng: i }))));

  let allCorrect = true;
  for (const r of refs) {
    if ((await store.read(r))?.length !== 20) allCorrect = false;
  }
  ok(allCorrect, 'each of 10 concurrent runs holds exactly its own 20 points');
}

// ── null (no file) vs [] (empty file) — the fallback contract ───────────────
{
  const root = tmpRoot('nullvsempty');
  const store = createTrackStore({ root });

  ok((await store.read(REF)) === null,
    'a run never written reads back NULL — the caller must fall back to Firestore');

  // Create the file with nothing in it, the way a disk-mode run that has taken no pings yet
  // would look once its directory is prepared.
  const dir = path.join(root, REF.ownerUid, REF.gameId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${REF.runId}.jsonl`), '');

  const empty = await store.read(REF);
  ok(Array.isArray(empty) && empty.length === 0,
    'a run whose file exists but is empty reads back [] — NOT null, so no wrong fallback');
}

// ── A malformed line never destroys the whole track ────────────────────────
{
  const root = tmpRoot('malformed');
  const store = createTrackStore({ root });
  await store.append(REF, { lat: 1, lng: 1 });

  const file = path.join(root, REF.ownerUid, REF.gameId, `${REF.runId}.jsonl`);
  fs.appendFileSync(file, '{ this is not json\n');
  await store.append(REF, { lat: 2, lng: 2 });

  const points = await store.read(REF);
  ok(points?.length === 2,
    `a corrupt line is skipped and the good points survive, got ${points?.length}`);
}

// ── Path traversal is REFUSED, not sanitised into something else ────────────
{
  const root = tmpRoot('traversal');
  const store = createTrackStore({ root });

  const evil = [
    { ownerUid: '..', gameId: '..', runId: 'escape' },
    { ownerUid: 'owner1', gameId: '../../etc', runId: 'passwd' },
    { ownerUid: 'owner1', gameId: 'game1', runId: '../../../escape' },
    { ownerUid: '', gameId: 'game1', runId: 'run1' },
    { ownerUid: 'owner1', gameId: '', runId: 'run1' },
    { ownerUid: 'owner1', gameId: 'game1', runId: '' },
    { ownerUid: 'a/b', gameId: 'game1', runId: 'run1' },
    { ownerUid: 'owner1', gameId: 'g\\b', runId: 'run1' },
  ];

  let threw = false;
  for (const ref of evil) {
    try {
      await store.append(ref, { lat: 1, lng: 1 });
      ok((await store.read(ref)) === null, `refused ref is never readable: ${JSON.stringify(ref)}`);
    } catch { threw = true; }
  }
  ok(!threw, 'a refused path is handled, never thrown out of the store');

  // And nothing was created outside the root.
  const parent = path.dirname(root);
  ok(!fs.existsSync(path.join(parent, 'escape.jsonl')), 'nothing was written above the root');
  ok(!fs.existsSync(path.join(root, '..', 'escape.jsonl')), 'no escape file beside the root');
}

// ── Delete ──────────────────────────────────────────────────────────────────
{
  const root = tmpRoot('delete');
  const store = createTrackStore({ root });
  await store.append(REF, { lat: 1, lng: 1 });
  ok((await store.read(REF)) !== null, 'the track exists before deletion');

  await store.delete(REF);
  ok((await store.read(REF)) === null, 'after deletion the run reads back null again');

  // Deleting what was never there must be a silent no-op — pruneRunPII calls this for EVERY
  // finished run, including every Firestore-mode one that never had a disk file.
  let threw = false;
  try { await store.delete(REF2); } catch { threw = true; }
  ok(!threw, 'deleting a run that has no disk file does not throw');
}

// ── Disabled store: every operation is inert, nothing is created ────────────
{
  const store = createTrackStore({ root: undefined });
  ok(store.enabled === false, 'a store with no root is disabled');

  let threw = false;
  try {
    await store.append(REF, { lat: 1, lng: 1 });
    ok((await store.read(REF)) === null, 'a disabled store always reads null (⇒ Firestore fallback)');
    await store.delete(REF);
  } catch { threw = true; }
  ok(!threw, 'a disabled store never throws');

  // An empty-string root is the same as unset — an operator who sets the var to "" has not
  // opted in, and must not get a store rooted at the process working directory.
  ok(createTrackStore({ root: '' }).enabled === false, 'an empty root string is treated as disabled');
  ok(createTrackStore({ root: '   ' }).enabled === false, 'a whitespace-only root is treated as disabled');
}

// ── A broken root never fails the caller (best-effort contract) ─────────────
{
  // Root is a FILE, so every mkdir/append beneath it must fail at the OS level. The store's
  // job is to swallow that: a location ping must not fail because a disk write did.
  const base = tmpRoot('brokenroot');
  const asFile = path.join(base, 'not-a-dir');
  fs.writeFileSync(asFile, 'x');
  const store = createTrackStore({ root: asFile });

  let threw = false;
  try {
    await store.append(REF, { lat: 1, lng: 1 });
    const read = await store.read(REF);
    ok(read === null, 'an unreadable track reads back null rather than an exception');
    await store.delete(REF);
  } catch { threw = true; }
  ok(!threw, 'a broken root never throws out of append/read/delete');
}

// ── The point payload is preserved faithfully ──────────────────────────────
{
  const root = tmpRoot('payload');
  const store = createTrackStore({ root });
  await store.append(REF, { lat: 31.7683, lng: 35.2137, teamId: 'teamZ', at: '2026-08-30T10:00:00.000Z' });
  const p = (await store.read(REF))?.[0];
  ok(p?.lat === 31.7683 && p?.lng === 35.2137, 'coordinates survive the round trip exactly');
  ok(p?.teamId === 'teamZ', 'teamId survives');
  ok(p?.at === '2026-08-30T10:00:00.000Z', 'the timestamp survives');
}

// ── A non-finite coordinate is refused rather than written as null ─────────
{
  // JSON.stringify turns NaN/Infinity into `null`, which would read back as a point at
  // null island. Refusing at the door keeps the file trustworthy for the aggregator.
  const root = tmpRoot('nonfinite');
  const store = createTrackStore({ root });
  await store.append(REF, { lat: NaN, lng: 35 });
  await store.append(REF, { lat: 31, lng: Infinity });
  await store.append(REF, { lat: 31, lng: 35 });

  const points = await store.read(REF);
  ok(points?.length === 1, `only the usable point is stored, got ${points?.length}`);
  ok(points?.[0].lat === 31 && points?.[0].lng === 35, 'and it is the right one');
}

// ── The point of the whole change: disk mode records what sampling threw away ───
{
  // Drives the REAL sampling verdict and the REAL heatmap aggregator against the same walk, so
  // this is a claim about the product's behaviour rather than about this module in isolation.
  const root = tmpRoot('fidelity');
  const store = createTrackStore({ root });

  const BASE = { lat: 31.78, lng: 35.21 };
  const north = (m: number) => ({ lat: BASE.lat + m / 111_320, lng: BASE.lng });
  // 2km at walking pace, one fix per 20s ping.
  const walk = Array.from({ length: 72 }, (_, i) => north(28 * i));

  for (const p of walk) await store.append(REF, { lat: p.lat, lng: p.lng });
  const onDisk = await store.read(REF);

  // What the Firestore path would have kept for the same walk.
  const sampled: Array<{ lat: number; lng: number }> = [];
  let ref: { lat: number; lng: number } | null = null;
  for (const p of walk) {
    if (shouldRetainTrackPoint({ fix: p, lastRetained: ref }).retain) { sampled.push(p); ref = p; }
  }

  ok(onDisk?.length === 72, `disk mode keeps every ping, got ${onDisk?.length} of 72`);
  ok(sampled.length < 25, `the Firestore path keeps far fewer, got ${sampled.length}`);
  ok((onDisk?.length ?? 0) > sampled.length * 3,
    `disk mode is >3x richer (${onDisk?.length} vs ${sampled.length}) — the fidelity the ` +
    'distance rule was trading away for write quota');

  // And it is richer where it counts: more distinct heatmap cells along the route.
  const diskCells = buildMovementDensity(onDisk ?? []);
  const sampledCells = buildMovementDensity(sampled);
  ok(diskCells.length >= sampledCells.length,
    `the full track resolves at least as many cells (${diskCells.length} vs ${sampledCells.length})`);
  ok(diskCells.reduce((s2, c) => s2 + c.weight, 0) === 72,
    'every retained point reaches the aggregator');
}

ok(TRACK_DIR_ENV === 'RUSHPOINT_TRACK_DIR', 'the env var name is the documented one');

} // end main

main().then(() => {
  console.log(`\ntrack-store: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
