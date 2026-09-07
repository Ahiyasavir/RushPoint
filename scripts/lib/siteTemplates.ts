// The site's ready-made game templates — the "guided" path's whole content
// (change: site-templates, 2026-09-02).
//
// ─── Why this file exists ────────────────────────────────────────────────────
//
// The marketing site sells seven occasions (chinuch, pe-ilut-babayit,
// gibush-tzevet, yom-huledet, bar-mitzva, hatuna, tnuat-noar) and production was
// serving TWO templates, both for youth. A teacher landing on the education page
// and tapping through got a teenage street race. The rest of the collection was
// five empty or tombstoned "תבנית חדשה" rows.
//
// Worse, the one surviving missions template had drifted away from the doctrine
// it seeded: it still shipped `קולה` (needs a stranger to be holding one right
// now — rule 31) and `השאלה הכי מורכבת בעולם` (the creator must source and
// answer an olympiad problem — rule 30), both cut from the bank since, plus the
// two closing surveys the bank header says were deliberately left out.
//
// ─── Composed FROM the bank, never re-typed ──────────────────────────────────
//
// A template here is a list of BANK KEYS in a stage shape. Nothing restates a
// mission's title, description, answers or verification, so:
//
//   • every template inherits the owner's own curation pass automatically — the
//     copy he shortened, the tags he fixed, the missions he deleted;
//   • a mission cut from the bank makes the template that names it FAIL LOUD
//     (scripts/test-site-templates.ts) instead of quietly living on in Firestore
//     for another year, which is exactly how `קולה` survived;
//   • Quick Setup is derived from each entry's own `setup[]`, so a template can
//     never ask a creator for a field the mission does not have.
//
// The cost is real and accepted: a template cannot tweak one word of a mission.
// If a mission needs different words for a classroom, that is a NEW bank entry
// with its own key, judged by the same forty-plus rules — not a private edit
// hidden inside a template.
//
// ─── Ids are deterministic ───────────────────────────────────────────────────
//
// Stage and task ids are derived from the template key and position, so
// re-seeding UPDATES a template rather than minting a parallel copy, and a
// `TemplateWizardStep` keeps pointing at the mission it was written for. This is
// the one place ids are not random: `build()` mints a fresh uuid per call, which
// is right for a composed game and wrong for a document seeded over and over.
import type { Game, Stage, Task, TemplateWizardStep } from '@rushpoint/shared';
import { TASK_BANK, type TaskBankEntry } from '../../apps/creator-web/src/taskBank';

export interface SiteTemplateStage {
  /** Player-facing stage title. */
  title: string;
  /** Bank keys, in the order players meet them. */
  keys: string[];
  /**
   * How many of this stage's missions each team must finish. Absent means all.
   *
   * Exists for the events whose research demands LAYERS rather than a single
   * track — a bar mitzvah is twelve year olds, their parents and their
   * grandparents in one room, and the planning literature is unanimous that one
   * activity cannot serve them. Offering five and requiring three lets each team
   * take the three that suit it, which is the closest this platform gets to
   * parallel programming.
   */
  requiredCount?: number;
}

export interface SiteTemplateDecl {
  /** Stable — the seed upserts on it, and ids derive from it. */
  key: string;
  title: string;
  description: string;
  emoji: string;
  /** `missions` or `story` — what the new-game wizard filters on. */
  genre: 'missions' | 'story';
  /** Menu order, low first. */
  order: number;
  mode: 'team' | 'individual';
  scoringPreset: 'time_only' | 'fixed_points_speed' | 'smart_weighted';
  /**
   * Under-14 players need a guardian's approval and the platform enforces it, so
   * a template written for a classroom or a children's party declares it rather
   * than leaving a teacher to discover the setting exists.
   */
  requiresGuardianConsent?: boolean;
  /**
   * The session this template is written for, in minutes, as [min, max].
   *
   * Declared rather than derived, because it is a CLAIM about the event — a
   * lesson is 45 minutes whatever the missions add up to — and
   * scripts/test-site-templates.ts holds the mission list to it. Summed from
   * `estimatedMinutes`, which is measured from assignment and therefore includes
   * the walking; `expectedDurationMinutes` is interaction time only and would
   * report a 45 minute lesson as 17 minutes of game.
   */
  sessionMinutes: [number, number];
  /**
   * Seed this template PARKED: authored, owned, editable in the admin builder,
   * and not offered to creators (change: template-visibility).
   *
   * This is the workflow the visibility feature was actually built for. Three
   * templates were deferred on 2026-09-02 rather than shipped half-finished,
   * because there was nowhere to put a work in progress — the only lever was
   * `isTemplate: false`, which also removed them from the admin's own list.
   * A declaration can now be seeded early and finished in place.
   *
   * Absent means visible, matching the field it writes.
   */
  hidden?: boolean;
  stages: SiteTemplateStage[];
}

