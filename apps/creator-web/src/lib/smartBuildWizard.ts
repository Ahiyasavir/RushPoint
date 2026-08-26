// The smart-build questionnaire's flow (change: smart-game-composer).
//
// A SEPARATE state machine from lib/newGameWizard.ts's `wizardReducer`, not a
// sixth case bolted into it. Two flows' rules living in one switch is how a
// change to one silently breaks the other, and it would leave the existing
// wizard's tests guarding behaviour they were never written for. The two share
// exactly one thing — the `CreationPlan` union — and nothing else.
//
// ─── Rules encoded here, not in the component ────────────────────────────────
//
// 1. EVERY QUESTION HAS A DEFAULT, inherited from the existing wizard's rule 4.
//    A creator who taps straight through must still get a game. The defaults are
//    not decorative: scripts/test-smart-build-wizard.ts feeds every one of them,
//    and every combination of every offered option, into the real composer,
//    because "has a default" is worthless if the default is a value the composer
//    then refuses.
// 2. NOTHING IS CREATED UNTIL THE END — the existing wizard's rule 5, and the
//    reason both of these are reducers over explicit state rather than a pile of
//    component `useState`s: "have we created anything yet" has to be answerable
//    without rendering anything.
// 3. ANSWERS SURVIVE NAVIGATION. Six questions is enough that going back to check
//    one is normal; losing the other five for it is not.
// 4. BACK FROM THE FIRST QUESTION MEANS "LEAVE", signalled as index -1. The host
//    wizard reads it and returns to the path fork, so a creator who picked the
//    wrong card is never trapped.
// 5. TOTAL. An unknown action or a malformed state yields a usable state, never a
//    throw — the same contract `wizardReducer` holds.
//
// Pure — no React, no Firebase — so all of the above is a unit test rather than a
// click-through.
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_GROUP_SIZE,
  DURATION_BANDS,
  GROUP_SIZE_BANDS,
} from '@rushpoint/shared';
import {
  isBankTagId,
  settingForAreas,
  PREP_LEVELS,
  type PrepLevel,
  ACTIVITY_TAG_IDS,
  type AudienceTagId,
  type BankTagId,
  AREA_TAG_IDS,
  type AreaTagId,
} from '../bankTags';
import type { ComposerAnswers, DifficultyPreference } from './composeGame';

/** The questions, in the order they are asked. */
export const SMART_BUILD_QUESTION_ORDER = [
  'who',
  'areas',
  'people',
  'duration',
  'difficulty',
  'prep',
  'preferred',
] as const;
export type SmartBuildQuestion = typeof SMART_BUILD_QUESTION_ORDER[number];

// The options each question offers. Drawn from the canonical registries rather
// than re-listed, so a chip can never render a tag the composer does not score.
/**
 * Who is playing — audience and age in ONE answer.
 *
 * These used to be two questions, and they asked the same thing twice: a creator
 * picked "kids" and was then asked for an age band, where nothing stopped them
 * choosing 18+. Two answers, one fact, and a contradiction the composer had to
 * silently resolve. Each option below carries both values, so the contradiction
 * cannot be expressed.
 *
 * `mixed` deliberately takes the LOWEST age floor: it means "everyone is here",
 * and the age term is a floor test, so the lowest floor is the one that keeps
 * every mission eligible.
 */
export const SMART_BUILD_WHO = [
  { id: 'kids', audience: 'kids', ageBandId: 'band-8-10' },
  { id: 'preteens', audience: 'youth', ageBandId: 'band-11-13' },
  { id: 'teens', audience: 'youth', ageBandId: 'band-14-17' },
  { id: 'adults', audience: 'adults', ageBandId: 'band-18-plus' },
  { id: 'corporate', audience: 'corporate', ageBandId: 'band-18-plus' },
  { id: 'mixed', audience: 'mixed', ageBandId: 'band-8-10' },
] as const satisfies readonly { id: string; audience: AudienceTagId; ageBandId: string }[];

export type SmartBuildWhoId = typeof SMART_BUILD_WHO[number]['id'];

/** The who-option for an id, falling back to "everyone" rather than throwing. */
export function whoChoice(id: unknown): typeof SMART_BUILD_WHO[number] {
  return SMART_BUILD_WHO.find((w) => w.id === id) ?? SMART_BUILD_WHO[5];
}
export const SMART_BUILD_DIFFICULTIES: readonly DifficultyPreference[] = ['easy', 'balanced', 'hard'];

/**
 * How much the creator is willing to prepare before the game.
 *
 * Asked out loud rather than inferred, because the tiers differ in KIND, not
 * just in amount: the top one means going to a business, paying them, and
 * relying on the owner to hand a code to strangers. A creator who wanted to
 * press a button and run a game the same evening must never be handed that by
 * default, and nothing about their other answers reveals which kind they are.
 */
