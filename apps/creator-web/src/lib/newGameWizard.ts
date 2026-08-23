// The new-game wizard's flow (change: guided-new-game-wizard).
//
// The old "+ New game" opened a list of template cards. That asks a brand-new
// creator to choose between things they have no way to evaluate, and then drops
// them into the Builder holding an UNTITLED game whose description, capacity and
// pacing all describe somebody else's event. The vocabulary — stage, mission,
// template — has to be learned before any progress is possible.
//
// This wizard inverts that: name first, then one fork, then at most four
// questions, and the creator arrives inside a game that is already theirs.
//
// ─── Rules encoded here, not in the component ────────────────────────────────
//
// 1. THE NAME IS FIRST, on every path. It is the one answer every path needs, and
//    it is what turns "configuring software" into "editing my game".
// 2. A BLANK NAME NEVER BLOCKS. The wizard exists to remove friction; refusing to
//    continue over an empty field would add some. It falls back to exactly the
//    untitled title the old blank path produced.
// 3. SCRATCH IS A PEER, NOT A FALLBACK. It sits beside the guided path and asks
//    nothing further. The old picker deliberately pinned "blank" first because
//    building your own is the platform's core promise; that principle survives
//    here as an equal fork rather than as list position.
// 4. EVERY QUESTION HAS A DEFAULT, so no answer can dead-end the flow.
// 5. NOTHING IS CREATED UNTIL THE END. `buildCreationPlan` returns null for every
//    state except a finished one, which is why this is a reducer over explicit
//    state rather than a pile of component `useState`s: "have we created anything
//    yet" must be answerable without rendering.
//
// Pure — no React, no Firebase — so all of the above is a unit test rather than a
// click-through. See scripts/test-new-game-wizard.ts (in `npm test`).
import {
  AGE_BANDS,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_GROUP_SIZE,
  consentSettingsForAge,
} from '@rushpoint/shared';
import type { TemplateGenre } from '@rushpoint/shared';
import type { NewGameAnswers } from './describeNewGame';

/** The questions, in the order they are asked. Position 0 and 1 are load-bearing. */
export const WIZARD_QUESTION_ORDER = ['name', 'path', 'type', 'people', 'duration', 'age'] as const;
export type WizardQuestion = typeof WIZARD_QUESTION_ORDER[number];

/**
 * The two game types the wizard asks about. These are `Game.templateGenre`
 * values, DECLARED by the admin on each template — not inferred from a title, a
 * scoring preset or picker order. Inferring would mean that renaming a template,
 * retuning its scoring, or dragging it up the picker silently changed which game
 * the wizard builds, with nothing on screen to reveal it.
 */
export const GAME_TYPES = [
  { id: 'missions' },
  { id: 'story' },
] as const;
export type GameTypeId = TemplateGenre;

/** The subset of a template the wizard needs to resolve an answer. */
export interface WizardTemplateOption {
  groupKey: string;
  templateGenre?: TemplateGenre;
}

/**
 * Which template a game-type answer resolves to, or null when nothing matches.
 *
 * Null is a real outcome, not a bug: until an admin tags a template with a genre
 * the wizard cannot honestly claim to build that kind of game, so the caller
 * hides the option rather than silently building the wrong one.
 */
export function templateForGameType(
  templates: readonly WizardTemplateOption[],
  gameType: GameTypeId,
): WizardTemplateOption | null {
  if (!Array.isArray(templates)) return null;
  return templates.find((t) => t?.templateGenre === gameType) ?? null;
}

/** The game types that at least one available template can actually answer. */
export function availableGameTypes(templates: readonly WizardTemplateOption[]): GameTypeId[] {
  return GAME_TYPES.map((t) => t.id).filter((id) => templateForGameType(templates, id) !== null);
}

/** Which path the creator took. */
export type WizardPath = 'scratch' | 'guided';

/** Where the wizard is. `closed` is a cancelled wizard; `done` is a finished one. */
export type WizardStep = 'name' | 'path' | 'details' | 'done' | 'closed';

export interface WizardAnswers {
  type: GameTypeId;
  people: number;
  duration: number;
  age: string;
}

export interface WizardState {
  step: WizardStep;
  name: string;
  path: WizardPath | null;
  answers: WizardAnswers;
}

