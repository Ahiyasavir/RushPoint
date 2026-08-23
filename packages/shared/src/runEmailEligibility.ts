// Which runs earn an immediate organizer summary email
// (change: run-email-scope-and-digest). Pure, framework-free, no Firestore — so
// the send path, the digest cron and the tests all read ONE definition of
// "is this a real event?" instead of three drifting inline conditions.
import type { Run } from './types';

/** What we know about the run's owner, for the identifiability rule below. */
export interface RunEmailOwnerContext {
  /**
   * Whether the owner is an identifiable creator — i.e. their `users/{uid}` doc
   * carries an email. Real creators sign in with email or Google, so they always
   * have one; an ANONYMOUS creator (every simulation script, and the local seed)
   * never does.
   */
  hasEmail: boolean;
}

/**
 * True when a finished run should produce a per-run organizer summary email.
 *
 * Excluded, deliberately:
 *  - `isTestDrive` — a rehearsal. Already excluded from player profiles and the
 *    platform benchmark for the same reason (it isn't a real event), so the
 *    email follows suit.
 *  - `selfGuided` — an instant-play/demo run. These can happen many times a day
 *    from the public demo; they are reported as a COUNT by the daily digest
 *    instead, which is the whole point of the digest.
 *  - an owner with no email — a SYNTHETIC run. This is what structurally stops
 *    simulations: `simulate-run.mjs`, `simulate-adversarial.mjs` and the e2e
 *    suite all create their creator with `signInAnonymously`, so no email exists
 *    on the owner profile. Note we deliberately do NOT key this on `testDrive`:
 *    that flag caps a run at 2 participants and permits only one live test-drive
 *    per game, so making an 8-team load sim pass it would break the sim outright.
 *    Keying on owner identifiability costs the sims nothing and also covers any
 *    future synthetic run without a new flag.
 *
 * Absent run fields mean "normal run", matching how every other consumer treats
 * them — so a run document written before this change keeps emailing. Only an
 * EXPLICIT `true` excludes: a stray non-boolean must never silently suppress a
 * real organizer's email.
 *
 * Caveat worth knowing: a real creator whose `users/{uid}` doc somehow lacks an
 * email would also be suppressed. That doc is written on profile update and the
 * email comes from Auth, so it should not happen — but if a summary is ever
 * missing for a real event, the `runSummary.email.notEligible` breadcrumb names
 * which rule fired.
 */
export function shouldEmailRunSummary(
  run: Pick<Run, 'isTestDrive' | 'selfGuided'>,
  owner: RunEmailOwnerContext,
): boolean {
  return run.isTestDrive !== true && run.selfGuided !== true && owner.hasEmail === true;
}
