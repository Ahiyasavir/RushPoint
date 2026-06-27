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

export const TASK_SAMPLES: Record<TaskType, TaskSample[]> = {
  quiz: [
    {
      label: 'Historical trivia',
      patch: {
        title: 'History challenge',
        description: 'Answer this question about the landmark in front of you.',
        choices: ['1541', '1099', '1187', '1917'],
        answers: ['1541'],
        pointValue: 40,
        estimatedMinutes: 5,
        difficulty: 4,
      },
    },
    {
      label: 'True or false',
      patch: {
        title: 'Quick fact check',
        description: 'Is the following statement true or false?',
        choices: ['True', 'False'],
        answers: ['True'],
        pointValue: 20,
        estimatedMinutes: 2,
        difficulty: 2,
      },
    },
  ],
  smart_station: [
    {
      label: 'Hidden marker code',
      patch: {
        title: 'Find the hidden marker',
        description: 'Search for the orange star marker near the entrance and enter its code.',
        hint: 'About one metre off the ground, beside the doorway.',
        hintPenalty: 20,
        pointValue: 80,
        estimatedMinutes: 10,
        difficulty: 7,
      },
      smart: { verificationType: 'code_verification', secretCode: 'STAR24', hasCode: true },
    },
    {
      label: 'On-site QR code',
      patch: {
        title: 'Scan the posted code',
        description: 'Find the printed code posted at the landmark and type it in.',
        pointValue: 60,
        estimatedMinutes: 6,
        difficulty: 3,
      },
      smart: { verificationType: 'code_verification', secretCode: 'QR2024', hasCode: true },
    },
  ],
  photo: [
    {
      label: 'Team selfie',
      patch: {
        title: 'Team photo at this landmark',
        description: 'Take a group photo with the whole team in frame.',
        pointValue: 50,
        estimatedMinutes: 8,
        difficulty: 2,
      },
      smart: { verificationType: 'photo_upload', autoApprove: true },
    },
    {
      label: 'Creative action shot',
      patch: {
        title: 'Strike a creative pose',
        description: 'Take the most creative team photo you can at this spot.',
        pointValue: 70,
        estimatedMinutes: 10,
        difficulty: 3,
      },
      smart: { verificationType: 'photo_upload', autoApprove: false },
    },
  ],
  numeric: [
    {
      label: 'Count something',
      patch: {
        title: 'How many steps?',
        description: 'Count the steps leading up to the entrance and submit the exact number.',
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
      label: 'GPS check-in',
      patch: {
        title: 'Reach this location',
        description: 'Navigate to the marked spot. Your GPS confirms arrival automatically.',
        geofenceRadiusMeters: 50,
        pointValue: 30,
        estimatedMinutes: 10,
        difficulty: 1,
      },
    },
  ],
  field: [
    {
      label: 'Landmark check-in',
      patch: {
        title: 'Check in at this point',
        description: 'Tap the button when your team reaches this landmark.',
        pointValue: 25,
        estimatedMinutes: 8,
        difficulty: 1,
      },
    },
  ],
  self_report: [
    {
      label: 'Creative challenge',
      patch: {
        title: 'Complete this challenge',
        description: 'Finish the challenge together, then rate yourselves honestly.',
        pointValue: 60,
        estimatedMinutes: 15,
        difficulty: 4,
      },
    },
  ],
  sequence: [
    {
      label: 'Three-step puzzle',
      patch: {
        title: 'Multi-step challenge',
        steps: [
          { id: 'step-sample-1', prompt: 'Step 1: Find the dated plaque.', answer: '' },
          { id: 'step-sample-2', prompt: 'Step 2: Read the year on it.', answer: '' },
          { id: 'step-sample-3', prompt: 'Step 3: Submit that year.', answer: '' },
        ],
        pointValue: 90,
        estimatedMinutes: 12,
        difficulty: 7,
      },
    },
  ],
};
