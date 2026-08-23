// One-off, round 3: follow-up fixes to "משחק לנוער" (11-13 template) after the
// creator reviewed round 2.
//
//   Xu8qa3rm7vEguj7lD2gR
//
// Three changes:
//
// 1. "חידת אימוג'ים": the "decode the riddle, navigate there" framing sentence
//    was living in `description` — which functions/src/runs/sanitizeTask.ts
//    proves a player NEVER sees before arrival on a hideLocation task (the
//    sealed stub is built from an explicit allow-list that does not include
//    title or description, only `locationClue` + media + chrome). Moved into
//    `locationClue` itself, ahead of where the creator appends their own
//    emoji riddle. The placeholder use the SAME "[הערת מפעיל: …]" bracket
//    convention already used elsewhere in this codebase (see the spy
//    template's "התיק החסר"), so `isPlaceholderValue`/`findOperatorNotes`
//    correctly keep the Quick Setup step "unconfigured" until the creator
//    replaces it with real emojis — a bare bracket with no recognized
//    keyword would NOT be detected and would silently ship half-finished.
//    `description` now holds a short post-arrival confirmation line instead
//    (shown once the mission unseals, never before).
//
// 2. "כתבת חדשות דחופה": `smart.autoApprove` was entirely absent (not `false`
//    — literally unset), so every submission silently required manual
//    review with nobody having chosen that. Turned ON per the creator.
//
// 3. "מבחן הסלנג" replaced again — the creator wants mature, non-AI-flavored
//    absurdist humor instead: collect signatures on a petition against
//    Israel's donkey-riding license requirement, using their exact wording.
//    Reverted from video back to photo capture per their explicit request.
//
//   node apply-nogar-round3-prod.cjs [--execute]
const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');
const OWNER_UID = 'wTYDwnEZP6MhGyaGINbumaYqKem1';
const GAME_ID = 'Xu8qa3rm7vEguj7lD2gR';

admin.initializeApp({ credential: admin.credential.cert(require('../service-account.json')) });
const db = admin.firestore();

const EMOJI_ID = 'd1f81f77-b071-428e-bd33-5956142eda54';
const NEWS_ID = 'aec0cc7f-902b-4b28-bab0-d1679a54a32b';
const PETITION_ID = '056bfda6-4cdc-4afd-bd83-f2e79ba0fb02'; // was "מבחן הסלנג"

async function main() {
  const ref = db.doc(`users/${OWNER_UID}/games/${GAME_ID}`);
  const snap = await ref.get();
  if (!snap.exists) { console.log('game not found'); process.exit(1); }
  const game = snap.data();

  for (const id of [EMOJI_ID, NEWS_ID, PETITION_ID]) {
    if (!game.stages.some((s) => s.tasks.some((t) => t.id === id))) {
      console.log(`expected task ${id} not found — aborting`);
      process.exit(1);
    }
  }

  const stages = game.stages.map((stage) => ({
    ...stage,
    tasks: stage.tasks.map((task) => {
      if (task.id === EMOJI_ID) {
        return {
          ...task,
          // Post-arrival flavor only — invisible pre-arrival either way, so
          // this is not the navigation instruction anymore.
          description: 'מצאתם את המקום שהאימוג׳ים רמזו עליו!',
          // The framing sentence a PLAYER actually reads while the mission is
          // still sealed, immediately followed by the creator's own riddle.
          locationClue: 'פענחו את רמז האימוג׳ים כדי לגלות לאן לנווט: [הערת מפעיל: הוסיפו כאן את חידת האימוג׳ים שלכם]',
        };
      }
      if (task.id === NEWS_ID) {
        return { ...task, smart: { ...task.smart, autoApprove: true } };
      }
      if (task.id === PETITION_ID) {
        return {
          ...task,
          title: 'העצומה האבסורדית',
          description: 'השיגו דף וכתבו עליו: "מפסיקים את האבסורד: חותמים עכשיו על העצומה לביטול חובת הרישיון לרכיבה על חמורים ומחזירים את ההיגיון לרחובות!" אספו עליו 30 חתימות מאנשים ברחוב, ולאחר מכן צלמו את הדף.',
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
          tags: ['הומור', 'אבסורד', 'חתימות', 'קהילה', 'תמונה'],
        };
      }
      return task;
    }),
  }));

  const wizardSteps = game.wizardSteps.map((s) => {
    if (s.taskId === EMOJI_ID && s.targetFieldPath === 'locationClue') {
      return { ...s, instructionPrompt: 'כתבו את חידת האימוג׳ים שלכם בסוף הטקסט שכבר מופיע בשדה. לדוגמה: 🌳🪑📖 יכול לרמוז על ספסל מתחת לעץ ליד ספרייה.' };
    }
    if (s.taskId === PETITION_ID && s.targetFieldPath === 'coordinates') {
      return { ...s, instructionPrompt: 'בחרו מיקום עם הרבה אנשים, כדי שיהיה קל לאסוף חתימות.' };
    }
    if (s.taskId === PETITION_ID && s.targetFieldPath === 'smart.autoApprove') {
      return { ...s, instructionPrompt: 'בחרו אם לאשר את התמונות אוטומטית או לבדוק כל אחת בעצמכם.' };
    }
    return s;
  });

  const update = { stages, wizardSteps, updatedAt: new Date().toISOString() };

  console.log(`\n[nogar-round3] ${GAME_ID} — ${EXECUTE ? 'WRITING' : 'DRY RUN'}`);
  const emoji = stages.flatMap((s) => s.tasks).find((t) => t.id === EMOJI_ID);
  console.log('\nemoji task:', JSON.stringify({ description: emoji.description, locationClue: emoji.locationClue }, null, 1));
  const news = stages.flatMap((s) => s.tasks).find((t) => t.id === NEWS_ID);
  console.log('\nnews autoApprove:', news.smart.autoApprove);
  const petition = stages.flatMap((s) => s.tasks).find((t) => t.id === PETITION_ID);
  console.log('\npetition task:', JSON.stringify({ title: petition.title, description: petition.description, smart: petition.smart }, null, 1));

  const full = JSON.stringify(update);
  console.log('\nany dash-form anywhere in the changed content:', /[–—]|\s-\s/.test(full), '(want false)');

  if (EXECUTE) {
    await ref.update(update);
    console.log(`\n[nogar-round3] ${GAME_ID}: written`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
