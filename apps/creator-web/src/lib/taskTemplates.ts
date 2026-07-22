// "Inspiration Mode" sample templates (change: v2.1-builder-shell-redesign).
//
// One-click samples that pre-fill a task draft with engaging, illustrative data so
// creators learn the shape of a good task by editing rather than configuring from
// a blank form. Pure + DOM-free for the test lane.
//
// `patch` carries top-level Task fields; `smart` is merged into the SmartStation
// config separately so partial smart fields stay type-safe.
import type { Task, TaskType, SmartStationConfig } from '@rushpoint/shared';

export interface TaskSample {
  label: string;
  patch: Partial<Omit<Task, 'smart' | 'id'>>;
  smart?: Partial<SmartStationConfig>;
}

// Apply a sample onto an existing draft, preserving the draft's identity (id,
// coordinates, trigger mode) and merging smart config rather than replacing it.
export function applySample(draft: Task, sample: TaskSample): Task {
  const next: Task = { ...draft, ...sample.patch };
  if (sample.smart) {
    next.smart = {
      enabled: true,
      verificationType: draft.smart?.verificationType ?? 'code_verification',
      ...draft.smart,
      ...sample.smart,
    };
  }
  return next;
}

// ── Sample lookup + overwrite guard (change: builder-first-task-flow) ────────
// The catalogue below was authored, unit-tested and then referenced by nothing.
// These two pure helpers are what the type picker's "load a sample" action reads.

/** Every authored sample for a task type (never undefined). */
export function samplesForType(type: TaskType): TaskSample[] {
  return TASK_SAMPLES[type] ?? [];
}

/**
 * Which AUTHORED fields a sample would replace. A one-click action must never
 * silently destroy work, so a non-empty result is named in a confirmation first.
 *
 * This is its own small union rather than `ValidationField`: overwriting is a
 * different axis from validation messaging (a description carries no message,
 * and the answer key is one decision rather than one per task type).
 */
export type SampleOverwriteField = 'title' | 'description' | 'answerKey';

const nonEmpty = (s: string | undefined | null): boolean => typeof s === 'string' && s.trim() !== '';

// Does the draft already carry an answer key the creator authored?
function hasAuthoredAnswerKey(draft: Task): boolean {
  return (draft.choices?.length ?? 0) > 0
    || !!draft.answers?.some(nonEmpty)
    || (draft.orderItems?.length ?? 0) > 0
    || (draft.steps?.length ?? 0) > 0
    || (draft.surveyChoices?.length ?? 0) > 0
    || draft.numericAnswer != null
    || nonEmpty(draft.smart?.secretCode);
}

// Does the sample set an answer key of any kind?
function sampleCarriesAnswerKey(sample: TaskSample): boolean {
  const p = sample.patch;
  return p.choices !== undefined || p.answers !== undefined || p.orderItems !== undefined
    || p.steps !== undefined || p.surveyChoices !== undefined || p.numericAnswer !== undefined
    || sample.smart?.secretCode !== undefined;
}

export function sampleWouldOverwrite(draft: Task, sample: TaskSample): SampleOverwriteField[] {
  const out: SampleOverwriteField[] = [];
  if (sample.patch.title !== undefined && nonEmpty(draft.title)) out.push('title');
  if (sample.patch.description !== undefined && nonEmpty(draft.description)) out.push('description');
  if (sampleCarriesAnswerKey(sample) && hasAuthoredAnswerKey(draft)) out.push('answerKey');
  return out;
}

