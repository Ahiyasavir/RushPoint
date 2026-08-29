// The tagged mission bank the smart composer draws from
// (change: smart-game-composer).
//
// ─── Where this content comes from ───────────────────────────────────────────
//
// Harvested from the ACTIVE production templates — the ones really flagged
// `isTemplate: true` and served by listGameTemplates — not from the legacy
// quick-start set that used to live in templates.ts. At harvest time there were
// exactly two active templates:
//
//   משחק לנוער        Xu8qa3rm7vEguj7lD2gR   genre: missions   4 stages, 15 tasks
//   משחק עלילה לנוער   H4Bp3sK5DmxK0VPibtuT   genre: story      6 stages, 17 tasks
//
// Only the FIRST is harvested. The composer builds games with no plot, so a
// mission written to carry a story beat would arrive stripped of the thing that
// made it make sense. The story template belongs to the story path.
//
// ─── Why this is a POOL, not a view over templates ───────────────────────────
//
// The obvious shortcut is to read the templates live and flatten them. It does
// not work: every rule this feature depends on is keyed on mission identity — no
// mission twice in one game, the per-creator recency memory, the tests — and a
// mission re-read from a document is a different object every time. So each entry
// carries a STABLE `key` that is the identity everything else keys on, and the
// content is a literal here. Re-harvest with `node --import tsx
// scripts/dump-task-bank.ts` against a fresh export when the active templates
// change; the keys are what make that a diff rather than a reset.
//
// ─── What is deliberately NOT carried over ───────────────────────────────────
//
//   • Stage narrative (`narrative.intro/outro`) — the bank is a flat mission
//     pool; composing stages is composeGame.ts's job.
//   • `media` — an uploaded object lives under `gameMedia/{ownerUid}/games/{gameId}/`,
//     so a mission that carried the template's media URL would point every
//     composed game at the TEMPLATE's storage folder. That renders fine right up
//     until the source game is purged, at which point `purgeGameTree` prefix
//     deletes the folder and the picture breaks in every game that ever copied
//     it — the footgun CLAUDE.md documents under `rehostGameMedia`. The three
//     missions built around "look at the attached photo" therefore ask the
//     creator for their OWN image through Quick Setup instead.
//   • The two closing feedback surveys ("חוויות", "ספרו לנו עוד"). They collect
//     opinions after the game rather than being played, the platform already has
//     a post-game survey of its own, and as bank entries they would compete for
//     real mission slots. Left out on purpose, not missed.
//
// ─── Two duplications, both deliberate, both pinned by tests ─────────────────
//
//   • `difficulty` repeats the built mission's own difficulty, so scoring can
//     read it without calling build() per candidate per slot (which would mint
//     and discard a uuid every time). scripts/test-task-bank.ts asserts the two
//     always agree.
//   • `setup` hangs off the mission itself, because the composer knows the id the
//     moment it mints it and needs no positional resolution step.
// ═════════════════════════════════════════════════════════════════════════════
// HOW TO WRITE A MISSION — read this before adding one
// ═════════════════════════════════════════════════════════════════════════════
//
// This section replaces the old templates.ts authoring notes. Those described a
// TEMPLATE: a fixed, hand-ordered game where a weak mission was carried by the
// ones around it and by its stage's narrative. A bank entry has none of that
// support. The composer may drop it into any game, any stage, next to any other
// mission, for any audience that matches its tags — so each one has to stand up
// alone. Everything below was learned by having real missions rejected; each
// rule names the mission that produced it, because the example is the argument.
//
// ─── 1. Adult-credible by default ────────────────────────────────────────────
//
// The failure mode this bank keeps hitting is the summer-camp reflex: battle
// cries, human pyramids, mimicking animals, miming a machine, mirroring a
// partner, passing a silly sentence down a line. These are drama-class warm-ups.
// They are fun to WRITE and they are the first thing that comes to mind, which
// is exactly why they keep appearing — and they were rejected every time:
// "שם וקריאת קרב", "הפודיום", "השרשרת השקטה", "עשרים צעדים עיוורים",
// "המכונה האנושית", "מצעד החיות", "שלושה בשרשרת".
//
// THE TEST: would a thirty year old do this, in public, in front of strangers,
// without cringing? If not, it is not a mixed-audience mission.
//
// Two honest ways out, and rewriting is usually the better one:
//   • REWRITE so the same mechanic has an adult reason to exist. "Mime a
//     machine" became "build a real chain reaction" — same teamwork, but now it
//     is a small engineering problem with a result you can point at.
//   • NARROW the audience and keep it. "שלושה בשרשרת" is a fine kids' mission;
//     it was tagged for corporate too, which was the actual error. Note that
//     `kids` here starts at TEN, not five: "magic word", "say please" and
//     animal noises are below the floor even for the youngest band.
//
// ─── 2. The copy is an instruction, not a bit ────────────────────────────────
//
// "הפודיום" was rejected for reading weird, and the weirdness was the joke: it
// told players to build a pyramid and added "we recommend not fighting about who
// stands on top for more than a minute." A player skims a mission on a phone
// while walking. Give them: what to do, the one constraint, what to submit. A
// mission that has to be funny is usually compensating for being thin.
//
// ─── 3. Name the real thing ──────────────────────────────────────────────────
//
// "מגדל מהשטח" — build the tallest tower from found materials — became "רוג׳ום":
// a cairn. Same act, but a cairn is a real practice with a real name, a real
// place (a trail, a forest) and a real purpose (marking a route). Generic
// framing produces generic missions. Reach for the specific noun, the real
// custom, the actual object.
//
// ─── 4. The constraint IS the mission ────────────────────────────────────────
//
// Every strong mission here is one rule that removes the easy path:
//   • "חמישה דברים, צבע אחד" — not black, not white. Both are everywhere, so
//     allowing them removed the search entirely.
//   • "סחר חליפין" — you must accept EVERY offer made to you, and the target is
//     a specific object (a marker pen). It replaced "trade for something worth
//     more", which is subjective, unjudgeable and easy to stall on.
//   • The trivia missions — no searching; if you do not know it, ask people
//     until someone does. Without that rule a quiz in a FIELD game is three
//     seconds of typing, and could have been played on the sofa.
// Before shipping a mission, ask what the laziest possible completion looks
// like. If it is boring, the constraint is missing.
//
// ─── 5. One unambiguous finish ───────────────────────────────────────────────
//
// "Trade up to something better" has no end. "Trade until someone hands you a
// marker pen" does. A team must always know whether they are done, without
// asking staff.
//
// ─── 6. Creator prep is a feature, not a cost ────────────────────────────────
//
// "עשרים צעדים עיוורים" was rejected as a camp trust-fall and rebuilt as
// "המפתח החבוי": the creator hides a real key that unlocks a real thing. Prep is
// what separates a designed game from an improvised one — the strongest missions
// in this bank (the vendor codes, the hidden key, the planted odd-one-out) all
// require someone to physically set something up beforehand.
//
// The cost of prep is not the prep; it is a mission that SILENTLY assumes it.
// So: tag `needsSetup`, and add a Quick Setup step for every single thing the
// creator must do or decide. Nothing implicit.
//
// ─── 7. If a shared object is used, it goes back ─────────────────────────────
//
// Teams play the same course one after another. "המפתח החבוי" ends by telling
// the team to return the key exactly where they found it, because the next team
// needs it. Any mission touching a placed object needs that sentence.
//
// ─── 8. Never leave a place-dependent answer to the players ──────────────────
//
// "כמה צעדים" originally said: pick two points you can both see, guess the
// distance, then walk it. Self-directed, so a team could pick two points two
// hundred metres apart and the premise collapsed. Now the creator pins the end
// point, names the start landmark, and walks it ONCE beforehand to record the
// real count.
//
// RULE: if the correct answer depends on the specific place, the creator must
// survey that place and enter the answer. This is the single most common way a
// numeric or counting mission ships broken — and it hides well, because the
// mission reads fine until someone actually plays it.
//
// ─── 9. Close the app's own loopholes ────────────────────────────────────────
//
// "ניווט אנושי" asks a team to reach a point without a navigation app — while
// the app drew a pin on their map. One tap defeated the entire mission. It now
// sets `hideLocation`, and the creator writes the ADDRESS as the location clue:
// the map shows no pin, so finding it means asking people and reading signs.
// If a mission's challenge is X, check the product does not hand players X.
//
// ─── 10. Frame rules as actions ──────────────────────────────────────────────
//
// "אל תיקחו דברים שאינם שלכם" became "אם חסר לכם חפץ, אפשר לבקש בהשאלה מאנשים
// בסביבה". Same boundary, but the first is a warning and the second is a move
// the team can make. Prohibitions shrink a mission; permissions open it.
//
// ─── 11. Delete padding ──────────────────────────────────────────────────────
//
// "רגע של אוויר" — sit down, drink water, tell us how it is going — was cut
// rather than rescued, even though it left the `survey` mission type with no
// representative at all. A mission that asks nothing of the players is not a
// mission, and keeping one to make a coverage statistic look complete is the
// worst reason to keep anything.
//
// ─── 12. Near-duplicates get a `family` ──────────────────────────────────────
//
// "ציד הקשת" and "חמישה דברים, צבע אחד" are one mission wearing two skins. Both
// can stay, but a single game must never show both, which is what `family` is
// for (see the field's own note, and composeGame.ts's `usedFamilies`). When
// adding a mission, look for the one it resembles and group them.
//
// ─── 13. Tag what is true, not what is flattering ────────────────────────────
//
// Tags are how the composer matches a mission to a real event, so an aspirational
// tag is a mission landing where it does not belong. `mixed` in particular is not
// a default — it is a claim that this genuinely suits everyone from ten year olds
// to a corporate offsite, and it is usually false. Same for `noPrep`: if a
// creator has to arrange, hide, buy or pre-walk anything, it is `needsSetup`.
//
// ═════════════════════════════════════════════════════════════════════════════
// RULES 14+ — added after a full curation pass (2026-08-26) drafted 18 candidate
// missions from public scavenger-hunt/team-building sources and had most of them
// sent back. Every rule below names the draft that produced it, same as 1-13.
// The pattern across almost all of them: a mission was designed to a MECHANIC
// ("a memory game", "an anagram", "a combination lock") before its actual,
// checkable, schema-real content existed — so read 14-17 as one family (verify
// the thing is buildable and complete) before reading the rest.
// ═════════════════════════════════════════════════════════════════════════════
//
// ─── 14. Verification must match what the type can actually check — never
//         assume a live human is watching ─────────────────────────────────────
//
// A bank mission is `autoApprove`: nothing adjudicates it mid-play. The first
// draft of "החדר שהשתנה" (memory vault) needed an adult to swap an object at
// exactly the moment the team looked away — a real-time facilitator action no
// field in this schema declares or triggers. "איפה הכדור" (shell game) had the
// same disease from the other side: whoever shuffles the cups controls the
// "answer," so there is nothing for the app to check.
//
// Two honest fixes, not a third option:
//   • Move the trick to ADVANCE, STATIC creator prep with a real, committed
//     answer — memory vault's fix: the creator photographs a "before" state,
//     attaches it via `ATTACH_PHOTO`, changes one item, and the team compares the
//     photo to the real scene now in front of them. Same trick
//     `youth-find-place-one` already uses; nothing new to build.
//   • Accept it as fully honesty-based, like `do-someone-a-favour` already is in
//     this bank, and say so — back it with a video for the only accountability
//     an honesty mission can have (shell game's fix).
// What never survives: quietly requiring a human to do something in real time
// that no field in the mission declares.
//
// ─── 15. A mechanic label is not a mission — ship the real content ───────────
//
// "An anagram tied to the spot" and "three clues eliminate an answer" were both
// genres, not missions: no word was ever actually scrambled, no clue was ever
// actually written. A mission is done when the Hebrew a player would read
// exists and could be typed into `answers`/`orderItems` today — not when its
// category has been named. (חידת ההיגיון never got there and was cut instead of
// invented on the spot; האותיות המעורבבות did, and shipped as three real,
// authored anagrams instead of one unwritten idea.)
//
// ─── 16. Don't design past what the schema does ──────────────────────────────
//
// "ניווט בהיסק" assumed clues could be revealed one at a time as the team
// progresses — this bank has exactly one `locationClue` string and one `hint`
// per mission, no staged reveal. Once the imaginary feature is subtracted, the
// mission collapses into `corporate-landmark-navigate` with different words.
// Check `TaskBankSetup`'s real fields and `QUICK_SETUP_FIELDS`
// (apps/creator-web/src/lib/quickSetup.ts) BEFORE designing the mechanic around
// them, not after — a mechanic invented against a feature that doesn't exist
// isn't a new mission, it's this problem waiting to be found in review.
//
// ─── 17. A constraint must cost something, not just exist ────────────────────
//
// "מבחן הטיסה"'s first draft passed if the paper airplane cleared the team's own
// arm-span — a bar nobody can fail, which made the "constraint" decorative (this
// is rule 4 again, sharpened with a concrete test). The fix ties pass/fail to
// something the team does not get to set for free: a fixed shoe-length count
// they must clear, the same discipline `waiter's race`'s fixed 20-step count
// uses. Before shipping any numeric or self-reported bar, ask what a team that
// does not care would do, and check that it actually fails.
//
// ─── 18. Materials the creator must bring are `needsSetup` — "no map pin" is
//         not "no prep" ──────────────────────────────────────────────────────
//
// Paper for the airplane trial, a tray and small object for the waiter's race, a
// wrapped gift, balloons and paper slips — none of these need a pin on the map,
// and all four were first tagged as if that made them free. `noPrep` means the
// creator does nothing at all before the game; if they must bring, wrap, wave,
// or pre-arrange a physical object, it is `needsSetup`, full stop, with a Quick
// Setup step naming exactly what to bring (rule 6 already says "a step for every
// single thing" — the miss here was treating "no location" as a stand-in for
// "no prep").
//
// ─── 19. Don't leave "which one is correct" for the players to guess ─────────
//
// "הודעת הבלון"'s first draft hid a code inside ONE balloon among many
// identical-looking ones, with no stated way to tell it apart. The real fix:
// every balloon of one chosen color carries the SAME code, so any one the team
// grabs is correct — no identification puzzle needed, and the creator's setup
// steps say so explicitly. Whenever a mission plants something among several
// look-alikes, either make every qualifying instance correct, or give an
// explicit rule for which one is (a mark, a position, a count) — never leave it
// implicit and hope the creator invents a fair rule on their own.
//
// ─── 20. Real and specific beats generic and "adaptable" ─────────────────────
//
// "ספירת האות"'s first draft ("count any repeating thing you pick") was more
// portable than the shipped version but worse: genericizing a good concrete idea
// into an abstract template threw away what made it memorable. The shipped
// version names one real, specific, recognizable device (an accessible
// pedestrian-crossing signal) and asks how many WORDS its announcement speaks —
// something a creator can point at, survey once, and hand to players with total
// confidence. Rule 3 ("name the real thing") already says this; the addition
// is: don't retreat toward "works at any venue" for its own sake. A mission that
// only fits venues with the right real feature is fine, same as rule 8 — the
// creator surveys it, same discipline `how-many-steps` already uses.
//
// ─── 21. A personal fact only has an ORDER if you ask for the right relation ──
//
// "ציר הזמן של החוגג/ת" first asked the creator to put the birthday child's
// favorite things in chronological order — favorite things aren't chronological,
// so there was never a real answer to author. The fix asks for a RANKING (most
// to least loved), a relation the creator — who actually knows the celebrant —
// can truthfully commit to. Before building an `orderItems` mission around
// someone's personal data, check that the ordering relation you're asking for is
// one an author can honestly declare, not one bent to fit the mechanic.
//
// ─── 22. State the physical byproduct as an instruction, not an afterthought ──
//
// Popping a balloon leaves rubber and confetti on the ground. The fix adds an
// explicit line the PLAYERS read — clean up after yourselves — inside the
// mission copy itself, not left to the creator's own judgment off-screen. Any
// mission with a physical byproduct (torn paper, popped balloons, chalk marks,
// borrowed objects — see rule 7 for the shared-object case) states what happens
// to it, in the instruction a player actually sees.
//
// ─── 23. Riddle and wordplay content needs an actual payoff ──────────────────
//
// An anagram is a mechanic; a good one's answer means something once you get
// there. The three shipped in this pass (פתרון / תגלית / הרפתקה) were each
// chosen because the solved word describes the act of playing itself — a free
// "aha" stacked on top of the mechanical difficulty, not just three arbitrary
// words that happened to fit a letter count. A technically-valid puzzle with a
// meaningless answer is padding wearing a costume (rule 11).
//
// ─── 24. Every entry ships launch-valid AS AUTHORED — Quick Setup replaces a
//         working default, it never supplies a missing one ───────────────────
//
// Mechanically enforced by scripts/test-task-bank.ts §10 via
// `gameStructureProblems`: a quiz with an empty `answers` array, or a station
// with an empty `secretCode`, fails that check, and a composed game built from
// it would not save — the creator gets an error with nothing to act on. Every
// new entry needs a real placeholder value (a real default code, a real default
// answer) even when its whole point is that Quick Setup asks the creator to
// replace it.
//
// ─── 25. A Quick Setup prompt is a short, warm instruction, not a spec dump ───
//
// The Builder's own guided-setup flow was sent back once as "robotic,
// disorienting, overwhelming" for leading with dense operational prose instead
// of one clear line — the exact failure mode a bank mission's `setup[].prompt`
// can fall into. `scripts/test-task-bank-setup-quality.ts` enforces a hard
// ceiling (240 chars) and floor (15); treat the ceiling as a warning sign, not a
// target to fill. If a step genuinely needs a worked example to be unambiguous
// (מנעול המספרים's three-digit walk-through — "Digit 1: count X. Digit 2: read
// the last two digits of Y…"), put the plain instruction FIRST and the example
// after, so a creator skimming on a phone gets the instruction even if they read
// no further.
//
// ─── 26. One step, one job, one field ─────────────────────────────────────────
//
// Restates rule 6/the-hidden-key's own history (splitting "what's locked" from
// "roughly where" into two steps) because it's exactly what "הודעת הבלון" and
// "מתנת התעלומה" needed: "wrap it AND set the answer" is two decisions wearing
// one Quick Setup step. Give each decision its own field and its own step, even
// when the underlying mission feels like one idea to the author — the creator
// experiences them one at a time regardless.
//
// ─── 27. Lukewarm feedback on a mission means cut it, not polish it once more ─
//
// "המעבר המדויק", "שלושת התפקידים" and "המוזיאון של [שם]" each survived one
// rewrite before being cut — every time, sharpening it further either converged
// it onto a mission already in the bank, or produced something no more
// compelling than the draft it replaced. The standing preference across this
// product is the bold cut over the incremental patch (see the Builder's own
// simplification history). A mission that needs a third defense after "I don't
// see the point" or "not sure this lands" is one that should have been cut on
// the second.
//
// Rule 27 has an explicit exception: the user's own "not thrilled but ship it
// anyway for variety" is a deliberate override, not a trigger for this rule.
// "איפה הכדור" shipped exactly that way — cut it only if TOLD to, never on your
// own reading of lukewarm.
//
// ─── 28. Don't manufacture a Quick Setup field for something every player in
//         the room already knows ──────────────────────────────────────────────
//
// "מבחן המראה" and "איחול לחוגג/ת" both first shipped with a bracketed
// placeholder for "the celebrant's name" and a required setup step to fill it
// in — manufacturing a decision nobody needed to make. At a birthday party,
// every player already knows whose birthday it is; the app never validates
// that name against anything, so "החוגג/ת" written plainly in the fixed
// description is already exact enough — a human reads it and fills it in from
// context the instant they say or write it. The real test is not "is this
// personalization required or optional" (an earlier, wrong version of this
// rule) — it's: does THE PLATFORM need to know this value to check, store, or
// route something? If yes (a real surveyed count, a hidden code, a chosen
// ranking, an actual map pin), it doesn't exist until the creator supplies it,
// and it earns a Quick Setup field. If the value is just ambient knowledge
// every player physically present already shares (who the party is for, what
// team they're on, what day it is), write it directly and generically — adding
// a field only adds friction for the creator with no gain for the player.
//
// ─── 29. self_report's legitimacy depends on the mission's real supervision
//         context, not a blanket "back it with video" rule ───────────────────
//
// Rule 14 says an honesty-based mission should be backed by video for
// accountability — right for a mission played unsupervised, a team wandering a
// neighborhood alone with nobody realistic watching. "איפה הכדור" is the
// counter-case: it's built for a birthday-party context where an
// organizer/parent is naturally circulating nearby, and that live presence
// already IS the accountability a video would otherwise exist to fake — a
// video requirement there is friction pretending to be rigor. Before requiring
// video-backed honesty, ask what the mission's actual deployment context is:
// a home/party or facilitated-corporate mission with someone realistically
// on-site tolerates plain `self_report`; a from-anywhere mission with nobody
// around to notice does not.
//
// ─── 30. `noPrep` is a promise about QUICK SETUP too, not only about props ───
//
// A creator answering prep level 1 is saying "I prepare nothing at all", and the
// composer honoured that by reading the mission's prep TAG — which describes
// props to bring and says nothing about the fields Quick Setup will then demand.
// So a level-1 game shipped missions tagged `noPrep` that could not be launched
// until the creator dropped a pin, attached a photo of a spot they had to go and
// photograph, wrote an emoji clue, or authored an olympiad riddle and its answer
// (`youth-hardest-question`, cut in this pass). Nothing was flagged: every one of
// them was tagged truthfully by the old reading of the tag.
//
// Two halves, both needed. The TAG is now judged on what the creator really has
// to do — if a REQUIRED Quick Setup step asks them to author content, it is
// `needsSetup`, whatever props are involved — and `fitScore` refuses any mission
// with a required step when the answer was level 1, derived from the entry's own
// `setup` so it cannot drift from the tag again (`demandsRequiredSetup`,
// composeGame.ts). Rule 18 said "no map pin is not no prep"; this is the same
// mistake seen from the creator's screen instead of from the props table.
//
// ─── 31. A mission whose ingredients might not exist has no finish ───────────
//
// Rule 5 asks for one unambiguous finish; the way that fails in practice is a
// mission that depends on something the world may simply not be holding today.
// "צלמו מישהו עם קולה" needs a stranger to be drinking one right now; "מצאו שלט
// עם טעות" needs the building to contain a mistake; "חלון ראווה עם פריט שלא
// מתאים" needs a subjective judgement about a window that may not exist. In all
// three the team cannot tell the difference between "we have not found it yet"
// and "there is nothing here", so they either stall or quietly give up — and
// nothing in the product can tell them which happened.
//
// The cola mission was cut. The other two were rewritten onto something the
// venue is guaranteed to hold: any window at all, and a sign saying what is
// forbidden (every mall, office and school has one). Before shipping a mission,
// name the thing it needs and ask whether it is certainly there.
//
// ─── 32. Missions for ten-year-olds are made of the players, not of the world ─
//
// The zero-prep pool for young players leaned on strangers, shop windows,
// evacuation maps and found materials — all fine for a teenage city race, all
// unreliable for a kids' game in a park or a living room. The three missions
// added in this pass (line up by height in silence, recreate a famous statue,
// one funny sentence each on video) need nothing that is not already standing
// there. When a young band comes out thin, reach for what the group itself can
// supply before reaching for what the venue might.
//
import type { Task } from '@rushpoint/shared';
import type { BankTagId } from './bankTags';
import { uuid } from './taskShorthands';

