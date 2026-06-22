// Quick-start game templates — pre-fill the Builder with a working structure the
// creator can then edit. Each `build()` returns fresh stages (new ids each time).
import type { Stage, Task, ScoringPreset, GameMode } from '@rushpoint/shared';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function task(over: Partial<Task>): Task {
  return {
    id: uuid(), title: '', type: 'field', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5, ...over,
  };
}
function stage(title: string, tasks: Task[], over: Partial<Stage> = {}): Stage {
  return { id: uuid(), order: 0, title, tasks, ...over };
}

export interface GameTemplate {
  key: string;
  label: string;
  emoji: string;
  description: string;
  mode: GameMode;
  scoringPreset: ScoringPreset;
  build: () => Stage[];
}

export const TEMPLATES: GameTemplate[] = [
  {
    key: 'blank', label: 'Blank', emoji: '📄',
    description: 'One empty stage — build it your way.',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [stage('Stage 1', [task({ title: '' })])],
  },
  {
    key: 'riddle', label: 'Riddle Hunt', emoji: '🗝️',
    description: 'Solve a riddle at each stop to unlock the next.',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('The First Clue', [task({
        title: 'Riddle 1', type: 'quiz', locationless: true,
        description: 'I have keys but no locks, space but no room. What am I?',
        answers: ['keyboard'], hint: 'You are typing on it.', hintPenalty: 20,
      })]),
      stage('The Second Clue', [task({
        title: 'Riddle 2', type: 'quiz', locationless: true,
        description: 'What has hands but cannot clap?', answers: ['a clock', 'clock'],
      })]),
      stage('The Final Clue', [task({
        title: 'Riddle 3', type: 'quiz', locationless: true,
        description: 'The more you take, the more you leave behind. What are they?',
        answers: ['footsteps', 'steps'],
      })], { isFinal: true }),
    ],
  },
  {
    key: 'photo', label: 'Photo Crawl', emoji: '📸',
    description: 'A trail of photo missions around your area.',
    mode: 'team', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('Landmark Selfie', [task({
        title: 'Group selfie at the landmark', type: 'photo',
        description: 'Take a group selfie in front of the main landmark.',
        smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
      })]),
      stage('Local Color', [task({
        title: 'Something colorful', type: 'photo',
        description: 'Snap the most colorful thing you can find.',
        smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
      })]),
      stage('The Finish Shot', [task({
        title: 'Victory pose', type: 'photo',
        description: 'Strike a victory pose at the finish point!',
        smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
      })], { isFinal: true }),
    ],
  },
  {
    key: 'trivia', label: 'Trivia Trail', emoji: '❓',
    description: 'Multiple-choice questions at each stop.',
    mode: 'individual', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('Warm-up', [task({
        title: 'Question 1', type: 'quiz', locationless: true,
        description: 'Which planet is known as the Red Planet?',
        choices: ['Venus', 'Mars', 'Jupiter'], answers: ['Mars'],
      })]),
      stage('Getting Harder', [task({
        title: 'Question 2', type: 'quiz', locationless: true,
        description: 'How many continents are there?',
        choices: ['5', '6', '7'], answers: ['7'],
      })]),
      stage('Final Question', [task({
        title: 'Question 3', type: 'quiz', locationless: true,
        description: 'What is the largest ocean?',
        choices: ['Atlantic', 'Indian', 'Pacific'], answers: ['Pacific'],
      })], { isFinal: true }),
    ],
  },
];