export const SMART_BUILD_PREP_LEVELS: readonly PrepLevel[] = PREP_LEVELS;
export const SMART_BUILD_GROUP_SIZES = GROUP_SIZE_BANDS;
export const SMART_BUILD_DURATIONS = DURATION_BANDS;

/**
 * The activity kinds a creator can ask for more of.
 *
 * Only ACTIVITY tags — asking a creator whether they want "needs setup" or
 * "location-based" missions is asking them to think in our data model. Drawn
 * from the registry rather than re-listed, same reasoning as SMART_BUILD_AREAS:
 * a new activity (e.g. `educational`) is then offered automatically, instead of
 * silently existing in the bank but unreachable as a creator preference.
 */
export const SMART_BUILD_PREFERRED_TAGS: readonly BankTagId[] = ACTIVITY_TAG_IDS;

/**
 * The kinds of place a creator can say their event has.
 *
 * Multi-select and skippable: real events span more than one (a school trip is
 * a park AND a neighbourhood), and a creator who does not know yet should not be
 * forced to guess. Empty means "no preference", which scores neutrally.
 */
export const SMART_BUILD_AREAS: readonly AreaTagId[] = AREA_TAG_IDS;

export interface SmartBuildAnswers {
  /** Audience and age, answered once. See SMART_BUILD_WHO. */
  who: SmartBuildWhoId;
  people: number;
  minutes: number;
  difficultyPreference: DifficultyPreference;
  preferredTags: BankTagId[];
  /** How much prep the creator will do before the game. See SMART_BUILD_PREP_LEVELS. */
  prepEffort: PrepLevel;
  /**
   * The kinds of place this event has. EMPTY means no fixed venue — there is no
   * separate indoor/outdoor question, because naming a mall already said it.
   */
  areas: AreaTagId[];
  /**
   * Should the composer PIN play-from-anywhere missions to real spots and guide
   * the creator through placing each one? Defaults to false — see
   * ComposerAnswers.locationMissions for why this is an explicit ask rather than
   * something inferred from the places named above.
   */
  locationMissions: boolean;
}

export interface SmartBuildState {
  /**
   * Which question is showing. `-1` means the creator left through the top;
   * `SMART_BUILD_QUESTION_ORDER.length` means every question is answered.
   */
  index: number;
  answers: SmartBuildAnswers;
}

export type SmartBuildAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'setAnswer'; key: keyof SmartBuildAnswers; value: string | number }
  | { type: 'togglePreferred'; tag: BankTagId }
  | { type: 'toggleArea'; area: AreaTagId }
  | { type: 'setLocationMissions'; value: boolean };

/** The index that means "the creator backed out of the questionnaire". */
export const SMART_BUILD_LEFT = -1;

/** The answer every question falls back to when the creator skips it. */
export function smartBuildDefaults(): SmartBuildAnswers {
  return {
    // "Everyone" is the honest default: we have not been told who is playing, and
    // it is the one answer that keeps every mission eligible.
    who: 'mixed',
    people: DEFAULT_GROUP_SIZE,
    minutes: DEFAULT_DURATION_MINUTES,
    difficultyPreference: 'balanced',
    preferredTags: [],
    // Self-prep, never an outside partner. The middle tier is what most games
    // already expected of a creator, and the top one has to be chosen on
    // purpose — it depends on somebody who is not the creator turning up.
    prepEffort: 'light',
    // Empty means no fixed venue — the setting the composer can always satisfy,
    // because it never hard-filters a mission out for being unplayable.
    areas: [],
    // Playable from anywhere is the default everywhere, indoors and out, until
    // the creator explicitly asks to route missions to real spots.
    locationMissions: false,
  };
}

export function initialSmartBuildState(): SmartBuildState {
  return { index: 0, answers: smartBuildDefaults() };
}

const isState = (s: unknown): s is SmartBuildState =>
  !!s && typeof s === 'object'
  && typeof (s as SmartBuildState).index === 'number'
  && !!(s as SmartBuildState).answers
  && typeof (s as SmartBuildState).answers === 'object';

/** A usable state, whatever was handed in. */
function safeState(s: unknown): SmartBuildState {
  if (!isState(s)) return initialSmartBuildState();
  return { index: s.index, answers: { ...smartBuildDefaults(), ...s.answers } };
}

