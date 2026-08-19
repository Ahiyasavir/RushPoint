// One-off, round 2: follow-up fixes to "משחק לנוער" (11-13 template) after the
// creator reviewed round 1 and found real gaps — see docs/quick-setup-audit-
// playbook.md, which exists because of exactly this pattern (fix what's named,
// miss what's next to it).
//
//   Xu8qa3rm7vEguj7lD2gR
//
// Three changes:
//
// 1. "חידת אימוג'ים" restructured per the creator's own instructions: converted
//    from a numeric task (pick a location, then count an object there) to a
//    geofence (just navigate to the spot — no number needed). `locationClue` is
//    CLEARED back to empty rather than kept at round 1's generic instructional
//    text: the field IS the riddle a player reads, and round 1 wrote guidance
//    ABOUT writing a riddle instead of leaving room for the creator's own one.
//    Quick Setup now walks locationClue (write the riddle — opens the Location
//    step's Advanced panel automatically, per TaskWizard's focus effect) BEFORE
//    coordinates (mark the exact spot — closes it automatically), matching
//    FIELD_RANK's existing locationClue(21) < coordinates(30) order with no UI
//    code change needed; that panel open/close wiring already shipped.
//
// 2. Every photo/video task in the game gets its `smart.autoApprove` decision
//    surfaced, not just the ones an operator note happened to mention — the
//    general fix now lives in extractQuickSetupSteps itself
//    (packages/shared/src/templateWizard.ts), so simply re-running extraction
//    against the current game picks up "המילוט הגדול", "פירמידה אנושית",
//    "כתבת חדשות דחופה" and the replacement "קורונה" mission below, none of
//    which had a step for this before.
//
// 3. "קורונה" replaced outright: a 2020 pandemic-signature-collection premise
//    reads as dated content in a 2026 template. Same mechanics (find people,
//    film a reaction), new premise that is actually current and funny.
//
//   node apply-nogar-round2-prod.cjs [--execute]
const admin = require('firebase-admin');
const { extractQuickSetupSteps } = require('./shared-dist/index.js');

const EXECUTE = process.argv.includes('--execute');
const OWNER_UID = 'wTYDwnEZP6MhGyaGINbumaYqKem1';
const GAME_ID = 'Xu8qa3rm7vEguj7lD2gR';

admin.initializeApp({ credential: admin.credential.cert(require('../service-account.json')) });
const db = admin.firestore();

const EMOJI_ID = 'd1f81f77-b071-428e-bd33-5956142eda54';
const CORONA_ID = '056bfda6-4cdc-4afd-bd83-f2e79ba0fb02';

