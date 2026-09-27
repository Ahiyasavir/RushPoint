// What the skip confirmation says, decided once for both consoles (change: skip-keeps-the-stage).
//
// The creator's Run Console and the staff app both confirm a single-mission skip. Before this
// change the confirm said a fixed sentence ("the team stays in the stage") while the server could
// end the stage anyway (production run 2026-09-22). Now the confirm is built from the server's own
// dry-run plan, and this module decides which facts to state, in order, so the two consoles cannot
// drift. It returns keys and values, never copy: each app renders them through its own i18n.
//
// Total: a missing or malformed preview yields `null`, and the caller falls back to its generic
// confirmation. A preview must never block the action it describes.

export interface SkipPreviewInput {
  taskTitle?: unknown;
  stageCompletes?: unknown;
  requirementLowered?: unknown;
  requiredTaskCount?: unknown;
  consolation?: unknown;
  dependentsOpened?: unknown;
}

export type SkipPreviewLine =
  | { key: 'skips'; title: string }
  | { key: 'opens'; titles: string[] }
  | { key: 'endsStage' }
  | { key: 'staysInStage' }
  | { key: 'requirementLowered'; required: number }
  | { key: 'consolation'; points: number };

export function skipPreviewLines(p: SkipPreviewInput | null | undefined): SkipPreviewLine[] | null {
  if (!p || typeof p !== 'object' || typeof p.stageCompletes !== 'boolean') return null;
  const lines: SkipPreviewLine[] = [];
  const title = typeof p.taskTitle === 'string' ? p.taskTitle.trim() : '';
  if (title) lines.push({ key: 'skips', title });
  const opened = Array.isArray(p.dependentsOpened)
    ? p.dependentsOpened
      .map((d) => (d && typeof d === 'object' && typeof (d as { title?: unknown }).title === 'string'
        ? (d as { title: string }).title.trim() : ''))
      .filter((t) => t.length > 0)
    : [];
  if (opened.length > 0) lines.push({ key: 'opens', titles: opened });
  lines.push(p.stageCompletes ? { key: 'endsStage' } : { key: 'staysInStage' });
  if (!p.stageCompletes && p.requirementLowered === true
    && typeof p.requiredTaskCount === 'number' && Number.isFinite(p.requiredTaskCount)) {
    lines.push({ key: 'requirementLowered', required: Math.max(0, Math.floor(p.requiredTaskCount)) });
  }
  if (typeof p.consolation === 'number' && Number.isFinite(p.consolation) && p.consolation > 0) {
    lines.push({ key: 'consolation', points: Math.round(p.consolation) });
  }
  return lines;
}
