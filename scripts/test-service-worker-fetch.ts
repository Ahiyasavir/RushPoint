// The two service workers' fetch handlers, executed for real (change: sw-chunk-fetch-durability).
//
// WHY THIS EXISTS. A creator opened /gallery and got the ErrorBoundary crash
// screen with "Failed to fetch dynamically imported module
// https://creator.rush-point.com/assets/GalleryPage-<hash>.js" — for a chunk that
// was sitting on the server the entire time, 200, correct content type. The bug
// was in the worker, not the deploy:
//
//   event.respondWith(fetch(req).catch(() => caches.match(req)))
//
// `caches.match()` resolves to **undefined** for anything never cached, and only
// the app SHELL is precached — every lazy ROUTE chunk is uncached until the first
// successful visit to that route. Resolving `respondWith` with undefined IS a
// network error, so ONE flaky moment on a first visit to a lazy route became a
// hard crash instead of a retry. `lazyWithRetry` then reloaded once, hit the same
// thing, and rethrew.
//
// The second, quieter half: Firebase Hosting rewrites `**` to /index.html, so a
// chunk that really IS gone answers **200 text/html**, not 404. Caching that body
// under a `.js` URL poisons the entry permanently — every later offline boot
// serves HTML as a module.
//
// Neither app has a component test runner and `public/sw.js` is copied verbatim
// into the bundle, so nothing else in the gate can see this file at all. This
// runs the real source in a sandbox with a scripted network and asserts the
// behaviour that matters: a fetch handler must NEVER resolve with undefined.
//
//   npx tsx scripts/test-service-worker-fetch.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) { passed++; console.log(`PASS  ${msg}`); }
  else { failed++; console.log(`FAIL  ${msg}${detail ? ' :: ' + detail : ''}`); }
}

/** A stand-in for a fetch Response — real enough for the worker's checks. */
type FakeResponse = {
  ok: boolean;
  status: number;
  type: string;
  headers: { get(k: string): string | null };
  clone(): FakeResponse;
  _tag?: string;
};

function res(status: number, contentType: string, tag = ''): FakeResponse {
  const self_: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    clone: () => self_,
    _tag: tag,
  };
  return self_;
}

type Harness = {
  /** Queue of network outcomes: a FakeResponse to return, or null to reject. */
  plan: (FakeResponse | null)[];
  /** Every URL the worker asked the network for, in order. */
  attempts: string[];
  /** What ended up in the Cache Storage, keyed by url. */
  stored: Map<string, FakeResponse>;
  /** Seed the cache as if a previous successful visit had populated it. */
  seed(url: string, r: FakeResponse): void;
  /** Dispatch a fetch event; undefined means "the worker did not respondWith". */
  handle(url: string, init?: { method?: string; mode?: string }): Promise<FakeResponse | undefined>;
};

function loadWorker(swPath: string, origin: string): Harness {
  const source = readFileSync(swPath, 'utf8');

  const plan: (FakeResponse | null)[] = [];
  const attempts: string[] = [];
  const stored = new Map<string, FakeResponse>();
  const listeners = new Map<string, (event: unknown) => void>();

  const cacheApi = {
    put: async (req: { url: string } | string, r: FakeResponse) => {
      stored.set(typeof req === 'string' ? req : req.url, r);
    },
    addAll: async () => undefined,
    match: async (req: { url: string } | string) => stored.get(typeof req === 'string' ? req : req.url),
  };

  const sandbox = {
    self: {
      location: new URL(origin),
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
      addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); },
    },
    caches: {
      open: async () => cacheApi,
      keys: async () => [],
      delete: async () => true,
      match: cacheApi.match,
    },
    fetch: async (req: { url: string } | string) => {
      const url = typeof req === 'string' ? req : req.url;
      attempts.push(url);
      const next = plan.length ? plan.shift()! : null;
      if (next === null) throw new TypeError('Failed to fetch');
      return next;
    },
    URL,
    Response,
    Promise,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: swPath });

  return {
    plan,
    attempts,
    stored,
    seed(url, r) { stored.set(url, r); },
    async handle(url, init = {}) {
      const handler = listeners.get('fetch');
      if (!handler) throw new Error(`${swPath} registered no fetch listener`);
      let answered: Promise<FakeResponse | undefined> | undefined;
      handler({
        request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' },
        respondWith: (p: Promise<FakeResponse | undefined>) => { answered = Promise.resolve(p); },
      });
      return answered ? await answered : undefined;
    },
  };
}