async function main() {
  const ref = db.doc(`users/${OWNER_UID}/games/${GAME_ID}`);
  const snap = await ref.get();
  if (!snap.exists) { console.log('game not found'); process.exit(1); }
  const game = snap.data();

  const emojiBefore = game.stages.flatMap((s) => s.tasks).find((t) => t.id === EMOJI_ID);
  const coronaBefore = game.stages.flatMap((s) => s.tasks).find((t) => t.id === CORONA_ID);
  if (!emojiBefore || !coronaBefore) { console.log('expected task(s) not found — aborting'); process.exit(1); }

  // ── 1. Restructure the emoji riddle: numeric → geofence ──────────────────
  const stages = game.stages.map((stage) => ({
    ...stage,
    tasks: stage.tasks.map((task) => {
      if (task.id === EMOJI_ID) {
        const { numericAnswer, numericTolerance, ...rest } = task;
        return {
          ...rest,
          type: 'geofence',
          triggerMode: 'radius',
          locationless: false,
          geofenceRadiusMeters: 30,
          description: 'פענחו את רמז האימוג׳ים, ונווטו למקום שהוא מוביל אליו.',
          // Cleared, not filled: this field IS the riddle a player reads, and
          // only the creator knows the real place they are hinting at. A
          // required Quick Setup step (below) walks them through writing it.
          locationClue: '',
          hint: 'רמז: עברו על הרמז לאט. כל אימוג\'י מייצג מילה אחת, וביחד הן מרכיבות משפט שמתאר מקום מוכר בסביבה.',
        };
      }
      if (task.id === CORONA_ID) {
        // ── 3. Replace the corona premise outright ──
        return {
          ...task,
          title: 'מבחן הסלנג',
          description: 'בחרו מילת סלנג או מם פופולרי מהיום, ותראו אותו למבוגר או מבוגרת (הורה, שכן, כל אחד מעל גיל 30). תעדו אותו מנסה לנחש את המשמעות. ככל שהתגובה מבולבלת יותר, כך יותר כיף.',
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true, captureKind: 'video', videoMinSeconds: 15, videoMaxSeconds: 45 },
          triggerMode: 'radius',
          locationless: false,
          geofenceRadiusMeters: 40,
          tags: ['הומור', 'דור', 'סלנג', 'וידיאו', 'קהילה', 'כיף'],
        };
      }
      return task;
    }),
  }));

  // ── 2. Re-run extraction against the now-restructured game. The general
  // autoApprove pass fires for every photo/video task that lacks a step,
  // picking up המילוט הגדול / פירמידה אנושית / כתבת חדשות דחופה / the new
  // מבחן הסלנג — no per-task hand-authoring needed for that part. ──────────
  const extraction = extractQuickSetupSteps({ ...game, stages });

  // ── Emoji task: drop the now-irrelevant numericAnswer/hint steps, replace
  // coordinates' wording, and inject the new REQUIRED locationClue step (no
  // note exists to trigger it automatically — the field was cleared, not
  // note-carrying). Ordered locationClue-then-coordinates by simply pushing
  // locationClue in after any existing coordinates step is rewritten; actual
  // render order comes from FIELD_RANK regardless of array position. ───────
  let wizardSteps = extraction.wizardSteps
    .filter((s) => !(s.taskId === EMOJI_ID && (s.targetFieldPath === 'numericAnswer' || s.targetFieldPath === 'hint')))
    .map((s) => {
      if (s.taskId === EMOJI_ID && s.targetFieldPath === 'coordinates') {
        return { ...s, instructionPrompt: 'עכשיו סמנו על המפה את המקום המדויק שהחידה מרמזת עליו.', isRequired: true };
      }
      if (s.taskId === CORONA_ID && s.targetFieldPath === 'coordinates') {
        return { ...s, instructionPrompt: 'בחרו מיקום עם הרבה אנשים, כדי שיהיה קל למצוא מבוגרים לשאול.', isRequired: true };
      }
      if (s.taskId === CORONA_ID && s.targetFieldPath === 'smart.autoApprove') {
        return { ...s, instructionPrompt: 'בחרו אם לאשר את הסרטונים אוטומטית או לבדוק כל אחד בעצמכם.', isRequired: false };
      }
      return s;
    });

  const emojiStageId = stages.find((s) => s.tasks.some((t) => t.id === EMOJI_ID)).id;
  const hasEmojiClueStep = wizardSteps.some((s) => s.taskId === EMOJI_ID && s.targetFieldPath === 'locationClue');
  if (!hasEmojiClueStep) {
    wizardSteps = [...wizardSteps, {
      id: `qs-${EMOJI_ID}-locationclue`,
      stageId: emojiStageId, taskId: EMOJI_ID, targetFieldPath: 'locationClue',
      instructionPrompt: 'תחשבו על מקום, ותכתבו חידת אימוג\'ים שמרמזת עליו. לדוגמה: 🌳🪑📖 יכול לרמוז על ספסל מתחת לעץ ליד ספרייה.',
      isRequired: true,
    }];
  }

  const update = { stages, wizardSteps, updatedAt: new Date().toISOString() };

  console.log(`\n[nogar-round2] ${GAME_ID} — ${wizardSteps.length} setup step(s) total, ${EXECUTE ? 'WRITING' : 'DRY RUN'}`);
  const titleByTaskId = {};
  for (const st of stages) for (const t of st.tasks) titleByTaskId[t.id] = t.title;
  for (const s of wizardSteps) {
    console.log(`  · ${s.isRequired ? 'REQUIRED' : 'optional'}  ${(titleByTaskId[s.taskId] || s.taskId || 'game').padEnd(22)}  ${s.targetFieldPath.padEnd(20)}  ${s.instructionPrompt.slice(0, 80)}`);
  }
  console.log('\nemoji task after:', JSON.stringify({
    type: stages.flatMap((s) => s.tasks).find((t) => t.id === EMOJI_ID).type,
    locationClue: stages.flatMap((s) => s.tasks).find((t) => t.id === EMOJI_ID).locationClue,
    hasNumericAnswer: 'numericAnswer' in stages.flatMap((s) => s.tasks).find((t) => t.id === EMOJI_ID),
  }, null, 1));
  console.log('\nnew slang-test mission:', JSON.stringify({
    title: stages.flatMap((s) => s.tasks).find((t) => t.id === CORONA_ID).title,
    description: stages.flatMap((s) => s.tasks).find((t) => t.id === CORONA_ID).description,
  }, null, 1));

  const newAutoApproveSteps = wizardSteps.filter((s) => s.targetFieldPath === 'smart.autoApprove');
  console.log(`\nautoApprove steps present: ${newAutoApproveSteps.length}`);
  for (const s of newAutoApproveSteps) console.log('  -', titleByTaskId[s.taskId]);

  if (EXECUTE) {
    await ref.update(update);
    console.log(`\n[nogar-round2] ${GAME_ID}: written`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
