// One-off: apply the reviewed, professional content fixes to the LIVE
// production copies of "פרוטוקול האפלה" (the 14-18 spy template), after the
// creator flagged specific mistakes while completing it in the real Builder.
//
// Two live documents carry this content — one a direct import (keeps the
// template's own literal task ids), the other a Duplicate of it (per
// cloneTemplateStagesWithMap, EVERY stage/task id is deliberately remapped to
// a fresh uuid so the copy's progress/scoring never collides with the
// original). Matching by hardcoded id therefore finds only ONE of the two —
// this script resolves every task by its stable TITLE instead, which survives
// both an import and a duplicate:
//   H4Bp3sK5DmxK0VPibtuT, x7tsDcCNOxbx2uJcRrrF
//
// Runs extractQuickSetupSteps (the same fixed algorithm the Builder's import
// path and cleanup banner use) FIRST, then layers hand-verified content fixes
// on top for the handful of fields the general algorithm cannot safely infer:
//   - a mission's coordinates are still {0,0} — this creator has not chosen a
//     real spot yet, so nothing here invents a fake specific location;
//   - `smart.secretCode` ("27") and `numericAnswer` (12) are DEMO values the
//     template's own note calls out as illustrative ("רק להמחשה" / "רק
//     דוגמה") — left in place they would silently verify against the wrong
//     answer once a real location is chosen, so both are CLEARED and each
//     gets an explicit, required setup step (the general extractor does not
//     handle these two fields at all, by design — see templateWizard.ts).
//
// Writes ONLY the fields updateGame itself would touch (stages, instructions,
// wizardSteps, updatedAt) via .update(), never a full .set() — every other
// field on the document (owner, visibility, playCount, createdAt, settings)
// is left completely alone.
//
//   node apply-spy-protocol-fixes-prod.cjs [--execute]
const admin = require('firebase-admin');
const { extractQuickSetupSteps } = require('./shared-dist/index.js');

const EXECUTE = process.argv.includes('--execute');
const OWNER_UID = 'wTYDwnEZP6MhGyaGINbumaYqKem1';
const GAME_IDS = ['H4Bp3sK5DmxK0VPibtuT', 'x7tsDcCNOxbx2uJcRrrF'];

admin.initializeApp({ credential: admin.credential.cert(require('../service-account.json')) });
const db = admin.firestore();

// ── Canonical mission keys, resolved to this document's OWN live task id at
// runtime by matching `title` — see the module comment for why. ────────────
const TITLES = {
  START: 'מתחילים פה',
  FOCUS_CODE: 'פענוח',
  MANIFESTO: 'מסלול המניפסט',
  DELIVERY_1: 'המסירה השקטה #1',
  DELIVERY_2: 'המסירה השקטה #2',
  WITNESS: 'עדת הזמן',
  FINAL_CODE: 'הקוד האחרון',
  MISSING_BAG: 'התיק החסר',
  TESTIMONY: 'העדות שלכם',
  FINISH: 'המסירה הסופית',
};

/** title -> this document's live task id, built fresh per game. */
function buildTaskIdByTitle(stages) {
  const map = {};
  for (const stage of stages) {
    for (const task of stage.tasks ?? []) {
      if (task?.title) map[task.title] = task.id;
    }
  }
  return map;
}

