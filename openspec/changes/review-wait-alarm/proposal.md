## Why

Field report 2026-09-27 item 14: *"I really want it to alert strongly if I don't approve a photo
for more than 20 seconds."* Teams whose mission needs a human approval stand still until someone
approves; in the 2026-09-10 run players already asked for faster approvals.

Today (`live-ops-feedback-loop`): one short cue when a submission ARRIVES
(`newPendingKeys` → `playAlert()`), then nothing, however long it waits. And the cue is dropped
silently when the page has not been clicked since it loaded (browser autoplay rule,
`apps/creator-web/src/lib/sound.ts`), so an organizer who opened the console and looked away hears
nothing at all without knowing it.

Kitchen display systems solve exactly this queue: every ticket shows its age and changes colour at
fixed thresholds until someone clears it (see `docs/field-report-2026-09-27.md`).

## What Changes

- Each waiting submission shows **how long it has waited**, live, and its row turns amber at 20 s
  and red at 60 s.
- When any submission has waited **20 s**, the console raises a **strong alarm**: a distinct,
  louder sound repeated every 20 s while anything is over the threshold, a banner at the top of
  every console section naming the oldest ("הסרטון של סבירז מחכה 0:35 · לבדיקה"), and the browser
  tab title flashing with the count. The banner's button opens that submission.
- When the console tab is in the background, a browser notification (if the organizer allowed
  notifications) says the same.
- **Sound state is visible**: until the page's sound has been unlocked, a "🔇 הפעלת צליל התראות"
  control is shown in the console header; one click unlocks and plays a test chime.
- **Mute 5 minutes** on the banner silences the sound (not the banner).
- The staff app's review queue gets the same ageing and alarm.

## Capabilities

### Modified Capabilities
- `live-ops-feedback` (from `live-ops-feedback-loop`): the review queue escalates when a
  submission waits.

## Non-goals

- Changing who may approve or the auto-approve rules.
- Push notifications to a closed browser (no service worker push in the console).
- A configurable threshold (20 s is the requirement; the constant is one line).

## Surfaces

creator-web (console banner, row ageing, header sound control, tab title, notification),
play-web staff console (same), shared pure logic `packages/shared/src/reviewQueueCue.ts`. No server change.
