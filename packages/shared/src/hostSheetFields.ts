// What the organizer TYPES into the host sheet (issues 42 and 43, Ahiya 2026-10-06: "אני רוצה
// שבדף מארח בהערות וכל הפרטים אני אוכל לכתוב ולמלא את זה דרך המחשב ואז כשאני אדפיס זה כבר יהיה
// מלא", and a schedule of 10 rows, a short time and a longer "what happens").
//
// Stored on the GAME (`Game.hostSheetFields`), written only by updateGame through this cleaner, so a
// second computer and a second print come out filled too. Not part of the Builder's save payload:
// the Builder never touches it, so its autosave cannot wipe what was typed on the host sheet.
// Pure and total; unknown keys are dropped.

export interface HostSheetScheduleRow { time: string; what: string }

export interface HostSheetFields {
  date?: string;
  meet?: string;
  emergency?: string;
  staff?: string;
  dayMeet?: string;
  dayBrief?: string;
  dayStart?: string;
  dayEnd?: string;
  notes?: string;
  /** The schedule block is printed (the "add a schedule" checkbox). */
  scheduleOn?: boolean;
  schedule?: HostSheetScheduleRow[];
}

export const HOST_SHEET_TEXT_KEYS = ['date', 'meet', 'emergency', 'staff', 'dayMeet', 'dayBrief', 'dayStart', 'dayEnd'] as const;
export type HostSheetTextKey = typeof HOST_SHEET_TEXT_KEYS[number];
/** Rows the schedule offers (he asked for 10); a few more may be kept, never unbounded. */
export const HOST_SHEET_SCHEDULE_ROWS = 10;
export const HOST_SHEET_SCHEDULE_MAX = 20;
export const HOST_SHEET_FIELD_MAX = 200;
export const HOST_SHEET_NOTES_MAX = 2000;
export const HOST_SHEET_TIME_MAX = 20;

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');

export function cleanHostSheetFields(raw: unknown): HostSheetFields | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: HostSheetFields = {};
  for (const k of HOST_SHEET_TEXT_KEYS) {
    const v = clip(r[k], HOST_SHEET_FIELD_MAX).replace(/\n+/g, ' ');
    if (v) out[k] = v;
  }
  const notes = clip(r.notes, HOST_SHEET_NOTES_MAX);
  if (notes) out.notes = notes;
  if (r.scheduleOn === true) out.scheduleOn = true;
  if (Array.isArray(r.schedule)) {
    const rows = r.schedule.slice(0, HOST_SHEET_SCHEDULE_MAX).map((row) => {
      const o = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      return { time: clip(o.time, HOST_SHEET_TIME_MAX).replace(/\n+/g, ' '), what: clip(o.what, HOST_SHEET_FIELD_MAX).replace(/\n+/g, ' ') };
    });
    // Empty rows at the END carry nothing; empty rows in the middle keep their place (a gap the
    // organizer left on purpose).
    while (rows.length && !rows[rows.length - 1].time && !rows[rows.length - 1].what) rows.pop();
    if (rows.length) out.schedule = rows;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The schedule as printed: always at least HOST_SHEET_SCHEDULE_ROWS rows, blanks to fill by hand. */
export function hostSheetScheduleRows(fields: HostSheetFields | null | undefined): HostSheetScheduleRow[] {
  const rows = Array.isArray(fields?.schedule) ? fields!.schedule!.slice(0, HOST_SHEET_SCHEDULE_MAX) : [];
  const out = rows.map((r) => ({ time: r?.time ?? '', what: r?.what ?? '' }));
  while (out.length < HOST_SHEET_SCHEDULE_ROWS) out.push({ time: '', what: '' });
  return out;
}
