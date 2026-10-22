// A run prepared ahead of the day (change: prepared-run; Ahiya 2026-10-08: "I'd like to create a
// game in advance, properly, so I already prepare everything in the console, like the host sheet").
//
// A prepared run is `status: 'draft'`. It has what an organizer prepares before the day, because
// all of it hangs off a run: the join code, the staff codes, the prints and the console. Nobody
// can be STARTED and nothing is SCORED until the organizer opens it (`openRun`). Teams may
// register early (on by default) and wait.
//
// Server code has always asked `status === 'finished'` and never `=== 'draft'`, so a draft would
// otherwise be playable everywhere. `DRAFT_REFUSED_CALLABLES` is the declared list of doors that
// start or score play; scripts/test-callable-hardening.ts fails if one of them does not ask
// `runOpenProblem`. Every decision here is pure and total, pinned by scripts/test-prepared-run.ts.

export type RunPhase = 'preparing' | 'live' | 'finished' | 'cancelled';

interface RunLike {
  status?: unknown;
  cancelledAt?: unknown;
  earlyRegistration?: unknown;
}

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** What the run is, for every label. An absent or unknown status reads as live, as it always has. */
export function runPhase(run: RunLike | null | undefined): RunPhase {
  const status = run?.status;
  if (status === 'draft') return 'preparing';
  if (status === 'finished') return nonBlank(run?.cancelledAt) ? 'cancelled' : 'finished';
  return 'live';
}

/** `details.reason` of a refusal because the run has not been opened yet. */
export const RUN_NOT_OPEN = 'run-not-open';

/**
 * May play be started or scored on this run? Fails OPEN for an absent status (legacy runs are
 * live, and refusing an unknown run would stop a real event); refuses only a status that says so.
 */
export function runOpenProblem(run: RunLike | null | undefined): null | 'run-not-open' | 'run-finished' {
  if (run?.status === 'draft') return 'run-not-open';
  if (run?.status === 'finished') return 'run-finished';
  return null;
}

/** May a new team register on this run? Early registration is on unless a literal false. */
export function registrationOpen(run: RunLike | null | undefined): boolean {
  if (run?.status === 'finished') return false;
  if (run?.status === 'draft') return run.earlyRegistration !== false;
  return true;
}

/**
 * The callables that start or score play, refused on a draft with
 * `failed-precondition` + `details.reason: 'run-not-open'`. Only startTeams and joinRun's
 * self-start ever set `team.launched`, and every grading path refuses an unlaunched team, so
 * guarding the starts is what makes a draft unplayable; the operator doors below are refused
 * so the console cannot do on a draft what only makes sense in play. finalizeRun is refused
 * because a draft is CANCELLED (cancelPreparedRun), never finalized into an empty result.
 */
export const DRAFT_REFUSED_CALLABLES = [
  'startTeams',
  'finalizeRun',
  'pushFlashMission',
  'activateHotZone',
  'skipStage',
  'skipTaskForTeam',
  'adjustTeamScore',
] as const;

// ── Event details (written only by updateRunEventDetails) ─────────────────────

export const RUN_EVENT_MEETING_POINT_MAX = 120;
export const RUN_EVENT_NOTE_MAX = 500;
/** Years accepted for a planned start. A wider range is a typo, not an event. */
const PLANNED_YEAR_MIN = 2000;
const PLANNED_YEAR_MAX = 2100;

export interface RunEventDetails {
  plannedStartAt?: string;
  meetingPoint?: string;
  eventNote?: string;
  earlyRegistration?: boolean;
}
export type RunEventKey = keyof RunEventDetails;
const EVENT_KEYS: readonly RunEventKey[] = ['plannedStartAt', 'meetingPoint', 'eventNote', 'earlyRegistration'];

export type CleanRunEventResult =
  | { ok: true; set: RunEventDetails; clear: RunEventKey[] }
  | { ok: false; error: string };

/**
 * Validate a patch of event details. A key that is ABSENT is untouched; an empty string or
 * null CLEARS it (the callable transport turns `undefined` into `null`, so null must mean
 * "clear" here rather than "malformed"). A planned start in the past is accepted: fixing a typo
 * on the morning must not be refused.
 */
export function cleanRunEventDetails(raw: unknown): CleanRunEventResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'details must be an object' };
  const r = raw as Record<string, unknown>;
  const unknownKey = Object.keys(r).find((k) => !EVENT_KEYS.includes(k as RunEventKey));
  if (unknownKey) return { ok: false, error: `unknown field: ${unknownKey}` };
  const set: RunEventDetails = {};
  const clear: RunEventKey[] = [];

  const clearing = (v: unknown) => v === null || (typeof v === 'string' && v.trim() === '');

  if ('plannedStartAt' in r) {
    const v = r.plannedStartAt;
    if (clearing(v)) clear.push('plannedStartAt');
    else {
      if (typeof v !== 'string') return { ok: false, error: 'plannedStartAt must be an ISO date string' };
      const ms = Date.parse(v);
      if (!Number.isFinite(ms)) return { ok: false, error: 'plannedStartAt is not a date' };
      const year = new Date(ms).getUTCFullYear();
      if (year < PLANNED_YEAR_MIN || year > PLANNED_YEAR_MAX) return { ok: false, error: 'plannedStartAt is out of range' };
      set.plannedStartAt = new Date(ms).toISOString();
    }
  }
  for (const [key, max] of [['meetingPoint', RUN_EVENT_MEETING_POINT_MAX], ['eventNote', RUN_EVENT_NOTE_MAX]] as const) {
    if (!(key in r)) continue;
    const v = r[key];
    if (clearing(v)) { clear.push(key); continue; }
    if (typeof v !== 'string') return { ok: false, error: `${key} must be text` };
    const text = key === 'meetingPoint' ? v.replace(/\s*\n+\s*/g, ' ').trim() : v.trim();
    if (text.length > max) return { ok: false, error: `${key} is longer than ${max}` };
    set[key] = text;
  }
  if ('earlyRegistration' in r) {
    if (typeof r.earlyRegistration !== 'boolean') return { ok: false, error: 'earlyRegistration must be true or false' };
    set.earlyRegistration = r.earlyRegistration;
  }
  if (Object.keys(set).length === 0 && clear.length === 0) return { ok: false, error: 'nothing to change' };
  return { ok: true, set, clear };
}

