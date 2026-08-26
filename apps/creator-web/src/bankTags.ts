// The canonical bank tag registry — the ONE vocabulary the game composer filters
// and scores missions on (change: smart-game-composer).
//
// ─── Flat and open, on purpose ───────────────────────────────────────────────
//
// The headings below ("stage role", "activity", …) are DOCUMENTATION. Nothing in
// the codebase reads them, and no consumer may start to: storage and filtering
// treat every tag as one flat, equal id, always via `entry.tags.includes(id)`.
//
// The alternative — a structured `{ audience, setting, prep, activity }` record —
// reads better on the page and is worse everywhere else. This feature's whole
// growth path is new dimensions (night-only, water, wheelchair-accessible, …),
// and under a struct each one is a type change, a migration of every existing
// entry, and a new accessor. Here it is one line below, plus tagging the entries
// it applies to. Nothing else moves.
//
// ─── Not the gallery's tags ──────────────────────────────────────────────────
//
// This is a CLOSED vocabulary used only to compose a game. It is unrelated to
// `Task.tags` — the free-text, creator-authored gallery tags governed by
// packages/shared/src/tags.ts, which drive search and are never constrained to a
// list. A BankTagId is never written into a game; only its localized LABEL ever
// reaches a creator's screen, and only the composer's copy words reach `Task.tags`.
//
// Both labels are load-bearing: they are rendered directly into the smart-build
// questionnaire's chips. scripts/test-bank-tags.ts asserts every tag carries both
// and that neither leaks the other language.

export interface BankTagLabel {
  /** Hebrew label. Creator-web is Hebrew-first. */
  he: string;
  /** English label. */
  en: string;
}

export const BANK_TAGS = {
  // ── Stage role — which end of the game a mission belongs at ───────────────
  // These two drive the bookend rule: a composed game always OPENS with a
  // `start` mission and CLOSES with a `finish` one.
  start: { he: 'פתיחה', en: 'Opener' },
  finish: { he: 'סיום', en: 'Finale' },

  // ── Activity — what the players actually do ───────────────────────────────
  // The composed description names one or two of these, so they double as the
  // vocabulary a creator reads back ("משחק של משימות צילום וחשיבה").
  action: { he: 'אקשן', en: 'Action' },
  camera: { he: 'מצלמה', en: 'Camera' },
  thinking: { he: 'חשיבה', en: 'Thinking' },
  teamwork: { he: 'עבודת צוות', en: 'Teamwork' },
  creative: { he: 'יצירתיות', en: 'Creative' },
  educational: { he: 'חינוכי', en: 'Educational' },

  // ── Setting — where it is played ──────────────────────────────────────────
  outdoor: { he: 'בחוץ', en: 'Outdoor' },
  indoor: { he: 'בפנים', en: 'Indoor' },

  // ── Area — the KIND of place, finer than outdoor/indoor ───────────────────
  // A creator picks the areas their event actually has, and a mission that suits
  // one of them scores above one that does not. Deliberately a soft term: a
  // mission with no area tag is place-agnostic and always a fair pick, and a
  // creator who skips the question loses nothing.
  forest: { he: 'יער', en: 'Forest' },
  beach: { he: 'חוף', en: 'Beach' },
  park: { he: 'פארק', en: 'Park' },
  neighborhood: { he: 'שכונה', en: 'Neighborhood' },
  cityCenter: { he: 'מרכז העיר', en: 'City center' },
  // Where most birthday parties and youth-movement activities actually happen.
  // Before it existed a creator running a game in a living room had to answer
  // "mall" or leave the question blank, and both answers were lies.
  home: { he: 'בית', en: 'Home' },
  mall: { he: 'קניון', en: 'Mall' },
  office: { he: 'משרד', en: 'Office' },
  school: { he: 'בית ספר', en: 'School' },
  // A QUALITY of the place, not a kind — see AREA_QUALITY_TAG_IDS.
  crowded: { he: 'מקום עם הרבה אנשים', en: 'Crowded' },
  historic: { he: 'מקום ישן / היסטורי', en: 'Historic' },

  // ── Preparation — what the creator has to do BEFORE the game ──────────────
  //
  // Three tiers, not two. The old pair collapsed "write down what you are
  // counting" and "go to a stall, pay the owner, and arrange that they hand out
  // a code" into one `needsSetup` bucket, and the composer scored on neither —
  // so a creator who wanted a zero-effort game could be handed a mission that
  // required them to strike a deal with a business. `needsPartner` is the tier
  // that has to be OPT-IN, because it depends on somebody who is not the creator
  // actually showing up and playing along.
  noPrep: { he: 'ללא הכנה', en: 'No prep' },
  needsSetup: { he: 'הכנה עצמית', en: 'Prep it yourself' },
  needsPartner: { he: 'תיאום עם גורם חיצוני', en: 'Needs an outside partner' },

  // ── Location — whether a map pin is required ──────────────────────────────
  // `fromAnywhere` is also a SETTING answer ("no venue"), which is why a
  // `locationBased` mission without it is hard-filtered out when the creator
  // says there is no venue: it could not be played at all.
  locationBased: { he: 'מבוסס מיקום', en: 'Location-based' },
  fromAnywhere: { he: 'מכל מקום', en: 'From anywhere' },

  // ── Audience — who it suits ───────────────────────────────────────────────
  // `mixed` is the "suits everyone" fallback: it scores below an exact match but
  // well above an unrelated audience, so a mixed-audience mission is always a
  // reasonable pick and never the wrong one.
  kids: { he: 'ילדים', en: 'Kids' },
  youth: { he: 'נוער', en: 'Youth' },
  adults: { he: 'מבוגרים', en: 'Adults' },
  corporate: { he: 'ארגוני', en: 'Corporate' },
  mixed: { he: 'כל הגילאים', en: 'All ages' },

  // ── Difficulty band — coarse. The mission's own 1-10 `difficulty` is what
  // actually drives per-stage pacing; this is for filtering and display only.
  easy: { he: 'קל', en: 'Easy' },
  medium: { he: 'בינוני', en: 'Medium' },
  hard: { he: 'מאתגר', en: 'Hard' },
} as const satisfies Record<string, BankTagLabel>;

