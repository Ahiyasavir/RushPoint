# Two-way Google Sheet — enabling write-back (one-time, ~2 minutes)

Reading **from** your sheet already works (the share link is enough). Writing **back**
to it cannot use the share link — the Google Sheets API rejects programmatic writes
made via "anyone with the link". The simplest fix (no service-account key, no secret
files) is a tiny Apps Script that lives inside your own sheet and runs as you.

## Steps

1. Open your spreadsheet → **Extensions → Apps Script**.
2. Delete whatever's there and paste the contents of **`Code.gs`** (next to this file).
   Save (💾).
3. **Deploy → New deployment** → gear ⚙️ → **Web app**:
   - *Description:* `RushPoint write-back`
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - Click **Deploy**, authorize when prompted (it's your own script).
4. Copy the **Web app URL** (looks like
   `https://script.google.com/macros/s/AKfy.../exec`) and put it in `scripts/.env`:
   ```
   RUSHPOINT_SHEETS_WEBHOOK=https://script.google.com/macros/s/AKfy.../exec
   ```
5. (Optional, recommended) Add a shared secret so only you can write:
   in Apps Script → **Project Settings → Script properties**, add
   `RUSHPOINT_TOKEN = <some-random-string>`, and put the same value in
   `scripts/.env` as `RUSHPOINT_SHEETS_TOKEN=<some-random-string>`.

That's it. Restart the app (`npm run dev:all`) — the **MIRROR** pane lights up and
the sheet now updates live whenever something changes.

## What gets written back

| Sheet tab     | Updated when… |
|---------------|----------------|
| `tasks`       | a station/mission changes in Firestore (e.g. you edit it in the Race Builder) |
| `basketZones` | a Tene hiding spot changes |
| `raceConfig`  | start/finish/gate/center/zoom changes |
| `status`      | **live standings** — team, code, score, current stage, status (refreshes as teams play) |

The pure-input tabs you own — `accessCodes` and `teams` — are **never** overwritten.
To push everything on demand without the watcher: `npm run push:sheet`.

## How the two directions fit together

- **Sheet → app** (inbound): on every `npm run dev:all` / `npm run sync`, config is
  pulled from the sheet into Firestore (the live game database).
- **app → Sheet** (outbound): the MIRROR watcher pushes changes back, debounced.

Firestore stays the real-time engine (scores, matchmaking, check-ins, GPS) because a
spreadsheet can't serve those at game speed; the sheet is your editable master and a
live dashboard. Edit the sheet, re-run, and your changes take effect.
