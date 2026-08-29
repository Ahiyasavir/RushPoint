// The read-only game a share link serves (change: game-share-link).
//
// ── THE SECRECY MECHANISM: COPY OUT, NEVER STRIP OUT ─────────────────────────
// Same argument as apps/creator-web/src/lib/galleryTaskDetail.ts, one level up:
// every field below is read BY NAME onto a freshly constructed object, and
// nothing is spread from the input. A strip-list (`const { hint, ...rest } = task`)
// is correct only for the secrets someone remembered and silently leaks the next
// field `Task` grows — and `Task` grows most releases. Copy-out leaks nothing by
// construction: forgetting a field costs a MISSING row (visible) instead of a
// LEAKED one (invisible).
//
// `SECRET_SHARE_FIELD_NAMES` is documentation for the test sweep, not the
// mechanism. Do not turn it into a filter.
//
// The one deliberate exception is `revealAnswers`: a creator sharing a game with
// a co-organizer may opt IN to showing the answer keys on that specific link.
// Default OFF, and the flag is a property of the LINK (server-side), never of
// anything the viewer sends.
import type {
  Game, Stage, Task, TaskMedia, GameMode, ScoringPreset, GeoPoint,
  GameBranding, GameInstructions, StoryBeat, ExclusiveTaskGroup, TriggerMode,
  TaskType, WrongAnswerLevel,
} from './types';
import type { SafeZone } from './safeZone';

/**
 * Server-secret names the shared view must never carry while `answersRevealed`
 * is false. Swept by scripts/test-shared-game-view.ts at every depth.
 */
export const SECRET_SHARE_FIELD_NAMES = [
  'answers',
  'numericAnswer',
  'hint',
  'secretCode',
  'smart',
  'adminNotes',
  'orderItems',
  'integrationWebhookUrl',
  'ownerUid',
] as const;

export interface SharedTaskStepView {
  id: string;
  prompt: string;
  /** Present only when the link reveals answers. */
  answer?: string;
}

export interface SharedTaskView {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  /** The authored point. A share link is a deliberate disclosure to one person. */
  coordinates?: GeoPoint;
  difficulty?: number;
  estimatedMinutes?: number;
  expectedDurationMinutes?: number;
  pointValue?: number;
  maxConcurrentTeams?: number;
  triggerMode?: TriggerMode;
  locationless?: boolean;
  hideLocation?: boolean;
  locationClue?: string;
  locationClueHe?: string;
  geofenceRadiusMeters?: number;
  requirePresence?: boolean;
  wrongAnswerPenalty?: WrongAnswerLevel;
  pausesTimer?: boolean;
  releaseAt?: string;
  releaseAfterMinutes?: number;
  expiresAfterMinutes?: number;
  unlockAfterTaskIds?: string[];
  choices?: string[];
  surveyChoices?: string[];
  numericTolerance?: number;
  tags?: string[];
  media?: TaskMedia[];
  /** Whether a paid hint exists + what it costs — never the hint TEXT. */
  hasHint: boolean;
  hintPenalty?: number;
  /** Sequence sub-steps: the prompt only. The step answer is an answer key. */
  steps?: SharedTaskStepView[];
  /** The five fields below are present only when the link reveals answers. */
  answers?: string[];
  numericAnswer?: number;
  hint?: string;
  secretCode?: string;
  orderItems?: string[];
}

export interface SharedStageView {
  id: string;
  order: number;
  title: string;
  isFinal?: boolean;
  requiredTaskCount?: number;
  releaseAt?: string;
  releaseAfterMinutes?: number;
  exclusiveGroups?: ExclusiveTaskGroup[];
  narrative?: { intro?: StoryBeat; outro?: StoryBeat };
  tasks: SharedTaskView[];
}

export interface SharedGameView {
  id: string;
  title: string;
  description?: string;
  mode: GameMode;
  scoringPreset: ScoringPreset;
  tags: string[];
  coverImage?: string;
  approxLocation?: GeoPoint & { label?: string };
  branding?: GameBranding;
  instructions?: GameInstructions;
  safeZone?: SafeZone;
  requiresGuardianConsent?: boolean;
  minAge?: number;
  testMode?: boolean;
  powerUpsEnabled?: boolean;
  stageCount: number;
  taskCount: number;
  /** True when this link opted in to showing answer keys. Rendered as a banner. */
  answersRevealed: boolean;
  stages: SharedStageView[];
}

/** Copy a value only when it is present (keeps `undefined` keys off the wire). */
function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined | null): void {
  if (value !== undefined && value !== null) target[key] = value as T[K];
}

function shareMedia(media: unknown): TaskMedia[] | undefined {
  if (!Array.isArray(media)) return undefined;
  const out = media
    .filter((m): m is TaskMedia => !!m && typeof m === 'object' && typeof (m as TaskMedia).url === 'string')
    .map((m) => {
      const item = { id: String(m.id ?? ''), kind: m.kind, url: m.url } as TaskMedia;
      put(item, 'caption', typeof m.caption === 'string' ? m.caption : undefined);
      return item;
    });
  return out.length ? out : undefined;
}

function shareStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string');
  return out.length ? out : undefined;
}