export type BankTagId = keyof typeof BANK_TAGS;

/** Every tag id, in declaration order. */
export const BANK_TAG_IDS = Object.keys(BANK_TAGS) as BankTagId[];

/** Is this an id the registry actually knows? Total — accepts anything. */
export function isBankTagId(value: unknown): value is BankTagId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BANK_TAGS, value);
}

/**
 * The label for a creator's current language.
 *
 * Total: an unknown id yields an empty string rather than throwing or — worse —
 * falling back to the raw id, which would put `needsSetup` on a creator's screen.
 */
export function bankTagLabel(id: unknown, lang: 'he' | 'en'): string {
  if (!isBankTagId(id)) return '';
  return lang === 'en' ? BANK_TAGS[id].en : BANK_TAGS[id].he;
}

// ─── The narrow vocabularies the questionnaire answers are drawn from ────────
//
// A questionnaire answer is NOT a free tag: "audience" can only ever be one of
// five, "setting" one of three. Typing ComposerAnswers with these aliases rather
// than BankTagId makes "setting passed where audience belongs" a compile error.
// The id lists below exist so scripts/test-bank-tags.ts can assert the unions
// never drift from the registry — a drift is invisible at runtime, because
// filtering on a tag nothing carries just yields an empty pool.

export const AUDIENCE_TAG_IDS = ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const;
export type AudienceTagId = typeof AUDIENCE_TAG_IDS[number];

export const SETTING_TAG_IDS = ['outdoor', 'indoor', 'fromAnywhere'] as const;
export type SettingTagId = typeof SETTING_TAG_IDS[number];

/** Opener first, finale second — the order the composer fills them in. */
export const BOOKEND_TAG_IDS = ['start', 'finish'] as const;
export type BookendTagId = typeof BOOKEND_TAG_IDS[number];

/**
 * The activity tags, in the order the composed description prefers to name them
 * when two are equally common. Declaration order is the tie-break, so this list
 * must stay a subset of BANK_TAG_IDS in the same relative order.
 */
