// Should a creator's REHEARSAL link skip the registration form?
// (change: test-drive-straight-to-play)
//
// Pressing "בדיקה" in the Builder used to land the creator on the organizer
// console — a QR code and the same live-ops panel a real run gets — which is not
// what "let me look at my own game" means. The button now opens play-web on the
// test run's own code with `?testdrive`, and this is the one decision that link
// needs: can we join on the creator's behalf, or must they fill the form first?
//
// Three rules, in order:
//
//  1. The run must be a test drive ACCORDING TO THE SERVER (`isTestDrive`, read
//     back from `run.isTestDrive` by getJoinInfo). The URL flag is a UX hint with
//     no authority — forging `?testdrive` onto a stranger's real access code must
//     change nothing, so the server's answer is the gate.
//  2. A finished run is never auto-joined; the creator gets the normal screen and
//     its normal error copy.
//  3. Anything the creator would have to TYPE stops the auto-join. A game with
//     required custom registration fields (phone, shirt size, a select) has real
//     content to fill in, and silently inventing values would both rehearse the
//     wrong thing and write junk into the creator's own run. Name and team name
//     are the exceptions: they are pure identity, so we supply them.
//
// Pure and total: no DOM, no network, no throw. Unit-tested by
// scripts/test-test-drive-autojoin.ts.
import { resolveRegistrationFields, type GameMode, type RegistrationField } from '@rushpoint/shared';

/** The identity fields this planner is willing to fill in by itself. */
const SELF_SUPPLIED_IDS = new Set(['name', 'teamName']);

export interface TestDriveAutoJoinInput {
  /** The URL asked for it (`?testdrive`). */
  requested: boolean;
  /** Server truth: this access code belongs to a test-drive run. */
  isTestDrive: boolean;
  /** `getJoinInfo().runStatus` — a finished run is not auto-joined. */
  runStatus?: string | null;
  mode: GameMode;
  registrationFields: RegistrationField[];
  /** What to call the rehearsing creator; already localized by the caller. */
  playerName: string;
}

export type TestDriveAutoJoinPlan =
  | {
      kind: 'join';
      /** Pre-filled `values` for the registration payload. */
      values: Record<string, string>;
      /** Pre-filled member list (always exactly the one rehearsing creator). */
      memberNames: string[];
    }
  | {
      kind: 'form';
      /** Why the form is still shown — for tests and for a future explainer. */
      reason: 'notRequested' | 'notTestDrive' | 'finished' | 'requiredFields';
    };

export function planTestDriveAutoJoin(input: TestDriveAutoJoinInput): TestDriveAutoJoinPlan {
  if (!input.requested) return { kind: 'form', reason: 'notRequested' };
  if (!input.isTestDrive) return { kind: 'form', reason: 'notTestDrive' };
  if (input.runStatus === 'finished') return { kind: 'form', reason: 'finished' };

  const fields = resolveRegistrationFields(input.mode, input.registrationFields ?? []);
  const mustType = fields.some((f) => f.required && !SELF_SUPPLIED_IDS.has(f.id));
  if (mustType) return { kind: 'form', reason: 'requiredFields' };

  // A blank name is not a valid identity, so fall back rather than join as "".
  const name = (input.playerName ?? '').trim();
  if (!name) return { kind: 'form', reason: 'requiredFields' };

  return {
    kind: 'join',
    // `teamName` is set unconditionally in team mode: JoinScreen requires it for
    // every team-mode join, whether or not it appears as a declared field.
    values: input.mode === 'team' ? { teamName: name } : {},
    memberNames: [name],
  };
}