export type WizardAction =
  | { type: 'setName'; name: string }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'choosePath'; path: WizardPath }
  | { type: 'setAnswer'; key: 'type' | 'people' | 'duration' | 'age'; value: string | number }
  | { type: 'cancel' };

/** What the wizard hands to the Dashboard to actually create something. */
export type CreationPlan =
  | { kind: 'blank'; title: string }
  | {
      kind: 'template';
      title: string;
      gameType: GameTypeId;
      /** Structural inputs for the server. */
      personalize: { groupSize: number; durationMinutes: number; minAge?: number };
      /** The same answers, for the client-side description blend. */
      answers: NewGameAnswers;
    };

/** The answer every question falls back to when the creator skips it. */
export function defaultAnswers(): { people: number; minutes: number; ageBandId: string } {
  return {
    people: DEFAULT_GROUP_SIZE,
    minutes: DEFAULT_DURATION_MINUTES,
    // The band a youth platform's median game actually targets.
    ageBandId: AGE_BANDS[2]?.id ?? 'band-14-17',
  };
}

export function initialWizardState(): WizardState {
  const d = defaultAnswers();
  return {
    step: 'name',
    name: '',
    path: null,
    answers: { type: 'missions', people: d.people, duration: d.minutes, age: d.ageBandId },
  };
}

/**
 * The title a game gets. A blank name is not an error — it resolves to the same
 * untitled title the old blank path used, so nothing blocks on an empty field.
 */
export function resolveGameTitle(name: unknown, untitledFallback: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || untitledFallback;
}

function isState(s: unknown): s is WizardState {
  return !!s && typeof s === 'object' && typeof (s as WizardState).step === 'string';
}

/** Total: an unrecognised state or action yields a usable state, never a throw. */
export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  const s = isState(state) ? state : initialWizardState();
  const a = (action ?? {}) as WizardAction;
  switch (a.type) {
    case 'setName':
      return { ...s, name: typeof a.name === 'string' ? a.name : '' };
    case 'choosePath':
      if (a.path === 'scratch') return { ...s, path: 'scratch', step: 'done' };
      if (a.path === 'guided') return { ...s, path: 'guided', step: 'details' };
      return s;
    case 'setAnswer': {
      if (!a.key) return s;
      return { ...s, answers: { ...s.answers, [a.key]: a.value } as WizardAnswers };
    }
    case 'next':
      if (s.step === 'name') return { ...s, step: 'path' };
      if (s.step === 'details') return { ...s, step: 'done' };
      return s;
    case 'back':
      if (s.step === 'details') return { ...s, step: 'path', path: null };
      if (s.step === 'path') return { ...s, step: 'name' };
      return s;
    case 'cancel':
      return { ...s, step: 'closed' };
    default:
      return s;
  }
}

/** Has the guided path collected everything it needs? */
export function isGuidedComplete(state: WizardState): boolean {
  return isState(state) && state.path === 'guided' && state.step === 'done';
}

function positive(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * What to create, or null if nothing should be created yet.
 *
 * Null for every state except a finished one — a cancelled or half-finished
 * wizard must leave no game behind, and that is asserted rather than assumed.
 */
export function buildCreationPlan(state: WizardState, untitledFallback = ''): CreationPlan | null {
  if (!isState(state)) return null;
  if (state.step !== 'done' || !state.path) return null;

  const title = resolveGameTitle(state.name, untitledFallback);
  if (state.path === 'scratch') return { kind: 'blank', title };

  const d = defaultAnswers();
  const people = positive(state.answers?.people, d.people);
  const minutes = positive(state.answers?.duration, d.minutes);
  const ageBandId = typeof state.answers?.age === 'string' && state.answers.age
    ? state.answers.age
    : d.ageBandId;
  const gameType: GameTypeId = state.answers?.type === 'story' ? 'story' : 'missions';

  const band = AGE_BANDS.find((b) => b.id === ageBandId);
  // The server re-derives the consent flag itself; the client only needs to pass
  // the age it stands for, so the two can never disagree about the threshold.
  const { minAge } = consentSettingsForAge(band?.from);

  return {
    kind: 'template',
    title,
    gameType,
    personalize: { groupSize: people, durationMinutes: minutes, ...(minAge !== undefined ? { minAge } : {}) },
    answers: { people, minutes, ageBandId },
  };
}