export const ACTIVITY_TAG_IDS = ['action', 'camera', 'thinking', 'teamwork', 'creative', 'educational'] as const;
export type ActivityTagId = typeof ACTIVITY_TAG_IDS[number];

/**
 * The kinds of place an event can happen in, in the order the questionnaire
 * offers them: open nature first, then built-up, then the two indoor ones.
 *
 * A mission tags the areas it genuinely suits and leaves the rest off. Tagging
 * nothing means "works anywhere", which scores neutrally rather than badly —
 * most missions are honestly place-agnostic, and pretending otherwise would
 * shrink the pool for no reason.
 */
/**
 * The KIND of place — this subset alone drives indoor/outdoor (see
 * `AREA_SETTING`/`settingForAreas` in this file). A quality below (crowded,
 * historic) does not belong here: a crowded place can be an indoor mall or an
 * outdoor square, so it cannot answer "is this outdoor" on its own.
 */
/**
 * The preparation tiers, CHEAPEST FIRST. Order is meaningful: a creator who
 * accepts tier N accepts everything below it.
 */
export const PREP_TAG_IDS = ['noPrep', 'needsSetup', 'needsPartner'] as const;
export type PrepTagId = typeof PREP_TAG_IDS[number];

/**
 * How much prep a creator is willing to do, as a CUMULATIVE 1-5 rating.
 *
 * Five answer levels over three mission tiers, on purpose. The old three chips
 * ("none" / "light" / "full") mapped one-to-one onto `PREP_TAG_IDS`, which made
 * the code tidy and the QUESTION wrong: creators kept naming a step that was
 * not on it — "I'm not preparing anything, I'll just put the missions on real
 * spots". That effort is real, it is strictly less than preparing props, and it
 * was being collected somewhere else entirely (a yes/no chip inside the "where
 * does it happen" question), so the creator was asked about their own effort
 * twice, on two scales, and neither admitted the middle.
 *
 * Each level includes everything below it:
 *   1  nothing at all
 *   2  + pin the missions to real spots on the map
 *   3  + prepare things at home
 *   4  + go to the site beforehand and set up there
 *   5  + coordinate with an outside party
 *
 * A NUMBER rather than five string ids because both readings below —
 * `prepToleranceOf` and `prepWantsPlacedMissions` — are monotone functions of
 * it. With ids each would be a lookup table, and two tables can disagree about
 * the ordering; here they cannot. It also makes "coerce anything into range" a
 * single clamp, which is what keeps the questionnaire's reducer total.
 */
export const PREP_SCALE = [1, 2, 3, 4, 5] as const;
export type PrepLevel = typeof PREP_SCALE[number];

/** The level a malformed answer behaves as. Never the top — see `prepToleranceOf`. */
const PREP_FALLBACK_LEVEL: PrepLevel = 3;

/**
 * How much work this mission asks of the creator before the game.
 *
 * Reads the HIGHEST tier the mission carries, so a mission tagged both
 * `needsSetup` and `needsPartner` costs what the partner costs. An untagged
 * mission is treated as free — the honest default, since the bank's own test
 * requires every entry to declare a prep tag.
 */
export function prepTierOf(tags: readonly string[] | undefined): number {
  if (!Array.isArray(tags)) return 0;
  let tier = 0;
  for (let i = 0; i < PREP_TAG_IDS.length; i++) {
    if (tags.includes(PREP_TAG_IDS[i])) tier = Math.max(tier, i);
  }
  return tier;
}

/** The rating, coerced into 1-5. Total — anything else becomes the fallback. */
export function prepLevelOf(level: unknown): PrepLevel {
  return (PREP_SCALE as readonly number[]).includes(level as number)
    ? (level as PrepLevel)
    // An unknown answer never inherits the top level: coordinating with an
    // outside party has to be chosen on purpose, never arrived at by accident.
    : PREP_FALLBACK_LEVEL;
}

