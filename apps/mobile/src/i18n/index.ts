import { create } from 'zustand';

// ── Supported languages ───────────────────────────────────────────────────────
export type Lang = 'en' | 'he';
const STORAGE_KEY = 'rushpoint.mobile.lang';

type Dict = Record<string, string>;

// ── Translation dictionaries ───────────────────────────────────────────────────
const en: Dict = {
  // Branding / access-code
  'brand.tagline': 'הַמִּרוּץ לְצִיּוֹן',
  'access.intro': 'Enter your event access code to begin the race.',
  'access.codeLabel': 'Access Code',
  'access.codePlaceholder': 'e.g. LION01',
  'access.enter': 'Enter Event →',
  'access.codeRequired': 'Please enter your access code.',
  'access.connError': 'Connection error — try again',
  'access.invalidCode': 'Invalid access code',

  // Register
  'register.codeLabel': 'Code: {code}',
  'register.title': 'Register Your Team',
  'register.subtitle': 'Fill in the details below to begin the race.',
  'register.teamName': 'Team Name',
  'register.teamNamePlaceholder': 'e.g. The Lions',
  'register.captainPhone': "Captain's Phone Number",
  'register.phonePlaceholder': '+972 50 000 0000',
  'register.participants': 'Participants',
  'register.namePlaceholder': 'Name {n}',
  'register.age': 'Age',
  'register.teamSizeHint': 'Teams must have {min}–{max} members.',
  'register.addParticipant': '+ Add Participant',
  'register.waiverTitle': 'Liability & Health Waiver',
  'register.waiverBody':
    'I confirm all participants are in good health and fit to participate in this physical outdoor activity. I release the organizers from any liability for personal injuries or accidents during the event.',
  'register.waiverAccept': 'I have read and accept the full waiver and terms',
  'register.waiverReadFull': 'Read the full waiver & terms →',
  'register.start': 'Start the Race →',

  // Full waiver / onboarding document (app/waiver.tsx)
  'waiver.docTitle': 'Participation Waiver & Terms',
  'waiver.lastUpdated': 'Version {v} · Last updated {date}',
  'waiver.placeholderNotice':
    '⚠️ TEMPLATE — this is placeholder text. Replace every section with wording approved by the event organizer’s legal counsel before the live event.',
  'waiver.s1Title': '1. Assumption of Risk',
  'waiver.s1Body':
    'The Race to Tzion is a physical outdoor activity that takes place across open terrain in and around Jerusalem. Participation involves walking, navigating, and physical effort over uneven ground and in variable weather. I understand these risks and choose to participate voluntarily.',
  'waiver.s2Title': '2. Health Declaration',
  'waiver.s2Body':
    'I confirm that every member of my team is in good general health and medically fit for sustained physical activity. We will stop and seek help if any participant feels unwell, and we accept responsibility for managing any pre-existing medical conditions during the event.',
  'waiver.s3Title': '3. Release of Liability',
  'waiver.s3Body':
    'To the fullest extent permitted by law, I release the organizers, volunteers, and partners from liability for personal injury, loss, or property damage arising from ordinary participation, except where caused by gross negligence or willful misconduct.',
  'waiver.s4Title': '4. Conduct & Safety',
  'waiver.s4Body':
    'We will follow all instructions from organizers and station staff, obey traffic and park rules, respect other participants and the public, and respond immediately to any safety or evacuation instruction sent through the app.',
  'waiver.s5Title': '5. Media Release',
  'waiver.s5Body':
    'I grant the organizer permission to capture and use photos and video taken during the event for documentation and promotion. Contact the organizer if any participant must be excluded from media use.',
  'waiver.s6Title': '6. Data & Privacy',
  'waiver.s6Body':
    'During the event the app records team progress and approximate live location to operate the race, run the leaderboard, and respond to emergencies. Location is collected only while the app is in use. See the organizer’s privacy notice for retention and contact details.',
  'waiver.s7Title': '7. Minors & Guardian Consent',
  'waiver.s7Body':
    'For participants under 18, the team captain confirms that a parent or legal guardian has consented to their participation under these terms.',
  'waiver.back': 'Back to registration',
  'register.errTeamName': 'Team name is required.',
  'register.errPhone': "Captain's phone number is required.",
  'register.errParticipants': 'Add at least one participant name.',
  'register.errMinParticipants': 'A team needs at least {min} participants.',
  'register.errMaxParticipants': 'A team can have at most {max} participants.',
  'register.errWaiver': 'You must accept the waiver to continue.',
  'register.errSubmit': 'Registration failed — check your connection and try again.',
  // Server-mapped registration errors (keyed off the HttpsError code)
  'register.errCodeInvalid': "That access code isn't valid. Re-check the code on your card and try again.",
  'register.errCodeClaimed': 'This access code has already been used by another team. Ask a judge for help.',
  'register.errInvalidInput': 'Some team details are missing or invalid. Check the name, phone and participants, then try again.',
  'register.errWaiverRequired': 'The liability waiver must be accepted to register. Please accept it and try again.',
  'register.errAuth': 'Your session expired. Reload the app and try again.',

  // Dashboard
  'dash.team': 'Team',
  'dash.score': 'Score',
  'dash.pts': 'pts',
  'dash.penalty': 'penalty',
  'dash.slotsCompleted': '{n} of 6 stages completed',
  'dash.currentMission': 'Current Mission',
  'dash.loadError': 'Could not load game state. Check your connection.',
  'dash.noMission': 'No active mission — check with your game master.',
  'dash.raceProgress': 'Race Progress',
  'dash.activeMission': 'Active Mission',
  'dash.taskLabel': 'Task: {id}',
  'dash.assigning': 'Your task is being assigned. Stand by.',
  'dash.hint.greenTask': 'Head to the station and check in with the operator',
  'dash.hint.greenAssigning': 'Your next mission is being assigned — stand by',
  'dash.hint.orange': 'Use the riddle to find your basket zone, then have the volunteer start your clock',
  'dash.hint.goldCrafting': 'Fill your Tene from the menu — tap Go to Judge when ready',
  'dash.hint.goldFrozen': 'Arrival recorded — wait near the judging table, a judge will call you shortly',
  'dash.hint.gate': 'Go to the gate area and wait for your opponent',
  'dash.noMission.done': 'All stages complete — head to the finish line!',
  'dash.noMission.waiting': 'Waiting for stage assignment — stay close to your team',
  'dash.timeFrozen': 'Time frozen',
  'dash.elapsed': 'Elapsed',
  'dash.beingJudged': 'Being judged',
  'slot.green': 'Open Field Mission',
  'slot.greenN': 'Field Mission {n}',
  'slot.gate': 'Matchmaking Duel',
  'slot.orange': 'Find the Tene',
  'slot.gold': 'Craft & Judge',

  // Stage tracker status chips
  'stage.done': 'Done',
  'stage.current': 'Now',
  'stage.locked': 'Locked',
  'stage.skipped': 'Skipped',

  // Judge check-in (team requests grading)
  'checkin.arrived': "I've arrived at the judge",
  'checkin.requested': 'The judge has been notified.',
  'checkin.waiting': 'Waiting for the judge…',
  'checkin.error': 'Could not notify the judge. Try again.',
  'checkin.basketTitle': 'Tene Basket — Final Judging',

  // Evacuation (force-majeure station closure)
  'evac.moved': 'Management moved you off "{station}". Await your next assignment.',

  // Connectivity
  'offline.lost': "You're offline — progress is saved and will sync when you reconnect.",
  'offline.restored': 'Back online — syncing your progress.',
  'offline.reconnecting': 'Reconnecting…',
  'offline.backOnline': 'Back online',

  // Map
  'map.open': 'Mission Map',
  'map.title': 'Mission Map',
  'map.subtitle': 'Station locations across the Jerusalem course.',
  'map.back': '← Back',
  'map.youAreHere': 'The blue dot is your live location.',
  'map.offMap': "You're outside the race area",

  // Gate sprint (orange slot)
  'gate.title': 'Race to Bible Park!',
  'gate.subtitle': 'Target: {target} min transit. Clock is running.',
  'gate.elapsed': 'Transit time',
  'gate.warning': '⚠️ Late — penalty will apply',
  'gate.arrived': 'Check in at gate →',
  'gate.penalty': 'Transit penalty: {pts} pts',

  // Matchmaking
  'match.title': 'Gate Match',
  'match.waiting': 'Scanning for an opponent…',
  'match.matched': 'Matched vs {opponent}!',
  'match.matchedShort': 'Opponent found — duel on!',
  'match.rival': 'Rival',
  'match.won': '🏆 You won! +{bonus} pts',
  'match.lost': '😤 You lost — {delay}s delay',
  'match.lostTitle': '😤 You lost this duel',
  'match.rematchWaiting': 'Waiting for a new opponent — only the winner advances.',
  'match.cooldown': 'Cooldown before your rematch — you’ll rejoin the queue automatically.',
  'match.soloClear': '✅ Last team at the gate — you advance automatically!',
  'match.bypassed': 'No match — proceed to basket.',
  'match.mustDuel': 'You must win a duel to advance. Enter the queue when ready.',
  'match.joinQueue': 'Enter Match Queue',

  // Basket zone
  'basket.title': 'Find Your Basket',
  'basket.riddleLabel': 'Your riddle:',
  'basket.zone': 'Zone: {name}',
  'basket.scanPrompt': 'Find it using the riddle — the Tene volunteer starts your clock.',
  'basket.waitTitle': 'Waiting for the Tene volunteer',
  'basket.waitBody': 'Go to the spot in the riddle. When the Tene-warehouse volunteer hands you the basket and confirms, your 20-minute clock starts automatically — you don\'t start it yourself.',
  'basket.delay': 'Match penalty — wait {sec}s',

  // Crafting countdown
  'craft.title': 'Decorate Your Basket!',
  'craft.timeLeft': 'Time left',
  'craft.expired': 'Time\'s up — sprint to the judge!',
  'craft.sprintWindow': 'Sprint window',
  'craft.sprintLeft': '{sec}s to reach the judge',
  'craft.sprintExpired': 'Late — exponential penalty accumulating!',
  'craft.paused': 'Clock paused',
  'craft.waitingJudge': 'Arrival recorded — waiting for a judge. Your time is locked.',
  'craft.menuTitle': 'Fill your Tene',
  'craft.menuHint': 'Tap each product you prepare — the judge sees your picks.',
  'craft.minShort': 'min',
  'craft.basketLoad': 'Basket load',
  'craft.basketOver': 'Over the time budget — you may not finish all of these.',
  'craft.estTime': 'Est. time: {min} min',
  'craft.potentialPts': 'Potential: +{pts} pts',
  'craft.goToJudge': 'Go to the judge',
  'craft.goToJudgeEarly': 'Leave now and you keep your remaining time + 90s to reach the judging queue.',
  'craft.goToJudgeLate': 'Sprint! Only {sec}s left to reach the judging queue.',

  // Flash mission
  'flash.label': 'FLASH MISSION',
  'flash.bonus': '+{bonus} pts',
  'flash.expiresIn': 'Ends in {sec}s',
  'flash.dismiss': 'Got it',

  // Call staff (emergency / technical)
  'staff.open': 'Call staff',
  'staff.title': 'Call Staff',
  'staff.subtitle': 'Choose the type of help you need. Staff get your location, team roster and captain phone.',
  'staff.emergency': 'Emergency',
  'staff.emergencyDesc': 'Injury or danger — raises a loud alert for staff.',
  'staff.holdHint': 'Press & HOLD to send an emergency alert',
  'staff.technical': 'Technical issue',
  'staff.technicalDesc': 'Equipment or logistics — staff will come help.',
  'staff.sending': 'Calling staff…',
  'staff.sent': 'Staff notified.',
  'staff.sentEmergency': 'Emergency alert sent — help is on the way.',
  'staff.sentTechnical': 'Request sent — staff will assist shortly.',
  'staff.staySafe': 'Stay where you are. Staff have been notified.',
  'staff.error': 'Could not reach staff. Try again.',

  // SOS (legacy keys, retained)
  'sos.open': 'SOS',
  'sos.title': 'Emergency',
  'sos.subtitle': 'Send an alert to the event staff. Only use this in a real emergency.',
  'sos.tapToArm': 'Tap to\nrequest help',
  'sos.confirmPrompt': 'Are you sure? This alerts the staff immediately.',
  'sos.sendNow': 'SEND SOS',
  'sos.cancel': 'Cancel',
  'sos.sending': 'Sending alert…',
  'sos.sent': 'Alert sent — help is on the way.',
  'sos.confirmed': 'Help requested',
  'sos.staySafe': 'Stay where you are. Staff have been notified.',
  'sos.error': 'Could not send alert. Try again.',

  // Clue hint
  'hint.ask': 'Need a hint?',
  'hint.cost': '−50 pts',
  'hint.confirm': 'Use hint (−50)',
  'hint.cancel': 'Cancel',
  'hint.applied': 'Hint unlocked — 50 pts deducted.',
  'hint.error': 'Could not request a hint.',

  // Final run
  'final.label': 'FINISHED',
  'final.title': 'Race Complete!',
  'final.finalScore': 'Your final score',
  'final.awaitReveal': 'Results are revealed live at the finish line — last place to first. Good luck!',
  'final.backToDash': 'Back to dashboard',
  'final.viewSummary': '✨ See your race summary',

  // Wrapped / event summary (app/wrapped.tsx)
  'wrapped.label': 'RACE WRAPPED',
  'wrapped.title': 'Your Race',
  'wrapped.finalScore': 'Final score',
  'wrapped.totalTime': 'Total time',
  'wrapped.stagesDone': 'Stages done',
  'wrapped.teneItems': 'Tene items',
  'wrapped.fastest': 'Fastest stage',
  'wrapped.breakdown': 'Stage by stage',
  'wrapped.notDone': 'not done',
  'wrapped.back': 'Back',

  // Staged start (dashboard standby + countdown)
  'launch.waitTitle': 'Get ready to race',
  'launch.waitBody': 'You\'re registered! Wait for the start signal — the organizers will launch your team, and your first mission appears right after a short countdown.',
  'launch.getReady': 'GET READY',
  'launch.countdownHint': 'Your first mission is moments away…',

  // Smart station (mobile play screen)
  'station.open': 'Open Station',
  'station.openHint': 'This stop has special instructions — tap to begin.',
  'station.title': 'Smart Station',
  'station.loading': 'Loading station…',
  'station.noConfig': 'This station has no interactive task right now.',
  'station.start': 'Start →',
  'station.extraInfoLabel': 'Good to know',
  'station.viewMedia': 'Open media / video →',
  'station.codeTitle': 'Enter the code',
  'station.codeDefaultLabel': 'Enter code',
  'station.codePlaceholder': 'Type the code…',
  'station.submit': 'Submit',
  'station.checking': 'Checking…',
  'station.attemptsLeft': '{n} attempts left',
  'station.noAttempts': 'No attempts remaining.',
  'station.wrongCode': 'That code is not correct.',
  'station.codeError': 'Could not submit the code. Check your connection.',
  'station.tooManyAttempts': 'Too many wrong attempts — wait 60s.',
  'station.tryAgainIn': 'Try again in {seconds}s',
  'station.photoTitle': 'Upload a photo',
  'station.photoIntro': 'Take or choose a photo as proof — a judge will review it.',
  'station.choosePhoto': '📷 Take / choose photo',
  'station.retakePhoto': '🔄 Choose a different photo',
  'station.uploading': 'Uploading…',
  'station.submitForReview': 'Submit for review',
  'station.photoNeeded': 'Please add a photo first.',
  'station.uploadError': 'Upload failed. Try again.',
  'station.permissionDenied': 'Photo permission is required to continue.',
  'station.manualTitle': 'Call the judge',
  'station.manualIntro': 'When your team is ready, mark yourselves ready and a judge will come to verify.',
  'station.markReady': '✋ Call judge / Mark ready',
  'station.reviewError': 'Could not submit. Check your connection.',
  'station.successTitle': 'Station complete!',
  'station.successBody': 'Great work — you have advanced to the next stage.',
  'station.successBack': 'Back to dashboard →',
  'station.failTitle': 'Not quite',
  'station.failBody': 'That attempt did not pass. Try again.',
  'station.retry': 'Try again',
  'station.pendingTitle': 'Awaiting review',
  'station.pendingBody': 'A judge is reviewing your submission. Your dashboard will update automatically when it is approved.',
  'station.pendingBack': 'Back to dashboard',
};

