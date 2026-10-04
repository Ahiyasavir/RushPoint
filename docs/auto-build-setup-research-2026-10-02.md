# Auto-built games: from "Quick Setup" to a prep plan (research and proposal, 2026-10-02)

Asked by Ahiya on 2026-10-02: make the automatic game builder something anyone can use to get a
real game, easily. His two suspected break points: the mission bank is not good enough (needs a
human pass), and when a creator picks a game that needs preparation, Quick Setup is cumbersome,
unclear and full of text. He asked for a much deeper pass than a first reply: analogous products
from other fields, the interface-simplification literature, then our own interface, then a proposal.

Point-in-time document. The executable parts are the OpenSpec changes proposed in section 6.

---

## 1. What I measured in our product

### 1.1 Walkthrough at phone width (375x812, local emulator, persona: parent, birthday, kids 8 to 10, park, 15 kids, 60 min, prep level 3)

| # | Screen | What the creator does |
|---|---|---|
| 1 | Game name | type |
| 2 | Path (compose / story template / blank) | tap |
| 3-10 | 8 questions: occasion, who, where, how many, how long, difficulty, **prep 1-5**, favourite kinds | 8 taps + 8 "next" |
| 11 | Reveal: "your game is ready" | 3 stages, 6 mission **titles only** ("הסכם הצוות", "ציד הקשת", "טייק אחד", "הקרדיטים", "סיבוב סיפורים", "הדבר שלא ידענו"), one button: "לעריכת המשחק" |
| 12 | Builder | header shows `⚠ הפעל ריצה 6`. **No Quick Setup, no pill, no guidance.** |
| 13 | Readiness list | six identical rows "למשימה אין נקודה על המפה", one per mission |
| 14 | A mission | the editor opens on step 1 "איפה אפשר לבצע את המשימה?" with an empty map. The mission's own text (what it is) is on step 2 |

"הסכם הצוות" is "before you start, agree on three rules your group will keep". It needs no place.
It was turned into a go-to-a-pin mission anyway, as were all six.

### 1.2 Two defects found on the way (not opinions)

1. **Quick Setup is unreachable on a phone for a composed game.** `DashboardPage.newGame` stamps
   `JUST_CREATED_NAV_STATE` so the invitation is "deferred to the next visit"
   (`shouldAutoOpenQuickSetup`, `lib/quickSetup.ts:444`). But the Builder's persist effect writes an
   `idle` record to `localStorage` on that very first visit (observed:
   `rp-quick-setup:demo-creator:<gameId> = {"status":"idle",...}`), and `hasRecord` then suppresses the
   invitation forever. On desktop the pill is still there; on a phone the pill is not rendered
   (`{!isMobile && <QuickSetupPill …/>}`, `BuilderPage.tsx:1416`) and the `⋯` menu has no entry. The
   only remaining route is the readiness list, field by field.
2. **The three path cards and every questionnaire chip have no accessible name** (`button [ref]`
   with no label in the accessibility tree). Screen readers announce "button, button, button".

### 1.3 The composer, measured over the whole answer space

A throwaway script ran `composeGame` against `TASK_BANK` for every occasion × who × 7 area sets ×
4 group sizes × 4 durations (4,032 games per prep level):

| Prep level | Missions/game | Setup steps/game (max) | Required | Missions turned into pins | Missions with real physical prep | Authored instruction words (HE half) |
|---|---|---|---|---|---|---|
| 1 "בלי כלום" | 14.0 | 0.1 (1) | 0.0 | 0 | 0 | 2 |
| 2 "רק מיקומים" | 14.0 | **11.3** (25) | 11.1 | **11.1** | 0 | 13 |
| 3 "גם להכין מהבית" | 13.5 | **13.9** (33) | 13.6 | 8.8 | 2.4 | 81 |
| 4 "גם להגיע מראש" | 13.5 | 15.9 (37) | 15.7 | 7.0 | 4.2 | 129 |
| 5 "גם לתאם עם גורם חיצוני" | 13.4 | 16.4 (37) | 16.1 | 6.6 | 4.0 (+0.4 partner) | 140 |

Field mix at level 3, per game: `coordinates` 10.6 · `description` 1.3 · `locationClue` 0.7 ·
`media` 0.5 · `numericAnswer` 0.4 · `answers` 0.2 · the rest under 0.1.

What this says:

