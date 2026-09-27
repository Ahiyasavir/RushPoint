// A safety call must never fail silently (change: sos-second-entry-point).
//
// `triggerSOS` has TWO entry points in play-web, and they had drifted:
//
//   PlayScreen  — the SOS button in the header/footer. Always surfaced a failure
//                 (`catch { await dialog.alert(t.play.sosFailed) }`).
//   TaskRunner  — `requestHelp`, the "I'm stuck here" affordance on a geofence
//                 task and on the blocked card. Its catch read, in full:
//                     catch { /* let the player tap again; nothing persisted */ }
//
// The comment is true and beside the point. Nothing WAS persisted — which is
// exactly the problem: `setHelpSentFor` is only reached on success, so a failed
// call left the button unchanged and the screen unchanged. A player who is
// already stuck, and has just asked for help, was shown nothing at all and had no
// way to distinguish "the host has been alerted" from "that went nowhere".
//
// Two call sites, one callable, one of them silent, is precisely the shape of
// drift a declared list catches and a code read does not. Same pattern as
// `callableHardening.mjs`: the sites are DECLARED, so a new one fails until it is
// listed and shown to report its own failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf8');

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

/** Every file that may invoke a safety-critical callable, and how it must report. */
const SAFETY_CALL_SITES = [
  {
    file: 'apps/play-web/src/screens/PlayScreen.tsx',
    call: 'triggerSOS',
    // The panic button: a modal is right here, because nothing else is happening.
    reports: /sosFailed/,
    how: 'dialog.alert(t.play.sosFailed)',
  },
  {
    file: 'apps/play-web/src/components/TaskRunner.tsx',
    call: 'triggerSOS',
    // Inline, because the player is mid-mission and must not lose the card.
    reports: /showError\(t\.play\.sosFailed\)/,
    how: 'showError(t.play.sosFailed)',
  },
] as const;

console.log('\n[safety feedback] every triggerSOS call site reports its own failure');

for (const site of SAFETY_CALL_SITES) {
  const src = read(site.file);
  ok(src.includes(site.call),
    `${site.file} still calls ${site.call}`,
    'if this moved, update the declared list rather than deleting the assertion');
  ok(site.reports.test(src),
    `${site.file} surfaces a failed ${site.call} via ${site.how}`,
    'a safety call that fails must say so — the player is already stuck, and silence is indistinguishable from success');
}

// The whole point is that BOTH sites say the same thing, so a player gets the same
// answer wherever they asked from.
console.log('\n[safety feedback] both entry points use the same message');
{
  const key = /sosFailed/;
  const bothUse = SAFETY_CALL_SITES.every((s) => key.test(read(s.file)));
  ok(bothUse, 'both entry points name t.play.sosFailed rather than inventing their own copy');
}

// A live-event staff reply is not a safety call, but it failed the same way and
// for the same reason ("the listener reconciles" — it does not, for a message that
// was never sent). Pinned here so the pair cannot drift back.
console.log('\n[safety feedback] a failed staff reply during a live event is visible');
{
  const staff = read('apps/play-web/src/screens/StaffConsole.tsx');
  ok(/setReplyErr\(t\.staff\.replyFailed\)/.test(staff),
    'StaffConsole reports a reply that did not send',
    'the draft is kept for a retry, but keeping it silently is ambiguous with a slow network mid-event');
  ok(/setReplyErr\(''\)/.test(staff),
    'and clears that notice on a new attempt, so it cannot outlive the message it describes');
}

console.log(failures === 0 ? '\n✅ safety call feedback: ALL PASS\n' : `\n❌ safety call feedback: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
