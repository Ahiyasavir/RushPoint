## Context

The homepage today opens with `המירוץ החי שהקבוצה שלכם תזכור` over a subhead that lists the
mechanism (`אתם בונים את התחנות, הטלפון מנווט והניקוד מסתדר לבד`). It describes correctly and
pictures nothing, which is the state a cold visitor meets.

Behind that sits a positioning problem the owner has been unable to resolve by wording. Every
candidate one liner failed against a real use case: `field race` excludes the living room, `build`
excludes the ready made template, `game` excludes a quiz or a chore list, `for groups` excludes solo
play, `runs itself` overclaims against the live run console that exists precisely so a person CAN
intervene. The conclusion reached with the owner is that no single sentence can be both specific
enough to picture and true of every supported use, and that the homepage should therefore lead with
an anchor plus a self selection layer rather than with a compression.

Constraints already in force on this surface:

- `apps/marketing` is a vendored AstroWind template. Section widgets live in
  `src/components/widgets/`, page composition in `src/pages/[lang]/index.astro`.
- The site has NO `t.*` dictionary. The language of a page IS its content file, so prose in a
  component is invisible to the language gate. `scripts/test-marketing-home-cro.ts` enforces this by
  scanning a declared `COMPONENTS` map for prose.
- No dash of any kind may appear in user facing copy. `scripts/test-no-dashes.ts` PART E scans the
  marketing content files, so new strings are covered automatically.
- Optional sections are the established pattern: `tryMission`, `missionIdeas` and `gamePlanner` are
  each `.optional()` in `content.config.ts` and each guarded by `t.x && (...)` in the page, so a
  content file without the key renders exactly as before.
- The marketing site auto deploys from GitHub Actions on any push to `topographic-maps` touching
  `apps/marketing/**`, building from a clean CI checkout.

## Goals / Non-Goals

**Goals:**

- Replace the hero headline and subhead with a per language anchor that produces a mental picture in
  one line, and a subhead that promises the removal of difficulty without naming a feature.
- Add a four door occasion strip immediately under the hero that is strictly additive: it costs a
  visitor who ignores it exactly nothing.
- Keep every new string in the per language content files so the existing gates keep their teeth.
- Keep the change cheap to revert, because the premise (that self selection helps more than the
  extra click costs) is a hypothesis to be measured, not a fact.

**Non-Goals:**

- Rewriting the landing page set. Only the two entries that now contradict the product are
  corrected.
- Moving the landing pages from the player origin to the marketing origin.
- Any analytics events pipeline.
- Any backend, shared type, callable, rule or index change. This change touches `apps/marketing` and
  `scripts/test-marketing-home-cro.ts` and nothing else.

## Decisions

### The anchor is chosen per language, not translated

Hebrew anchors to `מירוץ למיליון`, English to `Amazing Race`. These are not translations of each
other and must not be made into translations. The Hebrew reference is meaningless outside Israel and
the English one is the globally legible equivalent of the same format.

This is a deliberate departure from how the two content files usually relate. It is safe because the
gates check key set parity and per language purity, never semantic equivalence: `home.he.json` must
be Hebrew and `home.en.json` must be English, which both anchors satisfy.

*Alternative considered:* a single invented category name used in both languages. Rejected because
inventing a category means teaching it, which is the explaining the anchor exists to avoid.

*Trademark posture:* the reference is descriptive and generic, with no logo, no styling and no claim
of affiliation. This is the same posture already taken by the owner's `מירוץ למיליון` side offering.

### The subhead names no feature

`בלי כל הבלגן שזה בדרך כלל דורש` / `Without all the hassle it usually takes`.

Every feature specific candidate was rejected during design for being false somewhere:
`ניקוד אוטומטי` is false for a use that does not score, `בלי צוות הפקה` is meaningless at home, and
`רץ לבד` contradicts the run console. A general statement about removed difficulty is true of all of
them and still answers the question the anchor raises, which is `how would I possibly run that`.

Hence the spec forbids a subhead that claims automatic scoring, absence of staff, or self running
operation. This constraint is worth keeping after this change: it is the trap this hero fell into
twice.

### Every card is a link to a real page, and the two missing pages get authored

Each of the four cards is an `<a>` to an occasion landing page. Nothing is revealed in place and no
JavaScript is involved, so the component is four links and a heading.

The first draft of this design had the cards revealing a panel instead, because only two of the four
occasions had a landing page and mixing `navigates` with `scrolls` across one row of equal looking
cards reads as brokenness. The owner's decision reversed the constraint rather than accepting it:
the doors must be linkable from outside and findable in search, which a panel cannot be. So the
missing pages are authored here, and all four cards behave identically.

