// The phone half of the resumable upload (change: video-upload-speed, design D4).
//
// While a clip is filmed, each recorder slice is appended and sent up in order; when the recorder
// stops, `finish(blob)` sends only what is left, marked final, and resolves with the url. A failed
// request is resumed from the offset the SERVER reports (HEAD), so a byte that arrived is never
// sent twice; today's PUT restarts the whole clip on every attempt.
//
// One request at a time, never parallel: the phone's radio uplink is the bottleneck, and parallel
// streams only split it. Slices that arrive while a request is in flight are sent together by the
// next one, which keeps the request rate low when many teams film at once.
//
// Framework-free and transport-injected (scripts/test-stream-upload.ts records every byte range
// the fake network carries). services/firebase.ts supplies the real XHR transport.

export interface SessionTransport {
  /** POST /upload/sessions. `{ unsupported }` = an older server without the route (use PUT). */
  create(): Promise<{ id: string } | { unsupported: true }>;
  /** PATCH from `offset`. Throws with `code` ('session/conflict' + `offset`, 'session/gone', or a storage code). */
  patch(id: string, offset: number, body: Blob, finalLength: number | undefined,
    onProgress: (loaded: number) => void, signal: AbortSignal): Promise<{ offset: number; url?: string }>;
  /** HEAD: the bytes the server has stored. */
  head(id: string): Promise<number>;
  /** DELETE: drop a retake. Best effort. */
  remove(id: string): Promise<void>;
}

export interface StreamUploadOptions {
  sleep: (ms: number) => Promise<void>;
  /** Consecutive failures without progress before finish() gives up (it can be called again). */
  maxFailures?: number;
  /** (bytes up, clip total), reported only once the clip's total is known (after stop). */
  onProgress?: (loaded: number, total: number) => void;
}

export interface StreamUpload {
  append(chunk: Blob): void;
  /** The recorder stopped and this is the clip: send the rest, resolve with the url. Re-callable after a failure. */
  finish(clip: Blob): Promise<string>;
  /** Retake or discard: stop and delete the server copy. */
  abort(): void;
  /** Is `clip` what was streamed (same size)? If not, the caller uses a plain upload. */
  matches(clip: Blob): boolean;
}

const PERMANENT = new Set(['storage/invalid-argument', 'storage/unauthorized', 'storage/not-your-folder', 'storage/unauthenticated']);
export const STREAM_MAX_FAILURES = 5;
export const streamBackoffMs = (failures: number) => Math.min(15_000, 1000 * 2 ** Math.max(0, failures - 1));

const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

export function createStreamUpload(t: SessionTransport, opts: StreamUploadOptions): StreamUpload {
  const maxFailures = opts.maxFailures ?? STREAM_MAX_FAILURES;
  const parts: Blob[] = [];
  let appended = 0;
  let committed = 0;
  let id: string | null = null;
  let finalLength: number | undefined;
  let url: string | undefined;
  let unsupported = false;
  let aborted = false;
  let lastError: unknown = null;
  let inflight: AbortController | null = null;
  let pumping: Promise<void> | null = null;

  const report = (loaded: number) => {
    if (finalLength === undefined || !opts.onProgress) return;
    try { opts.onProgress(Math.min(Math.max(0, loaded), finalLength), finalLength); } catch { /* a listener never breaks an upload */ }
  };

  const needsWork = () => !aborted && !unsupported && !url
    && (committed < appended || finalLength !== undefined);

  async function run(): Promise<void> {
    let failures = 0;
    while (needsWork()) {
      try {
        if (!id) {
          const r = await t.create();
          if (aborted) {
            if ('id' in r) void t.remove(r.id).catch(() => {});
            return;
          }
          if ('unsupported' in r) { unsupported = true; return; }
          id = r.id;
          committed = 0;
        }
        const end = appended;
        const isFinal = finalLength !== undefined && end === finalLength;
        const body = new Blob(parts).slice(committed, end);
        inflight = new AbortController();
        const base = committed;
        const res = await t.patch(id, base, body, isFinal ? finalLength : undefined, (loaded) => report(base + loaded), inflight.signal);
        inflight = null;
        if (res.offset > committed) failures = 0;
        committed = res.offset;
        report(committed);
        if (res.url) { url = res.url; return; }
      } catch (e) {
        inflight = null;
        if (aborted) return;
        const code = String((e as { code?: unknown })?.code ?? '');
        const serverOffset = (e as { offset?: unknown })?.offset;
        if (code === 'session/conflict' && typeof serverOffset === 'number' && Number.isFinite(serverOffset)) {
          committed = serverOffset;
          failures++;
          if (failures >= maxFailures) { lastError = e; return; }
          continue;
        }
        lastError = e;
        if (PERMANENT.has(code)) return;
        failures++;
        if (code === 'session/gone') { id = null; committed = 0; }
        if (failures >= maxFailures) return;
        await opts.sleep(streamBackoffMs(failures));
        if (aborted) return;
        if (id) {
          try { committed = await t.head(id); } catch (he) {
            if (String((he as { code?: unknown })?.code ?? '') === 'session/gone') { id = null; committed = 0; }
          }
        }
      }
    }
  }

  function pump(): Promise<void> {
    if (!pumping) pumping = run().finally(() => { pumping = null; });
    return pumping;
  }

  return {
    append(chunk) {
      if (aborted || finalLength !== undefined || !chunk || chunk.size === 0) return;
      parts.push(chunk);
      appended += chunk.size;
      void pump();
    },
    async finish(clip) {
      if (aborted) throw coded('upload aborted', 'storage/canceled');
      if (!clip || clip.size !== appended) throw coded('clip differs from the stream', 'session/mismatch');
      finalLength = appended;
      report(committed);
      while (pumping) await pumping;
      if (!url && !unsupported && !aborted) await pump();
      if (url) { report(finalLength); return url; }
      if (aborted) throw coded('upload aborted', 'storage/canceled');
      if (unsupported) throw coded('server has no resumable route', 'session/unsupported');
      throw lastError ?? coded('upload failed', 'storage/unknown');
    },
    abort() {
      if (aborted) return;
      aborted = true;
      try { inflight?.abort(); } catch { /* already settled */ }
      if (id) { const dead = id; id = null; void t.remove(dead).catch(() => {}); }
    },
    matches(clip) {
      return !aborted && !!clip && clip.size === appended && appended > 0;
    },
  };
}