function fixesFor(taskIdByTitle) {
  const id = (key) => taskIdByTitle[TITLES[key]];

  // Player-facing description rewrites — clarity fixes only, never inventing
  // a specific location/object the creator has not chosen yet.
  //
  // DELIVERY_1/DELIVERY_2/WITNESS/FINAL_CODE are included even though the
  // general fix (self-destruct-phrase boundary) would clean a FRESH import
  // correctly on its own: this creator already ran Quick Setup once through
  // the OLD, buggy extraction, which stripped only the note's first sentence
  // and left the rest sitting in the STORED description with no bracket
  // marker left for the fixed algorithm to find (the damage already
  // happened, and re-running extraction can no longer see it). Unconditional
  // overwrite recovers all four regardless of what is currently stored.
  const DESCRIPTION_FIX = {
    [id('MANIFESTO')]:
      'המניפסט המקורי של ARCHIVE POINT פוצל בכוונה לשלושה חלקים. פתרו אותם לפי הסדר, ותגלו מה באמת נשבעו לשמור.',
    [id('DELIVERY_1')]:
      'המסירה מחכה כאן. אל תרוצו אליה ישר. תראו כמו קבוצה שמסתובבת סתם, לא כמו קבוצה עם משימה.',
    [id('DELIVERY_2')]:
      'קרובה יותר. קשה יותר לזהות. איפה שיש הכי הרבה עיניים, יש הכי הרבה מקומות להתחבא.',
    [id('WITNESS')]:
      'מצאו מישהו בסביבה שנראה כאילו הוא מכיר את המקום הזה שנים רבות. בקשו סיפור אמיתי אחד שהוא או היא זוכרים, ותעדו בווידאו. הצופה כתבה שהעדויות האלה שוות יותר מכל דף בארכיון. אתם עדיין לא מבינים למה.',
    [id('FINAL_CODE')]:
      'הקוד לא כתוב באף מקום. הוא המקום עצמו. תספרו נכון. תסדרו נכון. מי שיפצח את זה יבין בשביל מה כל זה קרה.',
    [id('MISSING_BAG')]:
      'התיק מסומן במספר, לא בשם. ספרו בדיוק את הפריט שנקבע במיקום, והקלידו את התוצאה.',
    // Rewritten for clarity per the creator's note: the original left the
    // "one continuous take" requirement and the archive's closing beat vague.
    [id('TESTIMONY')]:
      'ARCHIVE POINT מקבל תוספת אחרונה: כל אחד ואחת מכם מקליט/ה משפט אחד על למה שווה לשמור על המקום הזה. רציני, מצחיק, קולע. כל סגנון מתקבל. צלמו הכל ברצף אחד, בלי לחתוך בין הדוברים.',
  };

  // The riddle text a PLAYER reads while solving the final code — still a
  // template (the real items depend on whichever location the creator
  // picks), rewritten as smooth in-narrative prose instead of a bare
  // instructional list.
  const LONG_INSTRUCTIONS_FIX = {
    [id('FINAL_CODE')]:
      'הקוד מורכב משתי ספרות, וכל ספרה נספרת במקום הזה בעצמו.\n'
      + 'הספרה הראשונה: כמה [פריט ראשון, למשל פסלים] אתם סופרים כאן?\n'
      + 'הספרה השנייה: כמה [פריט שני, למשל ספסלים] אתם סופרים כאן?\n'
      + 'חברו את שתי הספרות לפי הסדר הזה: קודם הראשונה, אחר כך השנייה.',
  };

  // Every step's creator-facing instruction, replacing the raw extracted note
  // with a short, professional line. Steps for `smart.secretCode` and
  // `numericAnswer` are injected below (the general extractor never produces
  // them — see the module comment).
  const SHORT_INSTRUCTION = {
    [`${id('START')}|coordinates`]: 'סמנו על המפה את נקודת ההתחלה של המשחק, וקבעו אזור בטיחות סביב מסלול המשחק בהגדרות המתקדמות.',
    [`${id('FOCUS_CODE')}|coordinates`]: 'בחרו מיקום שקט וטוב לריכוז, למשל ספסל או מדשאה.',
    [`${id('MANIFESTO')}|coordinates`]: 'בחרו מיקום שקט, בלי הרבה אנשים סביב.',

    [`${id('DELIVERY_1')}|coordinates`]: 'סמנו על המפה את מיקום המסירה, וצרפו תמונת תקריב של המקום. משימה זו וה\'מסירה השקטה #2\' הן חלופות: קבוצה תבצע רק אחת מהשתיים, כך שמספיק להגדיר מיקום לאחת בלבד.',
    [`${id('DELIVERY_1')}|media`]: 'צרפו תמונת תקריב מסקרנת של המקום. פינה, שלט או פרט אדריכלי מספיקים.',
    [`${id('DELIVERY_2')}|coordinates`]: 'סמנו על המפה מיקום שני, שונה מהמסירה הראשונה. זו החלופה השנייה, קבוצה תבצע רק אחת מהשתיים.',
    [`${id('DELIVERY_2')}|media`]: 'צרפו תמונת תקריב מסקרנת של המקום השני. פינה, שלט או פרט אדריכלי מספיקים.',

    // The change the creator asked for: an INDEPENDENT, interesting location
    // — not a reuse of either silent-delivery spot.
    [`${id('WITNESS')}|coordinates`]: 'בחרו מיקום מעניין ועצמאי לראיון: כיכר, שוק או פינת רחוב עם תנועת אנשים. הרדיוס כבר מוגדר רחב (150 מ׳) כדי לכסות את כל האזור.',

    [`${id('FINAL_CODE')}|coordinates`]: 'זו משימת השיא, היחידה שחייבת מיקום מיוחד משלה. עברו לכרטיסיית "מיקום" וסמנו נקודה עם שני סוגי פרטים נפרדים שקל לספור, למשל פסלים וספסלים, עמודים ומדרגות, או עצים ושלטים.',
    [`${id('FINAL_CODE')}|locationClue`]: 'עברו לכרטיסיית "מיקום" ומלאו רמז ניווט קצר למקום שבחרתם.',
    [`${id('FINAL_CODE')}|smart.longInstructions`]: 'עברו לכרטיסיית "ביצוע ותוספות", ובשדה ההוראות המורחבות החליפו את שני הסוגריים המרובעים בשני הפריטים שבחרתם.',
    [`${id('FINAL_CODE')}|smart.secretCode`]: 'באותה כרטיסייה, קבעו את הקוד הסודי: ספרת הפריט הראשון ואחריה ספרת הפריט השני, לפי הספירה בפועל במקום שבחרתם.',

    [`${id('MISSING_BAG')}|coordinates`]: 'בחרו מקום עם פרט קטן שאפשר לספור בדיוק: קוצים בפסל, גלים בציור קיר, מדרגות בגרם מדרגות, או חלונות בבניין. מומלץ לבחור מקום קרוב פיזית ל"הקוד האחרון".',
    [`${id('MISSING_BAG')}|locationClue`]: 'עברו לכרטיסיית "מיקום" ומלאו רמז ניווט קצר למקום שבחרתם.',
    [`${id('MISSING_BAG')}|numericAnswer`]: 'עברו לכרטיסיית "ביצוע ותוספות" וקבעו את התשובה המספרית: המספר האמיתי של הפריט שספרתם במקום.',

    [`${id('FINISH')}|coordinates`]: 'סמנו על המפה את נקודת הסיום של המשחק.',

    // Two false-positive steps: the note that produced them mentions "ברמז
    // ניווט" (about locationClue) and "והקלידו" trails off from an inline
    // bracket placeholder — neither is really about the task's OWN `hint` /
    // `description` field, but the generic classifier has no way to tell.
    // FINAL_CODE already has a real, good hint; MISSING_BAG has none at all.
    [`${id('FINAL_CODE')}|hint`]: 'הרמז כבר מוגדר היטב. אין צורך לגעת בו.',
    [`${id('FINAL_CODE')}|description`]: 'התיאור כבר עודכן ומוכן. אין צורך לגעת בו.',
    [`${id('MISSING_BAG')}|hint`]: 'רמז לא חובה כאן. אפשר להשאיר ריק, או להוסיף משפט קצר אם תרצו.',
    [`${id('MISSING_BAG')}|description`]: 'התיאור כבר עודכן ומוכן. אין צורך לגעת בו.',
  };

  return { DESCRIPTION_FIX, LONG_INSTRUCTIONS_FIX, SHORT_INSTRUCTION };
}

