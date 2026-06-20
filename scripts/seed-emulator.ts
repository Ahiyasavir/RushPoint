/**
 * RushPoint — Firebase Emulator Seed Script (v3 — full demo)
 *
 * 25 green field stations (8 smart: code_verification / photo_upload / manual_judge)
 * 1 orange "find the Tene" stage  •  15 gold creation stations at Gan HaKipod
 * 3 basket hiding zones  •  10 demo teams covering every game scenario
 *
 * Scenarios covered:
 *   A  The Rookies        → Slot 0 active (just logged in), 0 pts
 *   B  The Explorers      → Slot 1 active (mid-race), 100 pts
 *   C  The Basket Finders → Gold active, pending judge check-in, 450 pts
 *   D  The Champions      → Fully finished, judge scored (82), 2104 pts
 *   E  The Eagles         → At gate, waiting for matchmaking duel, 300 pts
 *   F  The Falcons        → Crafting (slot 5 active, craftingStartedAt set), 450 pts
 *   G  The Guardians      → Mid-race slot 2 active (smart station), 200 pts
 *   H  The Hawks          → Lost matchmaking duel, needs to re-queue, 250 pts
 *   I  The Hunters        → Orange stage active (just reached the park), 350 pts
 *   J  The Jackals        → Just registered, slot 0 active, 0 pts
 *
 * Usage:
 *   npm run seed          → merge (idempotent, skips existing docs)
 *   npm run seed:reset    → wipe all mock data first, then seed fresh
 *
 * Prerequisites:
 *   Firebase emulators must be running:  npm run emulator
 *   Emulator UI:                         http://localhost:4000
 */

import * as admin from 'firebase-admin';

// ─── Emulator connection ──────────────────────────────────────────────────────
process.env.FIRESTORE_EMULATOR_HOST     = process.env.FIRESTORE_EMULATOR_HOST     ?? '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

const APP_ID     = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
const PROJECT_ID = process.env.GCLOUD_PROJECT   ?? 'rushpoint-pwa-7daaa';
const RESET      = process.argv.includes('--reset');

admin.initializeApp({ projectId: PROJECT_ID });
const db   = admin.firestore();
const auth = admin.auth();

// ─── Path helpers ─────────────────────────────────────────────────────────────
const pub    = (col: string)                          => `artifacts/${APP_ID}/public/data/${col}`;
const priv   = (uid: string, col: string)             => `artifacts/${APP_ID}/users/${uid}/${col}`;
const pubDoc = (col: string, id: string)              => `${pub(col)}/${id}`;
const prvDoc = (uid: string, col: string, id: string) => `${priv(uid, col)}/${id}`;
const codes  = ()                                     => `artifacts/${APP_ID}/accessCodes`;
const codeDoc = (code: string)                        => `${codes()}/${code}`;
const secrets = (taskId: string)                      => `artifacts/${APP_ID}/stationSecrets/${taskId}`;

// ─── Time helpers ─────────────────────────────────────────────────────────────
const minsAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const now     = ()          => new Date().toISOString();

// ═══════════════════════════════════════════════════════════════════════════════
// TEAM DEFINITIONS (10 teams, A–J)
// ═══════════════════════════════════════════════════════════════════════════════

const TEAMS = {
  A: { uid: 'mock-team-a-uid', name: 'The Rookies',        code: 'ROOK1' },
  B: { uid: 'mock-team-b-uid', name: 'The Explorers',      code: 'EXPL2' },
  C: { uid: 'mock-team-c-uid', name: 'The Basket Finders', code: 'BSKT3' },
  D: { uid: 'mock-team-d-uid', name: 'The Champions',      code: 'CHMP4' },
  E: { uid: 'mock-team-e-uid', name: 'The Eagles',         code: 'EAGL5' },
  F: { uid: 'mock-team-f-uid', name: 'The Falcons',        code: 'FALC6' },
  G: { uid: 'mock-team-g-uid', name: 'The Guardians',      code: 'GARD7' },
  H: { uid: 'mock-team-h-uid', name: 'The Hawks',          code: 'HAWK8' },
  I: { uid: 'mock-team-i-uid', name: 'The Hunters',        code: 'HUNT9' },
  J: { uid: 'mock-team-j-uid', name: 'The Jackals',        code: 'JACK0' },
} as const;

const ALL_UIDS = Object.values(TEAMS).map((t) => t.uid);

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS — 25 green + 1 orange + 15 gold = 41 total
// All green stations are distributed along the Motza → gate corridor (~4 km NE).
// Gold creation stations are clustered at Gan HaKipod.
// ═══════════════════════════════════════════════════════════════════════════════

// Smart station helper — public-safe config only (no secret here)
const codeVerify = (opts: {
  label?: string; labelHe?: string; instructions?: string; instructionsHe?: string;
  geofence?: number; lat?: number; lng?: number; attempts?: number;
}) => ({
  enabled: true as const,
  verificationType: 'code_verification' as const,
  codeInputLabel:   opts.label   ?? 'Enter the station code',
  hasCode:          true,
  autoCompleteOnSuccess: true,
  attemptLimit:     opts.attempts ?? 5,
  geofenceRadiusMeters: opts.geofence ?? 80,
  ...(opts.lat && opts.lng ? { stationCoords: { lat: opts.lat, lng: opts.lng } } : {}),
  longInstructions:   opts.instructions,
  longInstructionsHe: opts.instructionsHe,
  showIntroScreen:    true,
  showSuccessScreen:  true,
  showFailureScreen:  true,
});

const photoUpload = (opts: { instructions?: string; instructionsHe?: string } = {}) => ({
  enabled: true as const,
  verificationType: 'photo_upload' as const,
  photoReviewRequired: true,
  needsAdminApproval:  true,
  longInstructions:    opts.instructions,
  longInstructionsHe:  opts.instructionsHe,
  showIntroScreen:          true,
  showSuccessScreen:        false,
  showFailureScreen:        true,
  showPendingReviewScreen:  true,
});

const manualJudge = (opts: { instructions?: string; instructionsHe?: string } = {}) => ({
  enabled: true as const,
  verificationType: 'manual_judge' as const,
  needsAdminApproval: true,
  longInstructions:   opts.instructions,
  longInstructionsHe: opts.instructionsHe,
  showPendingReviewScreen: true,
});