export function sanitizeTaskForShare(task: Task, revealAnswers = false): SharedTaskView {
  const t: SharedTaskView = {
    id: String(task.id ?? ''),
    title: String(task.title ?? ''),
    type: task.type,
    hasHint: typeof task.hint === 'string' && task.hint.trim().length > 0,
  };
  put(t, 'description', task.description);
  // A located mission carries its point: the recipient is reviewing (or about to
  // copy) the game, and a builder view with no map is not a builder view. Hidden
  // missions included — `hideLocation` seals the PLAYER's payload, not the
  // author's, and the same reasoning already governs the gallery projection.
  if (task.coordinates && typeof task.coordinates.lat === 'number' && typeof task.coordinates.lng === 'number') {
    t.coordinates = { lat: task.coordinates.lat, lng: task.coordinates.lng };
  }
  put(t, 'difficulty', task.difficulty);
  put(t, 'estimatedMinutes', task.estimatedMinutes);
  put(t, 'expectedDurationMinutes', task.expectedDurationMinutes);
  put(t, 'pointValue', task.pointValue);
  put(t, 'maxConcurrentTeams', task.maxConcurrentTeams);
  put(t, 'triggerMode', task.triggerMode);
  put(t, 'locationless', task.locationless);
  put(t, 'hideLocation', task.hideLocation);
  put(t, 'locationClue', task.locationClue);
  put(t, 'locationClueHe', task.locationClueHe);
  put(t, 'geofenceRadiusMeters', task.geofenceRadiusMeters);
  put(t, 'requirePresence', task.requirePresence);
  put(t, 'wrongAnswerPenalty', task.wrongAnswerPenalty);
  put(t, 'pausesTimer', task.pausesTimer);
  put(t, 'releaseAt', task.releaseAt);
  put(t, 'releaseAfterMinutes', task.releaseAfterMinutes);
  put(t, 'expiresAfterMinutes', task.expiresAfterMinutes);
  put(t, 'unlockAfterTaskIds', shareStrings(task.unlockAfterTaskIds));
  put(t, 'choices', shareStrings(task.choices));
  put(t, 'surveyChoices', shareStrings(task.surveyChoices));
  put(t, 'numericTolerance', task.numericTolerance);
  put(t, 'tags', shareStrings(task.tags));
  put(t, 'media', shareMedia(task.media));
  put(t, 'hintPenalty', task.hintPenalty);

  if (Array.isArray(task.steps)) {
    t.steps = task.steps.map((s) => {
      const step: SharedTaskStepView = {
        id: String(s?.id ?? ''),
        prompt: String(s?.prompt ?? ''),
      };
      if (revealAnswers && typeof s?.answer === 'string') step.answer = s.answer;
      return step;
    });
  }

  if (revealAnswers) {
    put(t, 'answers', shareStrings(task.answers));
    put(t, 'numericAnswer', task.numericAnswer);
    put(t, 'hint', task.hint);
    put(t, 'orderItems', shareStrings(task.orderItems));
    // The smart-station code is the one secret that does not live on the task
    // itself. Nothing else from `smart` is copied — it carries admin notes.
    put(t, 'secretCode', task.smart?.secretCode);
  }
  return t;
}

export function sanitizeStageForShare(stage: Stage, revealAnswers = false): SharedStageView {
  const s: SharedStageView = {
    id: String(stage.id ?? ''),
    order: typeof stage.order === 'number' ? stage.order : 0,
    title: String(stage.title ?? ''),
    tasks: (Array.isArray(stage.tasks) ? stage.tasks : []).map((t) => sanitizeTaskForShare(t, revealAnswers)),
  };
  put(s, 'isFinal', stage.isFinal);
  put(s, 'requiredTaskCount', stage.requiredTaskCount);
  put(s, 'releaseAt', stage.releaseAt);
  put(s, 'releaseAfterMinutes', stage.releaseAfterMinutes);
  put(s, 'exclusiveGroups', stage.exclusiveGroups);
  put(s, 'narrative', stage.narrative);
  return s;
}

/**
 * The whole read-only projection. `revealAnswers` comes from the LINK document,
 * never from the caller's payload.
 */
export function sanitizeGameForShare(game: Game, revealAnswers = false): SharedGameView {
  const stages = (Array.isArray(game.stages) ? game.stages : [])
    .map((st) => sanitizeStageForShare(st, revealAnswers));
  const view: SharedGameView = {
    id: String(game.id ?? ''),
    title: String(game.title ?? ''),
    mode: game.mode,
    scoringPreset: game.scoringPreset,
    tags: shareStrings(game.tags) ?? [],
    stageCount: stages.length,
    taskCount: stages.reduce((n, st) => n + st.tasks.length, 0),
    answersRevealed: revealAnswers === true,
    stages,
  };
  put(view, 'description', game.description);
  put(view, 'coverImage', game.coverImage);
  put(view, 'approxLocation', game.approxLocation);
  put(view, 'branding', game.branding);
  put(view, 'instructions', game.instructions);
  put(view, 'safeZone', game.safeZone ?? undefined);
  put(view, 'requiresGuardianConsent', game.requiresGuardianConsent);
  put(view, 'minAge', game.minAge);
  put(view, 'testMode', game.testMode);
  put(view, 'powerUpsEnabled', game.powerUpsEnabled);
  return view;
}