const APPS = [
  { name: 'creator-web', origin: 'https://creator.rush-point.com/', sw: join(ROOT, 'apps', 'creator-web', 'public', 'sw.js') },
  { name: 'play-web', origin: 'https://player.rush-point.com/', sw: join(ROOT, 'apps', 'play-web', 'public', 'sw.js') },
];

// `scripts/run-unit-tests.mjs` compiles this lane as CJS, where top-level await
// is not available — the whole suite runs inside one async main().
async function main(): Promise<void> {
  for (const app of APPS) {
    const chunk = `${app.origin}assets/GalleryPage-COF1hhjF.js`;

    // ── 1. THE REPORTED BUG: uncached lazy chunk + a network blip ───────────────
    // Nothing cached (first ever visit to that route) and the network fails. The
    // handler must still resolve with a Response — undefined here is a synthetic
    // network error and reads to the app as a missing module.
    {
      const w = loadWorker(app.sw, app.origin);
      w.plan.push(null, null, null);
      const out = await w.handle(chunk);
      ok(out !== undefined, `${app.name}: an uncached chunk with a dead network never resolves undefined`,
        String(out));
      ok(out?.status === 504, `${app.name}: it answers an honest 504 instead of a fake network error`,
        String(out?.status));
      ok(w.attempts.length >= 2, `${app.name}: it retries the network once before giving up`,
        `attempts=${w.attempts.length}`);
    }

    // ── 2. One blip, then the network comes back ────────────────────────────────
    {
      const w = loadWorker(app.sw, app.origin);
      w.plan.push(null, res(200, 'text/javascript', 'chunk'));
      const out = await w.handle(chunk);
      ok(out?._tag === 'chunk', `${app.name}: a single blip is absorbed by the retry`, String(out?.status));
      ok(w.stored.get(chunk)?._tag === 'chunk', `${app.name}: the recovered chunk is cached for the next dead zone`);
    }

    // ── 3. The SPA-rewrite trap: a gone chunk answers 200 text/html ─────────────
    {
      const w = loadWorker(app.sw, app.origin);
      w.plan.push(res(200, 'text/html; charset=utf-8', 'shell'));
      const out = await w.handle(chunk);
      ok(out?._tag === 'shell', `${app.name}: the rewritten HTML is still passed through to the page`);
      ok(!w.stored.has(chunk), `${app.name}: HTML is NEVER cached under a .js url (no permanent poisoning)`,
        String(w.stored.get(chunk)?._tag));
    }

    // ── 4. The dead zone the cache exists for ──────────────────────────────────
    {
      const w = loadWorker(app.sw, app.origin);
      w.seed(chunk, res(200, 'text/javascript', 'cached'));
      w.plan.push(null, null, null);
      const out = await w.handle(chunk);
      ok(out?._tag === 'cached', `${app.name}: offline, a previously-cached chunk is still served`,
        String(out?._tag));
    }

    // ── 5. Everything the worker must keep its hands off ───────────────────────
    {
      const w = loadWorker(app.sw, app.origin);
      ok(await w.handle(`${app.origin}anything`, { method: 'POST' }) === undefined,
        `${app.name}: non-GET requests bypass the worker entirely`);
      ok(await w.handle('https://firestore.googleapis.com/v1/x') === undefined,
        `${app.name}: cross-origin (Firebase) traffic bypasses the worker entirely`);
      ok(w.attempts.length === 0, `${app.name}: a bypassed request is not fetched by the worker`,
        w.attempts.join(','));
    }
  }
}

main().then(() => {
  console.log(`\n${failed === 0 ? `ALL SERVICE WORKER FETCH TESTS PASSED (${passed})` : `${failed} FAILED, ${passed} passed`}`);
  process.exit(failed === 0 ? 0 : 1);
});
