# Event data — the editable source of truth

Everything that defines a race lives in these CSV files (one per dataset). They are
the **single source of truth** for the app's config data. On every boot the sync
step (`npm run sync`, also run automatically by `npm run dev:all`) reads them and
upserts the data into Firestore — so **edit a file, re-run the app, and it updates.**

You can edit them two ways:

### Option A — edit the CSV files here (works out of the box, offline)
Open any file (Excel / Google Sheets / a text editor), change the values, save, and
restart the app (`npm run dev:all`). Done.

### Option B — drive it from a Google Sheet in your Drive (recommended)
1. Create one Google Spreadsheet. Add **one tab per file**, named exactly:
   `tasks`, `basketZones`, `accessCodes`, `raceConfig`, `teams`.
   (Easiest: in Sheets, *File → Import → Upload* each CSV as a **new sheet/tab**, keeping the tab name.)
2. Share it: *Share → General access → **Anyone with the link → Viewer***.
3. Copy the spreadsheet **ID** from its URL —
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` — and put it in your env:
   ```
   # scripts/.env  (or set it in your shell)
   RUSHPOINT_SHEETS_ID=THIS_PART
   ```
4. Run `npm run sync` (or `npm run dev:all`). The sync pulls each tab live from your
   Google Sheet. If a tab is missing or the sheet isn't shared, it safely falls back
   to the matching local CSV and logs a warning — it never crashes.

From then on: edit the Google Sheet → re-run → the app reflects your changes.

## The datasets

| File / tab     | Becomes (Firestore)                         | Notes |
|----------------|---------------------------------------------|-------|
| `tasks`        | `public/data/tasks/{id}`                    | Green & gold missions (routed by load) + orange. |
| `basketZones`  | `public/data/basketZones/{id}`              | Orange "find the Tene" hiding spots. |
| `accessCodes`  | `accessCodes/{code}`                        | Registration codes. `claimed` state is preserved across runs. |
| `raceConfig`   | `public/data/raceConfig/current`            | Start / finish / gate / center / zoom (also editable in the Race Builder). |
| `teams`        | `users/{uid}/profile/team` + a claimed code | Pre-loaded demo/admin teams. `state` ∈ start \| midway \| park \| finished seeds a matching gameState **only if the team has none** (real progress is never overwritten). |

## Adding a new dataset (how the backend stays easy to extend)

1. Add a new CSV here (e.g. `flashMissions.csv`) with a header row.
2. Add one entry to `scripts/lib/datasets.mjs` describing where it goes and how to
   map a row to a document. That's it — the sync picks it up automatically.

Runtime fields written by the game (scores, `currentTeamCount`, a team's live
progress, `claimed`) are **never** clobbered by a re-sync — only config is updated.