const positive = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** Total: an unrecognised state or action yields a usable state, never a throw. */
export function smartBuildReducer(state: SmartBuildState, action: SmartBuildAction): SmartBuildState {
  const s = safeState(state);
  const a = (action ?? {}) as SmartBuildAction;
  const last = SMART_BUILD_QUESTION_ORDER.length - 1;

  switch (a?.type) {
    case 'next':
      // Never past one-step-beyond-the-last: that index IS "complete".
      return { ...s, index: Math.min(s.index + 1, last + 1) };

    case 'back':
      // Below zero exactly once — the "leave" signal (rule 4).
      return { ...s, index: Math.max(s.index - 1, SMART_BUILD_LEFT) };

    case 'setAnswer': {
      if (!a.key || !(a.key in s.answers)) return s;
      return { ...s, answers: sanitizeAnswers({ ...s.answers, [a.key]: a.value }) };
    }

    case 'togglePreferred': {
      if (!isBankTagId(a.tag)) return s;
      const current = s.answers.preferredTags;
      const next = current.includes(a.tag)
        ? current.filter((t) => t !== a.tag)
        : [...current, a.tag];
      return { ...s, answers: { ...s.answers, preferredTags: next } };
    }

    case 'toggleArea': {
      if (!(AREA_TAG_IDS as readonly string[]).includes(a.area)) return s;
      const current = s.answers.areas;
      const next = current.includes(a.area)
        ? current.filter((t) => t !== a.area)
        : [...current, a.area];
      return { ...s, answers: { ...s.answers, areas: next } };
    }

    case 'setLocationMissions':
      return { ...s, answers: { ...s.answers, locationMissions: a.value === true } };

    default:
      return s;
  }
}

/**
 * Every answer coerced back into range.
 *
 * Applied on WRITE rather than only on read, so a state inspected mid-flow (by a
 * component, by a test) is already the state the composer would be given.
 */
function sanitizeAnswers(answers: Partial<SmartBuildAnswers>): SmartBuildAnswers {
  const d = smartBuildDefaults();
  return {
    who: oneOf(answers.who, SMART_BUILD_WHO.map((w) => w.id), d.who),
    people: positive(answers.people, d.people),
    minutes: positive(answers.minutes, d.minutes),
    difficultyPreference: oneOf(answers.difficultyPreference, SMART_BUILD_DIFFICULTIES, d.difficultyPreference),
    prepEffort: oneOf(answers.prepEffort, SMART_BUILD_PREP_LEVELS, d.prepEffort),
    preferredTags: Array.isArray(answers.preferredTags)
      ? answers.preferredTags.filter((t, i, arr) => isBankTagId(t) && arr.indexOf(t) === i)
      : [],
    areas: Array.isArray(answers.areas)
      ? answers.areas.filter((t, i, arr) =>
        (AREA_TAG_IDS as readonly string[]).includes(t) && arr.indexOf(t) === i)
      : [],
    locationMissions: answers.locationMissions === true,
  };
}

/** Has the creator answered every question? */
export function isSmartBuildComplete(state: SmartBuildState): boolean {
  return isState(state) && state.index >= SMART_BUILD_QUESTION_ORDER.length;
}

/** Did the creator back out through the top? */
export function hasLeftSmartBuild(state: SmartBuildState): boolean {
  return isState(state) && state.index <= SMART_BUILD_LEFT;
}

/** What the stepped shell shows: "step N of M". 1-based for display. */
export function smartBuildProgress(state: SmartBuildState): { step: number; total: number } {
  const s = safeState(state);
  const total = SMART_BUILD_QUESTION_ORDER.length;
  return { step: Math.min(Math.max(s.index, 0) + 1, total + 1), total };
}

/** Which question is showing, or null when the flow is finished or abandoned. */
export function currentSmartBuildQuestion(state: SmartBuildState): SmartBuildQuestion | null {
  const s = safeState(state);
  return SMART_BUILD_QUESTION_ORDER[s.index] ?? null;
}

/**
 * The composer payload.
 *
 * Total by construction: derived from the sanitized answers, so it is a valid
 * `ComposerAnswers` for EVERY reachable state, including one the creator never
 * touched and one that arrived malformed.
 */
export function smartBuildAnswers(state: SmartBuildState): ComposerAnswers {
  const a = sanitizeAnswers(safeState(state).answers);
  // audience + age come from ONE answer, and the setting is DERIVED from the
  // places named — neither is asked for separately, so neither can contradict.
  const who = whoChoice(a.who);
  return {
    audience: who.audience,
    setting: settingForAreas(a.areas),
    people: a.people,
    minutes: a.minutes,
    ageBandId: who.ageBandId,
    difficultyPreference: a.difficultyPreference,
    ...(a.preferredTags.length > 0 ? { preferredTags: a.preferredTags } : {}),
    ...(a.areas.length > 0 ? { areas: a.areas } : {}),
    locationMissions: a.locationMissions,
    prepEffort: a.prepEffort,
  };
}
