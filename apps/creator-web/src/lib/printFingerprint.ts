// What was printed, and has the game moved on since? (change: prepared-run; Ahiya 2026-10-08:
// "when you edit, the host sheet updates").
//
// The prints page rebuilds every document from the game each time it is opened, so the SCREEN is
// always current. What goes stale is the PAPER. When a document is printed for a run, its summary
// and fingerprint are stored on the run (`run.prints`, markRunPrinted); the console's "ready for
// the day" card recomputes the fingerprint from the current game and says "printed" or "the game
// changed since you printed", naming what changed.
//
// A fingerprint of CONTENT, never `game.updatedAt`: the Builder autosaves on every edit, including
// edits no printed page shows, and a date comparison would nag after every keystroke. The print
// options of the moment (answers on/off, a card per page) are deliberately NOT part of it: they
// change the layout of the same content, and the organizer chose them.
//
// The summary is stored on the run document (owner-only read), and it still never carries answer,
// station-code or PIN TEXT: those are hashed. Pure, pinned by scripts/test-print-fingerprint.ts.
import { buildHostSheet, DEFAULT_HOST_SHEET_OPTIONS } from './hostSheet';
import { stationQrCards } from './stationQrSheet';
import type { PrintDoc } from './printDocs';

export const PRINT_SUMMARY_VERSION = 1;

export interface PrintSummary {
  v: typeof PRINT_SUMMARY_VERSION;
  doc: PrintDoc;
  title: string;
  /** host sheet: the missions in route order. */
  missions?: { id: string; title: string }[];
  /** station sheet: one entry per printed card. */
  stations?: { id: string; title: string }[];
  joinCode?: string | null;
  plannedStartAt?: string | null;
  meetingPoint?: string | null;
  /** host sheet: the staff codes' labels (the PINs are only hashed). */
  staff?: string[];
  /** Hashes of what the paper shows but the summary must not spell out. */
  hashes: Record<string, string>;
}

