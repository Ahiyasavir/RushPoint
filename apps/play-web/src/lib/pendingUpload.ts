// The capture-time upload (change: media-upload-reliability, D1/D4).
//
// A photo, clip or recording starts uploading the moment it EXISTS, not when the player presses
// send: the transfer then overlaps the time the player spends looking at their own capture, and
// send is left with only the save. One entry per task id, so mission B can never be handed
// mission A's upload. A retake or a discard aborts the superseded transfer (no bytes spent on a
// file nobody will send); a failed background attempt is dropped so send starts a fresh one; a
// landed one is reused so a failed SUBMIT never costs the upload again.
//
// Framework-free: the starter is injected, so scripts/test-pending-upload.ts drives it without a
// network, and TaskRunner owns one instance in a ref.

export type UploadStarter<R> = (blob: Blob, contentType: string, signal: AbortSignal, taskId: string) => Promise<R>;

interface Entry<R> {
  blob: Blob;
  contentType: string;
  controller: AbortController;
  promise: Promise<R>;
  landed: boolean;
}

export interface PendingUploads<R> {
  /** The capture exists: start uploading it (a no-op if this exact capture is already going). */
  begin(taskId: string, blob: Blob, contentType: string): void;
  /** Send: the upload for this capture, reusing one in flight or landed, else a fresh one. */
  take(taskId: string, blob: Blob, contentType: string): Promise<R>;
  /** Retake, discard or a finished send: abort and drop whatever this task holds. */
  forget(taskId: string): void;
  /** A transfer is running for this task right now. */
  inFlight(taskId: string): boolean;
  /** This capture's upload has landed, so send only has to save. */
  ready(taskId: string, blob: Blob): boolean;
}

export function createPendingUploads<R>(start: UploadStarter<R>, onChange: () => void = () => {}): PendingUploads<R> {
  const entries = new Map<string, Entry<R>>();

  const announce = () => { try { onChange(); } catch { /* a listener never breaks an upload */ } };

  function launch(taskId: string, blob: Blob, contentType: string): Entry<R> {
    const controller = new AbortController();
    const entry: Entry<R> = { blob, contentType, controller, promise: undefined as unknown as Promise<R>, landed: false };
    entry.promise = start(blob, contentType, controller.signal, taskId);
    entries.set(taskId, entry);
    entry.promise.then(
      () => {
        if (entries.get(taskId) !== entry) return;
        entry.landed = true;
        announce();
      },
      () => {
        // Dropped, so the next send starts over instead of re-reading a rejection. The caller of
        // take() (if any) sees the error through the same promise.
        if (entries.get(taskId) === entry) entries.delete(taskId);
        announce();
      },
    );
    announce();
    return entry;
  }

  function drop(taskId: string): void {
    const cur = entries.get(taskId);
    if (!cur) return;
    entries.delete(taskId);
    if (!cur.landed) cur.controller.abort();
  }

  return {
    begin(taskId, blob, contentType) {
      const cur = entries.get(taskId);
      if (cur && cur.blob === blob && cur.contentType === contentType) return;
      drop(taskId);
      launch(taskId, blob, contentType);
    },
    take(taskId, blob, contentType) {
      const cur = entries.get(taskId);
      if (cur && cur.blob === blob && cur.contentType === contentType) return cur.promise;
      drop(taskId);
      return launch(taskId, blob, contentType).promise;
    },
    forget(taskId) {
      if (!entries.has(taskId)) return;
      drop(taskId);
      announce();
    },
    inFlight(taskId) {
      const cur = entries.get(taskId);
      return !!cur && !cur.landed;
    },
    ready(taskId, blob) {
      const cur = entries.get(taskId);
      return !!cur && cur.landed && cur.blob === blob;
    },
  };
}