- **The default is already zero-prep** (`smartBuildDefaults().prepEffort = 1`), and it delivers a
  game with no setup at all. The pain is entirely in levels 2 to 5.
- **About 80% of all setup work is dropping pins, one mission at a time.** Level 2, which a creator
  reads as "just locations", costs 11 mandatory steps and up to 25.
- **The pins are mostly invented.** Every converted mission is a bank entry tagged `fromAnywhere`
  (85 of the bank's 107). `siteableInPlacedGame` decides which ones get a pin; it lets through
  missions whose substance is a conversation, a story round or a group agreement.
- **Real physical prep is small.** At level 3 only 2.4 missions per game ask the creator to prepare
  an object, hide something or go count something. That is the work that deserves a guide, and it
  is buried under ten pins.

### 1.4 The setup instructions are aimed at fields, but they describe actions

The bank has 35 `setup` items. 17 of them target the field `description`. Reading them:

| What the instruction actually asks for | Examples (bank prompt, abridged) | Field it points at |
|---|---|---|
| A **packing list** item | "שלוש כוסות אטומות וחפץ קטן לכל קבוצה", "דף נייר לכל קבוצה", "קופסה עם שמפו" | description |
| An **on-site measurement** | "תלכו מנקודת ההתחלה ותספרו צעדים", "תבדקו את המילה בשטח, שלטים מתחלפים", "תבררו את הגובה" | numericAnswer / answers |
| A **hiding** job | "תחביאו מפתח אמיתי", "תכתבו קוד במקום קבוע (מדבקה, גיר)" | coordinates + locationClue |
| A **partner** to arrange | "תתאמו עם בעל הדוכן שיחלק את הקוד" | description |
| A **personal touch** | "שורת האימוג׳ים שמרמזת על המקום", "ערך ארגוני" | description / steps |

Quick Setup renders each of these as: open the Builder, open the mission editor, switch tab, focus
the `description` textarea, show the product headline for that field ("תארו במשפט או שניים מה
השחקנים צריכים לעשות כאן") and, under it, the bank's note ("תסגרו מראש עם מישהו שיעמוד בנקודה").
The headline and the note contradict each other on every one of these 17 steps. That is the
contradiction class `quick-setup-audit-playbook.md` §5 describes, except that here it is
structural, not a one-off authoring mistake: **a field is the wrong unit for a real-world job.**

### 1.5 The stack of guided layers

Questionnaire (10 screens) → reveal → Builder → Quick Setup (deferred, and in practice lost) →
readiness list → per-mission editor. An earlier change already recognised that "the creator
answered a questionnaire, sat through the reveal, and was then handed a SECOND guided flow"
(comment in `DashboardPage.newGame`) and fixed it by **hiding** the second flow. The flows were
never merged, so the creator now gets the third layer (readiness rows) with no guide at all.

### 1.6 The bank has no feedback loop

A composed `Task` carries no reference to the bank entry it came from (no `bankKey` on the type;
`usedBankKeys` lives only in `localStorage` recency). So there is no way to ask "which bank
missions get skipped, run long, or score badly in the post-run survey". Point 1 of the request
("someone needs to sit on the bank") is currently a judgement call with no data behind it.

---

## 2. What others do (research)

### 2.1 The closest analogues are not apps, they are boxes

**Printable treasure hunt kits** (Printable Adventure Games, Lock Paper Escape and many Etsy kits)
are exactly our level-3 case, and they solved it with paper:

- The clues are fixed; the **hiding places are generic kinds** that exist in most homes or parks.
  Lock Paper Escape ships "generic clue locations suitable for most homes" with an indoor and an
  outdoor set, and says outright that you can drop any clue whose place you do not have.
- The parent gets an **organizer guide plus a clue table**: cut, hide at the place the table names,
  and an extra column to write where you actually put it. Advertised prep time: 20 minutes.
- One tip that keeps coming up: "lay clues out in order first and lightly write the hiding spot on
  the back of each card".

**Escape-room-in-a-box kits** do the same with a photo-illustrated setup guide: 5 to 15 minutes for
printable kits, 25 to 30 for physical ones. **Murder-mystery party kits** add the dimension we lack
entirely: a **timeline** (three weeks out, one week, the day before, the day of), one host guide,
and every printed piece bundled.

Lesson: the host's work is organised by **when and where they will do it**, never by puzzle. And
the kit asks the host to *match* a generic spot ("a bench", "under a pillow"), not to *invent* one.

### 2.2 Recipe kits

HelloFresh cards put a **pictorial ingredients checklist** on the front, so you can match the bag
to the card before starting, and keep the method to about six numbered photo steps. Lesson:
aggregate "what you need" up front, across the whole thing, as a checklist.

### 2.3 Products that build something for you

- **Goosechase**: a bank of ready missions plus 400+ templates ("Blueprints"), an AI mission
  generator, and a promise of a first experience in under 10 minutes. Its missions are mostly
  location-free (photo, video, text, GPS), which is why setup barely exists.
- **Kahoot AI generator**: type a topic, get candidate questions, **pick the ones you want**, edit.
- **Squarespace Blueprint**: a short guided questionnaire, then **three finished options to choose
  from**, then the full editor. Reviewers found it faster than Wix's chat flow because you pick from
  what is on screen instead of typing.
- **Canva Magic Design**: three to eight generated layouts; pick the closest, replace placeholders.

Lesson: show the creator **outcomes to recognise**, not settings to recall. Picking is cheaper than
configuring.

### 2.4 Setup flows that are known to work

- **Shopify** (Candu teardown): the signup survey personalises a **checklist**; each item has **one
  primary CTA**; items **tick themselves when the product event happens** (not by hand); the list
  **auto-opens the next item**; and it lives on the home page, not behind a menu.
- **TurboTax**: asks life questions ("did you buy or sell a home?") and works out the forms itself;
  a novice never sees a form until the end; experts can jump to the forms.
- **Airbnb host onboarding**: one question per full screen; the hard step (pricing) is helped with
  context (comparable listings, earnings).
- **Geocaching** hiders take the coordinates **at the spot**, ideally averaging several readings.
  **Actionbound** does it with a "find spot" control on the element.
- **Super Mario Maker** will not publish a level until its creator has beaten it themselves (the
  "clear check").

### 2.5 The literature

- **NN/g, wizards**: right for infrequent, novice tasks. Make every step **self-sufficient** (the
  user should never need information from another part of the app), use **descriptive button
  labels** instead of Next, save state so the user can leave and return, keep help beside the field
  without covering it. Costs: many clicks, poor recovery after an interruption, less control.
- **NN/g, progressive disclosure**: show the few things most people need; get the split right; give
  the path to the rest a strong "information scent". Staged disclosure (a wizard) is for steps
  everyone goes through.
- **LogRocket on setup wizards**: a wizard only fits when the steps must happen in order and each
  depends on the previous one. Otherwise a non-blocking alternative (a checklist, tips) fits better.
- **Krug, *Don't Make Me Think***: "get rid of half the words on each page, then get rid of half of
  what's left"; happy talk and instructions must die, because nobody reads them until muddling
  through has failed.
- **Wroblewski's Mad Libs forms**: on Vast.com, a sentence-shaped form raised conversion by 25 to 40%.
- **Endowed progress** (Nunes and Drèze, 2006): a 10-stamp card with 2 stamps given redeemed at
  34% against 19% for a blank 8-stamp card, the same remaining effort. The effect disappears when
  the head start has no reason given.

---

## 3. Diagnosis in one paragraph

We built the game for the creator, then handed them **our data model** to finish it. Quick Setup
walks fields, the bank's instructions point at fields, and readiness lists fields. The creator's
real job is not field-shaped: it is "pick a few spots, pack a bag, set up something on site, decide
two things". Analogous products that work organise that job by **when and where** it happens,
**aggregate** it (one map, one packing list), ask the host to **match generic spots** rather than
invent them, and **pre-fill everything that can be pre-filled** so the remaining list is short and
already partly done. Ours does the opposite on all four, and adds ~10 invented pins on top.

---

## 4. Proposal

### 4.0 The idea

**An auto-built game ends in a Prep Plan, not in the Builder.** The Prep Plan is one page per game,
like a kit's host guide, and it replaces the reveal, the deferred Quick Setup and the readiness rows
for a composed game. The Builder stays exactly as it is, for anyone who wants to go deeper. Templates
(the guided path) can move onto the same page later, because every template `wizardStep` maps onto
one of the action kinds below.

### 4.1 Ask fewer pins of the creator (the biggest single lever)

Today level 2 converts ~11 missions into pins. Instead:

- **A bank mission declares whether a place helps it**: `siting: 'never' | 'optional' | 'needs'`
  plus, when it helps, a **generic spot kind** (`spot: 'bench' | 'bigTree' | 'sign' | 'openGrass' |
  'entrance' | 'anyCorner'`). Conversations, agreements, story rounds and most photo missions are
  `never`. That is the kit lesson: the creator matches "a bench", they do not invent a reason.
- **Pins go to stations, not missions.** A placed game gets 3 to 5 stations (one per stage, or one
  per mission that needs a spot); `fromAnywhere` missions inside a stage play wherever the team
  stands. Expected effect, measured the same way as 1.3: from ~11 pins to ~4.
- **The prep question shows its cost.** The questionnaire already has a live shape panel; give the
  prep answer a live line such as "תצטרכו לסמן 4 נקודות על מפה (בערך 5 דקות)" or "+ להכין 12 כוסות
  ולהחביא מפתח (בערך 20 דקות)". TurboTax's life question, with Airbnb's context next to the hard
  choice. The 1 to 5 numbers stop being abstract because each one shows what it costs.

### 4.2 The Prep Plan page

One scrolling page, phone-first, organised by **where you will be when you do it**. Each section
appears only if it has something in it.

```
┌──────────────────────────────────────────────┐
│  יום הולדת בפארק · מוכן ב־4 מתוך 7            │   ← endowed progress, with the reason:
│  ▓▓▓▓▓▓▓░░░  בערך 15 דקות הכנה נשארו          │     "את הקודים והאישורים כבר בחרנו בשבילכם"
│  [ לשחק ניסיון ]   [ להדפיס דף מארח ]          │
├──────────────────────────────────────────────┤
│ 🗺️  מהבית, על המפה · 5 דק׳                     │
│   חפשו איפה מתחילים → 4 נקודות מוצעות סביבה   │   ← ONE map, all stations, drag to fix
│   ① ספסל · "ציד הקשת"   ② עץ גדול · …         │     every pin says what spot kind it wants
├──────────────────────────────────────────────┤
│ 🛒  מה להביא · 2 פריטים                        │   ← aggregated across missions, × teams
│   ☐ 12 כוסות אטומות (3 לכל קבוצה × 4)         │
│   ☐ מפתח אחד ומנעול                           │
├──────────────────────────────────────────────┤
│ ✏️  החלטות קטנות · 1                           │   ← smart defaults, already filled in
│   הקוד הסודי: 4821  [שינוי]                   │
│   שורת האימוג׳ים: 🌳🦆🛝  (דוגמה, אפשר לשנות)   │
├──────────────────────────────────────────────┤
│ 🚶  בשטח, לפני שמתחילים · 2                    │
│   ☐ להחביא את המפתח ליד נקודה ③                │
│   ☐ לספור צעדים מהשער לנקודה ② → [__]          │
│   [ מצב סיבוב בשטח ]                          │   ← walk mode, 4.4
└──────────────────────────────────────────────┘
```

Rules taken from the research:

- **Every item is self-sufficient** (NN/g): the input lives inside the item. No trip into the
  mission editor for anything on this page; "open in the Builder" is a secondary link.
- **Items tick themselves** from the game's data (Shopify), exactly like readiness does today, so a
  creator who fixes something in the Builder sees it done here too. This reuses
  `isWizardStepConfigured` / readiness; it does not invent a second source of truth.
- **One primary action per item**, and the plan scrolls to the next open item when one closes.
- **Pre-fill everything that can be**: generate secret codes, default approval to automatic, seed
  personal-touch fields with an example the creator can keep. A pre-filled item still shows, as
  done, so the head start is visible and has a reason (endowed progress needs the reason).
- **Words**: one line per item, in the creator's language only. The bank's long prompts become the
  item's "?" detail, not its body (Krug).
- **Printable host sheet**: the same plan as a one-page PDF with the kit's clue table (station → spot
  → what goes there → written-down actual place). Organisers of 10+ team events already work on paper.
- **Entry points**: the dashboard card ("2 דברים לפני ההשקה" opens the plan), the launch refusal (one
  row, "פתחו את תוכנית ההכנה", instead of six identical rows), and the end of the questionnaire, whose
  reveal screen becomes the top of the plan rather than a separate modal.

### 4.3 Setup becomes typed actions in the bank

Replace `setup: [{ field, prompt, required }]` with a small closed set of action kinds, each with
its own widget and its own section of the plan:

| Kind | Section | Widget | Replaces today |
|---|---|---|---|
| `spot` (kind of spot) | map | pin on the shared map | `coordinates` steps |
| `bring` (item, perTeam, optional alternative) | packing list | checkbox, total computed × teams | prose in `description` |
| `decide` (field, generator or example) | decisions | inline value, pre-filled | `secretCode`, `answers`, `steps`, emoji line |
| `onSite` (measure / check / hide, target field) | on site | inline number or text, or walk mode | `numericAnswer`, `answers`, `locationClue` |
| `partner` (who, what to agree) | on site (with "before the day") | checkbox + note | prose in `description` |

The player-facing `description` then never needs creator edits for setup reasons: where a mission
refers to the creator's choice, it uses a slot (`{item}`, `{passphrase}`) filled from the `decide`
answer, which is the Canva placeholder and Mad Libs lesson applied to our data. This also removes
the headline-vs-note contradiction by construction, because there is no generic field headline any
more: the action kind is the headline.

Migration cost is bounded: 35 setup items across ~30 bank entries.

### 4.4 Walk mode (set up the game by walking it)

The on-site section opens on the phone as a stop-by-stop walk: "go to station 2 (a bench near the
gate)"; at the spot, "I'm here" sets the pin from GPS (reusing the accuracy guard
`evaluateArrivalFix`, and averaging a few fixes like geocachers do); then the stop's on-site jobs
(count, hide, photograph the hiding spot for the clue). Walking the route is also a natural **test
run**, Mario Maker's clear check: a game whose route the creator has walked is known to be playable.
This one is optional and comes last.