export interface PrintInput {
  game: unknown;
  run?: { id?: unknown; accessCode?: unknown; autoApproveAllMedia?: unknown; plannedStartAt?: unknown; meetingPoint?: unknown } | null;
  /** Rows from buildStaffCodeRows. */
  staffCodes?: readonly { label?: unknown; pin?: unknown; capabilities?: unknown; disabled?: unknown; usedUp?: unknown }[] | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** cyrb53: a fast 53-bit string hash. Not cryptographic; a change detector over owner-only data. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
const hashOf = (v: unknown): string => hashText(JSON.stringify(v ?? null));

/** What a document shows, in a form that can be stored and compared. Total for any input. */
export function printSummary(doc: PrintDoc, input: PrintInput): PrintSummary {
  const game = (input?.game && typeof input.game === 'object' ? input.game : {}) as Record<string, unknown>;
  const run = input?.run ?? null;
  const event = { plannedStartAt: strOrNull(run?.plannedStartAt), meetingPoint: strOrNull(run?.meetingPoint) };
  const joinCode = strOrNull(run?.accessCode);
  const title = str(game.title);

  if (doc === 'join') {
    return { v: PRINT_SUMMARY_VERSION, doc, title, joinCode, ...event, hashes: {} };
  }

  if (doc === 'stations') {
    const cards = stationQrCards(Array.isArray(game.stages) ? (game.stages as { tasks?: unknown }[]) : []);
    return {
      v: PRINT_SUMMARY_VERSION, doc, title,
      stations: cards.map((c) => ({ id: c.key, title: c.title })),
      hashes: { codes: hashOf(cards.map((c) => [c.key, c.code, c.points ?? null])) },
    };
  }

  // The host sheet: built with the default options and one language, so the fingerprint is about
  // the game rather than how this print was laid out.
  const sheet = buildHostSheet(game, {
    run: run ? { id: run.id, accessCode: run.accessCode, autoApproveAllMedia: run.autoApproveAllMedia } : null,
    staffCodes: input?.staffCodes ?? [],
    options: DEFAULT_HOST_SHEET_OPTIONS,
    ownerUid: '',
    playUrl: '',
    lang: 'he',
  });
  const cards = sheet.stages.flatMap((s) => s.cards);
  const staffCards = sheet.staffPage?.codes ?? [];
  // Everything else the sheet prints, with the parts summarised separately taken out, so a
  // rename is reported as a rename and not also as "details".
  const details = {
    cover: { ...sheet.cover, title: undefined, joinCode: undefined, joinLink: undefined },
    stages: sheet.stages.map((s) => ({
      ...s,
      cards: s.cards.map((c) => ({ ...c, title: undefined, answer: undefined, number: undefined })),
      exclusive: s.exclusive.length,
    })),
    map: sheet.map,
  };
  return {
    v: PRINT_SUMMARY_VERSION, doc, title,
    missions: cards.map((c) => ({ id: c.id, title: c.title })),
    joinCode, ...event,
    staff: staffCards.map((c) => c.label),
    hashes: {
      answers: hashOf(cards.map((c) => [c.id, c.answer])),
      details: hashOf(details),
      staff: hashOf(staffCards.map((c) => [c.label, c.pin, c.capabilities])),
      fields: hashOf(game.hostSheetFields ?? null),
    },
  };
}

export function printFingerprint(summary: PrintSummary): string {
  return hashOf(summary);
}

export type PrintChange =
  | { kind: 'missionAdded'; title: string }
  | { kind: 'missionRemoved'; title: string }
  | { kind: 'missionRenamed'; from: string; to: string }
  | { kind: 'answersChanged' }
  | { kind: 'detailsChanged' }
  | { kind: 'stationsChanged' }
  | { kind: 'staffChanged' }
  | { kind: 'joinCodeChanged' }
  | { kind: 'dateChanged' }
  | { kind: 'meetingPointChanged' }
  | { kind: 'fieldsChanged' }
  | { kind: 'titleChanged' }
  /** The stored record is unreadable or from another version: changed, without a name. */
  | { kind: 'other' };

const asList = (v: unknown): { id: string; title: string }[] =>
  (Array.isArray(v) ? v : []).filter((x) => x && typeof x === 'object').map((x) => ({ id: str((x as { id?: unknown }).id), title: str((x as { title?: unknown }).title) }));

/** What changed between the printed summary and now. Never throws; empty means nothing. */
export function diffPrintSummary(printed: unknown, now: PrintSummary): PrintChange[] {
  const old = (printed && typeof printed === 'object' ? printed : null) as Partial<PrintSummary> | null;
  if (!old || old.v !== PRINT_SUMMARY_VERSION || old.doc !== now.doc) return [{ kind: 'other' }];
  const out: PrintChange[] = [];
  if (str(old.title) !== now.title) out.push({ kind: 'titleChanged' });

  const listDiff = (a: { id: string; title: string }[], b: { id: string; title: string }[]): boolean => {
    const before = new Map(a.map((m) => [m.id, m.title]));
    const after = new Map(b.map((m) => [m.id, m.title]));
    let structural = false;
    for (const m of b) {
      if (!before.has(m.id)) { out.push({ kind: 'missionAdded', title: m.title }); structural = true; }
      else if (before.get(m.id) !== m.title) out.push({ kind: 'missionRenamed', from: before.get(m.id) ?? '', to: m.title });
    }
    for (const m of a) if (!after.has(m.id)) { out.push({ kind: 'missionRemoved', title: m.title }); structural = true; }
    return structural || a.map((m) => m.id).join() !== b.map((m) => m.id).join();
  };

  const oldHashes = (old.hashes && typeof old.hashes === 'object' ? old.hashes : {}) as Record<string, unknown>;
  const changed = (k: string) => oldHashes[k] !== now.hashes[k];

  if (now.doc === 'host') {
    const reordered = listDiff(asList(old.missions), now.missions ?? []);
    if (changed('answers')) out.push({ kind: 'answersChanged' });
    // A mission added, removed or moved explains a details change; say only what it does not.
    if (changed('details') && !reordered) out.push({ kind: 'detailsChanged' });
    if (changed('staff')) out.push({ kind: 'staffChanged' });
    if (changed('fields')) out.push({ kind: 'fieldsChanged' });
  }
  if (now.doc === 'stations') {
    const a = asList(old.stations);
    const b = now.stations ?? [];
    if (changed('codes') || a.map((s) => `${s.id}:${s.title}`).join() !== b.map((s) => `${s.id}:${s.title}`).join()) {
      out.push({ kind: 'stationsChanged' });
    }
  }
  if (now.doc !== 'stations') {
    if ((old.joinCode ?? null) !== (now.joinCode ?? null)) out.push({ kind: 'joinCodeChanged' });
    if ((old.plannedStartAt ?? null) !== (now.plannedStartAt ?? null)) out.push({ kind: 'dateChanged' });
    if ((old.meetingPoint ?? null) !== (now.meetingPoint ?? null)) out.push({ kind: 'meetingPointChanged' });
  }
  return out;
}