`scripts/lib/landingPages.ts` makes this cheap. Everything positional in that registry is DERIVED,
not authored: the hreflang cluster comes from swapping the language prefix, the canonical and the
sitemap entry come from the slug, and `scripts/test-landing-pages.ts` asserts every subject exists
in every language with a unique title and description. Adding a subject therefore means writing copy
and a slug; the entire SEO apparatus follows, and the existing test covers the new pages the moment
they exist.

New subjects and their slugs, Latin in both languages as the registry requires:

| Subject | Slug | Door |
| --- | --- | --- |
| `home-activities` | `pe-ilut-babayit` | פעילויות בבית |
| `education` | `chinuch` | חינוך |

The other two doors point at existing subjects: `birthday` (`yom-huledet`) and `team-building`
(`gibush-tzevet`).

*Trade off accepted:* the destination is the PLAYER origin, because that is where the generator
serves landing pages today. A visitor therefore crosses from the marketing site to the player host
when they pick a door. That is not ideal now that the apex is the marketing site, but it is
consistent across all four cards, and relocating indexed URLs is a redirect and sitemap change that
does not belong inside a homepage change.

*Where the slug lives:* in the content file, on each door. The slug is a URL fragment rather than
prose, which the no dash standard explicitly exempts, and putting it in content keeps the component
free of both prose and a hardcoded mapping. Both languages of a door carry the same slug, matching
how the registry already treats slugs as identifying the subject rather than the page.

### The landing copy that now contradicts the product is corrected

Two entries in the registry actively argue against the positioning the homepage is adopting:

- `home` (the general page) is headlined `המשחק יוצא החוצה` and described as a `משחק שדה בשטח`. This
  is the retired outdoor only framing, on the one page in the set whose whole job is to be general.
- `birthday` is headlined `יום הולדת שיוצא מהסלון`. The living room birthday is one of the four new
  doors, so this page currently excludes a visitor the strip just invited.

Both are corrected in both languages. The remaining subjects keep their copy: a wedding, a mitzvah,
a team building day and a youth movement activity are fairly described as taking place outdoors, so
their framing is a description rather than an accidental narrowing.

### The mission ideas generator gains an indoor place

`missionIdeas` offers `city`, `park`, `campus` and `hood`, and every idea in its bank assumes
streets, shop windows or strangers. With an activities at home door on the page, that gap becomes
visible: it would be the one door whose subject the site cannot then say anything about.

A `home` place is added to both language content files along with indoor ideas tagged to it. The
ideas must hold to the same rule the mission bank already uses for indoor content: no strangers, no
shops, no street, and no ingredient a flat cannot be assumed to have.

### Each door carries a structural catch all

Every examples line ends in a clause that admits what the list does not name (`וכל חגיגה שרוצים
שיזכרו`, `and any group that wants to know itself better`). This is what lets four doors stand in
for an open set without a visitor reading themselves as excluded, and it is the owner's explicit
requirement.

To make it testable rather than aspirational, the catch all is a declared marker: the Hebrew line
must contain `וכל` and the English line must contain `and any`. A door added later without a catch
all fails the gate.

### Files

| File | Change |
| --- | --- |
| `apps/marketing/src/data/pages/home.he.json` | `headline`, `subhead` replaced; `occasionDoors` added; `missionIdeas` gains a home place and indoor ideas |
| `apps/marketing/src/data/pages/home.en.json` | same, with the English anchor |
| `apps/marketing/src/content.config.ts` | `occasionDoors` added to `homePages`, `.optional()` |
| `apps/marketing/src/components/widgets/OccasionDoors.astro` | new, four links |
| `apps/marketing/src/pages/[lang]/index.astro` | renders `t.occasionDoors && <OccasionDoors .../>` between `<HeroField/>` and the `tryMission` block, resolving each href with `landingPageUrl(language, door.slug)` |
| `scripts/lib/landingPages.ts` | two new subjects with slugs and full copy in both languages; corrective copy edits to `home` and `birthday` |
| `scripts/test-marketing-home-cro.ts` | `doors` added to `COMPONENTS`; new PART for the anchor and the strip |
| `scripts/test-landing-pages.ts` | no edit expected; it derives over `LANDING_SUBJECTS` and so covers the new pages automatically. Confirm its page count rises from 12 to 16 |

`HeroField.astro` and `HeroMissionTaste.astro` are NOT modified. The hero keeps its `taste` prop and
its two column structure; only the strings it is handed change.

## Test strategy

There is no component test runner for this site, so proving this change means a source and content
gate plus a preview pass. Written RED first, in this order.

**1. `scripts/test-marketing-home-cro.ts`, extended (the `npm test` lane).** New assertions, each
failing before implementation:

- *Anchor, per language.* `home.he.json.headline` contains `מירוץ למיליון`;
  `home.en.json.headline` contains `Amazing Race`.