/**
 * One Quick Setup step a mission asks its creator for.
 *
 * `field` names a field on the mission THIS entry builds — asserted by
 * scripts/test-task-bank.ts, because a step pointing at an absent field is a
 * dead end in the creator's very first flow.
 */
export interface TaskBankSetup {
  /** The mission field this step is about, e.g. `coordinates`, `media`, `numericAnswer`. */
  field: string;
  /** Bilingual, like every other seeded string: "Hebrew\n\nEnglish". */
  prompt: string;
  /** Blocks the launch while the field is unconfigured. Default false. */
  required?: boolean;
}

export interface TaskBankEntry {
  /** Stable, never reused — the identity the recency memory and no-reuse rule key on. */
  key: string;
  /** Fresh mission, fresh id, on every call. */
  build: () => Task;
  /** Flat tags from the canonical registry. Filtered generically, never by group. */
  tags: BankTagId[];
  /** 1-10. MUST equal `build().difficulty` (pinned by scripts/test-task-bank.ts). */
  difficulty: number;
  /** Age floor, if this mission really has one. A threshold, deliberately not a tag. */
  minAge?: number;
  /**
   * Typical minutes spent GETTING to this mission, on top of doing it.
   *
   * A property of where this mission is sited, so it belongs to the mission, not
   * to a global constant. The composer used to size a game with one flat
   * minutes-per-mission figure that silently bundled ~5 minutes of walking into
   * every mission — including missions played from the couch — so a locationless
   * two-hour game came out with two hours' worth of mission slots holding about
   * thirty minutes of content.
   *
   * Omitted means ZERO, which is correct for every `fromAnywhere` mission: there
   * is nowhere to walk to. A `locationBased` mission declares a real figure — how
   * long it takes to reach it from a typical neighbouring stop, not from the
   * start line.
   *
   * Interaction time is NOT declared here: it is derived from the built mission
   * by `effectiveExpectedDurationMinutes` (@rushpoint/shared), so it cannot drift
   * from the mission's own content.
   */
  transitMinutes?: number;
  /** What this mission asks its creator to fill in, if anything. */
  setup?: TaskBankSetup[];
  /**
   * Groups near-duplicate missions — same underlying mechanic, different
   * cosmetic content — so the composer never puts two of them in one game.
   *
   * "רוג׳ום" and a photo-riddle navigation mission are both `outdoor`+`thinking`
   * and would happily coexist; "collect five things one colour" and "collect a
   * whole rainbow" are the SAME mission wearing two skins, and a game landing
   * both reads as the composer repeating itself. `usedKeys` (no exact mission
   * twice) does not catch this — these are two different keys. `family` is
   * exactly that catch: any two entries sharing one are mutually exclusive
   * within a single composed game (see composeGame.ts `usedFamilies`).
   *
   * Deliberately NOT a tag: it is an authoring-time grouping with no filtering
   * or scoring meaning, so mixing it into the scored tag vocabulary would let a
   * `preferredTags` answer accidentally target it.
   */
  family?: string;
  /**
   * True ONLY for a mission built around one physical, non-duplicable resource
   * that a team must take possession of and later free up — a single hidden key,
   * a single vendor/person who can talk to one team at a time. `build()` for such
   * an entry MUST set `maxConcurrentTeams: 1`, and this flag is the declared
   * (never inferred) reason why: it lets scripts/test-task-bank.ts tell "capacity
   * 1 because the physical world only has one of these" apart from "capacity 1
   * because nobody set it", which look identical on the built Task alone.
   *
   * Declared, never inferred, for the same reason `family` is (see the file
   * header, rule 13): the composer's whole bank used to inherit one blanket
   * `maxConcurrentTeams` regardless of what a mission actually needed, which let
   * three teams get routed at once to search for a single physical key that only
   * one of them could ever find. A mission with NO real scarcity (a public
   * landmark, a street sign, a park bench) should never carry this flag — it
   * would falsely queue teams behind each other for a spot that has room for all
   * of them, and `build()` should set a capacity high enough that the platform's
   * own `UNLIMITED_CAPACITY_THRESHOLD` convention treats it as "no queue here".
   */
  exclusiveStation?: boolean;
  /** Which template this content came from. Traceability only — nothing reads it. */
  sourceTemplateKey: string;
}

/**
 * The capacity a located mission declares when there is genuinely no shared
 * resource to queue behind — a public bench, a street sign, a landmark, a
 * gathering point every team passes through. Matches
 * `@rushpoint/shared`'s `UNLIMITED_CAPACITY_THRESHOLD`: the platform already
 * reads any capacity at or above it as "the author said no queue here" (real
 * templates use exactly this number on their own no-contention tasks), so a
 * second, drifting constant here would just be the same number typed twice.
 */
export const OPEN_SPACE_CAPACITY = 100;

/**
 * Everything every harvested mission shares. Keeps each entry to what differs.
 *
 * `maxConcurrentTeams: 1` is the SAFE floor, not a considered answer for any
 * particular mission — it used to be 3, a number that fit nothing: too low for
 * the gathering points every team passes through, and too high for a mission
 * built around one physical object only one team can hold at a time (see
 * `TaskBankEntry.exclusiveStation`). Every located entry below overrides this
 * explicitly, one way or the other; scripts/test-task-bank.ts refuses one that
 * silently relies on the fallback either way.
 */
function base(over: Partial<Task> & Pick<Task, 'title' | 'type'>): Task {
  return {
    id: uuid(),
    coordinates: { lat: 0, lng: 0 },
    difficulty: 5,
    estimatedMinutes: 10,
    pointValue: 100,
    maxConcurrentTeams: 1,
    ...over,
  };
}

/** A mission the team does wherever they happen to be standing. */
const anywhere = (over: Partial<Task> & Pick<Task, 'title' | 'type'>): Task =>
  base({ locationless: true, triggerMode: 'locationless', ...over });

/** A mission with a real spot on the map. The creator drops the pin per event. */
const sited = (over: Partial<Task> & Pick<Task, 'title' | 'type'>): Task =>
  base({ locationless: false, triggerMode: 'radius', ...over });

/** Photo/video upload, auto approved — the verification every mission here uses. */
const upload = (extra: Record<string, unknown> = {}) => ({
  enabled: true as const,
  verificationType: 'photo_upload' as const,
  autoApprove: true,
  ...extra,
});

/** Asks the creator to drop this mission's pin. Required: it cannot launch unplaced. */
const PLACE_IT: TaskBankSetup = {
  field: 'coordinates',
  required: true,
  prompt: 'סמנו על המפה את המקום המדויק של המשימה הזאת.\n\nDrop this mission’s pin on the map.',
};

/** Asks the creator for their own photo, since bank missions carry no media. */
const ATTACH_PHOTO: TaskBankSetup = {
  field: 'media',
  required: true,
  prompt: 'צרפו תמונה של המקום, כזאת שאפשר לזהות ממנה לאן צריך להגיע.\n\nAttach a photo of the spot, one the team can actually recognise.',
};


/**
 * A station the team reaches and reads a secret code off. The creator sets the
 * code.
 *
 * `maxConcurrentTeams: 1`: every mission built on this helper needs a real
 * person — a vendor, a contact standing at a spot — to hand the code to one
 * team at a time. That person is the exclusive resource (see
 * `TaskBankEntry.exclusiveStation`), not a decoration a busier event can afford
 * to raise.
 */
const codeStation = (over: Partial<Task> & Pick<Task, 'title'>): Task =>
  sited({
    type: 'smart_station',
    smart: { enabled: true, verificationType: 'code_verification', secretCode: '2468' },
    maxConcurrentTeams: 1,
    ...over,
  });