// smart.secretCode ("27") and numericAnswer (12) are the template's OWN
// illustrative example values — its note says so explicitly ("הדוגמה כרגע
// (27) היא רק להמחשה", "12 כרגע הוא רק דוגמה"). Left as-is they look
// configured (a real number, not a bracket placeholder) but would silently
// verify a player's real submission against a location-specific answer that
// has nothing to do with whatever spot the creator actually picks. Cleared so
// the Builder's own readiness check catches an unset one before launch,
// exactly as it already does for an empty coordinates pin.
function clearDemoAnswerValues(stages, finalCodeId, missingBagId) {
  return stages.map((stage) => ({
    ...stage,
    tasks: (stage.tasks ?? []).map((task) => {
      if (task.id === finalCodeId && task.smart) {
        return { ...task, smart: { ...task.smart, secretCode: '' } };
      }
      if (task.id === missingBagId) {
        const { numericAnswer, ...rest } = task;
        return rest;
      }
      return task;
    }),
  }));
}

function injectStep(steps, taskId, field, prompt) {
  if (!taskId) return steps;
  const stageId = steps.find((s) => s.taskId === taskId)?.stageId ?? '';
  const key = `${stageId}|${taskId}|${field}`;
  if (steps.some((s) => `${s.stageId}|${s.taskId}|${s.targetFieldPath}` === key)) return steps;
  const stepId = `qs-${taskId}-${field.replace(/[^\w]+/g, '-').toLowerCase()}`;
  return [...steps, { id: stepId, stageId, taskId, targetFieldPath: field, instructionPrompt: prompt, isRequired: true }];
}