### 4.5 Point 1, the bank

The research does not replace the human pass Ahiya expects; it makes it shorter and makes it stick:

- **Stamp `bankKey` on every composed task** (one optional field, set in `composeGame`). Without
  it there is no learning loop.
- **A bank health view** (admin): per bank mission, from real runs, the skip rate, the time taken
  against the estimate, the photo rejection rate, and the post-run survey score. The human pass then
  starts with the worst ten, not with all 107.
- **One structured review session** with four yes/no questions per mission (fun? understood in one
  read? works with no explanation from an adult? would I film it?), then cut or rewrite the bottom
  third. A smaller bank of better missions improves every composed game at once.
- **The new fields from 4.1 and 4.3** (`siting`, `spot`, typed setup) are part of that same pass, so
  the bank is touched once, not twice.

---

## 5. Quick wins that do not wait for the rest

1. **Fix the lost Quick Setup** (1.2.1): do not persist a record on the just-created visit, and give
   the phone an entry point (a `⋯` menu item, or the readiness header). Small, test-first in
   `scripts/test-quick-setup-flow.ts`.
2. **Group identical readiness rows**: "6 משימות בלי נקודה על המפה" as one row that opens the first.
3. **Reveal screen**: under each mission title, one line of what it is; above the button, the
   honest cost ("לפני ההשקה: לסמן 6 נקודות"). Today it says "המשחק שלכם מוכן" and then six things
   block the launch.
