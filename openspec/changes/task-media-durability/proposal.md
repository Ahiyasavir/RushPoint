## Why

A creator attached a picture to a mission, saw it, and later found it gone —
concretely the mission *כתב סתרים* in *משחק שדה לסניף בני עקיבא רמות*. Nothing was
deleted by any deletion path: the game was never trashed, and `purgeGameTree` only
runs 30 days after an owner-initiated soft delete.

The picture was destroyed by **validation**. Every Builder autosave (~1.5 s after any
edit) runs the whole `stages` array through `normalizeStagesMedia`
(`functions/src/games/index.ts`), which calls `normalizeTaskMedia`
(`packages/shared/src/validation.ts`). An `image`/`video` entry whose URL fails the
origin accept-set is **silently discarded** (`if (!isFirebaseStorageUrl(url, opts)) return;`),
and when nothing survives the `media` field is deleted from the task outright.
`updates.stages` is then written as a whole new array, so the entry is permanently gone
from Firestore — and the callable returns **success**. No error, no log, no client
signal. The creator finds out days later.

The accept-set is assembled from `process.env.VPS_UPLOAD_ORIGIN` alone
(`functions/src/storageOriginOpts.ts`). Driving the shipped predicate against the URL
shapes this deployment actually mints:

| stored URL | env var set (prod) | env var missing | emulator/playtest runtime |
|---|---|---|---|
| `https://api.rush-point.com/uploads/gameMedia/…` | kept | **DROPPED** | **DROPPED** |
| playtest tunnel `https://<host>/v0/b/…/o/…` | **DROPPED** | **DROPPED** | kept |
| `http://api.rush-point.com/uploads/…` | **DROPPED** | **DROPPED** | **DROPPED** |

Two live defects follow, independent of which one bit this particular game:

1. **One env var can destroy every creator's pictures.** `VPS_UPLOAD_ORIGIN` absent,
   retyped, or the API re-domained ⇒ every stored image in every game is erased on that
   game's next autosave. Same class as the `.env.local` outage in CLAUDE.md: every other
   signal stays green while the product silently loses data.
2. **Two runtimes disagree about the same stored data.** A URL minted in production is
   dropped by a playtest/emulator save and vice versa. `functions/server.js` also falls
   back to `${req.protocol}://…` when the env var is unset, and Express has no
   `trust proxy` there, so that fallback mints an `http://` URL that *every* mode drops.

The uploaded file itself survives on disk (`./uploads:/data/uploads` is a bind mount),
so what was lost is the Firestore reference — and the picture is recoverable.

Two further reports from the same creator have the same subject:

- **Duplicating a game does not carry its pictures.** `duplicateGame` spreads the source
  `Game` verbatim and never touches `media[].url`, but media objects are keyed on the
  owning game id (`gameMedia/{ownerUid}/games/{gameId}/…`). The copy points into the
  *original's* folder; it renders until the original is purged, then breaks. `translateGame`
  has the identical pattern. Nothing in the repo re-hosts media bytes today.
- **The upload control is in the wrong place.** `MediaSection` is rendered in step 3
  (`execution`) behind an opt-in chip, while the mission description it belongs with is in
  step 2 (`details`). A creator must reach the last step *and* click a chip before the file
  picker exists.

## What Changes

- **Stored media is never silently discarded.** `normalizeStagesMedia` receives the
  previously stored stages. A URL already persisted on that task is KEPT even if it no
  longer passes the current accept-set; a URL that is *new in this payload* and fails is
  refused loudly with `invalid-argument` naming it. Retaining a drifted URL emits a
  `logger.warn` so drift is visible instead of invisible.
  - Deliberately NOT "reject everything unrecognised": that would brick autosave for every
    game already holding a drifted URL — the trap the cleared-duration regression already hit.
- **The accept-set stops hinging on one env var.** A canonical `RUSHPOINT_UPLOAD_ORIGINS`
  constant in `@rushpoint/shared` is unioned with `VPS_UPLOAD_ORIGIN`, and the `http://`
  form of a known upload host is recognised for path extraction (a legacy `server.js`
  fallback URL is understood, not destroyed) while arbitrary origins stay refused.
  `functions/server.js` prefers the canonical origin so it can never mint mixed content.
- **Duplicate/translate re-host the bytes.** New `copyGameMedia` copies every object from
  the source game's prefix into the new game's prefix (Storage bucket + the VPS disk
  mirror), and the copied `stages` get their `image`/`video` URLs rewritten onto the new
  prefix. YouTube entries pass through untouched. Cross-account copies land in the new
  owner's prefix.
- **Pre-save `draft` uploads are migrated on first save.** `createGame` moves any
  `gameMedia/{uid}/games/draft/…` object into the real `…/games/{newGameId}/…` prefix and
  rewrites the URL, closing an orphan path that exists today.
- **Media authoring moves next to the description.** `MediaSection` renders in
  `DetailsStepBody` directly under the description field, unconditionally — `'media'` is
  removed from the opt-in group set. The stale-closure commit in `onPickFile` is fixed so a
  slow upload cannot revert edits made while it was in flight, and the returned URL is
  validated client-side with the shared predicate so a creator learns immediately.
- **An operator diagnose/repair script.** `scripts/diagnose-task-media.mjs` reports, per
  game, the verdict the server would give each media URL and which files on disk no task
  references any more; `--execute` re-attaches an orphan to the task named in its filename.

## Capabilities

### Modified Capabilities
- `task-media`: media durability across saves (stored URLs are never silently dropped),
  origin accept-set derivation, media re-hosting on duplicate/translate and on first save,
  and where media is authored in the task wizard.
- `photo-url-validation`: the accepted-origin set gains the canonical upload origins and
  the `http://` legacy form for known upload hosts. The `runs/{runId}/teams/{uid}/` IDOR
  prefix guard and the traversal rejection are unchanged.

## Out of Scope

- Any change to the participant-facing sanitizer or to what `media` exposes in-game.
- Storage lifecycle/TTL policies; sweeping the `draft` prefix after migration.
- Changing `WIZARD_STEP_ORDER` itself — step 1 is the map picker and stays as it is.