// ── "Ready for the day" checklist ─────────────────────────────────────────────

export type PrintRecordKey = 'hostSheet' | 'stationQr' | 'joinSign';
/** What was printed, stored on the run by markRunPrinted. The summary never carries answers. */
export interface RunPrintRecord {
  printedAt: string;
  fingerprint: string;
  summary?: unknown;
}
export type RunPrints = Partial<Record<PrintRecordKey, RunPrintRecord>>;

export interface PreparedRunFacts {
  plannedStartAt?: unknown;
  staffInviteCount?: unknown;
  /** The game has stations with codes to print. Without them the station row is not shown. */
  hasStations?: unknown;
  prints?: Partial<Record<PrintRecordKey, { printedAt?: unknown; fingerprint?: unknown } | null | undefined>> | null;
  /** Fingerprints of what WOULD print now. A missing one is unknown, never "changed". */
  currentFingerprints?: Partial<Record<PrintRecordKey, unknown>> | null;
  /** createdAt of the newest test-drive run of this game. */
  lastRehearsalAt?: unknown;
  gameUpdatedAt?: unknown;
  registeredTeams?: unknown;
}

export type PreparedRunRowId = 'date' | 'staff' | 'rehearsal' | PrintRecordKey | 'registrations';
export type PreparedRunRowState = 'done' | 'todo' | 'stale' | 'info';
export interface PreparedRunChecklistRow {
  id: PreparedRunRowId;
  state: PreparedRunRowState;
  /** When it was done (a print, a rehearsal), as stored. */
  at?: string;
  count?: number;
}

const isoMs = (v: unknown): number | null => (nonBlank(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * The console's "ready for the day" card while a run is prepared. Derived, never stored, and
 * advisory: nothing on it blocks opening the run (a blocked "open" on the morning is a support
 * call). Never throws; garbage never reads as done.
 */
export function preparedRunChecklist(factsIn: PreparedRunFacts | null | undefined): PreparedRunChecklistRow[] {
  const f = (factsIn && typeof factsIn === 'object' ? factsIn : {}) as PreparedRunFacts;
  const rows: PreparedRunChecklistRow[] = [];

  rows.push({ id: 'date', state: isoMs(f.plannedStartAt) !== null ? 'done' : 'todo' });

  const staff = count(f.staffInviteCount);
  rows.push({ id: 'staff', state: staff > 0 ? 'done' : 'todo', count: staff });

  const rehearsal = isoMs(f.lastRehearsalAt);
  const edited = isoMs(f.gameUpdatedAt);
  if (rehearsal === null) rows.push({ id: 'rehearsal', state: 'todo' });
  else rows.push({ id: 'rehearsal', state: edited !== null && edited > rehearsal ? 'stale' : 'done', at: String(f.lastRehearsalAt) });

  const prints = (f.prints && typeof f.prints === 'object' ? f.prints : {}) as NonNullable<PreparedRunFacts['prints']>;
  const current = (f.currentFingerprints && typeof f.currentFingerprints === 'object' ? f.currentFingerprints : {}) as NonNullable<PreparedRunFacts['currentFingerprints']>;
  const printRow = (id: PrintRecordKey): PreparedRunChecklistRow => {
    const rec = prints[id];
    const printedAt = rec && typeof rec === 'object' ? rec.printedAt : undefined;
    const fp = rec && typeof rec === 'object' ? rec.fingerprint : undefined;
    if (!nonBlank(fp) || isoMs(printedAt) === null) return { id, state: 'todo' };
    const now = current[id];
    const stale = nonBlank(now) && now !== fp;
    return { id, state: stale ? 'stale' : 'done', at: String(printedAt) };
  };
  rows.push(printRow('hostSheet'));
  if (f.hasStations === true) rows.push(printRow('stationQr'));
  rows.push(printRow('joinSign'));

  rows.push({ id: 'registrations', state: 'info', count: count(f.registeredTeams) });
  return rows;
}

/**
 * The planned start, for the retention anchor: an unfinished run whose event is still ahead
 * must not be read as abandoned. Null for anything unusable.
 */
export function plannedStartMs(run: { plannedStartAt?: unknown } | null | undefined): number | null {
  return isoMs(run?.plannedStartAt);
}
