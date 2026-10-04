# Simplifying step 3 of the mission editor (the "+" groups): research and plan (2026-10-02)

Asked by Ahiya on 2026-10-02: the creator interface is still cumbersome, worst of all the "+" chips on
the third step of making a mission ("ביצוע ותוספות"). They are full of text and open into something huge.
Point-in-time document; the executable part is the OpenSpec change it proposes.

## 1. Where we are (measured in the real builder, 1280x800, demo mission "כולם באוויר")

The step body is 555px tall. At rest it holds the mission's own controls plus three chips:
`+ הוספת רמז`, `+ ניקוד ותזמון  2 מוגדר`, `+ פתיחה ומגבלות  4 מוגדר`.

| Chip | Opens to | Controls | Words of copy | What is inside |
|---|---|---|---|---|
| הוספת רמז | 281px | 4 | 18 | hint text, cost, free after N minutes, free after N wrong answers |
| ניקוד ותזמון | **810px** (146% of the panel) | 8 | 91 | difficulty, points, total time (walk+task) with a suggestion and a help line, time at the stop with a suggestion and a help line, expires N minutes after start, opens at / closes at (two date pickers), time limit per team, pause the clock |
| פתיחה ומגבלות | 474px | 4 + tag chips | 89 | how many devices must do their part (a 46-word paragraph), unlocks only after..., max teams at once, tags with 12 suggested tags |

Opening all three takes the step from 555px to 1,833px: 3.3 screens of scrolling inside a side panel.

Code: `apps/creator-web/src/components/TaskWizard.tsx` (2,307 lines), groups registered in
`lib/taskOptInGroups.ts` (`OPT_IN_GROUP_KEYS = ['hint', 'timerPoints', 'rules']`).

## 2. What is actually wrong (findings)

1. **Each chip is a junk drawer, not a topic.** "פתיחה ומגבלות" holds four unrelated ideas (team
   cooperation, prerequisites, station capacity, library tags). A creator who wants ONE of them must
   open all of them, read 89 words, and close the rest. Same for "ניקוד ותזמון": 2 scoring fields and
   6 time fields.

2. **Six different time concepts in one block.** Total time (walk+task), time at the stop, expires N
   minutes after start, opens at, closes at, time limit per team, plus "pause the clock". Two of them
   ("זמן כולל" and "זמן במשימה עצמה") differ only by whether the walk counts, and both are derived
   automatically already. A creator cannot tell which one makes a mission "last 5 minutes".

3. **Half the scoring fields do nothing in this game.** The scoring preset decides what counts
   (`packages/shared/src/scoringPresets.ts`):

   | Field | `fixed_points_speed` (the default) | `smart_weighted` | `time_only` |
   |---|---|---|---|
   | נקודות (pointValue) | counts | ignored | ignored |
   | רמת קושי (difficulty) | ignored | counts (100 × difficulty/10) | ignored |
   | זמן כולל (estimatedMinutes) | ignored by scoring | counts | ignored |
   | זמן במשימה עצמה (expectedDurationMinutes) | speed bonus | ignored | ignored |

   The editor shows all four on every game. In a default game, difficulty is a dead control that looks
   live; in a speed race, every one of them is.

4. **Help text is inline paragraphs, not on demand.** 180 of the ~200 words across the groups are
   explanation, always visible. The requiredContributors paragraph alone explains server behaviour
   ("השרת מקטין את המספר...") to a creator who just wants "everyone must take part".

5. **The badge says "4 מוגדר" without saying what.** On the demo mission it counts 4 TAGS, and reads as
   "4 settings you configured". The chip hides the one thing a folded group should show: its value.

6. **Most of these settings are almost never used.** Proxy: the 107 missions of our own mission bank
   (`taskBank.ts`, authored by us with every feature available). 0 use free-hint thresholds, required
   contributors, prerequisites, require-presence, expiry, open/close window or time limit; 3 use
   pause-the-clock. Used: hint (~33%), points/difficulty/estimate, tags, capacity. Nine of the ~18
   controls are used by zero missions, yet they cost the same space as the ones that are.

7. **Tags are library metadata, not mission behaviour.** They change nothing in a run; they help the
   gallery. They sit in the middle of "limits", with 12 suggested tags (locally the emulator showed
   test junk: `facetprobe`, `t0` to `t14`).

## 3. What others do (research)

