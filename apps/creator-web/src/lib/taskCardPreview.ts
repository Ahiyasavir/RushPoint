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
};

export function taskPreviewLine(task: Task): string {
  switch (task.type) {
    case 'quiz': {
      const choices = task.choices?.length ?? 0;
      const correct = task.answers?.length ?? 0;
      if (choices > 0) return `${choices} choices, ${correct} correct`;
      if (correct > 0) return 'Typed answer';
      return 'No answer set';
    }
    case 'smart_station': {
      const code = task.smart?.secretCode;
      return code ? `Code ${'•'.repeat(Math.min(code.length, 8))}` : 'No code set';
    }
    case 'photo':
      return task.smart?.autoApprove ? 'Auto approve' : 'Staff review';
    case 'numeric':
      return task.numericAnswer != null
        ? `Answer ${task.numericAnswer} ± ${task.numericTolerance ?? 0}`
        : 'No answer set';
    case 'geofence':
      return `Auto check in within ${task.geofenceRadiusMeters ?? 50}m`;
    case 'sequence': {
      const n = task.steps?.length ?? 0;
      return `${n} ordered ${n === 1 ? 'step' : 'steps'}`;
    }
    case 'field':
      return 'Tap to check in';
    case 'self_report':
      return 'Team self report';
  }
}
