// "Visual type-sprinting" support (change: v2.1-builder-shell-redesign).
//
// taskPreviewLine() produces the scannable second line shown on each Task card in
// the central canvas, so a creator can read the interaction config of a whole
// stage at a glance without opening any panel. Pure + DOM-free for the test lane.
//
// IMPORTANT: answer-key fields are owner-only here; this runs ONLY in the creator
// console (never sent to participants), so surfacing a masked code is safe.
import type { Task, TaskType } from '@rushpoint/shared';

// Left-border / badge colour per interaction family. Kept beside the preview text
// so the card's two visual encodings (colour + text) stay in one place.
export const TYPE_FAMILY_COLOR: Record<TaskType, string> = {
  smart_station: '#7F77DD', // purple — find/enter a code
  sequence: '#7F77DD',
  photo: '#1D9E75',         // teal — capture
  quiz: '#378ADD',          // blue — knowledge
  numeric: '#378ADD',
  field: '#BA7517',         // amber — presence check-in
  self_report: '#BA7517',
  geofence: '#D85A30',      // coral — automatic GPS
  survey: '#378ADD',        // blue — a question (no right answer)
};

export const TYPE_LABEL: Record<TaskType, string> = {
  field: 'Check in',
  self_report: 'Self report',
  smart_station: 'Station',
  photo: 'Photo',
  quiz: 'Quiz',
  numeric: 'Numeric',
  geofence: 'Geofence',
  sequence: 'Sequence',
  survey: 'Survey',
};

// Translatable label set for the preview line. Defaults to English so the pure
// test lane (and any non-i18n caller) keeps working unchanged; the Builder passes
// the active-language set from i18n (t.builder.prev*).
export interface PreviewLabels {
  quizChoices: (choices: number, correct: number) => string;
  quizTyped: string;
  quizNone: string;
  stationCode: (len: number) => string;
  stationNone: string;
  photoAuto: string;
  photoStaff: string;
  numericAnswer: (a: number, tol: number) => string;
  numericNone: string;
  geofence: (radius: number) => string;
  sequence: (n: number) => string;
  field: string;
  selfReport: string;
  surveyChoices: (n: number) => string;
  surveyText: string;
}

const EN_PREVIEW: PreviewLabels = {
  quizChoices: (c, k) => `${c} choices, ${k} correct`,
  quizTyped: 'Typed answer',
  quizNone: 'No answer set',
  stationCode: (len) => `Code ${'•'.repeat(len)}`,
  stationNone: 'No code set',
  photoAuto: 'Auto approve',
  photoStaff: 'Staff review',
  numericAnswer: (a, tol) => `Answer ${a} ± ${tol}`,
  numericNone: 'No answer set',
  geofence: (r) => `Auto check in within ${r}m`,
  sequence: (n) => `${n} ordered ${n === 1 ? 'step' : 'steps'}`,
  field: 'Tap to check in',
  selfReport: 'Team self report',
  surveyChoices: (n) => `Poll, ${n} ${n === 1 ? 'option' : 'options'}`,
  surveyText: 'Free-text response',
};

export function taskPreviewLine(task: Task, L: PreviewLabels = EN_PREVIEW): string {
  switch (task.type) {
    case 'quiz': {
      const choices = task.choices?.length ?? 0;
      const correct = task.answers?.length ?? 0;
      if (choices > 0) return L.quizChoices(choices, correct);
      if (correct > 0) return L.quizTyped;
      return L.quizNone;
    }
    case 'smart_station': {
      const code = task.smart?.secretCode;
      return code ? L.stationCode(Math.min(code.length, 8)) : L.stationNone;
    }
    case 'photo':
      return task.smart?.autoApprove ? L.photoAuto : L.photoStaff;
    case 'numeric':
      return task.numericAnswer != null
        ? L.numericAnswer(task.numericAnswer, task.numericTolerance ?? 0)
        : L.numericNone;
    case 'geofence':
      return L.geofence(task.geofenceRadiusMeters ?? 50);
    case 'sequence':
      return L.sequence(task.steps?.length ?? 0);
    case 'field':
      return L.field;
    case 'self_report':
      return L.selfReport;
    case 'survey': {
      const n = task.surveyChoices?.length ?? 0;
      return n > 0 ? L.surveyChoices(n) : L.surveyText;
    }
  }
}