/**
 * Asks the creator for the secret code a station hands out.
 *
 * `smart.secretCode`, not bare `smart`: only the LEAF is registered in
 * QUICK_SETUP_FIELDS, so a step pointing at the parent object rendered fine and
 * then focused nothing — the creator was told to set the code and never shown
 * the code box. scripts/test-task-bank-setup-quality.ts now refuses any field
 * Quick Setup cannot navigate to.
 */
const SET_CODE: TaskBankSetup = {
  field: 'smart.secretCode',
  required: true,
  prompt: 'קבעו את הקוד שהמשימה מחכה לו, ותאמו אותו מראש עם מי שנותן אותו בשטח.\n\nSet the code this mission waits for, and agree it in advance with whoever hands it out on the ground.',
};

export const TASK_BANK: TaskBankEntry[] = [
  // ══ משחק לנוער — התחלה ════════════════════════════════════════════════════
  {
    key: 'youth-start-point',
    sourceTemplateKey: 'youth-missions',
    tags: ['start', 'teamwork', 'noPrep', 'locationBased', 'outdoor', 'youth', 'mixed', 'easy', 'park', 'neighborhood', 'cityCenter', 'forest', 'beach', 'school'],
    difficulty: 2,
    // The gathering point. Everyone walks to it before the clock matters, so it
    // is the one sited mission that costs no transit.
    transitMinutes: 0,
    setup: [PLACE_IT],
    build: () => base({
      title: 'מתחילים פה',
      description: 'נפגשים כאן ויוצאים לדרך. כשכל הקבוצה כאן, המשחק מתחיל.',
      type: 'field',
      difficulty: 2,
      estimatedMinutes: 1,
      pointValue: 10,
      // Every team is expected to gather at this exact point at once — the
      // opposite of a scarce resource.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ══ משחק לנוער — משימות גיבוש קבוצה ═══════════════════════════════════════
  {
    key: 'youth-winning-rap',
    sourceTemplateKey: 'youth-missions',
    tags: ['camera', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'youth', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'ראפ מנצח',
      description: 'בחרו שם לקבוצה, והקליטו סרטון של 30 שניות עם ראפ על הקבוצה שלכם. ביצוע מקורי מקבל ניקוד בונוס.',
      type: 'photo',
      estimatedMinutes: 15,
      smart: upload({ captureKind: 'video', videoMinSeconds: 20, videoMaxSeconds: 40 }),
    }),
  },
  {
    key: 'youth-great-escape',
    sourceTemplateKey: 'youth-missions',
    family: 'freeze-frame',
    tags: ['camera', 'creative', 'teamwork', 'action', 'noPrep', 'fromAnywhere', 'youth', 'mixed', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'המילוט הגדול',
      description: 'אתם בסצנת שיא של סרט פעולה: הרגע חילצתם חבר ואתם בורחים. צרו תמונה קפואה (Freeze Frame) של רגע הבריחה. חלקו תפקידים: מי מרים את החבר, מי מביט אחורה בפחד, מי צועק "לרוץ!".',
      type: 'photo',
      estimatedMinutes: 4,
      smart: upload({ captureKind: 'photo' }),
    }),
  },
  {
    key: 'youth-human-pyramid',
    sourceTemplateKey: 'youth-missions',
    // Also tagged `start`: it is the bank's only opener that needs no venue, and
    // without one a no-venue game opened on whatever mission happened to be
    // picked first. Everything that frames a literal start line is sited by
    // nature, so the placeless opener has to be a mission that works as an
    // icebreaker — which a human pyramid does better than most.
    tags: ['start', 'action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'youth', 'mixed', 'medium', 'park', 'beach', 'forest', 'school'],
    difficulty: 5,
    build: () => anywhere({
      title: 'פירמידה אנושית',
      description: 'תבנו פירמידה אנושית עם בסיס של 3 חברים. צלמו אותה ברגע שהיא יציבה.',
      type: 'photo',
      smart: upload(),
    }),
  },

  // ══ משחק לנוער — משימות תחרות ═════════════════════════════════════════════
  {
    key: 'youth-find-place-one',
    sourceTemplateKey: 'youth-missions',
    family: 'photo-navigate',
    tags: ['thinking', 'action', 'needsSetup', 'locationBased', 'outdoor', 'youth', 'mixed', 'medium', 'neighborhood', 'cityCenter', 'park', 'forest', 'beach'],
    difficulty: 5,
    // A real leg of the route: the whole mission is getting there.
    transitMinutes: 8,
    setup: [PLACE_IT, ATTACH_PHOTO],
    build: () => sited({
      title: 'מצאו את המקום הראשון',
      description: 'הביטו היטב בתמונה שצורפה למשימה, ונווטו אל המקום שהיא מציגה.',
      type: 'geofence',
      estimatedMinutes: 8,
      // A public spot, not a shared object — any number of teams can arrive.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    key: 'youth-emoji-riddle',
    sourceTemplateKey: 'youth-missions',
    // The creator writes the emoji line themselves — the mission has no content
    // at all until they do, which is `needsSetup`, not `noPrep` (rule 30).
    tags: ['thinking', 'needsSetup', 'locationBased', 'outdoor', 'youth', 'mixed', 'hard', 'neighborhood', 'cityCenter', 'park'],
    difficulty: 8,
    transitMinutes: 8,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'כתבו את שורת האימוג׳ים שמרמזת על המקום, כל אימוג׳י מילה אחת.\n\nWrite the emoji line that hints at the spot, one emoji per word.',
      },
    ],
    build: () => sited({
      title: 'חידת אימוג׳ים',
      description: 'מצאתם את המקום שהאימוג׳ים רמזו עליו!',
      type: 'geofence',
      difficulty: 8,
      estimatedMinutes: 5,
      pointValue: 120,
      hint: 'רמז: עברו על הרמז לאט. כל אימוג׳י מייצג מילה אחת, וביחד הן מרכיבות משפט שמתאר מקום מוכר בסביבה.',
      // A public spot, not a shared object — any number of teams can arrive.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    key: 'youth-breaking-news',
    sourceTemplateKey: 'youth-missions',
    tags: ['camera', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'youth', 'mixed', 'medium', 'cityCenter', 'neighborhood', 'mall', 'park'],
    difficulty: 5,
    build: () => anywhere({
      title: 'כתבת חדשות דחופה 📰',
      description: 'אחד מכם כתב טלוויזיה שמדווח בשידור חי על אירוע מוזר שקרה כאן. השאר משחקים ניצבים, עוברי אורח או גיבורי האירוע. סרטון של 40 שניות, עם פתיחה וסיום. בונוס אם זרים אמיתיים משתתפים.',
      type: 'photo',
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  // Both "מצאו את המקום" missions ask the creator to attach a photo OF THE SPOT,
  // which means going there and shooting it beforehand — real preparation, so
  // `needsSetup` (rule 18/30), not `noPrep` because there is no prop involved.
  {
    key: 'youth-find-place-two',
    sourceTemplateKey: 'youth-missions',
    family: 'photo-navigate',
    tags: ['thinking', 'action', 'needsSetup', 'locationBased', 'outdoor', 'youth', 'mixed', 'medium', 'neighborhood', 'cityCenter', 'park', 'forest', 'beach'],
    difficulty: 5,
    transitMinutes: 8,
    setup: [PLACE_IT, ATTACH_PHOTO],
    build: () => sited({
      title: 'מצאו את המקום השני',
      description: 'הביטו היטב בתמונה שצורפה למשימה, ונווטו אל המקום שהיא מציגה.',
      type: 'geofence',
      estimatedMinutes: 5,
      // A public spot, not a shared object — any number of teams can arrive.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    key: 'youth-absurd-petition',
    sourceTemplateKey: 'youth-missions',
    tags: ['action', 'camera', 'teamwork', 'creative', 'needsSetup', 'locationBased', 'outdoor', 'youth', 'medium', 'cityCenter', 'mall', 'neighborhood', 'beach'],
    difficulty: 5,
    // Needs a crowd, so the team walks to where people actually are.
    transitMinutes: 5,
    setup: [PLACE_IT],
    build: () => sited({
      title: 'העצומה האבסורדית',
      description: 'כתבו על דף: "מפסיקים את האבסורד: חותמים עכשיו על העצומה לביטול חובת הרישיון לרכיבה על חמורים ומחזירים את ההיגיון לרחובות!" אספו 30 חתימות מאנשים ברחוב, וצלמו את הדף.',
      type: 'photo',
      estimatedMinutes: 5,
      smart: upload(),
      // Needs a crowd, not a scarce object — several teams can collect
      // signatures in the same busy area at once.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ══ משחק לנוער — סיום ═════════════════════════════════════════════════════
  {
    key: 'youth-israeli-pride',
    sourceTemplateKey: 'youth-missions',
    // The placeless finale, for the same reason the pyramid is the placeless
    // opener. Building something together and photographing it is a real closing
    // beat, and it is the last mission of the source template's own final stage.
    tags: ['finish', 'creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'youth', 'mixed', 'medium', 'park', 'beach', 'forest', 'school'],
    difficulty: 5,
    build: () => anywhere({
      title: 'גאווה ישראלית',
      description: 'הרכיבו דגל ישראל מדברים שיש בסביבה: בגדים, תיקים, בקבוקים, עלים או אבנים. הוא לא חייב להיות גדול, הוא חייב להיות ברור. צלמו אותו מלמעלה.',
      type: 'photo',
      estimatedMinutes: 8,
      smart: upload(),
    }),
  },
  {
    key: 'youth-finish-point',
    sourceTemplateKey: 'youth-missions',
    tags: ['finish', 'teamwork', 'noPrep', 'locationBased', 'outdoor', 'youth', 'mixed', 'medium', 'park', 'neighborhood', 'cityCenter', 'forest', 'beach', 'school'],
    difficulty: 5,
    // The last leg home, and usually the longest single walk of the game.
    transitMinutes: 10,
    setup: [PLACE_IT],
    build: () => base({
      title: 'נקודת הסיום',
      description: 'נווטו אל נקודת הסיום של המירוץ.',
      type: 'field',
      estimatedMinutes: 5,
      // Every team finishes here, often at the same time — the opposite of a
      // scarce resource.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ══ משימות אתגר — a second active source ══════════════════════════════════
  // Both are played from anywhere and both send the team at real strangers,
  // which is the flavour the youth set is thinnest on.
  {
    key: 'challenge-shampoo-pitch',
    sourceTemplateKey: 'challenge-missions',
    // needsSetup, and it is the real thing: somebody has to hand each team a box
    // with a bottle of shampoo in it before the game starts.
    tags: ['action', 'camera', 'creative', 'teamwork', 'needsSetup', 'fromAnywhere', 'youth', 'mixed', 'medium', 'cityCenter', 'mall', 'neighborhood', 'beach'],
    difficulty: 5,
    setup: [{
      field: 'description',
      required: true,
      prompt: 'המשימה מניחה שהכנתם לכל קבוצה קופסה עם שמפו. עדכנו את המחיר ואת מה שיש בקופסה למה שהכנתם בפועל.\n\nThis mission assumes every team gets a box with shampoo in it. Set the price, and what is really in the box.',
    }],
    build: () => anywhere({
      title: 'שיווק שמפו',
      description: 'בקופסה שקיבלתם יש שמפו, עליכם למכור אותו לאדם זר בלפחות 10 שקלים ולהצטלם איתו.',
      type: 'photo',
      estimatedMinutes: 2,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },
  {
    key: 'challenge-beatles-crossing',
    sourceTemplateKey: 'challenge-missions',
    // Same mission as `statue-remake` in different clothes: recreate a famous
    // image with your bodies. One game, one of them.
    family: 'recreate-famous-image',
    tags: ['camera', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'youth', 'mixed', 'medium', 'cityCenter', 'neighborhood'],
    difficulty: 5,
    // The source game attached the reference shot. Bank missions carry no media
    // (see the header), and the instruction names the photo well enough to stand
    // on its own, so attaching one is an OPTIONAL improvement rather than a gate.
    setup: [{
      field: 'media',
      prompt: 'אפשר לצרף את התמונה המקורית של הביטלס, כדי שיהיה ברור מה משחזרים.\n\nOptional: attach the original Beatles photo so it is obvious what to recreate.',
    }],
    build: () => anywhere({
      title: 'הביטלס',
      description: 'תשחזרו את תמונת מעבר החצייה של הביטלס.',
      type: 'photo',
      estimatedMinutes: 2,
      smart: upload(),
    }),
  },
  // ══════════════════════════════════════════════════════════════════════════
  // Authored for the bank — written to fill the gaps the harvest left
  // ══════════════════════════════════════════════════════════════════════════
  //
  // The harvested set is one walking race for one age group, so it is thin in
  // four specific ways, and every mission below exists to close one of them:
  //
  //   • PLAY FROM ANYWHERE. Only eight harvested missions need no venue, which
  //     capped a no-venue game at about forty minutes however long was asked for.
  //   • BOOKENDS. Two openers and two finales meant every game opened and closed
  //     the same way.
  //   • AUDIENCE. Everything was youth. A creator answering "kids", "adults" or
  //     "work team" was handed missions written for someone else.
  //   • KIND. Four of the platform's nine mission types were represented, and
  //     `office` had no content at all.

  // ── Openers, playable anywhere ────────────────────────────────────────────
  {
    // "Battle cry" reads as camp/youth-group, not something a work team or a
    // group of adults would do without visible discomfort — it was tagged for
    // both anyway, which is a content mismatch, not a filtering one: the
    // composer would have picked this AS the honest best fit for an adult
    // opener, not despite one. Narrowed to the audience it actually suits.
    key: 'open-team-name',
    sourceTemplateKey: 'authored',
    tags: ['start', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere',
      'mixed', 'kids', 'youth', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'שם וקריאת קרב',
      description: 'בחרו שם לקבוצה והמציאו קריאת קרב באורך חמש שניות. צלמו את כולכם צועקים אותה ביחד. ככל שתתביישו פחות, כך ייצא טוב יותר.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 3,
      pointValue: 60,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 20 }),
    }),
  },
  {
    // The adults/corporate placeless opener open-team-name can no longer cover.
    key: 'open-team-motto',
    sourceTemplateKey: 'authored',
    tags: ['start', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere',
      'adults', 'corporate', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'המוטו של הצוות',
      description: 'שלושים שניות: הסכימו על משפט אחד שמתאר את הצוות שלכם היום, ואמרו אותו ביחד מול המצלמה. רציני, מצחיק או שניהם, זו החלטה שלכם.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 3,
      pointValue: 60,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 20 }),
    }),
  },
  {
    key: 'open-everyone-airborne',
    sourceTemplateKey: 'authored',
    tags: ['start', 'action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'mixed', 'kids', 'youth', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'כולם באוויר',
      description: 'תמונה אחת שבה כל חברי הקבוצה באוויר בו זמנית. שתי הרגליים באוויר, בלי רמאויות. כמה ניסיונות שצריך.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 4,
      pointValue: 60,
      smart: upload(),
    }),
  },

  // ── Finales, playable anywhere ────────────────────────────────────────────
  {
    key: 'finish-one-word-each',
    sourceTemplateKey: 'authored',
    tags: ['finish', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'easy'],
    difficulty: 3,
    build: () => anywhere({
      title: 'מילה אחת לכל אחד',
      description: 'סרטון של עשרים שניות: כל אחד בקבוצה אומר מילה אחת בלבד על היום הזה. בלי לחזור על מילה שכבר נאמרה.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 4,
      pointValue: 90,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },
  {
    key: 'finish-podium',
    sourceTemplateKey: 'authored',
    tags: ['finish', 'action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'mixed', 'kids', 'youth', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'טקס הניצחון',
      description: 'עמדו כאילו קיבלתם מדליות: מי בזהב, מי בכסף, מי בארד. פוזה דרמטית, כאילו יש קהל שצופה. צלמו את הרגע.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 5,
      pointValue: 110,
      smart: upload(),
    }),
  },

  // ── Play from anywhere: the gap that capped no-venue games ────────────────
  {
    key: 'rock-cairn',
    sourceTemplateKey: 'authored',
    // A stone cairn needs actual stones, so it prefers outdoor natural terrain —
    // a soft area preference, not a hard filter, so it still plays anywhere
    // stones can be found.
    tags: ['action', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'outdoor',
      'forest', 'park', 'beach',
      'mixed', 'youth', 'kids', 'corporate', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'רוג׳ום',
      description: 'בנו רוג׳ום: ערמו אבנים אחת על השנייה, מהגדולה לקטנה, עד שהוא עומד לבד. ככה מסמנים שביל ביער. צלמו אותו.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 8,
      pointValue: 120,
      smart: upload(),
    }),
  },
  {
    key: 'human-letter',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'teamwork', 'camera', 'noPrep', 'fromAnywhere',
      'mixed', 'youth', 'kids', 'corporate', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'האות האנושית',
      description: 'שכבו על הרצפה וצרו בגופכם את האות הראשונה של שם הקבוצה. אחד מכם מצלם מלמעלה, עם יד מורמת גבוה, כך שרואים את כל האות.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 7,
      pointValue: 110,
      smart: upload(),
    }),
  },
  {
    // Replaced the whisper-down-the-lane version: passing a silly sentence by
    // charades reads as a kids'-party game, not something a work team or a
    // group of adults does without visible discomfort. This version is the
    // same constraint — convey something complex with no verbal handoff — but
    // the content is a spatial instruction, not a phrase, which is the shape a
    // real team-communication exercise actually takes. Fully self-contained: no
    // creator prep, so no `needsSetup`.
    key: 'silent-briefing',
    sourceTemplateKey: 'authored',
    tags: ['teamwork', 'creative', 'thinking', 'noPrep', 'fromAnywhere',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 6,
    build: () => anywhere({
      title: 'תדרוך בלי מילים',
      description: 'אחד מכם קורא בשקט: "בנו מגדל מחפצים שיש לכם, אבל הפוך: הבסיס הרחב למעלה, לא למטה." בלי מילים, רק בציור, העבירו את ההוראה לצוות. הם מבצעים לפי מה שהבינו. צלמו את התוצאה.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 8,
      pointValue: 130,
      smart: upload(),
    }),
  },
  {
    // Replaced: leading someone by touch was reading as a kids'-camp trust
    // exercise. A hidden key that unlocks something specific and MUST be put
    // back for the next team turns the same "guide without touching" mechanic
    // into a real puzzle with a stake — and gives the bank a mission built
    // around real advance preparation the creator actually sets up in the field.
    //
    // Rebuilt (2026-08-26) after three separate loose ends surfaced in play:
    //   1. A visible map pin defeated the entire "hidden" premise — the same
    //      loophole rule 9 in the file header warns about. Fixed with
    //      `hideLocation` + a separate, honestly-rough `locationClue`, the exact
    //      pattern `human-gps`/`corporate-landmark-navigate` already use.
    //   2. The single `description` edit asked the creator to fold BOTH "what is
    //      locked" and "roughly where the key is" into one free-text rewrite,
    //      which could as easily overwrite the blindfold/return-the-key rules as
    //      preserve them. Split into two steps, each pointed at one field, one
    //      job — and the built-in description now names the exact spot to edit
    //      with a bracketed placeholder instead of asking for a silent rewrite.
    //   3. The blindfold's start and end were never stated, so "find the key,
    //      open it, photograph" left open whether the photo itself is taken
    //      blindfolded. Now explicit: eyes stay closed until the key is
    //      physically in hand, then open for the unlock and the photo.
    // A single physical key also means only one team can ever be searching at
    // once (see `exclusiveStation`) — the-hidden-key was the mission that
    // first exposed the composer handing three teams at once to a mission with
    // exactly one real object.
    key: 'the-hidden-key',
    sourceTemplateKey: 'authored',
    exclusiveStation: true,
    tags: ['thinking', 'teamwork', 'needsSetup', 'locationBased', 'outdoor', 'indoor',
      'park', 'forest', 'neighborhood', 'office', 'school',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 6,
    transitMinutes: 5,
    setup: [
      {
        field: 'coordinates',
        required: true,
        prompt: 'סמנו איפה תחביאו מפתח אמיתי, ומה הוא נועל (תיבה, מנעול, שער).\n\nMark where you\'ll hide a real key, and what it locks (a box, a padlock, a gate).',
      },
      {
        field: 'locationClue',
        required: true,
        prompt: 'כתבו רמז כללי לאזור, לא את המקום המדויק. אין סיכה במפה. לאירוע גדול, הכינו כמה מפתחות במקומות שונים.\n\nWrite a general area clue, not the exact spot. There\'s no pin on the map. For a big event, prepare several keys at different spots.',
      },
      {
        field: 'description',
        required: true,
        prompt: 'החליפו את הסוגריים במה שהמפתח פותח (תיבה, מנעול, שער). אל תמחקו את שאר ההוראות.\n\nReplace the brackets with what the key opens (a box, a padlock, a gate). Don\'t delete the rest of the instructions.',
      },
    ],
    build: () => sited({
      title: 'המפתח החבוי',
      description: 'מוחבא כאן מפתח שפותח [הוראות ליוצר: מה בדיוק נעול]. אחד מכם עוצם עיניים. השאר מדריכים אותו בקול בלבד, בלי לגעת, עד שהמפתח ביד. אז פותחים ומצלמים. בסיום מחזירים את המפתח בדיוק למקום, הקבוצה הבאה צריכה אותו.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 9,
      pointValue: 150,
      smart: upload(),
      hideLocation: true,
      locationClue: '',
      hint: 'רמז: הוראות קצרות (ימינה, שמאלה, קרוב) עובדות יותר טוב ממשפטים ארוכים.\n\nHint: short directions (left, right, closer) work better than long sentences.',
      hintPenalty: 20,
      // The one real, physical key: only one team can ever be searching for it
      // at a time, no matter how many teams the event has. See
      // TaskBankEntry.exclusiveStation.
      maxConcurrentTeams: 1,
    }),
  },
  {
    key: 'ad-for-nothing',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'פרסומת למוצר שלא קיים',
      description: 'המציאו מוצר אבסורדי לחלוטין, תנו לו שם וסיסמה, וצלמו לו פרסומת של שלושים שניות. צריך להיות בה לפחות לקוח מרוצה אחד.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 8,
      pointValue: 130,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  {
    key: 'frozen-genre',
    sourceTemplateKey: 'authored',
    family: 'freeze-frame',
    tags: ['creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'mixed', 'youth', 'adults', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'סרט בפריים אחד',
      description: 'בחרו ז׳אנר: אימה, רומנטיקה או מדע בדיוני. צרו תמונה קפואה אחת שמספרת ממנו סצנה שלמה. מי שמסתכל צריך לזהות את הז׳אנר בלי שתגידו לו.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 6,
      pointValue: 120,
      smart: upload(),
    }),
  },
  {
    // Replaced "human machine" (everyone mimes one moving part) — a mime-loop
    // reads as a kids'-drama-class exercise, not a mission a work team takes
    // seriously. A real chain reaction is the same idea done concretely: it is
    // an actual small engineering problem, it looks genuinely impressive on
    // video, and finishing one is satisfying in a way that acting out a sound
    // effect is not.
    key: 'chain-reaction',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'thinking', 'teamwork', 'noPrep', 'fromAnywhere',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 6,
    build: () => anywhere({
      title: 'שרשרת הפעולות',
      description: 'בנו שרשרת של שלוש פעולות לפחות מכל מה שיש בסביבה: בקבוק, תיק, נעל, אבן, ענף. כל פעולה מפעילה את הבאה, ואחרי שהתחלתם אסור לגעת בידיים. צלמו ברצף אחד, בלי לעצור.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 10,
      pointValue: 140,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },
  // ── Thinking: the bank had four, and a puzzle game needs more than four ───
  {
    key: 'exact-count',
    sourceTemplateKey: 'authored',
    family: 'count-estimate',
    tags: ['thinking', 'needsSetup', 'locationBased', 'outdoor',
      'neighborhood', 'cityCenter', 'park', 'beach',
      'mixed', 'youth', 'kids', 'adults', 'medium'],
    difficulty: 5,
    transitMinutes: 4,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'כתבו מה בדיוק סופרים, כך שאין שתי דרכים להבין את זה. ספרו בעצמכם פעם אחת לפני המשחק.\n\nWrite exactly what is being counted, so there is only one way to read it. Count it yourself once before the game.',
      },
      {
        field: 'numericAnswer',
        required: true,
        prompt: 'הזינו את המספר הנכון. אם קשה לספור בדיוק, הגדילו את טווח הסטייה בהגדרות המשימה.\n\nEnter the correct number. If an exact count is hard, widen the tolerance in the mission settings.',
      },
    ],
    build: () => sited({
      title: 'הספירה המדויקת',
      description: 'ספרו כמה ספסלים יש בטווח מאה מטר מהנקודה הזאת. תשובה אחת, מספר אחד. מומלץ להתחלק ולספור פעמיים.',
      type: 'numeric',
      difficulty: 5,
      estimatedMinutes: 7,
      pointValue: 120,
      numericAnswer: 0,
      numericTolerance: 1,
      // Nothing here is scarce — every team counts the same benches independently.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    key: 'sign-cipher',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'locationBased', 'outdoor',
      'neighborhood', 'cityCenter', 'school',
      'mixed', 'youth', 'adults', 'hard'],
    difficulty: 7,
    transitMinutes: 6,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'כתבו מאילו שלטים בדיוק לאסוף אותיות, לפי הסדר, ובאיזה מסלול.\n\nWrite exactly which signs the letters come from, in order, and along which route.',
      },
      {
        field: 'answers',
        required: true,
        prompt: 'הזינו את המילה שיוצאת. בדקו אותה בשטח לפני המשחק, שלטים מתחלפים.\n\nEnter the word it spells. Check it on the ground before the game, signs get replaced.',
      },
    ],
    build: () => sited({
      title: 'צופן השלטים',
      description: 'לאורך הרחוב הזה יש שלטים. קחו את האות הראשונה מכל אחד מהם, לפי הסדר, והרכיבו מילה אחת. היא התשובה.',
      type: 'quiz',
      difficulty: 7,
      estimatedMinutes: 9,
      pointValue: 150,
      answers: ['רשפוינט'],
      hint: 'רמז: אם המילה לא מסתדרת, בדקו שלא דילגתם על שלט קטן, ושאתם קוראים מימין לשמאל.',
      hintPenalty: 20,
      // The signs stay put and readable for every team — nothing to queue for.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    key: 'odd-one-planted',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'camera', 'needsSetup', 'locationBased', 'outdoor', 'indoor',
      'park', 'neighborhood', 'school', 'office', 'mall',
      'mixed', 'kids', 'youth', 'medium'],
    difficulty: 5,
    transitMinutes: 4,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'החביאו חפץ אחד שלא שייך למקום, וכתבו כאן רמז אחד בלבד עליו.\n\nHide one object that does not belong here, and write a single clue about it.',
      },
    ],
    build: () => sited({
      title: 'מה לא שייך לכאן',
      description: 'מישהו החביא כאן חפץ אחד שלא אמור להיות במקום הזה. מצאו אותו וצלמו אותו במקום שבו מצאתם, בלי להזיז אותו.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 8,
      pointValue: 130,
      smart: upload(),
      // The planted object is never taken — it stays in place for the next
      // team, so there is nothing to queue behind (unlike the-hidden-key).
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ── Strangers: the missions people remember a week later ──────────────────
  {
    key: 'thirty-second-interview',
    sourceTemplateKey: 'authored',
    tags: ['action', 'camera', 'creative', 'noPrep', 'fromAnywhere',
      'cityCenter', 'mall', 'neighborhood', 'beach',
      'mixed', 'youth', 'adults', 'corporate', 'medium', 'crowded'],
    difficulty: 6,
    build: () => anywhere({
      title: 'ראיון של שלושים שניות',
      description: 'מצאו אדם זר, בקשו רשות ושאלו: מה הייעוץ הכי גרוע שהוא קיבל אי פעם, וממי? צלמו את התשובה. אם הוא מסרב, תודו לו ותמצאו אחר.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 7,
      pointValue: 140,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  {
    key: 'honest-compliment',
    sourceTemplateKey: 'authored',
    tags: ['action', 'camera', 'noPrep', 'fromAnywhere',
      'cityCenter', 'mall', 'neighborhood', 'beach',
      'mixed', 'youth', 'adults', 'medium', 'crowded', 'educational'],
    difficulty: 5,
    build: () => anywhere({
      title: 'מחמאה אמיתית',
      description: 'תנו מחמאה כנה לאדם זר. לא על המראה, על משהו שבאמת שמתם לב אליו. אם הוא חייך, בקשו סלפי משותף.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 6,
      pointValue: 120,
      smart: upload(),
    }),
  },
  {
    // Rule tightened from "trade for something worth more" (subjective, hard to
    // judge, easy to stall on) to a fixed target and a no-refusal rule: it turns
    // a fuzzy negotiation into a clear, luck-driven chain with an unambiguous
    // finish line.
    key: 'trade-up',
    sourceTemplateKey: 'authored',
    tags: ['action', 'teamwork', 'creative', 'needsSetup', 'fromAnywhere',
      'cityCenter', 'mall', 'neighborhood',
      'mixed', 'youth', 'adults', 'corporate', 'medium', 'crowded'],
    difficulty: 6,
    setup: [{
      field: 'description',
      required: true,
      prompt: 'קבעו מה החפץ שכל קבוצה מקבלת בהתחלה, וכמה זמן יש להם. הכינו אותו מראש לכל קבוצה.\n\nDecide what object each team starts with, and how long they get. Prepare one per team in advance.',
    }],
    build: () => anywhere({
      title: 'סחר חליפין',
      description: 'קיבלתם חפץ קטן. הציעו אותו לאנשים ברחוב, וקבלו כל הצעת חילופין, לא משנה מה. המשיכו להחליף עד שמישהו נותן לכם טוש. צלמו את הטוש בידכם.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 15,
      pointValue: 170,
      smart: upload(),
    }),
  },
  {
    // A visible pin let the team just tap "navigate" and follow the app,
    // defeating the whole point of "no navigation app". `hideLocation` is the
    // platform's real mechanism for this: the map shows no pin (only a coarse
    // search area), and the participant is guided solely by `locationClue` —
    // which the creator sets to the address itself, so finding it means asking
    // people or reading street signs, not opening a map.
    key: 'human-gps',
    sourceTemplateKey: 'authored',
    // `needsSetup`, not `noPrep`: the address clue is the ENTIRE mission, and
    // the creator has to write it (rule 30).
    tags: ['thinking', 'action', 'teamwork', 'needsSetup', 'locationBased', 'outdoor',
      'neighborhood', 'cityCenter', 'park',
      'mixed', 'youth', 'adults', 'hard'],
    difficulty: 7,
    transitMinutes: 9,
    setup: [
      PLACE_IT,
      {
        field: 'locationClue',
        required: true,
        prompt: 'כתבו את הכתובת המדויקת כרמז. זה כל מה שהמשתתפים יראו. אין סיכה על המפה.\n\nWrite the exact address as the clue. This is all the players get. There is no pin on the map.',
      },
    ],
    build: () => sited({
      title: 'ניווט אנושי',
      description: 'הגיעו לנקודה הזאת בלי אפליקציית ניווט ובלי מפה. יש לכם רק את הכתובת. מותר רק לשאול אנשים בדרך, ולפחות שלושה אנשים שונים.',
      type: 'geofence',
      difficulty: 7,
      estimatedMinutes: 4,
      pointValue: 150,
      hideLocation: true,
      locationClue: '',
      hint: 'רמז: אם שני אנשים נותנים כיוונים סותרים, תשאלו שלישי, לרוב זה מכריע.',
      hintPenalty: 20,
      // A public address, not a shared object — any number of teams can arrive.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ── The vendor station: paid for in advance, handed over in person ────────
  {
    key: 'vendor-secret-code',
    sourceTemplateKey: 'authored',
    family: 'vendor-code',
    // The vendor is the exclusive resource: one person can only hand the code
    // to one team at a time (see TaskBankEntry.exclusiveStation).
    exclusiveStation: true,
    tags: ['action', 'teamwork', 'needsPartner', 'locationBased', 'outdoor', 'indoor',
      'cityCenter', 'mall', 'neighborhood', 'beach',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'easy', 'crowded'],
    difficulty: 3,
    transitMinutes: 7,
    setup: [
      PLACE_IT,
      SET_CODE,
      {
        field: 'description',
        required: true,
        prompt: 'כתבו לאיזה דוכן להגיע ומה בדיוק לבקש. שלמו מראש ותאמו עם בעל הדוכן שיחלק את הקוד, אחרת המשימה תיתקע.\n\nWrite which stall to go to and exactly what to ask for. Pay in advance and agree with the owner that they will hand out the code, or the mission will stall.',
      },
    ],
    build: () => codeStation({
      title: 'המנה הסודית',
      description: 'גשו לדוכן ובקשו את המנה הסודית בשם הקוד שסוכם. מי שעומד שם כבר יודע. תקבלו אותה ואיתה קוד. הקלידו אותו כאן.',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 110,
    }),
  },

  // ── Indoor, and the office in particular, which had nothing at all ────────
  {
    key: 'one-colour-five-things',
    sourceTemplateKey: 'authored',
    family: 'color-hunt',
    tags: ['camera', 'teamwork', 'creative', 'noPrep', 'fromAnywhere',
      'mall', 'office', 'school', 'neighborhood',
      'mixed', 'kids', 'youth', 'corporate', 'easy'],
    difficulty: 3,
    build: () => anywhere({
      title: 'חמישה דברים, צבע אחד',
      description: 'בחרו צבע, לא שחור ולא לבן. אספו חמישה חפצים באותו צבע וצלמו אותם בפריים אחד. ככל שהצבע מדויק יותר, כך טוב יותר. חסר חפץ? אפשר לבקש בהשאלה מאנשים בסביבה.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 100,
      smart: upload(),
    }),
  },
  {
    key: 'office-olympics',
    sourceTemplateKey: 'authored',
    tags: ['action', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'indoor',
      'office', 'school',
      'corporate', 'adults', 'mixed', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'אולימפיאדת המשרד',
      description: 'המציאו ענף ספורט חדש שאפשר לשחק רק בציוד משרדי. הגדירו חוק אחד, שחקו סיבוב שלם, וצלמו את הזוכה חוגג.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 9,
      pointValue: 130,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  {
    key: 'elevator-pitch',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere', 'indoor',
      'office', 'mall', 'cityCenter',
      'corporate', 'adults', 'medium'],
    difficulty: 6,
    build: () => anywhere({
      title: 'נאום המעלית',
      description: 'יש לכם שלושים שניות לשכנע מישהו שלא מכיר אתכם שהקבוצה שלכם היא הכי טובה כאן. בלי להשמיץ אף אחד אחר. צלמו את הנאום.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 6,
      pointValue: 130,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  {
    key: 'oldest-thing-here',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'office', 'school', 'mall', 'neighborhood', 'cityCenter',
      'corporate', 'adults', 'mixed', 'medium', 'historic', 'educational'],
    difficulty: 4,
    build: () => anywhere({
      title: 'הדבר הכי ותיק כאן',
      // "Write in the message how old you think it is" used to ask for a text
      // field the photo-submission flow never had — the guess and the reason
      // were never captured anywhere. Saying it on camera, appraiser-style,
      // keeps the same content and actually makes it more fun to watch back.
      description: 'מצאו את החפץ הוותיק ביותר שאתם מצליחים למצוא במקום הזה. צלמו אותו בווידאו, ותוך כדי הצילום הגידו בקול רם בן כמה אתם חושבים שהוא, ולמה, כמו שמאי אמיתי.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 7,
      pointValue: 110,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },

  // ── Kids: nothing in the bank was written for eight year olds ─────────────
  {
    // Replaced "animal parade" (mimic an animal's walk and sound) — reads as
    // preschool even for the 10+ end of "kids". Same mechanic underneath
    // (synchronized group movement, camera-friendly, zero prep) reframed as an
    // action-movie hero shot, which is the same kind of silly-but-cool a 10 to
    // 13 year old (or an adult) will actually commit to on camera.
    key: 'hero-walk',
    sourceTemplateKey: 'authored',
    tags: ['action', 'creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'park', 'school', 'forest', 'beach', 'neighborhood',
      'kids', 'youth', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'הליכת הגיבורים',
      description: 'צעדו יחד לאט ובביטחון, כמו בסצנת אקשן אחרי פיצוץ מאחוריכם. כולם אומרים באותו רגע משפט קליט אחד. צלמו בווידאו.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 5,
      pointValue: 80,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },
  {
    key: 'rainbow-hunt',
    sourceTemplateKey: 'authored',
    family: 'color-hunt',
    tags: ['camera', 'teamwork', 'action', 'noPrep', 'fromAnywhere',
      'park', 'school', 'forest', 'beach', 'neighborhood',
      'kids', 'mixed', 'easy'],
    difficulty: 3,
    build: () => anywhere({
      title: 'ציד הקשת',
      description: 'מצאו חפץ אדום, כתום, צהוב, ירוק, כחול וסגול. סדרו את כולם לפי הסדר וצלמו אותם ביחד בתמונה אחת.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 8,
      pointValue: 100,
      smart: upload(),
    }),
  },
  {
    key: 'silliest-walk',
    sourceTemplateKey: 'authored',
    tags: ['action', 'creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'park', 'school', 'beach', 'neighborhood',
      'kids', 'youth', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'ההליכה הכי מצחיקה',
      description: 'המציאו ביחד הליכה מצחיקה אחת, ולכו בה עשרה מטרים. כל הקבוצה, אותה הליכה, באותו זמן. צלמו מהצד.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 5,
      pointValue: 80,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },

  // ── Adults ────────────────────────────────────────────────────────────────
  {
    // "Ask for a story, film it" had no real stakes and no reason it needed two
    // people or any judgement from the team — hence flat for adults. Turned it
    // into a two-source verification, journalist-style: extract a SPECIFIC,
    // checkable claim, then test it against a second, unrelated witness. That
    // is a real skill (interviewing, judging a source) rather than a photo op.
    key: 'local-legend',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'action', 'creative', 'noPrep', 'fromAnywhere',
      'neighborhood', 'cityCenter', 'beach', 'historic',
      'adults', 'corporate', 'mixed', 'hard', 'educational'],
    difficulty: 7,
    build: () => anywhere({
      title: 'האגדה המקומית',
      description: 'מצאו מישהו שגר או עובד כאן הרבה זמן. בקשו ממנו סיפור מוזר או מפתיע על המקום, ובקשו פרט אחד שאפשר לבדוק: שם, שנה או אירוע. צלמו את התשובה, וחזרו על הפרט בקול בסוף הסרטון.',
      type: 'photo',
      difficulty: 7,
      estimatedMinutes: 12,
      pointValue: 160,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
      hint: 'רמז: מישהו שעובד בעסק ותיק במקום בדרך כלל יודע יותר מעובר אורח מזדמן.',
      hintPenalty: 20,
    }),
  },
  {
    key: 'two-truths-one-lie',
    sourceTemplateKey: 'authored',
    tags: ['teamwork', 'creative', 'thinking', 'noPrep', 'fromAnywhere', 'indoor',
      'office', 'mall', 'park', 'beach',
      'corporate', 'adults', 'youth', 'mixed', 'easy'],
    difficulty: 3,
    build: () => anywhere({
      title: 'שתי אמיתות ושקר',
      description: 'כל אחד מספר שלושה דברים על עצמו: שניים נכונים ואחד לא. הקבוצה מצביעה על השקר. מה היה השקר הכי טוב בקבוצה?',
      type: 'survey',
      difficulty: 3,
      estimatedMinutes: 8,
      pointValue: 100,
    }),
  },
  // ── Mission kinds the bank was missing entirely ───────────────────────────
  //
  // Thirty-three of the first forty-three were photo uploads. That is one verb,
  // repeated: point a camera, press a button, wait for approval. A game made only
  // of those has no change of rhythm — nothing to think about, nothing to type,
  // nothing that ends in a right answer. The missions below are here for the
  // KINDS they bring: a typed answer, a number to agree on, an ordered drill, an
  // honour-system beat, and an opinion with no wrong answer to breathe between
  // the loud ones.

  {
    // "Pick two points you can both see, guess, then go count" only works if
    // the creator actually surveyed the spot — self-directed, a team could pick
    // two points 200m apart and the "guess then verify" premise collapses. Fixed
    // by moving the survey to where it belongs: the creator names the start
    // landmark, pins the end point, and walks it once beforehand to get the
    // real count.
    key: 'how-many-steps',
    sourceTemplateKey: 'authored',
    family: 'count-estimate',
    tags: ['thinking', 'teamwork', 'action', 'needsSetup', 'locationBased', 'outdoor',
      'park', 'neighborhood', 'school', 'beach', 'cityCenter',
      'mixed', 'kids', 'youth', 'easy'],
    difficulty: 3,
    transitMinutes: 5,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'תארו נקודת התחלה ברורה וקבועה (למשל "משער בית הספר"), כדי שהצוות ידע בדיוק מאיפה לספור עד הסיכה.\n\nDescribe a clear, fixed starting point (for example "from the school gate"), so the team knows exactly where to count from.',
      },
      {
        field: 'numericAnswer',
        required: true,
        prompt: 'לפני המשחק: הלכו בעצמכם מנקודת ההתחלה עד כאן וספרו את הצעדים. הזינו את המספר האמיתי.\n\nBefore the game: walk it yourself from the starting point to here and count the steps. Enter the real number.',
      },
    ],
    build: () => sited({
      title: 'כמה צעדים',
      description: 'מנקודת ההתחלה שתוארה לכם, נחשו כמה צעדים עד לכאן. אחר כך לכו וספרו בפועל. הזינו את המספר שספרתם.',
      type: 'numeric',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 90,
      numericAnswer: 40,
      numericTolerance: 8,
      // The pin stays put for every team — nothing to queue for.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    // A flat trivia question has one honest move if you don't know it: search.
    // Banning the search and requiring a real person instead turns three idle
    // seconds of typing into an actual small social task, and it is what makes
    // the mission belong in a FIELD game rather than a pub quiz.
    key: 'trivia-bones',
    sourceTemplateKey: 'authored',
    family: 'trivia-fact',
    tags: ['thinking', 'action', 'noPrep', 'fromAnywhere', 'crowded',
      'school', 'office', 'mall', 'park',
      'mixed', 'youth', 'kids', 'adults', 'medium', 'educational'],
    difficulty: 4,
    build: () => anywhere({
      title: 'שאלת חימום',
      description: 'כמה עצמות יש בגוף של אדם מבוגר? אם אתם לא בטוחים, אסור לחפש בגוגל. שאלו אנשים שאתם פוגשים עד שמישהו יודע. תשובה אחת, מספר אחד.',
      type: 'quiz',
      difficulty: 4,
      estimatedMinutes: 3,
      pointValue: 90,
      answers: ['206'],
      choices: ['201', '206', '215', '224'],
      hint: 'רמז: שאלו רופא, אח, סטודנט לרפואה, או פשוט שלושה אנשים שונים.',
      hintPenalty: 15,
    }),
  },
  {
    key: 'trivia-longest-river',
    sourceTemplateKey: 'authored',
    family: 'trivia-fact',
    tags: ['thinking', 'action', 'noPrep', 'fromAnywhere', 'crowded',
      'school', 'office', 'mall', 'park',
      'mixed', 'youth', 'adults', 'medium', 'educational'],
    difficulty: 5,
    build: () => anywhere({
      title: 'שאלת הנהר',
      description: 'איזה נהר נחשב לארוך בעולם? אם אתם לא בטוחים, אסור לחפש בגוגל. שאלו אנשים שאתם פוגשים עד שמישהו יודע.',
      type: 'quiz',
      difficulty: 5,
      estimatedMinutes: 3,
      pointValue: 100,
      answers: ['הנילוס', 'נילוס'],
      choices: ['הנילוס', 'האמזונס', 'הירדן', 'המיסיסיפי'],
      hint: 'רמז: שאלו מישהו שנראה כאילו הוא אוהב גיאוגרפיה, או פשוט כמה אנשים.',
      hintPenalty: 15,
    }),
  },
  {
    key: 'do-someone-a-favour',
    sourceTemplateKey: 'authored',
    tags: ['action', 'teamwork', 'noPrep', 'fromAnywhere',
      'neighborhood', 'cityCenter', 'mall', 'park', 'beach',
      'mixed', 'youth', 'adults', 'corporate', 'easy', 'crowded', 'educational'],
    difficulty: 3,
    build: () => anywhere({
      title: 'טובה אחת',
      description: 'עשו טובה אמיתית לאדם שלא מכיר אתכם. להחזיק דלת, לעזור לסחוב, להרים משהו שנפל. בלי לצלם אותו ובלי לספר לו שזו משימה. כשסיימתם, אשרו כאן.',
      type: 'self_report',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 100,
    }),
  },
  // "רגע של אוויר" removed outright — a rest-break survey with no real content
  // ("sit for two minutes, tell us how it's going") added nothing a creator or
  // player would miss, and dressing it up as a viewpoint photo op instead was
  // considered and rejected too: forcing a mission to exist just to keep the
  // `survey` type represented in the bank is exactly the padding this bank is
  // trying not to be. `survey` stayed an honest, unfilled gap until
  // `best-moment-so-far` (near the end of this file) gave it a real reason to
  // exist: a mid-run read on what the team is actually enjoying, which no
  // post-run feedback screen recovers as accurately.

  // ── Indoor depth: a mall and a school are not just "not outdoors" ─────────
  {
    key: 'window-story',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'thinking', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'indoor',
      'mall', 'cityCenter',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'הסיפור שבחלון',
      description: 'עצרו מול חלון ראווה ובחרו בו פריט אחד. צלמו את החלון וספרו בווידאו של 30 שניות: מי האדם שקנה דווקא אותו, ולמה. חייבים להזכיר פרט אחד שבאמת רואים בחלון.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 7,
      pointValue: 120,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  {
    key: 'count-the-shops',
    sourceTemplateKey: 'authored',
    family: 'count-estimate',
    tags: ['thinking', 'teamwork', 'needsSetup', 'locationBased', 'indoor',
      'mall', 'cityCenter',
      'mixed', 'youth', 'adults', 'medium'],
    difficulty: 4,
    transitMinutes: 4,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'הגדירו בדיוק מה נספר ואיפה הקטע מתחיל ונגמר, כך שאין שתי דרכים להבין את זה.\n\nDefine exactly what is counted and where the stretch starts and ends, so there is only one way to read it.',
      },
      {
        field: 'numericAnswer',
        required: true,
        prompt: 'לפני המשחק: עברו בעצמכם את הקטע וספרו. הזינו את המספר שקיבלתם.\n\nBefore the game: walk the stretch yourself and count. Enter the number you got.',
      },
    ],
    build: () => sited({
      title: 'ספירת החנויות',
      description: 'מהנקודה הזאת, ספרו את החנויות לאורך המעבר עד הקצה השני. חנות סגורה נספרת גם היא, דוכן שעומד באמצע המעבר לא.',
      type: 'numeric',
      difficulty: 4,
      estimatedMinutes: 8,
      pointValue: 110,
      numericAnswer: 20,
      numericTolerance: 2,
      // The shops stay put and countable for every team — nothing to queue for.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    key: 'school-then-and-now',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'camera', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere',
      'school', 'neighborhood', 'cityCenter',
      'kids', 'youth', 'adults', 'corporate', 'mixed', 'medium', 'historic', 'educational'],
    difficulty: 4,
    build: () => anywhere({
      title: 'פעם והיום',
      description: 'מצאו במקום פינה שנראית כאילו לא השתנתה שנים. צלמו אותה, וביימו בתוכה תמונה שנראית כאילו צולמה לפני שלושים שנה.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 8,
      pointValue: 120,
      smart: upload(),
    }),
  },

  // ── A few more to keep repeat generations apart ───────────────────────────
  {
    key: 'forced-perspective',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'camera', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere',
      'park', 'school', 'office', 'beach', 'mall', 'cityCenter',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'פרספקטיבה כוזבת',
      description: 'צלמו תמונה אחת שבה אחד מכם נראה ענק והשאר זעירים לידו, רק בעזרת מרחק וזווית מצלמה. בלי עריכה, בלי חיתוך ובלי פילטרים.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 7,
      pointValue: 110,
      smart: upload(),
    }),
  },
  {
    key: 'everyone-hidden',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'camera', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere',
      'park', 'forest', 'beach', 'neighborhood', 'school',
      'mixed', 'kids', 'youth', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'כולם בתמונה, אף אחד לא נראה',
      description: 'צלמו תמונה שכל הקבוצה נמצאת בה, אבל אי אפשר לזהות אף אחד. מאחורי עצים, מתחת לשמיכה, רק צללים. מי שמסתכל צריך להאמין שכולכם שם.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 7,
      pointValue: 120,
      smart: upload(),
    }),
  },
  {
    key: 'guess-the-height',
    sourceTemplateKey: 'authored',
    family: 'count-estimate',
    tags: ['thinking', 'teamwork', 'needsSetup', 'locationBased', 'outdoor',
      'cityCenter', 'neighborhood', 'park', 'forest',
      'mixed', 'youth', 'adults', 'medium'],
    difficulty: 5,
    transitMinutes: 4,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'כתבו איזה מבנה או עץ בדיוק מודדים, כך שאי אפשר לטעות בזיהוי שלו מהנקודה הזאת.\n\nWrite exactly which building or tree is being measured, so it cannot be mistaken for another one from this spot.',
      },
      {
        field: 'numericAnswer',
        required: true,
        prompt: 'בררו מראש את הגובה האמיתי במטרים והזינו אותו. אם אין מספר מדויק, ספרו קומות והכפילו בשלוש.\n\nFind out the real height in metres in advance and enter it. If there is no exact figure, count the floors and multiply by three.',
      },
    ],
    build: () => sited({
      title: 'כמה זה גבוה',
      description: 'העריכו את הגובה במטרים של מה שסומן לכם. בלי למדוד ובלי לחפש באינטרנט. מותר לשאול אנשים בסביבה.',
      type: 'numeric',
      difficulty: 5,
      estimatedMinutes: 5,
      pointValue: 110,
      numericAnswer: 15,
      numericTolerance: 3,
      // The building or tree stays put for every team — nothing to queue for.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  // ── Closing narrow gaps the profile found ─────────────────────────────────
  //
  // Not padding — each of these fixes one measured hole: zero geofence missions
  // tagged for a corporate audience (an outdoor work offsite had no "walk to a
  // real point" mechanic at all), only one smart_station in the whole bank (the
  // vendor-code mechanic is one of the platform's more distinctive real-world
  // beats and deserves a second flavour), only one sequence mission (a structured
  // team drill is a different rhythm than "photograph this"), and adults/
  // corporate sitting thin on genuinely hard content.

  {
    key: 'corporate-landmark-navigate',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'teamwork', 'needsSetup', 'locationBased', 'outdoor',
      'cityCenter', 'neighborhood', 'park',
      'corporate', 'adults', 'hard'],
    difficulty: 7,
    transitMinutes: 10,
    setup: [
      PLACE_IT,
      {
        field: 'locationClue',
        required: true,
        prompt: 'כתבו רמז למקום בלי לנקוב בשמו. אין סיכה על המפה. ודאו שאפשר לפענח אותו מנקודת הפתיחה.\n\nWrite a clue to the place without naming it. There is no pin on the map. Make sure it can be worked out from the starting point.',
      },
    ],
    build: () => sited({
      title: 'ניווט לפי רמז',
      description: 'קיבלתם רמז למקום, לא כתובת. פענחו אותו כצוות והגיעו לשם ביחד. אין סיכה על המפה.',
      type: 'geofence',
      difficulty: 7,
      estimatedMinutes: 6,
      pointValue: 160,
      hideLocation: true,
      locationClue: '',
      hint: 'קראו את הרמז שוב בקול. לרוב התשובה כבר שם.',
      hintPenalty: 25,
      // A public spot, not a shared object — any number of teams can arrive.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    key: 'vendor-order-by-number',
    sourceTemplateKey: 'authored',
    family: 'vendor-code',
    // The vendor is the exclusive resource: one person can only hand the code
    // to one team at a time (see TaskBankEntry.exclusiveStation).
    exclusiveStation: true,
    tags: ['action', 'teamwork', 'needsPartner', 'locationBased', 'indoor', 'outdoor',
      'mall', 'cityCenter', 'neighborhood',
      'mixed', 'youth', 'adults', 'corporate', 'medium', 'crowded'],
    difficulty: 4,
    transitMinutes: 6,
    setup: [
      PLACE_IT,
      SET_CODE,
      {
        field: 'description',
        required: true,
        prompt: 'כתבו לאיזה בית עסק להגיע ומה בדיוק להזמין "לפי המספר". תאמו עם בעל העסק מראש שיחלק את הקוד כשמזמינים בשם הזה.\n\nWrite which business to go to and exactly what to order "by the number". Agree in advance with the owner that they will hand out the code for that order.',
      },
    ],
    build: () => codeStation({
      title: 'הזמנה לפי מספר',
      description: 'גשו לבית העסק ובקשו "מנה מספר" לפי הקוד שסוכם. תקבלו את המוצר ואיתו קוד אימות. הקלידו אותו כאן כדי לסיים.',
      difficulty: 4,
      estimatedMinutes: 7,
      pointValue: 120,
    }),
  },
  {
    key: 'team-decision-drill',
    sourceTemplateKey: 'authored',
    tags: ['teamwork', 'thinking', 'needsSetup', 'fromAnywhere', 'indoor',
      'office', 'mall', 'park', 'school',
      'corporate', 'adults', 'medium', 'educational'],
    difficulty: 5,
    setup: [{
      field: 'steps',
      required: true,
      prompt: 'בצעד השני, החליפו את התשובה בערך שרלוונטי אצלכם: ערך ארגוני, מוצר, או כל מילה שהצוות אמור להגיע אליה יחד.\n\nIn step two, replace the answer with something that matters to you: a company value, a product, or any word the team should arrive at together.',
    }],
    build: () => anywhere({
      title: 'תרגיל ההחלטה',
      description: 'שלושה צעדים לפי הסדר. אי אפשר להתקדם בלי הסכמה של כולם על הצעד הקודם, ולא בהצבעת רוב.',
      type: 'sequence',
      difficulty: 5,
      estimatedMinutes: 9,
      pointValue: 140,
      steps: [
        { id: uuid(), prompt: 'הוציאו את כל מה שיש לכם בכיסים ובתיקים. בחרו פה אחד את הפריט האחד שהכי יעזור לצוות בשעה הקרובה. אשרו כשכולם מסכימים.' },
        { id: uuid(), prompt: 'הקלידו את המילה הבאה.', answer: '' },
        { id: uuid(), prompt: 'החליטו פה אחד מי מכם מוביל את המשימה הבאה, ואמרו בקול למה דווקא הוא. אשרו לסיום.' },
      ],
    }),
  },
  {
    key: 'the-hard-riddle',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'action', 'noPrep', 'fromAnywhere', 'crowded',
      'office', 'school', 'mall', 'park', 'cityCenter',
      'adults', 'corporate', 'youth', 'hard'],
    difficulty: 8,
    build: () => anywhere({
      title: 'החידה שלא מוותרת',
      description: 'יש לי ערים אבל בלי בתים, יערות בלי עצים, ומים בלי דגים. מה אני? אסור לחפש בגוגל. אם נתקעתם, תפסו אנשים ברחוב ותנו להם לנסות, עד שמישהו פותר.',
      type: 'quiz',
      difficulty: 8,
      estimatedMinutes: 5,
      pointValue: 150,
      answers: ['מפה', 'מפת עולם'],
      hint: 'רמז: שאלו שלושה אנשים שונים. מישהו מהם ייתן לכם את המילה.',
      hintPenalty: 25,
    }),
  },
  {
    key: 'price-target',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'action', 'teamwork', 'needsSetup', 'fromAnywhere', 'crowded',
      'mall', 'cityCenter', 'neighborhood',
      'adults', 'corporate', 'youth', 'hard', 'educational'],
    difficulty: 7,
    setup: [{
      field: 'numericAnswer',
      required: true,
      prompt: 'קבעו את סכום היעד בשקלים והזינו אותו כאן. סכום שדורש לצרף כמה מוצרים עובד הכי טוב.\n\nSet the target amount in shekels and enter it here. An amount that needs a few items combined works best.',
    }],
    build: () => anywhere({
      title: 'סכום היעד',
      description: 'בלי לקנות כלום ובלי להוציא שקל. מצאו שלושה מוצרים שסכום המחירים שלהם הכי קרוב לסכום היעד שקיבלתם, והזינו את הסכום שהגעתם אליו.',
      type: 'numeric',
      difficulty: 7,
      estimatedMinutes: 12,
      pointValue: 170,
      numericAnswer: 100,
      numericTolerance: 5,
      hint: 'רמז: מצאו קודם שני מוצרים שסכומם קרוב ליעד, ואז השלימו עם מוצר שלישי וזול שמצמצם את הפער.',
      hintPenalty: 25,
    }),
  },
  {
    key: 'passphrase-handoff',
    sourceTemplateKey: 'authored',
    family: 'vendor-code',
    // The contact standing at the spot is the exclusive resource: one person
    // can only hand the code to one team at a time (see
    // TaskBankEntry.exclusiveStation).
    exclusiveStation: true,
    tags: ['thinking', 'teamwork', 'needsPartner', 'locationBased', 'outdoor', 'indoor',
      'park', 'school', 'mall', 'neighborhood',
      'kids', 'youth', 'easy'],
    difficulty: 3,
    transitMinutes: 5,
    setup: [
      PLACE_IT,
      SET_CODE,
      {
        field: 'description',
        required: true,
        prompt: 'סכמו מראש עם אדם שיעמוד בנקודה: מה הסיסמה שהצוות אומר לו, ואיזה קוד הוא מוסר בתמורה. עדכנו כאן את הסיסמה.\n\nArrange in advance with someone who will be standing at the spot: what passphrase the team says, and which code they hand back. Set the passphrase here.',
      },
    ],
    build: () => codeStation({
      title: 'מסירת הסיסמה',
      description: 'בנקודה הזאת עומד איש הקשר שלכם. גשו אליו ואמרו לו את הסיסמה בדיוק כפי שקיבלתם אותה. אם אמרתם נכון, הוא ימסור לכם קוד. הקלידו אותו כאן.',
      difficulty: 3,
      estimatedMinutes: 5,
      pointValue: 90,
    }),
  },
  // ── Indoor coverage, restored honestly ────────────────────────────────────
  //
  // Siting "ספירת החנויות" correctly (it had no anchor, so its surveyed answer
  // belonged to a floor the team could not identify) cost the bank one of its
  // few indoor missions needing no pin — and an hour-long indoor game with pins
  // switched off started coming up about a quarter short. These two fill that
  // gap on their own merits: both are indoor by nature, need no creator prep and
  // no map pin, and each turns a building itself into the thing being examined.

  {
    key: 'the-broken-sign',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'camera', 'creative', 'noPrep', 'fromAnywhere', 'indoor',
      'mall', 'office', 'school', 'cityCenter', 'neighborhood',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'השלט השבור',
      // "Find a sign with a real mistake" had no guaranteed answer: a building
      // may simply not contain one, and the team has no way to know whether to
      // keep looking (rule 5). A sign saying what is FORBIDDEN is somewhere in
      // every mall, office and school, so the search always terminates — and
      // inventing the person it was hung for is a better beat than proofreading.
      description: 'מצאו שלט שכתוב עליו משהו שאסור לעשות. צלמו אותו בווידאו, וספרו בקול את הסיפור של האדם שבגללו תלו דווקא את השלט הזה. אסור להמציא שלט בעצמכם.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 8,
      pointValue: 120,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 25 }),
    }),
  },
  {
    key: 'escape-route',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'teamwork', 'action', 'noPrep', 'fromAnywhere', 'indoor',
      'mall', 'office', 'school',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'educational', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'מסלול המילוט',
      description: 'מצאו את מפת המילוט על הקיר. הסתכלו עליה 30 שניות, ואז לכו יחד ליציאת החירום הקרובה, בלי להסתכל שוב ובלי לשאול. צלמו את היציאה שהגעתם אליה.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 7,
      pointValue: 110,
      smart: upload(),
    }),
  },

  // ── Two mission kinds the bank never actually filled ──────────────────────
  //
  // `survey` had zero entries (see the removal note on "רגע של אוויר" earlier
  // in this file — that gap was left open on purpose rather than faked), and
  // no entry anywhere used `captureKind: 'audio'`, even though both are real,
  // shipped platform capabilities. Filling a gap ONLY counts when the content
  // earns its place per rule 4 (the constraint IS the mission) — a survey with
  // a real creator payoff, and an audio mission that could not just be a photo
  // mission with the word "record" swapped in.
  {
    // A real payoff for the CREATOR, not just a stat filled in: every other
    // mission scores the team, but this is the one moment the platform asks
    // the team what they actually enjoyed, mid-run, while it is still fresh —
    // data no post-run feedback survey ever recovers as accurately. No-prep by
    // definition (`survey` type has no answer key to configure) and it plays
    // from literally any stage of any game, which is exactly why the bank
    // could not skip it any longer.
    key: 'best-moment-so-far',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'noPrep', 'fromAnywhere',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'הרגע הכי טוב עד עכשיו',
      description: 'עצרו לרגע: מה היה הרגע הכי כיף במשחק עד עכשיו? אין תשובה נכונה, רק הדעה שלכם.',
      type: 'survey',
      difficulty: 2,
      estimatedMinutes: 2,
      pointValue: 50,
      surveyChoices: [
        'משימה עם זרים ברחוב',
        'המשימה הכי יצירתית',
        'התחרות הפנימית בינינו',
        'סתם להיות ביחד בחוץ',
      ],
    }),
  },
  {
    // A photo asks "what did this look like"; this asks "what did this sound
    // like" — a genuinely different sense, not a video mission wearing a
    // different label. The two-different-sounds rule keeps "record five
    // seconds of silence and call it done" from being the easy way out.
    key: 'soundscape',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'creative', 'noPrep', 'fromAnywhere',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'easy'],
    difficulty: 3,
    build: () => anywhere({
      title: 'נוף הקול',
      description: 'הקליטו כעשר שניות מהצליל האמיתי של המקום, בלי לדבר, בלי מוזיקה. חייבים להישמע בהקלטה לפחות שני צלילים שונים.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 4,
      pointValue: 90,
      smart: upload({ captureKind: 'audio' }),
    }),
  },
  {
    // Every quiz in the bank so far is answers/choices; `orderItems` (change:
    // quiz-ordering) is a real, shipped mechanic with zero representation.
    // Chosen content is deliberately checkable general knowledge, not local
    // trivia a bank mission cannot know — five inventions with a real,
    // undisputed chronological order, same "ask around, no Googling" rule the
    // other trivia missions use so it stays a field-game beat, not a quiz app.
    key: 'invention-order',
    // NOT tagged family: 'trivia-fact' — that family groups the pick-an-answer
    // quizzes (trivia-bones, trivia-longest-river), which really are one
    // mechanic with different questions. Dragging five items into
    // chronological order is a different verb entirely; excluding it from
    // appearing alongside a fact quiz would remove a pairing that adds
    // variety, not one that repeats it (see rule 12 — family is for true
    // mechanical duplicates, not shared theming).
    //
    // IS tagged family: 'ordering-quiz', added 2026-08-26 alongside
    // celebrants-favorites-ranking — that IS the same mechanic (orderItems),
    // just ranking a preference instead of a chronology (see rule 21), so a
    // composed game must never show both.
    family: 'ordering-quiz',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'noPrep', 'fromAnywhere', 'crowded',
      'school', 'office', 'mall', 'park',
      'mixed', 'youth', 'adults', 'corporate', 'medium', 'educational'],
    difficulty: 6,
    build: () => anywhere({
      title: 'לפי הסדר הנכון',
      description: 'סדרו את חמשת ההמצאות לפי סדר ההמצאה שלהן, מהוותיקה לחדשה. אסור לחפש בגוגל. פנו לזרים ברחוב ובקשו את עזרתם עד שמישהו עוזר לכם לסדר נכון.',
      type: 'quiz',
      difficulty: 6,
      estimatedMinutes: 6,
      pointValue: 140,
      // The authored order IS the answer key (server-secret; sanitized to a
      // per-team shuffled copy) — oldest first, exactly as it must be graded.
      orderItems: ['הדפוס', 'הטלגרף', 'הטלפון', 'הרדיו', 'הטלוויזיה'],
      hint: 'רמז: ההמצאה שפועלת בחשמל קדמה להמצאה שמעבירה קול, שקדמה להמצאה שמעבירה תמונה.',
      hintPenalty: 20,
    }),
  },
  {
    // A self-serve `smart_station`: the code lives on a sign/sticker the
    // creator writes and hides themselves — no business owner, no staff
    // member, no `needsPartner`. Distinguishes the mechanic from every OTHER
    // smart_station in this bank, which all need an outside partner (see
    // `codeStation`'s doc) — and proves `exclusiveStation` is a real signal,
    // not a synonym for "this task type": a written code is never taken away,
    // so unlike the-hidden-key or a vendor, any number of teams can read the
    // same sign at once.
    key: 'chalk-code',
    // A visible pin on a mission called "the hidden code" would point straight
    // at the sticker and remove the hunt — the exact loophole rule 9 in the
    // file header warns about, and the same fix as the-hidden-key:
    // `hideLocation` + a separate, honestly-rough `locationClue`.
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'locationBased', 'outdoor', 'indoor',
      'park', 'neighborhood', 'school', 'office',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'easy'],
    difficulty: 3,
    transitMinutes: 4,
    setup: [
      {
        field: 'coordinates',
        required: true,
        prompt: 'כתבו קוד בן 4 ספרות במקום קבוע (מדבקה, גיר, פתק עמיד למים), וסמנו כאן איפה. בחרו מקום שישרוד עד סוף המשחק.\n\nWrite a four digit code somewhere fixed (a sticker, chalk, a laminated note), and mark it here. Pick a spot that survives to the end of the game.',
      },
      {
        field: 'locationClue',
        required: true,
        prompt: 'כתבו רמז כללי לאזור שבו הקוד מוסתר, לא את המקום המדויק. אין סיכה על המפה.\n\nWrite a general clue to the area the code is hidden in, not the exact spot. There is no pin on the map.',
      },
      {
        // NOT the shared SET_CODE constant: its second half ("coordinate it in
        // advance with whoever hands it out on the ground") describes a vendor
        // or contact this mission deliberately has none of — the whole point of
        // a self-serve station. Reusing it here would tell the creator to
        // arrange a handoff that doesn't exist.
        field: 'smart.secretCode',
        required: true,
        prompt: 'קבעו את הקוד שכתבתם על המדבקה או הגיר, כדי שהאפליקציה תזהה אותו.\n\nSet the code you wrote on the sticker or chalk, so the app recognises it.',
      },
    ],
    build: () => sited({
      title: 'הקוד הנסתר',
      description: 'איפשהו כאן מוסתר קוד בן 4 ספרות, כתוב או מודבק במקום קבוע. מצאו אותו והקלידו כאן. אל תזיזו אותו, הקבוצה הבאה צריכה אותו במקום.',
      type: 'smart_station',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 100,
      smart: { enabled: true, verificationType: 'code_verification', secretCode: '2468' },
      hideLocation: true,
      locationClue: '',
      // A written code is read, never taken — every team finds the same sign.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Curated 2026-08-26 from public scavenger-hunt/team-building design sources
  // (mechanic-level inspiration only — see the curation log for what was
  // reviewed, rejected, and why). Every entry here was rewritten at least once
  // against rules 14-29 above before shipping; see those rules for the specific
  // draft that produced each one.
  // ══════════════════════════════════════════════════════════════════════════

  // ── A real named practice, not a generic "build something" (rule 3) ───────
  {
    key: 'paper-airplane-trial',
    sourceTemplateKey: 'authored',
    tags: ['action', 'creative', 'camera', 'needsSetup', 'fromAnywhere',
      'home', 'park', 'kids', 'youth', 'adults', 'mixed', 'easy'],
    difficulty: 3,
    minAge: 6,
    setup: [{
      field: 'description',
      required: false,
      prompt: 'המשימה דורשת דף נייר לכל קבוצה, חלקו אותו מראש בהרשמה או בעמדת פתיחה. אפשר גם לערוך את המשימה כך שהיעד יהיה להטיס את המטוס מנקודה אחת לשנייה שתבחרו, במקום מדידה בכפות רגליים.\n\nThis mission needs one sheet of paper per team, hand it out at registration or a start station. You can also edit it so the goal is flying the plane from one point to another you choose, instead of measuring in foot lengths.',
    }],
    build: () => anywhere({
      title: 'מבחן הטיסה',
      description: 'קפלו מטוס נייר וזרקו אותו. הטיסה חייבת לעבור לפחות חמישה אורכי כף רגל, עקב לבוהן, נמדדים מנקודת הזריקה. צלמו את הזריקה ואת המדידה בווידאו.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 80,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },
  {
    // The real fix per rule 17: the pass/fail bar ties to something the team
    // does not control for free (a fixed step count), same discipline as
    // how-many-steps. And per rule 3: a real, named practice, not "carry a
    // thing" — the waiter's race is a genuine restaurant tradition.
    key: 'waiters-race',
    sourceTemplateKey: 'authored',
    tags: ['action', 'needsSetup', 'fromAnywhere',
      'home', 'park', 'kids', 'youth', 'adults', 'mixed', 'easy'],
    difficulty: 3,
    minAge: 6,
    setup: [{
      field: 'description',
      required: false,
      prompt: 'המשימה עובדת הכי טוב עם מגש, צלחת או ספר וחפץ קטן ולא שביר לכל קבוצה. אפשר לחלק אותם מראש, או לתת לקבוצות למצוא בעצמן משהו מתאים.\n\nWorks best with a tray, plate, or book and a small unbreakable object per team. Hand them out in advance, or let teams find something suitable on their own.',
    }],
    build: () => anywhere({
      title: 'מרוץ המלצרים',
      description: 'הושיטו יד אחת קדימה לגמרי, כף היד פונה למעלה. הניחו עליה משטח שטוח (מגש, צלחת או ספר) ועליו חפץ קטן. היד השנייה נשארת בכיס. הלכו 20 צעדים בקול רם, בלי לרוץ ובלי לייצב עם היד השנייה. נפל? התחילו מצעד 0. צלמו הכול בווידאו.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 90,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },

  // ── A real named memory practice — "Kim's Game," not a generic vault ──────
  {
    // The live-swap version this drew from is unshippable per rule 14 (no field
    // declares a real-time facilitator action). Fixed by moving the trick to
    // advance, static creator prep — the same ATTACH_PHOTO trick
    // youth-find-place-one already uses — so nothing needs to happen live.
    key: 'kims-game',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'locationBased', 'indoor', 'outdoor',
      'home', 'kids', 'youth', 'adults', 'corporate', 'mixed', 'medium'],
    difficulty: 5,
    transitMinutes: 3,
    setup: [
      PLACE_IT,
      {
        field: 'media',
        required: true,
        prompt: 'סדרו 5 עד 6 חפצים אמיתיים במקום קבוע וצלמו אותם, זו תמונת ה"לפני". אחר כך שנו דבר אחד (הזיזו, החליפו או הוציאו חפץ) והשאירו את המצב החדש במקום.\n\nArrange 5 to 6 real objects in a fixed spot and photograph them, this is the "before" photo. Then change one thing (move, swap, or remove an object) and leave the new state in place.',
      },
      {
        field: 'choices',
        required: true,
        prompt: 'רשמו את שמות כל החפצים שהופיעו בתמונה, אחד לכל אפשרות.\n\nList the name of every object that appeared in the photo, one per option.',
      },
      {
        field: 'answers',
        required: true,
        prompt: 'הזינו את שם החפץ שהחלטתם לשנות. חייב להתאים בדיוק לאחת האפשרויות שכתבתם.\n\nEnter the name of the object you changed. Must exactly match one of the options above.',
      },
    ],
    build: () => sited({
      title: 'משחק קים',
      description: 'הביטו בתמונה שצורפה למשימה, כך נראה המקום קודם. עכשיו הביטו במציאות שלפניכם ומצאו מה השתנה.',
      type: 'quiz',
      difficulty: 5,
      estimatedMinutes: 6,
      pointValue: 120,
      choices: ['כוס', 'ספר', 'שעון'],
      answers: ['ספר'],
      hint: 'רמז: עברו על הרשימה חפץ אחרי חפץ והשוו לתמונה, לא הפוך.',
      hintPenalty: 15,
      // A fixed display, not a shared object anyone takes — every team compares
      // the same real scene.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ── Honesty-based by design — see rule 29 on why no video is required here ─
  {
    // The shell game itself has no server-checkable answer (rule 14) — accepted
    // as fully honesty-based, same footing as do-someone-a-favour. Backed by
    // real supervision context rather than a video requirement: a birthday
    // party has an organizer naturally nearby, which is the actual
    // accountability here (rule 29).
    key: 'wheres-the-ball',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'action', 'noPrep', 'fromAnywhere',
      'home', 'kids', 'youth', 'mixed', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'איפה הכדור',
      description: 'שחקו במשחק הכוסות: אחד מכם מניח חפץ קטן מתחת לאחת משלוש כוסות, מערבב לפחות חמש פעמים, והשאר מנחשים איפה הוא. שחקו שלושה סיבובים, ואשרו כאן שסיימתם.',
      type: 'self_report',
      difficulty: 4,
      estimatedMinutes: 6,
      pointValue: 90,
    }),
  },

  // ── Real, specific, and survey-able — not genericized away (rule 20) ──────
  {
    key: 'crossing-signal-words',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'locationBased', 'outdoor',
      'neighborhood', 'cityCenter', 'youth', 'adults', 'mixed', 'medium'],
    difficulty: 6,
    transitMinutes: 5,
    setup: [
      PLACE_IT,
      {
        field: 'numericAnswer',
        required: true,
        prompt: 'לחצו בעצמכם על כפתור הרמזור הנגיש שסימנתם, וספרו כמה מילים ההכרזה הקולית אומרת. הזינו כאן את המספר האמיתי.\n\nPress the accessible crossing signal button you marked yourself, and count how many words its voice announcement speaks. Enter the real number here.',
      },
    ],
    build: () => sited({
      title: 'כמה מילים אומר הרמזור',
      description: 'מצאו את הרמזור הנגיש שסומן לכם ולחצו על הכפתור שלו. ספרו בקול כמה מילים ההכרזה הקולית אומרת, והזינו את המספר.',
      type: 'numeric',
      difficulty: 6,
      estimatedMinutes: 5,
      pointValue: 130,
      numericAnswer: 4,
      numericTolerance: 1,
      hint: 'רמז: יש רעש רקע? בקשו מהעוברים והשבים לשתוק לרגע ולחצו שוב.',
      hintPenalty: 20,
      // A public fixture, not a shared object — any number of teams can press it.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },

  // ── A ranking, not a fake timeline — rule 21 ────────────────────────────────
  {
    key: 'celebrants-favorites-ranking',
    // Same real mechanic as invention-order (orderItems), different content and
    // a genuinely different ordering RELATION (preference, not chronology) —
    // family groups them so a composed game never shows both.
    family: 'ordering-quiz',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'fromAnywhere',
      'home', 'kids', 'youth', 'mixed', 'medium'],
    difficulty: 5,
    setup: [{
      field: 'orderItems',
      required: true,
      prompt: 'רשמו 4 עד 5 דברים שהחוגג/ת אוהב/ת (צבע, מאכל, סרט, חיה, משחק), מהכי אהוב עד הכי פחות אהוב, לפי מה שאתם באמת יודעים עליו/ה.\n\nList 4 to 5 things the celebrant loves (a color, food, movie, animal, game), ranked from most to least loved, based on what you actually know about them.',
    }],
    build: () => anywhere({
      title: 'דירוג האהובים של החוגג/ת',
      description: 'דרגו את הדברים האהובים על החוגג/ת מהכי אהוב עד הכי פחות אהוב, לפי מה שאתם יודעים עליו/ה.',
      type: 'quiz',
      difficulty: 5,
      estimatedMinutes: 6,
      pointValue: 110,
      orderItems: ['פיצה', 'שוקולד', 'ברוקולי'],
      hint: 'רמז: לא בטוחים בסדר המדויק? שאלו את ההורים של החוגג/ת.',
      hintPenalty: 15,
    }),
  },

  // ── Ambient knowledge needs no Quick Setup field at all — rule 28 ──────────
  {
    key: 'backwards-name',
    sourceTemplateKey: 'authored',
    tags: ['action', 'camera', 'noPrep', 'fromAnywhere',
      'home', 'kids', 'youth', 'adults', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'מבחן המראה',
      description: 'אמרו את השם של החוגג/ת הפוך, אות אחר אות, בקול רם מול המצלמה. טעיתם? נסו שוב.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 3,
      pointValue: 70,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 20 }),
    }),
  },
  {
    // Same rule 28 principle as backwards-name: no bracket, no setup step — the
    // celebrant's identity is ambient knowledge, not data the platform needs.
    key: 'birthday-wish',
    sourceTemplateKey: 'authored',
    tags: ['finish', 'creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'home', 'kids', 'youth', 'adults', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'איחול לחוגג/ת',
      description: 'כתבו יחד איחול קצר וחם לחוגג/ת, וקראו אותו בקול, ביחד, מול המצלמה.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 4,
      pointValue: 80,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },
  {
    key: 'count-the-candles',
    sourceTemplateKey: 'authored',
    tags: ['camera', 'noPrep', 'fromAnywhere', 'home', 'kids', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'ספירת הנרות',
      description: 'מצאו את העוגה האמיתית של החוגג/ת. צלמו אותה בווידאו, ותוך כדי הצילום ספרו בקול רם כמה נרות יש עליה.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 3,
      pointValue: 70,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 20 }),
    }),
  },

  // ── Young players, no venue, nothing to prepare ───────────────────────────
  //
  // The zero-prep pool skewed towards missions that assume a lot: a stranger who
  // happens to be holding the right thing, a shop window with an odd item in it,
  // an olympiad riddle the creator never wrote. A ten-year-old's game needs
  // missions whose ingredients are the players themselves and nothing else —
  // they are the only ones guaranteed to be there.
  {
    key: 'height-line-up',
    sourceTemplateKey: 'authored',
    tags: ['start', 'teamwork', 'action', 'camera', 'noPrep', 'fromAnywhere',
      'park', 'school', 'beach', 'neighborhood', 'home',
      'kids', 'youth', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'שורה לפי גובה',
      // The no-talking rule is the whole mission (rule 4): ordering a line by
      // height is trivial out loud and genuinely funny in hand signals.
      description: 'הסתדרו בשורה אחת מהנמוך לגבוה, בלי לדבר, רק בסימני ידיים. כשהשורה מוכנה, צלמו אותה מהצד כך שרואים את כולם.',
      type: 'photo',
      difficulty: 2,
      estimatedMinutes: 4,
      pointValue: 60,
      smart: upload(),
    }),
  },
  {
    // The bank had no mission built around a picture the CREATOR supplies, even
    // though attaching one is a control the Builder has always had. It ships
    // with a real, famous default (rule 24 — Quick Setup replaces a working
    // default, never supplies a missing one), so it is fully playable with zero
    // prep, and the optional step lets a creator swap in a statue that actually
    // stands where they are playing.
    key: 'statue-remake',
    sourceTemplateKey: 'authored',
    family: 'recreate-famous-image',
    tags: ['creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'park', 'school', 'home', 'mall', 'cityCenter',
      'kids', 'youth', 'mixed', 'easy'],
    difficulty: 3,
    setup: [{
      field: 'media',
      prompt: 'אפשר לצרף תמונה של פסל או של תמונה מפורסמת שתרצו שהקבוצות ישחזרו. בלי תמונה המשימה עובדת כמו שהיא.\n\nOptional: attach a photo of a statue or a famous picture for the teams to recreate. Without one the mission works exactly as written.',
    }],
    build: () => anywhere({
      title: 'פסל חי',
      description: 'שחזרו בגופכם את הפסל "החושב" של רודן: ישיבה כפופה, מרפק על הברך, אגרוף מתחת לסנטר. אחד מכם הפסל והשאר מבקרים במוזיאון שמצלמים אותו. אם צורפה למשימה תמונה, שחזרו את מה שרואים בה במקום.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 5,
      pointValue: 80,
      smart: upload(),
    }),
  },
  {
    // The bonding beat the bank never had: not a stunt, not a puzzle, just the
    // group hearing something about each other. "Sit down and tell us how it is
    // going" was cut from this bank as padding (rule 11), and rightly — the
    // difference is the constraints: one sentence each, no repeated topic, and
    // everyone has to be in the frame, so it ends somewhere definite.
    key: 'story-round',
    sourceTemplateKey: 'authored',
    tags: ['teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere',
      'park', 'school', 'home', 'beach', 'neighborhood',
      'kids', 'youth', 'mixed', 'easy'],
    difficulty: 3,
    build: () => anywhere({
      title: 'סיבוב סיפורים',
      description: 'סרטון אחד: כל אחד בקבוצה מספר במשפט אחד על משהו מצחיק שקרה לו פעם. אסור שיהיו שני סיפורים על אותו נושא, וכולם חייבים להופיע בסרטון.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 6,
      pointValue: 90,
      smart: upload({ captureKind: 'video', videoMinSeconds: 20, videoMaxSeconds: 60 }),
    }),
  },

  // ── A real payoff behind the puzzle, not an arbitrary word (rule 23) ──────
  // Three difficulty levels of the same mechanic, one real authored anagram
  // each (rule 15 — a mechanic label is not a mission). Named by length, not by
  // a spoiler of the answer.
  {
    key: 'anagram-easy',
    family: 'anagram-riddle',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'noPrep', 'fromAnywhere', 'kids', 'youth', 'mixed', 'easy'],
    difficulty: 3,
    build: () => anywhere({
      title: 'חידת האותיות הקצרה',
      description: 'סדרו מחדש את האותיות הבאות למילה אחת: ן ו ר ת פ. אסור לחפש בגוגל.',
      type: 'quiz',
      difficulty: 3,
      estimatedMinutes: 4,
      pointValue: 80,
      answers: ['פתרון'],
      hint: 'רמז: זו המילה שמתארת בדיוק את מה שאתם מחפשים ברגע זה.',
      hintPenalty: 15,
    }),
  },
  {
    key: 'anagram-medium',
    family: 'anagram-riddle',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'noPrep', 'fromAnywhere', 'youth', 'adults', 'mixed', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'חידת האותיות',
      description: 'סדרו מחדש את האותיות הבאות למילה אחת: ת י ג ת ל. אסור לחפש בגוגל.',
      type: 'quiz',
      difficulty: 5,
      estimatedMinutes: 5,
      pointValue: 110,
      answers: ['תגלית'],
      hint: 'רמז: זו בדיוק המילה שמתארת מה שקורה כשמוצאים דבר חדש.',
      hintPenalty: 20,
    }),
  },
  {
    key: 'anagram-hard',
    family: 'anagram-riddle',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'noPrep', 'fromAnywhere', 'adults', 'corporate', 'mixed', 'hard'],
    difficulty: 7,
    build: () => anywhere({
      title: 'חידת האותיות הארוכה',
      description: 'סדרו מחדש את האותיות הבאות למילה אחת: ק ה ת ר ה פ. אסור לחפש בגוגל.',
      type: 'quiz',
      difficulty: 7,
      estimatedMinutes: 6,
      pointValue: 150,
      answers: ['הרפתקה'],
      hint: 'רמז: זו בדיוק המילה שמתארת את כל המשחק שאתם משחקים עכשיו.',
      hintPenalty: 25,
    }),
  },

  // ── A worked, unambiguous instruction — rule 25's standard ────────────────
  {
    key: 'the-combination-lock',
    family: 'combination-lock',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'locationBased', 'outdoor',
      'cityCenter', 'neighborhood', 'adults', 'corporate', 'hard'],
    difficulty: 7,
    transitMinutes: 6,
    setup: [
      PLACE_IT,
      {
        field: 'description',
        required: true,
        prompt: 'החליפו את הסוגריים בתיאור מדויק של שלוש התצפיות שבחרתם (למשל: חלונות בקיר X, שתי הספרות האחרונות בשלט Y, עצים בטווח הראייה). אל תמחקו את שאר ההוראות.\n\nReplace the brackets with an exact description of the three observations you chose (e.g. windows on wall X, the last two digits on sign Y, trees in view). Don\'t delete the rest of the instructions.',
      },
      {
        field: 'answers',
        required: true,
        prompt: 'בחרו 3 תצפיות באתר וסקרו אותן בעצמכם: ספרה 1 = חלונות בקיר שבחרתם. ספרה 2 = שתי הספרות האחרונות בשלט שבחרתם. ספרה 3 = עצים או ספסלים בטווח ראייה. חברו לקוד, למשל 483, והזינו כאן.\n\nChoose 3 real observations on site and survey them yourself: digit 1 = windows on a wall you choose. Digit 2 = the last two digits on a sign you choose. Digit 3 = trees or benches in view. Combine into a code, e.g. 483, and enter it here.',
      },
    ],
    build: () => sited({
      title: 'מנעול המספרים',
      description: 'בשטח מוסתרות שלוש תצפיות: [הוראות ליוצר: תארו כאן בדיוק מה לספור או לקרוא בכל אחת]. בצעו את כולן וחברו את התוצאות לקוד בן שלוש ספרות.',
      type: 'quiz',
      difficulty: 7,
      estimatedMinutes: 12,
      pointValue: 170,
      answers: ['483'],
      hint: 'רמז: התחילו מהתצפית הכי קלה לספור, ורשמו כל ספרה בצד לפני שמחברים.',
      hintPenalty: 25,
      // A public spot, not a shared object — any number of teams can arrive.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
  {
    // Identical-kit-per-team, same precedent as challenge-shampoo-pitch — no
    // hunting, no scarcity, every team assembles their own copy.
    key: 'puzzle-code',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'teamwork', 'needsSetup', 'fromAnywhere', 'adults', 'corporate', 'hard'],
    difficulty: 7,
    setup: [{
      field: 'answers',
      required: true,
      prompt: 'הדפיסו תמונה זהה לכל קבוצה וגזרו אותה ל 6 עד 8 חלקים. כתבו תו אחד בפינת הגב של כל חלק, וקבעו מראש סדר קריאה. הזינו כאן את הקוד שמתקבל מהרכבה נכונה.\n\nPrint an identical image per team and cut it into 6 to 8 pieces. Write one character in the back corner of each piece, and decide a reading order in advance. Enter the code a correct assembly produces here.',
    }],
    build: () => anywhere({
      title: 'פאזל הקוד',
      description: 'הרכיבו את הפאזל שקיבלתם לתמונה שלמה. הפכו את החלקים וקראו את התווים בגב, לפי סדר ההרכבה. הקלידו את הקוד שמתקבל.',
      type: 'quiz',
      difficulty: 7,
      estimatedMinutes: 10,
      pointValue: 160,
      answers: ['ABCD1234'],
      hint: 'רמז: הרכיבו קודם לפי הצבעים והצורות שבתמונה, ורק אז הפכו לקרוא את הקוד.',
      hintPenalty: 20,
    }),
  },
  {
    key: 'mystery-gift',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'fromAnywhere', 'home', 'kids', 'mixed', 'easy'],
    difficulty: 3,
    minAge: 6,
    setup: [{
      field: 'answers',
      required: true,
      prompt: 'עטפו חפץ קטן ולא שביר בעטיפה אטומה. כתבו כאן בדיוק מה זה, במילה אחת או שתיים.\n\nWrap a small, unbreakable object in opaque wrapping. Write here exactly what it is, in one or two words.',
    }],
    build: () => anywhere({
      title: 'מתנת התעלומה',
      description: 'קיבלתם חבילה עטופה. מותר למשש, לשקול ולטלטל בעדינות, אסור לפתוח את העטיפה. לקבוצה ניחוש אחד בלבד: הקלידו מה אתם חושבים שיש בפנים.',
      type: 'quiz',
      difficulty: 3,
      estimatedMinutes: 4,
      pointValue: 90,
      answers: ['כדור'],
      hint: 'רמז: המשקל והקול בטלטול אומרים יותר מהצורה.',
      hintPenalty: 15,
    }),
  },
  {
    // Rule 19: every balloon of the ONE chosen color carries the same code, so
    // there is never a "which one is correct" ambiguity for the team.
    key: 'balloon-message',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'fromAnywhere', 'home', 'kids', 'mixed', 'medium'],
    difficulty: 4,
    setup: [
      {
        field: 'description',
        required: true,
        prompt: 'החליפו את הסוגריים בצבע הבלונים שבחרתם. אל תמחקו את שאר ההוראות.\n\nReplace the brackets with the balloon color you chose. Don\'t delete the rest of the instructions.',
      },
      {
        field: 'answers',
        required: true,
        prompt: 'נפחו כמות גדולה של בלונים. בחרו צבע אחד (זה שכתבתם בתיאור). לתוך כל בלון מהצבע הזה, ורק בצבע הזה, הכניסו פתק עם אותו קוד. ערבבו עם בלונים בצבעים אחרים. הזינו כאן את הקוד שכתבתם.\n\nInflate a large batch of balloons. Choose one color (the one in the description). Inside every balloon of that color only, place a note with the same code. Mix them with balloons of other colors. Enter the code you wrote here.',
      },
    ],
    build: () => anywhere({
      title: 'הודעת הבלון',
      description: 'בין כל הבלונים, מצאו בלון בצבע [הוראות ליוצר: כתבו כאן את הצבע שבחרתם]. פתחו אותו (בניפוץ או בפתיחת הקשר, לבחירתכם) והוציאו את הפתק. נקו את השאריות אחריכם. הקלידו כאן את הקוד שרשום על הפתק.',
      type: 'quiz',
      difficulty: 4,
      estimatedMinutes: 5,
      pointValue: 100,
      answers: ['1234'],
      hint: 'רמז: הבלון שלכם תמיד יהיה בצבע שנכתב למעלה. אין צורך לבדוק בלונים בצבעים אחרים.',
      hintPenalty: 15,
    }),
  },
  {
    // Fixed color order baked into the mission itself (not creator-configurable)
    // so there is never ambiguity about which order the digits combine in —
    // rule 19.
    key: 'color-code-trail',
    family: 'combination-lock',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'needsSetup', 'locationBased', 'outdoor', 'indoor',
      'home', 'park', 'kids', 'mixed', 'medium'],
    difficulty: 5,
    transitMinutes: 5,
    setup: [
      {
        field: 'locationClue',
        required: true,
        prompt: 'כתבו רמז כללי לאזור שבו מוחבאים ארבעת החפצים (למשל "בחצר" או "בבית"). אין סיכה מדויקת על המפה.\n\nWrite a general clue to the area where the four objects are hidden (e.g. "in the yard" or "in the house"). There is no exact pin on the map.',
      },
      {
        field: 'answers',
        required: true,
        prompt: 'החביאו ארבעה חפצים, אחד בכל צבע, תמיד באותו סדר: אדום, כחול, צהוב, ירוק. כתבו ספרה (0 עד 9) על כל חפץ. חברו לפי הסדר הזה, למשל 3719, והזינו כאן.\n\nHide four objects, one per color, always in this order: red, blue, yellow, green. Write a digit (0 to 9) on each. Combine in that order, e.g. 3719, and enter it here.',
      },
    ],
    build: () => sited({
      title: 'שביל הצבעים הסודי',
      description: 'ארבעה חפצים צבעוניים מוחבאים כאן, כל אחד עם ספרה. מצאו את כולם וחברו את הספרות לקוד אחד, תמיד לפי הסדר: אדום, כחול, צהוב, ירוק.',
      type: 'quiz',
      difficulty: 5,
      estimatedMinutes: 10,
      pointValue: 130,
      answers: ['3719'],
      hint: 'רמז: שכחתם את הסדר? הצבעים תמיד: אדום, כחול, צהוב, ירוק.',
      hintPenalty: 20,
      hideLocation: true,
      locationClue: '',
      // The objects stay hidden and readable for every team — nothing is taken.
      maxConcurrentTeams: OPEN_SPACE_CAPACITY,
    }),
  },
];