// Sample content is Hebrew (the product is Hebrew-first); codes, years and numbers
// stay as-is. These are editable seeds, so a creator tweaks them to taste.
export const TASK_SAMPLES: Record<TaskType, TaskSample[]> = {
  quiz: [
    {
      label: 'טריוויה היסטורית',
      patch: {
        title: 'אתגר היסטוריה',
        description: 'ענו על השאלה על האתר שמולכם.',
        choices: ['1541', '1099', '1187', '1917'],
        answers: ['1541'],
        pointValue: 40,
        estimatedMinutes: 5,
        difficulty: 4,
      },
    },
    {
      label: 'נכון או לא נכון',
      patch: {
        title: 'בדיקת עובדה מהירה',
        description: 'האם המשפט הבא נכון או לא נכון?',
        choices: ['נכון', 'לא נכון'],
        answers: ['נכון'],
        pointValue: 20,
        estimatedMinutes: 2,
        difficulty: 2,
      },
    },
  ],
  smart_station: [
    {
      label: 'קוד סמן חבוי',
      patch: {
        title: 'מצאו את הסמן החבוי',
        description: 'חפשו את סמן הכוכב הכתום ליד הכניסה והקלידו את הקוד שלו.',
        hint: 'בערך מטר מהקרקע, ליד הפתח.',
        hintPenalty: 20,
        pointValue: 80,
        estimatedMinutes: 10,
        difficulty: 7,
      },
      smart: { verificationType: 'code_verification', secretCode: 'STAR24', hasCode: true },
    },
    {
      label: 'קוד QR באתר',
      patch: {
        title: 'סרקו את הקוד המוצב',
        description: 'מצאו את הקוד המודפס שמוצב באתר והקלידו אותו.',
        pointValue: 60,
        estimatedMinutes: 6,
        difficulty: 3,
      },
      smart: { verificationType: 'code_verification', secretCode: 'QR2024', hasCode: true },
    },
  ],
  photo: [
    {
      label: 'סלפי קבוצתי',
      patch: {
        title: 'תמונה קבוצתית באתר',
        description: 'צלמו תמונה קבוצתית שכל הקבוצה בפריים.',
        pointValue: 50,
        estimatedMinutes: 8,
        difficulty: 2,
      },
      smart: { verificationType: 'photo_upload', autoApprove: true },
    },
    {
      label: 'תמונת אקשן יצירתית',
      patch: {
        title: 'תפסו פוזה יצירתית',
        description: 'צלמו את התמונה הקבוצתית הכי יצירתית שאתם יכולים במקום הזה.',
        pointValue: 70,
        estimatedMinutes: 10,
        difficulty: 3,
      },
      smart: { verificationType: 'photo_upload', autoApprove: false },
    },
  ],
  numeric: [
    {
      label: 'ספירת משהו',
      patch: {
        title: 'כמה מדרגות?',
        description: 'ספרו את המדרגות שמובילות לכניסה ושלחו את המספר המדויק.',
        numericAnswer: 42,
        numericTolerance: 2,
        pointValue: 40,
        estimatedMinutes: 5,
        difficulty: 5,
      },
    },
  ],
  geofence: [
    {
      label: 'צ׳ק-אין GPS',
      patch: {
        title: 'הגיעו למיקום הזה',
        description: 'נווטו לנקודה המסומנת. ה-GPS יאשר את ההגעה אוטומטית.',
        geofenceRadiusMeters: 50,
        pointValue: 30,
        estimatedMinutes: 10,
        difficulty: 1,
      },
    },
  ],
  field: [
    {
      label: 'צ׳ק-אין באתר',
      patch: {
        title: 'בצעו צ׳ק-אין בנקודה הזו',
        description: 'הקישו על הכפתור כשהקבוצה מגיעה לאתר.',
        pointValue: 25,
        estimatedMinutes: 8,
        difficulty: 1,
      },
    },
  ],
  self_report: [
    {
      label: 'אתגר יצירתי',
      patch: {
        title: 'השלימו את האתגר',
        description: 'סיימו את האתגר יחד, ואז דרגו את עצמכם בכנות.',
        pointValue: 60,
        estimatedMinutes: 15,
        difficulty: 4,
      },
    },
  ],
  sequence: [
    {
      label: 'חידה בשלושה שלבים',
      patch: {
        title: 'אתגר רב-שלבי',
        steps: [
          { id: 'step-sample-1', prompt: 'שלב 1: מצאו את השלט המתוארך.', answer: '' },
          { id: 'step-sample-2', prompt: 'שלב 2: קראו את השנה עליו.', answer: '' },
          { id: 'step-sample-3', prompt: 'שלב 3: שלחו את השנה הזו.', answer: '' },
        ],
        pointValue: 90,
        estimatedMinutes: 12,
        difficulty: 7,
      },
    },
  ],
  survey: [
    {
      label: 'סקר בחירה',
      patch: {
        title: 'מה האתר האהוב עליכם?',
        description: 'בחרו תשובה אחת — אין תשובה נכונה, אנחנו רק סקרנים.',
        surveyChoices: ['הכיכר', 'המזרקה', 'השוק', 'החומה'],
        pointValue: 0,
        estimatedMinutes: 1,
        difficulty: 1,
      },
    },
    {
      label: 'סקר טקסט חופשי',
      patch: {
        title: 'ספרו לנו על הרגע הכי כיף',
        description: 'כתבו בכמה מילים — התשובות נשמרות למארגן.',
        pointValue: 0,
        estimatedMinutes: 1,
        difficulty: 1,
      },
    },
  ],
};