- **Goosechase** (the closest product: missions + points + live game). The mission's main view is just
  name, points, description and the type's own fields. Timing is ONE question per direction, asked with
  a dropdown: **Release** = immediately / at a time / when another mission is completed / when a team
  reaches N points; **Expire** = never / relative ("30 min after start") / specific time. Once set, the
  mission shows a plain sentence under it: "Releases when [mission] is completed."
  ([creating missions](https://support.goosechase.com/en/articles/4437526-creating-your-missions),
  [unlock another](https://support.goosechase.com/en/articles/10810625-how-to-make-one-mission-unlock-another),
  [expire](https://support.goosechase.com/en/articles/6594315-how-do-i-schedule-a-mission-to-expire))
- **Kahoot** (per-question settings, used by teachers in a hurry). Points are a 3-way choice, not a
  number: Standard / Double / No points. Time limit is one dropdown of presets.
  ([question types](https://support.kahoot.com/hc/en-us/articles/115002308428-Kahoot-question-types))
- **Actionbound** (field game editor). Points preset to 100, so most authors never touch it; extra
  options (attempts, hints, time limit with a deduction) are opt-in per element.
  ([quiz element](https://en.actionbound.com/help/article/quiz-element))
- **Progressive disclosure guidance (NN/g, Nielsen).** At most two levels; decide the first layer by
  frequency of use so ~80% of tasks finish there; label the second layer honestly; never bury a
  daily-use control. ([UX Tigers](https://www.uxtigers.com/post/progressive-disclosure),
  [IxDF](https://ixdf.org/literature/book/the-glossary-of-human-computer-interaction/progressive-disclosure))

Three patterns repeat everywhere: **a setting is a row that shows its current value**, **timing is
phrased as a question with a few named answers**, and **rare options live in one drawer, one level down**.

## 4. Proposal: replace the three chips with value rows

The radical version (preferred, in line with "lead with the boldest defensible restructure"):

```
┌ ביצוע ─────────────────────────────────────┐
│ (the mission type's own controls, unchanged) │
├──────────────────────────────────────────────┤
│ ★ נקודות                 [ − ]  100  [ + ] │  ← only the field this game's scoring uses
│ 💡 רמז               אין                   › │
│ 🔓 מתי נפתחת         מההתחלה               › │
│ ⏱ זמן לקבוצה         בלי הגבלה             › │
│ ⋯ עוד הגדרות                                 › │
└──────────────────────────────────────────────┘
```

1. **One scoring row, chosen by the game's preset.** `fixed_points_speed`: points as a stepper in
   steps of 10 (our missions use 60 to 170 in tens, so fixed presets would lose that). `smart_weighted`: difficulty (קל/בינוני/קשה). `time_only`: no
   row at all. The editor never shows a control the game ignores. (Needs the preset passed into
   `TaskWizard`; switching preset later keeps every stored value.)
2. **Every other setting is a row that shows its value** ("רמז: אין", "נפתחת: אחרי 'כולם בתמונה'"),
   so a folded setting is never a mystery and the "4 מוגדר" badge disappears. Tapping a row opens only
   that setting, inline, under it; one open at a time.
3. **"מתי נפתחת" is one Goosechase-style question** replacing four fields: מההתחלה / אחרי משימה אחרת /
   X דקות אחרי ההתחלה / בשעה מסוימת. **"מתי נסגרת"** likewise (never / X minutes after start / at a
   time), inside "עוד הגדרות" because the bank never uses it.
4. **The two derived durations leave the first layer.** Show "≈ 3 דק׳ (כולל הליכה)" read-only in the
   mission summary; editing lives in "עוד הגדרות".
5. **"עוד הגדרות" is the single second level** (NN/g's two-level cap): capacity, everyone takes part,
   require presence, pause the clock, close time, durations, free-hint thresholds. One line each, with
   a `?` for the explanation instead of a paragraph.
6. **Tags move to the bottom of "עוד הגדרות"** as "תגיות לגלריה", with suggestions only while typing.
7. **Hint row opens to two things**: the hint text and its cost (default stays 25). The free-after
   thresholds go to "עוד הגדרות".

Rough effect on the measured mission: the first layer goes from 3 chips that open to up to 1,833px to
4 to 5 rows of ~44px that each open one control. Nothing a creator authored is lost: the rows read the
same fields, and `foldGroupAway`'s rule (hiding never writes) carries over unchanged.

### Must not break (from the current code's own rules)

- Folding/hiding writes nothing; clearing is explicit (`lib/taskOptInGroups.ts` rule 3).
- Clearing an optional field sends ABSENT, never `null` (`buildSavePayload`).
- Every new control's field stays in `BUILDER_EDITABLE_FIELDS` (`scripts/test-game-presentation.ts`).
- Quick Setup steps target groups by key (`focusGroup`), so the new rows need the same anchors.
- i18n strict, tap targets (`TAP_TARGET` 44px), no hardcoded strings.

## 5. Plan

1. OpenSpec change `mission-editor-value-rows` (proposal, design, tasks), with RED tests first for the
   pure parts: which scoring row a preset shows, the row summaries ("נפתחת: ..."), and the mapping of
   the old fields onto the "opens/closes" answers (incl. a mission that already carries both
   `expiresAfterMinutes` and `expiresAt`).
2. Implement behind the same `OPT_IN_GROUP_KEYS` contract so Quick Setup keeps working.
3. Verify in the browser at 1280 and 375, and re-measure the numbers in section 1.

Decided 2026-10-02 (Ahiya delegated the calls): points are a ±10 stepper, not presets; tags stay
editable but one level down. The executable plan is `openspec/changes/mission-editor-value-rows`.
