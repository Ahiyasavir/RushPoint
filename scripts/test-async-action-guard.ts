// Pure-logic test for the async-action guard (change: wave-b/async-action-guard).
//
// Every async handler in both apps used to gate itself on a `useState` busy flag.
// setState is asynchronous, so two clicks dispatched in the same React batch both
// read busy === false and BOTH fire the callable (launchRun, purchaseCredits,
// adjustTeamScore, captureZone, joinRun, …). `createAsyncGuard` replaces that with
// a real in-flight guard: held for the whole duration of the promise, not for a
// few hundred ms like a timing debounce.
//
// Both apps carry an identical copy of the hook file; this suite runs the SAME
// contract against BOTH so they can never drift.
//
//   npx tsx scripts/test-async-action-guard.ts
import { createAsyncGuard as creatorGuard } from '../apps/creator-web/src/hooks/useAsyncAction';
import { createAsyncGuard as playGuard } from '../apps/play-web/src/hooks/useAsyncAction';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

/** A promise whose settlement this test controls — stands in for a slow callable. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

type Factory = typeof creatorGuard;

async function suite(name: string, createAsyncGuard: Factory): Promise<void> {
  console.log(`\n── ${name} ──`);
  const p = (label: string) => `${name}: ${label}`;

  // 1. Single fire under rapid repeat calls (the actual double-click fix).
  {
    const d = deferred();
    let calls = 0;
    const g = createAsyncGuard();
    const fn = () => { calls++; return d.promise; };
    const runs = [g.run(fn), g.run(fn), g.run(fn), g.run(fn), g.run(fn)];
    check(p('rapid repeat fires fn exactly once'), calls === 1, `calls=${calls}`);
    check(p('guard reports busy while in flight'), g.busy === true);
    const blocked = await Promise.all(runs.slice(1));
    check(p('blocked calls resolve undefined'), blocked.every((v) => v === undefined));
    d.resolve();
    await runs[0];
  }

  // 2. The guard is a GUARD, not a timing debounce: a slow call is covered for its
  //    whole duration, well past any plausible debounce window.
  {
    const d = deferred();
    let calls = 0;
    const g = createAsyncGuard();
    const fn = () => { calls++; return d.promise; };
    void g.run(fn);
    await new Promise((r) => setTimeout(r, 60));
    void g.run(fn);
    await new Promise((r) => setTimeout(r, 60));
    void g.run(fn);
    check(p('still single-fire 120ms into a slow call'), calls === 1, `calls=${calls}`);
    d.resolve();
  }

  // 3. Re-arms after resolve.
  {
    let calls = 0;
    const g = createAsyncGuard();
    const fn = async () => { calls++; };
    await g.run(fn);
    check(p('not busy after resolve'), g.busy === false);
    await g.run(fn);
    check(p('re-arms after resolve'), calls === 2, `calls=${calls}`);
  }

  // 4. Re-arms after reject — AND the rejection propagates (never swallowed: the
  //    call sites show a localized Hebrew error on failure).
  {
    let calls = 0;
    const g = createAsyncGuard();
    const boom = new Error('boom');
    const fn = async () => { calls++; throw boom; };
    let caught: unknown = null;
    try { await g.run(fn); } catch (e) { caught = e; }
    check(p('rejection propagates unchanged'), caught === boom);
    check(p('not busy after reject'), g.busy === false);
    try { await g.run(fn); } catch { /* expected */ }
    check(p('re-arms after reject'), calls === 2, `calls=${calls}`);
  }

  // 5. No state write after unmount (participants navigate away mid-call).
  {
    const d = deferred();
    const seen: boolean[] = [];
    const g = createAsyncGuard((busy) => seen.push(busy));
    void g.run(() => d.promise);
    check(p('onChange fired busy=true before unmount'), seen.length === 1 && seen[0] === true, JSON.stringify(seen));
    g.dispose();
    check(p('dispose clears alive'), g.alive === false);
    d.resolve();
    await tick(); await tick();
    check(p('no onChange after dispose'), seen.length === 1, JSON.stringify(seen));
  }

  // 6. mount() re-arms a disposed guard (React StrictMode double-invokes effects).
  {
    const seen: boolean[] = [];
    const g = createAsyncGuard((busy) => seen.push(busy));
    g.dispose();
    g.mount();
    check(p('mount re-arms alive'), g.alive === true);
    await g.run(async () => undefined);
    check(p('notifies again after mount'), seen.length === 2 && seen[0] === true && seen[1] === false, JSON.stringify(seen));
  }

  // 7. Keyed actions: same key blocked, different keys concurrent (preserves the
  //    per-row busyKey UX in the staff console / trackables / zones panels).
  {
    const a = deferred();
    const b = deferred();
    let aCalls = 0; let bCalls = 0;
    const g = createAsyncGuard();
    void g.run(() => { aCalls++; return a.promise; }, 'team-a');
    void g.run(() => { aCalls++; return a.promise; }, 'team-a');
    void g.run(() => { bCalls++; return b.promise; }, 'team-b');
    check(p('same key single-fires'), aCalls === 1, `aCalls=${aCalls}`);
    check(p('different key runs concurrently'), bCalls === 1, `bCalls=${bCalls}`);
    check(p('isBusy is per key'), g.isBusy('team-a') && g.isBusy('team-b') && !g.isBusy('team-c'));
    a.resolve(); b.resolve();
    await tick(); await tick();
    check(p('all keys released'), g.busy === false && !g.isBusy('team-a'));
  }

  // 8. A synchronous (non-promise) handler still works and still guards.
  {
    const g = createAsyncGuard();
    const r = await g.run(() => 42);
    check(p('sync fn result returned'), r === 42, String(r));
    check(p('not busy after sync fn'), g.busy === false);
  }

  // 9. onChange reports the in-flight key set.
  {
    const d = deferred();
    const snapshots: string[][] = [];
    const g = createAsyncGuard((_busy, keys) => snapshots.push([...keys]));
    void g.run(() => d.promise, 'z1');
    check(p('onChange carries the key'), snapshots.length === 1 && snapshots[0][0] === 'z1', JSON.stringify(snapshots));
    d.resolve();
    await tick(); await tick();
    check(p('onChange empties the key set'), snapshots.length === 2 && snapshots[1].length === 0, JSON.stringify(snapshots));
  }
}

async function main() {
  await suite('creator-web', creatorGuard);
  await suite('play-web', playGuard);

  console.log(failures === 0 ? '\n✅ async-action guard OK' : `\n❌ ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