- *Subhead claims nothing.* Neither language's `subhead` matches a declared list of forbidden claim
  markers (`ניקוד אוטומטי`, `לבד`, `בלי שופטים`, `automatic`, `by itself`, `no staff`).
- *The strip exists in both languages* and holds exactly four doors.
- *Every door has a catch all*, by the declared marker above.
- *Every door has a title, an examples line, and a panel body*, all non empty.
- *Section order.* In `index.astro` the `OccasionDoors` render appears after `<HeroField` and before
  the `tryMission` block, and every section that existed before still appears in its previous
  relative order.
- *Not a gate.* The component source contains no `<dialog`, no `role="dialog"` and no
  `position: fixed`. The strip is a row of links in normal document flow.
- *Every door resolves.* Each door's `slug` in the content files is a member of `SUBJECT_SLUGS`
  from `scripts/lib/landingPages.ts`, so a card can never point at a page that is not generated.
  This is the assertion that would have caught a typo in a href, which nothing else on the page
  would notice.
- *No prose in the component.* Achieved by adding `doors` to the existing `COMPONENTS` map, which
  puts the new file under the scan that is already written.

**2. `scripts/test-no-dashes.ts`.** No edit needed: PART E already scans the marketing content
files, so the new strings are covered the moment they exist. Confirm the field count rises.

**3. `npm run i18n:check:strict`.** Must be clean with zero new PART B findings. The component holds
no prose, so this follows from the design rather than from care.

**4. Preview verification**, both languages, since no test can see layout:

- With nothing selected, scroll from the hero to the footer and confirm every pre existing section
  is present and reachable, and that nothing overlays them.
- Select each of the four doors and confirm the panel swaps in place with no navigation.
- Keyboard only: tab into the group, move with arrow keys, confirm the panel follows focus and the
  focus ring is visible.
- Hebrew: confirm the row and the cards mirror correctly and that no physical direction utility is
  used.
- `prefers-reduced-motion: reduce`: confirm nothing added here animates.

**5. Gate run.** `npm run verify` in full, per the project's rule that all nine gates are green
before done.

## Risks / Trade-offs

- **The extra click costs more than the self selection gains.** → The strip is additive and reverts
  in one commit. This is the hypothesis the design is built to let the owner measure rather than
  argue about, which is why no other page structure changes alongside it.
- **The homepage now asks about the visitor's occasion three times.** `tryMission` closes with
  `בשביל מה אתם בונים משחק?` and `missionIdeas` opens with `מה האירוע?`. Three occasion questions on
  one page is repetitive and slightly comic. → The strip uses a different vocabulary (venue and
  audience rather than event type) and sits above the fold where the others are deep in the page. If
  the preview pass still reads repetitive, the `tryMission` closing question is the one to drop, as
  a follow up rather than inside this change.
- **The strip sends a visitor to a different host.** Picking a door crosses from the marketing site
  to the player origin, where the landing pages are generated. → Accepted for now, and consistent
  across all four cards rather than true of half of them. The real fix is relocating the landing
  pages to the marketing origin, which is its own change.
- **Two brand new pages enter the index with no traffic history**, next to five that have some. →
  They are derived by the same generator, so they carry the same canonical, hreflang, sitemap and
  structured data as the rest by construction. Nothing about them is hand assembled.
- **The anchor ages.** A television format reference is only as legible as the format's memory. →
  Cheap to change: it is two strings in two content files.
- **The anchor narrows perception toward competitive team play**, which is exactly the kind of
  narrowing the owner objected to in earlier candidates. → Accepted deliberately, and this is the
  central trade of the change: the anchor buys instant comprehension at the price of first
  impression breadth, and the strip immediately below is what buys the breadth back. Neither half
  works alone, which is why they ship together.

## Migration Plan

No data, no schema, no backend. Deployment is a push to `topographic-maps` touching
`apps/marketing/**`, which the existing GitHub Actions workflow builds and deploys from a clean
checkout. Rollback is a revert of the same commit.

## Open Questions

- Should the two doors that lack a landing page (`activities at home`, `education`) get one? That is
  the natural follow up if the strip shows those doors are being chosen.
- Does the `tryMission` closing occasion question survive, given the strip now asks the same thing
  earlier and better? **Verdict after the preview pass: it survives, but it is now the weakest of
  the three.** Measured positions on the rendered Hebrew page: the strip sits at 826px, the playable
  mission at 1206px, the ideas generator at 3799px, so the three asks are far apart rather than
  stacked, and only two of them are phrased as questions (the strip is an instruction,
  `בחרו מאיפה להתחיל`). The strip also captures intent earlier and for a visitor who has read
  nothing, which is strictly better than asking at the end of a demo. Recommendation, for a separate
  change: drop the `tryMission` closing question and keep the ideas generator's, which at least
  feeds a real filter. Not acted on here.