/**
 * How much prep this answer tolerates, as an index into PREP_TAG_IDS.
 *
 * The five levels collapse onto three mission tiers — 1,2 → free · 3,4 →
 * self-prep · 5 → outside partner — because the BANK has three tiers and this
 * change did not re-tag it. Levels 3 and 4 therefore admit exactly the same
 * missions; 4 differs only in `wantsPlacedMissions` and in a scoring nudge
 * toward missions pinned to real spots. Do not "fix" that by inventing a fourth
 * tier here: a tier no mission carries would silently shrink the pool to nothing.
 */
export function prepToleranceOf(level: unknown): number {
  const l = prepLevelOf(level);
  if (l >= 5) return 2;
  if (l >= 3) return 1;
  return 0;
}

/**
 * Does this answer mean "put the missions on real spots"?
 *
 * Level 2 is exactly that answer and nothing else, which is the whole reason the
 * scale has five points. A malformed value reads as FALSE: pinning obliges the
 * creator to place every mission in Quick Setup, and a default must never impose
 * work nobody asked for.
 */
export function prepWantsPlacedMissions(level: unknown): boolean {
  return (PREP_SCALE as readonly number[]).includes(level as number) && (level as number) >= 2;
}

export const AREA_KIND_TAG_IDS = [
  'forest', 'beach', 'park', 'neighborhood', 'cityCenter', 'home', 'mall', 'office', 'school',
] as const;

/**
 * A QUALITY of the place, orthogonal to its kind — offered in the same "where
 * does it happen" question (one flat list of chips, not a second question), but
 * carrying no indoor/outdoor signal of its own. Purely a fit signal: a mission
 * built around strangers wants `crowded` regardless of whether that crowd is in
 * a mall or a city square.
 */
export const AREA_QUALITY_TAG_IDS = ['crowded', 'historic'] as const;

export const AREA_TAG_IDS = [...AREA_KIND_TAG_IDS, ...AREA_QUALITY_TAG_IDS] as const;
export type AreaTagId = typeof AREA_TAG_IDS[number];

/**
 * Whether each area is out in the open or under a roof.
 *
 * This is what lets the questionnaire ask about PLACES instead of asking twice.
 * A creator who says "mall" has already told us the game is indoors; making them
 * answer a separate indoor/outdoor question was asking them to restate what they
 * just said, and it let them contradict themselves ("outdoor" + "office").
 */
export type AreaKindTagId = typeof AREA_KIND_TAG_IDS[number];

export const AREA_SETTING: Record<AreaKindTagId, 'indoor' | 'outdoor'> = {
  forest: 'outdoor',
  beach: 'outdoor',
  park: 'outdoor',
  neighborhood: 'outdoor',
  cityCenter: 'outdoor',
  home: 'indoor',
  mall: 'indoor',
  office: 'indoor',
  school: 'indoor',
};

/**
 * The setting implied by the places a creator picked.
 *
 * No places at all means no venue — the honest reading of "I did not name
 * anywhere this happens". Any open-air place makes it an outdoor game, because a
 * game spanning a park and a mall is walked between, not sat in.
 */
export function settingForAreas(areas: readonly AreaTagId[]): SettingTagId {
  if (!Array.isArray(areas)) return 'fromAnywhere';
  // Only KIND-of-place ids count here, which `AREA_SETTING` already enforces by
  // only having entries for them — a quality like `crowded` or `historic` never
  // reaches this filter, because it was never in `AREA_SETTING` to begin with.
  // That is deliberate, not an oversight: those describe ANY kind of place, so
  // "the creator only said crowded" carries no indoor/outdoor signal — it must
  // fall through to `fromAnywhere` below, same as naming nothing at all. An
  // unrecognised id is excluded for the same reason junk would otherwise be:
  // treating it as a real place would quietly turn on location-based missions
  // for a creator who never actually named a venue.
  const known = areas.filter(
    (a): a is AreaKindTagId => Object.prototype.hasOwnProperty.call(AREA_SETTING, a as string));
  if (known.length === 0) return 'fromAnywhere';
  return known.some((a) => AREA_SETTING[a] === 'outdoor') ? 'outdoor' : 'indoor';
}
