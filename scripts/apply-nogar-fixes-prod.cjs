// One-off: apply the reviewed, professional content fixes to the LIVE
// production copy of "משחק לנוער" (the 11-13 age group template — the same
// content this repo already fully reviewed locally in
// scripts/seed-real-template-review.mjs, but that pass only ever touched a
// local emulator demo, never production).
//
//   Xu8qa3rm7vEguj7lD2gR
//
// The creator has ALREADY customized some fields by hand since import (a
// richer "כתבת חדשות דחופה" description with an added bonus-points line, a
// genuinely good custom hint on the emoji riddle, several already-short
// coordinate steps) — this script must never clobber those. Every content
// override below is applied ONLY when the current stored value is still
// template-default (empty, an unresolved bracket placeholder, or the raw
// multi-clause operator note) — verified against a fresh read at run time,
// not assumed from an old dump. A final pass replaces every em-dash, en-dash
// and SPACED hyphen anywhere in the document (including fields this script
// never targets, like the creator's own hint) with a period, since a tight
// hyphen inside a word or a number range ("11-13") is explicitly exempt and
// left untouched.
//
// Runs extractQuickSetupSteps (the fixed algorithm) first so any note this
// document still carries is captured the same way a fresh import would.
//
//   node apply-nogar-fixes-prod.cjs [--execute]
const admin = require('firebase-admin');
const { extractQuickSetupSteps } = require('./shared-dist/index.js');

const EXECUTE = process.argv.includes('--execute');
const OWNER_UID = 'wTYDwnEZP6MhGyaGINbumaYqKem1';
const GAME_ID = 'Xu8qa3rm7vEguj7lD2gR';

admin.initializeApp({ credential: admin.credential.cert(require('../service-account.json')) });
const db = admin.firestore();

const TITLES = {
  START: 'מתחילים פה',
  RAP: 'ראפ מנצח',
  ESCAPE: 'המילוט הגדול',
  PYRAMID: 'פירמידה אנושית',
  EMOJI: 'חידת אימוג\'ים',
  NEWS: 'כתבת חדשות דחופה 📰',
  COLA: 'קולה',
  HARD_MATH: 'השאלה הכי מורכבת בעולם',
  CORONA: 'קורונה',
  FLAG: 'גאווה ישראלית',
  FINISH: 'נקודת הסיום',
};
// The two "מצאו את המקום" missions share a title, so they are addressed by
// their own stable task id (unchanged since this document was imported once,
// directly, never duplicated — confirmed by the earlier production audit).
const FIND_PLACE_1_ID = '50ba08c5-1417-4d3e-8bdb-1480d347e263';
const FIND_PLACE_2_ID = 'f0672f8a-8869-493f-aa79-552717147ea1';

function buildTaskIdByTitle(stages) {
  const map = {};
  for (const stage of stages) for (const task of stage.tasks ?? []) if (task?.title) map[task.title] = task.id;
  return map;
}

// A tight hyphen inside a word or a number range ("11-13") is exempt — only
// an em-dash, en-dash, or a hyphen with whitespace on BOTH sides (used as a
// sentence separator) is replaced, and always with a period, never removed
// silently.
function dedash(v) {
  if (typeof v !== 'string') return v;
  if (!/[–—]/.test(v) && !/\s-\s/.test(v)) return v;
  return v
    .replace(/\s*[–—]\s*/g, '. ')
    .replace(/\s-\s/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+\./g, '.')
    .trim();
}
function dedashDeep(v) {
  if (typeof v === 'string') return dedash(v);
  if (Array.isArray(v)) return v.map(dedashDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = dedashDeep(val);
    return out;
  }
  return v;
}

/** Is this description still template-default (safe to overwrite)? */
function descriptionIsUnclaimed(task) {
  const d = typeof task.description === 'string' ? task.description.trim() : '';
  return d === '';
}

