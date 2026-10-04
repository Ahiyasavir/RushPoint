## Why

Ahiya, 2026-10-02: the creator interface is still cumbersome, worst of all the "+" chips on step 3 of
making a mission. They are full of text and open into something huge and exaggerated. He asked for the
most professional result there is and left the decisions to us.

Measured in the real builder (1280x800, `docs/mission-editor-step3-simplification-2026-10-02.md`):

- the step body is 555px; "ניקוד ותזמון" alone opens to **810px** (146% of the panel); all three chips
  open take the step to **1,833px**, 3.3 screens inside a side panel;
- each chip is a drawer of unrelated things ("פתיחה ומגבלות" = team cooperation, prerequisites,
  station capacity, library tags), so using one setting means opening and reading all of them;
- "ניקוד ותזמון" holds **six different time concepts** plus a pause toggle, two of which are derived
  automatically and differ only in whether the walk counts;
- **half the scoring controls do nothing** in any given game: the default preset
  (`fixed_points_speed`) ignores difficulty, `smart_weighted` ignores points, `time_only` ignores both;
- ~180 of ~200 words are always-visible explanation; the folded chip shows "4 מוגדר" (it counted 4
  tags) instead of what is set;
- of the 107 missions in our own bank, **zero** use nine of the ~18 controls.

Comparable editors converge on three patterns: a setting is a **row that shows its value**
(Goosechase: "Releases when [mission] is completed"), **timing is one question with a few named
answers** (Goosechase Release / Expire), and **rare options sit in one drawer, one level down**
(NN/g progressive disclosure, two levels at most).

## What Changes

- **Replace the three opt-in chips with value rows.** Step 3 keeps the mission type's own required
  controls first, then at most five rows, each a 44px line showing its current value:
  1. **Scoring**, chosen by the game's scoring preset: points as a stepper (±10, tap the number to type)
     for `fixed_points_speed`; difficulty (קל / בינוני / קשה) for `smart_weighted`; **no row** for
     `time_only`.
  2. **רמז**: "אין" or "יש · עולה 25 נק׳". Opens to the hint text and its cost only.
  3. **מתי נפתחת**: one question replacing four fields: מההתחלה / אחרי משימה אחרת / X דקות אחרי
     ההתחלה / בשעה מסוימת.
  4. **זמן לקבוצה**: "בלי הגבלה" or "5 דק׳". Opens to preset chips (בלי, 2, 5, 10, 15, אחר).
  5. **עוד הגדרות**: the single second level, showing by NAME what is active there ("קיבולת 3 ·
     עצירת שעון"). Inside, one line each with a `?`: מתי נסגרת, קבוצות בו זמנית, כולם עושים חלק,
     חובת נוכחות (answer missions), עצירת השעון, זמן משוער (only the field this preset reads),
     רמז חינם אחרי..., תגיות לגלריה (suggestions only while typing).
- **One row open at a time**; opening writes nothing; choosing an answer is the only write.
- **A control the game's scoring ignores is not shown**, and a Quick Setup step that targets such a
  field is dropped from that game's flow instead of landing on nothing.
- Explanatory paragraphs become `?` tooltips; the "N מוגדר" count badge is retired.
- **No data model change.** Same `Task` fields, same save path (`buildSavePayload`), same server
  validation. A stored value the new UI does not surface in the first layer is still shown in
  "עוד הגדרות", never dropped.

## Capabilities

### Modified Capabilities
- `creator-task-editor-progressive-disclosure`: step 3's optional settings become value rows; the
  stale "4 opt-in chips" and "group with data renders expanded" requirements are replaced.

## Impact

- `apps/creator-web/src/components/TaskWizard.tsx` (ExecutionStepBody and the opt-in primitives).
- New pure module `apps/creator-web/src/lib/missionSettingsRows.ts` + `scripts/test-mission-settings-rows.ts`.
- `apps/creator-web/src/lib/taskOptInGroups.ts` (row keys replace group keys),
  `apps/creator-web/src/lib/quickSetup.ts` (focus targets + preset-aware step filtering),
  `apps/creator-web/src/pages/BuilderPage.tsx` (passes `scoringPreset` to the editor).
- `apps/creator-web/src/i18n.ts` (HE/EN row labels and summaries; long help moves to tooltips).
- Tests updated: `scripts/test-task-opt-in-groups.ts`, `scripts/test-quick-setup*.ts`.
- No callable, rule, type or stored-data change. e2e unaffected.