async function main() {
  for (const gameId of GAME_IDS) {
    const ref = db.doc(`users/${OWNER_UID}/games/${gameId}`);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`[spy-protocol-prod] ${gameId}: not found, skipped`); continue; }
    const game = snap.data();

    const taskIdByTitle = buildTaskIdByTitle(game.stages ?? []);
    const missingTitles = Object.values(TITLES).filter((t) => !taskIdByTitle[t]);
    if (missingTitles.length > 0) {
      console.log(`[spy-protocol-prod] ${gameId}: SKIPPED — missing expected mission(s): ${missingTitles.join(', ')}`);
      continue;
    }
    const { DESCRIPTION_FIX, LONG_INSTRUCTIONS_FIX, SHORT_INSTRUCTION } = fixesFor(taskIdByTitle);

    const extraction = extractQuickSetupSteps(game);
    let stages = extraction.stages;

    for (const stage of stages) {
      for (const task of stage.tasks ?? []) {
        if (DESCRIPTION_FIX[task.id]) task.description = DESCRIPTION_FIX[task.id];
        if (LONG_INSTRUCTIONS_FIX[task.id] && task.smart) {
          task.smart = { ...task.smart, longInstructions: LONG_INSTRUCTIONS_FIX[task.id] };
        }
      }
    }
    stages = clearDemoAnswerValues(stages, taskIdByTitle[TITLES.FINAL_CODE], taskIdByTitle[TITLES.MISSING_BAG]);

    let wizardSteps = extraction.wizardSteps.map((s) => {
      const short = SHORT_INSTRUCTION[`${s.taskId}|${s.targetFieldPath}`];
      return short ? { ...s, instructionPrompt: short } : s;
    });
    wizardSteps = injectStep(wizardSteps, taskIdByTitle[TITLES.DELIVERY_2], 'media', SHORT_INSTRUCTION[`${taskIdByTitle[TITLES.DELIVERY_2]}|media`]);
    wizardSteps = injectStep(wizardSteps, taskIdByTitle[TITLES.FINAL_CODE], 'smart.secretCode', SHORT_INSTRUCTION[`${taskIdByTitle[TITLES.FINAL_CODE]}|smart.secretCode`]);
    wizardSteps = injectStep(wizardSteps, taskIdByTitle[TITLES.MISSING_BAG], 'numericAnswer', SHORT_INSTRUCTION[`${taskIdByTitle[TITLES.MISSING_BAG]}|numericAnswer`]);

    const update = {
      stages,
      ...(extraction.instructions ? { instructions: extraction.instructions } : {}),
      wizardSteps,
      updatedAt: new Date().toISOString(),
    };

    console.log(`\n[spy-protocol-prod] ${gameId} (${game.title}) — ${wizardSteps.length} setup step(s), ${EXECUTE ? 'WRITING' : 'DRY RUN'}`);
    for (const s of wizardSteps) {
      console.log(`  · ${s.isRequired ? 'REQUIRED' : 'optional'}  ${s.targetFieldPath.padEnd(22)}  ${s.instructionPrompt.slice(0, 90)}`);
    }
    if (EXECUTE) {
      await ref.update(update);
      console.log(`[spy-protocol-prod] ${gameId}: written`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