const he: Dict = {
  // Branding / access-code
  'brand.tagline': 'הַמִּרוּץ לְצִיּוֹן',
  'access.intro': 'הזינו את קוד הגישה לאירוע כדי להתחיל את המירוץ.',
  'access.codeLabel': 'קוד גישה',
  'access.codePlaceholder': 'לדוגמה: LION01',
  'access.enter': 'כניסה לאירוע →',
  'access.codeRequired': 'אנא הזינו את קוד הגישה שלכם.',
  'access.connError': 'שגיאת חיבור — נסו שוב',
  'access.invalidCode': 'קוד גישה שגוי',

  // Register
  'register.codeLabel': 'קוד: {code}',
  'register.title': 'רישום הקבוצה',
  'register.subtitle': 'מלאו את הפרטים למטה כדי להתחיל את המירוץ.',
  'register.teamName': 'שם הקבוצה',
  'register.teamNamePlaceholder': 'לדוגמה: האריות',
  'register.captainPhone': 'מספר הטלפון של הקפטן',
  'register.phonePlaceholder': '050-000-0000',
  'register.participants': 'משתתפים',
  'register.namePlaceholder': 'שם {n}',
  'register.age': 'גיל',
  'register.teamSizeHint': 'בקבוצה חייבים להיות {min}–{max} חברים.',
  'register.addParticipant': '+ הוספת משתתף',
  'register.waiverTitle': 'הצהרת בריאות ואחריות',
  'register.waiverBody':
    'אני מאשר/ת שכל המשתתפים בריאים וכשירים להשתתף בפעילות גופנית חיצונית זו. אני משחרר/ת את המארגנים מכל אחריות לפציעות אישיות או תאונות במהלך האירוע.',
  'register.waiverAccept': 'קראתי ואני מקבל/ת את ההצהרה והתקנון המלאים',
  'register.waiverReadFull': 'קראו את ההצהרה והתקנון המלאים →',
  'register.start': 'התחלת המירוץ →',

  // Full waiver / onboarding document (app/waiver.tsx)
  'waiver.docTitle': 'הצהרת השתתפות ותקנון',
  'waiver.lastUpdated': 'גרסה {v} · עודכן לאחרונה {date}',
  'waiver.placeholderNotice':
    '⚠️ תבנית — זהו טקסט ממלא מקום. החליפו כל סעיף בנוסח שאושר על ידי היועץ המשפטי של מארגן האירוע לפני האירוע עצמו.',
  'waiver.s1Title': '1. נטילת סיכון',
  'waiver.s1Body':
    'המירוץ לציון הוא פעילות גופנית חיצונית המתקיימת בשטח פתוח בירושלים וסביבתה. ההשתתפות כוללת הליכה, ניווט ומאמץ גופני בשטח לא אחיד ובמזג אוויר משתנה. אני מבין/ה את הסיכונים ובוחר/ת להשתתף מרצוני החופשי.',
  'waiver.s2Title': '2. הצהרת בריאות',
  'waiver.s2Body':
    'אני מאשר/ת שכל חברי הקבוצה בריאים וכשירים מבחינה רפואית לפעילות גופנית ממושכת. נעצור ונפנה לעזרה אם מי מהמשתתפים יחוש ברע, ואנו אחראים לניהול כל מצב רפואי קיים במהלך האירוע.',
  'waiver.s3Title': '3. שחרור מאחריות',
  'waiver.s3Body':
    'במידה המרבית המותרת בחוק, אני משחרר/ת את המארגנים, המתנדבים והשותפים מאחריות לפציעה אישית, אובדן או נזק לרכוש הנובעים מהשתתפות רגילה, למעט במקרים של רשלנות חמורה או מעשה מכוון.',
  'waiver.s4Title': '4. התנהגות ובטיחות',
  'waiver.s4Body':
    'נפעל לפי כל הנחיות המארגנים וצוות התחנות, נציית לחוקי התנועה והפארק, נכבד משתתפים אחרים ואת הציבור, ונגיב מיד לכל הנחיית בטיחות או פינוי שתישלח דרך האפליקציה.',
  'waiver.s5Title': '5. שימוש בתמונות ובווידאו',
  'waiver.s5Body':
    'אני מעניק/ה למארגן רשות לצלם ולהשתמש בתמונות ובווידאו שצולמו במהלך האירוע לצורכי תיעוד וקידום. פנו למארגן אם יש להחריג משתתף כלשהו משימוש בתקשורת.',
  'waiver.s6Title': '6. נתונים ופרטיות',
  'waiver.s6Body':
    'במהלך האירוע האפליקציה רושמת את התקדמות הקבוצה ומיקום חי משוער כדי להפעיל את המירוץ, את טבלת המובילים ולהגיב למקרי חירום. המיקום נאסף רק בזמן שימוש באפליקציה. ראו את הודעת הפרטיות של המארגן לפרטי שמירה ויצירת קשר.',
  'waiver.s7Title': '7. קטינים והסכמת אפוטרופוס',
  'waiver.s7Body':
    'עבור משתתפים מתחת לגיל 18, קפטן הקבוצה מאשר שהורה או אפוטרופוס חוקי נתן הסכמה להשתתפותם בכפוף לתנאים אלה.',
  'waiver.back': 'חזרה לרישום',
  'register.errTeamName': 'שם הקבוצה הוא שדה חובה.',
  'register.errPhone': 'מספר הטלפון של הקפטן הוא שדה חובה.',
  'register.errParticipants': 'הוסיפו לפחות שם משתתף אחד.',
  'register.errMinParticipants': 'בקבוצה חייבים להיות לפחות {min} משתתפים.',
  'register.errMaxParticipants': 'בקבוצה יכולים להיות עד {max} משתתפים.',
  'register.errWaiver': 'יש לאשר את ההצהרה כדי להמשיך.',
  'register.errSubmit': 'הרישום נכשל — בדקו את החיבור ונסו שוב.',
  // שגיאות רישום ממופות מהשרת (לפי קוד ה-HttpsError)
  'register.errCodeInvalid': 'קוד הגישה אינו תקין. בדקו שוב את הקוד על הכרטיס ונסו שנית.',
  'register.errCodeClaimed': 'קוד הגישה הזה כבר נוצל על ידי קבוצה אחרת. פנו לשופט לעזרה.',
  'register.errInvalidInput': 'חלק מפרטי הקבוצה חסרים או שגויים. בדקו את השם, הטלפון והמשתתפים ונסו שוב.',
  'register.errWaiverRequired': 'יש לאשר את הצהרת האחריות כדי להירשם. אשרו אותה ונסו שוב.',
  'register.errAuth': 'תוקף ההתחברות פג. טענו מחדש את האפליקציה ונסו שוב.',

  // Dashboard
  'dash.team': 'קבוצה',
  'dash.score': 'ניקוד',
  'dash.pts': 'נק׳',
  'dash.penalty': 'קנס',
  'dash.slotsCompleted': '{n} מתוך 6 שלבים הושלמו',
  'dash.currentMission': 'המשימה הנוכחית',
  'dash.loadError': 'לא ניתן לטעון את מצב המשחק. בדקו את החיבור.',
  'dash.noMission': 'אין משימה פעילה — פנו למנהל המשחק.',
  'dash.raceProgress': 'התקדמות המירוץ',
  'dash.activeMission': 'משימה פעילה',
  'dash.taskLabel': 'משימה: {id}',
  'dash.assigning': 'המשימה שלכם בהקצאה. המתינו.',
  'dash.hint.greenTask': 'גשו לתחנה וסמנו נוכחות עם המפעיל',
  'dash.hint.greenAssigning': 'המשימה הבאה מוקצית — המתינו',
  'dash.hint.orange': 'השתמשו בחידה כדי למצוא את אזור הטנא, ואז בקשו מהמתנדב להתחיל את השעון',
  'dash.hint.goldCrafting': 'מלאו את הטנא מהתפריט — הקישו על "אל השופט" כשתהיו מוכנים',
  'dash.hint.goldFrozen': 'ההגעה נרשמה — המתינו ליד שולחן השיפוט, שופט יקרא לכם בקרוב',
  'dash.hint.gate': 'גשו לאזור השער והמתינו ליריב שלכם',
  'dash.noMission.done': 'כל השלבים הושלמו — צאו לקו הסיום!',
  'dash.noMission.waiting': 'ממתינים להקצאת שלב — הישארו קרוב לקבוצה שלכם',
  'dash.timeFrozen': 'הזמן מוקפא',
  'dash.elapsed': 'זמן שחלף',
  'dash.beingJudged': 'בשיפוט',
  'slot.green': 'משימת שטח פתוח',
  'slot.greenN': 'משימת שדה {n}',
  'slot.gate': 'דו-קרב זיווג',
  'slot.orange': 'מצאו את הטנא',
  'slot.gold': 'יצירה ושיפוט',

  // Stage tracker status chips
  'stage.done': 'הושלם',
  'stage.current': 'עכשיו',
  'stage.locked': 'נעול',
  'stage.skipped': 'דולג',

  // Judge check-in (team requests grading)
  'checkin.arrived': 'הגעתי לשופט',
  'checkin.requested': 'השופט קיבל התראה.',
  'checkin.waiting': 'ממתינים לשופט…',
  'checkin.error': 'לא ניתן ליידע את השופט. נסו שוב.',
  'checkin.basketTitle': 'טנא — שיפוט סופי',

  // Evacuation (force-majeure station closure)
  'evac.moved': 'ההנהלה העבירה אתכם מ"{station}". המתינו למשימה הבאה.',

  // Connectivity
  'offline.lost': 'אין חיבור — ההתקדמות נשמרת ותסונכרן כשהחיבור יחזור.',
  'offline.restored': 'החיבור חזר — מסנכרן את ההתקדמות.',
  'offline.reconnecting': 'מתחבר מחדש…',
  'offline.backOnline': 'חזרת לרשת',

  // Map
  'map.open': 'מפת המשימות',
  'map.title': 'מפת המשימות',
  'map.subtitle': 'מיקומי העמדות לאורך מסלול ירושלים.',
  'map.back': '← חזרה',
  'map.youAreHere': 'הנקודה הכחולה היא המיקום החי שלכם.',
  'map.offMap': 'אתם מחוץ לאזור המרוץ',

  // Gate sprint (orange slot)
  'gate.title': 'רוצו לפארק התנ"ך!',
  'gate.subtitle': 'יעד: {target} דק׳ מעבר. השעון רץ.',
  'gate.elapsed': 'זמן מעבר',
  'gate.warning': '⚠️ איחור — יוחל עונש',
  'gate.arrived': 'צ׳ק-אין בשער ←',
  'gate.penalty': 'עונש מעבר: {pts} נק׳',

  // Matchmaking
  'match.title': 'דו-קרב בשער',
  'match.waiting': 'סורקים אחר יריב…',
  'match.matched': 'זווגתם מול {opponent}!',
  'match.matchedShort': 'נמצא יריב — הדו-קרב מתחיל!',
  'match.rival': 'יריב',
  'match.won': '🏆 ניצחתם! +{bonus} נק׳',
  'match.lost': '😤 הפסדתם — עיכוב {delay} שנ׳',
  'match.lostTitle': '😤 הפסדתם בדו-קרב',
  'match.rematchWaiting': 'ממתינים ליריב חדש — רק המנצח ממשיך.',
  'match.cooldown': 'המתנה לפני הדו-קרב הבא — תחזרו לתור אוטומטית.',
  'match.soloClear': '✅ הקבוצה האחרונה בשער — אתם ממשיכים אוטומטית!',
  'match.bypassed': 'אין זיווג — המשיכו לסל.',
  'match.mustDuel': 'חובה לנצח בדו-קרב כדי להתקדם. היכנסו לתור כשאתם מוכנים.',
  'match.joinQueue': 'כניסה לתור הזיווג',

  // Basket zone
  'basket.title': 'מצאו את הסל שלכם',
  'basket.riddleLabel': 'החידה שלכם:',
  'basket.zone': 'אזור: {name}',
  'basket.scanPrompt': 'מצאו אותו לפי החידה — אחראי הטנא יתחיל לכם את השעון.',
  'basket.waitTitle': 'ממתינים לאחראי הטנא',
  'basket.waitBody': 'לכו למקום שבחידה. כשאחראי מחסן הטנא ימסור לכם את הסל ויאשר שקיבלתם, טיימר ה-20 דקות יתחיל אוטומטית — אתם לא מתחילים אותו בעצמכם.',
  'basket.delay': 'עונש דו-קרב — המתינו {sec} שנ׳',

  // Crafting countdown
  'craft.title': 'קשטו את הסל!',
  'craft.timeLeft': 'זמן שנותר',
  'craft.expired': 'הזמן נגמר — רוצו לשופט!',
  'craft.sprintWindow': 'חלון ריצה',
  'craft.sprintLeft': '{sec} שנ׳ להגיע לשופט',
  'craft.paused': 'השעון מושהה',
  'craft.waitingJudge': 'ההגעה נרשמה — ממתינים לשופט. הזמן שלכם ננעל.',
  'craft.sprintExpired': 'איחור — עונש מצטבר!',
  'craft.menuTitle': 'מלאו את הטנא',
  'craft.menuHint': 'סמנו כל מוצר שהכנתם — הבחירות מוצגות לשופט.',
  'craft.minShort': 'דק׳',
  'craft.basketLoad': 'עומס הסל',
  'craft.basketOver': 'מעבר לתקציב הזמן — ייתכן שלא תספיקו את כולם.',
  'craft.estTime': 'זמן מוערך: {min} דק׳',
  'craft.potentialPts': 'פוטנציאל: +{pts} נק׳',
  'craft.goToJudge': 'ללכת לשופט',
  'craft.goToJudgeEarly': 'אם תצאו עכשיו, נשאר לכם הזמן שנותר + 90 שניות להגיע לתור השיפוט.',
  'craft.goToJudgeLate': 'ספרינט! נותרו רק {sec} שניות להגיע לתור השיפוט.',

  // Flash mission
  'flash.label': 'משימת ברק',
  'flash.bonus': '+{bonus} נק׳',
  'flash.expiresIn': 'מסתיים בעוד {sec} שנ׳',
  'flash.dismiss': 'הבנתי',

  // Call staff (emergency / technical)
  'staff.open': 'קריאה לצוות',
  'staff.title': 'קריאה לאיש צוות',
  'staff.subtitle': 'בחרו את סוג העזרה שאתם צריכים. הצוות יקבל את המיקום, רשימת החברים וטלפון הקפטן.',
  'staff.emergency': 'אירוע חירום',
  'staff.emergencyDesc': 'פציעה או סכנה — מפעיל אזעקה חזקה אצל הצוות.',
  'staff.holdHint': 'לחצו והחזיקו כדי לשלוח התראת חירום',
  'staff.technical': 'תקלה תכנית',
  'staff.technicalDesc': 'ציוד או לוגיסטיקה — איש צוות יגיע לעזור.',
  'staff.sending': 'קורא לצוות…',
  'staff.sent': 'הצוות קיבל התראה.',
  'staff.sentEmergency': 'התראת חירום נשלחה — עזרה בדרך.',
  'staff.sentTechnical': 'הבקשה נשלחה — איש צוות יסייע בקרוב.',
  'staff.staySafe': 'הישארו במקום. הצוות קיבל התראה.',
  'staff.error': 'לא ניתן ליצור קשר עם הצוות. נסו שוב.',

  // SOS (legacy keys, retained)
  'sos.open': 'מצוקה',
  'sos.title': 'חירום',
  'sos.subtitle': 'שלחו התראה לצוות האירוע. השתמשו בזה רק במצב חירום אמיתי.',
  'sos.tapToArm': 'הקישו\nלבקשת עזרה',
  'sos.confirmPrompt': 'בטוחים? פעולה זו תתריע לצוות מיד.',
  'sos.sendNow': 'שלח מצוקה',
  'sos.cancel': 'ביטול',
  'sos.sending': 'שולח התראה…',
  'sos.sent': 'ההתראה נשלחה — עזרה בדרך.',
  'sos.confirmed': 'בקשת העזרה נשלחה',
  'sos.staySafe': 'הישארו במקום. הצוות קיבל התראה.',
  'sos.error': 'לא ניתן לשלוח התראה. נסו שוב.',

  // Clue hint
  'hint.ask': 'צריכים רמז?',
  'hint.cost': '−50 נק׳',
  'hint.confirm': 'השתמש ברמז (−50)',
  'hint.cancel': 'ביטול',
  'hint.applied': 'הרמז נפתח — נוכו 50 נק׳.',
  'hint.error': 'לא ניתן לבקש רמז.',

  // Final run
  'final.label': 'הסתיים',
  'final.title': 'המירוץ הושלם!',
  'final.finalScore': 'הניקוד הסופי שלכם',
  'final.awaitReveal': 'התוצאות נחשפות בשידור חי בקו הסיום — מהמקום האחרון לראשון. בהצלחה!',
  'final.backToDash': 'חזרה ללוח',
  'final.viewSummary': '✨ צפו בסיכום המירוץ שלכם',

  // Wrapped / event summary (app/wrapped.tsx)
  'wrapped.label': 'סיכום המירוץ',
  'wrapped.title': 'המירוץ שלכם',
  'wrapped.finalScore': 'ניקוד סופי',
  'wrapped.totalTime': 'זמן כולל',
  'wrapped.stagesDone': 'שלבים הושלמו',
  'wrapped.teneItems': 'פריטי טנא',
  'wrapped.fastest': 'השלב המהיר ביותר',
  'wrapped.breakdown': 'שלב אחר שלב',
  'wrapped.notDone': 'לא הושלם',
  'wrapped.back': 'חזרה',

  // Staged start (dashboard standby + countdown)
  'launch.waitTitle': 'התכוננו למירוץ',
  'launch.waitBody': 'נרשמתם! המתינו לאות הזינוק — המארגנים ישגרו את הקבוצה שלכם, והמשימה הראשונה תופיע מיד אחרי ספירה לאחור קצרה.',
  'launch.getReady': 'היכונו',
  'launch.countdownHint': 'המשימה הראשונה שלכם עוד רגע…',

  // Smart station (mobile play screen)
  'station.open': 'פתיחת התחנה',
  'station.openHint': 'בתחנה הזו יש הוראות מיוחדות — הקישו כדי להתחיל.',
  'station.title': 'תחנה חכמה',
  'station.loading': 'טוען תחנה…',
  'station.noConfig': 'אין כרגע משימה אינטראקטיבית בתחנה הזו.',
  'station.start': 'התחלה ←',
  'station.extraInfoLabel': 'כדאי לדעת',
  'station.viewMedia': 'פתיחת מדיה / סרטון ←',
  'station.codeTitle': 'הזינו את הקוד',
  'station.codeDefaultLabel': 'הזינו קוד',
  'station.codePlaceholder': 'הקלידו את הקוד…',
  'station.submit': 'שליחה',
  'station.checking': 'בודק…',
  'station.attemptsLeft': 'נותרו {n} ניסיונות',
  'station.noAttempts': 'לא נותרו ניסיונות.',
  'station.wrongCode': 'הקוד אינו נכון.',
  'station.codeError': 'לא ניתן לשלוח את הקוד. בדקו את החיבור.',
  'station.tooManyAttempts': 'יותר מדי ניסיונות שגויים — המתן 60 שניות.',
  'station.tryAgainIn': 'נסה שוב בעוד {seconds}ש',
  'station.photoTitle': 'העלאת תמונה',
  'station.photoIntro': 'צלמו או בחרו תמונה כהוכחה — שופט יבדוק אותה.',
  'station.choosePhoto': '📷 צילום / בחירת תמונה',
  'station.retakePhoto': '🔄 בחירת תמונה אחרת',
  'station.uploading': 'מעלה…',
  'station.submitForReview': 'שליחה לבדיקה',
  'station.photoNeeded': 'נא להוסיף תמונה תחילה.',
  'station.uploadError': 'ההעלאה נכשלה. נסו שוב.',
  'station.permissionDenied': 'נדרשת הרשאת גישה לתמונות כדי להמשיך.',
  'station.manualTitle': 'קריאה לשופט',
  'station.manualIntro': 'כשהקבוצה מוכנה, סמנו מוכנים ושופט יגיע לאמת.',
  'station.markReady': '✋ קריאה לשופט / מוכנים',
  'station.reviewError': 'לא ניתן לשלוח. בדקו את החיבור.',
  'station.successTitle': 'התחנה הושלמה!',
  'station.successBody': 'כל הכבוד — התקדמתם לשלב הבא.',
  'station.successBack': 'חזרה ללוח ←',
  'station.failTitle': 'כמעט',
  'station.failBody': 'הניסיון לא עבר. נסו שוב.',
  'station.retry': 'ניסיון נוסף',
  'station.pendingTitle': 'ממתין לבדיקה',
  'station.pendingBody': 'שופט בודק את ההגשה שלכם. הלוח יתעדכן אוטומטית עם האישור.',
  'station.pendingBack': 'חזרה ללוח',
};