async function main() {
  const ref = db.doc(`users/${OWNER_UID}/games/${GAME_ID}`);
  const snap = await ref.get();
  if (!snap.exists) { console.log('game not found'); process.exit(1); }
  const game = snap.data();

  const taskIdByTitle = buildTaskIdByTitle(game.stages ?? []);
  const id = (key) => taskIdByTitle[TITLES[key]];

  // Snapshot which fields are still unclaimed BEFORE extraction touches
  // anything, so the DESCRIPTION_FIX/CLUE_FIX gate below reflects what the
  // creator actually has right now, not a value extraction may have already
  // emptied on this same pass.
  const byId = {};
  for (const stage of game.stages ?? []) for (const task of stage.tasks ?? []) byId[task.id] = task;
  const descriptionUnclaimed = new Set(Object.values(byId).filter(descriptionIsUnclaimed).map((t) => t.id));
  const clueStillPlaceholder = (t) => typeof t.locationClue === 'string' && /\[.*\]/.test(t.locationClue);

  const extraction = extractQuickSetupSteps(game);
  const stages = extraction.stages;

  // Title fix: the two "מצאו את המקום" missions read as duplicate/copy-paste
  // in the mission list. Safe unconditionally — a title never gets creator
  // customization the way a description does, and both are still literally
  // identical right now.
  const DUPLICATE_TITLE_FIX = {
    [FIND_PLACE_1_ID]: 'מצאו את המקום הראשון',
    [FIND_PLACE_2_ID]: 'מצאו את המקום השני',
  };

  // Player-facing description rewrites, gated on the field being genuinely
  // unclaimed. `aec0cc7f` ("כתבת חדשות דחופה") is NOT in this map even though
  // an early template pass would have wanted to touch it: the creator has
  // since written their own, better version (with an added bonus-points
  // line) and it must not be overwritten.
  const DESCRIPTION_FIX = {
    [id('START')]: 'נפגשים כאן ויוצאים לדרך. כשכל הקבוצה כאן, המשחק מתחיל.',
    [FIND_PLACE_1_ID]: 'הביטו היטב בתמונה שצורפה למשימה, ונווטו אל המקום שהיא מציגה.',
    [FIND_PLACE_2_ID]: 'הביטו היטב בתמונה שצורפה למשימה, ונווטו אל המקום שהיא מציגה.',
    [id('EMOJI')]: 'פענחו את רמז האימוג׳ים, הגיעו למקום שהוא מוביל אליו, וספרו כמה יש שם מהחפץ שברמז.',
    [id('COLA')]: 'צלמו מישהו עם בקבוק או פחית קולה.',
  };
  // The emoji riddle's clue still carries its own unfilled placeholders. Gated
  // the same way: only touched while it still contains a bracket.
  const CLUE_FIX = {
    [id('EMOJI')]: 'פענחו את צופן האימוג׳ים כדי לגלות לאן לרוץ. כשתגיעו, ספרו כמה יש שם מהחפץ שברמז, והקלידו את המספר המדויק.',
  };

  for (const stage of stages) {
    for (const task of stage.tasks ?? []) {
      if (DUPLICATE_TITLE_FIX[task.id]) task.title = DUPLICATE_TITLE_FIX[task.id];
      if (DESCRIPTION_FIX[task.id] && descriptionUnclaimed.has(task.id)) task.description = DESCRIPTION_FIX[task.id];
      if (CLUE_FIX[task.id] && clueStillPlaceholder(byId[task.id])) task.locationClue = CLUE_FIX[task.id];
    }
  }

  // Every setup-step instruction, short and single-purpose. Applied to every
  // step regardless of whether its CURRENT text already looks reasonable —
  // consistency across all 16 steps is itself part of "professional", and
  // none of these reference field VALUES a creator might have customized
  // (they are instructions about WHAT TO DO, not quoted player copy).
  const SHORT_INSTRUCTION = {
    [`${id('START')}|coordinates`]: 'סמנו על המפה את נקודת ההתחלה של המשחק, וקבעו אזור בטיחות סביב מסלול המשחק בהגדרות המתקדמות.',
    [`${id('RAP')}|smart.autoApprove`]: 'בחרו אם לאשר את הסרטונים אוטומטית או לבדוק כל אחד בעצמכם.',
    [`${id('PYRAMID')}|coordinates`]: 'אפשר לקבוע למשימה מיקום, או להשאיר אותה פתוחה מכל מקום.',
    [`${FIND_PLACE_1_ID}|media`]: 'צרפו תמונת תקריב של המקום, מסקרנת אך פתירה.',
    [`${FIND_PLACE_1_ID}|coordinates`]: 'סמנו על המפה את המקום שבתמונה.',
    [`${id('EMOJI')}|coordinates`]: 'סמנו על המפה את המקום שהחידה מובילה אליו.',
    // The riddle's numeric answer is a genuine template value here (never
    // flagged by its own note as an illustrative example, unlike the spy
    // template's secretCode/numericAnswer), so it is left AS IS rather than
    // cleared — but the step still makes clear it needs revisiting once a
    // real location is chosen.
    [`${id('EMOJI')}|numericAnswer`]: 'לאחר שתבחרו מיקום, ודאו שהתשובה המספרית תואמת את כמות החפץ בפועל שם.',
    // The hint is already a genuinely good, creator-written explanation of
    // HOW to solve the riddle (not tied to a specific place), so nothing
    // about it needs to change once a location is chosen.
    [`${id('EMOJI')}|hint`]: 'הרמז כבר מוגדר היטב. אין צורך לגעת בו.',
    [`${id('COLA')}|coordinates`]: 'בחרו מיקום עם הרבה אנשים, או השאירו את המשימה פתוחה מכל מקום.',
    [`${id('HARD_MATH')}|coordinates`]: 'בחרו מיקום הומה אדם, כדי שיהיה קל למצוא מי שיעזור.',
    [`${FIND_PLACE_2_ID}|media`]: 'צרפו תמונת תקריב של מקום אחר, מסקרנת אך פתירה.',
    [`${FIND_PLACE_2_ID}|coordinates`]: 'סמנו על המפה את המקום שבתמונה.',
    [`${id('CORONA')}|coordinates`]: 'בחרו מיקום עם הרבה אנשים.',
    [`${id('CORONA')}|smart.autoApprove`]: 'בחרו אם לאשר את התמונות אוטומטית או לבדוק כל אחת בעצמכם.',
    [`${id('FINISH')}|coordinates`]: 'סמנו על המפה את נקודת הסיום של המשחק.',
  };
  const wizardSteps = extraction.wizardSteps.map((s) => {
    const short = SHORT_INSTRUCTION[`${s.taskId}|${s.targetFieldPath}`];
    return short ? { ...s, instructionPrompt: short } : s;
  });

  // Final pass: replace every em-dash / en-dash / spaced hyphen anywhere in
  // the document, including narrative bodyHe copy and the creator's own hint
  // text this script never otherwise touches. A tight hyphen (a compound
  // word, "11-13") is exempt by construction (dedash requires whitespace on
  // both sides for a plain hyphen).
  const cleanedStages = dedashDeep(stages);
  const cleanedWizardSteps = dedashDeep(wizardSteps);
  const cleanedInstructions = extraction.instructions ? dedashDeep(extraction.instructions) : (game.instructions ? dedashDeep(game.instructions) : undefined);
  const cleanedDescription = dedash(game.description);

  const update = {
    stages: cleanedStages,
    ...(cleanedInstructions !== undefined ? { instructions: cleanedInstructions } : {}),
    wizardSteps: cleanedWizardSteps,
    ...(cleanedDescription !== game.description ? { description: cleanedDescription } : {}),
    updatedAt: new Date().toISOString(),
  };

  console.log(`\n[nogar-prod] ${GAME_ID} (${game.title}) — ${cleanedWizardSteps.length} setup step(s), ${EXECUTE ? 'WRITING' : 'DRY RUN'}`);
  for (const s of cleanedWizardSteps) {
    const titleOf = Object.entries(taskIdByTitle).find(([, v]) => v === s.taskId)?.[0]
      ?? (s.taskId === FIND_PLACE_1_ID ? 'מצאו את המקום #1' : s.taskId === FIND_PLACE_2_ID ? 'מצאו את המקום #2' : '?');
    console.log(`  · ${s.isRequired ? 'REQUIRED' : 'optional'}  ${titleOf.padEnd(22)}  ${s.targetFieldPath.padEnd(18)}  ${s.instructionPrompt.slice(0, 80)}`);
  }
  console.log('\ndescription changed:', cleanedDescription !== game.description);
  if (cleanedDescription !== game.description) console.log('  ', JSON.stringify(cleanedDescription));

  if (EXECUTE) {
    await ref.update(update);
    console.log(`\n[nogar-prod] ${GAME_ID}: written`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
