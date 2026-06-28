// Import a game from a spreadsheet (change: import-game-spreadsheet). Pure
// row → game mapper + per-row validator, shared by the Builder "Import" panel.
// The CSV/xlsx reading is client-side; this module only maps already-parsed rows.
import type { GeoPoint } from './types';
import { isValidCoord } from './geo';

const TASK_TYPES = ['field', 'smart_station', 'photo', 'self_report', 'quiz', 'numeric', 'geofence', 'sequence'] as const;
type ImportTaskType = (typeof TASK_TYPES)[number];

/** A single spreadsheet row, keyed by (lowercased) column header. */
export interface ImportRow {
  stage?: string;
  title?: string;
  type?: string;
  lat?: string | number;
  lng?: string | number;
  difficulty?: string | number;
  minutes?: string | number;
  points?: string | number;
  answer?: string;
  description?: string;
  [k: string]: unknown;
}

export interface RowError { row: number; field: string; message: string; }

export interface ParsedTask {
  id: string;
  title: string;
  type: ImportTaskType;
  description?: string;
  coordinates: GeoPoint;
  locationless?: boolean;
  difficulty: number;
  estimatedMinutes: number;
  pointValue: number;
  answers?: string[];
  numericAnswer?: number;
}
export interface ParsedStage { id: string; order: number; title: string; tasks: ParsedTask[]; }
export interface ParsedGame { title: string; stages: ParsedStage[]; }

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}
function isBlank(row: ImportRow): boolean {
  return !String(row.title ?? '').trim() && !String(row.type ?? '').trim() && !String(row.stage ?? '').trim();
}

/**
 * Map spreadsheet rows into a game model, collecting per-row validation errors.
 * Valid rows become tasks grouped into stages (by the `stage` column, in first-
 * seen order); invalid rows are reported and omitted. An empty sheet yields an
 * empty game. Never throws.
 */
export function parseGameRows(rows: ImportRow[], opts: { gameTitle?: string } = {}): { game: ParsedGame; errors: RowError[] } {
  const errors: RowError[] = [];
  const stageOrder: string[] = [];
  const stageMap = new Map<string, ParsedTask[]>();

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    if (isBlank(row)) return;

    const title = String(row.title ?? '').trim();
    if (!title) { errors.push({ row: rowNum, field: 'title', message: 'Title is required' }); return; }

    const type = String(row.type ?? '').trim().toLowerCase() as ImportTaskType;
    if (!TASK_TYPES.includes(type)) {
      errors.push({ row: rowNum, field: 'type', message: `Unknown task type "${row.type ?? ''}"` });
      return;
    }

    // Coordinates: both-or-neither. Neither → locationless. Present → must be valid.
    const lat = num(row.lat), lng = num(row.lng);
    let coordinates: GeoPoint = { lat: 0, lng: 0 };
    let locationless = false;
    if (lat === undefined && lng === undefined) {
      locationless = true;
    } else if (lat === undefined || lng === undefined || !isValidCoord(lat, lng)) {
      errors.push({ row: rowNum, field: 'coordinates', message: 'Invalid coordinates' });
      return;
    } else {
      coordinates = { lat, lng };
    }

    const task: ParsedTask = {
      id: `task-${rowNum}`,
      title,
      type,
      description: String(row.description ?? '').trim() || undefined,
      coordinates,
      locationless: locationless || undefined,
      difficulty: Math.min(5, Math.max(1, Math.round(num(row.difficulty) ?? 3))),
      estimatedMinutes: Math.max(1, Math.round(num(row.minutes) ?? 5)),
      pointValue: Math.max(0, Math.round(num(row.points) ?? 50)),
    };

    // Answer-bearing types must carry an answer.
    const answer = String(row.answer ?? '').trim();
    if (type === 'quiz') {
      if (!answer) { errors.push({ row: rowNum, field: 'answer', message: 'Quiz task needs an answer' }); return; }
      task.answers = answer.split('|').map((a) => a.trim()).filter(Boolean);
    } else if (type === 'numeric') {
      const n = num(answer);
      if (n === undefined) { errors.push({ row: rowNum, field: 'answer', message: 'Numeric task needs a numeric answer' }); return; }
      task.numericAnswer = n;
    }

    const stageName = String(row.stage ?? '').trim() || 'Stage 1';
    if (!stageMap.has(stageName)) { stageMap.set(stageName, []); stageOrder.push(stageName); }
    stageMap.get(stageName)!.push(task);
  });

  const stages: ParsedStage[] = stageOrder.map((name, si) => ({
    id: `stage-${si}`,
    order: si,
    title: name,
    tasks: stageMap.get(name)!,
  }));

  return { game: { title: opts.gameTitle?.trim() || 'Imported game', stages }, errors };
}
