// Reusable mocked Admin-SDK harness for fast, emulator-free callable unit tests
// (change: callable-test-coverage). It models just enough Firestore to exercise a
// callable's BRANCH logic deterministically — which HttpsError fires, whether a
// credit rolled back — without standing up the emulator (that is e2e's job).
//
// A callable written DI-friendly (taking its `db` as a parameter) can be unit
// tested against `makeDb()`; see testutil/README.md for the pattern. The mock is
// intentionally small — a path it isn't seeded for surfaces the dependency loudly
// rather than silently passing.

export interface MockDoc {
  get(): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  set(value: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void>;
  update(value: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}

export interface MockTx {
  get(ref: MockDoc): ReturnType<MockDoc['get']>;
  set(ref: MockDoc, value: Record<string, unknown>, opts?: { merge?: boolean }): void;
  update(ref: MockDoc, value: Record<string, unknown>): void;
}

export interface MockDb {
  /** Raw store — assert against it after a callable runs. */
  store: Map<string, Record<string, unknown>>;
  doc(path: string): MockDoc;
  runTransaction<T>(fn: (tx: MockTx) => Promise<T>): Promise<T>;
}

/** Build an in-memory Firestore-ish db, optionally seeded with `{ path: data }`. */
export function makeDb(seed?: Record<string, Record<string, unknown>>): MockDb {
  const store = new Map<string, Record<string, unknown>>(
    seed ? Object.entries(seed).map(([k, v]) => [k, { ...v }]) : [],
  );

  const doc = (path: string): MockDoc => ({
    async get() {
      const exists = store.has(path);
      const data = store.get(path);
      return { exists, data: () => (exists ? { ...data } : undefined) };
    },
    async set(value, opts) {
      store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...value } : { ...value });
    },
    async update(value) {
      if (!store.has(path)) throw new Error(`update on missing doc: ${path}`);
      store.set(path, { ...store.get(path)!, ...value });
    },
    async delete() {
      store.delete(path);
    },
  });

  const runTransaction = async <T>(fn: (tx: MockTx) => Promise<T>): Promise<T> => {
    const tx: MockTx = {
      get: (ref) => ref.get(),
      set: (ref, value, opts) => void ref.set(value, opts),
      update: (ref, value) => void ref.update(value),
    };
    return fn(tx);
  };

  return { store, doc, runTransaction };
}

/** A fake CallableContext carrying just an auth uid (or none). */
export function ctx(uid?: string): { auth?: { uid: string } } {
  return uid ? { auth: { uid } } : {};
}
