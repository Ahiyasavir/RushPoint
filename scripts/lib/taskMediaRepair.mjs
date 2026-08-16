// ─── Pure decisions for the task-media diagnose/repair sweep ─────────────────
// (change: task-media-durability)
//
// The damage this repairs: `normalizeStagesMedia` used to DROP any media entry whose
// URL the saving runtime's accept-set did not recognise, then delete the `media` field
// outright, and the callable returned success. The uploaded FILE was never touched — it
// is still sitting under `gameMedia/{ownerUid}/games/{gameId}/…`. Only the Firestore
// reference to it was eaten. So a file with no referring task is a recoverable picture,
// not garbage, and the object name carries the task it belonged to:
//
//     gameMedia/{ownerUid}/games/{gameId}/{safeTaskId}-{epochMs}.{ext}
//
// (`safeTaskId` is the task id with every char outside [A-Za-z0-9_-] replaced by `_`,
// per apps/creator-web/src/services/firebase.ts::uploadTaskMedia.)
//
// Everything here is pure and total so `scripts/test-task-media-repair.ts` can drive it
// with no emulator, no credentials and no filesystem. The I/O lives in
// scripts/diagnose-task-media.mjs.

/** The upload path's task-id sanitizer, mirrored exactly. */
export function safeTaskId(taskId) {
  return String(taskId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Every media URL a game's stages reference, as a Set. Total: a malformed stage, task or
 * media entry contributes nothing rather than throwing — this runs against real, already
 * damaged data, so it must never be the thing that fails.
 */
export function referencedMediaUrls(stages) {
  const out = new Set();
  for (const stage of Array.isArray(stages) ? stages : []) {
    for (const task of Array.isArray(stage?.tasks) ? stage.tasks : []) {
      for (const m of Array.isArray(task?.media) ? task.media : []) {
        if (m && typeof m.url === 'string') out.add(m.url);
      }
    }
  }
  return out;
}

/**
 * Which uploaded objects no task references any more, and which task each belonged to.
 *
 * `objectNames` are full object paths under the game's prefix; `stages` is the game as
 * Firestore currently holds it. An object is an ORPHAN when no media entry's URL contains
 * its basename — a containment test rather than a URL parse, because the same path shows
 * up raw on the VPS route and percent-encoded in a Firebase download URL, and the whole
 * failure mode was a URL shape we could not parse.
 *
 * The owning task is recovered from the basename prefix and matched against the game's
 * real task ids through `safeTaskId`, so a task id containing a `.` or `/` still matches.
 * An orphan whose task no longer exists is reported with `taskId: null` — it is real
 * information (the mission was deleted too), not something to guess at.
 */
export function planMediaRepair(objectNames, stages) {
  const referenced = referencedMediaUrls(stages);
  const taskIds = [];
  for (const stage of Array.isArray(stages) ? stages : []) {
    for (const task of Array.isArray(stage?.tasks) ? stage.tasks : []) {
      if (task && typeof task.id === 'string') taskIds.push(task.id);
    }
  }
  const bySafeId = new Map(taskIds.map((id) => [safeTaskId(id), id]));

  const orphans = [];
  for (const name of Array.isArray(objectNames) ? objectNames : []) {
    if (typeof name !== 'string' || name.endsWith('/')) continue;
    const base = name.slice(name.lastIndexOf('/') + 1);
    if (!base) continue;
    // Referenced by some task ⇒ intact, nothing to do.
    if ([...referenced].some((url) => url.includes(base) || url.includes(encodeURIComponent(base)))) {
      continue;
    }
    // `{safeTaskId}-{epochMs}.{ext}` — split on the LAST '-' so a task id containing a
    // hyphen (uuids do) is not truncated.
    const dash = base.lastIndexOf('-');
    const prefix = dash > 0 ? base.slice(0, dash) : '';
    orphans.push({
      objectName: name,
      fileName: base,
      taskId: bySafeId.get(prefix) ?? null,
      kind: mediaKindForName(base),
    });
  }
  return { orphans, referencedCount: referenced.size };
}

const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'avi', 'm4v', '3gp', '3gpp']);

/** The `TaskMedia.kind` an uploaded file should be attached as, from its extension. */
export function mediaKindForName(fileName) {
  const ext = String(fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXT.has(ext) ? 'video' : 'image';
}

/**
 * Apply a repair plan to a game's stages, returning NEW stages (never mutate — this repo
 * never dotted-updates a stored array element) plus what was reattached.
 *
 * `urlFor(objectName)` builds the download URL for the deployment being repaired, so the
 * planner stays free of origin knowledge. Orphans with no surviving task are skipped and
 * reported, never silently dropped — the whole point of this change is that nothing about
 * a creator's media disappears without saying so.
 */
export function applyMediaRepair(stages, orphans, urlFor, makeId) {
  const byTask = new Map();
  const skipped = [];
  for (const o of orphans ?? []) {
    if (!o?.taskId) { skipped.push(o); continue; }
    if (!byTask.has(o.taskId)) byTask.set(o.taskId, []);
    byTask.get(o.taskId).push(o);
  }
  const reattached = [];
  const next = (Array.isArray(stages) ? stages : []).map((stage) => ({
    ...stage,
    tasks: (Array.isArray(stage?.tasks) ? stage.tasks : []).map((task) => {
      const adds = byTask.get(task?.id);
      if (!adds || adds.length === 0) return task;
      // Oldest first: the filename's epochMs suffix is the upload order, which is the
      // order the creator added them in.
      const sorted = [...adds].sort((a, b) => a.fileName.localeCompare(b.fileName));
      const media = [...(Array.isArray(task.media) ? task.media : [])];
      for (const o of sorted) {
        const url = urlFor(o.objectName);
        media.push({ id: makeId(o.objectName), kind: o.kind, url });
        reattached.push({ taskId: task.id, objectName: o.objectName, url });
      }
      return { ...task, media };
    }),
  }));
  return { stages: next, reattached, skipped };
}