4. **Stop siting obvious non-place missions** with a short explicit list until `siting` exists.
5. **Accessible names** on the path cards and questionnaire chips.

---

## 6. Plan (OpenSpec changes, in order)

| # | Change | Size | What it buys |
|---|---|---|---|
| 1 | `quick-setup-reachable` | S | fixes 1.2.1 + quick wins 2, 5 |
| 2 | `composer-siting-by-station` | M | `siting`/`spot` on bank entries, stations not missions, live prep cost in the questionnaire. ~11 pins → ~4 (to be re-measured with the 1.3 script) |
| 3 | `prep-plan-page` | L | the page in 4.2, driven at first by the EXISTING `wizardSteps` via an adapter (field → section), so it ships before the bank migration; reveal and readiness fold into it |
| 4 | `bank-prep-actions` | M | typed setup kinds + slots in descriptions, migrate the 35 items; packing list totals × teams |
| 5 | `bank-provenance-health` | M | `bankKey` on tasks, admin health view; feeds the human review |
| 6 | `walk-mode-setup` | L | 4.4 |

Success measure, same persona as 1.1 (park birthday, level 3), taken before and after each change:
taps and screens from "הרכיבו לי משחק" to launch-ready, mandatory steps, and words read. Today:
~14 mandatory steps, each a trip through the mission editor. Target after 2 + 3: one map screen
plus at most five checklist items, under ten minutes, with nothing requiring the Builder.