const TASKS = [

  // ══ GREEN FIELD STATIONS (25) ══════════════════════════════════════════════
  // Zones A–E spread NE from Motza (31.793, 35.166) to the Bible Park gate (31.807, 35.189)
  // 8 of the 25 are smart stations (code_verification / photo_upload / manual_judge)

  // ─── Zone A: Near Motza start (lat 31.794–31.798) ─────────────────────────
  {
    id: 'task-green-001',
    title: 'Jerusalem Landmarks Photo Hunt',
    titleHe: 'ציד תמונות אתרי ירושלים',
    description: 'Photograph all 5 specified Jerusalem landmarks as a team. Each member must appear in at least one photo.',
    descriptionHe: 'צלמו את 5 אתרי ירושלים המצוינים כצוות. כל חבר חייב להופיע בלפחות תמונה אחת.',
    type: 'green', coordinates: { lat: 31.7970, lng: 35.1720 },
    locationHint: 'Begin near the ancient spring in the valley below Motza.',
    locationHintHe: 'התחילו ליד הבריכה העתיקה בוואדי מטה למוצא.',
    qrCode: 'QR-GREEN-001', difficulty: 3, maxConcurrentTeams: 3, currentTeamCount: 1,
    photoRequired: true, pointValue: 100, estimatedMinutes: 15, isActive: true,
    smart: photoUpload({
      instructions: 'Photograph all 5 landmarks with at least one team member in each shot, then upload your best group photo as proof.',
      instructionsHe: 'צלמו את כל 5 האתרים עם לפחות חבר צוות אחד בכל תמונה, ואז העלו את תמונת הקבוצה הטובה ביותר.',
    }),
  },
  {
    id: 'task-green-005',
    title: 'Valley Flora Scavenger Hunt',
    titleHe: 'ציד צמחי הבקעה',
    description: 'Locate and photograph 6 native plant species listed on your mission card. Find the station code on the field board to complete.',
    descriptionHe: 'מצאו ותצלמו 6 מינים של צמחים מקומיים הרשומים בכרטיס המשימה. מצאו את קוד התחנה על הלוח השדה.',
    type: 'green', coordinates: { lat: 31.7945, lng: 35.1685 },
    locationHint: 'Station post with the green leaf marker, 150m from the trailhead.',
    locationHintHe: 'עמוד עם סמל עלה ירוק, 150 מ\' מנקודת הכניסה לשביל.',
    qrCode: 'QR-GREEN-005', difficulty: 2, maxConcurrentTeams: 4, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 12, isActive: true,
    smart: codeVerify({
      label: 'Station code (on the field board)',
      labelHe: 'קוד תחנה (על הלוח)',
      instructions: 'Find the wooden board posted at the marked stake. The 5-letter code is printed at the bottom.',
      instructionsHe: 'מצאו את הלוח העץ שמוצמד לעמוד. הקוד בן 5 האותיות מודפס בתחתית.',
      geofence: 80, lat: 31.7945, lng: 35.1685,
    }),
  },
  {
    id: 'task-green-006',
    title: 'Ancient Path Waypoints',
    titleHe: 'עקבות השביל העתיק',
    description: 'Navigate between 4 waypoints using the hand-drawn map on your mission card. At each waypoint, record what you find.',
    descriptionHe: 'נווטו בין 4 נקודות ציון באמצעות המפה המצורפת. בכל נקודה, תעדו מה מצאתם.',
    type: 'green', coordinates: { lat: 31.7955, lng: 35.1698 },
    locationHint: 'Orange marker post at km 0.3 of the valley bike path.',
    locationHintHe: 'עמוד סמן כתום בק"מ 0.3 של שביל האופניים.',
    qrCode: 'QR-GREEN-006', difficulty: 4, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 18, isActive: true,
  },
  {
    id: 'task-green-007',
    title: 'Arazim Bird Species Census',
    titleHe: 'מפקד ציפורי ארזים',
    description: 'Spend 10 minutes observing and recording bird species in this section of the valley. Upload a photo of your best sighting for review.',
    descriptionHe: 'בלו 10 דקות בתצפית ותיעוד מינים של ציפורים. העלו תמונה של התצפית הטובה ביותר לאישור.',
    type: 'green', coordinates: { lat: 31.7963, lng: 35.1710 },
    locationHint: 'Open clearing with the wooden observation bench.',
    locationHintHe: 'פתח עם ספסל תצפית עשוי עץ.',
    qrCode: 'QR-GREEN-007', difficulty: 3, maxConcurrentTeams: 4, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 14, isActive: true,
    smart: photoUpload({
      instructions: 'Observe birds for 10 minutes, then take a clear photo of the species your team identifies. A volunteer will review your submission.',
      instructionsHe: 'צפו בציפורים 10 דקות ואז צלמו תמונה ברורה של המין שהצוות זיהה. מתנדב יבדוק את ההגשה.',
    }),
  },
  {
    id: 'task-green-008',
    title: 'Sunrise Compass Bearing',
    titleHe: 'כיוון הצפון עם המצפן',
    description: 'Use the station compass to determine the bearing to each of the 3 landmarks listed. Record accurate bearings within ±5°.',
    descriptionHe: 'השתמשו במצפן בתחנה כדי לקבוע את הכיוון לכל אחד מ-3 האתרים ברשימה. רשמו נתוני כיוון מדויקים.',
    type: 'green', coordinates: { lat: 31.7972, lng: 35.1725 },
    locationHint: 'Rocky ridge with the metal compass post.',
    locationHintHe: 'גבעה סלעית עם עמוד מצפן מתכתי.',
    qrCode: 'QR-GREEN-008', difficulty: 5, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 16, isActive: true,
    smart: codeVerify({
      label: 'Bearing confirmation code',
      labelHe: 'קוד אישור כיוון',
      instructions: 'Record the three correct bearings on the answer card, then look for the confirmation code engraved on the back of the compass post.',
      instructionsHe: 'רשמו את שלושת הכיוונים הנכונים בכרטיס התשובות, ואז חפשו את קוד האישור חרוט בגב עמוד המצפן.',
      geofence: 80, lat: 31.7972, lng: 35.1725,
    }),
  },

  // ─── Zone B: Lower Arazim (lat 31.798–31.802) ─────────────────────────────
  {
    id: 'task-green-009',
    title: 'Biblical Plant Identification',
    titleHe: 'זיהוי צמחי תנ"ך',
    description: 'Match 8 plant samples at the station to their Biblical names using the reference cards provided.',
    descriptionHe: 'השוו 8 דגימות צמחים בתחנה לשמותיהם התנ"כיים באמצעות כרטיסי עזר.',
    type: 'green', coordinates: { lat: 31.7982, lng: 35.1738 },
    locationHint: 'Blue-tipped post beside the wild almond grove.',
    locationHintHe: 'עמוד עם קצה כחול ליד חורשת שקד הבר.',
    qrCode: 'QR-GREEN-009', difficulty: 4, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 14, isActive: true,
  },
  {
    id: 'task-green-010',
    title: 'Rope Knot Mastery',
    titleHe: 'אומנות הקשרים',
    description: 'Every team member must tie 3 knots correctly: a square knot, a bowline, and a clove hitch. Enter the station code from the instruction board to confirm.',
    descriptionHe: 'כל חבר צוות חייב לקשור 3 קשרים נכון: קשר מרובע, קשר בולין וקשר מוט. הזינו את קוד התחנה.',
    type: 'green', coordinates: { lat: 31.7992, lng: 35.1752 },
    locationHint: 'Yellow post with rope samples hanging from it.',
    locationHintHe: 'עמוד צהוב עם דוגמאות חבל תלויות ממנו.',
    qrCode: 'QR-GREEN-010', difficulty: 4, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 16, isActive: true,
    smart: codeVerify({
      label: 'Knot master code',
      labelHe: 'קוד אדון הקשרים',
      instructions: 'After tying all knots correctly for the station volunteer, ask them for the 5-letter confirmation code.',
      instructionsHe: 'לאחר קשירת כל הקשרים נכון בפני מתנדב התחנה, בקשו ממנו את קוד האישור בן 5 האותיות.',
      geofence: 80, lat: 31.7992, lng: 35.1752, attempts: 3,
    }),
  },
  {
    id: 'task-green-011',
    title: 'Valley Echo Challenge',
    titleHe: 'אתגר הד הבקעה',
    description: 'The team shouts a Shema verse from the ridge — the team captain records a short video proving the echo was heard.',
    descriptionHe: 'הצוות קורא פסוק שמע מהגבעה — קפטן הצוות מצלם סרטון קצר שמוכיח שהד נשמע.',
    type: 'green', coordinates: { lat: 31.8000, lng: 35.1763 },
    locationHint: 'Stone ridge marked with a white flag.',
    locationHintHe: 'גבעת סלעים עם דגל לבן.',
    qrCode: 'QR-GREEN-011', difficulty: 2, maxConcurrentTeams: 4, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 10, isActive: true,
    smart: photoUpload({
      instructions: 'Record a short video (10–20 sec) of your team shouting the verse and capturing the echo. A volunteer will review the submission.',
      instructionsHe: 'צלמו סרטון קצר (10–20 שניות) של הצוות שקורא את הפסוק ותופס את ההד. מתנדב יבדוק את ההגשה.',
    }),
  },
  {
    id: 'task-green-002',
    title: 'Blindfolded Trust Relay',
    titleHe: 'ריצת השליחות בעיניים עצומות',
    description: 'One team member is blindfolded. The rest must guide them through a 50-metre course using verbal instructions only.',
    descriptionHe: 'חבר אחד בצוות מכוסה עיניים. השאר מנחים אותם דרך מסלול של 50 מ\' בהוראות מילוליות בלבד.',
    type: 'green', coordinates: { lat: 31.8010, lng: 35.1800 },
    locationHint: 'Open path section with orange boundary cones.',
    locationHintHe: 'קטע שביל פתוח עם חרוטים גבולות כתומים.',
    qrCode: 'QR-GREEN-002', difficulty: 5, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 20, isActive: true,
  },
  {
    id: 'task-green-012',
    title: 'Desert Water Conservation',
    titleHe: 'חיסכון במים בשטח',
    description: 'Using only the materials provided, build a runoff channel that directs water to the cistern. The judge measures volume collected in 2 minutes.',
    descriptionHe: 'בעזרת החומרים הנתונים בלבד, בנו ערוץ ניקוז שמנהל מים אל הבור. השופט מודד נפח שנאסף ב-2 דקות.',
    type: 'green', coordinates: { lat: 31.8007, lng: 35.1774 },
    locationHint: 'Station with the plastic water pipe and sand boards.',
    locationHintHe: 'תחנה עם צינור מים פלסטיק ולוחות חול.',
    qrCode: 'QR-GREEN-012', difficulty: 6, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 20, isActive: true,
  },

  // ─── Zone C: Mid-Arazim (lat 31.802–31.805) ───────────────────────────────
  {
    id: 'task-green-013',
    title: 'Stream Crossing Strategy',
    titleHe: 'חצייה על המים',
    description: 'Cross the dry stream-bed using only the 4 stepping stones provided — all team members must cross without touching the ground. Station code is on the far bank.',
    descriptionHe: 'חצו את ערוץ הנחל היבש רק בעזרת 4 אבנות הדריכה — כל חברי הצוות חייבים לעבור מבלי לגעת בקרקע.',
    type: 'green', coordinates: { lat: 31.8016, lng: 35.1787 },
    locationHint: 'Dry streambed with the 4 flat stone pads.',
    locationHintHe: 'ערוץ נחל יבש עם 4 אבני דריכה שטוחות.',
    qrCode: 'QR-GREEN-013', difficulty: 6, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 18, isActive: true,
    smart: codeVerify({
      label: 'Far-bank code',
      labelHe: 'קוד גדת הגובה',
      instructions: 'After your entire team crosses, read the code posted on the far bank sign and enter it here.',
      instructionsHe: 'לאחר שכל הצוות עבר, קראו את הקוד שמוצג על השלט בגדה הרחוקה.',
      geofence: 100, lat: 31.8016, lng: 35.1787,
    }),
  },
  {
    id: 'task-green-014',
    title: 'Ancient Inscription Rubbing',
    titleHe: 'שחזור כתובת עתיקה',
    description: 'Use the rubbing paper and charcoal block at the station to copy the carved inscription. All characters must be legible.',
    descriptionHe: 'השתמשו בנייר השחזור ובגוש הפחם בתחנה להעתיק את הכתובת החרוטה. כל האותיות חייבות להיות קריאות.',
    type: 'green', coordinates: { lat: 31.8023, lng: 35.1797 },
    locationHint: 'Replica stone slab beside the carved wooden post.',
    locationHintHe: 'לוח אבן מוקטן ליד עמוד עץ מגולף.',
    qrCode: 'QR-GREEN-014', difficulty: 3, maxConcurrentTeams: 4, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 13, isActive: true,
  },
  {
    id: 'task-green-004',
    title: 'The Human Knot',
    titleHe: 'קשר אנושי',
    description: 'All team members join hands in a tangled circle. Work together to untangle the knot without releasing hands.',
    descriptionHe: 'כל חברי הצוות אוחזים ידיים במעגל מסובך. עבדו יחד לשחרר את הקשר מבלי לשחרר ידיים.',
    type: 'green', coordinates: { lat: 31.8030, lng: 35.1808 },
    locationHint: 'Open gravel clearing with the stone ring marker.',
    locationHintHe: 'פינת חצץ פתוחה עם סמן טבעת אבן.',
    qrCode: 'QR-GREEN-004', difficulty: 2, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 10, isActive: true,
  },
  {
    id: 'task-green-015',
    title: 'Shepherd Song Relay',
    titleHe: 'שירת הרועים',
    description: 'Each team member learns one line of a traditional shepherd song — then the team performs it in sequence. Upload a team video for review.',
    descriptionHe: 'כל חבר צוות לומד שורה אחת משיר רועים מסורתי — ואז הצוות מבצע אותה ברצף. העלו סרטון צוותי.',
    type: 'green', coordinates: { lat: 31.8038, lng: 35.1820 },
    locationHint: 'Shaded terrace with the song-lyric boards.',
    locationHintHe: 'טרסה מוצלת עם לוחות מילות השיר.',
    qrCode: 'QR-GREEN-015', difficulty: 3, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 14, isActive: true,
    smart: photoUpload({
      instructions: 'Record a short team video of your Shepherd Song performance. A volunteer will review it.',
      instructionsHe: 'צלמו סרטון קצר של ביצוע שיר הרועים של הצוות. מתנדב יבדוק.',
    }),
  },

  // ─── Zone D: Upper Arazim (lat 31.804–31.807) ─────────────────────────────
  {
    id: 'task-green-003',
    title: 'Bible Trivia Blitz',
    titleHe: 'חידון תנ"ך ירושלמי',
    description: 'Answer 10 Jerusalem-themed Bible trivia questions together. Submit one collective answer per question.',
    descriptionHe: 'ענו על 10 שאלות חידון תנ"ך בנושא ירושלים. הגישו תשובה קולקטיבית אחת לכל שאלה.',
    type: 'green', coordinates: { lat: 31.8050, lng: 35.1841 },
    locationHint: 'White canvas tent with the question boards.',
    locationHintHe: 'אוהל ברזנט לבן עם לוחות השאלות.',
    qrCode: 'QR-GREEN-003', difficulty: 4, maxConcurrentTeams: 4, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 12, isActive: true,
    smart: codeVerify({
      label: 'Quiz completion code',
      labelHe: 'קוד השלמת החידון',
      instructions: 'Answer all 10 trivia questions on the answer sheet. When the station host confirms all answers, they will give you the 6-letter completion code.',
      instructionsHe: 'ענו על כל 10 שאלות החידון בגיליון התשובות. כאשר מנחה התחנה מאשר את כל התשובות, הוא ייתן לכם את קוד ההשלמה בן 6 האותיות.',
      geofence: 80, lat: 31.8050, lng: 35.1841, attempts: 3,
    }),
  },
  {
    id: 'task-green-016',
    title: 'Rock Formation Sketch',
    titleHe: 'רישום מצוקי הארץ',
    description: 'Each team member sketches the same rock formation — then combine sketches into a single composition. A judge rates the group artwork.',
    descriptionHe: 'כל חבר מצוות מצייר את אותו מצוק — ואז משלבים את הרישומים ליצירה אחת. שופט מדרג את היצירה.',
    type: 'green', coordinates: { lat: 31.8043, lng: 35.1831 },
    locationHint: 'Limestone outcrop with the easel and art supplies station.',
    locationHintHe: 'רכס גיר עם תחנת כן ציור וחומרי אמנות.',
    qrCode: 'QR-GREEN-016', difficulty: 4, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 18, isActive: true,
    smart: photoUpload({
      instructions: 'Photograph the combined composition made from all team members\' individual sketches laid side-by-side. A volunteer will review the artwork.',
      instructionsHe: 'צלמו את היצירה המשולבת שנוצרה מרישומי כל חברי הצוות שהונחו זה לצד זה. מתנדב יבדוק את האמנות.',
    }),
  },
  {
    id: 'task-green-017',
    title: 'Torah Verse Relay Race',
    titleHe: 'תחרות פסוקי תורה',
    description: 'Team is handed one word each from a Torah verse — race to put yourselves in the correct order. Fastest time wins the bonus.',
    descriptionHe: 'כל חבר מקבל מילה אחת מפסוק תורה — ריצו לסדר עצמכם בסדר הנכון. הזמן המהיר ביותר זוכה בבונוס.',
    type: 'green', coordinates: { lat: 31.8057, lng: 35.1853 },
    locationHint: 'Station with the word-card rack and stopwatch.',
    locationHintHe: 'תחנה עם מדף כרטיסי מילים ושעון עצר.',
    qrCode: 'QR-GREEN-017', difficulty: 5, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 16, isActive: true,
  },
  {
    id: 'task-green-018',
    title: 'Wilderness First Aid Drill',
    titleHe: 'תרגיל עזרה ראשונה בשטח',
    description: 'A "patient" lies 200m ahead — your team must stabilise, splint, and carry them to the finish line. Station code is on the patient\'s wristband.',
    descriptionHe: '"נפגע" שוכב 200 מ\' קדימה — הצוות מייצב, מגבס ומסיע אותו לקו הסיום. קוד על הצמיד.',
    type: 'green', coordinates: { lat: 31.8062, lng: 35.1862 },
    locationHint: 'Red-cross flag post at the drill start line.',
    locationHintHe: 'עמוד דגל צלב אדום בקו ההתחלה של התרגיל.',
    qrCode: 'QR-GREEN-018', difficulty: 7, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 22, isActive: true,
    smart: codeVerify({
      label: 'Patient wristband code',
      labelHe: 'קוד צמיד הנפגע',
      instructions: 'After stabilising and evacuating your patient, read the 5-letter code from the wristband they\'re wearing.',
      instructionsHe: 'לאחר ייצוב ופינוי הנפגע, קראו את הקוד בן 5 האותיות מהצמיד שעליו.',
      geofence: 100, lat: 31.8062, lng: 35.1862, attempts: 3,
    }),
  },
  {
    id: 'task-green-019',
    title: 'Mountain Goat Obstacle Course',
    titleHe: 'מכשולי עז ההר',
    description: 'Navigate a 100m natural obstacle course as a team — no running, deliberate and careful. Shortest cumulative time for all members wins.',
    descriptionHe: 'נווטו מסלול מכשולים טבעי של 100 מ\' כצוות — ללא ריצה, בזהירות. הזמן הקצר ביותר זוכה.',
    type: 'green', coordinates: { lat: 31.8066, lng: 35.1868 },
    locationHint: 'Trail section with the wooden balance logs and boulder scramble.',
    locationHintHe: 'קטע שביל עם בולים מאוזנים וסלעי טיפוס.',
    qrCode: 'QR-GREEN-019', difficulty: 6, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 20, isActive: true,
  },

  // ─── Zone E: Near Bible Park gate (lat 31.807–31.808) ─────────────────────
  {
    id: 'task-green-020',
    title: 'Team Flag Formation',
    titleHe: 'פורמציית דגל הצוות',
    description: 'Using your bodies, form the shape of the Israeli flag as seen from above — capture the photo from the elevated platform.',
    descriptionHe: 'בעזרת גופכם, צרו את צורת דגל ישראל מבט מלמעלה — צלמו מהפלטפורמה הגבוהה.',
    type: 'green', coordinates: { lat: 31.8069, lng: 35.1874 },
    locationHint: 'Elevated wooden viewing platform with the blue-and-white post.',
    locationHintHe: 'פלטפורמת תצפית עץ עם עמוד כחול-לבן.',
    qrCode: 'QR-GREEN-020', difficulty: 3, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 12, isActive: true,
    smart: photoUpload({
      instructions: 'Take the overhead photo from the elevated platform showing your whole team forming the Star of David and flag stripe shapes. Upload it for review.',
      instructionsHe: 'צלמו מלמעלה מהפלטפורמה הגבוהה את כל הצוות שמרכיב את מגן דוד ופסי הדגל. העלו לאישור.',
    }),
  },
  {
    id: 'task-green-021',
    title: 'Valley Water Survey',
    titleHe: 'מדידת מקורות מים בבקעה',
    description: 'Using the test kits at the station, measure pH and turbidity of 3 water samples from marked sources. Record on the survey sheet; station code is on the results seal.',
    descriptionHe: 'בעזרת ערכות הבדיקה, מדדו pH ועכירות של 3 דגימות מים. תעדו על גיליון; קוד תחנה על חותמת התוצאות.',
    type: 'green', coordinates: { lat: 31.8072, lng: 35.1880 },
    locationHint: 'Blue survey post beside the spring outlet pipe.',
    locationHintHe: 'עמוד סקר כחול ליד צינור מוצא הינבוע.',
    qrCode: 'QR-GREEN-021', difficulty: 5, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 17, isActive: true,
    smart: codeVerify({
      label: 'Results seal code',
      labelHe: 'קוד חותמת תוצאות',
      instructions: 'Fill in all three test rows on the survey sheet, then seal it. The 6-letter code is printed under the seal flap.',
      instructionsHe: 'מלאו את שלושת שורות הבדיקה, ואז אטמו. הקוד בן 6 האותיות מודפס מתחת ללשונית האיטום.',
      geofence: 80, lat: 31.8072, lng: 35.1880,
    }),
  },
  {
    id: 'task-green-022',
    title: 'Ancient Trade Route Puzzle',
    titleHe: 'פאזל דרך הסחר העתיקה',
    description: '14-piece jigsaw of an ancient trade route map — the team must assemble it and identify the 3 marked waypoints correctly.',
    descriptionHe: 'פאזל 14 חלקים של מפת דרך סחר עתיקה — הצוות צריך להרכיב ולזהות 3 נקודות ציון מסומנות.',
    type: 'green', coordinates: { lat: 31.8075, lng: 35.1885 },
    locationHint: 'Covered map table with the puzzle drawer.',
    locationHintHe: 'שולחן מפה מקורה עם מגירת פאזל.',
    qrCode: 'QR-GREEN-022', difficulty: 5, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 16, isActive: true,
  },
  {
    id: 'task-green-023',
    title: 'Team Olive Press Relay',
    titleHe: 'ריצת בית הבד',
    description: 'Pass the olive-press beam from start to finish — each team member takes one segment of the beam and must coordinate to carry it together without dropping it.',
    descriptionHe: 'העבירו את קורת בית הבד מהתחלה לסיום — כל חבר לוקח קטע אחד ויש לתאם נשיאה ביחד ללא נפילה.',
    type: 'green', coordinates: { lat: 31.8077, lng: 35.1888 },
    locationHint: 'Wooden-beam relay lane with the stone-weight start post.',
    locationHintHe: 'מסלול קורות עץ עם עמוד משקל אבן בהתחלה.',
    qrCode: 'QR-GREEN-023', difficulty: 5, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 18, isActive: true,
  },
  {
    id: 'task-green-024',
    title: 'Forest Canopy Inventory',
    titleHe: 'מלאי חופת היער',
    description: 'Count and identify all tree species in the marked 20×20m canopy plot. A station judge approves your species list before you may proceed.',
    descriptionHe: 'ספרו וזהו את כל מיני העצים בחלקה המסומנת 20×20 מ\'. שופט תחנה מאשר את רשימת המינים.',
    type: 'green', coordinates: { lat: 31.8079, lng: 35.1891 },
    locationHint: 'Four-corner rope plot with the species-ID board.',
    locationHintHe: 'חלקה מחבל ארבע פינות עם לוח זיהוי מינים.',
    qrCode: 'QR-GREEN-024', difficulty: 4, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: false, pointValue: 100, estimatedMinutes: 15, isActive: true,
    smart: manualJudge({
      instructions: 'Complete your species inventory on the sheet provided, then hand it to the station judge for approval. They will release you when satisfied.',
      instructionsHe: 'מלאו את מלאי המינים על הגיליון ומסרו אותו לשופט התחנה לאישור. הם ישחררו אתכם לאחר הבדיקה.',
    }),
  },
  {
    id: 'task-green-025',
    title: 'Final Ascent March',
    titleHe: 'מצעד העלייה הסופית',
    description: 'Hike the final steep section as a unit — all members must stay within 3 metres of each other at all times. Photo finish at the gate.',
    descriptionHe: 'טיילו את הקטע התלול האחרון כיחידה — כל החברים חייבים לשמור על מרחק של 3 מ\' זה מזה. תמונת סיום בשער.',
    type: 'green', coordinates: { lat: 31.8081, lng: 35.1893 },
    locationHint: 'Final trail switchback before the Bible Park gate.',
    locationHintHe: 'סיבוב שביל אחרון לפני שער פארק התנ"ך.',
    qrCode: 'QR-GREEN-025', difficulty: 6, maxConcurrentTeams: 4, currentTeamCount: 0,
    photoRequired: true, pointValue: 100, estimatedMinutes: 18, isActive: true,
  },

  // ══ ORANGE — Find the Tene (1 stage, 3 basket zones) ═══════════════════════
  {
    id: 'task-orange-001',
    title: 'Find Your Tene in the Bible Park',
    titleHe: 'מצאו את הטנא בפארק התנ"ך',
    description:
      'Navigate to the Bible Park using the in-app map and riddle clues. Find and retrieve your team\'s Tene (wicker basket) hidden in your assigned zone.',
    descriptionHe:
      'נווטו לפארק התנ"ך בעזרת המפה ורמזי החידה. מצאו ואחזרו את הטנא (סל נצרים) של הצוות מהאזור שהוקצה לכם.',
    type: 'orange', coordinates: { lat: 31.808361, lng: 35.191167 },
    locationHint: 'Park entrance faces the Israel Museum. Ask for the olive tree grove.',
    locationHintHe: 'כניסת הפארק פונה למוזיאון ישראל. שאלו על חורשת עצי הזית.',
    qrCode: 'QR-ORANGE-001', difficulty: 6, maxConcurrentTeams: 6, currentTeamCount: 0,
    photoRequired: true, pointValue: 150, estimatedMinutes: 30, isActive: true,
  },

  // ══ GOLD CREATION STATIONS (15) — clustered at Gan HaKipod ════════════════
  // Each team is routed to one of these for the Tene-fill crafting session.
  {
    id: 'task-gold-001',
    title: 'Ancient Grape Press',
    titleHe: 'גת עתיקה — סחיטת ענבים',
    description: 'Use the replica ancient grape press to squeeze fresh juice. Fill and seal the clay flask provided for your Tene.',
    descriptionHe: 'השתמשו בגת עתיקה לסחיטת מיץ ענבים טרי. מלאו ואטמו את הכלי החרס שסופק לטנא שלכם.',
    type: 'gold', coordinates: { lat: 31.808885, lng: 35.193833 },
    locationHint: 'Near the agricultural stations — look for the stone press.',
    locationHintHe: 'ליד תחנות החקלאות — חפשו את בית הבד.',
    qrCode: 'QR-GOLD-001', difficulty: 7, maxConcurrentTeams: 2, currentTeamCount: 1,
    photoRequired: true, pointValue: 200, estimatedMinutes: 20, isActive: true,
  },
  {
    id: 'task-gold-002',
    title: 'Spice Sachet Craft',
    titleHe: 'הכנת שקיק תבלינים',
    description: 'Blend three traditional spices and sew them into a linen sachet to place in your Tene.',
    descriptionHe: 'ערבבו שלושה תבלינים מסורתיים ותפרו אותם לשקיק פשתן להכנסה לטנא.',
    type: 'gold', coordinates: { lat: 31.80857, lng: 35.19265 },
    locationHint: 'Craft tent near the park\'s southern entrance.',
    locationHintHe: 'אוהל יצירה ליד הכניסה הדרומית של הפארק.',
    qrCode: 'QR-GOLD-002', difficulty: 8, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 25, isActive: true,
  },
  {
    id: 'task-gold-003',
    title: 'Olive Oil Extraction',
    titleHe: 'כבישת שמן זית',
    description: 'Use the traditional stone press to extract olive oil. Fill the small vial provided for your Tene.',
    descriptionHe: 'השתמשו בכבש האבן המסורתי לכבישת שמן זית. מלאו את הבקבוקון שסופק לטנא.',
    type: 'gold', coordinates: { lat: 31.80890, lng: 35.19450 },
    locationHint: 'Stone press station — marked with an olive branch sign.',
    locationHintHe: 'תחנת כבש אבן — מסומנת בשלט ענף זית.',
    qrCode: 'QR-GOLD-003', difficulty: 8, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 18, isActive: true,
  },
  {
    id: 'task-gold-004',
    title: 'Clay Vessel Sculpting',
    titleHe: 'פיסול כלי חרס',
    description: 'Each team member shapes a small clay item for the Tene using the wheel or hand-building technique. Items are oven-dried and judged for form.',
    descriptionHe: 'כל חבר צוות מעצב פריט חרס קטן לטנא בגלגל הקדר או בנייה ביד. הפריטים מיובשים בתנור ונשפטים.',
    type: 'gold', coordinates: { lat: 31.80900, lng: 35.19340 },
    locationHint: 'Pottery wheel station with the orange canopy.',
    locationHintHe: 'תחנת גלגל קדר עם חופה כתומה.',
    qrCode: 'QR-GOLD-004', difficulty: 6, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 22, isActive: true,
  },
  {
    id: 'task-gold-005',
    title: 'Natural Dye Weaving',
    titleHe: 'אריגה בצבע טבעי',
    description: 'Dye a strip of linen using plant-based dye, then weave it into the Tene\'s handle as decoration.',
    descriptionHe: 'צבעו רצועת פשתן בצבע מהצומח, ואז ארגו אותה לידית הטנא כקישוט.',
    type: 'gold', coordinates: { lat: 31.80882, lng: 35.19360 },
    locationHint: 'Dyeing vats under the pine tree shade.',
    locationHintHe: 'אמבטיות צביעה בצל עצי האורן.',
    qrCode: 'QR-GOLD-005', difficulty: 7, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 20, isActive: true,
  },
  {
    id: 'task-gold-006',
    title: 'Ancient Bread Grinding',
    titleHe: 'טחינת לחם עתיקה',
    description: 'Grind wheat on the saddle quern until you produce enough flour for two small loaves. Bake on the hot stone for the judge.',
    descriptionHe: 'טחנו חיטה על ריחיים הספינה עד שמפיקים קמח ל-2 כיכרות קטנות. אפו על האבן החמה עבור השופט.',
    type: 'gold', coordinates: { lat: 31.80868, lng: 35.19375 },
    locationHint: 'Grain-processing alcove with the large grinding stone.',
    locationHintHe: 'פינת עיבוד תבואה עם אבן הטחינה הגדולה.',
    qrCode: 'QR-GOLD-006', difficulty: 5, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 20, isActive: true,
  },
  {
    id: 'task-gold-007',
    title: 'Beehive Honey Harvest',
    titleHe: 'קציר דבש מהכוורת',
    description: 'Using protective gear, extract honey from the observation hive frame. Fill the honey jar for your Tene without disturbing the bees.',
    descriptionHe: 'עם ציוד מגן, שאבו דבש ממסגרת הכוורת. מלאו את צנצנת הדבש לטנא מבלי להפריע לדבורים.',
    type: 'gold', coordinates: { lat: 31.80874, lng: 35.19390 },
    locationHint: 'Beehive station — wear the suit before approaching.',
    locationHintHe: 'תחנת כוורת — לבשו את החליפה לפני הגישה.',
    qrCode: 'QR-GOLD-007', difficulty: 9, maxConcurrentTeams: 1, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 25, isActive: true,
  },
  {
    id: 'task-gold-008',
    title: 'Pomegranate Wine Press',
    titleHe: 'גת רימונים',
    description: 'Press fresh pomegranates to produce juice, then blend with grape wine concentrate. Fill the decorative bottle for your Tene.',
    descriptionHe: 'סחטו רימונים טריים להפקת מיץ, ואז ערבבו עם תמצית יין ענבים. מלאו את הבקבוק המעוטר לטנא.',
    type: 'gold', coordinates: { lat: 31.80861, lng: 35.19315 },
    locationHint: 'Pomegranate press by the red-painted stone wall.',
    locationHintHe: 'מכבש רימונים ליד קיר האבן הצבוע אדום.',
    qrCode: 'QR-GOLD-008', difficulty: 7, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 20, isActive: true,
  },
  {
    id: 'task-gold-009',
    title: 'Wool Spinning & Dyeing',
    titleHe: 'טוויית צמר וצביעה',
    description: 'Wash, card, spin and dye a length of raw wool. Twist it into a decorative cord for your Tene.',
    descriptionHe: 'שטפו, סרקו, טוו וצבעו אורך של צמר גולמי. פיתלו לחוט קישוט עבור הטנא.',
    type: 'gold', coordinates: { lat: 31.80848, lng: 35.19328 },
    locationHint: 'Wool-craft tent with the spinning wheels and dyeing tubs.',
    locationHintHe: 'אוהל עיבוד צמר עם גלגלי טוויה ואמבטיות צביעה.',
    qrCode: 'QR-GOLD-009', difficulty: 8, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 25, isActive: true,
  },
  {
    id: 'task-gold-010',
    title: 'Leather Tooling Art',
    titleHe: 'חריטה על עור',
    description: 'Using stamps and a leather mallet, tool a decorative pattern into the leather label for your Tene.',
    descriptionHe: 'בעזרת חותמות ופטיש עור, חרטו דוגמה מעוטרת בתווית העור עבור הטנא.',
    type: 'gold', coordinates: { lat: 31.80838, lng: 35.19342 },
    locationHint: 'Leather-work bench with the tool rack.',
    locationHintHe: 'ספסל עיבוד עור עם מדף כלים.',
    qrCode: 'QR-GOLD-010', difficulty: 6, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 18, isActive: true,
  },
  {
    id: 'task-gold-011',
    title: 'Artisan Cheese Making',
    titleHe: 'הכנת גבינת אומן',
    description: 'Curdle warm milk with natural rennet, drain, press and salt a fresh cheese round for your Tene.',
    descriptionHe: 'גיבשו חלב חם עם מי גבינה טבעיים, סננו, לחצו ומלחו גבינה טרייה לטנא.',
    type: 'gold', coordinates: { lat: 31.80832, lng: 35.19356 },
    locationHint: 'Dairy station with the wooden moulds and press.',
    locationHintHe: 'תחנת מוצרי חלב עם תבניות עץ ומכבש.',
    qrCode: 'QR-GOLD-011', difficulty: 7, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 22, isActive: true,
  },
  {
    id: 'task-gold-012',
    title: 'Date Honey Processing',
    titleHe: 'עיבוד דבש תמרים',
    description: 'Soak, press and strain fresh dates to produce silan (date syrup). Bottle it and add to your Tene.',
    descriptionHe: 'השרו, סחטו וסננו תמרים טריים להכנת סילאן. בקבקו והוסיפו לטנא.',
    type: 'gold', coordinates: { lat: 31.80826, lng: 35.19370 },
    locationHint: 'Date-press alcove beside the palm tree.',
    locationHintHe: 'פינת מכבש תמרים ליד עץ התמר.',
    qrCode: 'QR-GOLD-012', difficulty: 5, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 18, isActive: true,
  },
  {
    id: 'task-gold-013',
    title: 'Reed Rope Braiding',
    titleHe: 'קליעת חבל מגומא',
    description: 'Soak, split and braid fresh papyrus reeds into a 60cm rope. Attach it to your Tene as a carrying handle.',
    descriptionHe: 'השרו, פצלו וקלעו קנים טריים מגומא לחבל 60 ס"מ. הצמידו לטנא כידית.',
    type: 'gold', coordinates: { lat: 31.80820, lng: 35.19383 },
    locationHint: 'Reed-soaking trough by the water taps.',
    locationHintHe: 'אמבת השריית קנים ליד ברזי המים.',
    qrCode: 'QR-GOLD-013', difficulty: 6, maxConcurrentTeams: 3, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 20, isActive: true,
  },
  {
    id: 'task-gold-014',
    title: 'Fig Press & Preserve',
    titleHe: 'מחץ תאנים ושימורים',
    description: 'Press dried figs into a traditional devel (fig cake) and wrap it in fig leaves. Present it to the judge for the Tene.',
    descriptionHe: 'לחצו תאנים מיובשות לדבלה מסורתית ועטפו בעלי תאנה. הציגו לשופט לטנא.',
    type: 'gold', coordinates: { lat: 31.80814, lng: 35.19397 },
    locationHint: 'Fig-processing table under the large fig tree.',
    locationHintHe: 'שולחן עיבוד תאנים מתחת לעץ התאנה הגדול.',
    qrCode: 'QR-GOLD-014', difficulty: 7, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 20, isActive: true,
  },
  {
    id: 'task-gold-015',
    title: 'Pomegranate Crown Craft',
    titleHe: 'קליעת כתר רימון',
    description: 'Braid and wire 7 pomegranates into the traditional priestly-robe crown decoration for the top of your Tene.',
    descriptionHe: 'קלעו וחברו 7 רימונים לקישוט כתר מסורתי של בגדי הכהן לראש הטנא.',
    type: 'gold', coordinates: { lat: 31.80808, lng: 35.19410 },
    locationHint: 'Crown-weaving station at the Tene finishing table.',
    locationHintHe: 'תחנת קליעת כתר ליד שולחן גמר הטנא.',
    qrCode: 'QR-GOLD-015', difficulty: 8, maxConcurrentTeams: 2, currentTeamCount: 0,
    photoRequired: true, pointValue: 200, estimatedMinutes: 22, isActive: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SMART STATION SECRETS
// Server-only (stationSecrets/{taskId}). NEVER exposed on the public task doc.
// The 3 legacy plain-station codes are retained here for back-compat with the
// existing selfVerifyStation callable.
// ═══════════════════════════════════════════════════════════════════════════════

const STATION_SECRETS: Record<string, string> = {
  // Smart stations: code_verification
  'task-green-003': 'TRIVIA',   // Bible Trivia Blitz
  'task-green-005': 'FLORA',    // Valley Flora Scavenger Hunt
  'task-green-008': 'NORTH',    // Sunrise Compass Bearing
  'task-green-010': 'KNOTS',    // Rope Knot Mastery
  'task-green-013': 'STREAM',   // Stream Crossing Strategy
  'task-green-018': 'MAGEN',    // Wilderness First Aid Drill
  'task-green-021': 'MAYIM',    // Valley Water Survey
};
// photo_upload (no secret): task-green-001, -007, -011, -015, -016, -020
// manual_judge (no secret): task-green-024

// ═══════════════════════════════════════════════════════════════════════════════
// GAME STATE BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

type SlotType = 'green' | 'gate' | 'orange' | 'gold';

const locked = (index: number, type: SlotType) =>
  ({ index, type, status: 'locked' });

const active = (index: number, type: SlotType, startedMinsAgo = 5, taskId?: string, taskTitle?: string) =>
  ({ index, type, status: 'active', startedAt: minsAgo(startedMinsAgo),
     ...(taskId    ? { taskId }    : {}),
     ...(taskTitle ? { taskTitle } : {}) });

const done = (
  index: number, type: SlotType, taskId: string, taskTitle: string, completedMinsAgo: number,
) => ({ index, type, status: 'completed', taskId, taskTitle, completedAt: minsAgo(completedMinsAgo) });

// ─── Team A — "The Rookies" — just logged in ──────────────────────────────────
const gameStateA = {
  teamId: TEAMS.A.uid, score: 0, bonusPenalty: 0, currentTaskId: 'task-green-001',
  slots: [
    active(0, 'green', 2, 'task-green-001', 'Jerusalem Landmarks Photo Hunt'),
    locked(1, 'green'), locked(2, 'green'), locked(3, 'gate'), locked(4, 'orange'), locked(5, 'gold'),
  ],
  updatedAt: now(),
};

// ─── Team B — "The Explorers" — 1 green done, slot 1 active ──────────────────
const gameStateB = {
  teamId: TEAMS.B.uid, score: 100, bonusPenalty: 0, currentTaskId: 'task-green-005',
  slots: [
    done(0, 'green', 'task-green-001', 'Jerusalem Landmarks Photo Hunt', 30),
    active(1, 'green', 12, 'task-green-005', 'Valley Flora Scavenger Hunt'),
    locked(2, 'green'), locked(3, 'gate'), locked(4, 'orange'), locked(5, 'gold'),
  ],
  updatedAt: minsAgo(12),
};

// ─── Team C — "The Basket Finders" — gold active, pending judge check-in ─────
const gameStateC = {
  teamId: TEAMS.C.uid, score: 450, bonusPenalty: 0, currentTaskId: 'task-gold-001',
  slots: [
    done(0, 'green',  'task-green-001', 'Jerusalem Landmarks Photo Hunt', 90),
    done(1, 'green',  'task-green-010', 'Rope Knot Mastery',              75),
    done(2, 'green',  'task-green-018', 'Wilderness First Aid Drill',     58),
    done(3, 'gate',   '', 'Matchmaking Duel',                             44),
    done(4, 'orange', 'task-orange-001', 'Find Your Tene in the Bible Park', 25),
    active(5, 'gold', 8, 'task-gold-001', 'Ancient Grape Press'),
  ],
  updatedAt: minsAgo(2),
};

// ─── Team D — "The Champions" — finished, all 6 slots done ────────────────────
const gameStateD = {
  teamId: TEAMS.D.uid, score: 2104, bonusPenalty: 0, currentTaskId: null,
  slots: [
    done(0, 'green',  'task-green-002', 'Blindfolded Trust Relay',        85),
    done(1, 'green',  'task-green-007', 'Arazim Bird Species Census',     70),
    done(2, 'green',  'task-green-015', 'Shepherd Song Relay',            55),
    done(3, 'gate',   '', 'Matchmaking Duel',                             43),
    done(4, 'orange', 'task-orange-001', 'Find Your Tene in the Bible Park', 30),
    done(5, 'gold',   'task-gold-003', 'Olive Oil Extraction',            22),
  ],
  updatedAt: minsAgo(5),
};

// ─── Team E — "The Eagles" — at gate, waiting for matchmaking ─────────────────
const gameStateE = {
  teamId: TEAMS.E.uid, score: 300, bonusPenalty: 0, currentTaskId: null,
  matchStatus: 'waiting',
  slots: [
    done(0, 'green', 'task-green-003', 'Bible Trivia Blitz',              88),
    done(1, 'green', 'task-green-009', 'Biblical Plant Identification',   74),
    done(2, 'green', 'task-green-013', 'Stream Crossing Strategy',        55),
    active(3, 'gate', 12),
    locked(4, 'orange'), locked(5, 'gold'),
  ],
  gateArrivedAt: minsAgo(12),
  updatedAt: minsAgo(12),
};

// ─── Team F — "The Falcons" — crafting (slot 5 active, craftingStartedAt set) ─
const gameStateF = {
  teamId: TEAMS.F.uid, score: 450, bonusPenalty: 0, currentTaskId: 'task-gold-006',
  craftingStartedAt: minsAgo(10),
  slots: [
    done(0, 'green',  'task-green-004', 'The Human Knot',                 110),
    done(1, 'green',  'task-green-011', 'Valley Echo Challenge',           92),
    done(2, 'green',  'task-green-020', 'Team Flag Formation',             74),
    done(3, 'gate',   '', 'Matchmaking Duel',                              50),
    done(4, 'orange', 'task-orange-001', 'Find Your Tene in the Bible Park', 35),
    active(5, 'gold', 10, 'task-gold-006', 'Ancient Bread Grinding'),
  ],
  updatedAt: minsAgo(10),
};

// ─── Team G — "The Guardians" — slot 2 active (smart station) ─────────────────
const gameStateG = {
  teamId: TEAMS.G.uid, score: 200, bonusPenalty: 0, currentTaskId: 'task-green-018',
  slots: [
    done(0, 'green', 'task-green-006', 'Ancient Path Waypoints',          50),
    done(1, 'green', 'task-green-014', 'Ancient Inscription Rubbing',     32),
    active(2, 'green', 8, 'task-green-018', 'Wilderness First Aid Drill'),
    locked(3, 'gate'), locked(4, 'orange'), locked(5, 'gold'),
  ],
  updatedAt: minsAgo(8),
};

// ─── Team H — "The Hawks" — lost matchmaking duel, needs to re-queue ──────────
const gameStateH = {
  teamId: TEAMS.H.uid, score: 250, bonusPenalty: 0, currentTaskId: null,
  matchStatus: 'lost',
  slots: [
    done(0, 'green', 'task-green-008', 'Sunrise Compass Bearing',         95),
    done(1, 'green', 'task-green-016', 'Rock Formation Sketch',            78),
    done(2, 'green', 'task-green-024', 'Forest Canopy Inventory',          60),
    active(3, 'gate', 20),
    locked(4, 'orange'), locked(5, 'gold'),
  ],
  gateArrivedAt: minsAgo(20),
  updatedAt: minsAgo(5),
};

// ─── Team I — "The Hunters" — orange stage active (just reached the park) ─────
const gameStateI = {
  teamId: TEAMS.I.uid, score: 350, bonusPenalty: 0, currentTaskId: 'task-orange-001',
  slots: [
    done(0, 'green',  'task-green-012', 'Desert Water Conservation',      85),
    done(1, 'green',  'task-green-019', 'Mountain Goat Obstacle Course',  68),
    done(2, 'green',  'task-green-025', 'Final Ascent March',             50),
    done(3, 'gate',   '', 'Matchmaking Duel',                             35),
    active(4, 'orange', 5, 'task-orange-001', 'Find Your Tene in the Bible Park'),
    locked(5, 'gold'),
  ],
  updatedAt: minsAgo(5),
};

// ─── Team J — "The Jackals" — just registered ─────────────────────────────────
const gameStateJ = {
  teamId: TEAMS.J.uid, score: 0, bonusPenalty: 0, currentTaskId: 'task-green-022',
  slots: [
    active(0, 'green', 3, 'task-green-022', 'Ancient Trade Route Puzzle'),
    locked(1, 'green'), locked(2, 'green'), locked(3, 'gate'), locked(4, 'orange'), locked(5, 'gold'),
  ],
  updatedAt: now(),
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK-IN DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════════

const checkInC = {
  id: 'checkin-team-c-gold-001', teamId: TEAMS.C.uid, taskId: 'task-gold-001',
  timestamp: minsAgo(3),
  photoUrl: 'https://placehold.co/600x400/1a1a2e/22c55e?text=Team+C+Grape+Press',
  status: 'pending', location: { lat: 31.808885, lng: 35.193833 },
};

const checkInD = {
  id: 'checkin-team-d-gold-003', teamId: TEAMS.D.uid, taskId: 'task-gold-003',
  timestamp: minsAgo(9),
  photoUrl: 'https://placehold.co/600x400/1a1a2e/eab308?text=Team+D+Olive+Oil',
  status: 'approved', location: { lat: 31.80890, lng: 35.19450 },
  judgeId: 'mock-judge-uid', judgeScore: 82,
  judgeNote: 'Excellent olive oil extraction. Great presentation in the Tene.',
};

// ═══════════════════════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════════════════════

async function deleteCollection(path: string): Promise<void> {
  const snap = await db.collection(path).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  console.info(`  🗑  Cleared ${snap.size} doc(s) from …/${path.split('/').slice(-1)[0]}`);
}

async function resetEmulator(): Promise<void> {
  console.info('\n🔥 Resetting emulator data...');

  await deleteCollection(pub('tasks'));
  await deleteCollection(pub('basketZones'));
  await deleteCollection(pub('raceConfig'));
  await deleteCollection(pub('events'));
  await deleteCollection(pub('leaderboard'));
  await deleteCollection(codes());
  // Runtime / transient collections
  await deleteCollection(pub('matchQueue'));
  await deleteCollection(pub('matches'));
  await deleteCollection(pub('flashMissions'));
  await deleteCollection(pub('adminAlerts'));
  await deleteCollection(pub('announcements'));
  await deleteCollection(pub('teamLocations'));
  await deleteCollection(pub('stationReviews'));
  await deleteCollection(`artifacts/${APP_ID}/auditLogs`);
  await deleteCollection(`artifacts/${APP_ID}/stationSecrets`);

  for (const uid of ALL_UIDS) {
    await deleteCollection(priv(uid, 'profile'));
    await deleteCollection(priv(uid, 'gameState'));
    await deleteCollection(priv(uid, 'checkIns'));
    await deleteCollection(priv(uid, 'assignments'));
  }

  for (const uid of ALL_UIDS) {
    try {
      await auth.deleteUser(uid);
      console.info(`  🗑  Deleted Auth user ${uid}`);
    } catch { /* didn't exist — fine */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function seedTasks(): Promise<void> {
  const batch = db.batch();
  for (const task of TASKS) {
    const withOps = { status: 'active', maxDurationMinutes: task.estimatedMinutes * 2, ...task };
    batch.set(db.doc(pubDoc('tasks', task.id)), withOps, { merge: !RESET });
  }
  await batch.commit();

  const green  = TASKS.filter((t) => t.type === 'green').length;
  const orange = TASKS.filter((t) => t.type === 'orange').length;
  const gold   = TASKS.filter((t) => t.type === 'gold').length;
  const smart  = TASKS.filter((t) => (t as Record<string,unknown>).smart).length;
  console.info(`  ✅ Tasks seeded: ${TASKS.length} total  (${green}× green [${smart} smart] | ${orange}× orange | ${gold}× gold)`);
}

async function seedSmartStations(): Promise<void> {
  const batch = db.batch();
  for (const [taskId, expectedCode] of Object.entries(STATION_SECRETS)) {
    batch.set(db.doc(secrets(taskId)), { expectedCode, updatedAt: now() }, { merge: !RESET });
  }
  await batch.commit();
  console.info(`  ✅ Station secrets seeded: ${Object.keys(STATION_SECRETS).length} entries`);
}

async function seedRaceConfig(): Promise<void> {
  await db.doc(pubDoc('raceConfig', 'current')).set({
    start:  { lat: 31.79326,  lng: 35.165684 },
    finish: { lat: 31.808885, lng: 35.193833 },
    gate:   { lat: 31.807,    lng: 35.189    },
    center: { lat: 31.8011,   lng: 35.1798   },
    zoom:   13.5,
    routeWaypoints: [
      { lat: 31.7945, lng: 35.1685 },
      { lat: 31.7970, lng: 35.1720 },
      { lat: 31.8010, lng: 35.1800 },
      { lat: 31.8030, lng: 35.1808 },
      { lat: 31.8050, lng: 35.1841 },
      { lat: 31.8072, lng: 35.1880 },
      { lat: 31.8081, lng: 35.1893 },
      { lat: 31.807,  lng: 35.189  },
      { lat: 31.808361, lng: 35.191167 },
    ],
    updatedAt: now(),
  }, { merge: !RESET });

  const zones = [
    {
      id: 'zone-a', name: 'Arazim Lookout', nameHe: 'מצפה ארזים',
      riddle: 'Where the valley opens to the hills, find your Tene by the lookout stones.',
      riddleHe: 'במקום שהעמק נפתח אל ההרים — מצאו את הטנא ליד אבני התצפית.',
      coordinates: { lat: 31.808361, lng: 35.191167 }, currentTeamCount: 0, maxTeams: 3,
    },
    {
      id: 'zone-b', name: 'Pine Grove', nameHe: 'חורשת האורנים',
      riddle: 'Under the pines on the climb to Ramot, your basket waits in the shade.',
      riddleHe: 'בין האורנים בעלייה לרמות — הסל מחכה בצל.',
      coordinates: { lat: 31.80857, lng: 35.19265 }, currentTeamCount: 0, maxTeams: 3,
    },
    {
      id: 'zone-c', name: 'Ramot Terraces', nameHe: 'טרסות רמות',
      riddle: 'High on the ancient terraces where the shepherds rested, your Tene is tucked between the lowest two stones.',
      riddleHe: 'גבוה על הטרסות העתיקות שבהן הרועים נחו — הטנא שלכם טמון בין שתי האבנות התחתונות.',
      coordinates: { lat: 31.80905, lng: 35.19430 }, currentTeamCount: 0, maxTeams: 3,
    },
  ];
  const batch = db.batch();
  for (const z of zones) batch.set(db.doc(pubDoc('basketZones', z.id)), z, { merge: !RESET });
  await batch.commit();
  console.info(`  ✅ Race config + ${zones.length} basket zones seeded  (zone-a: Arazim Lookout, zone-b: Pine Grove, zone-c: Ramot Terraces)`);
}

async function seedEvent(): Promise<void> {
  await db.doc(pubDoc('events', 'current')).set({
    id: 'current',
    name: 'Race to Tzion 2026 — Full Demo',
    nameHe: 'המירוץ לציון 2026 — דמו מלא',
    status: 'live',
    startedAt: minsAgo(120),
    settings: {
      maxTeamsPerStation:     3,
      freezeMinutesBeforeEnd: 30,
      clueHintPenaltyPoints:  50,
      clueHintLockSeconds:    60,
      stationaryAlertMinutes: 15,
    },
  }, { merge: !RESET });
  console.info(`  ✅ Event config seeded`);
}

async function seedLeaderboard(): Promise<void> {
  await db.doc(pubDoc('leaderboard', 'current')).set({
    eventId: 'current', frozen: false, updatedAt: now(),
    rankings: [
      { rank: 1,  teamId: TEAMS.D.uid, teamName: TEAMS.D.name, score: 2104, completedSlots: 6, finishedAt: minsAgo(5),  durationSeconds: 95 * 60 },
      { rank: 2,  teamId: TEAMS.F.uid, teamName: TEAMS.F.name, score: 450,  completedSlots: 5 },
      { rank: 3,  teamId: TEAMS.C.uid, teamName: TEAMS.C.name, score: 450,  completedSlots: 5 },
      { rank: 4,  teamId: TEAMS.I.uid, teamName: TEAMS.I.name, score: 350,  completedSlots: 4 },
      { rank: 5,  teamId: TEAMS.E.uid, teamName: TEAMS.E.name, score: 300,  completedSlots: 3 },
      { rank: 6,  teamId: TEAMS.H.uid, teamName: TEAMS.H.name, score: 250,  completedSlots: 3 },
      { rank: 7,  teamId: TEAMS.G.uid, teamName: TEAMS.G.name, score: 200,  completedSlots: 2 },
      { rank: 8,  teamId: TEAMS.B.uid, teamName: TEAMS.B.name, score: 100,  completedSlots: 1 },
      { rank: 9,  teamId: TEAMS.A.uid, teamName: TEAMS.A.name, score: 0,    completedSlots: 0 },
      { rank: 10, teamId: TEAMS.J.uid, teamName: TEAMS.J.name, score: 0,    completedSlots: 0 },
    ],
  }, { merge: !RESET });
  console.info(`  ✅ Leaderboard seeded  (10 teams ranked)`);
}

const ACCESS_CODES = [
  'ROOK1', 'EXPL2', 'BSKT3', 'CHMP4',
  'EAGL5', 'FALC6', 'GARD7', 'HAWK8', 'HUNT9', 'JACK0',
  // Spare codes for registration demo
  'LION01', 'BEAR02', 'WOLF03', 'DEER04', 'IBEX05',
];

async function seedAccessCodes(): Promise<void> {
  const batch = db.batch();
  for (const code of ACCESS_CODES) {
    batch.set(db.doc(codeDoc(code)), { code, claimed: false, teamId: null, status: 'unused', createdAt: now() }, { merge: !RESET });
  }
  await batch.commit();
  console.info(`  ✅ Access codes seeded: ${ACCESS_CODES.length} codes  (${ACCESS_CODES.slice(0, 10).join(', ')} + 5 spare)`);
}

async function seedAuthUsers(): Promise<void> {
  const entries = Object.values(TEAMS).map((t) => ({ uid: t.uid, name: t.name }));
  for (const { uid, name } of entries) {
    try {
      await auth.createUser({ uid, displayName: name });
      console.info(`  ✅ Auth user created: ${uid}  (${name})`);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'auth/uid-already-exists') {
        console.info(`  ⏭  Auth user already exists: ${uid} — skipped`);
      } else { throw err; }
    }
  }
}

async function seedTeam(
  team: typeof TEAMS[keyof typeof TEAMS],
  members: string[],
  status: string,
  startedMinsAgo: number,
  gameState: object,
  checkIn?: object,
  finishedMinsAgo?: number,
): Promise<void> {
  const profile = {
    id: team.uid, name: team.name, code: team.code,
    memberNames: members, status,
    createdAt: minsAgo(startedMinsAgo + 2),
    startedAt: minsAgo(startedMinsAgo),
    ...(finishedMinsAgo !== undefined ? { finishedAt: minsAgo(finishedMinsAgo) } : {}),
  };
  const batch = db.batch();
  batch.set(db.doc(prvDoc(team.uid, 'profile',   'team')),    profile,   { merge: !RESET });
  batch.set(db.doc(prvDoc(team.uid, 'gameState', 'current')), gameState, { merge: !RESET });
  if (checkIn) {
    const ci = checkIn as { id: string };
    batch.set(db.doc(prvDoc(team.uid, 'checkIns', ci.id)), checkIn, { merge: !RESET });
  }
  await batch.commit();
  console.info(`  ✅ ${team.name.padEnd(22)} code=${team.code}  status=${status}`);
}

async function seedMatchmakingData(): Promise<void> {
  // Team E is waiting in the match queue
  await db.doc(pubDoc('matchQueue', TEAMS.E.uid)).set({
    teamId: TEAMS.E.uid, teamName: TEAMS.E.name,
    status: 'waiting', queuedAt: minsAgo(12), slotIndex: 3,
  }, { merge: !RESET });
  console.info(`  ✅ Matchmaking queue seeded  (${TEAMS.E.name} waiting)`);
}

async function seedFlashMission(): Promise<void> {
  const missionId = 'flash-demo-001';
  await db.doc(pubDoc('flashMissions', missionId)).set({
    id: missionId,
    title: 'Sprint Bonus: Valley Panorama',
    titleHe: 'בונוס ספרינט: פנורמת הבקעה',
    description: 'The first 3 teams to reach the Arazim Valley viewpoint and submit a group panorama photo earn +200 bonus points!',
    descriptionHe: '3 הקבוצות הראשונות שמגיעות לתצפית בקעת ארזים ומגישות תמונת פנורמה קבוצתית — מרוויחות +200 נקודות בונוס!',
    bonusPoints: 200, expiresAt: minsAgo(-60), startsAt: minsAgo(5),
    claimedBy: [], maxClaims: 3, isActive: true, createdAt: minsAgo(5),
  }, { merge: !RESET });
  console.info(`  ✅ Flash mission seeded  (Valley Panorama, +200 pts, expires in 60 min)`);
}

async function seedAnnouncement(): Promise<void> {
  const annId = 'ann-demo-001';
  await db.doc(pubDoc('announcements', annId)).set({
    id: annId,
    message: '⚡ Reminder: The leaderboard freezes at 15:00. Sprint to finish before then!',
    messageHe: '⚡ תזכורת: לוח הניקוד קופא בשעה 15:00. מהרו לסיים לפני כן!',
    active: true, createdAt: minsAgo(10), createdBy: 'mock-admin',
  }, { merge: !RESET });
  console.info(`  ✅ Announcement seeded  (leaderboard freeze warning)`);
}

async function seedTeamLocations(): Promise<void> {
  const locations: [typeof TEAMS[keyof typeof TEAMS], number, number][] = [
    [TEAMS.A, 31.7970, 35.1720],
    [TEAMS.B, 31.7945, 35.1685],
    [TEAMS.C, 31.808885, 35.193833],
    [TEAMS.D, 31.80890, 35.19450],
    [TEAMS.E, 31.807,   35.189   ],
    [TEAMS.F, 31.808885, 35.193833],
    [TEAMS.G, 31.8062, 35.1862],
    [TEAMS.H, 31.807,  35.189  ],
    [TEAMS.I, 31.808361, 35.191167],
    [TEAMS.J, 31.8075, 35.1885],
  ];
  const batch = db.batch();
  for (const [team, lat, lng] of locations) {
    batch.set(db.doc(pubDoc('teamLocations', team.uid)), {
      teamId: team.uid, teamName: team.name,
      lat, lng, updatedAt: minsAgo(2 + Math.floor(Math.random() * 8)),
    }, { merge: !RESET });
  }
  await batch.commit();
  console.info(`  ✅ Team locations seeded  (${locations.length} pins on the heatmap)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.info('\n╔══════════════════════════════════════════════════════════╗');
  console.info('║   RushPoint — Emulator Seed Script v3.0 (Full Demo)     ║');
  console.info('╚══════════════════════════════════════════════════════════╝');
  console.info(`  App ID:     ${APP_ID}`);
  console.info(`  Project:    ${PROJECT_ID}`);
  console.info(`  Firestore:  ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.info(`  Mode:       ${RESET ? '⚠️  RESET + seed' : 'merge (idempotent)'}\n`);

  if (RESET) { await resetEmulator(); console.info(''); }

  console.info('🌱 Seeding tasks, stations & event config...');
  await seedTasks();
  await seedSmartStations();
  await seedRaceConfig();
  await seedEvent();
  await seedLeaderboard();
  await seedAccessCodes();
  await seedFlashMission();
  await seedAnnouncement();

  console.info('\n🌱 Seeding Auth users...');
  await seedAuthUsers();

  console.info('\n🌱 Seeding team profiles & game states...');
  await seedTeam(TEAMS.A, ['David Ben-Ami', 'Rachel Goldberg', 'Noam Fischer'],                              'active',   2,   gameStateA);
  await seedTeam(TEAMS.B, ['Tamar Shapiro', 'Yonatan Mizrahi', 'Liora Cohen', 'Eitan Peretz'],              'active',   45,  gameStateB);
  await seedTeam(TEAMS.C, ['Shira Levi', 'Avi Katz', 'Maya Friedman', 'Roi Ben-David', 'Noa Stern'],       'park',     100, gameStateC, checkInC);
  await seedTeam(TEAMS.D, ['Uri Avraham', 'Yael Cohen', 'Gal Levy', 'Nir Greenberg'],                      'finished', 95,  gameStateD, checkInD, 5);
  await seedTeam(TEAMS.E, ['Lior Katz', 'Dana Shapiro', 'Amit Peretz', 'Hila Mizrahi'],                    'active',   60,  gameStateE);
  await seedTeam(TEAMS.F, ['Yuval Stern', 'Tamar Levi', 'Ben Cohen', 'Or Avraham', 'Merav Goldberg'],      'crafting', 115, gameStateF);
  await seedTeam(TEAMS.G, ['Ido Fischer', 'Shani Katz', 'Natan Ben-David'],                                'active',   55,  gameStateG);
  await seedTeam(TEAMS.H, ['Roni Greenberg', 'Tal Shapiro', 'Yam Mizrahi', 'Gali Cohen'],                  'active',   100, gameStateH);
  await seedTeam(TEAMS.I, ['Dror Levi', 'Yifat Peretz', 'Ariel Stern', 'Naama Avraham'],                  'park',     90,  gameStateI);
  await seedTeam(TEAMS.J, ['Ofir Cohen', 'Shira Ben-Ami'],                                                 'active',   5,   gameStateJ);

  console.info('\n🌱 Seeding matchmaking, locations & live data...');
  await seedMatchmakingData();
  await seedTeamLocations();

  console.info('\n╔══════════════════════════════════════════════════════════╗');
  console.info('║  ✅  Seed complete!                                      ║');
  console.info('╚══════════════════════════════════════════════════════════╝');
  console.info(`\n  Firestore UI  → http://localhost:4000/firestore`);
  console.info(`  Path root     → artifacts/${APP_ID}/\n`);
  console.info('  Tasks seeded:');
  console.info(`    25× green field stations  (8 smart: code-verify, photo, manual-judge)`);
  console.info(`     1× orange "find the Tene"  |  15× gold creation stations`);
  console.info(`     3 basket zones: zone-a (Arazim Lookout) · zone-b (Pine Grove) · zone-c (Ramot Terraces)\n`);
  console.info('  Teams seeded (10 scenarios):');
  console.info(`    ${TEAMS.A.code}  ${TEAMS.A.name.padEnd(22)} → slot 0 active, 0 pts`);
  console.info(`    ${TEAMS.B.code}  ${TEAMS.B.name.padEnd(22)} → slot 1 active (smart station), 100 pts`);
  console.info(`    ${TEAMS.C.code}  ${TEAMS.C.name.padEnd(22)} → gold active, PENDING judge check-in, 450 pts`);
  console.info(`    ${TEAMS.D.code}  ${TEAMS.D.name.padEnd(22)} → finished, judge scored (82), 2104 pts`);
  console.info(`    ${TEAMS.E.code}  ${TEAMS.E.name.padEnd(22)} → at gate, WAITING matchmaking, 300 pts`);
  console.info(`    ${TEAMS.F.code}  ${TEAMS.F.name.padEnd(22)} → crafting timer active (10 min in), 450 pts`);
  console.info(`    ${TEAMS.G.code}  ${TEAMS.G.name.padEnd(22)} → slot 2 active (smart station), 200 pts`);
  console.info(`    ${TEAMS.H.code}  ${TEAMS.H.name.padEnd(22)} → LOST duel, re-queue pending, 250 pts`);
  console.info(`    ${TEAMS.I.code}  ${TEAMS.I.name.padEnd(22)} → orange stage active (just entered park), 350 pts`);
  console.info(`    ${TEAMS.J.code}  ${TEAMS.J.name.padEnd(22)} → just registered, slot 0 active, 0 pts\n`);
  console.info('  Unclaimed access codes (for registration demo):');
  console.info(`    LION01  BEAR02  WOLF03  DEER04  IBEX05\n`);
  console.info('  Live features active:');
  console.info(`    ⚡ Flash mission: "Valley Panorama" (+200 pts, first 3 teams)`);
  console.info(`    📢 Announcement: leaderboard freeze warning at 15:00`);
  console.info(`    🗺  Heatmap: ${Object.keys(TEAMS).length} team location pins`);
  console.info(`    ⚔️  Matchmaking: The Eagles waiting in queue`);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
