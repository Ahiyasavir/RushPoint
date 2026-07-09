// Stored-document read-boundary validation (change: firestore-doc-read-validation).
//
// Callable INPUT payloads are validated by `validation.ts`, but documents read
// BACK from Firestore were blind-cast (`snap.data() as RunTeam`) ~everywhere — a
// partial/legacy/corrupt doc would silently yield a mis-typed object that flows
// into scoring/routing/payment math (a `NaN` score, a non-array `stages`). These
// parsers validate the required fields of the core stored shapes at the read
// boundary and fail loud instead.
//
// Pure and Firebase-free (mirrors `validation.ts`); the functions side maps a
// thrown `StoredDocError` to an `internal` HttpsError. Each parser:
//   - asserts every REQUIRED field is present and of the correct runtime type,
//   - tolerates and PRESERVES optional + unknown fields (returns the original
//     object typed — no whitelist copy — so a doc written by a newer deploy still
//     parses), and
//   - throws `StoredDocError` on the first violation.
import type { Game, Run, RunTeam, Wallet } from './types';

/** Thrown when a stored document is missing a required field or has one of the
 * wrong runtime type. `field` names the offender; `constraint` is human copy. */
export class StoredDocError extends Error {
  constructor(
    public readonly docType: string,
    public readonly field: string,
    public readonly constraint: string,
  ) {
    super(`Stored ${docType} document is invalid: field "${field}" ${constraint}`);
    this.name = 'StoredDocError';
  }
}

type Raw = Record<string, unknown>;

function asObject(docType: string, doc: unknown): Raw {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new StoredDocError(docType, '<root>', 'is not an object');
  }
  return doc as Raw;
}
function reqString(docType: string, o: Raw, field: string): void {
  if (typeof o[field] !== 'string') throw new StoredDocError(docType, field, 'must be a string');
}
function reqNumber(docType: string, o: Raw, field: string): void {
  if (typeof o[field] !== 'number' || !Number.isFinite(o[field])) {
    throw new StoredDocError(docType, field, 'must be a finite number');
  }
}
function reqBoolean(docType: string, o: Raw, field: string): void {
  if (typeof o[field] !== 'boolean') throw new StoredDocError(docType, field, 'must be a boolean');
}
function reqArray(docType: string, o: Raw, field: string): void {
  if (!Array.isArray(o[field])) throw new StoredDocError(docType, field, 'must be an array');
}
function reqObject(docType: string, o: Raw, field: string): void {
  const v = o[field];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new StoredDocError(docType, field, 'must be an object');
  }
}

export function parseGame(doc: unknown): Game {
  const o = asObject('Game', doc);
  reqString('Game', o, 'id');
  reqString('Game', o, 'ownerUid');
  reqString('Game', o, 'title');
  reqString('Game', o, 'mode');
  reqArray('Game', o, 'stages');
  reqString('Game', o, 'scoringPreset');
  reqArray('Game', o, 'registrationFields');
  reqString('Game', o, 'visibility');
  reqArray('Game', o, 'tags');
  reqNumber('Game', o, 'playCount');
  reqString('Game', o, 'createdAt');
  reqString('Game', o, 'updatedAt');
  return doc as Game;
}

export function parseRun(doc: unknown): Run {
  const o = asObject('Run', doc);
  reqString('Run', o, 'id');
  reqString('Run', o, 'gameId');
  reqString('Run', o, 'ownerUid');
  reqString('Run', o, 'status');
  reqString('Run', o, 'accessCode');
  reqString('Run', o, 'billingType');
  reqNumber('Run', o, 'maxParticipants');
  reqNumber('Run', o, 'participantCount');
  reqString('Run', o, 'createdAt');
  reqString('Run', o, 'updatedAt');
  return doc as Run;
}

export function parseRunTeam(doc: unknown): RunTeam {
  const o = asObject('RunTeam', doc);
  reqString('RunTeam', o, 'id');
  reqString('RunTeam', o, 'runId');
  reqString('RunTeam', o, 'gameId');
  reqString('RunTeam', o, 'ownerUid');
  reqString('RunTeam', o, 'displayName');
  reqObject('RunTeam', o, 'registrationData');
  reqString('RunTeam', o, 'status');
  reqArray('RunTeam', o, 'stages');
  reqNumber('RunTeam', o, 'score');
  reqNumber('RunTeam', o, 'bonusPenalty');
  reqBoolean('RunTeam', o, 'launched');
  reqString('RunTeam', o, 'updatedAt');
  return doc as RunTeam;
}

export function parseWallet(doc: unknown): Wallet {
  const o = asObject('Wallet', doc);
  reqString('Wallet', o, 'uid');
  reqNumber('Wallet', o, 'eventCredits');
  reqNumber('Wallet', o, 'lifetimeFreeRunsUsed');
  reqString('Wallet', o, 'plan');
  reqString('Wallet', o, 'updatedAt');
  return doc as Wallet;
}