const byKey = new Map(TASK_BANK.map((e) => [e.key, e]));

/** Every bank key a declaration names that the bank does not have. */
export function missingKeys(decl: SiteTemplateDecl): string[] {
  return decl.stages.flatMap((s) => s.keys).filter((k) => !byKey.has(k));
}

export const stageId = (decl: SiteTemplateDecl, i: number) => `${decl.key}-s${i + 1}`;
export const taskId = (decl: SiteTemplateDecl, i: number, j: number) => `${decl.key}-s${i + 1}-t${j + 1}`;

export interface BuiltSiteTemplate {
  decl: SiteTemplateDecl;
  stages: Stage[];
  wizardSteps: TemplateWizardStep[];
  /** Convenience for the seed and the tests. */
  game: Pick<Game, 'title' | 'description' | 'mode' | 'scoringPreset' | 'stages' | 'wizardSteps'>;
}

/**
 * Resolve a declaration into real stages, tasks and Quick Setup steps.
 *
 * Throws on an unknown bank key — deliberately, and the only throw in this file.
 * A template naming a mission that no longer exists is a BUILD-time defect with
 * one correct outcome (fix the declaration); making it total here would hand the
 * seed a silently shorter game.
 */
export function buildSiteTemplate(decl: SiteTemplateDecl): BuiltSiteTemplate {
  const missing = missingKeys(decl);
  if (missing.length) {
    throw new Error(`site template "${decl.key}" names missions the bank does not have: ${missing.join(', ')}`);
  }

  const wizardSteps: TemplateWizardStep[] = [];
  const stages: Stage[] = decl.stages.map((s, i) => {
    const tasks: Task[] = s.keys.map((k, j) => {
      const entry = byKey.get(k) as TaskBankEntry;
      const task: Task = { ...entry.build(), id: taskId(decl, i, j) };
      for (const step of entry.setup ?? []) {
        wizardSteps.push({
          id: `${taskId(decl, i, j)}-${step.field.replace(/[^a-zA-Z0-9]+/g, '-')}`,
          stageId: stageId(decl, i),
          taskId: taskId(decl, i, j),
          targetFieldPath: step.field,
          instructionPrompt: step.prompt,
          isRequired: step.required === true,
        });
      }
      return task;
    });
    return {
      id: stageId(decl, i),
      order: i,
      title: s.title,
      tasks,
      // Only when it actually narrows the stage: `requiredTaskCount` equal to
      // the mission count is the same as absent, and writing it anyway would put
      // a number in the Builder that looks like a decision somebody made.
      ...(typeof s.requiredCount === 'number' && s.requiredCount < tasks.length
        ? { requiredTaskCount: s.requiredCount } : {}),
      ...(i === decl.stages.length - 1 ? { isFinal: true } : {}),
    };
  });

  return {
    decl,
    stages,
    wizardSteps,
    game: {
      title: decl.title,
      description: decl.description,
      mode: decl.mode,
      scoringPreset: decl.scoringPreset,
      stages,
      wizardSteps,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The templates
// ═══════════════════════════════════════════════════════════════════════════
//
// Selection rule, applied to all five: take the missions that survive the
// bank's own hardest tests — rule 33 (a job for every member), rule 34
// (provocation, not a quiz on the room), rule 40 (the team knows it is right
// before it submits) — and put the strongest one LAST, because the ending is
// what gets remembered.

export const SITE_TEMPLATES: SiteTemplateDecl[] = [
  // ── Education ─────────────────────────────────────────────────────────────
  //
  // Rebuilt after the research pass killed the first draft, which opened a
  // classroom game with three missions that need the teacher to hide, place or
  // survey something in advance (`sign-cipher`, `kims-game`, `chalk-code`).
  // Three findings, all pointing the same way:
  //
  //   • A 45 minute period is already reported as too short for anything
  //     "involved", and about six minutes of every lesson is lost at the start.
  //   • Three quarters of teachers say they have no preparation time at all;
  //     adoption needs a short learning curve and a low setup cost.
  //   • Photographing students sits under school policy and parental consent.
  //
  // So: zero physical prep, no pin, and the answers are TYPED rather than
  // multiple choice — educational-escape-room research asks specifically that
  // the chance of solving by trial and error be minimal, and a four-option quiz
  // fails that. `thinking-room` is the peak because it is the one mission whose
  // clock stops, and a class that is arguing about a deduction is the lesson.
  {
    key: 'site-education',
    title: 'משחק משימות לכיתה',
    description:
      'מסלול משימות לשיעור אחד, בלי שום הכנה מראש ובלי לצאת מהכיתה. תקשורת בלי מילים, '
      + 'שלוש חידות עם תשובה מוקלדת, ורגע אחד שבו השעון נעצר והכיתה חייבת להתווכח.',
    emoji: '🎓',
    genre: 'missions',
    order: 10,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    requiresGuardianConsent: true,
    // One 45 minute period, with the six minutes every lesson loses at the start.
    sessionMinutes: [40, 55],
    stages: [
      { title: 'מתחילים', keys: ['open-team-pact'] },
      { title: 'לדבר בלי לדבר', keys: ['silent-briefing', 'blind-describe'] },
      { title: 'חשיבה', keys: ['disarm-the-device', 'vault-combination-riddle', 'invention-order'] },
      { title: 'השעון נעצר', keys: ['thinking-room'] },
      { title: 'סיכום', keys: ['finish-what-we-didnt-know'] },
    ],
  },

  // ── Family evening at home ────────────────────────────────────────────────
  //
  // The landing page's hard constraint is "inside the house, without going out
  // and without equipment", so every key is `fromAnywhere` + `home` + `noPrep`.
  //
  // The shape comes from age-mixed play research: there is no pride in an older
  // child beating a younger one, so this is one cooperative team rather than a
  // race between siblings, and the missions deliberately reward DIFFERENT skills
  // — one creative, one spatial, one verbal, one physical — so every age has a
  // moment where they are the best in the room.
  //
  // `family-photo-remake` sits in the middle as the emotional peak, because a
  // session is remembered by its best moment and its last one.
  {
    key: 'site-family-home',
    title: 'ערב משפחתי בבית',
    description:
      'מסלול משימות שרץ בתוך הבית, בלי לצאת ובלי ציוד. כולם קבוצה אחת, לא מרוץ בין '
      + 'אחים, וכל משימה נותנת לגיל אחר להיות הכי טוב בחדר.',
    emoji: '🏠',
    genre: 'missions',
    order: 20,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    requiresGuardianConsent: true,
    // A family evening: long enough to be an event, short enough to finish.
    sessionMinutes: [40, 65],
    stages: [
      { title: 'מתחממים', keys: ['height-line-up', 'one-colour-five-things'] },
      { title: 'הבית נראה אחרת', keys: ['family-photo-remake', 'forced-perspective'] },
      { title: 'ביחד', keys: ['blind-describe', 'living-room-obstacle'] },
      { title: 'סיום', keys: ['finish-the-credits'] },
    ],
  },

  // ── Help at home ──────────────────────────────────────────────────────────
  //
  // The motivation research is unusually clear here, and it cuts both ways.
  // Rewards REDUCE intrinsic motivation for something a child already enjoys and
  // INCREASE it for something they do not — cleaning a room is the textbook
  // example of the second — so gamifying housework is on firm ground. But the
  // same literature says a reward attached to a small DAILY duty backfires,
  // because it teaches a child to expect payment for the baseline.
  //
  // That is why `chore-table-set` is not here: setting the table is listed in
  // every age-appropriate chore chart as a standard 5-7 year old daily job. What
  // stayed is the non-routine work — the drawer nobody opens, the fridge shelf,
  // a round of every bin in the house.
  //
  // Ordered up the age ladder rather than by difficulty, so a parent running it
  // for a five year old simply stops after stage two.
  {
    key: 'site-help-at-home',
    title: 'עזרה בבית',
    description:
      'מסלול משימות שבסופו הבית באמת מסודר יותר, ורק עבודה שהיא לא המטלה היומית '
      + 'הרגילה. כל משימה נגמרת בסימן ברור: אף אחד לא נשכח, לא נשאר כלום על השיש.',
    emoji: '🧺',
    genre: 'missions',
    order: 30,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    // Real work, so the ceiling is higher and stage two is a fine place to stop.
    sessionMinutes: [45, 75],
    stages: [
      { title: 'מתחילים', keys: ['open-team-pact', 'chore-sock-pairs'] },
      { title: 'סבב הבית', keys: ['chore-ten-things', 'chore-bin-round'] },
      { title: 'צריך להחליט', keys: ['chore-fridge-audit'] },
      { title: 'הגדולה', keys: ['chore-the-drawer'] },
      { title: 'סיום', keys: ['finish-what-we-didnt-know'] },
    ],
  },

  // ── Corporate team building ───────────────────────────────────────────────
  //
  // Five stages with the twist in the middle: what the landing page sells, and
  // what `occasions.ts`'s teamBuilding blueprint already shapes (difficulty
  // curve 3, 5, 7, 6, 9).
  //
  // The research says the commonest reason a team-building day fails is a lack
  // of clear objective — activity disconnected from a real challenge, and people
  // disengage. It also says communication exercises beat one-off physical ones,
  // that trust matters more than competence, and that roughly half of employees
  // experience "forced fun" as uncomfortable, with the analytical and the
  // introverted dropping out first.
  //
  // So the spine is the bank's only un-quarterbackable trio — split information
  // (`silent-briefing`), consensus as the gate (`team-decision-drill`), one
  // person who cannot see (`blind-describe`) — and the twist is `thinking-room`,
  // the only mission whose clock stops. On a day sold as "the difficulty is the
  // point", the moment a group has to actually argue is the change of rhythm
  // nothing else here provides.
  {
    key: 'site-team-building',
    title: 'יום גיבוש לצוות',
    description:
      'חמישה שלבים עם תפנית באמצע. משימות שאי אפשר לפתור לבד: מידע מפוצל, החלטות '
      + 'פה אחד, ואחד שלא רואה. הניקוד אובייקטיבי, בלי שופטים.',
    emoji: '🏢',
    genre: 'missions',
    order: 40,
    mode: 'team',
    scoringPreset: 'smart_weighted',
    // Ninety minutes is the researched sweet spot for a team hunt.
    sessionMinutes: [75, 110],
    stages: [
      { title: 'מתחילים', keys: ['open-team-pact'] },
      { title: 'לתאם', keys: ['silent-briefing', 'team-decision-drill'] },
      { title: 'התפנית', keys: ['thinking-room', 'puzzle-code'] },
      { title: 'בשטח', keys: ['corporate-landmark-navigate', 'blind-describe', 'teach-a-stranger'] },
      // The climax and then the debrief, in that order. Experiential-learning
      // research is blunt about this: learning happens in the REFLECTION on the
      // doing, not in the doing, and an activity without a debrief leaves people
      // unsure what it was for. Peak-end still holds — the peak is
      // `finish-all-or-nothing` — but the last thing a team does on a day sold as
      // team building should be saying something true about each other.
      { title: 'סיום', keys: ['trade-up', 'finish-all-or-nothing', 'finish-what-we-didnt-know'] },
    ],
  },

  // ── Birthday ──────────────────────────────────────────────────────────────
  //
  // Party-planning research is specific: games should fill 30-50% of the party,
  // three to five of them for a two hour party, and a single activity holds
  // attention for about ten minutes. The recommended running order is warm-up,
  // main event, high energy, sit-down — which is what the three stages below
  // are, on the gentle 2-4-6 curve the birthday blueprint already uses, because
  // a party that gets genuinely hard stops being a party.
  //
  // The celebrant is the subject of three of the seven missions and the game
  // ends on the wish, so it finishes pointed at the person it is for rather than
  // at a scoreboard.
  {
    key: 'site-birthday',
    title: 'יום הולדת',
    description:
      'מסלול משימות ליום הולדת, בבית או בשכונה. מתחילים בקלות, אתגר אחד באמצע, '
      + 'ומסיימים באיחול שכולם קוראים ביחד מול המצלמה.',
    emoji: '🎂',
    genre: 'missions',
    order: 50,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    requiresGuardianConsent: true,
    // Games fill 30-50% of a two hour party.
    sessionMinutes: [35, 60],
    stages: [
      { title: 'חימום', keys: ['height-line-up', 'count-the-candles', 'backwards-name'] },
      { title: 'האירוע המרכזי', keys: ['mystery-gift', 'everyone-hidden', 'statue-remake', 'celebrants-favorites-ranking'] },
      { title: 'סיום', keys: ['birthday-wish'] },
    ],
  },

  // ── Bar / bat mitzvah ─────────────────────────────────────────────────────
  //
  // The planning literature describes one room holding twelve and thirteen year
  // olds, their parents and their grandparents, and says the same thing every
  // time: you need LAYERS of activity, not one. A single track pitched at the
  // teenagers bores the adults and one pitched at the adults loses the teenagers.
  //
  // So the middle stage offers five and requires three. Each team takes the ones
  // that suit whoever is in it, and no group is marched through a mission written
  // for somebody else. Everything here is playable standing, in clothes people
  // are dressed up in, with no running and nothing on the floor.
  {
    key: 'site-bar-mitzvah',
    title: 'בר ובת מצווה',
    description:
      'מסלול משימות לאירוע שיש בו גם בני שלוש עשרה וגם סבתות. השלב האמצעי מציע '
      + 'חמש משימות וכל קבוצה בוחרת שלוש, כך שכל אחד מוצא את מה שמתאים לו.',
    emoji: '✡️',
    genre: 'missions',
    order: 60,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    requiresGuardianConsent: true,
    // Long enough to fill the part of the evening between courses.
    sessionMinutes: [35, 70],
    stages: [
      { title: 'מתחילים', keys: ['height-line-up'] },
      {
        title: 'בוחרים שלוש',
        keys: ['family-photo-remake', 'two-truths-one-lie', 'forced-perspective',
          'one-colour-five-things', 'blind-describe'],
        requiredCount: 3,
      },
      { title: 'סיום', keys: ['finish-what-we-didnt-know'] },
    ],
  },

  // ── Wedding ───────────────────────────────────────────────────────────────
  //
  // The slot this actually fills is the cocktail hour, while the couple is off
  // being photographed and the guests are standing around with a drink and
  // nothing to do. Every wedding-planning source names that gap, and the advice
  // is consistent: skip the lawn games nobody touches after five minutes and give
  // people something interactive that produces pictures.
  //
  // The recurring warning is that NO GUEST MAY BE EMBARRASSED, which normally
  // rules out this bank's stranger missions. A wedding inverts that: everyone in
  // the room is an invited guest, so "go and talk to somebody you do not know" is
  // the lowest-risk version of that mission there is, and it does the thing a
  // wedding is actually for.
  //
  // Short on purpose. Guests are eating, drinking and being called for photos.
  {
    key: 'site-wedding',
    title: 'חתונה',
    description:
      'מסלול קצר לשעת הקוקטייל, בזמן שהזוג מצטלם והאורחים מחכים. הכול בעמידה, '
      + 'בלי לרוץ ובלי להביך אף אחד, ובסוף יש לכם תמונות שאף צלם לא היה מצלם.',
    emoji: '💍',
    genre: 'missions',
    order: 70,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    sessionMinutes: [30, 60],
    stages: [
      { title: 'מתחילים', keys: ['height-line-up'] },
      { title: 'מסתובבים', keys: ['two-truths-one-lie', 'teach-a-stranger', 'honest-compliment'] },
      { title: 'תמונה אחת אחרונה', keys: ['forced-perspective', 'finish-the-credits'] },
    ],
  },

  // ── Youth movement ────────────────────────────────────────────────────────
  //
  // Not another youth race. A `פעולה` has a canonical shape that every madrich
  // is trained in, and the templates were ignoring it entirely:
  //
  //   • the SETTING and opening — a strong stimulus that breaks the ordinary and
  //     creates curiosity, before anybody is told what the subject is;
  //   • the BODY — the process the chanichim go through, holding a peak or
  //     several;
  //   • the SUMMARY — what was achieved, what happened in the group, and how it
  //     connects to what the group does next week.
  //
  // The three stages below are exactly that, and the summary is a real reflection
  // mission rather than a scoreboard, because a peula that ends on points has
  // skipped the part it exists for.
  {
    key: 'site-youth-movement',
    title: 'פעולה לתנועת נוער',
    description:
      'פעולה במבנה מלא: פתיחה שמייצרת סקרנות, גוף עם שיא אמיתי, וסיכום שבו '
      + 'החניכים אומרים מה קרה בקבוצה. בנוי למדריך שמגיע בלי הכנה.',
    emoji: '🔥',
    genre: 'missions',
    order: 80,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    requiresGuardianConsent: true,
    // A weekly peula, plus the time it takes to gather everybody.
    sessionMinutes: [45, 80],
    stages: [
      { title: 'פתיחה', keys: ['open-one-take-intro'] },
      { title: 'גוף הפעולה', keys: ['silent-briefing', 'human-letter', 'blind-describe', 'drift-three-turns'] },
      { title: 'השיא', keys: ['thinking-room'] },
      { title: 'סיכום', keys: ['finish-what-we-didnt-know'] },
    ],
  },
];