## 7. Risks and honest pushback

- **Two editing surfaces.** The plan must only edit setup slots and never grow into a second Builder.
  Every item links to the Builder for anything beyond its one input.
- **Auto-proposed spots are guesses.** We do not know where the benches are. First version: a ring of
  stations around the start point at walking distance, the creator drags them. Using OpenStreetMap
  features (benches, playgrounds, trees) is a later possibility, not a dependency.
- **Quick Setup was a large investment.** It is not wasted: its derived-state rules ("remaining is
  always derived"), the deferral list and the focus table survive inside the plan's items. What goes
  away is the field-by-field tour.
- **Fewer pins changes how composed games play.** A station holding several missions moves more teams
  through one spot; capacity and routing already handle this (`capacity`, preset-aware routing) and
  the load sim covers it, but it must be re-run.

## Sources

- NN/g, [Wizards: Definition and Design Recommendations](https://www.nngroup.com/articles/wizards/)
- NN/g, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- LogRocket, [Creating a setup wizard (and when you shouldn't)](https://blog.logrocket.com/ux-design/creating-setup-wizard-when-you-shouldnt/)
- Candu, [Shopify's personalized onboarding](https://www.candu.ai/blog/shopify-onboarding-flow)
- Appcues, [How TurboTax turns a dreadful user experience into a delightful one](https://www.appcues.com/blog/how-turbotax-makes-a-dreadful-user-experience-a-delightful-one); UXmatters, [Designing Solutions for Unpleasant Tasks](https://www.uxmatters.com/mt/archives/2014/05/designing-solutions-for-unpleasant-tasks.php)
- Nicely Done, [Airbnb host onboarding flow](https://nicelydone.club/examples/flows/70669351-9375-4423-8ef1-0375362bc2e0)
- Goosechase, [How to organize an experience](https://goosechase.com/how-it-works/create-experience), [Experience Blueprints](https://blog.goosechase.com/goosechase-experience-blueprints-interactive-templates/)
- Kahoot, [How to generate a kahoot with AI](https://support.kahoot.com/hc/en-us/articles/40803785990675-How-to-generate-a-kahoot-with-AI)
- Feisworld, [Squarespace Blueprint AI review](https://www.feisworld.com/blog/squarespace-blueprint-ai-builder-review)
- Canva, [Use Magic Design to generate design templates](https://www.canva.com/help/use-magic-design/)
- Printable Adventure Games, [Printable treasure hunt for kids](https://www.printableadventuregames.com/printable-treasure-hunt-for-kids/)
- Lock Paper Escape, [Birthday treasure hunt](https://lockpaperescape.com/rainbow-birthday-treaure-hunt/)
- Escape Room Geeks, [Printable escape room kits](https://escaperoomgeeks.com/); What's Good To Do, [Escape Room in a Box review](https://whatsgoodtodo.com/escape-room-in-a-box-3-game-bundle-review/)
- Riddlelicious, [Murder mystery party planning guide](https://riddlelicious.com/murder-mystery-party/); Partykook, [How to host a murder mystery party](https://partykook.com/how-to-host-a-murder-mystery-party/)
- Food Box HQ, [HelloFresh recipes](https://foodboxhq.com/blog/hellofresh-recipes/)
- Geocaching, [How to hide a geocache](https://www.geocaching.com/blog/2019/09/how-to-hide-a-geocache/); Actionbound, [First steps](https://en.actionbound.com/first-steps)
- Pinnguaq, [Mario Maker level design basics](https://pinnguaq.com/learn/mario-maker-level-design-basics/)
- Theo Mandel, ["Mad Libs" style form increases conversion 25-40%](https://theomandel.com/2010/02/mad-libs-style-form-increases-conversion-25-40/)
- Derek Sivers' notes on [Don't Make Me Think](https://sive.rs/book/DontMakeMeThink)
- Wikipedia, [Goal pursuit (endowed progress)](https://en.wikipedia.org/wiki/Goal_pursuit); Learning Loop, [Endowed progress effect](https://learningloop.io/plays/psychology/endowed-progress-effect)