const DICTS: Record<Lang, Dict> = { en, he };

// ── Persistence (web localStorage; no-op on native without it) ─────────────────
function readInitialLang(): Lang {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const saved = ls?.getItem(STORAGE_KEY);
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  // Hebrew by default — the event runs in Jerusalem for a Hebrew-speaking crowd.
  return 'he';
}

function applySideEffects(lang: Lang): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    ls?.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  // Web RTL: flip document direction so logical CSS (ms-/me-/text-start) mirrors.
  const doc = (globalThis as { document?: Document }).document;
  if (doc?.documentElement) {
    doc.documentElement.lang = lang;
    doc.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────
interface LanguageState {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  lang: readInitialLang(),
  setLang: (l) => {
    applySideEffects(l);
    set({ lang: l });
  },
  toggle: () => get().setLang(get().lang === 'en' ? 'he' : 'en'),
}));

// Apply direction on first load (web).
applySideEffects(useLanguageStore.getState().lang);

// ── Hook ─────────────────────────────────────────────────────────────────────
export interface Translation {
  lang: Lang;
  isRtl: boolean;
  toggle: () => void;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export function useTranslation(): Translation {
  const { lang, toggle, setLang } = useLanguageStore();
  const t = (key: string, vars?: Record<string, string | number>): string => {
    let str = DICTS[lang][key] ?? DICTS.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };
  return { lang, isRtl: lang === 'he', toggle, setLang, t };
}
