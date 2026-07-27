// The RushPoint legal documents (change: legal-pages-participant-origin).
//
// The single source of the Terms of Service and Privacy Policy text, rendered by
// BOTH apps/creator-web (/terms, /privacy on the creator console) and
// apps/play-web (/terms, /privacy on the participant origin, where the people who
// actually accept these documents live). It moved out of
// apps/creator-web/src/pages/LegalPage.tsx unchanged, character for character —
// two divergent copies of a privacy policy is worse than any bug it could fix.
//
// NOT exported from src/index.ts on purpose: this file is tens of kilobytes of
// prose and must stay out of the participant entry chunk (see legalMarkdown.ts).
// Import it by the deep path '@rushpoint/shared/legalContent', from a lazily
// loaded module only.
//
// Body markup is parsed by parseLegalMarkdown() in ./legalMarkdown.

export type LegalDocType = 'privacy' | 'terms';
export type LegalLang = 'he' | 'en';

export interface LegalDoc {
  /** Document heading, already in the target language. */
  title: string;
  /** "Last updated" line, already in the target language. */
  updated: string;
  /** Markdown body — see parseLegalMarkdown for the supported constructs. */
  body: string;
}

export const LEGAL_DOCS: Record<LegalDocType, Record<LegalLang, LegalDoc>> = {
  privacy: {
    he: {
      title: 'מדיניות פרטיות',
      updated: 'עודכן לאחרונה: יולי 2026',
      body: `
## 1. מבוא ותחולה

RushPoint ("החברה", "אנחנו", "אנו") מפעילה פלטפורמת SaaS ליצירה והפעלה של משחקי שדה בעולם האמיתי בכתובת rushpoint.app ("השירות"). מדיניות פרטיות זו ("המדיניות") מסבירה אילו נתונים אנו אוספים, כיצד אנו מעבדים אותם, עם מי אנו משתפים אותם, וכיצד ניתן לממש את זכויותיך כנושא מידע.

מדיניות זו מיושמת בהתאם לחוק הגנת הפרטיות, תשמ"א-1981 ("חוק הפרטיות"), תקנות הגנת הפרטיות (אבטחת מידע), תשע"ז-2017, וחוק התקשורת (בזק ושידורים), תשמ"ב-1982 בכל הנוגע לדיוור ישיר.

בשימוש בשירות, אתה מסכים לאיסוף ועיבוד המידע כמתואר כאן. אם אינך מסכים, אנא הימנע משימוש בשירות.

## 2. הגדרות

**"יוצר"**: כל מי שרשם חשבון ב-RushPoint ויוצר ו/או מפעיל משחקים.
**"משתתף"**: כל אחד שמצטרף למשחק שנוצר ע"י יוצר.
**"ריצה"**: אירוע משחק מתוזמן בזמן אמת שבו משתתפים מתחרים.
**"נתוני מיקום"**: קואורדינטות GPS ו/או רשת שנאספות מהמכשיר.
**"מידע אישי"**: כל מידע המזהה או שעלול לזהות אדם ספציפי.

## 3. מידע שאנו אוספים

### 3.1 מידע שנמסר ע"י יוצרים

בעת ההרשמה ובשימוש השוטף אנו מקבלים:
- שם מלא וכתובת דואר אלקטרוני
- פרטי חשבון Google אם נרשמת דרך Google Sign-In
- תוכן משחקים שיצרת: שמות שלבים, תיאורי משימות, תמונות שהעלית, מיקומים גיאוגרפיים של תחנות
- מסרים ששלחת אלינו דרך ערוצי התמיכה

### 3.2 מידע שנמסר ע"י משתתפים

משתתפים נכנסים לשירות באמצעות אימות אנונימי (ללא רישום). אנו אוספים:
- מזהה משתמש אנונימי ייחודי (אינו מקושר לשם אמיתי)
- שם הצוות שנבחר בעת ההצטרפות
- נתוני ביצועים: ניקוד, זמנים, תשובות שנמסרו
- פרטים שהוזנו בשדות מותאמים (ראה סעיף 3.5)

### 3.3 מיקום GPS: גילוי מלא

**חשיבות: איסוף מיקום הוא תכונת ליבה של השירות.**

אנו אוספים נתוני מיקום GPS מהמכשיר של המשתתף **בזמן ריצה פעילה בלבד**, למטרות הבאות:
- **ניתוב:** חישוב המשימה הבאה המתאימה ביותר בהתאם למיקום המשתתף
- **גיאופנס:** אימות אוטומטי כי הצוות הגיע פיזית לתחנה הנדרשת
- **מפת חי:** הצגת מיקום הצוותות ביחס זה לזה על גבי מפה בזמן אמת לעיני יוצר המשחק ו/או צוות השטח שלו

**מה שאנו לא עושים עם נתוני המיקום:**
- לא אוספים מיקום לפני תחילת הריצה או לאחר סיומה
- לא מוכרים נתוני מיקום לצדדים שלישיים
- לא משתמשים בנתוני מיקום לפרסום ממוקד
- לא מבצעים עיבוד נוסף מעבר לצרכי הניתוב ואימות הגיאופנס

נתוני מיקום גולמיים נשמרים 90 יום מסיום הריצה ואז נמחקים אוטומטית.

**הסכמה:** שימוש בפיצ'ר הניתוב דורש מתן הרשאת מיקום במכשיר. ניתן לסרב; הריצה תמשיך, אך חלק מהמשימות (גיאופנס) לא יוכלו לאשר נוכחות אוטומטית.

### 3.4 תמונות שמועלות במהלך משחק

כחלק ממשימות מסוג "תמונה", משתתפים רשאים (ומוזמנים) להעלות תמונות:
- התמונות מאוחסנות ב-Firebase Storage תחת פרויקט הענן שלנו
- הן גלויות ליוצר המשחק ולצוות השטח שלו לצרכי בדיקת המשימה
- אנו לא מפרסמים תמונות משתתפים לצד שלישי ולא משתמשים בהן לצרכי שיווק
- תמונות נמחקות 90 יום לאחר סיום הריצה, אלא אם היוצר ביקש מחיקה מוקדמת יותר

**יוצר המשחק אחראי בלעדי** לכל שימוש שהוא עושה בתמונות שנאספו ולהבטחה שאיסוף תמונות במשחק שלו עומד בדרישות חוק הפרטיות.

### 3.5 שדות רישום מותאמים אישית של יוצרים

יוצרים רשאים להוסיף שדות מותאמים לתהליך הצטרפות המשתתפים למשחק. שדות אלו עשויים לכלול, לפי שיקול דעת היוצר:
- שמות פרטיים ומשפחה
- מספרי טלפון
- גיל ו/או תאריך לידה
- מגבלות גופניות, מגבלות תזונה, נגישות
- פרטי איש קשר לשעת חירום
- כל שדה אחר שהיוצר הגדיר

**הבחנה חשובה:** RushPoint מספקת את התשתית הטכנית לאיסוף שדות אלו אך **אינה קובעת את תוכנם ואינה אחראית** על שימוש יוצרים בנתונים שנאספו. יוצרים שאוספים מידע בשדות מותאמים נושאים בעצמם את כל האחריות לציות לחוק הפרטיות, לרבות חובת ההגנה על אותו מידע ומחיקתו לפי הצורך.

בהצטרפות למשחק עם שדות מותאמים, המשתתף מסכים שהמידע שמסר יועבר ליוצר האירוע.

### 3.6 מידע טכני ונתוני שימוש

- כתובות IP ונתוני גישה בסיסיים (נדרשים לאבטחה ולניפוי שגיאות)
- סוג מכשיר, מערכת הפעלה, גרסת דפדפן
- נתוני ביצועים אנונימיים (זמני תגובה, שגיאות)
- מספר משחקים, ריצות, ומשתתפים לכל חשבון יוצר
- **דוחות קריסה (Sentry):** כאשר תכונה זו מופעלת בסביבת הייצור, שגיאות יישום (crash reports) הכוללות כתובת IP, מעקב קריאות טכני (stack trace), וסוג הדפדפן/מכשיר נשלחות לספק ניטור השגיאות שלנו לצורך איתור ותיקון תקלות בלבד. ראה סעיף 5 לפרטי ספק המשנה.

## 4. מטרות עיבוד המידע

אנו מעבדים מידע אישי למטרות הבאות בלבד:

- **הפעלת השירות:** אימות משתמשים, ניתוב, ניהול ריצות וניקוד
- **תמיכה טכנית:** אבחון בעיות, מענה לפניות תמיכה
- **ציות לחוק:** תגובה לצווי בית משפט, הוראות רגולטוריות, ומניעת הונאה
- **שיפור השירות:** ניתוח אנונימי של דפוסי שימוש (ללא זיהוי אישי)
- **תקשורת שירותית:** הודעות על שינויים מהותיים בשירות

אנו **לא** מבצעים פרופיילינג אוטומטי לצרכי פרסום ולא מכינים פרופיל שיווקי על בסיס פעילות המשתמש.

## 5. העברת מידע לצדדים שלישיים

אנו **לא מוכרים ולא משכירים** מידע אישי. אנו משתפים מידע עם:

**Google LLC / Firebase**: ספק תשתית הענן שלנו. Firebase Auth, Firestore, ו-Cloud Storage פועלים בשרתי Google. Google מחויבת ל-GDPR ולמסגרות Privacy Shield. Privacy Policy: policies.google.com/privacy.

**ספק הסליקה המאושר**: עיבוד תשלומי האשראי. פרטי כרטיס אשראי אינם עוברים דרך שרתינו ואינם מאוחסנים בבסיסי הנתונים שלנו. ספק הסליקה מקבל רק את הנתונים הנחוצים לאישור העסקה.

**MapTiler AG**: ספק אריחי המפה. MapTiler מקבל בקשות אריחים סטנדרטיות ואינו מקבל נתוני מיקום של משתתפים ספציפיים.

**Sentry (Functional Software, Inc.)**: ספק ניטור שגיאות/קריסות אפליקציה, פעיל רק כאשר מוגדר בסביבת הייצור. מקבל דוחות קריסה טכניים (ראה סעיף 3.6) לצורך תחזוקת השירות בלבד — לא לצרכי שיווק ו/או פרופיילינג.

**יוצרי המשחקים**: יוצר שמפעיל ריצה רואה את המיקום הנוכחי של הצוותות (בזמן ריצה בלבד), ניקוד, תשובות, ותמונות שהועלו. הוא גם רואה נתונים שמשתתפים מסרו בשדות מותאמים, לרבות שם אפוטרופוס במקרה של הסכמת הורים (ראה סעיף 11). ראה סעיף 3.5.

**רשויות:** נמסור מידע לרשויות אכיפת חוק אך ורק בהתאם לחובה חוקית מפורשת או צו שיפוטי בר-תוקף.

**עדכון רשימת ספקי המשנה:** נעדכן רשימה זו כאשר נוסיף ו/או נחליף ספק משנה מהותי, ונודיע על שינוי כאמור בהתאם לסעיף 15 (שינויים במדיניות).

**הסכם עיבוד נתונים (DPA) ליוצרים:** יוצר שהוא עסק הכפוף לדין הגנת מידע זר (למשל GDPR) ואוסף מידע אישי של משתתפים דרך שדות מותאמים (סעיף 3.5) פועל כ"בקר מידע" (data controller) לגבי אותו מידע, כאשר RushPoint פועלת כ"מעבד מידע" (data processor) מטעמו. יוצר כאמור רשאי לפנות ל-**legal@rushpoint.app** לקבלת הסכם עיבוד נתונים (DPA) חתום הכולל את פרטי ספקי המשנה שלנו והתחייבויותינו כמעבד.

## 6. אבטחת מידע

אנו מיישמים אמצעי אבטחה בהתאם לתקנות הגנת הפרטיות (אבטחת מידע), תשע"ז-2017 ("תקנות האבטחה"), ובכלל:

- **הצפנה בהעברה (TLS 1.2+):** כל תקשורת בין הדפדפן לשרת מוצפנת
- **הצפנה באחסון:** Firebase Storage ו-Firestore מצפינים נתונים at-rest
- **גישה מבוססת תפקידים:** עובדים ו/או קבלנים של החברה ניגשים לנתונים רק בהיקף הנדרש לתפקידם
- **כללי Firestore:** כתיבה לנתוני ריצות, ניקוד ומיקום מותרת לשרת בלבד; לקוחות מקבלים קריאה מוגבלת
- **אימות דו-שלבי:** מומלץ לכל חשבוני יוצר

**נוהל תגובה לאירועי אבטחה:** בתרחיש של דלף מידע שעלול לפגוע בנושא מידע, ננקוט בפעולות הבאות: (1) בלימת האירוע ותיקון הפרצה מיידית; (2) הערכת היקף המידע והאנשים שנפגעו; (3) הודעה לרשות הגנת הפרטיות ולנפגעים **ללא דיחוי בלתי סביר ולכל המאוחר בתוך 72 שעות** ממועד היוודע לנו האירוע, ככל שהדבר ניתן בנסיבות העניין ובהתאם לדרישות חוק הפרטיות ותקנות האבטחה (ולמשתמשי GDPR — ראה גם סעיף 13); (4) מסירת פרטים על האירוע, ההשלכות הצפויות, והצעדים שננקטו ו/או מומלצים לצמצום הנזק.

## 7. שמירת מידע ומחיקה

**תקופות שמירת מידע:**
- נתוני חשבון יוצר: כל עוד החשבון פעיל; 30 יום לאחר בקשת מחיקה
- נתוני מיקום GPS גולמיים: נמחקים אוטומטית 90 יום מסיום הריצה
- תמונות שהועלו: נמחקות אוטומטית 90 יום מסיום הריצה
- תוצאות מצטברות (ניקוד ודירוג): נשמרות כל עוד החשבון פעיל; נמחקות עם מחיקת החשבון
- שדות מותאמים: נמחקים עם מחיקת החשבון או הריצה
- נתוני שימוש אנונימיים: עד 24 חודשים

**בקשת מחיקה:** יוצרים יכולים לבקש מחיקת חשבון וכל הנתונים הקשורים אליו על-ידי פנייה ל-privacy@rushpoint.app. ביצוע המחיקה תוך 30 יום.

### 7.1 בקשת מחיקה של משתתף (ללא חשבון)

סעיף זה משלים את פסקת "בקשת מחיקה" שלעיל, החלה על בעלי חשבון יוצר. משתתף שהצטרף לריצה באמצעות קוד גישה, ללא יצירת חשבון, **רשאי אף הוא לבקש את מחיקת הנתונים שנאספו עליו באותה ריצה**, ובכלל זה: נתוני מיקום GPS שנאספו במהלך הריצה, תמונות שהעלה, הקלטות קול שהעלה, הודעות ששלח בצ׳אט הצוות, ושם הצוות ו/או שם התצוגה שבחר.

**כיצד מגישים בקשה:** בפנייה לאותה כתובת — **privacy@rushpoint.app**. הצטרפות לריצה היא אנונימית ואינה מקושרת לשם אמיתי ו/או לכתובת דואר אלקטרוני, ולכן איננו יכולים לאתר את הנתונים לפי זהות הפונה. כדי שנוכל לאתר את הנתונים בפועל, יש לציין בפנייה פרטים מזהים של הריצה: **קוד הגישה, תאריך האירוע, ושם הצוות** (וככל שידוע — שם המשחק ו/או שם המארגן). נטפל בבקשה במסגרת הזמנים המפורטת בפסקת "בקשת מחיקה" שלעיל.

**דרך חלופית — פנייה למארגן:** ניתן לפנות ישירות ליוצר המשחק שהפעיל את הריצה. ליוצר יש גישה לכלי הניהול של הריצה, והוא יכול להסיר את התוכן של הצוות שלך (לרבות הסתרת תמונות מהפיד) ו/או למחוק את הריצה כולה.

**מחיקה אוטומטית ממילא:** גם ללא בקשה, חלק מהנתונים נמחקים אוטומטית לפי טבלת תקופות השמירה שבתחילת סעיף זה — **נתוני מיקום GPS גולמיים ותמונות שהועלו נמחקים אוטומטית 90 יום מסיום הריצה**. נתונים שאינם מפורטים בנפרד בטבלה (כגון הקלטות קול והודעות צ׳אט) נמחקים יחד עם נתוני הריצה כאשר היוצר מוחק את הריצה ו/או את חשבונו, וניתן לבקש את הסרתם מוקדם יותר לפי סעיף זה.

## 8. זכויות נושא המידע

מכוח חוק הגנת הפרטיות, תשמ"א-1981, עומדות לך הזכויות הבאות:

**עיון (סעיף 13 לחוק):** זכות לקבל עותק של המידע האישי שנשמר עליך.

**תיקון (סעיף 14):** זכות לבקש תיקון מידע שגוי, חלקי, או מטעה.

**מחיקה:** זכות לבקש מחיקת חשבונך וכל הנתונים הקשורים אליו, בכפוף לאי-קיום חובות חוקיות המחייבות שמירת המידע.

**התנגדות לשיווק:** זכות להתנגד לקבלת מסרים שיווקיים בכל עת.

**ניידות נתונים:** לבקשה, נספק ייצוא של המידע שלך בפורמט מובנה.

לממש זכויות אלה: **privacy@rushpoint.app** · spendora.tracker@gmail.com

## 9. עוגיות ועקיבה

**עוגיות חיוניות** (נדרשות לתפעול השירות):
- עוגיות אימות Firebase (נדרשות לשמירת המצב המחובר)
- העדפות שפה (HE/EN)

**עוגיות ניתוח.** אנו משתמשים ב-**Google Analytics** (Google Ireland Limited) כדי למדוד שימוש מצטבר בשירות — כמה אנשים פותחים קישור הצטרפות, לאילו מסכים הם מגיעים, והיכן הם נוטשים. זה עוזר לנו לתקן את מה שמבלבל ולהחליט מה לבנות בהמשך. Google Analytics מציבה בדפדפן שלך עוגיות משלה, בשמות _ga ו-_ga_G-89TM5X68RR, המבחינות בין דפדפן אחד למשנהו למשך עד שנתיים.

אנו מגדירים את Google Analytics באופן מצומצם: **אנונימיזציה של כתובת ה-IP מופעלת**, ו**אותות Google Signals והתאמה אישית של פרסום מושבתים**. אין שימוש בריטרגטינג או בפיקסלים של רשתות פרסום, איננו מציגים פרסומות, ואיננו מוכרים או משתפים מידע זה עם מפרסמים.

**כיצד לבטל את ההסכמה:** ניתן לחסום או למחוק עוגיות בהגדרות הדפדפן, להשתמש באמצעי ההגנה מפני מעקב של הדפדפן, או להתקין את תוסף ההסרה הרשמי של Google מהכתובת https://tools.google.com/dlpage/gaoptout — ביטול ההסכמה אינו פוגע ביכולת לשחק או להפעיל משחק.

## 10. מסרים שיווקיים ותקשורת

בהתאם לחוק התקשורת (בזק ושידורים), תשמ"ב-1982 (תיקון מס' 40, "חוק הספאם"), לא נשלח דיוור שיווקי ללא הסכמה מפורשת. הסכמה לדיוור שיווקי היא בחירה נפרדת מהסכמה לתנאי השימוש. ניתן לבטל הסכמה זו בכל עת דרך קישור הסרה בכל הודעה.

## 11. ילדים ובני נוער

**יוצרי משחקים (בעלי חשבון):** יצירת חשבון יוצר מיועדת לאנשים מגיל 16 ומעלה בלבד. אנו לא אוספים ביודעין פרטי חשבון יוצר ממי שמתחת לגיל 16.

**משתתפים קטינים:** בשונה מיוצרים, השירות מותאם גם לאירועים שבהם המשתתפים הם קטינים (למשל קבוצות נוער, בר/בת מצווה) — זהו שימוש נפוץ וצפוי בפלטפורמה. יוצר שמפעיל אירוע כזה **חייב** להפעיל את מנגנון "הסכמת הורים" בהגדרות הריצה; במצב זה קבוצת קטין לא תוכל להתחיל לשחק ללא רישום הסכמה מפורשת של הורה ו/או אפוטרופוס (שם + חתימת אישור דיגיטלית), הנשמרת על גבי רשומת הצוות ונמחקת בהתאם לתקופת השמירה בסעיף 7. **האחריות המלאה** להפעלת מנגנון ההסכמה, ולוודא שהוא תואם את מדיניות בית הספר/הארגון ואת חוק הפרטיות, מוטלת על יוצר האירוע (ראה גם סעיף 6.1 בתנאי השימוש).

אנו לא אוספים ביודעין מידע אישי של קטין מחוץ למסגרת מנגנון ההסכמה האמור. אם נודע לנו שנאסף מידע כאמור שלא כדין, נמחק אותו לאלתר. הורה ו/או אפוטרופוס המודע לאיסוף מידע על קטין שלא כדין מוזמן לפנות אלינו ל-privacy@rushpoint.app.

## 12. העברות מידע בינלאומיות

נתוני המשתמשים מאוחסנים בשרתי Google Cloud Platform ועשויים לעבור עיבוד בשרתים מחוץ לישראל. Google מחויבת למנגנוני הגנה מחמירים (SCCs) התואמים דרישות הגנת הפרטיות הישראליות.

## 13. משתמשים באיחוד האירופי / אזור הכלכלי האירופי (GDPR)

אם אתה נמצא באיחוד האירופי, ה-EEA, בריטניה, ו/או שיפוט אחר עם דין הגנת מידע דומה, סעיף זה משלים (ואינו גורע מ-) הזכויות שבסעיף 8:

**13.1 בסיסים חוקיים לעיבוד (סעיף 6 GDPR):** אנו מעבדים מידע על בסיס: **ביצוע חוזה** (הפעלת חשבונך, ניתוב, ניקוד) · **הסכמה** (מיקום GPS בזמן ריצה, הסכמת הורים, דיוור שיווקי — ניתנים לביטול בכל עת) · **אינטרס לגיטימי** (אבטחת מידע, מניעת הונאה, תחזוקת השירות ודוחות קריסה) · **חובה חוקית** (תגובה לצווים).

**13.2 נציג באיחוד האירופי:** במידה שנדרש על-פי דין, פרטי נציג באיחוד האירופי יפורסמו בעמוד זה ו/או יימסרו לפי בקשה בכתובת privacy@rushpoint.app.

**13.3 זכויות נוספות:** זכות הגבלת עיבוד, זכות התנגדות לעיבוד מבוסס אינטרס לגיטימי, וזכות שלא להיות כפוף להחלטה אוטומטית מהותית (איננו מבצעים החלטות כאלה — ראה סעיף 4).

**13.4 העברות בינלאומיות:** נתונים מועברים מחוץ ל-EEA (לשרתי Google Cloud, ראה סעיף 12) בכפוף למנגנוני הגנה חוזיים מוכרים (Standard Contractual Clauses).

**13.5 תלונה לרשות מפקחת:** לך הזכות להגיש תלונה לרשות ההגנת מידע המוסמכת במדינת מגוריך, במקום עבודתך, ו/או במקום האירוע הנטען, בנוסף לכל זכות אחרת.

## 14. תושבי קליפורניה (CCPA/CPRA)

אם אתה תושב קליפורניה, בנוסף לזכויות שבסעיף 8 עומדות לך הזכויות הבאות מכוח ה-CCPA/CPRA:

- **זכות דעת:** לדעת אילו קטגוריות מידע אישי נאספו, מקורן, ומטרת העיבוד (ראה סעיפים 3-4).
- **זכות מחיקה:** כאמור בסעיף 8.
- **זכות תיקון:** כאמור בסעיף 8.
- **זכות "לא למכור/לשתף":** **אנו לא מוכרים ולא משתפים ("sell"/"share" כהגדרתם ב-CCPA) מידע אישי** תמורת תשלום ו/או לצרכי פרסום התנהגותי חוצה-הקשרים. אין צורך לממש opt-out כי אין מכירה/שיתוף מלכתחילה.
- **איסור אפליה:** לא נפלה לרעה בשירות ו/או במחיר בשל מימוש זכות מהזכויות שלעיל.

לממש זכויות אלה: **privacy@rushpoint.app**.

## 15. שינויים במדיניות

במקרה של שינויים מהותיים, נודיע בהודעה בתוך הפלטפורמה לפחות 14 יום לפני כניסתם לתוקף. המשך שימוש לאחר מועד הכניסה לתוקף מהווה הסכמה לשינויים.

## 16. יצירת קשר

לכל שאלה, בקשה לעיון, תיקון, ו/או מחיקה:

**דוא"ל:** privacy@rushpoint.app · spendora.tracker@gmail.com
**נושא הפנייה:** יש לציין "פנייה לפי חוק הפרטיות"

החברה תשיב לפניות בתוך 30 יום.
      `,
    },
    en: {
      title: 'Privacy Policy',
      updated: 'Last updated: July 2026',
      body: `
## 1. Introduction and Scope

RushPoint ("the Company", "we", "us") operates a SaaS platform for building and running real-world field games at rushpoint.app ("the Service"). This Privacy Policy explains what data we collect, how we process it, with whom we share it, and how to exercise your rights as a data subject.

This Policy is applied in accordance with Israel's Protection of Privacy Law, 5741-1981, the Privacy Protection Regulations (Data Security) 5777-2017, and the Communications Law (Telecommunications and Broadcasts) 5742-1982 regarding direct marketing.

By using the Service, you agree to the collection and processing of data as described here.

## 2. Definitions

**"Creator"**: any person who has registered an account and creates and/or runs games.
**"Participant"**: any person who joins a game created by a Creator.
**"Run"**: a scheduled, real-time game event in which participants compete.
**"Location Data"**: GPS and/or network coordinates collected from the device.
**"Personal Data"**: any information that identifies or could identify a specific individual.

## 3. Information We Collect

### 3.1 Information Provided by Creators

At registration and during ongoing use:
- Full name and email address
- Google account details if registered via Google Sign-In
- Game content you create: stage names, task descriptions, uploaded images, geographic station coordinates
- Messages sent to us via support channels

### 3.2 Information Provided by Participants

Participants access the Service via anonymous authentication (no registration required). We collect:
- A unique anonymous user ID (not linked to a real name)
- The team name chosen at sign-in
- Performance data: score, times, submitted answers
- Details entered in custom registration fields (see Section 3.5)

### 3.3 GPS Location Data: Full Disclosure

**Important: location collection is a core feature of the Service.**

We collect GPS location data from the participant's device **during an active run only**, for:
- **Routing:** calculating the best next task based on the participant's location
- **Geofencing:** automatically confirming that a team has physically arrived at a required station
- **Live map:** showing team locations to the Creator and their designated staff during the run

**What we do NOT do with location data:**
- We do not collect location before a run starts or after it ends
- We do not sell location data to any third party
- We do not use location data for targeted advertising
- We perform no additional processing beyond routing and geofence validation

Raw location data is retained for 90 days after run completion, then automatically deleted.

**Consent:** the routing feature requires granting location permission on the device. You may refuse; the run will continue, but geofence tasks cannot auto-confirm your presence.

### 3.4 Photos Uploaded During a Game

As part of photo-type tasks, participants may upload images:
- Photos are stored in Firebase Storage under our cloud project
- They are visible to the game's Creator and their designated staff for task review
- We do not publish participant photos to third parties or use them for marketing
- Photos are deleted 90 days after run completion

**The Creator is solely responsible** for any use they make of collected photos and for ensuring that photo collection in their game complies with the Protection of Privacy Law.

### 3.5 Creator-Customized Registration Fields

Creators may add custom fields to their game's participant join flow. These fields may include, at the Creator's discretion:
- First and last names
- Phone numbers
- Age and/or date of birth
- Physical limitations, dietary restrictions, accessibility needs
- Emergency contact details
- Any other field the Creator defines

**Important distinction:** RushPoint provides the technical infrastructure to collect these fields but **does not determine their content and is not responsible** for Creators' use of the collected data. Creators who collect information via custom fields bear full responsibility for compliance with the Protection of Privacy Law, including safeguarding that data and deleting it as required.

By joining a game that includes custom fields, the participant consents to the Creator receiving that data.

### 3.6 Technical and Usage Data

- IP addresses and basic access data (required for security and debugging)
- Device type, operating system, browser version
- Anonymous performance data (response times, errors)
- Number of games, runs, and participants per Creator account
- **Crash reports (Sentry):** when this feature is enabled in production, application error reports — including IP address, technical stack trace, and browser/device type — are sent to our error-monitoring sub-processor solely to diagnose and fix defects. See Section 5 for sub-processor details.

## 4. Purposes of Data Processing

We process personal data only for these purposes:

- **Service operation:** user authentication, routing, run management, and scoring
- **Technical support:** diagnosing issues, responding to support requests
- **Legal compliance:** responding to court orders, regulatory requirements, and fraud prevention
- **Service improvement:** anonymous analysis of usage patterns (no individual identification)
- **Service communications:** notices about material changes to the Service

We do **not** conduct automated profiling for advertising purposes or build marketing profiles based on user activity.

## 5. Sharing Data with Third Parties

We **do not sell or rent** personal data. We share data with:

**Google LLC / Firebase**: our cloud infrastructure provider. Firebase Auth, Firestore, and Cloud Storage run on Google's servers. Google is committed to GDPR and equivalent privacy frameworks. Privacy Policy: policies.google.com/privacy.

**Authorized Payment Processor**: credit card payment processing. Card details do not pass through our servers and are not stored in our databases. The payment processor receives only the data necessary to approve the transaction.

**MapTiler AG**: map tiles provider. MapTiler receives standard tile requests and does not receive individual participant location data.

**Sentry (Functional Software, Inc.)**: our crash/error-monitoring provider, active only when configured in production. Receives technical crash reports (see Section 3.6) solely for service maintenance — never for marketing or profiling.

**Game Creators**: a Creator who runs a game can see current team locations (during the run only), scores, submitted answers, uploaded photos, and data entered in custom fields, including a guardian's name where guardian consent applies (see Section 11). See Section 3.5.

**Authorities:** we will disclose data to law enforcement only when required by an explicit legal obligation or a valid court order.

**Sub-processor list updates:** we will update this list whenever we add or replace a material sub-processor, and will notify users of such changes per Section 15 (Policy Changes).

**Data Processing Addendum (DPA) for Creators:** a Creator who is a business subject to foreign data-protection law (e.g. the GDPR) and who collects participants' personal data via custom fields (Section 3.5) acts as the "data controller" for that data, with RushPoint acting as its "data processor." Such a Creator may contact **legal@rushpoint.app** to receive a signed Data Processing Addendum detailing our sub-processors and our obligations as processor.

## 6. Data Security

We implement security measures in accordance with the Israeli Privacy Protection Regulations (Data Security) 5777-2017, including:

- **Encryption in transit (TLS 1.2+):** all browser-to-server communication is encrypted
- **Encryption at rest:** Firebase Storage and Firestore encrypt data at rest
- **Role-based access:** company employees and/or contractors access data only to the extent required for their role
- **Firestore security rules:** writing to run data, scores, and location is restricted to the server only; clients receive limited read access
- **Two-factor authentication:** recommended for all Creator accounts

**Incident response procedure:** in the event of a data breach likely to affect a data subject, we will: (1) contain the incident and remediate the vulnerability immediately; (2) assess the scope of data and individuals affected; (3) notify the Privacy Protection Authority and affected individuals **without undue delay, and no later than 72 hours** after we become aware of the incident, where feasible, in accordance with the Privacy Protection Law, the Data Security Regulations, and (for GDPR-covered users) Section 13 below; (4) provide details of the incident, its likely consequences, and the measures taken and/or recommended to mitigate harm.

## 7. Data Retention and Deletion

- Creator account data: retained while the account is active; 30 days after a deletion request
- Raw GPS location data: auto-deleted 90 days after run completion
- Uploaded photos: auto-deleted 90 days after run completion
- Aggregate results (scores and rankings): retained while the account is active; deleted when the account is deleted
- Custom field data: deleted when the account or run is deleted
- Anonymous usage data: up to 24 months

**Deletion request:** Creators can request deletion of their account and all associated data by contacting privacy@rushpoint.app. Deletion is carried out within 30 days.

### 7.1 Participant Deletion Requests (No Account)

This Section supplements the "Deletion request" paragraph above, which applies to Creator account holders. A participant who joined a run using an access code, without creating an account, **may also request deletion of the data collected about them in that run**, including: GPS location data collected during the run, photos they uploaded, audio recordings they uploaded, messages they sent in team chat, and the team name and/or display name they chose.

**How to request:** contact the same address — **privacy@rushpoint.app**. Joining a run is anonymous and is not linked to a real name or email address, so we cannot locate the data from the requester's identity alone. So that we can actually find the data, please include identifying details of the run in your request: **the access code, the event date, and the team name** (and, if known, the game name and/or the organizer's name). We handle such requests within the timeframe stated in the "Deletion request" paragraph above.

**Alternative — ask the organizer:** you may instead contact the Creator who ran the event directly. The Creator has access to the run's management tools and can remove your team's content (including hiding photos from the feed) and/or delete the entire run.

**Automatic deletion regardless:** even without a request, some data is deleted automatically per the retention table at the start of this Section — **raw GPS location data and uploaded photos are auto-deleted 90 days after run completion**. Data not separately listed in that table (such as audio recordings and chat messages) is deleted together with the run's data when the Creator deletes the run and/or their account, and may be removed sooner on request under this Section.

## 8. Data Subject Rights

Under Israel's Protection of Privacy Law, 5741-1981, you have the following rights:

**Access (Section 13):** right to receive a copy of personal data stored about you.

**Correction (Section 14):** right to request correction of inaccurate, incomplete, or misleading data.

**Deletion:** right to request deletion of your account and all associated data, subject to any legal obligations requiring retention.

**Objection to marketing:** right to object to receiving marketing messages at any time.

**Data portability:** upon request, we will provide an export of your data in a structured format.

To exercise these rights: **privacy@rushpoint.app** · spendora.tracker@gmail.com

## 9. Cookies and Tracking

**Essential cookies** (required for the Service to work):
- Firebase authentication cookies (required to maintain the logged-in state)
- Language preferences (HE/EN)

**Analytics cookies.** We use **Google Analytics** (Google Ireland Limited) to measure aggregate usage of the Service — how many people open a join link, which screens are reached, and where people drop off. This helps us fix what is confusing and decide what to build next. Google Analytics sets its own cookies in your browser, named _ga and _ga_G-89TM5X68RR, which distinguish one browser from another for up to two years.

We configure Google Analytics restrictively: **IP anonymization is enabled**, and **Google Signals and advertising personalization are disabled**. We do not use retargeting or advertising network pixels, we do not run ads, and we do not sell or share this data with advertisers.

**How to opt out:** you may block or delete cookies in your browser settings, use your browser's tracking-protection features, or install Google's official opt-out add-on from https://tools.google.com/dlpage/gaoptout — opting out does not affect your ability to play or to run a game.

## 10. Marketing Messages

In accordance with the Communications Law (Telecommunications and Broadcasts) Amendment No. 40, we will not send marketing messages without explicit consent. Consent to marketing is a separate choice from consent to these Terms. You may withdraw consent at any time via the unsubscribe link in any message.

## 11. Children and Minors

**Creators (account holders):** creating a Creator account is intended for people aged 16 and over only. We do not knowingly collect Creator account data from anyone under 16.

**Minor participants:** unlike Creators, the Service is also designed for events where participants are minors (e.g. youth groups, bar/bat mitzvah events) — this is a common and expected use of the platform. A Creator running such an event **must** enable the "guardian consent" mechanism in the run's settings; with it enabled, a minor's team cannot start playing until a parent and/or guardian records explicit consent (name + digital confirmation), which is stored on the team record and deleted per the retention schedule in Section 7. **Full responsibility** for enabling this mechanism, and for ensuring it satisfies applicable school/organizational policy and privacy law, rests with the event's Creator (see also Section 6.1 of the Terms of Service).

We do not knowingly collect a minor's personal data outside this consent mechanism. If we become aware that such data was collected unlawfully, we will delete it immediately. A parent or guardian aware of unlawful data collection about a minor is invited to contact us at privacy@rushpoint.app.

## 12. International Data Transfers

User data is stored on Google Cloud Platform servers and may be processed on servers outside Israel. Google is committed to strict protection mechanisms (SCCs) compatible with Israeli privacy requirements.

## 13. Users in the EU / European Economic Area (GDPR)

If you are located in the EU, the EEA, the UK, and/or another jurisdiction with similar data-protection law, this section supplements (and does not diminish) the rights in Section 8:

**13.1 Legal bases for processing (GDPR Art. 6):** we process data based on: **contract performance** (running your account, routing, scoring) · **consent** (in-run GPS location, guardian consent, marketing communications — withdrawable at any time) · **legitimate interest** (data security, fraud prevention, service maintenance and crash reports) · **legal obligation** (responding to court orders).

**13.2 EU representative:** where required by law, EU representative details will be published on this page and/or provided on request at privacy@rushpoint.app.

**13.3 Additional rights:** the right to restrict processing, the right to object to processing based on legitimate interest, and the right not to be subject to a solely automated decision with legal effect (we do not make such decisions — see Section 4).

**13.4 International transfers:** data is transferred outside the EEA (to Google Cloud servers, see Section 12) subject to recognized contractual safeguards (Standard Contractual Clauses).

**13.5 Complaint to a supervisory authority:** you have the right to lodge a complaint with the data-protection authority competent for your place of residence, your workplace, and/or the place of the alleged infringement, in addition to any other right.

## 14. California Residents (CCPA/CPRA)

If you are a California resident, in addition to the rights in Section 8 you have the following rights under the CCPA/CPRA:

- **Right to know:** which categories of personal data were collected, their source, and the purpose of processing (see Sections 3-4).
- **Right to delete:** as described in Section 8.
- **Right to correct:** as described in Section 8.
- **Right not to be "sold"/"shared":** **we do not sell or share ("sell"/"share" as defined by the CCPA) personal data** for money and/or for cross-context behavioral advertising. There is no need to exercise an opt-out because there is no sale/sharing in the first place.
- **Non-discrimination:** we will not discriminate in service and/or pricing for exercising any of the above rights.

To exercise these rights: **privacy@rushpoint.app**.

## 15. Policy Changes

For material changes, we will notify users via an in-platform notice at least 14 days before the changes take effect. Continued use after the effective date constitutes acceptance of the changes.

## 16. Contact

For any question, access request, correction, or deletion request:

**Email:** privacy@rushpoint.app · spendora.tracker@gmail.com
**Subject:** please include "Privacy Rights Request"

The Company will respond to requests within 30 days.
      `,
    },
  },

  terms: {
    he: {
      title: 'תנאי שימוש',
      updated: 'עודכן לאחרונה: יולי 2026',
      body: `
## 1. כללי וקבלת התנאים

ברוך הבא ל-RushPoint. תנאי שימוש אלו ("התנאים") מסדירים את הגישה שלך לפלטפורמת RushPoint ואת השימוש בה. RushPoint ("החברה") מפעילה פלטפורמת SaaS ליצירה, השקה וניהול משחקי שדה בעולם האמיתי.

**בלחיצה על "יצירת חשבון", בכניסה למשחק, ו/או בכל שימוש אחר בשירות, אתה מצהיר שקראת, הבנת, ומסכים לתנאים אלו על כל חלקיהם.**

אם אינך מסכים, אנא אל תשתמש בשירות. **יצירת חשבון יוצר** מותרת מגיל 16 ומעלה בלבד; אם אתה בין 16 ל-18, השימוש כפוף להסכמת הורה או אפוטרופוס. **השתתפות במשחק** אפשרית גם למי שמתחת לגיל 16, ובלבד שהיוצר הפעיל את מנגנון הסכמת ההורים הנדרש — ראה סעיף 6.1(ז) ומדיניות הפרטיות סעיף 11.

## 2. הגדרות

**"יוצר"**: כל מי שרשם חשבון ויוצר ו/או מנהל משחקים.
**"משתתף"**: כל מי שמצטרף למשחק שנוצר ע"י יוצר.
**"ריצה"**: אירוע משחק בזמן אמת.
**"שירות"**: פלטפורמת RushPoint כולה, כולל הממשקים, ה-API, ו-Cloud Functions.
**"קרדיט אירוע"**: יחידת חיוב הנרכשת בתשלום ומשמשת להשקת ריצות.
**"Creator Pro"**: מנוי בתשלום הנותן יכולות מורחבות ליוצרים.
**"גלריה ציבורית"**: מאגר משימות ציבורי שיוצרים מפרסמים אליו ורשאים לשאול ממנו.

## 3. הרשמה ופרטי החשבון

- אתה מתחייב לספק פרטים נכונים ומדויקים בעת הרשמה.
- אתה אחראי לשמירת סודיות סיסמתך וכל פרטי הגישה לחשבונך.
- חל איסור להעביר חשבונות, לשתף גישה, ו/או ליצור חשבונות מרובים לעקוף מגבלות.
- עליך להודיע לנו לאלתר על כל חשד לשימוש לא מורשה בחשבונך.
- החברה שומרת לעצמה את הזכות לדרוש אימות זהות במקרים של חשד להפרת תנאים.

## 4. אופי השירות: פלטפורמת תוכנה בלבד

> RushPoint היא כלי תוכנה המספק תשתית טכנולוגית ליצירת ולניהול אירועים. החברה אינה מארגנת אירועים, אינה בוחרת מיקומים, אינה מספקת ציוד, ואינה נוכחת בשטח.

אנו מספקים:
- פלטפורמה לתכנון משחקים
- מנגנון השקה, ניהול, וניקוד בזמן אמת
- כלים לניהול צוותים ומשתתפים
- תשתית טכנית לאחסון ועיבוד נתונים

אנו **לא** מספקים:
- תכנון או אישור מסלולים
- הדרכות בטיחות
- ביטוח אחריות מקצועית
- פיקוח בשטח
- אחריות לתוכן, אסטרטגיה, ו/או החלטות שמתקבלות ע"י היוצר

## 5. תוכן שיוצרים מייצרים ורישיון הגלריה הציבורית

### 5.1 בעלות בתוכן

אתה שומר על זכויות היוצרים שלך בתוכן שיצרת, לרבות שמות משחקים, תיאורי שלבים, נוסח משימות, תמונות, ושאלות.

### 5.2 רישיון תפעול

בשימוש בשירות, אתה מעניק לחברה רישיון לא-בלעדי, חופשי מתמלוגים, ניתן להמחאה לצרכי תפעול, לאחסן, להציג, ולעבד תוכן זה לצורך מתן השירות. רישיון זה מסתיים עם מחיקת החשבון.

### 5.3 רישיון הגלריה הציבורית

בפרסום משימה לגלריה הציבורית של RushPoint, אתה מעניק לחברה ולכל משתמש אחר בפלטפורמה:

**רישיון לא-בלעדי, חופשי מתמלוגים, בלתי חוזר, ניתן לתת-רישוי, להעתיק, לשנות, לתרגם, ולשלב את המשימה במשחקים אחרים.**

רישיון זה:
- ניתן לשימוש על-ידי כל יוצר אחר בפלטפורמה, ללא צורך ביצירת קשר אתך
- מאפשר שינוי ועיבוד חופשי של המשימה המקורית
- לא מחייב ציון שם היוצר המקורי (attribution)
- אינו פוגע בזכות שלך להמשיך להשתמש במשימה ו/או להסיר אותה מהגלריה

**לאחר הסרת משימה מהגלריה:** יוצרים שכבר שאלו ו/או שילבו את המשימה במשחקיהם רשאים להמשיך להשתמש בה, אולם היא לא תהיה זמינה יותר לשאילה חדשה.

### 5.4 איסורים על תוכן

חל איסור **מוחלט** ליצור ו/או להעלות:
- תוכן פוגעני, גזעני, מאיים, מטריד, ו/או משפיל
- תוכן הפוגע בפרטיות של אנשים ספציפיים
- תוכן הפורץ זכויות יוצרים ו/או סימני מסחר של צדדים שלישיים
- תוכן המכוון משתתפים לאזורים מסוכנים, נכסים פרטיים ללא אישור, ו/או מתקנים מוגבלים
- תוכן הנוגד את הוראות כל דין ישראלי ו/או בינלאומי

### 5.5 תוכן שמעלים משתתפים ופיד התמונות החי

סעיף זה חל על תוכן שמשתתפים מעלים במהלך ריצה, ובפרט על תמונות המוצגות בפיד התמונות החי. **סעיף 5.4 (איסורים על תוכן) חל במלואו גם על תוכן שמעלים משתתפים**; סעיף זה מוסיף עליו ואינו בא במקומו.

**(א) איסורי העלאה:** משתתף לא יעלה תוכן מן הסוגים המנויים בסעיף 5.4, ובכלל זה תוכן פוגעני, מטריד, מאיים, גזעני ו/או משפיל, תוכן בעל אופי מיני ו/או בוטה, תוכן הפוגע בפרטיותו של אדם אחר ו/או מציג אדם ללא הסכמתו, תוכן המפר זכויות של צד שלישי, וכל תוכן הנוגד את הוראות הדין.

**(ב) חשיפה לכל הקבוצות בריצה:** כאשר פיד התמונות החי מופעל במשחק, תמונה שהועלתה ואושרה מוצגת **לכל הקבוצות המשתתפות באותה ריצה**, ולא רק ליוצר ולצוות השטח שלו. אין להעלות תוכן שאינך מעוניין שכלל המשתתפים בריצה יראו.

**(ג) דיווח על תוכן:** **כל משתתף** רשאי לדווח על כל תמונה בפיד, ישירות מתוך האפליקציה, באמצעות בחירת סיבה מתוך רשימה סגורה.

**(ד) הסרה עד לבדיקה:** תוכן שדווח מוסר מן הפיד עד לבדיקתו. תוכן שהוסר אינו מוצג עוד למשתתפים ואינו נכלל בטקס הסיום. המדווח מפסיק לראות את התוכן שעליו דיווח באופן מיידי.

**(ה) סמכות הסרה:** יוצר המשחק וצוות השטח שלו רשאים להסתיר כל תמונה בכל עת, וכן להחזיר תמונה שהוסרה בטעות. RushPoint רשאית אף היא להסיר תוכן, להפסיק את השתתפותו של משתתף בריצה, ולנקוט בצעדים לפי סעיף 12, בכל מקרה של הפרת סעיף זה.

**(ו) "השתקת קבוצה" — הבהרה:** האפשרות להשתיק קבוצה באפליקציית המשתתף מסתירה את תמונות אותה קבוצה **במכשיר שבו בוצעה ההשתקה בלבד**. משתתפים מצטרפים בזיהוי אנונימי וללא חשבון, ולפיכך אין מדובר בחסימה של זהות ו/או של משתמש: ההשתקה אינה עוברת בין מכשירים, אינה משפיעה על משתתפים אחרים, ואינה מסירה את התוכן עצמו.

**(ז) אחריות היוצר:** יוצר המשחק אחראי לתוכן שמעלים משתתפי האירוע שלו, לרבות ניטור הפיד במהלך הריצה ותגובה לדיווחים. יוצר שאינו מעוניין בשיתוף תמונות בין הקבוצות רשאי לכבות את פיד התמונות החי בהגדרות המשחק לפני ההשקה.

## 6. אחריות יוצר המשחק ובטיחות גופנית של משתתפים

> **זהו הסעיף החשוב ביותר בתנאים. קרא בעיון.**

### 6.1 הצהרת אחריות מלאה של היוצר

יוצרי משחקים בפלטפורמת RushPoint הם **מארגני אירועים עצמאיים** בלבד. בהפעלת ריצה ואירוע, היוצר מצהיר, מאשר ומתחייב:

**(א) סיור שטח:** כי ביצע סיור מוקדם בכל המיקומים הכלולים במסלול המשחק, ווידא שהם פתוחים לציבור, בטוחים לכניסה, ומתאימים לסוג המשתתפים הצפויים.

**(ב) התאמת המסלול:** כי המסלול, הקצב, ורמת הדרישות הגופניות מתאימים לגיל, לכושר הגופני, ולמגבלות הרפואיות הידועות של משתתפיו.

**(ג) ציוד ומוכנות:** כי הדאיג לציוד בטיחות מתאים ו/או הנחה משתתפים מה לצייד בו עצמם.

**(ד) גישה לעזרה:** כי ידע למשתתפים כיצד לפנות לעזרה ראשונה ו/או שירותי חירום במהלך האירוע, וכי מספר חירום נגיש לכל הצוותות.

**(ה) היתרים וביטוח:** כי קיבל את כל ההיתרים הנדרשים לשימוש בשטחים ציבוריים ו/או פרטיים הכלולים במסלול, ובמידת הצורך, רכש ביטוח אחריות מקצועית לאירוע.

**(ו) ציות לחוק:** כי האירוע עומד בכל דרישות החוק הישראלי הרלוונטיות.

**(ז) קטינים:** כי אם צפוי שמשתתפים באירוע יהיו מתחת לגיל 16, הפעיל את מנגנון "הסכמת הורים" בהגדרות הריצה לפני תחילת המשחק, וכי ידוע לו שהפעלת אירוע עם קטינים ללא מנגנון זה מהווה הפרה של תנאים אלו.

### 6.2 ויתור מוחלט על תביעות כנגד החברה

**בהפעלת אירוע דרך RushPoint, היוצר מוותר על כל עילת תביעה כנגד החברה, עובדיה, נושאי משרה בה, ובעלי מניותיה, בכל הנוגע לנזק גופני, נפשי, חומרי, ו/או כלכלי שנגרם למשתתפים, לצדדים שלישיים, ו/או ליוצר עצמו, כתוצאה ישירה ו/או עקיפה מתפעול האירוע.**

ויתור זה חל בין אם הנזק נגרם עקב:
- כישלון ציוד
- תנאי מזג אוויר
- נפילה, פציעה, ו/או תאונה בשטח
- כניסה למבנים ו/או אזורים לא בטוחים
- התנהגות משתתפים
- גורמים אחרים שמחוץ לשליטת החברה

**יודגש:** ויתור זה אינו גורע מאחריות החברה במקרים של מעשה מכוון ו/או רשלנות חמורה מצד החברה עצמה.

### 6.3 המלצות בטיחות מחמירות (אינן ממצות)

- **כתב ויתור:** החתם כל משתתף על כתב ויתור שנוסח ע"י עורך דין לפני תחילת האירוע
- **מספר חירום:** הספק לכל צוות מספר טלפון לחירום שאחד מאנשי הצוות יענה בו בכל עת
- **גבולות ברורים:** הגדר בכתב בפני המשתתפים אזורים אסורים ופעילויות אסורות
- **ניטור שוטף:** הישאר בקשר עם כל הצוותות לאורך האירוע
- **הזמינות רפואית:** ודא שיש גישה לציוד עזרה ראשונה ו/או לאיש צוות שהוכשר בעזרה ראשונה

**RushPoint אינה אחראית לנזק שנגרם בשל אי-יישום המלצות אלו.**

### 6.4 הצהרת משתתפים

בהצטרפות למשחק, כל משתתף מצהיר שהוא:
- מודע שמדובר בפעילות גופנית בשטח הכוללת הליכה ו/או ריצה
- לוקח אחריות אישית על כושרו הגופני ומתאמו לפעילות
- מסכים שהחברה אינה אחראית לנזקים גופניים הנובעים מהשתתפות

## 7. תשלומים, קרדיטים, ומנויים

### 7.1 ריצות חינמיות

כל חשבון חדש מקבל ריצות חינמיות לכל החיים עד 5 משתתפים כל אחת. ריצות חינמיות אינן ניתנות להמרה לכסף.

### 7.2 Event Credits: קרדיטי אירועים

- קרדיטים נרכשים בחבילות מוגדרות ומשמשים להשקת ריצות בתשלום
- קרדיטים שנרכשו אינם פגים
- עם השקת ריצה, הקרדיטים המתאימים מנוכים מהארנק **בשלב ההשקה** בלא אפשרות ביטול
- החזר כספי לקרדיטים שנרכשו ניתן אך ורק במקרה של תקלה טכנית מוכחת שמנעה לחלוטין את קיום הריצה, ובתנאי שהדיווח הוגש תוך 48 שעות מהמועד המתוכנן

### 7.3 Creator Pro: מנוי יוצר מקצועי

- Creator Pro הוא מנוי בתשלום שנתי ו/או חודשי
- ניתן לבטל בכל עת; הביטול ייכנס לתוקף בתום תקופת החיוב הנוכחית
- לא יינתן החזר יחסי על תקופה שנותרה לאחר ביטול
- שדרוג ממנוי חודשי לשנתי: ניתן בכל עת; ההפרש מחושב יחסית

### 7.4 כללי תשלום

- כל העסקאות מעובדות ע"י ספק הסליקה המאושר שלנו; פרטי כרטיס האשראי אינם מאוחסנים בשרתינו
- מחירים מוצגים בשקלים חדשים (₪) וכוללים מע"מ כנדרש בחוק הישראלי
- קבלות אלקטרוניות נשלחות לכתובת הדואר האלקטרוני של החשבון
- לשאלות חיוב: spendora.tracker@gmail.com

### 7.5 ריצה חינמית כבונוס הפניה

כל יוצר שמפנה יוצר חדש שנרשם ו/או יוצר שנרשם דרך קישור הפניה, יקבל ריצה חינמית נוספת. בונוס ההפניה מוגבל לריצה אחת לכל הפניה מוצלחת. החברה שומרת לעצמה את הזכות לשנות ו/או לבטל תוכנית ההפניות עם הודעה מוקדמת.

## 8. שימושים אסורים

חל איסור מוחלט להשתמש בשירות לצורך:
- ייצור תוכן בלתי חוקי, מסית, גזעני, ו/או פוגעני
- איסוף מידע אישי על משתתפים ללא הסכמתם המפורשת
- מעקב מיקום של אנשים ללא ידיעתם ו/או הסכמתם
- חדירה, ניסיון פרצה, ו/או עקיפת מנגנוני האבטחה של הפלטפורמה
- ריברס-אנג'ינירינג של קוד הפלטפורמה
- העמסת שרתים (DoS), בוטים, ו/או כל ניסיון לפגוע בזמינות השירות
- התחזות לגורמים אחרים
- שימוש בשירות לפעילות עסקית מתחרה ו/או לבנות מוצר דומה

## 9. הגבלת אחריות החברה

השירות ניתן "כמות שהוא" (AS IS) וכפי שזמין (AS AVAILABLE). ככל המותר בחוק הישראלי:

**(א) אין אחריות לתכנים:** החברה אינה אחראית לתוכן שנוצר ע"י יוצרים, לאמיתותו, לדיוקו, ו/או לחוקיותו.

**(ב) אין אחריות לנזקים עקיפים:** החברה לא תישא בנזקים עקיפים, תוצאתיים, מקריים, עונשיים, ו/או נזקים לאובדן הכנסות ו/או מוניטין.

**(ג) תקרת אחריות:** בכל מקרה, אחריות כוללת של החברה לא תעלה על הסכום שהתשלמת לחברה ב-12 החודשים שקדמו לאירוע הנזק.

**(ד) כוח עליון:** החברה לא תישא באחריות לאי-זמינות השירות ו/או לאובדן נתונים הנובעים מאירועים שמחוץ לשליטתה הסבירה.

**לעניין בטיחות גופנית:** ראה סעיף 6 לעיל.

## 10. שיפוי

אתה מתחייב לשפות ולהגן על החברה, עובדיה, נושאי משרה בה, ובעלי מניותיה מפני כל תביעה, נזק, הפסד, עלות, ו/או הוצאה (כולל שכר טרחת עורכי דין סבירים) הנובעים מ:
- הפרת תנאים אלו
- הפרת זכויות צדדים שלישיים
- תוכן שיצרת ו/או פרסמת
- אירוע שהפעלת, לרבות כל תביעת נזיקין ממשתתפים

## 11. קניין רוחני

הפלטפורמה עצמה, לרבות קוד המקור, עיצוב, אלגוריתמי הניתוב, ממשק המשתמש, ומסמכי מדיניות אלו, שייכת לחברה ומוגנת בזכויות יוצרים. אין להעתיק, לשכפל, ו/או להפיץ ללא אישור כתוב מהחברה. סימני המסחר של החברה לא ישמשו ללא אישור מוקדם.

## 12. השעיה וסיום חשבון

החברה שומרת לעצמה את הזכות להשהות ו/או לסגור חשבון:
- עם הודעה מוקדמת: בשל הפרות חוזרות ו/או ניצול לרעה של השירות
- ללא הודעה מוקדמת: בשל הפרות חמורות, תוכן לא חוקי, ו/או סיכון בטיחותי מיידי

עם סגירת חשבון, קרדיטים שנרכשו ייזכו יחסית, למעט מקרים שבהם הסגירה נובעת מהפרת תנאים.

## 13. שינויים בתנאי השירות

נשמרת לנו הזכות לשנות תנאים אלו. לשינויים מהותיים, נודיע בהודעה בתוך הפלטפורמה לפחות 30 יום מראש. המשך שימוש לאחר מועד הכניסה לתוקף מהווה הסכמה לשינויים.

## 14. הגנת פרטיות

איסוף ועיבוד מידע אישי כפופים למדיניות הפרטיות שלנו, המהווה חלק בלתי נפרד מתנאים אלו.

## 15. דין ישים וסמכות שיפוטית

תנאים אלו כפופים לדיני מדינת ישראל, לרבות חוק החוזים (חלק כללי), תשל"ג-1973, וחוק החוזים (תרופות בשל הפרת חוזה), תשל"א-1970. **סמכות שיפוטית ייחודית לבתי המשפט המוסמכים במחוז תל אביב-יפו.**

הצדדים מוותרים על סמכות שיפוטית בבתי משפט זרים ועל תחולת הדין הזר. הגשת תביעה בינלאומית תידון בבוררות בישראל לפי כללי מכון שנהב לבוררות, אלא אם הוסכם אחרת בכתב.

## 16. כללי

- אם ייקבע שהוראה מסוימת בתנאים אלו אינה אכיפה, שאר ההוראות יישארו בתוקפן המלא.
- אי-מימוש זכות מסוימת אינה מהווה ויתור עליה.
- תנאים אלו מהווים את ההסכם המלא בין הצדדים בנושא השירות.

## 17. יצירת קשר

לכל שאלה, הבהרה, ו/או פנייה משפטית:

**דוא"ל:** legal@rushpoint.app · spendora.tracker@gmail.com
      `,
    },
    en: {
      title: 'Terms of Service',
      updated: 'Last updated: July 2026',
      body: `
## 1. Acceptance of Terms

Welcome to RushPoint. These Terms of Service ("Terms") govern your access to and use of the RushPoint platform. RushPoint ("the Company") operates a SaaS platform for creating, launching, and managing real-world field games.

**By clicking "Create Account", joining a game, and/or using the Service in any other way, you represent that you have read, understood, and agree to these Terms in their entirety.**

If you do not agree, please do not use the Service. **Creating a Creator account** is permitted from age 16 and over only; if you are between 16 and 18, use is subject to parental or guardian consent. **Participating in a game** is possible for those under 16 as well, provided the Creator has enabled the required guardian-consent mechanism — see Section 6.1(g) and Privacy Policy Section 11.

## 2. Definitions

**"Creator"**: any person who has registered an account and creates and/or manages games.
**"Participant"**: any person who joins a game created by a Creator.
**"Run"**: a real-time game event.
**"Service"**: the entire RushPoint platform, including interfaces, API, and Cloud Functions.
**"Event Credit"**: a billing unit purchased for payment and used to launch paid runs.
**"Creator Pro"**: a paid subscription that grants Creators expanded capabilities.
**"Public Gallery"**: a public task repository to which Creators publish and from which they may borrow.

## 3. Account Registration and Details

- You agree to provide accurate and complete information at registration.
- You are responsible for keeping your password and all account credentials confidential.
- Transferring accounts, sharing access, and creating multiple accounts to circumvent restrictions are all prohibited.
- You must notify us immediately of any suspected unauthorized use of your account.
- The Company reserves the right to require identity verification in cases of suspected Terms violation.

## 4. Nature of the Service: Software Tool Only

> RushPoint is a software tool providing technological infrastructure for creating and managing events. The Company does not organize events, choose locations, provide equipment, or attend events in the field.

We provide:
- A game-design platform
- A real-time launch, management, and scoring mechanism
- Tools for team and participant management
- Technical infrastructure for data storage and processing

We do **not** provide:
- Route planning or approval
- Safety briefings
- Professional liability insurance
- On-site supervision
- Responsibility for content, strategy, or decisions made by Creators

## 5. Creator-Generated Content and the Public Gallery License

### 5.1 Content Ownership

You retain your copyright in content you create, including game names, stage descriptions, task text, images, and questions.

### 5.2 Operating License

By using the Service, you grant the Company a non-exclusive, royalty-free, assignable license to store, display, and process that content for the purpose of providing the Service. This license ends when the account is deleted.

### 5.3 Public Gallery License

By publishing a task to RushPoint's public gallery, you grant the Company and all other users of the platform:

**A non-exclusive, royalty-free, irrevocable, sublicensable license to copy, modify, translate, and incorporate the task into other games.**

This license:
- May be exercised by any other Creator on the platform without contacting you
- Permits free modification and adaptation of the original task
- Does not require attribution to the original Creator
- Does not affect your right to continue using the task and/or remove it from the gallery

**After removing a task from the gallery:** Creators who have already borrowed and/or incorporated the task into their games may continue using it, but it will no longer be available for new borrowing.

### 5.4 Content Prohibitions

It is **strictly prohibited** to create and/or upload:
- Offensive, racist, threatening, harassing, and/or degrading content
- Content that violates the privacy of specific individuals
- Content that infringes third-party copyrights and/or trademarks
- Content that directs participants to dangerous areas, private property without permission, and/or restricted facilities
- Content that contravenes any Israeli and/or international law

### 5.5 Participant-Uploaded Content and the Live Photo Feed

This Section governs content uploaded by participants during a run, and in particular photos displayed in the live photo feed. **Section 5.4 (Content Prohibitions) applies in full to participant-uploaded content as well**; this Section adds to it and does not replace it.

**(a) Upload prohibitions:** a participant may not upload content of the kinds listed in Section 5.4, including offensive, harassing, threatening, racist, and/or degrading content; sexual and/or graphic content; content that violates another person's privacy and/or depicts a person without their consent; content that infringes third-party rights; and any content that contravenes applicable law.

**(b) Visibility to every team in the run:** when the live photo feed is enabled for a game, an uploaded and approved photo is shown to **every team taking part in that run**, not only to the Creator and their designated staff. Do not upload content you are not willing for all participants in the run to see.

**(c) Reporting content:** **any participant** may report any photo in the feed, directly from the app, by selecting a reason from a closed list.

**(d) Removal pending review:** reported content is removed from the feed pending review. Removed content is no longer shown to participants and is excluded from the closing ceremony. The reporting participant stops seeing the content they reported immediately.

**(e) Removal authority:** the game's Creator and their designated staff may hide any photo at any time, and may restore a photo removed in error. RushPoint may likewise remove content, end a participant's participation in a run, and take action under Section 12, in any case of a breach of this Section.

**(f) "Mute this team" — clarification:** the option to mute a team in the participant app hides that team's photos **on the device where the mute was applied only**. Participants join anonymously and without an account, so this is not identity-level or user-level blocking: a mute does not carry across devices, does not affect other participants, and does not remove the content itself.

**(g) Creator responsibility:** the game's Creator is responsible for the content uploaded by the participants of their event, including monitoring the feed during the run and acting on reports. A Creator who does not want photos shared between teams may turn the live photo feed off in the game settings before launch.

## 6. Creator Responsibility and Participant Physical Safety

> **This is the most important section of the Terms. Please read carefully.**

### 6.1 Creator's Full Assumption of Responsibility

Game Creators on the RushPoint platform are **independent event organizers** only. In operating a run and event, the Creator declares, confirms, and undertakes:

**(a) Site survey:** that they conducted a prior survey of all locations included in the game route, and verified that they are open to the public, safe to enter, and appropriate for the type of participants expected.

**(b) Route suitability:** that the route, pace, and level of physical demands are appropriate for the age, fitness level, and known medical limitations of their participants.

**(c) Equipment and preparedness:** that they provided appropriate safety equipment and/or instructed participants what to bring themselves.

**(d) Access to help:** that they communicated to participants how to contact first aid and/or emergency services during the event, and that an emergency number is accessible to all teams.

**(e) Permits and insurance:** that they obtained all permits required for use of any public and/or private spaces included in the route, and where necessary, purchased professional liability insurance for the event.

**(f) Legal compliance:** that the event complies with all applicable Israeli legal requirements.

**(g) Minors:** that if participants in the event are expected to be under 16, they enabled the "guardian consent" mechanism in the run's settings before the game starts, and that running an event with minors without this mechanism is a breach of these Terms.

### 6.2 Full Waiver of Claims against the Company

**In operating an event through RushPoint, the Creator waives any and all claims against the Company, its employees, officers, and shareholders, relating to physical, mental, material, and/or financial harm suffered by participants, third parties, and/or the Creator themselves, as a direct and/or indirect result of operating the event.**

This waiver applies whether the harm was caused by:
- Equipment failure
- Weather conditions
- Falls, injuries, and/or accidents in the field
- Entry into unsafe buildings and/or areas
- Participant behavior
- Other factors outside the Company's control

**Note:** this waiver does not limit the Company's liability in cases of intentional conduct and/or gross negligence by the Company itself.

### 6.3 Strict Safety Recommendations (Non-Exhaustive)

- **Waiver form:** obtain a legally drafted participant waiver from every participant before the event starts
- **Emergency number:** provide every team with an emergency phone number that a staff member will answer at all times
- **Clear boundaries:** communicate in writing which areas are off-limits and which activities are prohibited
- **Ongoing monitoring:** maintain contact with all teams throughout the event
- **Medical availability:** ensure access to first-aid equipment and/or a staff member trained in first aid

**RushPoint is not liable for harm caused by failure to implement these recommendations.**

### 6.4 Participant Acknowledgment

By joining a game, every participant acknowledges that they:
- Are aware this is a physical outdoor activity involving walking and/or running
- Take personal responsibility for their fitness level and suitability for the activity
- Agree that the Company is not liable for physical harm resulting from participation

## 7. Payments, Credits, and Subscriptions

### 7.1 Free Runs

Every new account receives lifetime free runs of up to 5 participants each. Free runs are not redeemable for cash.

### 7.2 Event Credits

- Credits are purchased in defined packages and used to launch paid runs
- Purchased credits do not expire
- On launching a run, the applicable credits are deducted from the wallet **at launch** with no possibility of reversal
- A refund for purchased credits is available only in the case of a verified technical failure that completely prevented the run from taking place, and only if reported within 48 hours of the scheduled start time

### 7.3 Creator Pro Subscription

- Creator Pro is a paid annual and/or monthly subscription
- Cancel anytime; cancellation takes effect at the end of the current billing period
- No pro-rated refunds for the remaining period after cancellation
- Upgrading from a monthly to an annual plan is available at any time; the difference is calculated proportionally

### 7.4 General Payment Terms

- All transactions are processed by our authorized payment processor; card details are not stored on our servers
- Prices are displayed in New Israeli Shekels (NIS) and include VAT as required by Israeli law
- Electronic receipts are sent to the account's email address
- For billing inquiries: spendora.tracker@gmail.com

### 7.5 Referral Free-Run Bonus

A Creator who refers a new Creator who registers, and a Creator who registers via a referral link, each receive an additional free run. The referral bonus is limited to one free run per successful referral. The Company reserves the right to modify and/or terminate the referral program with advance notice.

## 8. Prohibited Uses

It is strictly prohibited to use the Service for:
- Creating illegal, inciting, racist, and/or offensive content
- Collecting personal data about participants without their explicit consent
- Tracking individuals' location without their knowledge and/or consent
- Penetrating, attempting to breach, and/or bypassing the platform's security mechanisms
- Reverse-engineering the platform code
- Server overloading (DoS), bots, and/or any attempt to disrupt service availability
- Impersonating other parties
- Using the Service for a competing business and/or to build a similar product

## 9. Limitation of the Company's Liability

The Service is provided "as is" and "as available." To the extent permitted by Israeli law:

**(a) No content liability:** the Company is not liable for content created by Creators, its accuracy, truthfulness, and/or legality.

**(b) No indirect damages:** the Company will not bear indirect, consequential, incidental, punitive damages, or damages for loss of revenue and/or goodwill.

**(c) Liability cap:** in any event, the Company's total liability shall not exceed the amount you paid to the Company in the 12 months preceding the damage event.

**(d) Force majeure:** the Company will not bear liability for service unavailability and/or data loss resulting from events beyond its reasonable control.

**For physical safety:** see Section 6 above.

## 10. Indemnification

You agree to indemnify and defend the Company, its employees, officers, and shareholders from any claim, damage, loss, cost, and/or expense (including reasonable attorney's fees) arising from:
- Your breach of these Terms
- Your violation of third-party rights
- Content you created and/or published
- An event you operated, including any tort claim from participants

## 11. Intellectual Property

The platform itself, including source code, design, routing algorithms, user interface, and these policy documents, belongs to the Company and is protected by copyright. Copying, reproducing, and/or distributing without written permission from the Company is prohibited. The Company's trademarks may not be used without prior approval.

## 12. Account Suspension and Termination

The Company reserves the right to suspend and/or close an account:
- With advance notice: for repeated violations and/or abuse of the Service
- Without advance notice: for serious violations, illegal content, and/or an immediate safety risk

Upon account closure, purchased credits will be refunded proportionally, except where closure results from a Terms violation.

## 13. Changes to Terms of Service

We reserve the right to modify these Terms. For material changes, we will provide notice within the platform at least 30 days in advance. Continued use after the effective date constitutes acceptance of the changes.

## 14. Privacy Protection

Collection and processing of personal data is governed by our Privacy Policy, which forms an integral part of these Terms.

## 15. Governing Law and Jurisdiction

These Terms are governed by Israeli law, including the Contracts Law (General Part) 5733-1973 and the Contracts Law (Remedies for Breach of Contract) 5731-1970. **Exclusive jurisdiction is conferred on the competent courts of the Tel Aviv-Jaffa District.**

The parties waive jurisdiction of foreign courts and the application of foreign law. International disputes shall be resolved by arbitration in Israel under the rules of the Israeli Arbitration Institute, unless otherwise agreed in writing.

## 16. General

- If any provision of these Terms is found to be unenforceable, the remaining provisions shall remain in full force and effect.
- Failure to exercise any right does not constitute a waiver of that right.
- These Terms constitute the entire agreement between the parties regarding the Service.

## 17. Contact

For any question, clarification, and/or legal inquiry:

**Email:** legal@rushpoint.app · spendora.tracker@gmail.com
      `,
    },
  },
};
