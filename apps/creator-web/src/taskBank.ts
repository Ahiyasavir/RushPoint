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
// ═════════════════════════════════════════════════════════════════════════════
// PRE-FLIGHT — run this, not the whole file
// ═════════════════════════════════════════════════════════════════════════════
//
// The guide below is 73 numbered rules and about ninety minutes of reading. That
// is a reference, not a procedure, and Gawande's finding about checklists
// applies exactly: a list that tries to document everything fails, because it
// trains people to stop reading it. Good ones are five to nine items and carry
// only the KILLER ITEMS — the steps that are both critical and actually get
// missed.
//
// MEASURED, not asserted: the nine items below are 502 words, about two and a
// half minutes. That is over Gawande's sixty-to-ninety seconds, and the
// difference is deliberate — his figure is for a surgical pause point with a
// patient open on the table. Two and a half minutes before writing a mission
// that goes out to every creator on the platform is cheap. It is recorded so the
// next person to add an item knows what they are spending.
//
// So this is the list. It is DO-CONFIRM, not READ-DO: write the mission from
// your own judgement first, then stop and run these against it. Each points at
// the rule that carries the reasoning and the evidence; go there when an item
// fires, not before.
//
//   1. WHAT DOES THE TEAM DECIDE, what could they be GOOD at, and what do they
//      know about each other afterwards? Zero of three is the definition of a
//      stupid mission. One is the line.                             → rule 52
//
//   2. Could ONE PLAYER do this while the others watch? If yes, rewrite it so
//      each person contributes one element and ALL of them must appear in the
//      result. That one clause also fixes reciprocity, blocking and status.
//                                                        → rules 33, 62, 68, 70
//
//   3. Does it make somebody conspicuous in public? Then it needs a cover: a
//      character, a display of competence, or an errand that makes approaching
//      someone socially legible. Write a sentence of fiction before you touch a
//      tag.                                                          → rule 51
//
//   4. Did you ask for something to be creative, original, funny or convincing?
//      Delete it and name the target instead. "Do your best" is the weakest
//      instruction there is, and asking for originality makes the work worse.
//                                                             → rules 64, 67
//
//   5. Can the team tell whether they did it WELL, without asking anybody? An
//      auto-approved upload says nothing about quality, so the criterion has to
//      be in the text. And never promise points the scoring cannot pay.
//                                                                    → rule 60
//
//   6. If there is a target or a spotlight, WHOSE is it? A number on one named
//      person in public is a threat, not a goal.                     → rule 69
//
//   7. Does a stranger appear in it? Then the text asks their permission and
//      says what the picture is for — and does not script their refusal.
//                                                                → rules 71, 49
//
//   8. Read it back and delete: the sentence that handles failure, the one that
//      sets a size nothing enforces, and the one that grants permission.
//                                                                    → rule 49
//
//   9. FOR A FINISHER ONLY: say out loud what the group is holding as they walk
//      away. "A photo of themselves standing still" is not an ending.
//                                                                    → rule 55
//
// DELIBERATELY ABSENT: the tag laws (rules 41-42), the unpayable-bonus check
// (rule 60's second half) and the public-photography ask (rule 71's) are all
// enforced by scripts/test-task-bank-tag-laws.ts. A machine already runs them on
// every commit, so spending a human's attention there would buy nothing and cost
// two of the nine slots.
//
// IT WORKS, and the evidence is embarrassing in the useful way. Two mission
// drafts written two nights before this list existed
// (docs/mission-drafts-relatedness-ladder.md) were re-audited against it. Item 2
// found that one of them handed the whole mission to whoever spoke fastest, and
// item 6 found that its "three out of five" target was a public score on one
// named person's round — a group announcing it does not know them. Both were
// invisible to the person who wrote them, who had just spent the evening arguing
// for the rules that catch them. That is the case for DO-CONFIRM: an author is
// the last person able to see what their own draft is missing, and a short fixed
// list asked afterwards is what closes the gap.
//
// ─── Where the rules disagree with each other ────────────────────────────────
//
// Four known tensions. None is an error; each is two true things meeting, and a
// reader who hits one should know it is charted rather than assume they have
// misread something.
//
//   46 ↔ 67   Constraints multiply failure (46) but a blank instruction has no
//             pull (67). Creativity peaks at MODERATE constraint, so these are
//             the two walls of one corridor rather than opposing advice.
//   48 ↔ 61   A ladder of escalating disclosure needs several rungs; two
//             missions sharing a mechanic are duplicates and the composer will
//             place only one. Resolved by rule 66: rungs escalate through
//             different VERBS.
//   57 ↔ 73   Give a mixed-age mission a second, literal route (57) versus
//             Tilden's "children need a separate programme, not a dilution"
//             (73). The audience tags decide which applies — see rule 73.
//   64 ↔ 69   Name a specific difficult target (64) versus never put a public
//             number on one named person (69). Targets belong to groups. This
//             one was found by applying 64 faithfully and making a mission
//             worse, which is why it is written down.
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
// ─── 3. Name the real thing, and do not genericise it back ──────────────────
//
// "מגדל מהשטח" — build the tallest tower from found materials — became "רוג׳ום":
// a cairn. Same act, but a cairn is a real practice with a real name, a real
// place (a trail, a forest) and a real purpose (marking a route). Generic
// framing produces generic missions. Reach for the specific noun, the real
// custom, the actual object.
//
// AND DO NOT RETREAT TOWARD PORTABILITY. (This absorbed rule 20 on 2026-09-02;
// rule 20 had itself opened by saying "rule 3 already says this".) The first
// draft of "ספירת האות" asked players to count any repeating thing they liked.
// More portable than the shipped version, and worse — genericising a concrete
// idea into an abstract template throws away the thing that made it memorable.
// The shipped version names one real, recognisable device, an accessible
// pedestrian-crossing signal, and asks how many WORDS its announcement speaks:
// something a creator can point at, survey once, and hand over with total
// confidence. A mission that only fits venues with the right real feature is
// fine (rule 8) — the creator surveys it, exactly as how-many-steps already
// does. "Works at any venue" is not a virtue worth paying for.
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
// ─── 20. → merged into rule 3 (2026-09-02) ──────────────────────────────────
//
// "Real and specific beats generic and adaptable" was always one clause hanging
// off rule 3, and said so in its own first paragraph. It now lives there. Kept
// as a pointer rather than removed because entry comments and rule 64 cite this
// number, and rule 74 forbids two rules saying one thing.
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
// ═════════════════════════════════════════════════════════════════════════════
// RULES 33+ — added after a research pass (2026-09-01) that measured this bank
// against the design literature it had never been checked against: escape-room
// design (Nicholson's "Ask Why"; the Codex's 13 rules), puzzle-hunt construction
// (MIT Mystery Hunt), cooperative board-game design (the quarterbacking
// problem), pervasive and urban games (the Situationist dérive), heritage
// interpretation (Tilden), orienteering course setting, and the two largest
// public mission libraries (GooseChase, GISH).
//
// Rules 1-32 were each taught by one rejected mission. These were taught by
// measuring the WHOLE bank against an outside standard, so each names the count
// that indicts us rather than a single draft. Same contract though: a rule that
// does not change what you would write does not belong here.
// ═════════════════════════════════════════════════════════════════════════════
//
// ─── 33. The one-person test: a mission one player can finish alone is not a
//         team mission, it is a solo mission with an audience ─────────────────
//
// Cooperative game design has a name for what this causes — QUARTERBACKING: one
// confident player takes over and everybody else quietly stops participating. It
// is the defining defect of co-op design, and this bank is full of it.
// "Photograph X" is one person with a phone. "What is the answer" is whoever
// knows. "Record a video explaining Y" is whoever talks. The rest stand there.
//
// This explains the team-building research better than "some people are shy"
// does: about half of participants report forced-fun activities as uncomfortable,
// and the ones who disengage are disproportionately the analytical and the
// introverted. They are not refusing to play. They have no job.
//
// THE TEST: can one member complete this alone while the others watch? If yes,
// it is not a team mission.
//
// Four fixes that actually work, strongest first:
//   • SPLIT THE INFORMATION — nobody can direct what they cannot see. This is
//     why Hanabi cannot be quarterbacked at all. `silent-briefing` already does
//     it and is the strongest team mission in the bank.
//   • REQUIRE CONSENSUS as the gate, explicitly not a majority vote —
//     `team-decision-drill`.
//   • REQUIRE SIMULTANEITY so nobody can be delegated to — `human-letter`,
//     `everyone-hidden`, `open-everyone-airborne`.
//   • REQUIRE A DISTINCT CONTRIBUTION per member (one word each, one object
//     each) so a missing member is visible in the result.
// A mission that takes none of the four can still be a fine quick beat — it just
// must not be counted as teamwork content when the bank is audited.
//
// ─── 34. A located mission PROVOKES curiosity about the place; it does not TEST
//         you on it ─────────────────────────────────────────────────────────
//
// Two independent sources, one claim. Freeman Tilden, who founded heritage
// interpretation: the chief aim is not instruction, but provocation. Scott
// Nicholson's escape-room rule: ask why this puzzle would exist in this world at
// all.
//
// A rejected design pass for this bank proposed "find the asset number stamped
// on the lamp post and type it". Perfectly location-specific, perfectly
// verifiable, and nobody would ever want that number — data entry wearing a
// mission's clothes. Once you look for the shape it is everywhere: it is what
// separates `count-the-shops` (a chore with a checkable answer) from
// `school-then-and-now` (which changes what you see when you look up).
//
// The check is NOT "is the answer specific to this place". It is "does doing
// this make the place more interesting than it was a minute ago". A mission that
// only proves you stood somewhere is a geofence with extra typing.
//
// ─── 35. The stranger is a CO-STAR, not an audience ──────────────────────────
//
// The bank has a healthy number of stranger missions and every one of them casts
// the stranger the same way: they watch (`youth-breaking-news`), they are
// questioned (`thirty-second-interview`), or they are the subject
// (`honest-compliment`). The stranger is a prop with a pulse.
//
// The best-loved missions in the largest public library run the other way — the
// stranger DOES something with the team: gives a piggyback, races them 100m,
// gets taught a dance move the team invented thirty seconds ago, joins the team
// photo as though they had been on the team all along. That is the difference
// between a performance and a meeting, and the meeting is what people are still
// telling each other about a week later.
//
// Writing a stranger mission, ask what the stranger GETS TO DO. If the honest
// answer is "stand there", rewrite it. (Rule 39 still applies — a stranger
// mission is the highest social-risk thing this bank asks for.)
//
// ─── 36. "Find something genuinely rare" is a whole category, and it has to be
//         PRICED ────────────────────────────────────────────────────────────
//
// The bank has zero of these. A rare-find mission — a coin from a named year, a
// stranger who shares a teammate's name, two people who could pass for twins —
// costs nothing to prepare, plays at any venue, verifies with one photo, and
// produces the single best moment in a hunt: the shout when somebody actually
// finds it. Luck plus hustle is a different engine from anything else here.
//
// It only works if the scoreboard admits it was harder. `pointValue` currently
// runs 50-170 with almost everything between 90 and 130 — a spread too flat to
// mean anything. The reference library prices its rarest find at 2.5x baseline.
// A rare find that scores like a group selfie teaches players that hustling was
// pointless.
//
// Rule 31 still binds: the thing has to be plausibly out there. "A coin from a
// year the CREATOR picks" is safe precisely because the creator picks the year;
// "a red vintage motorbike" is not.
//
// ─── 37. Give the team a DECISION, not only an instruction — and know which
//         decisions this product can actually carry ──────────────────────────
//
// "A game is a series of interesting decisions" (Meier). Every mission in this
// bank has exactly one path: read it, do it, submit. At no point does a team
// choose, trade something off, or get to be wrong about STRATEGY rather than
// execution.
//
// The obvious fix is the Amazing Race DETOUR — two missions, one physical and
// one mental, of which a team may complete only one. The platform has the
// mechanic (`Stage.exclusiveGroups`) and the composer deliberately does not emit
// it: composeGame.ts lists "no exclusiveGroups" among the invariants that make
// its output launch-valid by construction. So a Detour is a COMPOSER change with
// its own validator work — NOT a pair of entries somebody adds to this file and
// hopes will be paired. See rule 16 before designing around it.
//
// What a single entry CAN carry today, and what new missions should reach for:
//   • a constraint the team CHOOSES and commits to before starting, where the
//     harder choice is worth more and the copy says so;
//   • a choice of target among several the creator listed;
//   • a "bank it or keep going" beat, where continuing risks the time already
//     spent.
// The choice must be made BEFORE the outcome is known. Otherwise it is not a
// decision, it is a preference.
//
// ─── 38. Home is a venue, not a fallback ─────────────────────────────────────
//
// This product is not only a city race. A family in a living room on a rainy
// afternoon, a birthday party in a flat, siblings in a back yard — a real
// audience running real events, and a mission written for them is a FIRST-CLASS
// mission, not a degraded outdoor one. Sixteen of eighty-nine entries carry
// `home`, and most of those arrived as birthday-party content rather than as a
// considered band of its own.
//
// What a home mission needs, on top of every other rule here:
//   • `home`, plus `fromAnywhere` (there is nowhere to walk to), plus honest
//     audience tags — a living-room game is usually `kids` AND `mixed`, because
//     the adults are playing too, not supervising.
//   • Ingredients a home certainly holds — rule 31 is STRICTER indoors, because
//     a flat has no fallback: a blanket, cutlery, a book, a phone torch, a
//     chair, a mirror. Never "something a passer-by is carrying".
//   • No assumed crowd, shop, sign or street. `crowded`, `cityCenter` and `mall`
//     are not substitutes for `home`, and a mission tagged both usually means
//     neither was thought about.
//   • Noise, mess and breakage a flat can survive (rule 22 covers the byproduct;
//     indoors it also covers the neighbours).
// Rule 32 already found the shape that travels best: missions made of the
// PLAYERS rather than of the venue work indoors and outdoors alike.
//
// ─── 39. Social risk needs a ramp, and the ramp belongs to the composer ──────
//
// Graduated-exposure research is unambiguous: people will attempt an
// uncomfortable social act far more readily after two smaller ones, and refuse
// it cold. Our entries carry no notion of social risk at all, so the composer
// can open a game with "walk up to a stranger" — the mission most likely to be
// silently skipped, placed exactly where a refusal sours everything after it.
//
// This is a composer-level gap, recorded here because the MISSION AUTHOR is the
// one who knows the answer: when an entry asks a player to approach strangers or
// to be looked at by them, say so in its comment. Until the composer scores it
// the ordering has to be done by whoever curates a template — but the
// information has to exist before anything can use it.
//
// ─── 40. The team must KNOW it is right before it submits, and the aha has to
//         outweigh the grind ─────────────────────────────────────────────────
//
// Two rules from puzzle construction that this bank has so far satisfied by luck
// rather than on purpose.
//
// SELF-VALIDATING: a solved puzzle should FEEL solved. If a team can enter a
// plausible answer with no idea whether it is the one, every wrong attempt reads
// as "the game is broken" rather than "we are not there yet". Numbers are the
// worst offenders — "how many benches" has no click to it, which is why the
// counting missions need generous tolerances and pinned wording (rule 8). A
// word, a name, or a code read off a real object validates itself.
//
// AHA OVER GRIND: a puzzle is one insight plus some labour, and the fun is
// entirely in the insight. Once a team knows HOW, finishing should take about
// five minutes; past that the mission is charging them for work they have
// already proved they can do. If the method is obvious and the remaining ten
// minutes are execution, it is not a puzzle — price and tag it as the errand it
// is.
//
// ═════════════════════════════════════════════════════════════════════════════
// RULES 41+ — added after the first OPERATOR editing pass (2026-09-01), the day
// /admin/mission-bank shipped. Rules 1-32 were each taught by a rejected draft;
// 33-40 by measuring the whole bank against outside design literature. These
// were taught by watching the bank's owner edit and delete live entries in the
// console — the first evidence from somebody using this bank as a PRODUCT rather
// than reading it as a file, which turns out to catch a different class of fault
// entirely. Twenty-six missions were touched in one sitting: 22 edited, 4 cut.
//
// Read 41-43 as one family (the tags were wrong, and wrong in patterns), 44-47
// as another (the mission could not actually be finished or judged), and 48-50
// as the editing pass itself (what a second reader deletes).
// ═════════════════════════════════════════════════════════════════════════════
//
// ─── 41. A tag that restates a structural fact is DERIVED, never picked ───────
//
// Two of this bank's tags are not opinions about a mission, they are restatements
// of something already true about it — and every hand-maintained restatement
// eventually disagrees with the thing it restates.
//
//   • `camera` means "handed in as a photo or a video", i.e. the task type.
//     ELEVEN missions submitted a photo without carrying it. The operator found
//     four of the eleven by eye (elevator-pitch, local-legend, office-olympics,
//     trade-up) — which is exactly the arithmetic that says a human should not
//     be doing this job.
//   • `easy`/`medium`/`hard` is the 1-10 `difficulty`, banded. The authored bank
//     had never once disagreed across 103 entries. The admin editor offered the
//     number and the tag list as two independent controls and produced the drift
//     within a day: trade-up moved to 8 and stayed tagged `medium`, and
//     open-everyone-airborne moved to 4 and stayed tagged `easy`.
//
// Neither drift is visible anywhere. The composed game paces off the NUMBER and
// the creator filters on the TAG, so a mission that disagrees with itself simply
// lies to one of them and nothing looks broken.
//
// Both are now derived rather than trusted: `difficultyBandFor` /
// `withDifficultyBand` in bankTags.ts are the single mapping, imported by
// scripts/test-task-bank-tag-laws.ts, by the overlay merge and by the admin
// form — which no longer offers either tag group for picking at all. Adding a
// third tag of this kind means adding it there, not maintaining it by hand here.
//
// ─── 42. An untagged place is a place the mission is never offered in ─────────
//
// The composer can only offer what is tagged, so an area tag is not a
// description of where a mission suits — it is the whole list of venues where it
// can ever be chosen. A mission that genuinely works anywhere but carries only
// `home` is, in every way that matters, a home mission.
//
// The operator's single largest category of edit was adding places. open-team-
// motto and open-everyone-airborne — "each of you says one word", "everyone off
// the ground at once" — went from one area tag to nine plus `indoor` and
// `outdoor`. Nothing about either mission ever needed a venue; they were simply
// never offered at a mall, an office or a school.
//
// The duty runs both ways, and the second half is the one that keeps the first
// honest: tag a place only where the mission's PROPS exist there. office-
// olympics lost `school` in the same pass, because a school does not have office
// chairs and swivel races. `indoor` is not a synonym for "any room".
//
// ─── 43. Audience tags encode how a mission READS to that group, not whether
//         they are capable of it ─────────────────────────────────────────────
//
// Every audience mis-tag in the pass was the same mistake: the tag had been set
// from what the players could physically do, when the thing that decides whether
// a mission lands is what doing it makes them feel like in front of other people.
//
//   • TEENAGERS ARE THE SELF-CONSCIOUS AUDIENCE. `youth` came off silliest-walk,
//     open-team-name and finish-podium — a silly walk, a summer-camp team name,
//     a medal-podium pose. Fourteen-year-olds can obviously do all three and
//     will not, in public, in front of each other. The same pass ADDED `youth`
//     to elevator-pitch, oldest-thing-here and open-team-motto: a pitch, an
//     observation, a motto. Teens accept missions that treat them as older and
//     refuse missions that treat them as younger. A mission whose content is
//     "be cute where people can see you" is a `kids` mission. Note this is the
//     exact inverse of rule 32, which is about ten-year-olds — the two ages want
//     opposite things and `mixed` is not a way to avoid choosing.
//   • `adults` IS A PARTY; `corporate` IS A WORKPLACE. elevator-pitch kept
//     `corporate` and lost `adults`. It is not that grown-ups cannot pitch — it
//     is that a business exercise is not what a group of adults came to a
//     birthday to do. The two tags are different rooms, not two sizes of the
//     same room.
//   • THE SAME ACT READS DIFFERENTLY BY AGE. honest-compliment — walk up to a
//     stranger and pay them a genuine compliment — lost `adults` while keeping
//     `youth` and `mixed`. Charming from a teenager on a scavenger hunt;
//     something else entirely from a forty-year-old approaching a stranger. When
//     a mission involves a member of the public, ask what the STRANGER sees, not
//     only what the player is willing to do (rule 35 is about the same moment
//     from the other side).
//
// ─── 44. The proof has to contain the team ───────────────────────────────────
//
// odd-one-planted asked the team to photograph the planted object. It was
// changed to photograph THEMSELVES WITH it, and the edit is worth more than it
// looks: a picture of an object is evidence that the object exists, which was
// never in doubt and which any phone can produce without leaving the sofa. A
// picture with the team in it is evidence they stood where the mission is.
//
// This is not only anti-cheat. Every photo mission is also the album the group
// looks at afterwards, and a folder of un-peopled objects is nobody's souvenir.
// If a photo mission's frame does not have to contain a player, ask whether the
// mission is really about being somewhere at all.
//
// ─── 45. Size the search to the time you priced it at ────────────────────────
//
// exact-count asked for the number of benches within a hundred metres. It now
// asks within forty. A hundred-metre radius is roughly three hundred running
// metres of perimeter to cover twice for a number a team must agree on, priced
// at seven minutes — so the mission was not hard, it was long, and the two feel
// completely different to the people doing it (rule 40, aha over grind).
//
// Before shipping a counting or searching mission, walk its radius in your head
// at the pace of a group that is also talking to each other, and then halve it.
//
// ─── 46. Count the ways it can fail before you count the ways it is clever ───
//
// chain-reaction was cut, and it is the most instructive deletion of the pass
// because every individual part of it was fine. Build a chain of at least three
// actions, out of found objects (a bottle, a bag, a shoe, a stone, a branch),
// each one triggering the next, no hands after it starts, filmed in a single
// unbroken take. Five constraints, each defensible, each one a way for the whole
// thing to end in nothing. Rule 17 says a constraint must cost something; this
// one says the costs MULTIPLY, and a mission whose likeliest outcome is a team
// giving up after four attempts is a mission that produces no photo, no points
// and no story.
//
// The check is arithmetic, not taste: list the ways the mission can fail to
// produce a submission. More than two and it belongs to the hardest slot of the
// game or nowhere.
//
// ─── 47. A success nobody can adjudicate is not a success ────────────────────
//
// frozen-genre was cut: pick a genre, build one frozen frame that tells a scene
// from it, and "whoever looks at it should be able to identify the genre without
// being told". There is no whoever. The submission is an auto-approved photo, so
// the sentence describing success names a judge the platform does not have
// (rule 14) and gives the team no way to know they are done (rule 40).
//
// Recorded separately from those two because it is the DELETION test rather than
// the authoring test: when a mission has already been written, read its success
// sentence and name the person who checks it. If the answer is "someone", cut
// the mission rather than rewriting the sentence — the sentence is usually the
// only thing that made the idea sound finished.
//
// ─── 48. Two missions with the same MECHANIC are duplicates, whatever their
//         families say ───────────────────────────────────────────────────────
//
// finish-one-word-each ("each of you says one word about today") was cut in the
// same pass that re-pointed open-team-motto ("each of you says one word that
// describes the team") from `start` to `finish`. They are one mission. Rule 12
// exists precisely to stop this and did not fire, because `family` had been
// assigned by SURFACE — one was tagged `closing-round`, the other carried no
// family at all — while the collision was in the mechanic underneath.
//
// So: a family is named for what the players DO, not for where the mission sits
// or what it is about. Before adding a mission, say its mechanic out loud in six
// words ("each person contributes one word", "hold a pose and photograph it",
// "ask a stranger for something") and grep the bank for that, not for its title.
//
// ─── 49. Cut the sentence that handles failure, the one that sets a size, and
//         the one that grants permission ──────────────────────────────────────
//
// By volume, the operator's commonest single action was deleting a clause, and
// the clauses fell into four kinds. Rule 11 already says delete padding; this
// says which sentences are padding, because every one of these was written in
// good faith by an author trying to be helpful.
//
//   • FAILURE HANDLING. "If he refuses, thank him and find another." The team
//     will work that out. Writing it down tells them refusal is expected, which
//     is the one thing you did not want them thinking about beforehand.
//   • UNVERIFIABLE COUNTS. "at least three different people" (human-gps), "at
//     least one satisfied customer" (ad-for-nothing). Nothing checks these, so
//     they are not constraints — they are anxiety. Contrast the counts that ARE
//     the mission and stayed: five things of one colour, three rounds.
//   • SIZE SPECS. "a thirty-second advert" became just an advert. A duration the
//     platform does not enforce is a number the team now has to worry about.
//   • PERMISSION. "Serious, funny, or both — your decision." Anything of the
//     form "it can be X or Y" is the author reassuring themselves that the
//     mission is flexible. The team already knew.
//
// One more, the same instinct pointed forwards: ASK FOR THE GOOD VERSION.
// thirty-second-interview asked a stranger for the worst advice they had ever
// received and now asks for the best. Same mechanic, same difficulty, and one of
// them sends a team to interrupt somebody's afternoon with a request to be
// negative on camera.
//
// ─── 50. Never assign roles by count — you do not know how many players are
//         standing there ───────────────────────────────────────────────────────
//
// finish-podium staged a medal ceremony: "who gets gold, who gets silver, who
// gets bronze". That sentence is only playable by a team of exactly three. Two
// players read it as a mission they cannot do properly; five read it as two of
// them standing out of frame. It came out, and the mission's difficulty went
// from 4 to 2 in the same edit — the whole of the difficulty was the casting.
//
// Team size is a property of the RUN, not of the bank (rule 33 leans on the same
// fact from the other direction). Write for "the group", give roles by function
// where a role is genuinely needed ("one of you films"), and never by enumerating
// them.
//
// ═════════════════════════════════════════════════════════════════════════════
// RULES 51+ — added during an overnight research pass (2026-09-02) that went
// looking for the MECHANISM under rule 43. That rule recorded a real pattern —
// teenagers refuse missions that make them look foolish — but "teens are
// self-conscious" is an observation, not something you can design against. It
// gives you one move, deleting the `youth` tag, and the bank lost three decent
// missions to it in an afternoon.
//
// The mechanism turns out to be well documented in two literatures that have
// never been pointed at each other, and once it is named the same evidence
// yields a much better move than deleting a tag.
// ═════════════════════════════════════════════════════════════════════════════
//
// ─── 51. Exposure needs a cover, and there are exactly two: a character, or
//         competence ───────────────────────────────────────────────────────────
//
// THE MECHANISM. Developmental psychology calls it the IMAGINARY AUDIENCE
// (Elkind, 1967): from roughly eleven to fifteen, a person believes they are
// being watched and judged more or less continuously, and behaves accordingly.
// It is a stage, not a personality, and it peaks across exactly the ages this
// bank serves — the youth band, and the whole of the 10-15 birthday product.
// A fourteen-year-old refusing to do a silly walk in the street is not being
// difficult and is not too cool for the game. They are doing arithmetic about an
// audience they cannot switch off.
//
// THE FIX HAS A NAME. Nordic larp calls it ALIBI: the permission a portrayed
// character gives you to do something you would never do as yourself, because
// the act belongs to the role. Larp designers treat alibi as something the
// design SUPPLIES, not something the player brings — the surrounding fiction has
// to make the role legitimate (the same literature calls that its "aura"), and
// characters whose whole job is to hand other players permission are a standard
// tool.
//
// OUR OWN BANK IS THE PROOF, and the correlation is close to total. Every
// high-exposure mission that survived the operator's editing pass with `youth`
// intact carries a fiction the act belongs to:
//
//     youth-great-escape    "you are in the climax of an action film"
//     youth-breaking-news   "one of you is a TV reporter, the rest are extras"
//     statue-remake         "one of you is the statue, the rest are museum
//                            visitors photographing it" — even the photographer
//                            is given a part to play
//     finish-the-credits    "film the closing scene of your film"
//
// Every high-exposure mission he stripped `youth` from has no fiction at all:
//
//     silliest-walk         "invent a funny walk and walk it"  — that is you,
//                            being funny, in the street, as yourself
//     open-team-name        "film all of you shouting your battle cry"
//     finish-podium         "stand as if you had been given medals" — "as if" is
//                            a gesture at a frame, not a frame
//
// He could not name what he was cutting, and cut accurately anyway. What he was
// cutting was missions with no alibi.
//
// THE SECOND COVER is competence, and it comes from a different literature:
// self-determination theory's three needs — autonomy, competence, relatedness —
// each independently predict enjoyment in games (Ryan, Rigby & Przybylski, 2006;
// the PENS model). A mission that makes a player conspicuous while doing
// something that reads as SKILFUL needs no fiction, because the imaginary
// audience is watching them succeed rather than watching them be ridiculous.
// That is why youth-human-pyramid and height-line-up ("get into height order
// without speaking, hand signals only") both survived untouched while the silly
// walk did not. A pyramid is a feat. A silent coordination puzzle is a feat.
//
// SO, WHEN A MISSION EXPOSES A PLAYER IN PUBLIC, IT MUST DO ONE OF TWO THINGS:
// hand them a character the act belongs to, or give them something to be good
// at. If it does neither, the mission is for kids, who have no imaginary
// audience yet, or for adults, who have made their peace with theirs.
//
// And the move this replaces: when a high-exposure mission reads wrong for
// teenagers, WRITE IT A SENTENCE OF FICTION before you touch its tags. One
// sentence usually does it, it costs nothing, and it turns a mission that half
// the bank's audience refuses into one they queue up for. Never instruct a
// player to "be funny" — that is the exposing act itself, stated as a demand.
// Give them a premise and let the comedy come off it.
//
// A THIRD SOURCE OF COVER, found by hand-judging all thirteen missions in this
// bank that declare `crowded`: the TASK ITSELF can be the alibi, when it gives a
// socially legible reason to approach. "Excuse me, do you know how many bones
// are in the human body" is a normal thing to say to a stranger; the question is
// the permission. trivia-bones, invention-order, the-hard-riddle and human-gps
// all send a team at the public with nothing but an errand and are none the
// worse for it. honest-compliment was the only one of the thirteen with no cover
// of any kind — no character, no skill, no errand, just "walk up to somebody and
// be nice at them" — and it is exactly the one the operator quietly narrowed. It
// has since been recast so that the PRECISION of the observation is the skill.
//
// AND A NEGATIVE RESULT WORTH KEEPING. Rule 52 was drafted with an automated
// screen alongside it, scoring every mission for the three needs by matching
// prose. It does not work and cannot be made to: the screen flagged
// youth-great-escape and youth-breaking-news, two of the strongest missions
// here, because a mission can decide a great deal without containing the word
// "choose". Rules 41-42 are machine-checkable because they compare two encodings
// of one structural fact. Rule 52 compares a mission against what people enjoy,
// and there is no regular expression for that. Do not add one; the danger is not
// that it fails, it is that it passes.
//
// ─── 52. "Stupid" is measurable — name the choice, the skill, and the thing
//         they learn about each other ────────────────────────────────────────
//
// The commonest complaint about a bad mission is that it is stupid, which sounds
// like taste and is not. Self-determination theory's three needs give it a
// definition sharp enough to screen with, because all three are things you can
// point at in a draft or fail to:
//
//     AUTONOMY     — what does the team actually DECIDE? If every group produces
//                    the same submission, the mission is a chore with a camera.
//     COMPETENCE   — what could they be GOOD at? Not "complete", good. A mission
//                    with no ceiling gives nobody the experience of mastery, and
//                    a mission that cannot be done badly cannot be done well.
//     RELATEDNESS  — what do they know about each other afterwards that they did
//                    not know before? This is the need a field game is uniquely
//                    able to serve and the one most often left on the floor.
//
// Score a draft out of three, honestly. Three is a mission people talk about
// afterwards. Two is fine, and most good missions are two. ONE IS THE LINE. Zero
// is the definition of the word.
//
// It retro-predicts our own deletions, which is the only reason to trust it.
// hero-walk — walk slowly like an action hero and all say a catchy line at the
// same moment — scores zero: nothing is decided (the walk is specified), nothing
// can be done well (it is walking), and nobody learns anything about anybody. It
// was cut. trade-up scores three — every swap is a real decision, negotiating is
// a genuine skill with a visible ceiling, and a team finds out fast who among
// them can talk to strangers — and it is the mission the operator raised the
// difficulty of rather than trimming.
//
// The test is also a REPAIR KIT, because each need suggests its own fix: give
// the team a choice to make, give the mission a way to be done well, or make it
// require something one of them has to reveal.
//
// ═════════════════════════════════════════════════════════════════════════════
// RULES 53+ — the second night of the same research pass (2026-09-02), aimed at
// the word the operator actually used: he asked for missions that are SHARP.
// Rules 51-52 answered why a mission is refused and what makes one stupid.
// Neither says what makes one MEMORABLE, and memorable is the whole product: a
// field game is bought, recommended and repeated on the strength of what people
// tell each other afterwards.
// ═════════════════════════════════════════════════════════════════════════════
//
// ─── 53. A game is remembered as ONE peak and ONE ending. Its length is not
//         remembered at all ──────────────────────────────────────────────────
//
// This is the most robustly replicated finding in the psychology of experience
// and it is brutal about how this bank is currently assembled. Kahneman and
// Fredrickson's PEAK-END RULE: a retrospective evaluation is not the average of
// an experience, it is the average of its most intense moment and its final
// moment. Its companion, DURATION NEGLECT: how long the experience lasted has
// almost no effect on how it is remembered. A 2022 meta-analysis put the
// peak-end effect at large and the duration effect at essentially nil.
//
// The original demonstration is worth carrying around because it is so
// counter-intuitive: people who held a hand in painfully cold water for 60
// seconds, and people who did the same 60 seconds and then a further 30 seconds
// as the water was warmed slightly, preferred to REPEAT the longer trial. More
// total discomfort, better memory, because it ended better.
//
// Three consequences, and the first one contradicts something this product
// currently tells creators:
//
//   1. LENGTH IS NOT QUALITY. The smart-build wizard asks how long the game
//      should be and warns when the composed game falls short of it
//      (`shortfall`). That warning is honest about minutes and silent about the
//      thing that actually determines whether the day was good. A ninety-minute
//      game with one extraordinary mission is remembered better than a
//      three-hour game with fifteen decent ones. Do not add missions to hit a
//      number; a flat middle is not remembered, it is merely endured.
//   2. THE BANK HAS NO CONCEPT OF A PEAK. It marks `start` and `finish` — one of
//      the two things that gets remembered — and has no way to say "this mission
//      is the one they will still be talking about in a year". `difficulty` is
//      not that: the-hard-riddle is difficulty 8 and is a riddle, while trade-up
//      is difficulty 8 and is a story people tell for years. Difficulty is how
//      hard, intensity is how much it marks you, and this bank can only express
//      the first. That is a real gap, recorded here as the next thing to build.
//   3. THE COMPOSER'S ARC IS A DIFFICULTY ARC, NOT AN INTENSITY ARC, and in
//      every one of its four blueprints the HIGHEST target is the last stage —
//      which quietly assumes the peak and the ending are the same mission. They
//      are two different slots in the remembered experience, and a game is
//      allowed to have its biggest moment two thirds of the way through and
//      still land well.
//
//      Measured rather than assumed, because the first draft of this rule said
//      "all rise monotonically" and that is false for half of them:
//
//          classic-3    [3, 6, 8]           monotonic, max at the end
//          steady-4     [3, 5, 6, 8]        monotonic, max at the end
//          twist-5      [3, 5, 7, 6, 8]     bumps at stage 3, max still the end
//          marathon-6   [2, 4, 5, 7, 6, 9]  bumps at stage 4, max still the end
//
//      Two of them already bend, and scripts/test-composer-blueprints.ts
//      deliberately asserts only that a blueprint "ends harder than it starts",
//      step-by-step being left free so that a mid-game spike stays legal. So the
//      SHAPE is already permitted and the data simply never uses it for a real
//      peak.
//
//      Which is the trap: the obvious response is to go and edit those arrays,
//      and it would accomplish nothing. Rule 58 is the reason — difficulty is
//      not arousal, so moving cognitive load earlier does not put a memorable
//      moment there. Rearranging the curve would feel like acting on this rule
//      while changing nothing anybody would remember. The curve is not the
//      missing piece; the missing piece is that no mission can say how much it
//      moves you.
//
// ─── 54. Distinctive means different FROM ITS NEIGHBOURS, not extreme in
//         itself ─────────────────────────────────────────────────────────────
//
// The von Restorff (isolation) effect: within a series, the item that differs is
// the one recalled. The mechanism matters more than the headline — it is
// "processing of difference in the CONTEXT OF SIMILARITY". Distinctiveness is
// relational. Nothing is memorable on its own; it is memorable against what sat
// beside it.
//
// So a peak is not the mission with the highest number on it. A peak is the
// mission that is unlike the four around it. In a game made of eight photo
// missions, the ninth photo mission cannot be the peak however good it is — but
// a single mission where the team has to talk a stranger into something, or
// where the whole group has to be silent, will be the one they describe first.
//
// This is why the bank's composition is a design problem and not merely a
// statistic. Measured 2026-09-02: 61 of 103 missions are photo submissions, 59%,
// with the next largest kind (quiz) at 17 and everything else in single figures.
// A pool that homogeneous makes every composed game's middle self-similar, and a
// self-similar middle has no peak in it at all — von Restorff says the peak is
// whatever DIFFERS, and in an all-photo game nothing does.
// scripts/test-task-bank-tag-laws.ts prints this mix on every run rather than
// asserting on it: the right ratio is a judgement, but drifting further without
// noticing should not be possible. When adding
// a mission, the useful question is not "is this good" but "what is this
// UNLIKE". A mission that is the only one of its kind in a typical composed game
// is worth more than a better mission that is the fourth of its kind.
//
// ─── 55. The last mission is the summary frame — never spend it on tidiness ──
//
// Half of what is remembered is the ending, and the ending gets that weight even
// when it is not intense. So the final mission is not a full stop and not
// admin: it is the sentence the whole day gets compressed into.
//
// Judged that way, our own finish pool splits sharply, and the split had never
// been looked at:
//
//   STRONG — they leave the group holding something.
//     finish-what-we-didnt-know   each says one thing they learned about
//                                 somebody else today. It is about each other,
//                                 it is emotional, and it literally asks the
//                                 group to summarise the day. This is what an
//                                 ending is for.
//     finish-all-or-nothing       one unbroken take, one miss and you start
//                                 again. Collective tension resolved together.
//     finish-the-credits          cinematic, alibi-rich (rule 51), and it ends
//                                 on one person turning to camera to say a line.
//
//   WEAK — they end the game without ending anything.
//     finish-podium               a pose. No decision, no skill, nothing about
//                                 anybody. The operator had already halved its
//                                 difficulty and pulled `youth` off it. Now
//                                 rewritten so the group has to NAME something
//                                 real that happened today and give itself an
//                                 award for it: the ceremony is the alibi and
//                                 the naming is the summary.
//     youth-finish-point          "navigate to the finish point". The literal
//                                 end of a race and the emptiest possible last
//                                 memory of one — by duration neglect it can
//                                 undo three hours in thirty seconds. A race
//                                 genuinely needs a finish line, so the mission
//                                 stays; it now asks the team to stop and look
//                                 at each other before they walk in, which costs
//                                 nothing and is the difference between arriving
//                                 and finishing.
//
// The test for a finisher: say out loud what the group is holding as they walk
// away from it. If the answer is "a photo of themselves standing still", it is
// not an ending, it is the last item on a list.
//
// ─── 56. An age is a claim about the OPERATION a mission demands, never about
//         its subject matter ────────────────────────────────────────────────
//
// Piaget's stages are coarse and much argued over, but the boundary this bank
// keeps walking into is not: CONCRETE operational reasoning (roughly 7-11) works
// on things that are present and real, and FORMAL operational reasoning — the
// hypothetical, the analogy, the metaphor, the double meaning — arrives around
// eleven. The related finding on figurative language is blunter still: children
// below about nine generally do not get sarcasm or second meanings at all. Not
// "find them hard". Do not have the machinery yet.
//
// So the question an author must ask is never "is this about simple things". It
// is "what operation does a player have to run". The bank got this exactly
// backwards on five entries at once, and the pattern is worth seeing whole,
// because all five carry the same `minAge: 6`:
//
//     paper-airplane-trial   fold a plane and throw it        motor      ✓ 6
//     waiters-race           carry things without spilling    motor      ✓ 6
//     blanket-fort           build a fort out of cushions     motor      ✓ 6
//     mystery-gift           feel a wrapped parcel and guess  sensory    ✓ 6
//     household-riddle-comb  "I have teeth but do not bite"   METAPHOR   ✗ 6
//
// mystery-gift at six is RIGHT precisely because its inference is sensory: a
// child holds a box, feels a shape, and says a thing. household-riddle-comb at
// six is wrong precisely because its inference is figurative, however homely the
// answer happens to be. The minAge on both was set from how domestic the mission
// felt, not from what the player has to do inside their head.
//
// And the bank already knew. It holds exactly three riddles of the same
// construction — "I have X but not Y, what am I" — and two of them are tagged
// correctly:
//
//     the-hard-riddle        cities with no houses   → adults, corporate, youth
//     echo-riddle            speaks with no mouth    → youth, adults, corporate
//     household-riddle-comb  teeth that do not bite  → KIDS, and minAge 6
//
// The rule was understood twice and broken once, which is what a rule that lives
// in somebody's head rather than in the file looks like.
//
// ─── 57. In a mixed-age mission, every figurative clue needs a literal
//         companion ─────────────────────────────────────────────────────────
//
// The obvious repair for the riddle above is to take `kids` off it. That is the
// wrong repair, and noticing why is the useful part: this bank holds three
// riddles and all three are metaphorical, so removing the only one children can
// be offered leaves them with no riddle at all — and rule 54 has just finished
// arguing that variety inside a composed game is what produces a peak.
//
// The better repair is to give the answer a SECOND ROUTE. A clue that says what
// the object literally does sits beside the clue that says what it figuratively
// is, so a nine-year-old reaches the answer by the concrete path while an adult
// still gets the pleasure of the metaphor. The metaphor stops being a gate and
// becomes a bonus, which is what `mixed` should have meant all along: not
// "nobody is excluded on paper", but "two different players can each find their
// own way in".
//
// household-riddle-comb now carries both. Do this wherever a mission is offered
// across ages and its solution runs through a figure of speech.
//
// ─── 58. Arousal is not difficulty, and arousal is what is remembered ────────
//
// Rule 53 left a gap open on purpose: the bank can say how HARD a mission is and
// has no way to say how much it MARKS you. This is what fills it.
//
// McGaugh's work on memory consolidation: the amygdala modulates the strength of
// memory encoding IN PROPORTION TO THE EMOTIONAL AROUSAL accompanying the
// experience — adrenaline and glucocorticoids released by arousal regulate what
// gets consolidated into long-term memory. Arousal, not effort, and not even
// pleasantness: unpleasant arousing events consolidate too.
//
// Difficulty and arousal are close to orthogonal, and this bank has a clean pair
// to prove it. Both are difficulty 8:
//
//     the-hard-riddle   you sit and think. Cognitively demanding, physiologically
//                       flat. Nobody's pulse changes. Nobody retells it.
//     trade-up          you walk up to a stranger holding an object and ask them
//                       to swap. Then you do it again. Cognitively trivial,
//                       physiologically enormous, and the mission people describe
//                       first when they get home.
//
// The composer currently paces games on `difficultyCurve` alone, which means it
// is arranging cognitive load and calling it an arc. Combined with rule 54, the
// full statement is:
//
//     A PEAK = intrinsic arousal (a property of the MISSION)
//            × contextual distinctiveness (a property of the PLACEMENT)
//
// The first belongs in the bank and does not exist yet; the second belongs in
// the composer and does not exist yet either. The next structural change to this
// bank is therefore an `intensity` scalar beside `difficulty` — deliberately NOT
// a tag (tags are a filtering vocabulary and this is a placement weight) and
// deliberately not a third bookend (a peak is positional, and von Restorff says
// its position depends on its neighbours). Until it exists, an author placing a
// mission into a template should ask what the player's PULSE is doing, and put
// the answer in the entry's comment.
//
// ─── 59. Curiosity needs a SMALL gap, and the gap has to be named ────────────
//
// Loewenstein's information-gap theory (1994): curiosity is the feeling of a
// discrepancy between what you know and what you want to know, and it only fires
// once that gap is made SALIENT — you have to be shown the shape of what you are
// missing. The counter-intuitive half, and the useful one: curiosity is
// strongest when the gap is SMALL. A large gap produces less curiosity, not
// more, because there is no existing structure for the answer to complete.
//
// Which means "find something interesting here" is not a mission. It is an
// unbounded gap, and an unbounded gap produces no pull at all. The bank's best
// searching missions are all small, named gaps, and reading them side by side
// makes the shape obvious:
//
//     odd-one-planted   "somebody hid ONE object here that does not belong."
//                       You know the count, the category and the location. You
//                       lack exactly one datum. That is the whole design.
//     kims-game         "here is a photo of how this looked. Find what changed."
//                       You are handed the before-state, so the gap is precisely
//                       one difference wide.
//     the-hidden-key    "a key is hidden here, and it opens THIS."
//
// Compare a draft that says "look around and find something surprising": same
// activity, no gap, no pull.
//
// So before shipping a mission built on searching, deducing or guessing, say out
// loud what the player knows and what single thing they do not. If you cannot
// state the missing thing in one short phrase, the gap is too big and the
// mission will read as a chore. Narrow it until you can.
//
// ─── 60. Auto-approval says nothing about quality, so the mission must carry
//         its own criterion — and must never promise a reward it cannot pay ──
//
// Csikszentmihalyi's flow conditions are three, and this platform is structurally
// weak on the second: clear goals, IMMEDIATE FEEDBACK, and a challenge matched to
// skill. Sixty-one of this bank's 103 missions are photo or video uploads set to
// `autoApprove`, which means every submission gets the identical response. The
// team learns that it was accepted. It learns nothing about whether it was any
// good — and rule 52's competence need is precisely the experience of doing
// something WELL, which cannot exist without a signal.
//
// Rule 40 already asks that a team know it is RIGHT before it submits. This is
// the neighbouring requirement and it is not the same one: correctness versus
// quality. A photo mission is always "correct". Nothing in the platform will
// ever tell a team their photo was better than another team's.
//
// So the mission text has to supply the signal itself, in a form the team can
// check without anybody's help. The good ones already do, and they are worth
// copying: "both feet off the ground, no cheating" (open-everyone-airborne),
// "one miss and you go back to the first person" (finish-all-or-nothing),
// "until they can do it themselves without you leading" (teach-a-stranger),
// "keep swapping until somebody gives you a marker" (trade-up), "so that the
// whole letter is visible" (human-letter). Every one of those is a sentence the
// team can hold up against what they just made.
//
// AND THE HARDER HALF: never promise a reward the platform cannot pay. Two
// missions here told players that something would earn BONUS POINTS — "an
// original performance earns bonus points", "bonus if real strangers take part"
// — while being auto-approved, which awards a flat score to every submission
// alike. There is no bonus. There has never been a bonus. A player who works
// harder for it gets exactly what a player who did not gets, and the only thing
// the promise reliably produces is the suspicion that scoring is arbitrary.
//
// This is rule 14 again (verification must match what the type can actually
// check) arriving from the scoring side, and unlike most of these rules it IS
// machine-checkable, because it compares two encodings of one fact: prose that
// promises differential scoring against a config that cannot deliver it.
// scripts/test-task-bank-tag-laws.ts now fails on any bonus promise in the bank.
// Convert the intent into a criterion instead — the thing you wanted to reward
// is almost always the thing you should have required.
//
// ═════════════════════════════════════════════════════════════════════════════
// RULES 61+ — the relatedness night. Rule 52 named three needs and said plainly
// that relatedness is the one a field game is uniquely able to serve and the one
// most often left on the floor. This is the audit of how badly, and what the
// research says to do instead.
// ═════════════════════════════════════════════════════════════════════════════
//
// ─── 61. Closeness is built by ESCALATING reciprocal disclosure, and the game's
//         timeline is the only ramp you will ever get ────────────────────────
//
// Aron's 1997 study is the cleanest result in this literature: pairs of STRANGERS
// worked through thirty-six questions over about forty-five minutes and finished
// reporting more closeness than many people report with lifelong friends. The
// active ingredient is not the questions. It is that they ESCALATE — three sets
// of rising intimacy, the first about an ordinary day, the last about naming good
// qualities you see in the other person — and that every disclosure is answered
// in kind.
//
// Forty-five minutes. A field game runs ninety to a hundred and eighty. This
// product owns the exact vehicle that study needed and uses it for almost
// nothing.
//
// Here is the bank's actual disclosure ladder, by position:
//
//     OPENERS   open-team-name, open-team-motto, open-one-take-intro
//               Each person says a word, or their name and one movement. Perfect
//               turn-taking, ZERO disclosure — which is exactly right for minute
//               zero (see rule 63) and is a genuine bottom rung.
//     MIDDLE    nothing. Not one mission in the body of a game asks a player to
//               say anything true about themselves to the people they are
//               playing with.
//     FINISH    finish-what-we-didnt-know — "one sentence about somebody else in
//               the group: a thing you found out about them today". That is
//               Aron's third set almost word for word, and it is the best
//               mission in this bank.
//
// A ladder with a bottom rung and a top rung and nothing between is not a ladder.
// The single highest-value content work available to this bank is the missing
// middle: two or three missions of mild, mid-game, mutual disclosure, so the
// closing mission lands on a group that has been warming up for an hour instead
// of on strangers being asked to be sincere on command.
//
// (best-moment-so-far was the clearest waste of the position it already holds: a
// mid-game four-option poll about the shared experience, answered silently into
// the app, where nobody heard anybody. It now asks each player to say their
// moment out loud and why that one, before the team picks an answer together.
// Same type, same data, one sentence, and the middle rung exists.)
//
// ─── 62. Reciprocity has to be STRUCTURAL — write the turn-taking into the
//         instruction ───────────────────────────────────────────────────────
//
// Reciprocity is not a nice side effect of disclosure, it is the mechanism.
// Dyads that took turns disclosing reported 2.3 times the liking of dyads where
// disclosure ran one way. The explanation is an inference: if you tell me
// something real, I conclude you trust me, so I answer in kind — and an
// imbalance is actively uncomfortable rather than merely neutral.
//
// Which means "share something about yourself" is a broken instruction. It
// produces one confident person talking and everybody else being an audience,
// and the audience ends the mission slightly further away than it started.
//
// finish-what-we-didnt-know shows the fix, and it is entirely in the wording:
// "each person speaks once, and something is said about each person". Two
// clauses, and the mission can no longer be completed by its loudest member.
// This is rule 33's one-person test arriving from the relatedness side: there,
// the failure was one player doing the work; here it is one player receiving all
// the attention.
//
// ─── 63. Match the depth to the minute, and remember a group is not a pair ───
//
// Two limits on everything above, both of which the openers already respect by
// instinct.
//
// DEPTH IS CURVILINEAR IN TIME. Cozby's finding is that liking rises with
// disclosure only up to an appropriate level and falls past it: too much too
// soon reduces liking rather than increasing it. A mission asking a group of
// teenagers to name something they admire in each other at minute five will be
// refused, and refused in a way that poisons the next hour. The same sentence at
// minute ninety, after they have done things together, is the best moment of the
// day. The content is identical; only the position changed. This is rule 39's
// social-risk ramp again, pointed inward at the team instead of outward at
// strangers, and the same caveat applies: the composer cannot score for it yet,
// so the author has to say in the entry's comment where in a game the mission
// belongs.
//
// A GROUP IS NOT A PAIR. Aron's protocol is a dyad, and the disclosure research
// is explicit that a public channel is harder — in front of an unspecified
// audience people find it markedly more difficult to express liking and trust.
// So do not simply scale a two-person question up to six. Ask for the version a
// person can say standing in a circle: concrete, about something that happened
// today, and bounded to one sentence. "Something I found out about you today" is
// sayable in a circle. "What do you value most about me" is not, and asking for
// it in public is how a good mission becomes the one everybody skips.
//
// ─── 64. "Do your best" is the weakest instruction in the language. Name the
//         target ─────────────────────────────────────────────────────────────
//
// Goal-setting theory is one of the most replicated results in applied
// psychology, and its headline is exactly the sentence an author needs: a
// SPECIFIC, DIFFICULT goal outperforms "do your best" by a wide margin — around
// 16% on average across hundreds of studies spanning brainstorming, typing,
// sales, air-traffic simulation and weight loss. Four mechanisms do the work.
// A named target directs attention to the relevant thing and away from
// everything else, mobilises effort, sustains persistence past the first
// setback, and — the one that matters most for a creative mission — prompts
// STRATEGY SEARCH. A team told to make a convincing advert stands there. A team
// told the advert must contain the problem, a demonstration and the slogan
// starts arguing about how to do the demonstration, which is the mission
// actually beginning.
//
// The Hebrew disguises are what to watch for, because none of them look lazy:
// משכנעת, יצירתי, מקורי, מרשים, כמה שיותר, ככל האפשר. Each reads as generosity —
// as though naming a target would constrain the team — and each is in fact the
// author declining to decide, and handing the team a mission with no shape.
//
// TWO THINGS FALL OUT OF THIS, and the second is why the rule earns its place
// next to rule 60 rather than being a restatement of rule 20:
//
//   • A specific goal IS the self-checkable criterion rule 60 demands. The team
//     can count three beats in their own video. They cannot count "convincing".
//     One sentence solves both problems, which is why vague goals are expensive
//     twice over.
//   • Difficult, not merely specific. "Include one beat" is specific and does
//     nothing. The performance gain comes from the target being a genuine
//     stretch that the team still believes it can hit.
//
// Recorded with a confession, because it shows how easily this one arrives: the
// phrase "פרסומת משכנעת" was written INTO this bank during the rules 41-50 pass,
// by the same process that was busy fixing a different rule at the time. It
// replaced a worse sentence and it felt like an improvement. It is a "do your
// best" instruction. It has now been replaced by three named beats.
//
// ─── 65. Autonomy means a small set of comparable options, not an open field ─
//
// Rule 52 says to give the team a real decision. This is the size of it.
//
// Iyengar and Lepper's jam study is the canonical result: a tasting booth with
// six varieties converted 40% of tasters into buyers; the same booth with
// twenty-four converted 3%. More options, less action and less satisfaction with
// whatever was chosen. Choice overload is worst under three conditions, and a
// team standing on a street corner with a clock running satisfies all three at
// once — the options are hard to compare, the choosers do not have settled
// preferences, and they want to decide quickly.
//
// So "do whatever you like with it" does not deliver autonomy. It delivers
// paralysis, then whatever the loudest member says, which is rule 33's failure
// with extra steps. Two to four concrete alternatives is the shape that works,
// and naming them costs nothing: finish-all-or-nothing offers hopping, a full
// turn in the air, or a pass behind the back, and then says pick one. The team
// spends its energy on doing rather than on scoping.
//
// This rule is a GUARD rather than a repair. The bank was audited against it and
// came out clean — every choice currently offered is between one and three
// options, and the one multiple-choice survey offers four. It is written down
// because the obvious way to "fix" a mission that rule 52 marks as low-autonomy
// is to throw it open, and that would make it worse, not better.
//
// ─── 66. A ladder's rungs must be different MECHANICS, or the composer will
//         only ever place one of them ────────────────────────────────────────
//
// This one only appears when rules 48 and 61 are held together, and it kills the
// obvious way of building the disclosure ladder.
//
// Rule 61 says relatedness needs escalation: several missions of rising
// intimacy spread across the game. The natural way to write them is one mission
// per depth using the same move — "say one thing about another person", light
// version at minute thirty, deeper version at minute ninety. Rule 48 then
// forbids exactly that, because two missions built on one mechanic are
// duplicates however different their content, and `family` makes them mutually
// exclusive inside a single composed game. Write the ladder that way and the
// composer places precisely one rung of it, chosen at random. The ladder does
// not degrade gracefully; it collapses to a single step.
//
// So the rungs have to escalate through different VERBS. Depth rises while the
// mechanic changes underneath it:
//
//     state a fact about yourself     "the furthest place you have ever been"
//     give an opinion about today     best-moment-so-far, now spoken aloud
//     make a prediction about someone the group guesses, the person confirms
//     make an observation about them  finish-what-we-didnt-know
//
// Four different things to DO, one rising line of intimacy, no two of them in
// the same family. That is a ladder a composer can actually lay out end to end.
//
// The general form is worth keeping beyond disclosure: whenever a design calls
// for a progression — social risk (rule 39), physical effort, difficulty — the
// steps must differ in kind and not only in degree, because everything in this
// system that prevents repetition works on kind.
//
// ═════════════════════════════════════════════════════════════════════════════
// RULES 67+ — the improv night. Most of this bank is performance: sixty-one
// missions where a group does something in front of a camera. Improvisation is
// the body of knowledge that is actually about that, it has been refined by
// practitioners for sixty years, and until now none of it was in this file.
// ═════════════════════════════════════════════════════════════════════════════
//
// ─── 67. Never ask for originality. Ask for the first thought, and put the
//         originality in the CONSTRAINT ────────────────────────────────────────
//
// Rule 64 banned "be creative" for being vague. Johnstone's claim in Impro is
// much stronger and it is the one that matters: asking for originality actively
// makes the work WORSE. Performers block their own imaginations because they are
// afraid of being unoriginal; straining for something clever takes you away from
// yourself and lands you on cliché, which is precisely what the straining was
// trying to avoid. His instruction to students is the opposite of the intuitive
// one — BE OBVIOUS. Trust the first thought. Your obvious is not my obvious, and
// that difference is where real originality comes from.
//
// This also finishes an argument from rule 51. Telling a teenager to "invent a
// FUNNY walk" fails twice over: it is exposure with no alibi, and it is a demand
// for cleverness that guarantees a self-conscious, worse walk. Both halves of
// that sentence were wrong, for different reasons, and the alien delegation fixed
// both at once — because a premise removes the need to be clever.
//
// WHICH IS THE OTHER HALF OF THE RULE. If the player is not supposed to supply
// originality, something has to, and that something is the constraint. The
// research on bounded creativity says the same thing from the other end:
// constraints work by directing attention into a narrowed search space, and
// without them people are overwhelmed by possibility — "endless freedom
// indefinitely postpones motivation to act", which is a precise description of
// four people standing in a park having been told to be imaginative.
//
// AND THERE IS A CEILING. Creativity peaks at MODERATE constraint; both too few
// and too many hurt. So this rule and rule 46 (count the ways it can fail before
// you count the ways it is clever) are the two walls of one corridor, not two
// separate warnings. Rule 46 guards the over-constrained end where chain-reaction
// died; this guards the under-constrained end where a blank instruction dies.
// The mission wants to sit in the middle: enough of a frame that the first
// thought is already interesting, few enough rules that it can survive contact
// with a real group.
//
// ─── 68. Build so that every offer MUST be used — blocking is a structural
//         problem, not a personality one ───────────────────────────────────────
//
// Johnstone's central mechanic: an OFFER is anything a player puts forward, and
// it can be accepted or BLOCKED. A block is anything that wipes out your
// partner's premise. Scenes generate themselves when players offer and accept
// alternately; they die the moment someone blocks. And the crucial part for a
// mission author is that blocking is not usually malice — it is what any group
// does by default when a mission says "decide together", because deciding
// together means selecting one offer and discarding the rest.
//
// This bank contains the fix already, unnamed, in its best opener:
//
//     open-team-name   "each of you says one word, and you build the name OUT OF
//                       those words"
//
// Nobody can be overruled, because every offer is load-bearing. The quiet member
// is in the result, not merely present at it. Compare "choose a team name
// together", which is the same mission and hands it to whoever talks most.
//
// SO THE PATTERN, and it is worth reaching for by default in any group-creative
// mission: EACH PERSON CONTRIBUTES ONE ELEMENT, AND ALL OF THEM MUST APPEAR IN
// THE RESULT. It is not a style preference. In one clause it satisfies four
// rules that otherwise need separate attention — 33 (a mission one player can
// finish alone is not a team mission), 62 (reciprocity has to be structural),
// 67 (the constraint supplies the originality) and 65 (the choice is bounded,
// because there is nothing to choose) — and it scales with team size for free,
// which "pick three of you" never does (rule 50).
//
// Applied here to teach-a-stranger, whose handshake was "at least three steps"
// invented by nobody in particular and is now one move per person, in turn, all
// of them kept; and to office-olympics, whose invented sport had one rule from
// whoever spoke first and now takes one rule from each player.
//
// ─── 69. A named target belongs to the GROUP. On one person, in public, it is
//         a threat rather than a goal ───────────────────────────────────────
//
// This is rule 64's boundary condition, and it was found the hard way: by
// noticing that applying rule 64 two nights earlier had made a mission worse.
//
// the-witness has one player study a place for a minute and then recall it aloud
// while the others film, after which the camera is turned on the place "so you
// can check how right HE was". The rule-64 pass added a specific difficult
// target — ten correct details — because the mission was already verifying the
// count and had never stated it. Every word of that reasoning was right and the
// result was a mission that stands one named person in front of their friends
// with a number they can publicly fail to reach.
//
// The research on social-evaluative threat says this is not squeamishness. Being
// evaluated in front of peers measurably DEGRADES cognitive performance — so the
// spotlight makes the failure it is measuring more likely — and adolescence is
// specifically a window of heightened sensitivity to peer evaluation, which is
// the same finding rule 51 reached through Elkind from a completely different
// literature. Convergent evidence is the strongest kind available here. Worse,
// visible nervousness in front of peers has real social consequences afterwards,
// so a mission can cost a quiet player something that outlasts the game.
//
// This bank happens to contain the controlled experiment, two missions with
// nearly identical staging and opposite status design:
//
//     blind-describe  one player turns their back while the others describe an
//                     object without naming it. The mission ENDS WHEN THEY GET IT
//                     RIGHT — there is no failure state, the difficulty sits with
//                     the describers, and the spotlit player is handed a win.
//     the-witness     one player performs from memory against a public number,
//                     and the last beat of the mission is everybody checking
//                     whether they fell short.
//
// So: keep the target, move who carries it. the-witness now has the witness lead
// the recall and the rest add what they caught, against a target that is stated
// as the group's. The witness keeps the starring role and can no longer fail
// alone.
//
// ─── 70. Status is played, not possessed — so never let a mission fix it ─────
//
// Johnstone's other half. Status is not a property of a person but a thing they
// DO, moment to moment, in every inflection; playing high says "don't touch me",
// playing low says "don't hurt me". Scenes come alive on the SHIFT — a high
// character brought low, a low one finding the nerve to assert. "If you get the
// status right, you can relax and the scene will play itself."
//
// Two things follow for a mission author.
//
// FIRST, IT EXPLAINS RULE 68. Johnstone's observation is that low-status players
// accept and HIGH-STATUS PLAYERS BLOCK. Blocking is not a personality flaw, it is
// a status move — so a mission that permits blocking is a mission that quietly
// awards one player high status at the group's expense, and the accept-all
// pattern is a status intervention as much as a creative one. That is why it
// works on the quiet member rather than merely including them.
//
// SECOND, DO NOT CAST THE GAME. A mission that permanently makes one player the
// expert, the judge or the tested, with no rotation and no reversal, has removed
// the only thing that makes the arrangement bearable: the possibility of a shift.
// Fixed status is also flat drama — Johnstone's whole point is that the shift is
// where the interest lives.
//
// Three moves, in order of preference: ROTATE the role so everyone occupies it
// (draft B's prediction round runs until everybody has been the subject);
// INVERT it, so the apparently high role turns out to depend on the low one
// (blind-describe's guesser looks spotlit and is actually being carried); or, if
// neither is possible, make the FAILURE SHARED so the role is a position rather
// than a verdict.
//
// ─── 71. The stranger never agreed to play. Ask before you photograph them,
//         say what it is for, and never script their refusal ────────────────
//
// Every rule in this file up to here is about the player. Thirteen missions send
// a team at members of the public, and not one line had ever been written about
// the person on the other end.
//
// Pervasive-game theory is the literature for this and its central observation
// is uncomfortable: a game played in ordinary space expands the magic circle
// until people who never opted in are inside it. Montola, Stenros and Waern give
// them a name — UNAWARE PARTICIPANTS — and treat them as a design problem in
// their own right rather than as scenery. The pleasure of the ambiguous zone
// between play and non-play belongs to the players. The stranger gets the
// ambiguity without the pleasure.
//
// On photographs specifically, the ethics literature is blunt about the gap this
// bank was sitting in: in most countries you MAY photograph a person in public
// without asking, and legal permission is the floor rather than the standard.
// The working test is whether you would be comfortable showing the picture to
// the person in it. Add two facts particular to this product — our players are
// frequently minors, and the strangers sometimes are too — and "you are allowed
// to" stops being an answer.
//
// AND THE BANK WAS ALREADY INCONSISTENT WITH ITSELF, which is the tell that this
// was never decided, only improvised mission by mission:
//
//     thirty-second-interview   "ask permission" — then films            ✓
//     namesake-stranger         introduces itself and explains, films    ~
//     local-legend              films the answer, nobody asked           ✗
//     teach-a-stranger          films them performing, nobody asked      ✗
//     challenge-shampoo-pitch   "get photographed with them", no ask     ✗
//     do-someone-a-favour       "do NOT photograph them, and do not tell
//                                them it is a mission"                   ★
//
// The last one is the most carefully written mission in this bank and it points
// at the shape of the rule: it forbids the photograph because the mission's
// meaning depends on the favour being real, and a favour done for a camera is
// not one. That is a REASON, not a reflex, which is what the other five were
// missing in both directions.
//
// SO: a mission that photographs an identifiable member of the public must ask,
// in the text, and must say what the picture is for. One clause. It also
// produces better material — a stranger who knows they are in somebody's game
// plays along, and rule 35 already says the stranger is a co-star rather than an
// audience; you cannot co-star in something nobody told you about.
//
// DO NOT SCRIPT THE REFUSAL. Rule 49 cut "if he refuses, thank him and find
// another" from two missions and that still stands: instructing the ASK is an
// instruction, while narrating the no is failure-handling prose that tells a team
// to expect rejection before they have opened their mouth. Ask for the
// permission; leave what happens next to the people standing there.
//
// A SECOND HALF, FROM THE SAME LITERATURE. The magic circle leaks both ways, so
// a mission also has to be legible FROM OUTSIDE. A group of teenagers doing
// something inexplicable in a shopping centre gets security called, and the
// mission's designer is the only person who could have prevented that. Prefer
// missions whose surface reading is ordinary — asking a question, buying
// something, taking a group photo — over ones that require a bystander to work
// out that a game is happening.
//
// ─── 72. `educational` means PROVOCATION, not recall — information is not
//         interpretation ────────────────────────────────────────────────────
//
// Freeman Tilden wrote the six principles of heritage interpretation in 1957 for
// the National Park Service, and two of them settle a tag this bank had been
// applying by feel for its whole existence:
//
//     "Information, as such, is not Interpretation. Interpretation is REVELATION
//      BASED UPON information. But they are entirely different things."
//     "The chief aim of Interpretation is not instruction, but PROVOCATION."
//
// Rule 34 already says a located mission should provoke curiosity about a place
// rather than test knowledge of it. This is the same claim aimed at the tag, and
// the audit was unflattering: eleven missions carried `educational` and they fell
// into three groups, only one of which had any business with it.
//
//   REVELATION — keep. Each demands a reasoned inference about something real
//   and present, which is exactly Tilden's revelation-based-on-information:
//     oldest-thing-here     find the oldest object here, say how old and WHY
//     local-legend          get a story and one checkable fact out of a local
//     school-then-and-now   find a corner that has not changed, stage the past
//     escape-route          read the fire map, then walk it from memory
//
//   RECALL WEARING A FACT — remove. Their actual mechanic is approaching a
//   stranger; the fact is the pretext, which rule 71 noticed is a perfectly good
//   alibi but is not education:
//     trivia-bones          how many bones are in an adult body
//     trivia-longest-river  which river is longest
//     invention-order       put five inventions in order
//
//   WORTHY, WHICH IS NOT THE SAME THING — remove. This is the confusion worth
//   naming, because it is the one an author falls into without noticing: the tag
//   drifted from "teaches something" to "is a good thing to do".
//     honest-compliment     say a precise kind thing to a stranger
//     do-someone-a-favour   do a real favour and tell nobody
//     team-decision-drill   three steps, no majority votes allowed
//
// Eleven down to five. Nothing was deleted and no mission got worse; a creator
// who asks for educational content now gets four missions that provoke thought
// about a real place instead of a mixed bag containing two general-knowledge
// questions and a kindness.
//
// NOTED, BECAUSE IT IS A DISAGREEMENT AND NOT AN OVERSIGHT: the operator's own
// editing pass removed `educational` from oldest-thing-here and added `creative`.
// By Tilden it is the single best example of the tag in this bank — a team
// standing in front of a real object, reasoning from evidence to an age, out
// loud. That override still wins at read time and is left alone. It is recorded
// here because if the disagreement is real then the tag means something narrower
// than Tilden's interpretation, and that is worth settling on purpose rather
// than by whoever edited last.
//
// ─── 73. For one young audience, write a DIFFERENT mission, not a thinner one
//         — and know where this fights rule 57 ─────────────────────────────
//
// Tilden's sixth principle, and it is sharper than anything else in this file on
// the subject: interpretation for children "should not be a dilution of the
// presentation to adults, but should follow a fundamentally different approach.
// To be at its best it will require a SEPARATE PROGRAM."
//
// Which sits awkwardly against rule 57, and the tension is worth having in the
// open rather than resolved by whichever rule is read first. Rule 57 fixed a
// metaphor riddle tagged `kids` by adding a literal route beside the figurative
// one, so a nine-year-old and an adult each find a way in. Tilden would call that
// dilution and tell you to write the child their own riddle.
//
// Both are right, about different situations, and the tag system is what decides
// which:
//
//   • A mission tagged `mixed` is played by a real mixed-age group — a family,
//     a birthday with parents in it. There is one group and one mission, nobody
//     can be sent to a different programme, and rule 57's second route is the
//     only honest answer.
//   • A mission tagged `kids` only, or `adults` only, IS a separate programme —
//     the audience filter is exactly the mechanism Tilden is asking for. Here,
//     writing a softened version of an adult mission is the mistake he names.
//     Write the one that is best for ten-year-olds, which will usually be a
//     different mission entirely (rule 32 already says what those are made of).
//
// So the question to ask of an age-limited mission is not "how do I make this
// easier" but "what is the BEST mission for this audience", and if the answer is
// a different mission, write that one and let the original keep its own
// audience.
//
// ─── 74. The cost of a rule is AMBIGUITY, not words ─────────────────────────
//
// Ten nights of research added thirty-four rules to a file that had forty. The
// first version of this rule called that a reading-budget problem — eighteen
// thousand words, ninety minutes before you may write your first mission — and
// prescribed that every new rule must displace an old one.
//
// Then the next pass tried to obey it, merged rule 20 into rule 3, and MADE THE
// FILE 421 WORDS LONGER, because the pointer the merge needed and the note
// explaining it cost more than the deleted body saved. Measuring that is what
// produced the rule you are reading, so the earlier version is left described
// rather than deleted: it was wrong in an instructive way.
//
// THE LENGTH OF THE ARCHIVE IS NEARLY FREE. What costs is the moment of lookup.
// An author consults this file with one decision in front of them, and the only
// thing that hurts is finding TWO NUMBERED RULES THAT BOTH GOVERN IT and having
// to work out which wins. Rules 3 and 20 were that: 20 opened by conceding "rule
// 3 already says this" and was never more than a clause of it. Merging them was
// right, and the word count was never the reason.
//
// So there is exactly ONE hard budget, and it is the PRE-FLIGHT at the top: nine
// items, 502 words, about two and a half minutes. That is the interface, and it
// is the thing a new rule has to compete for. Everything below it is an archive
// that earns its place by being findable and by being unambiguous.
//
// A NEW RULE MUST THEREFORE DO ONE OF THREE THINGS:
//
//   • Become machine-checkable and move to scripts/test-task-bank-tag-laws.ts.
//     Best outcome available; costs a reader nothing. Rules 41, 42, 60 and 71
//     all ended up there.
//   • Earn a pre-flight slot by displacing one of the nine. Argue the swap out
//     loud — do not quietly make it ten, then eleven.
//   • Sit in the archive WITHOUT overlapping anything already in it. Length is
//     acceptable; a second rule governing a decision that already has one is not.
//
// A rule that does none of those is a note, and notes belong in the comment on
// the entry that taught them, where whoever edits that mission will meet it.
//
// DO NOT JUDGE OVERLAP BY HEADINGS. This pass proposed merging 20 into 64
// because both titles say "specific beats generic", and reading them showed 20 is
// about the specificity of a mission's SUBJECT while 64 is about the GOAL handed
// to the team. Different axes, no overlap.
//
// AND A PRE-FLIGHT ITEM THAT MAPS TO SEVERAL RULES IS NOT EVIDENCE OF
// REDUNDANCY. Rules 33, 62 and 68 were nominated for merging on exactly that
// reasoning — item 2 of the pre-flight covers all three. Reading them showed
// three different things being monopolised, with three different remedies and
// three different literatures behind them: 33 is one player taking the WORK
// (co-op design, quarterbacking), 62 is one player taking the ATTENTION
// (disclosure reciprocity), 68 is one player taking the DECISION (Johnstone's
// offer and block). Rule 62 says so itself in its last sentence. They stay.
//
// The lesson generalises and is the more useful half: one good checklist item
// screens for several distinct defects, which is what makes it a good item.
// Collapsing at the CHECK is correct; collapsing at the DIAGNOSIS would leave an
// author knowing something is wrong and not which repair to reach for.
//
// ─── 75. An authored number is a claim, and a harvested one is somebody
//         else's claim you have not read ───────────────────────────────────
//
// `estimatedMinutes` looks like documentation and is not. It feeds
// `taskScoreSmart` and `computeSkillRatio`, so it decides whether a team reads as
// fast or slow, and it feeds the composer's budget, so it decides how many
// missions get packed into the duration a creator asked for. An estimate that is
// wrong by a factor of four is a scoring bug and a pacing bug at the same time,
// and it looks exactly like a correct one.
//
// This bank had two, and they were found by sorting a column rather than by
// reading anything:
//
//     challenge-shampoo-pitch    2 minutes, difficulty 5. Find a willing
//                                stranger, pitch, agree a price, take money,
//                                explain the game, ask permission, film.
//     challenge-beatles-crossing 2 minutes, difficulty 5. Its own family
//                                siblings are 5 minutes at difficulty 3 and 8 at
//                                difficulty 4.
//
// Both were harvested from the same source template, and both inherited its
// number unexamined. That is the general case: a harvested entry arrives with
// somebody else's estimate attached to content you have since rewritten, and
// nothing in the pipeline ever re-reads it.
//
// SO: when a mission is harvested, adapted or substantially rewritten, RE-PRICE
// IT, and calibrate against its neighbours rather than from imagination — the
// bank's own `family` groups and its similar missions are the reference, and the
// tag-law suite now prints the within-family spread so an outlier is visible.
// Rule 45 governs the opposite direction (make the mission fit the number it was
// given); this one is about the number never having been checked at all.
//
// ─── 76. `photo` is the type that never says no — which is why 59% of this
//         bank is photo, and why that is half a problem ────────────────────
//
// Rule 54 recorded the number and called it a design problem. This is the
// mechanism, and it turns out to be half defensible, which the earlier rule did
// not know.
//
// Duncker's candle problem is the frame: given a candle, a box of tacks and
// matches, most people fail to attach the candle to the wall because the box is
// fixed in their minds as a container for tacks rather than as a shelf.
// FUNCTIONAL FIXEDNESS — an object with an obvious function is hard to see as
// anything else. `photo` is this bank's tack box.
//
// THE BAD HALF. Look at what each type demands of its author before it will
// accept a mission at all:
//
//     numeric        a checkable number and a tolerance
//     quiz           an answer key
//     sequence       ordered steps, each with its own answer
//     geofence       real coordinates
//     smart_station  a code, and a person or object to carry it
//     self_report    a reason to trust the team
//     photo          nothing. Any sentence at all, auto-approved.
//
// That is a gradient of authoring cost, and the distribution follows it exactly:
// photo 61, quiz 17, numeric 8, geofence 5, smart_station 4, and sequence,
// self_report, survey and field on two apiece. The bank did not choose photo 61
// times. Photo is the only type that never refuses an idea, so every mission that
// does not obviously belong somewhere else lands there by default.
//
// And the consequence is an inversion worth stating plainly: THE CHEAPEST TYPE TO
// AUTHOR IS THE ONLY ONE THAT GIVES THE PLAYER NO FEEDBACK. Everything with a
// checkable answer tells a team instantly whether they got it; an auto-approved
// upload tells them it arrived. Rule 60 exists because of that gap and asks
// authors to write the criterion into the prose by hand — which is repair work
// that choosing a different type would have made unnecessary. `sequence` is the
// starkest case: ordered steps, each verified, feedback after every one, and it
// is the richest team type this platform has. There are two of them.
//
// THE DEFENSIBLE HALF, which matters because it stops this rule being used as a
// blunt instrument: photo is also the ONLY type that produces an artifact anybody
// keeps. Rule 44 already says the frame has to contain the team because the album
// is what the group looks at afterwards, and that album is a real part of what
// this product sells. A pyramid, a freeze frame, a recreated family photo — those
// missions are photo because their value IS the picture, not because nobody could
// be bothered writing an answer key.
//
// SO THE TEST, before writing another photo mission: IS THE PICTURE THE POINT, OR
// IS IT A RECEIPT? If the team would happily never look at it again, the mission
// had a checkable answer hiding in it, and some other type would have handed them
// feedback for free instead of making rule 60 ask you to fake it in prose.
//
// THE TEST WAS THEN RUN OVER ALL 61, so nobody has to do it again. Fifty-seven
// are artifacts — a human pyramid, a freeze frame, a recreated family photo, a
// group shouting its battle cry into a stadium — and their pictures are the
// reason the mission exists. Four are receipts:
//
//     escape-route      the photo is of a fire exit. Nobody keeps that. Worse,
//                       nothing ever told the team whether they walked to the
//                       RIGHT one, so a navigation-from-memory mission had no
//                       answer at all. Fixed in place, not converted: it now
//                       sends them back to the map to check, which is the same
//                       repair silent-briefing got.
//     count-the-candles the content is literally a count. `numeric` would verify
//                       it — but the video of the cake is a birthday keepsake,
//                       so this is a genuine trade, not an oversight.
//     the-hidden-key    the payoff is the blind-guided search; the photo proves
//                       it happened. Convertible if whatever is locked held a
//                       code instead.
//     trade-up          "photograph the marker in your hand" is pure proof. The
//                       terminal condition is already unambiguous, so it loses
//                       nothing by staying a photo.
//
// Four of sixty-one is a much better ratio than the 59% headline suggests, and
// that is the useful correction: the bank is photo-heavy because this product
// makes albums, not because its authors were lazy. Rule 54's worry about a
// self-similar middle still stands; rule 76's worry about missing feedback turns
// out to apply to four missions rather than to sixty-one.
//
// ─── 77. A mission that can strand a team does not only fail itself — it taxes
//         the next one ────────────────────────────────────────────────────────
//
// FIRST, THE HONEST VERSION OF THE RESEARCH, because the pop-psychology version
// is the one everybody reaches for and it does not hold. The Zeigarnik effect —
// unfinished tasks are remembered better — is one of psychology's weaker
// replications: a 2025 meta-analysis across ninety-eight years of attempts found
// a pooled ratio of 0.99 and an effect size of 0.15, i.e. essentially nothing.
// Do not justify a multi-step mission by saying open loops are memorable.
//
// TWO NEIGHBOURING FINDINGS DID SURVIVE, and they are the ones that matter here.
// People RESUME interrupted tasks about two thirds of the time, well above
// chance, across children and adults and ninety years of methods (Ovsiankina).
// And attention leaves a residue: when you switch away from an unfinished task,
// part of your attention stays behind and performance on the NEXT task suffers,
// worst when the first was abandoned under time pressure. A field game is
// nothing but a timed sequence of tasks, so a mission that strands a team is not
// a self-contained failure — it degrades whatever the composer routes them to
// next, and the team will keep half-thinking about it.
//
// WHICH MAKES THE `sequence` TYPE THE SHARPEST EDGE IN THIS BANK, because a
// sequence is the one place a player cannot go round an obstacle: the steps are
// ordered and the mission does not complete until the last one does. And both of
// this bank's two sequence missions shipped with a step nobody could clear:
//
//     disarm-the-device      step 2 asked the team to type "the secret code
//                            word" against answer "פרוטוקול" — a word that
//                            appears nowhere in the mission, in no hint, in no
//                            media and in no Quick Setup prompt. It was
//                            unsolvable as authored, in a `noPrep` entry whose
//                            own comment boasted that every step was "fixed,
//                            fully self-contained content". Fixed by putting the
//                            code word in the briefing, which is what made the
//                            fiction work in the first place; difficulty
//                            re-priced 5 → 3 accordingly (rule 75), since what
//                            remains is doing three things in the right order.
//     team-decision-drill    step 2 reads "type the following word" and no word
//                            follows. Its required Quick Setup step tells the
//                            creator to replace the ANSWER and never mentions the
//                            prompt, so the sentence stays dangling however
//                            carefully the creator follows instructions. Now it
//                            asks a question the team can actually answer, and
//                            the setup prompt says to edit both halves.
//
// So: for every step with an answer, name where the player learns it. If the
// answer is not in the prompt, the description, a hint, attached media or a
// required Quick Setup field, the step is a wall. Rules 19 and 40 both already
// say this about missions; a sequence deserves its own line because it is the
// only type where failing one step means failing everything after it.
//
// ─── 78. `kids` + `youth` together is the strongest claim in this vocabulary,
//         and it is the one nobody checks ─────────────────────────────────────
//
// Forty-two of these 103 missions carry BOTH tags. That is not a mild claim
// about breadth. It says a ten-year-old and a fifteen-year-old will each find
// this good, and the research this file has been assembling says those two want
// opposite things:
//
//   • Rule 56: formal-operational reasoning — metaphor, analogy, the
//     hypothetical — arrives around eleven. A ten-year-old does not have it.
//   • Rule 51: the imaginary audience PEAKS between eleven and fifteen. A
//     fifteen-year-old is doing arithmetic about who is watching.
//   • Rule 32 says missions for ten-year-olds are made of the players; rule 43
//     says teenagers refuse anything that treats them as younger.
//
// A mission claiming both ends must therefore clear two bars at once: demand
// only CONCRETE operations, and carry a COVER — competence or a character — so
// the older end is never asked to be cute. Most of the forty-two survive that
// honestly, and it is worth seeing why, because it is the same answer every
// time: a distance to beat, a letter that has to be readable from above, a line
// ordered in silence, a tower that has to stand. Competence is what lets one
// mission serve both ages, which is a more useful design instruction than any
// amount of tone advice.
//
// AND THE COVER COMES FROM THREE PLACES, NOT ONE — found by building a scan for
// this rule and watching it over-fire on eleven of the forty-two, of which ten
// turned out to be fine:
//
//   THE PROSE     a stated target, a fail-and-retry, a synchrony requirement, a
//                 character. What the scan was looking for.
//   THE TYPE      `numeric`, `quiz`, `sequence`, `geofence` and `smart_station`
//                 have the platform tell the team whether they got it right, and
//                 being right IS competence (rule 76). Seven of the eleven were
//                 this: exact-count, how-many-steps, chalk-code, kims-game,
//                 anagram-easy, celebrants-favorites-ranking, vendor-secret-code.
//   THE STRUCTURE the accept-all pattern (rule 68) distributes exposure so that
//                 nobody stands alone in it, which is a cover in itself. Two more
//                 were this: birthday-wish and finish-what-we-didnt-know.
//
// And the last one is the correction that matters: A MISSION WITH NO EXPOSURE
// NEEDS NO COVER. Rule 51 is about being conspicuous; best-moment-so-far is four
// people talking to each other about the game they are playing, and asking what
// protects them is asking the wrong question of the wrong mission.
//
// Which left exactly ONE genuine failure out of forty-two — everyone-hidden, and
// its problem was rule 47 rather than this rule: "whoever looks must believe you
// are all there" names a judge the platform does not have, the same sentence
// shape that got frozen-genre deleted. Rewritten so the team checks it
// themselves and retries.
//
// THIS MATTERS COMMERCIALLY AND NOT ONLY THEORETICALLY. The birthday product
// this bank serves is sold for ages 10 to 15 — a band that straddles both
// boundaries exactly. Every mission in a 10-15 party game is making the double
// claim whether its author thought about it or not.
//
// AND THE OPERATOR HAD ALREADY FOUND THE FAILURES BY INSTINCT, before any of
// this was written down: open-team-name, silliest-walk and hero-walk are the
// three he stripped `youth` from or deleted outright, and they are precisely the
// three with no cover at either end. That is the best evidence available that
// this rule describes something real rather than something invented.
//
// One was still standing: birthday-wish — write a warm wish and read it aloud in
// unison — has no character and no skill, and it is the FINISHER of the birthday
// product, which by rule 55 means it is the sentence a paid event compresses
// into. Rewritten on the accept-all pattern (rule 68): each player writes one
// line, every line goes in, and each reads their own. Nobody has to own the
// sincerity alone, which is what made it unplayable at fifteen, and the wish is
// better for being six voices instead of one chorus.
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
    tags: ['start', 'teamwork', 'needsSetup', 'locationBased', 'outdoor', 'youth', 'mixed', 'easy', 'park', 'neighborhood', 'cityCenter', 'forest', 'beach', 'school'],
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
    tags: ['camera', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'home', 'youth', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'ראפ מנצח',
      description: 'בחרו שם לקבוצה, והקליטו סרטון של 30 שניות עם ראפ על הקבוצה שלכם. שם הקבוצה חייב להופיע בראפ לפחות פעמיים, וכל אחד מכם שר לפחות שורה אחת.',
      type: 'photo',
      estimatedMinutes: 15,
      smart: upload({ captureKind: 'video', videoMinSeconds: 20, videoMaxSeconds: 40 }),
    }),
  },
  {
    key: 'youth-great-escape',
    sourceTemplateKey: 'youth-missions',
    family: 'freeze-frame',
    tags: ['camera', 'creative', 'teamwork', 'action', 'noPrep', 'fromAnywhere', 'home', 'youth', 'mixed', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'המילוט הגדול',
      description: 'אתם בסצנת שיא של סרט פעולה: הרגע חילצתם חבר ואתם בורחים. צרו תמונה קפואה (Freeze Frame) של רגע הבריחה. לכל אחד מכם תפקיד אחר בסצנה, וכולם קופאים באותו רגע בדיוק.',
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
    tags: ['start', 'action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home', 'youth', 'mixed', 'medium', 'park', 'beach', 'forest', 'school'],
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
    // No longer familied with its old twin. The two were the SAME mission with
    // the word "first"/"second" swapped, which is what `family` is for — but the
    // twin has been rebuilt into `photo-vantage-point`, a genuinely different
    // act (deduce where the CAMERA stood, not where the subject is). Two
    // different mechanics must not be mutually exclusive: pairing them adds
    // variety rather than repeating it (rule 12).
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
      description: 'אחד מכם כתב טלוויזיה שמדווח בשידור חי על אירוע מוזר שקרה כאן. השאר משחקים ניצבים, עוברי אורח או גיבורי האירוע. סרטון של 40 שניות, עם פתיחה וסיום. הכתב חייב לומר איפה הוא עומד ומה קרה כאן. אם תצליחו לשכנע עובר אורח אמיתי להתראיין, זה מה שיהפוך את הסרטון לאמיתי.',
      type: 'photo',
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  // Both "מצאו את המקום" missions ask the creator to attach a photo OF THE SPOT,
  // which means going there and shooting it beforehand — real preparation, so
  // `needsSetup` (rule 18/30), not `noPrep` because there is no prop involved.
  {
    // Was `youth-find-place-two`, which carried the SAME sentence as
    // `youth-find-place-one` with "first" changed to "second" — two bank slots
    // for one mission, held apart only by a `family`. Rebuilt into the mission
    // the pair was pretending to be: the attached photo is shot FROM the target
    // rather than OF it, so the team has to reason backwards from what is
    // visible and at what angle to where the camera must have stood. Same
    // geofence verification, a genuinely different act (rule 12), and it is
    // harder than the original — hence difficulty 7 and `hard`.
    key: 'photo-vantage-point',
    sourceTemplateKey: 'youth-missions',
    tags: ['thinking', 'action', 'teamwork', 'needsSetup', 'locationBased', 'outdoor',
      'youth', 'adults', 'corporate', 'mixed', 'hard',
      'neighborhood', 'cityCenter', 'park', 'forest', 'beach', 'historic'],
    difficulty: 7,
    transitMinutes: 8,
    setup: [
      PLACE_IT,
      {
        // NOT the shared ATTACH_PHOTO: its prompt asks for a photo OF the spot,
        // "one the team can recognise" — the exact opposite of what this mission
        // needs. A step pointing at the right field with the wrong instruction
        // is how `youth-hardest-question` shipped broken (rule 26).
        field: 'media',
        required: true,
        prompt: 'עמדו בנקודה שסימנתם וצלמו משם החוצה, אל מה שרואים מהמקום. אל תצלמו את המקום עצמו.\n\nStand on the pin and shoot outwards, at the view FROM the spot. Do not photograph the spot itself.',
      },
    ],
    build: () => sited({
      title: 'מאיפה צולמה התמונה',
      description: 'התמונה שצורפה לא מראה לאן ללכת. היא צולמה מהנקודה שאליה אתם צריכים להגיע. הסתכלו מה נראה בה, מה קרוב ומה רחוק ומאיזו זווית, והבינו איפה עמד מי שצילם. לכו לשם.',
      type: 'geofence',
      difficulty: 7,
      estimatedMinutes: 7,
      pointValue: 160,
      hint: 'רמז: התחילו מהדבר הרחוק ביותר בתמונה, כי הוא מצמצם את הכיוון. אחר כך זוזו עד שהקרוב והרחוק מסתדרים זה מול זה בדיוק כמו בתמונה.',
      hintPenalty: 25,
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
    tags: ['finish', 'creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home', 'youth', 'mixed', 'medium', 'park', 'beach', 'forest', 'school'],
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
    tags: ['finish', 'teamwork', 'needsSetup', 'locationBased', 'outdoor', 'youth', 'mixed', 'medium', 'park', 'neighborhood', 'cityCenter', 'forest', 'beach', 'school'],
    difficulty: 5,
    // The last leg home, and usually the longest single walk of the game.
    transitMinutes: 10,
    setup: [PLACE_IT],
    build: () => base({
      title: 'נקודת הסיום',
      description: 'נווטו אל נקודת הסיום של המירוץ. עצרו רגע אחד לפני שאתם נכנסים, והסתכלו אחד על השני. עשיתם את זה.',
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
      description: 'בקופסה שקיבלתם יש שמפו. מכרו אותו לאדם זר בלפחות 10 שקלים, ספרו לו שזה חלק ממשחק, ובקשו רשות להצטלם איתו.',
      type: 'photo',
      // Re-priced 2 → 9 (rule 75). Harvested at 2 from the source template and
      // never checked: this is find a willing stranger, pitch, agree a price,
      // take money, explain the game, ask permission, film. Its neighbours are
      // honest-compliment at 6 and teach-a-stranger at 10, and money changing
      // hands puts it with the latter.
      estimatedMinutes: 9,
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
      // Re-priced 2 → 6 (rule 75). Its own `recreate-famous-image` siblings are
      // statue-remake at 5 minutes and difficulty 3, and family-photo-remake at
      // 8 and difficulty 4. This one is difficulty 5, needs a real crossing and
      // has to be timed against traffic, and was priced at a quarter of either.
      estimatedMinutes: 6,
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
    tags: ['start', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere', 'home',
      'mixed', 'kids', 'youth', 'easy', 'forest', 'beach', 'park', 'neighborhood',
      'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 2,
    build: () => anywhere({
      title: 'שם וקריאת קרב',
      // Rule 33: the old version was "choose a name and a battle cry", which one
      // loud member supplies while everyone else shouts along. Now every member
      // contributes a word and the NAME contains all of them, so a member who
      // did not take part is visible in the result rather than merely quiet in
      // it. The old closing nudge ("the less embarrassed you are, the better it
      // comes out") was also dropped: it pressures exactly the people the
      // team-building research says already opt out.
      description: 'בחרו שם לקבוצה כך: כל אחד מכם אומר מילה אחת, ומהמילים האלה אתם מרכיבים את השם. עכשיו אתם נכנסים לאצטדיון: אחד מכם הכרוז שמכריז על הקבוצה בקול, והשאר נכנסים ועונים בקריאת קרב של חמש שניות. צלמו את הכניסה.',
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
    tags: ['start', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere', 'home',
      'adults', 'corporate', 'mixed', 'easy'],
    difficulty: 2,
    build: () => anywhere({
      title: 'המוטו של הצוות',
      // Rule 33, same fix as `open-team-name`: "agree on one sentence" is
      // something one person writes and the rest nod at. Sourcing the sentence
      // from a word per member makes the agreement real work.
      description: 'כל אחד מכם אומר מילה אחת שמתארת את הצוות היום. עכשיו הרכיבו מהמילים משפט אחד שכולכם עומדים מאחוריו, ואמרו אותו יחד מול המצלמה.',
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
    tags: ['start', 'action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home',
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
    // Same go-around-the-circle mechanic as `finish-what-we-didnt-know`, one
    // word instead of one sentence — a game must never close on both (rule 12).
    family: 'closing-round',
    tags: ['finish', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere', 'home',
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
        tags: ['finish', 'action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home',
      'mixed', 'kids', 'youth', 'medium', 'forest', 'beach', 'park', 'neighborhood',
      'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 4,
    build: () => anywhere({
      title: 'טקס הניצחון',
      description: 'טקס הפרסים: החליטו יחד על תואר אחד שהקבוצה שלכם הרוויחה היום, משהו אמיתי שקרה. אחד מכם מכריז עליו בקול, וכולם עולים לפודיום ומקבלים אותו. פוזה דרמטית, כאילו יש קהל. צלמו את הרגע.',
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
    tags: ['camera', 'action', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'outdoor',
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
        tags: ['creative', 'teamwork', 'camera', 'noPrep', 'fromAnywhere', 'home', 'mixed',
      'youth', 'kids', 'corporate', 'medium', 'forest', 'beach', 'park', 'neighborhood',
      'school', 'indoor', 'outdoor'],
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
        tags: ['camera', 'teamwork', 'creative', 'thinking', 'noPrep', 'fromAnywhere', 'home',
      'mixed', 'youth', 'adults', 'corporate', 'medium', 'forest', 'beach', 'park',
      'neighborhood', 'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 6,
    build: () => anywhere({
      title: 'תדרוך בלי מילים',
      description: 'אחד מכם קורא בשקט: "בנו מגדל מחפצים שיש לכם, אבל הפוך: הבסיס הרחב למעלה, לא למטה." בלי מילים, רק בציור, העבירו את ההוראה לצוות. הם מבצעים לפי מה שהבינו. עכשיו הקריאו את ההוראה המקורית בקול והשוו למה שנבנה: קלעתם? צלמו את התוצאה ואת הציור זה לצד זה.',
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
    tags: ['camera', 'thinking', 'teamwork', 'needsSetup', 'locationBased', 'outdoor', 'indoor',
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
        // Two parts, because orienteering course setting says a findable point
        // needs an ATTACK POINT (an obvious thing you navigate to first) and a
        // COLLECTING FEATURE (something big just before it that says "you are
        // close"). "Write a general area clue" produced neither, and a team with
        // only an area either sweeps it or gives up.
        prompt: 'רמז בשני חלקים: לאן ללכת קודם (משהו בולט), ומה יגיד להם שהם קרובים. לא המקום המדויק.\n\nA two part clue: where to head first (something obvious), and what tells them they are close. Not the exact spot.',
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
        tags: ['creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home', 'mixed',
      'youth', 'adults', 'corporate', 'medium', 'forest', 'beach', 'park', 'neighborhood',
      'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 5,
    build: () => anywhere({
      title: 'פרסומת למוצר שלא קיים',
      description: 'המציאו מוצר שלא קיים ותנו לו שם וסיסמה. צלמו לו פרסומת שיש בה שלושה דברים: הבעיה שהמוצר פותר, הדגמה שלו בפעולה, והסיסמה בסוף. כולכם מופיעים בה.',
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
    tags: ['creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home',
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
    tags: ['camera', 'creative', 'thinking', 'teamwork', 'noPrep', 'fromAnywhere', 'home',
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
      description: 'מצאו אדם זר, בקשו רשות ושאלו: מה העצה הכי טובה שהוא קיבל אי פעם, וממי? צלמו את התשובה.',
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
      'mixed', 'youth', 'adults', 'medium', 'crowded'],
    difficulty: 5,
    build: () => anywhere({
      title: 'מחמאה אמיתית',
      description: 'בחרו אדם זר, ומצאו אצלו פרט אחד שאי אפשר להגיד על אף אחד אחר. אמרו לו אותו במילים שלכם. אם הוא חייך, בקשו סלפי משותף.',
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
    tags: ['camera', 'action', 'teamwork', 'creative', 'needsSetup', 'fromAnywhere',
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
    tags: ['camera', 'teamwork', 'creative', 'noPrep', 'fromAnywhere', 'home',
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
    tags: ['camera', 'action', 'creative', 'teamwork', 'noPrep', 'fromAnywhere', 'indoor',
      'office', 'school',
      'corporate', 'adults', 'mixed', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'אולימפיאדת המשרד',
      description: 'המציאו ענף ספורט חדש שאפשר לשחק רק בציוד משרדי. כל אחד מכם מוסיף לו חוק אחד, וכל החוקים נשארים בפנים. שחקו סיבוב שלם לפי כולם, וצלמו את הזוכה חוגג.',
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
    tags: ['camera', 'creative', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere', 'indoor',
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
    tags: ['thinking', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home',
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
    tags: ['action', 'creative', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'home',
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
    tags: ['camera', 'teamwork', 'action', 'noPrep', 'fromAnywhere', 'home',
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
      title: 'רגליים חדשות',
      description: 'אתם משלחת מכוכב אחר, וקיבלתם רגליים רק הבוקר. המציאו ביחד הליכה אחת של מי שעדיין לא הבין איך הדבר הזה עובד, ולכו בה עשרה מטרים. כל הקבוצה, אותה הליכה, באותו זמן. צלמו מהצד.',
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
    tags: ['camera', 'thinking', 'action', 'creative', 'noPrep', 'fromAnywhere',
      'neighborhood', 'cityCenter', 'beach', 'historic',
      'adults', 'corporate', 'mixed', 'hard', 'educational'],
    difficulty: 7,
    build: () => anywhere({
      title: 'האגדה המקומית',
      description: 'מצאו מישהו שגר או עובד כאן הרבה זמן. בקשו ממנו סיפור מוזר או מפתיע על המקום, ובקשו פרט אחד שאפשר לבדוק: שם, שנה או אירוע. בקשו רשות לצלם את התשובה למשחק, ובסוף הסרטון חזרו על הפרט בקול.',
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
    tags: ['teamwork', 'creative', 'thinking', 'noPrep', 'fromAnywhere', 'home', 'indoor',
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
      'mixed', 'youth', 'kids', 'adults', 'medium'],
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
      'mixed', 'youth', 'adults', 'medium'],
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
      'mixed', 'youth', 'adults', 'corporate', 'easy', 'crowded'],
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
    tags: ['creative', 'camera', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere', 'home',
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
    tags: ['creative', 'camera', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere', 'home',
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
    tags: ['creative', 'camera', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere', 'home',
      'park', 'forest', 'beach', 'neighborhood', 'school',
      'mixed', 'kids', 'youth', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'כולם בתמונה, אף אחד לא נראה',
      description: 'צלמו תמונה שכל הקבוצה נמצאת בה ואי אפשר לזהות אף אחד: לא פנים ולא סימן מזהה. מאחורי עצים, מתחת לשמיכה, רק צללים. עברו על התמונה יחד, ואם מישהו מזוהה צלמו שוב.',
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
    tags: ['teamwork', 'thinking', 'needsSetup', 'fromAnywhere', 'home', 'indoor',
      'office', 'mall', 'park', 'school',
      'corporate', 'adults', 'medium'],
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
        { id: uuid(), prompt: 'מהו הערך האחד שהצוות שלנו באמת מתנהל לפיו? הסכימו עליו פה אחד והקלידו אותו.', answer: '' },
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
    tags: ['camera', 'thinking', 'teamwork', 'action', 'noPrep', 'fromAnywhere', 'indoor',
      'mall', 'office', 'school',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'educational', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'מסלול המילוט',
      description: 'מצאו את מפת המילוט על הקיר. הסתכלו עליה 30 שניות, ואז לכו יחד ליציאת החירום הקרובה, בלי להסתכל שוב ובלי לשאול. צלמו את היציאה שהגעתם אליה, ואז חזרו למפה ובדקו: באמת הגעתם לקרובה ביותר?',
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
    tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'mixed', 'kids', 'youth',
      'adults', 'corporate', 'easy', 'forest', 'beach', 'park', 'neighborhood',
      'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 2,
    build: () => anywhere({
      title: 'הרגע הכי טוב עד עכשיו',
      description: 'עצרו לרגע. כל אחד בתורו אומר בקול מה היה הרגע הכי כיף שלו במשחק עד עכשיו, ולמה דווקא הוא. אחרי שכולם דיברו, בחרו יחד את התשובה שהכי מתאימה לכם.',
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
        tags: ['camera', 'thinking', 'creative', 'noPrep', 'fromAnywhere', 'home', 'mixed',
      'kids', 'youth', 'adults', 'corporate', 'easy', 'forest', 'beach', 'park',
      'neighborhood', 'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
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
    tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'crowded',
      'school', 'office', 'mall', 'park',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
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
        // Same two-part shape as the-hidden-key's clue, for the same reason.
        prompt: 'רמז בשני חלקים: לאן ללכת קודם, ומה יגיד להם שהקוד ממש כאן. לא המקום המדויק.\n\nA two part clue: where to head first, and what tells them the code is right here. Not the exact spot.',
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
    tags: ['camera', 'action', 'needsSetup', 'fromAnywhere',
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
        tags: ['action', 'camera', 'noPrep', 'fromAnywhere', 'home', 'kids', 'youth', 'adults',
      'mixed', 'easy', 'forest', 'beach', 'park', 'neighborhood', 'cityCenter', 'mall',
      'office', 'school', 'indoor', 'outdoor'],
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
      description: 'כל אחד מכם כותב שורה אחת של איחול לחוגג/ת, וכל השורות נכנסות פנימה. עכשיו קראו את האיחול המלא מול המצלמה, שורה אחרי שורה, כל אחד את שלו.',
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
        tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'kids', 'youth', 'mixed', 'easy',
      'forest', 'beach', 'park', 'neighborhood', 'cityCenter', 'mall', 'office', 'school',
      'indoor', 'outdoor'],
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
        tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'youth', 'adults', 'mixed',
      'medium', 'forest', 'beach', 'park', 'neighborhood', 'cityCenter', 'mall', 'office',
      'school', 'indoor', 'outdoor'],
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
        tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'adults', 'corporate', 'mixed',
      'hard', 'forest', 'beach', 'park', 'neighborhood', 'cityCenter', 'mall', 'office',
      'school', 'indoor', 'outdoor'],
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
    tags: ['thinking', 'teamwork', 'needsSetup', 'fromAnywhere', 'home', 'adults', 'corporate', 'hard'],
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

  // ══════════════════════════════════════════════════════════════════════════
  // Added 2026-08-30 (change: brand-any-place). Zero-prep thinking missions for
  // the audience the site's own marketing now explicitly courts: a group playing
  // from a living room, with no venue and nothing to bring. The bank already had
  // 61 `fromAnywhere` entries out of 84 and a solid `home`-tagged party cluster
  // (celebrant ranking, birthday wish, candle count…), but almost nothing in the
  // "one clever riddle, zero setup, works for a birthday table or a corporate
  // offsite alike" lane the vault/echo pair below fills. Ported from
  // `scripts/lib/spy-academy-game-def.mjs`'s own flagship demo content — already
  // authored, already fun, already proven — rather than invented from scratch;
  // see rule 15 (ship the real content, not a mechanic label).
  // ══════════════════════════════════════════════════════════════════════════
  {
    // Rule 23 (a riddle needs a payoff): the classic echo riddle's answer is the
    // one thing in the room that can genuinely answer back — teams that read it
    // aloud usually hear it before they solve it.
    key: 'echo-riddle',
    sourceTemplateKey: 'authored',
        tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'youth', 'adults', 'corporate',
      'mixed', 'medium', 'forest', 'beach', 'park', 'neighborhood', 'cityCenter', 'mall',
      'office', 'school', 'indoor', 'outdoor'],
    difficulty: 4,
    build: () => anywhere({
      title: 'חידת ההד',
      description: 'מדבר בלי פה, שומע בלי אוזניים, נולד מהרים ומת בשקט. מי אני? הקלידו את התשובה במילה אחת.',
      type: 'quiz',
      difficulty: 4,
      estimatedMinutes: 3,
      pointValue: 110,
      answers: ['הד'],
      hint: 'רמז: תצעקו במקום ריק וסגור, ותקשיבו למה שחוזר אליכם.',
      hintPenalty: 15,
    }),
  },
  {
    // A real lateral-thinking calculation with one committed answer, not a
    // decorative "add these up" — the two facts it leans on (spider legs, days
    // in a week) are true for every reader, so nothing here can come out
    // ambiguous the way a venue-dependent count could (rule 8/31).
    key: 'vault-combination-riddle',
    sourceTemplateKey: 'authored',
        tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'youth', 'adults', 'corporate',
      'mixed', 'easy', 'forest', 'beach', 'park', 'neighborhood', 'cityCenter', 'mall',
      'office', 'school', 'indoor', 'outdoor'],
    difficulty: 3,
    build: () => anywhere({
      title: 'פיצוח הכספת',
      description: 'צירוף הכספת הוא מספר הרגליים של עכביש, ועוד מספר הימים בשבוע. הקלידו את הצירוף.',
      type: 'numeric',
      difficulty: 3,
      estimatedMinutes: 2,
      pointValue: 90,
      numericAnswer: 15,
      numericTolerance: 0,
      hint: 'רמז: לעכביש יש 8 רגליים. בשבוע יש 7 ימים.',
      hintPenalty: 10,
    }),
  },
  {
    // The bank's `sequence` type had exactly ONE representative
    // (team-decision-drill) across 87 entries before this one — and that entry
    // needs a required setup step (a real value to arrive at), so there was no
    // zero-prep sequence mission at all. This one needs nothing from the creator.
    //
    // It also shipped UNSOLVABLE and stayed that way (rule 77): step 2 demanded a
    // secret code word that appeared nowhere — not in the prompt, the
    // description, a hint, media or a setup field — in a `sequence`, the one type
    // where a wall on one step blocks every step after it. The briefing now
    // carries the word, which is what the fiction wanted anyway, and the
    // difficulty is re-priced from 5 to 3 (rule 75): what is left is doing three
    // things in the right order.
    key: 'disarm-the-device',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'teamwork', 'noPrep', 'fromAnywhere', 'home', 'youth', 'adults',
      'corporate', 'mixed', 'easy', 'forest', 'beach', 'park', 'neighborhood',
      'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 3,
    build: () => anywhere({
      title: 'נטרול המנגנון',
      description: 'שלושה סוכנים לפניכם נכשלו כאן. מילת הקוד לנטרול היא "פרוטוקול". בצעו את שלושת השלבים בדיוק לפי הסדר, בלי טעויות.',
      type: 'sequence',
      difficulty: 3,
      estimatedMinutes: 4,
      pointValue: 120,
      steps: [
        { id: uuid(), prompt: 'שלב 1: חברו את החוט הכחול. אשרו כשסיימתם.' },
        { id: uuid(), prompt: 'שלב 2: הקלידו את מילת הקוד הסודית.', answer: 'פרוטוקול' },
        { id: uuid(), prompt: 'שלב 3: קחו נשימה עמוקה, ולחצו לנטרול סופי.' },
      ],
    }),
  },
  {
    // A classic riddle whose answer is guaranteed to exist wherever this is
    // played (rule 31): every home, office and school bathroom holds one. The
    // youngest-friendly entry of the three, and the only one carrying `home`.
    key: 'household-riddle-comb',
    sourceTemplateKey: 'authored',
        tags: ['thinking', 'noPrep', 'fromAnywhere', 'home', 'kids', 'mixed', 'easy', 'forest',
      'beach', 'park', 'neighborhood', 'cityCenter', 'mall', 'office', 'school', 'indoor',
      'outdoor'],
    difficulty: 2,
    minAge: 6,
    build: () => anywhere({
      title: 'החידה שיושבת בבית',
      description: 'יש לי שיניים אבל אני לא נושך, ויש לי גב אבל אף אחד לא שוכב עליי. אני שטוח, אני נכנס לתיק, ואני עובר לכם בשיער בכל בוקר. מי אני? הקלידו את התשובה במילה אחת.',
      type: 'quiz',
      difficulty: 2,
      estimatedMinutes: 2,
      pointValue: 70,
      answers: ['מסרק'],
      hint: 'רמז: תמצאו אותי ליד הכיור, או במגירה באמבטיה.',
      hintPenalty: 10,
    }),
  },
  {
    // A real named practice (rule 3), and `noPrep` on purpose: unlike
    // paper-airplane-trial (needs paper someone must supply in advance), this
    // uses only furniture and soft goods already standing in the room — the
    // same reasoning `human-letter`/`open-everyone-airborne` use for bodies.
    key: 'blanket-fort',
    sourceTemplateKey: 'authored',
    tags: ['creative', 'teamwork', 'camera', 'noPrep', 'fromAnywhere', 'home', 'kids', 'mixed', 'easy'],
    difficulty: 3,
    minAge: 6,
    build: () => anywhere({
      title: 'המצודה מהסלון',
      description: 'בנו מצודה משמיכות, כריות וכריות ספה. כל חברי הקבוצה חייבים להיכנס פנימה בבת אחת. צלמו את המצודה מבחוץ, ואת כולכם דחוסים בפנים.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 8,
      pointValue: 90,
      smart: upload(),
    }),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Written against rules 33-40, 2026-09-01
  // ══════════════════════════════════════════════════════════════════════════
  //
  // The trigger was a real composed game: a youth ACTION game for 14-17 year
  // olds, five players, which ended on `birthday-wish` — "write a warm wish for
  // the birthday kid". Nothing was broken. The bank held exactly FIVE finales
  // for the entire product, one of them birthday-only, and `occasion` is a SOFT
  // bonus by design (occasions.ts: "it lifts a favoured mission, it never
  // excludes an unfavoured one"), so an occasion-specific mission is free to win
  // any game whose audience tags it happens to match. A starved pool turns that
  // from a theoretical wart into the ending of somebody's event.
  //
  // Five of the ten below are bookends for that reason. The other five are the
  // categories rules 33-40 found missing entirely.

  // ── Finales: the pool goes 5 → 8, and from one flavour to three ───────────
  {
    // The cinematic one. Rule 33: every member has their own beat (each peels
    // off separately), so a member who did not participate is visible in the
    // result rather than merely absent from it — and the clip is the thing a
    // team actually keeps, which is what a finale is for.
    key: 'finish-the-credits',
    sourceTemplateKey: 'authored',
    tags: ['finish', 'camera', 'creative', 'teamwork', 'action', 'noPrep', 'fromAnywhere', 'home',
      'park', 'beach', 'forest', 'school', 'neighborhood', 'cityCenter',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'הקרדיטים',
      description: 'צלמו את סצנת הסיום של הסרט שלכם: כל הקבוצה הולכת יחד מהמצלמה והלאה, לאט, בלי להסתכל אחורה. כל כמה שניות אחד מכם פורש הצידה ונעצר, עד שנשאר אחד. הוא מסתובב למצלמה ואומר משפט אחד לסיום.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 6,
      pointValue: 130,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },
  {
    // The high-stakes one, and the finale a 14-17 action game was missing. Rule
    // 37: the team CHOOSES the move before it knows whether it can land it five
    // times in a row. Rule 33: it completes only when every member has done it,
    // so nobody can be delegated to. Rule 17: the restart is what makes the bar
    // cost something instead of decorating the copy.
    key: 'finish-all-or-nothing',
    sourceTemplateKey: 'authored',
    tags: ['finish', 'action', 'teamwork', 'camera', 'noPrep', 'fromAnywhere', 'home',
      'park', 'beach', 'school', 'neighborhood',
      'mixed', 'kids', 'youth', 'adults', 'medium'],
    difficulty: 6,
    build: () => anywhere({
      title: 'כולם או אף אחד',
      description: 'בחרו יחד פעולה פיזית אחת שכל אחד מכם מסוגל לעשות: קפיצה על רגל אחת, סיבוב שלם באוויר, מסירה מאחורי הגב. עכשיו כל הקבוצה מבצעת אותה בזה אחר זה ברצף אחד, בלי הפסקה ובלי חיתוך. מישהו פספס? חוזרים לראשון. צלמו את הריצה שהצליחה.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 8,
      pointValue: 160,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
      hint: 'רמז: בחרו את הפעולה לפי החלש ביותר בקבוצה ולא לפי החזק. תנועה מרשימה שנופלת בניסיון החמישי שווה פחות מתנועה פשוטה שעוברת.',
      hintPenalty: 20,
    }),
  },
  {
    // The warm one, and RECIPE's Reflection element — the bank closes games on
    // performance and never on what the day actually was. Rule 33: each member
    // speaks about a DIFFERENT member, so it cannot be delivered by whoever
    // talks most. Familied with `finish-one-word-each`, which is the same
    // go-around-the-circle mechanic with a shorter unit (rule 12).
    key: 'finish-what-we-didnt-know',
    sourceTemplateKey: 'authored',
    family: 'closing-round',
        tags: ['finish', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere', 'home',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'easy', 'forest', 'beach', 'park',
      'neighborhood', 'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 3,
    build: () => anywhere({
      title: 'הדבר שלא ידענו',
      description: 'עמדו במעגל וצלמו. כל אחד בתורו אומר משפט אחד על מישהו אחר בקבוצה: דבר אחד שגילה עליו היום ולא ידע קודם. כל אחד מדבר פעם אחת, ועל כל אחד נאמר משהו.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 5,
      pointValue: 100,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
    }),
  },

  // ── Openers: 6 → 8, and the first one that asks the team to decide ────────
  {
    // Every existing opener warms the group up; none asks it to DECIDE anything
    // (rule 37). This is a real commitment made before any outcome is known, and
    // consensus is the gate (rule 33) so the loudest member cannot supply it
    // alone. The "something you give up" clause is rule 17: without it every
    // team writes three rules it was going to follow anyway.
    key: 'open-team-pact',
    sourceTemplateKey: 'authored',
        tags: ['start', 'teamwork', 'thinking', 'creative', 'camera', 'noPrep', 'fromAnywhere',
      'home', 'mixed', 'kids', 'youth', 'adults', 'corporate', 'easy', 'forest', 'beach',
      'park', 'neighborhood', 'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 3,
    build: () => anywhere({
      title: 'הסכם הצוות',
      description: 'לפני שמתחילים: הסכימו על שלושה כללים שהקבוצה שלכם משחקת לפיהם היום. אחד מהם חייב להיות משהו שאתם מוותרים עליו, לא רק משהו שאתם עושים. כתבו אותם על מה שיש לכם (דף, היד, פתק בטלפון), כולם חותמים, וצלמו.',
      type: 'photo',
      difficulty: 3,
      estimatedMinutes: 5,
      pointValue: 90,
      smart: upload(),
    }),
  },
  {
    // The placeless ACTION opener for teenagers, the exact band the composed
    // game that triggered this pass was serving. Rule 33: one continuous shot
    // with a fixed per-member unit, so five players produce a visibly different
    // result from four.
    key: 'open-one-take-intro',
    sourceTemplateKey: 'authored',
    tags: ['start', 'action', 'camera', 'teamwork', 'creative', 'noPrep', 'fromAnywhere', 'home',
      'park', 'school', 'neighborhood', 'beach', 'cityCenter',
      'mixed', 'youth', 'kids', 'adults', 'medium'],
    difficulty: 4,
    build: () => anywhere({
      title: 'טייק אחד',
      description: 'סרטון אחד רצוף, בלי חיתוכים: המצלמה עוברת מאחד לשני, וכל אחד בתורו אומר את שמו ועושה תנועה אחת משלו. מי שמצלם עובר ביניכם בלי לעצור. נגמר כשכולם היו.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 5,
      pointValue: 100,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
      hint: 'רמז: סדרו את עצמכם בקו או בחצי מעגל לפני שמתחילים לצלם. רוב הטייקים נופלים כי המצלמה מחפשת את הבא בתור.',
      hintPenalty: 15,
    }),
  },

  // ── Rule 36: the bank's first rare finds, and its first prices above 170 ──
  {
    // Luck plus hustle — an engine nothing else in the bank runs on. Priced at
    // 200 on purpose (rule 36): a rare find that scores like a group selfie
    // teaches players that hustling was pointless. Rule 31 holds because any
    // street with parked cars carries one within a few minutes, and a car park
    // is near-certain.
    key: 'rare-triple-plate',
    sourceTemplateKey: 'authored',
    family: 'rare-find',
    tags: ['action', 'thinking', 'camera', 'teamwork', 'noPrep', 'fromAnywhere',
      'neighborhood', 'cityCenter', 'mall',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'שלוש זהות',
      description: 'מצאו רכב חונה שבלוחית הרישוי שלו מופיעה אותה ספרה שלוש פעמים לפחות. הצטלמו ליד הרכב, כך שהלוחית נקראת בבירור בתמונה.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 9,
      pointValue: 200,
      smart: upload(),
      hint: 'רמז: התפצלו לשני צדי הרחוב וסרקו לוחית אחרי לוחית. מגרש חניה שווה יותר מרחוב.',
      hintPenalty: 25,
    }),
  },
  {
    // Rule 36 crossed with rule 35: the rare thing IS a person, so the stranger
    // ends up in the photo as a participant rather than as a subject. Rule 39 —
    // among the highest social-risk missions in the bank, and it must never open
    // a game. The refusal line is the floor: a team that gets turned down has a
    // stated next move instead of a stall.
    key: 'namesake-stranger',
    sourceTemplateKey: 'authored',
    family: 'rare-find',
    tags: ['action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'crowded',
      'cityCenter', 'mall', 'neighborhood', 'beach',
      'mixed', 'youth', 'adults', 'corporate', 'hard'],
    difficulty: 7,
    build: () => anywhere({
      title: 'שם משותף',
      description: 'מצאו אדם זר שקוראים לו בדיוק כמו אחד מכם. הציגו את עצמכם, ספרו לו שאתם באמצע משחק ולמה אתם שואלים, ובקשו רשות לתמונה של שניהם יחד.',
      type: 'photo',
      difficulty: 7,
      estimatedMinutes: 12,
      pointValue: 220,
      smart: upload(),
      hint: 'רמז: במקום לשאול אדם אחד בכל פעם, שאלו קבוצות. שולחן בבית קפה או תור בקופה נותנים חמישה שמות בבת אחת.',
      hintPenalty: 30,
    }),
  },

  // ── Rule 35: the stranger finally gets something to do ────────────────────
  {
    // The rule's own worked example. Every other stranger mission here has them
    // watching, answering or being photographed; this one only completes when
    // the STRANGER performs. "Without you leading" is the self-validating clause
    // (rule 40) — the team can see for itself whether it actually taught it.
    key: 'teach-a-stranger',
    sourceTemplateKey: 'authored',
    tags: ['action', 'creative', 'teamwork', 'camera', 'noPrep', 'fromAnywhere', 'crowded',
      'cityCenter', 'mall', 'neighborhood', 'beach', 'park',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 6,
    build: () => anywhere({
      title: 'תלמידים לרגע',
      description: 'המציאו עכשיו לחיצת יד משלכם: כל אחד מכם מוסיף בתורו תנועה אחת, וכולן נשארות בפנים. לימדו אותה לאדם זר עד שהוא מבצע את כל התנועות נכון בעצמו. בקשו ממנו רשות לצלם אותו למשחק, וצלמו אותו עושה אותה בלי שאתם מובילים.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 10,
      pointValue: 170,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 40 }),
      hint: 'רמז: שלוש תנועות פשוטות נלמדות בשלושים שניות. אם הזר מתבלבל, המצאתם משהו מסובך מדי — פשטו ותנסו שוב.',
      hintPenalty: 20,
    }),
  },

  // ── Rule 34: provocation with zero authoring cost ─────────────────────────
  {
    // The Situationist dérive — the constraint generates the experience, so the
    // mission needs no pin, no prep and nothing planted, and still puts the team
    // somewhere they would never have chosen. Tilden's provocation at its
    // cheapest. Bounded to three turns AND a return leg on purpose: an unbounded
    // drift would swallow the route it is embedded in.
    key: 'drift-three-turns',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'action', 'teamwork', 'camera', 'noPrep', 'fromAnywhere',
      'neighborhood', 'cityCenter', 'park',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'שלוש פניות',
      description: 'מכאן: פנייה ראשונה ימינה, אחר כך ראשונה שמאלה, אחר כך ראשונה ימינה שוב. עצרו בדיוק איפה שנגמרה השלישית. צלמו את מה שמולכם ואמרו במשפט אחד למה לא הייתם מגיעים לכאן לבד. ואז חזרו.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 9,
      pointValue: 120,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 30 }),
    }),
  },

  // ── Rule 33: the mission the quiet member wins ────────────────────────────
  {
    // The bank had nothing where being careful beat being loud, which is exactly
    // the population the team-building research says disengages. Self-validating
    // by construction (rule 40): the camera pans to the real scene at the end,
    // so the recall is checkable without the creator authoring a single answer —
    // and that is what keeps it out of the saturated counting family.
    key: 'the-witness',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'teamwork', 'camera', 'noPrep', 'fromAnywhere', 'home',
      'cityCenter', 'neighborhood', 'park', 'mall', 'school', 'office',
      'mixed', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 6,
    build: () => anywhere({
      title: 'העד',
      description: 'אחד מכם מסתכל על מה שמולו בשקט מוחלט דקה שלמה, בלי לצלם ובלי לדבר. אחר כך הוא מסתובב עם הגב ומונה בקול את הפרטים שהוא זוכר, ואז השאר מוסיפים כל מה שהם קלטו. המטרה של כולכם ביחד: עשרה פרטים נכונים. בסוף הפנו את המצלמה למקום עצמו, כדי שאפשר יהיה לבדוק.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 7,
      pointValue: 150,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 60 }),
      hint: 'רמז: קל יותר לזכור לפי אזורים ולא לפי חפצים: שמאל, מרכז, ימין, ואז כל מה שמעל גובה העיניים.',
      hintPenalty: 20,
    }),
  },

  // ── The bank's first `pausesTimer` mission ────────────────────────────────
  {
    // `pausesTimer` is a real, shipped platform field that no entry had ever
    // used, and this is a mission that justifies it rather than merely
    // exercising it: under time pressure a team guesses, and guessing destroys
    // the only thing a deduction puzzle is for. It is also the bank's only
    // change of rhythm — one point where the race stops and the group argues.
    // Rule 15: the puzzle is authored, with a real checkable answer, not a
    // mechanic label.
    key: 'thinking-room',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'teamwork', 'noPrep', 'fromAnywhere', 'home',
      'office', 'school', 'mall', 'park',
      'mixed', 'youth', 'adults', 'corporate', 'hard'],
    difficulty: 8,
    build: () => anywhere({
      title: 'חדר החשיבה',
      description: 'השעון עצור עכשיו, אז אל תמהרו. לפניכם שמונה מטבעות שנראים זהים, אבל אחד מהם כבד מהשאר. יש לכם מאזני כפות בלבד, בלי משקולות. מה מספר השקילות הקטן ביותר שמבטיח שתמצאו את הכבד? אסור לחפש בגוגל — התווכחו עד שכולכם בטוחים.',
      type: 'numeric',
      difficulty: 8,
      estimatedMinutes: 8,
      pointValue: 180,
      numericAnswer: 2,
      numericTolerance: 0,
      pausesTimer: true,
      hint: 'רמז: אל תשקלו ארבעה מול ארבעה. נסו לחלק לשלוש קבוצות.',
      hintPenalty: 30,
    }),
  },

  // ── Rule 38: written FOR a living room, not merely tagged for one ─────────
  //
  // 56 entries carry `home`, but almost all of them are placeless missions that
  // happen to work indoors. Only a handful were actually authored for a family
  // on a sofa. These three are, and each one takes an ingredient a home is
  // guaranteed to hold (rule 31 is stricter indoors: a flat has no fallback).
  {
    // The scavenger-hunt research names "recreate an old photo of yourselves"
    // as one of the most loved prompts there is, and it is RECIPE's Reflection
    // element — the only mission in the bank that reaches back into the players'
    // own history. Rule 31: the old photo is already on somebody's phone.
    // Rule 33: everyone who was in the original has to be in the remake, so the
    // result shows who took part. Familied with the other two "reproduce a
    // reference image with your bodies" missions (rule 12).
    key: 'family-photo-remake',
    sourceTemplateKey: 'authored',
    family: 'recreate-famous-image',
        tags: ['creative', 'camera', 'teamwork', 'thinking', 'noPrep', 'fromAnywhere', 'home',
      'mixed', 'kids', 'youth', 'adults', 'medium', 'forest', 'beach', 'park',
      'neighborhood', 'cityCenter', 'mall', 'office', 'school', 'indoor', 'outdoor'],
    difficulty: 4,
    build: () => anywhere({
      title: 'התמונה מלפני שנים',
      description: 'חפשו בטלפונים תמונה ישנה שלכם, מלפני כמה שנים לפחות, שכמה מכם מופיעים בה. שחזרו אותה עכשיו: אותה תנוחה, אותו סידור, אותן הבעות. כל מי שהיה במקור חייב להיות גם בשחזור. החזיקו את התמונה הישנה בתוך הפריים, כדי שרואים את שתיהן יחד.',
      type: 'photo',
      difficulty: 4,
      estimatedMinutes: 8,
      pointValue: 130,
      smart: upload(),
      hint: 'רמז: תמונה עם רקע פשוט קלה הרבה יותר לשחזור מתמונה בחוץ. חפשו משהו שצולם בבית.',
      hintPenalty: 15,
    }),
  },
  {
    // The physical home mission, and un-quarterbackable by construction: the
    // course is built together and then EVERY member runs it, so the video is
    // as long as the team is. Rule 31: furniture and cushions are the one thing
    // every living room certainly has. Rule 22: the byproduct is furniture out
    // of place, so putting it back is in the copy the players read.
    key: 'living-room-obstacle',
    sourceTemplateKey: 'authored',
    tags: ['action', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere', 'home', 'indoor',
      'school', 'office',
      'mixed', 'kids', 'youth', 'medium'],
    difficulty: 5,
    build: () => anywhere({
      title: 'מסלול המכשולים מהסלון',
      description: 'בנו מסלול מכשולים מרהיטים, כריות ושמיכות: לפחות ארבע תחנות, אחת שעוברים מתחתיה ואחת שעוברים מעליה. כל אחד מכם עובר את המסלול כולו. צלמו את כל המעברים ברצף אחד. בסוף מחזירים את הרהיטים למקום.',
      type: 'photo',
      difficulty: 5,
      estimatedMinutes: 12,
      pointValue: 140,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 60 }),
      hint: 'רמז: בנו את המסלול סביב מה שכבר עומד במקום. להזיז ספה לוקח יותר זמן מכל המסלול.',
      hintPenalty: 15,
    }),
  },
  {
    // The bank's first mission built on INFORMATION ASYMMETRY, which rule 33
    // names as the strongest anti-quarterbacking fix there is and which nothing
    // here had ever used. It is also the one mechanic the platform already
    // supports and the bank ignored: a team's phones carry a `controllerUid`
    // and only the controller may submit (`joinTeamAsDevice`), so "the one
    // holding the phone is the one who cannot see" is a real division of
    // labour rather than an honour rule. Deliberately NOT `needsSetup`: the
    // object is chosen from whatever is in the room.
    key: 'blind-describe',
    sourceTemplateKey: 'authored',
    tags: ['thinking', 'teamwork', 'creative', 'camera', 'noPrep', 'fromAnywhere', 'home', 'indoor',
      'office', 'school', 'mall',
      'mixed', 'kids', 'youth', 'adults', 'corporate', 'medium'],
    difficulty: 6,
    build: () => anywhere({
      title: 'תארו לי בלי להגיד',
      description: 'מי שמחזיק בטלפון מסתובב עם הגב ולא מציץ. השאר בוחרים חפץ אחד בחדר ומתארים אותו במילים בלבד: בלי להגיד מה זה, בלי להצביע, ובלי להשתמש במילה שקשורה למה שעושים איתו. מי שמחזיק בטלפון מנחש בקול. כשהוא צודק, הסתובבו וצלמו אותו מחזיק את החפץ.',
      type: 'photo',
      difficulty: 6,
      estimatedMinutes: 8,
      pointValue: 150,
      smart: upload({ captureKind: 'video', videoMaxSeconds: 60 }),
      hint: 'רמז: התחילו מצורה, גודל וחומר, ורק אחר כך מאיפה הוא נמצא בחדר. תיאור של השימוש אסור וממילא מסגיר מיד.',
      hintPenalty: 20,
    }),
  },
];
