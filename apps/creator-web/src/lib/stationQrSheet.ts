// What the printable station QR sheet prints (change: qr-station-scan; answer-scored-question 2.7).
// Pure, so scripts/test-station-qr-sheet.ts pins it; RunConsolePage's StationQrPrint renders it.
//
// A station scored BY CODE (answerOutcomes) has no single secretCode and used to be left off the
// sheet, so the operator had nothing to hand out. It now prints one card per code, each with its
// points, so the operator can see what each card is worth. The code on a card is the first text the
// server accepts for that outcome, which is exactly what the play-web scanner submits.

interface OutcomeLike { id?: unknown; label?: unknown; accepts?: unknown; points?: unknown }
interface TaskLike { id?: unknown; title?: unknown; type?: unknown; smart?: { secretCode?: unknown } | null; answerOutcomes?: unknown }

export interface StationQrCard {
  key: string;
  taskId: string;
  title: string;
  code: string;
  /** Only on a code-scored station's cards. */
  points?: number;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function stationQrCards(stages: ReadonlyArray<{ tasks?: unknown }> | null | undefined): StationQrCard[] {
  const out: StationQrCard[] = [];
  for (const stage of Array.isArray(stages) ? stages : []) {
    const tasks = Array.isArray(stage?.tasks) ? (stage.tasks as TaskLike[]) : [];
    for (const task of tasks) {
      if (!task || task.type !== 'smart_station') continue;
      const taskId = text(task.id);
      const title = text(task.title);
      const outcomes = Array.isArray(task.answerOutcomes) ? (task.answerOutcomes as OutcomeLike[]) : [];
      if (outcomes.length > 0) {
        for (const o of outcomes) {
          const accepts = Array.isArray(o?.accepts) ? (o.accepts as unknown[]).map(text).filter(Boolean) : [];
          const code = accepts[0] || text(o?.label);
          if (!code) continue;
          const points = typeof o?.points === 'number' && Number.isFinite(o.points) ? o.points : 0;
          out.push({ key: `${taskId}:${text(o?.id) || code}`, taskId, title, code, points });
        }
        continue;
      }
      const code = text(task.smart?.secretCode);
      if (code) out.push({ key: taskId, taskId, title, code });
    }
  }
  return out;
}
