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
};
